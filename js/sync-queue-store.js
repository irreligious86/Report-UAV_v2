/**
 * Outbound sync queue — IndexedDB store `sync_queue`.
 *
 * EN:
 *   This is the persistence layer for the "to-be-sent to Google Sheets" list.
 *   The actual report bodies live in the `reports` store; here we keep ONLY
 *   queue items that reference a report by id and carry retry bookkeeping.
 *
 *   A queue item is a small record:
 *     queueId      — unique id of THIS queue task (not the report).
 *     reportId     — id of the target report in `reports`.
 *     action       — "send" (initial send) or "resync" (after correction).
 *     attempts     — number of POSTs we've tried so far.
 *     createdAt    — ISO timestamp when this queue task was created.
 *     nextRetryAt  — ISO timestamp; the worker will not pick this item up
 *                    before this time. null = ready immediately.
 *     lastError    — text of the last failure, useful for debugging.
 *
 *   IMPORTANT — deduplication:
 *     `enqueueQueueItem({ reportId, ... })` first calls
 *     `removeQueueItemsForReport(reportId)`. Effectively there is at most ONE
 *     queue task per report at any time. This is the right behaviour:
 *       - The user taps "Send" twice in a row → only one queue task; the
 *         second call resets attempts and clears `nextRetryAt`.
 *       - A user-driven "Resync" overwrites a half-failed send.
 *     This also means: callers never need to "search and update", they just
 *     re-enqueue.
 *
 *   This module knows nothing about HTTP, retries policy, or Apps Script.
 *   It is purely a typed wrapper around the IndexedDB transactions.
 *   Retry decisions live in `sync-queue-processor.js`; orchestration in
 *   `sync-service.js`; HTTP in `google-sheets-api.js`.
 *
 * UA:
 *   Це шар збереження для списку «треба відправити в Google Sheets». Самі
 *   тексти звітів живуть у сховищі `reports`; тут лежать ЛИШЕ елементи
 *   черги — посилання на звіт за id плюс облік повторних спроб.
 *
 *   Елемент черги — компактний запис:
 *     queueId      — унікальний id цього завдання черги (не звіту).
 *     reportId     — id цільового звіту у `reports`.
 *     action       — "send" (перша відправка) або "resync" (після правки).
 *     attempts     — скільки POST-ів вже зроблено.
 *     createdAt    — ISO час створення завдання.
 *     nextRetryAt  — ISO час, раніше за який обробник не візьме завдання.
 *                    null = готове до обробки одразу.
 *     lastError    — текст останньої помилки, для діагностики.
 *
 *   ВАЖЛИВО — дедуплікація:
 *     `enqueueQueueItem({ reportId, ... })` спочатку викликає
 *     `removeQueueItemsForReport(reportId)`. Тобто в один момент часу для
 *     одного звіту в черзі є щонайбільше ОДНЕ завдання. Це навмисно:
 *       - Користувач двічі натиснув «Надіслати» → одне завдання; друге
 *         скидає `attempts` і `nextRetryAt`.
 *       - «Resync» після правки перезаписує наполовину невдалу відправку.
 *     Як наслідок — викликачам не треба «шукати й оновлювати», просто
 *     повторно ставлять у чергу.
 *
 *   Цей модуль не знає нічого про HTTP, ретраї чи Apps Script. Він — лише
 *   типізована обгортка над транзакціями IndexedDB. Логіка ретраїв —
 *   у `sync-queue-processor.js`; оркестрація — у `sync-service.js`;
 *   HTTP — у `google-sheets-api.js`.
 *
 * @module sync-queue-store
 */

import { openDatabase } from "./db.js";

/**
 * @typedef {Object} SyncQueueItem
 * @property {string} queueId — EN: unique id of the queue task. UA: унікальний id завдання черги.
 * @property {string} reportId — EN: id of the report in `reports`. UA: id звіту у `reports`.
 * @property {"send"|"resync"} action — EN: initial send or post-edit resync. UA: перша відправка чи resync після правки.
 * @property {number} attempts — EN: how many POSTs were tried. UA: скільки POST-ів вже зроблено.
 * @property {string} createdAt — EN: ISO timestamp when item was created. UA: ISO час створення.
 * @property {string|null} nextRetryAt — EN: do-not-pick-before time. null = ready. UA: не брати раніше цього часу. null = готове.
 * @property {string|null} lastError — EN: last failure message, debug only. UA: текст останньої помилки, для діагностики.
 */

/**
 * EN: Generates a fresh queue task id. Includes ms-timestamp + random suffix
 *     so concurrent enqueues in the same tick still get unique keys.
 * UA: Генерує новий id для завдання черги. Містить мс-час + випадковий
 *     суфікс — щоб одночасні enqueue в один тик отримували різні ключі.
 * @returns {string}
 */
