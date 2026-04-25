/**
 * EN: Inner machinery of queue processing — extracted from `sync-service.js`
 *     so that the orchestrator module focuses on lifecycle (start/tick/drain)
 *     and this module holds the "how one item gets sent" logic.
 *
 *     Public surface:
 *       - {@link processOneQueueItem}: sends a single next-ready queue item.
 *       - {@link appendSyncLog}:       persists a success/error log row.
 *       - {@link rotateSyncLog}:       trims the sync_log store to its limit.
 *
 *     Everything else is intentionally private.
 *
 * UA: Внутрішня "кухня" обробки черги — винесена зі `sync-service.js`, аби
 *     оркестратор зосереджено виконував життєвий цикл (старт/тік/drain), а
 *     цей модуль тримав логіку "як відправити один елемент черги".
 *
 *     Публічний API:
 *       - {@link processOneQueueItem}: надсилає один готовий елемент черги.
 *       - {@link appendSyncLog}:       додає рядок успіху/помилки у лог.
 *       - {@link rotateSyncLog}:       обрізає sync_log до ліміту.
 *
 * @module sync-queue-processor
 */

import { SYNC_STATUS, patchReportMeta } from "./report-model.js";
import * as reportsStore from "./reports-store.js";
import * as queueStore from "./sync-queue-store.js";
import { loadSyncSettings } from "./sync-settings.js";
import { postUpsertReport } from "./google-sheets-api.js";
import { emitReportsChanged } from "./events.js";
import { runReadonly, runReadwrite } from "./idb-helpers.js";
import * as logger from "./logger.js";

/**
 * EN: Retry back-off ladder (ms): 1 min, 5 min, 15 min, 30 min.
 * UA: Східці повторних спроб (мс): 1 хв, 5 хв, 15 хв, 30 хв.
 * @readonly
 */
export const RETRY_MS = [60_000, 300_000, 900_000, 1_800_000];

/**
 * EN: Maximum number of rows to keep in the `sync_log` store before rotation.
 * UA: Максимум записів у `sync_log` перед ротацією.
 */
export const SYNC_LOG_LIMIT = 200;

/**
 * EN: Numeric mission-counter key used to order the send queue (if present).
 * UA: Числовий ключ лічильника місії для сортування черги (якщо є).
 * @param {import("./report-model.js").Report|null|undefined} rep
 * @returns {number|null}
 */
function crewCounterSortKey_(rep) {
  if (!rep?.fields) return null;
  const c = rep.fields.crewCounter;
  if (c == null || c === "") return null;
  const n = Number(c);
  return Number.isFinite(n) ? n : null;
}

/**
 * EN: Comparator — crewCounter ↑, then createdAt ↑, then reportId alphabetically.
 *     The ms/id tie-breakers keep the order stable across identical counters or
 *     missing values (otherwise fast successive "Ready" taps could race).
 * UA: Компаратор — crewCounter ↑, потім createdAt ↑, далі reportId за абеткою.
 *     Додаткові критерії (ms/id) гарантують стабільний порядок при однакових
 *     лічильниках та швидкому натисканні «Готово» кілька разів поспіль.
 *
 * @param {import("./report-model.js").Report|null|undefined} repA
 * @param {import("./report-model.js").Report|null|undefined} repB
 * @param {number} msA
 * @param {number} msB
 * @param {string} idA
 * @param {string} idB
 * @returns {number}
 */
function compareQueueReports_(repA, repB, msA, msB, idA, idB) {
  const ma = crewCounterSortKey_(repA);
  const mb = crewCounterSortKey_(repB);
  if (ma != null && mb != null && ma !== mb) return ma - mb;
  if (ma != null && mb == null) return -1;
  if (ma == null && mb != null) return 1;
  if (msA !== msB) return msA - msB;
  return String(idA).localeCompare(String(idB));
}

/**
 * EN: Appends one row to the `sync_log` object store. Any error is swallowed
 *     (logs are non-critical) but surfaced through `logger.debug()` when the
 *     `uav.debug=1` flag is set in localStorage.
 * UA: Додає один рядок у `sync_log`. Будь-яка помилка ковтається (лог не
 *     критичний), але виринає через `logger.debug()` при прапорі `uav.debug=1`.
 *
 * @param {string} reportId
 * @param {string|null} message
 * @param {"success"|"error"} status
 * @returns {Promise<void>}
 */
export async function appendSyncLog(reportId, message, status) {
  try {
    const id = `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const row = {
      id,
      reportId,
      timestamp: new Date().toISOString(),
      action: "upsert_report",
      status,
      message: message || "",
    };
    await runReadwrite("sync_log", (tx) => {
      tx.objectStore("sync_log").put(row);
    });
  } catch (err) {
    logger.debug("appendSyncLog failed", err);
  }
}

/**
 * EN: Rotates `sync_log` — keeps only the newest {@link SYNC_LOG_LIMIT} rows.
 *     Sorted ascending by timestamp; the oldest are deleted.
 * UA: Ротація `sync_log` — залишає лише найновіші {@link SYNC_LOG_LIMIT} рядків.
 *     Відсортовано за зростанням timestamp; найстаріші видаляються.
 * @returns {Promise<void>}
 */
export async function rotateSyncLog() {
  try {
    /** @type {Array<{id?:string,timestamp?:string}>} */
    const all = await runReadonly("sync_log", (tx) =>
      new Promise((resolve, reject) => {
        const idx = tx.objectStore("sync_log").index("timestamp");
        const req = idx.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      }),
    );
    if (all.length <= SYNC_LOG_LIMIT) return;

    all.sort((a, b) => (a.timestamp || "").localeCompare(b.timestamp || ""));
    const toRemove = all.slice(0, all.length - SYNC_LOG_LIMIT);

    await runReadwrite("sync_log", (tx) => {
      const store = tx.objectStore("sync_log");
      for (const entry of toRemove) {
        if (entry.id) store.delete(entry.id);
      }
    });
  } catch (err) {
    logger.debug("rotateSyncLog failed", err);
  }
}

/**
 * EN: Moves a report from SENDING back to QUEUED (with a back-off) or to
 *     ERROR (if it has failed too many times). Called after a POST failure
 *     or an exception while sending.
 * UA: Повертає звіт зі стану SENDING у QUEUED (з back-off) або у ERROR
 *     (якщо вже багато невдач). Викликається після провалу POST або винятку.
 *
 * @param {import("./sync-queue-store.js").QueueItem} item
 * @param {import("./report-model.js").Report} rSending
 * @param {number} nextAttempts
 * @param {string} errMsg
 * @returns {Promise<void>}
 */
async function applySendFailure_(item, rSending, nextAttempts, errMsg) {
  const failIdx = Math.min(nextAttempts - 1, RETRY_MS.length - 1);
  const delay = RETRY_MS[Math.max(0, failIdx)];
  const nextRetry = new Date(Date.now() + delay).toISOString();

  if (nextAttempts > RETRY_MS.length + 2) {
    await queueStore.removeQueueItem(item.queueId);
    await reportsStore.putReport(
      patchReportMeta(rSending, { syncStatus: SYNC_STATUS.ERROR, locked: false }),
    );
  } else {
    await queueStore.updateQueueItem({
      ...item,
      attempts: nextAttempts,
      lastError: errMsg,
      nextRetryAt: nextRetry,
    });
    await reportsStore.putReport(
      patchReportMeta(rSending, { syncStatus: SYNC_STATUS.QUEUED, locked: false }),
    );
  }
  emitReportsChanged();
}

/**
 * EN: Processes the next "ready" queue item: picks the one with the smallest
 *     crewCounter (then createdAt, then id), loads its fresh report, POSTs to
 *     Google Sheets, and updates the status. Returns `true` if any work was
 *     performed — so the caller knows whether to keep draining.
 * UA: Обробляє наступний "готовий" елемент черги: обирає той, що має найменший
 *     crewCounter (далі за createdAt, далі за id), завантажує актуальний звіт,
 *     шле POST у Google Sheets та оновлює статус. Повертає `true`, якщо була
 *     виконана робота — викликач за цим розуміє, чи продовжувати drain.
 *
 * @returns {Promise<boolean>}
 */
export async function processOneQueueItem() {
  const items = await queueStore.listQueueItems();
  const now = Date.now();
  const ready = items.filter((q) => {
    if (!q.nextRetryAt) return true;
    const t = Date.parse(q.nextRetryAt);
    return !Number.isNaN(t) && t <= now;
  });
  if (!ready.length) return false;

  const withCreated = await Promise.all(
    ready.map(async (q) => {
      const rep = await reportsStore.getReportById(q.reportId);
      const ms = rep ? Date.parse(rep.createdAt || "") || 0 : 0;
      return { q, rep, ms };
    }),
  );
  withCreated.sort((a, b) =>
    compareQueueReports_(a.rep, b.rep, a.ms, b.ms, a.q.reportId, b.q.reportId),
  );
  const item = withCreated[0].q;

  const settings = await loadSyncSettings();
  const report =
    withCreated[0].rep || (await reportsStore.getReportById(item.reportId));
  if (!report) {
    await queueStore.removeQueueItem(item.queueId);
    return true;
  }

  const nextAttempts = (item.attempts || 0) + 1;
  const rSending = patchReportMeta(report, { syncStatus: SYNC_STATUS.SENDING });
  await reportsStore.putReport(rSending);

  try {
    const res = await postUpsertReport(rSending, settings);
    if (res.ok) {
      await queueStore.removeQueueItem(item.queueId);
      const locked =
        settings.lockAfterSend &&
        (settings.correctionsOnlyAfterSend === true ||
          settings.correctionsOnlyAfterSend === undefined);
      const publishedAt = new Date().toISOString();

      const serverRowId =
        res.body && typeof res.body === "object" && "sheet_row_id" in res.body
          ? String(res.body.sheet_row_id)
          : null;

      const next = patchReportMeta(rSending, {
        syncStatus: SYNC_STATUS.SENT,
        locked,
        publishedAt,
        ...(serverRowId ? { sheetRowId: serverRowId } : {}),
      });
      await reportsStore.putReport(next);
      await appendSyncLog(report.id, "OK", "success");
      emitReportsChanged();
      return true;
    }

    const failText = res.error || "unknown";
    await appendSyncLog(report.id, failText, "error");
    await applySendFailure_(item, rSending, nextAttempts, failText);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await appendSyncLog(report.id, msg, "error");
    await applySendFailure_(item, rSending, nextAttempts, msg);
    return true;
  }
}