function genQueueId() {
  return `q_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * EN: Adds a new queue task for a report — atomically replacing any previous
 *     queue task for the same `reportId`. This is the canonical "put me in
 *     the queue" call used by `sync-service.enqueueSendReport` and by
 *     `report-actions` for bulk Sheets sync.
 *     `attempts` defaults to 0 and `createdAt` to "now" if not provided.
 * UA: Додає нове завдання у чергу для звіту, атомарно замінюючи будь-яке
 *     попереднє завдання для того ж `reportId`. Це канонічний виклик
 *     «постав у чергу», яким користуються `sync-service.enqueueSendReport`
 *     та `report-actions` для масової синхронізації з Sheets.
 *     `attempts` за замовчуванням = 0, `createdAt` = «зараз», якщо не задано.
 * @param {Omit<SyncQueueItem, "queueId"|"attempts"|"createdAt"> & Partial<Pick<SyncQueueItem, "attempts"|"createdAt">>} item
 * @returns {Promise<void>}
 */
export async function enqueueQueueItem(item) {
  const rid = String(item.reportId || "").trim();
  if (rid) await removeQueueItemsForReport(rid);

  const db = await openDatabase();
  const row = /** @type {SyncQueueItem} */ ({
    queueId: genQueueId(),
    reportId: item.reportId,
    action: item.action,
    attempts: item.attempts ?? 0,
    createdAt: item.createdAt || new Date().toISOString(),
    nextRetryAt: item.nextRetryAt ?? null,
    lastError: item.lastError ?? null,
  });
  await new Promise((resolve, reject) => {
    const tx = db.transaction("sync_queue", "readwrite");
    tx.objectStore("sync_queue").put(row);
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * EN: Returns every queue task currently in the store. Order is undefined —
 *     `sync-queue-processor` does its own selection (smallest crewCounter,
 *     then createdAt, then id) before sending.
 * UA: Повертає всі завдання у черзі. Порядок не гарантовано —
 *     `sync-queue-processor` сам обирає (за crewCounter, потім createdAt,
 *     потім id) перед відправкою.
 * @returns {Promise<SyncQueueItem[]>}
 */
export async function listQueueItems() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("sync_queue", "readonly");
    const req = tx.objectStore("sync_queue").getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

/**
 * EN: Removes ONE queue task by its `queueId`. Used after a successful POST
 *     and after the user manually cancels a queued send.
 * UA: Видаляє ОДНЕ завдання за `queueId`. Викликається після успішного POST
 *     і коли користувач скасовує відправку вручну.
 * @param {string} queueId
 * @returns {Promise<void>}
 */
export async function removeQueueItem(queueId) {
  const id = String(queueId || "").trim();
  if (!id) return;
  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("sync_queue", "readwrite");
    tx.objectStore("sync_queue").delete(id);
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * EN: Updates an existing queue task in place — used by the processor to
 *     bump `attempts`, set `nextRetryAt` (back-off) and `lastError`. Will
 *     create a record if its `queueId` does not yet exist.
 * UA: Оновлює наявне завдання — обробник черги викликає це, щоб збільшити
 *     `attempts`, виставити `nextRetryAt` (back-off) та `lastError`. Якщо
 *     запису з таким `queueId` ще нема — створить новий.
 * @param {SyncQueueItem} item
 * @returns {Promise<void>}
 */
export async function updateQueueItem(item) {
  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("sync_queue", "readwrite");
    tx.objectStore("sync_queue").put(item);
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * EN: Removes EVERY queue task for the given `reportId`. Called from
 *     `enqueueQueueItem` (to enforce single-task-per-report invariant) and
 *     from `report-actions.cancelQueuedReport` / `cancelScheduledSend` /
 *     `deleteReportsByIds` so we don't keep ghost tasks pointing at a
 *     deleted report.
 * UA: Видаляє ВСІ завдання для даного `reportId`. Викликається з
 *     `enqueueQueueItem` (щоб для одного звіту лишалось одне завдання),
 *     а також з `report-actions.cancelQueuedReport` /
 *     `cancelScheduledSend` / `deleteReportsByIds` — щоб не залишались
 *     завдання-привиди, що вказують на видалений звіт.
 * @param {string} reportId
 * @returns {Promise<void>}
 */
export async function removeQueueItemsForReport(reportId) {
  const rid = String(reportId || "").trim();
  if (!rid) return;
  const all = await listQueueItems();
  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("sync_queue", "readwrite");
    const store = tx.objectStore("sync_queue");
    for (const q of all) {
      if (q.reportId === rid) store.delete(q.queueId);
    }
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error);
  });
}
