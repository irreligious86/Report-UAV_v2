/**
 * Facade for all "business" report actions (create / edit / send / cancel).
 *
 * EN:
 *   This module is the boundary between UI screens and the lower data layer
 *   (`reports-store`, `sync-queue-store`, `sync-service`, `google-sheets-api`).
 *   Every UI action that changes a report or its sync state should go through
 *   here, never directly to the stores. Why:
 *     - status transitions are defined in one place,
 *     - `emitReportsChanged()` is fired exactly once per logical mutation,
 *     - the queue stays consistent (e.g. deleting a report also drops its
 *       queue tasks; cancelling a scheduled send also clears its queue).
 *
 *   Lifecycle of a report — the full picture (statuses live in `report-model`):
 *
 *     1) Form «Готово»
 *        ──────────────
 *        `screens/mainForm.js` calls `generate.js`, which:
 *          a. collects form fields,
 *          b. calls `createAndStoreReport(fields)`.
 *
 *     2) `createAndStoreReport(fields)`
 *        ───────────────────────────────
 *        Reads sync settings:
 *          - sendMode === "manual"     → status DRAFT, no queue.
 *          - sendMode === "delayed"    → status SCHEDULED, sets `sendAfter`,
 *                                         no queue task yet.
 *          - sendMode === "immediate"  → status DRAFT in IDB, then a queue
 *                                         task is added and a drain is
 *                                         kicked off.
 *        Always emits `reportsChanged` and runs `processScheduledReports()`
 *        in case other reports just matured.
 *
 *     3) Background work in `sync-service.js`
 *        ────────────────────────────────────
 *        - Every 60 s the tick runs `processScheduledReports()` (matures
 *          SCHEDULED → QUEUED) and then `processSyncQueue()` (drains the
 *          queue one item at a time).
 *        - On startup `recoverStuckSendingReports_` moves any leftover
 *          SENDING reports from a killed previous session back to QUEUED.
 *
 *     4) One queue item — `sync-queue-processor.processOneQueueItem`
 *        ─────────────────────────────────────────────────────────
 *        a. Picks the next ready item (smallest crewCounter → createdAt → id).
 *        b. Marks the report SENDING.
 *        c. POSTs upsert_report.
 *           - On success: clears the queue task, sets SENT (and `locked` if
 *             configured), stores `sheetRowId` returned by the server,
 *             writes a sync_log row.
 *           - On HTTP / network failure: schedules a retry with the
 *             back-off ladder [1m, 5m, 15m, 30m]; after too many failures
 *             marks ERROR.
 *
 *     5) User actions (this module exposes the entry points)
 *        ──────────────────────────────────────────────────
 *        - `trySendReportNow(id)`           — bulk-sends a single report
 *                                              and waits for the drain.
 *        - `enqueueReportsForSheetSync(ids)` — bulk send of the journal
 *                                              filter (skips SCHEDULED).
 *        - `scheduleSend(id, mins)`          — DRAFT → SCHEDULED.
 *        - `cancelScheduledSend(id)`         — SCHEDULED → DRAFT, drop queue.
 *        - `cancelQueuedReport(id)`          — QUEUED/SENDING → DRAFT.
 *        - `updateReportFieldsDraft(id, f)`  — full fields edit while DRAFT
 *                                              (or SCHEDULED).
 *        - `applyCorrectionAfterSent(id, f)` — edit after SENT: keeps row
 *                                              in Sheets but switches to
 *                                              RESYNC_REQUIRED so the user
 *                                              can resend.
 *        - `deleteReportsByIds(ids)`         — delete reports + their queue
 *                                              tasks.
 *        - `deleteAllReports()`              — wipe everything locally.
 *
 *   Legacy v1 archive import lives in `crypto/legacy-import.js`, not here.
 *
 * UA:
 *   Цей модуль — межа між UI-екранами і нижнім шаром даних (`reports-store`,
 *   `sync-queue-store`, `sync-service`, `google-sheets-api`). Будь-яка дія
 *   UI, що змінює звіт або стан синхронізації, повинна йти через цей модуль,
 *   а не напряму у сховища. Чому:
 *     - переходи статусів задано в одному місці,
 *     - `emitReportsChanged()` викликається рівно один раз на одну
 *       логічну мутацію,
 *     - черга лишається консистентною (видалення звіту прибирає його
 *       завдання у черзі; скасування scheduled — теж).
 *
 *   Життєвий цикл звіту — повна картина (значення статусів — у `report-model`):
 *
 *     1) Форма «Готово»
 *        ──────────────
 *        `screens/mainForm.js` викликає `generate.js`, який:
 *          a. збирає поля,
 *          b. викликає `createAndStoreReport(fields)`.
 *
 *     2) `createAndStoreReport(fields)`
 *        ───────────────────────────────
 *        Читає налаштування синхронізації:
 *          - sendMode === "manual"     → статус DRAFT, черга не чіпається.
 *          - sendMode === "delayed"    → статус SCHEDULED, виставляється
 *                                         `sendAfter`, у чергу ще не йде.
 *          - sendMode === "immediate"  → статус DRAFT у IDB, далі додаємо
 *                                         завдання у чергу і запускаємо
 *                                         drain.
 *        Завжди емітує `reportsChanged` і викликає
 *        `processScheduledReports()` — раптом інші звіти «дозріли».
 *
 *     3) Фонова робота у `sync-service.js`
 *        ─────────────────────────────────
 *        - Кожні 60 с тік виконує `processScheduledReports()` (переводить
 *          SCHEDULED → QUEUED) і `processSyncQueue()` (drain черги
 *          поелементно).
 *        - На старті `recoverStuckSendingReports_` повертає у QUEUED ті
 *          SENDING-звіти, що залишилися від попередньої сесії, яку вбили
 *          посеред POST-у.
 *
 *     4) Один елемент черги — `sync-queue-processor.processOneQueueItem`
 *        ──────────────────────────────────────────────────────────────
 *        a. Обирає наступний готовий елемент (за crewCounter → createdAt → id).
 *        b. Ставить звіт у SENDING.
 *        c. POST upsert_report.
 *           - Успіх: видаляє завдання, ставить SENT (і `locked`, якщо
 *             увімкнено), зберігає `sheetRowId` із відповіді сервера,
 *             пише рядок у sync_log.
 *           - Помилка HTTP / мережі: плануємо retry за драбиною
 *             [1хв, 5хв, 15хв, 30хв]; після багатьох невдач — ERROR.
 *
 *     5) Дії користувача (цей модуль експортує точки входу)
 *        ───────────────────────────────────────────────
 *        - `trySendReportNow(id)`            — bulk-надсилання одного
 *                                               звіту й очікування drain.
 *        - `enqueueReportsForSheetSync(ids)` — масова відправка всього
 *                                               списку журналу
 *                                               (SCHEDULED пропускаємо).
 *        - `scheduleSend(id, mins)`           — DRAFT → SCHEDULED.
 *        - `cancelScheduledSend(id)`          — SCHEDULED → DRAFT,
 *                                                чергу очищаємо.
 *        - `cancelQueuedReport(id)`           — QUEUED/SENDING → DRAFT.
 *        - `updateReportFieldsDraft(id, f)`   — повне редагування полів,
 *                                                поки DRAFT/SCHEDULED.
 *        - `applyCorrectionAfterSent(id, f)`  — правка після SENT:
 *                                                рядок лишається в Sheets,
 *                                                звіт стає
 *                                                RESYNC_REQUIRED — щоб
 *                                                користувач надіслав зміни.
 *        - `deleteReportsByIds(ids)`          — видалення звітів і їх
 *                                                завдань у черзі.
 *        - `deleteAllReports()`               — чистка локально всього.
 *
 *   Імпорт старого формату v1 — у `crypto/legacy-import.js`, не тут.
 *
 * @module report-actions
 */

import * as reportsStore from "./reports-store.js";
import * as queueStore from "./sync-queue-store.js";
import {
  createReport,
  applyFieldsUpdate,
  patchReportMeta,
  SYNC_STATUS,
} from "./report-model.js";
import { loadSyncSettings } from "./sync-settings.js";
import { postPrepareSheet } from "./google-sheets-api.js";
import {
  processSyncQueue,
  enqueueSendReport,
  processScheduledReports,
} from "./sync-service.js";

import { emitReportsChanged } from "./events.js";

/**
 * EN: Re-export so UI screens can read status constants without importing
 *     `report-model.js` (one less dependency in render code).
 * UA: Реекспорт, щоб UI-екрани могли читати константи статусу без
 *     імпорту `report-model.js` (одна залежність у рендері менше).
 */
export { SYNC_STATUS };

/**
 * EN: Returns all reports sorted by createdAt ascending. Pass-through to
 *     the store; provided as the only "list" entry point so screens import
 *     a single facade.
 * UA: Повертає всі звіти у порядку зростання createdAt. Передає виклик
 *     у store; єдина "list" точка входу — щоб екрани імпортували єдиний
 *     фасад.
 * @returns {Promise<import("./report-model.js").Report[]>}
 */
export async function listReports() {
  return reportsStore.listReportsSorted();
}

/**
 * EN: Returns one report by id, or `undefined` if it doesn't exist.
 * UA: Повертає один звіт за id або `undefined`, якщо його немає.
 * @param {string} reportId
 */
export async function getReport(reportId) {
  return reportsStore.getReportById(reportId);
}

/**
 * EN: User pressed "Cancel queue" on a report that is QUEUED or SENDING.
 *     Clears its queue tasks and reverts the report to DRAFT. Note the
 *     order — we drop queue tasks first so the next drain tick cannot
 *     pick this report up between the two writes.
 * UA: Користувач натиснув «Скасувати чергу» на звіті у статусі QUEUED
 *     або SENDING. Видаляємо завдання у черзі і повертаємо звіт у DRAFT.
 *     Порядок важливий: спочатку чергу, потім звіт — щоб наступний тік
 *     drain не встиг підхопити звіт між двома записами.
 * @param {string} reportId
 */
export async function cancelQueuedReport(reportId) {
  await queueStore.removeQueueItemsForReport(reportId);
  const r = await reportsStore.getReportById(reportId);
  if (r) {
    await reportsStore.putReport(
      patchReportMeta(r, { syncStatus: SYNC_STATUS.DRAFT })
    );
  }
  emitReportsChanged();
}

/**
 * EN: Creates a new report from form fields, persists it, and applies the
 *     user-configured send mode (manual / immediate / delayed):
 *
 *       manual    → status DRAFT. Queue is not touched. The user will
 *                   manually press "Send" later (or use the bulk button).
 *       delayed   → status SCHEDULED, with `sendAfter` = now + delay.
 *                   The 60-s tick will mature it into the queue once due.
 *       immediate → status DRAFT in IDB, then enqueue + drain. Note the
 *                   order matters: we MUST enqueue before draining,
 *                   otherwise `processSyncQueue()` would run on an empty
 *                   queue and miss this item — bad for the "fast Готово"
 *                   path where two taps come in <100 ms apart.
 *
 *     Always emits `reportsChanged` so the journal repaints, and runs
 *     `processScheduledReports()` in case other reports just matured.
 *
 * UA: Створює новий звіт із полів форми, зберігає у IDB і застосовує
 *     обраний режим відправки (manual / immediate / delayed):
 *
 *       manual    → статус DRAFT. Чергу не чіпаємо. Користувач натисне
 *                   «Надіслати» руками пізніше (або кнопкою масового
 *                   надсилання).
 *       delayed   → статус SCHEDULED, `sendAfter` = зараз + затримка.
 *                   60-с тік переведе у чергу, коли час настане.
 *       immediate → статус DRAFT у IDB, далі enqueue + drain. Порядок
 *                   важливий: спочатку enqueue, потім drain — інакше
 *                   `processSyncQueue()` пробіжиться по порожній черзі
 *                   і пропустить цей звіт. Особливо це помітно при
 *                   швидких натисканнях «Готово» (два рази за <100 мс).
 *
 *     Завжди емітує `reportsChanged`, щоб журнал перемалювався, і
 *     викликає `processScheduledReports()` — раптом інші звіти дозріли.
 *
 * @param {import("./report-format.js").ReportFields} fields
 * @returns {Promise<import("./report-model.js").Report>}
 */
export async function createAndStoreReport(fields) {
  const settings = await loadSyncSettings();
  let sendAfter = null;
  let syncStatus = SYNC_STATUS.DRAFT;

  if (settings.sendMode === "delayed") {
    const mins = Math.max(0, settings.sendDelayMinutes ?? 60);
    sendAfter = new Date(Date.now() + mins * 60_000).toISOString();
    syncStatus = SYNC_STATUS.SCHEDULED;
  }

  const r = createReport(fields, { syncStatus, sendAfter });
  await reportsStore.putReport(r);
  emitReportsChanged();

  // Спочатку enqueue, потім drain — інакше processSyncQueue() встигає відпрацювати
  // ДО додавання в чергу (порожня черга) і порядок зламується при швидких «Готово».
  void processScheduledReports();
  if (settings.sendMode === "immediate") {
    void enqueueSendReport(r.id).then(() => processSyncQueue());
  } else {
    void processSyncQueue();
  }

  return r;
}

/**
 * EN: User pressed "Send now" on a single report card. The flow:
 *       1) If Apps Script URL is missing — refuse without enqueuing
 *          (otherwise the report would loop SENDING ↔ QUEUED forever).
 *       2) If `navigator.onLine === false` — enqueue and return false; the
 *          background tick will retry once the network is back.
 *       3) Best-effort `prepare_sheet` (failures don't block the send).
 *       4) Enqueue the report, drain the queue serially.
 *       5) Re-read the report and report whether it reached SENT.
 *     Note: we do NOT bypass the queue. Even single sends go through it,
 *     so the order across "fast Готово" remains stable (one POST at a time).
 * UA: Користувач натиснув «Надіслати зараз» на картці одного звіту:
 *       1) Якщо URL Apps Script порожній — відмовляємо без enqueue
 *          (щоб звіт не циклився SENDING ↔ QUEUED).
 *       2) Якщо `navigator.onLine === false` — ставимо у чергу і повертаємо
 *          false; фоновий тік повторить, коли мережа повернеться.
 *       3) "На всяк випадок" `prepare_sheet` (помилка не блокує).
 *       4) Enqueue + послідовний drain черги.
 *       5) Перечитуємо звіт і повідомляємо, чи дійшло до SENT.
 *     Важливо: чергу НЕ обходимо. Навіть одиночні надсилання проходять
 *     через неї — порядок при швидких «Готово» лишається стабільним
 *     (один POST за раз).
 * @param {string} reportId
 * @returns {Promise<boolean>} EN: true iff the report reached SENT after drain. / UA: true, якщо після drain звіт у статусі SENT.
 */
export async function trySendReportNow(reportId) {
  const settings = await loadSyncSettings();
  const report = await reportsStore.getReportById(reportId);
  if (!report) return false;

  const urlOk = String(settings.appsScriptUrl || "").trim();
  if (!urlOk) {
    // Без URL не ставимо в чергу — інакше безкінечні ретраї SENDING↔QUEUED і плутанина зі статусом.
    return false;
  }

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    await enqueueSendReport(reportId);
    return false;
  }

  // Підготовка заголовків листа (як перед масовою відправкою); помилка не блокує upsert.
  await postPrepareSheet(settings);

  await enqueueSendReport(reportId);
  await processSyncQueue();
  const after = await reportsStore.getReportById(reportId);
  return after?.syncStatus === SYNC_STATUS.SENT;
}

/**
 * EN: Statuses that bulk send must NOT touch. We deliberately exclude
 *     SCHEDULED so a delayed send still fires at its planned time and is
 *     not pulled into "send everything now". DRAFT, QUEUED, SENT, ERROR,
 *     RESYNC_REQUIRED — all are eligible for re-upsert.
 * UA: Статуси, які масова відправка НЕ чіпає. Свідомо виключаємо
 *     SCHEDULED — щоб відкладена відправка спрацювала за планом, а не
 *     підхопилась "загальним посиланням все одразу". DRAFT, QUEUED, SENT,
 *     ERROR, RESYNC_REQUIRED — підлягають повторному upsert.
 */
const BULK_SHEETS_SKIP = new Set([SYNC_STATUS.SCHEDULED]);

/**
 * EN: Bulk version of `trySendReportNow` — used by the journal "Send list to
 *     sheet" button. Filters out SCHEDULED reports, deduplicates ids, runs
 *     `prepare_sheet` once, enqueues each report, then drains the queue.
 *     Already-SENT reports are deliberately allowed: re-upsert is the
 *     correct way to re-create rows after the user manually cleared the
 *     spreadsheet.
 * UA: Масова версія `trySendReportNow` — для кнопки «Відправити список
 *     у таблицю» в журналі. Прибирає SCHEDULED, дедуплікує id, один раз
 *     робить `prepare_sheet`, ставить кожен у чергу і drain. Уже надіслані
 *     SENT теж проходять навмисно — повторний upsert потрібен, коли
 *     користувач вручну почистив таблицю Google.
 * @param {string[]} reportIds
 * @returns {Promise<{ queued: number }>}
 */
export async function enqueueReportsForSheetSync(reportIds) {
  const settings = await loadSyncSettings();
  const urlOk = String(settings.appsScriptUrl || "").trim();
  if (urlOk) {
    await postPrepareSheet(settings);
  }

  const unique = [
    ...new Set(reportIds.map((id) => String(id || "").trim()).filter(Boolean)),
  ];
  let queued = 0;
  for (const id of unique) {
    const r = await reportsStore.getReportById(id);
    if (!r) continue;
    if (BULK_SHEETS_SKIP.has(r.syncStatus)) continue;
    await enqueueSendReport(id);
    queued += 1;
  }
  if (queued > 0) await processSyncQueue();
  return { queued };
}

/**
 * EN: User pressed "Schedule" — DRAFT becomes SCHEDULED with `sendAfter`
 *     set to now + delayMinutes. The 60-s tick in `sync-service.js` will
 *     mature it into the queue once due. `delayMinutes < 0` is clamped to 0.
 * UA: Користувач натиснув «Запланувати» — DRAFT стає SCHEDULED з
 *     `sendAfter` = зараз + delayMinutes. 60-секундний тік у `sync-service`
 *     переведе його у чергу, коли час настане. `delayMinutes < 0` — до 0.
 * @param {string} reportId
 * @param {number} delayMinutes
 */
export async function scheduleSend(reportId, delayMinutes) {
  const report = await reportsStore.getReportById(reportId);
  if (!report) return;
  const mins = Math.max(0, delayMinutes);
  const sendAfter = new Date(Date.now() + mins * 60_000).toISOString();
  await reportsStore.putReport(
    patchReportMeta(report, {
      syncStatus: SYNC_STATUS.SCHEDULED,
      sendAfter,
    })
  );
  emitReportsChanged();
}

/**
 * EN: User pressed "Cancel scheduled send" — SCHEDULED becomes DRAFT,
 *     `sendAfter` is cleared, and any (defensive) queue task for the
 *     report is dropped.
 * UA: Користувач натиснув «Скасувати відправку» — SCHEDULED стає DRAFT,
 *     `sendAfter` очищається, страхувально прибираємо завдання у черзі
 *     для цього звіту.
 * @param {string} reportId
 */
export async function cancelScheduledSend(reportId) {
  const report = await reportsStore.getReportById(reportId);
  if (!report) return;
  await reportsStore.putReport(
    patchReportMeta(report, {
      syncStatus: SYNC_STATUS.DRAFT,
      sendAfter: null,
    })
  );
  await queueStore.removeQueueItemsForReport(reportId);
  emitReportsChanged();
}

/**
 * EN: Edits a DRAFT or SCHEDULED report — full fields replace, version is
 *     bumped, `text` is rebuilt from the new fields. Refuses to touch a
 *     locked SENT report (use `applyCorrectionAfterSent` for that path).
 * UA: Редагування DRAFT або SCHEDULED — повна заміна полів, версія
 *     росте, `text` будується наново з нових полів. Заблокований SENT не
 *     чіпає (для нього є `applyCorrectionAfterSent`).
 * @param {string} reportId
 * @param {import("./report-format.js").ReportFields} fields
 */
export async function updateReportFieldsDraft(reportId, fields) {
  const prev = await reportsStore.getReportById(reportId);
  if (!prev) return;
  if (prev.locked && prev.syncStatus === SYNC_STATUS.SENT) {
    return;
  }
  const next = applyFieldsUpdate(prev, fields, {});
  await reportsStore.putReport(next);
  emitReportsChanged();
}

/**
 * EN: "Correct after publish" — used when the user fixes a typo in a report
 *     that was already SENT. We:
 *       - apply the new fields and bump the version (text is rebuilt),
 *       - move status to RESYNC_REQUIRED (orange dot in the journal) so
 *         the user knows changes are not yet in Sheets,
 *       - unlock the report (`locked: false`) so the resend button is
 *         active.
 *     We do NOT auto-enqueue: the user explicitly chooses "Send changes".
 * UA: «Виправити після публікації» — коли користувач править друкарську
 *     помилку у вже SENT звіті. Робимо:
 *       - застосовуємо нові поля, нарощуємо version (text будується наново),
 *       - статус переходить у RESYNC_REQUIRED (помаранчева крапка в
 *         журналі) — щоб видно: зміни ще не в Sheets,
 *       - знімаємо `locked: false`, щоб кнопка «Надіслати зміни» була
 *         активна.
 *     Автоматично у чергу НЕ ставимо: користувач явно тисне «Надіслати
 *     зміни».
 * @param {string} reportId
 * @param {import("./report-format.js").ReportFields} fields
 */
export async function applyCorrectionAfterSent(reportId, fields) {
  const prev = await reportsStore.getReportById(reportId);
  if (!prev) return;

  const next = applyFieldsUpdate(prev, fields, {
    syncStatus: SYNC_STATUS.RESYNC_REQUIRED,
    locked: false,
  });
  await reportsStore.putReport(next);
  emitReportsChanged();
}

/**
 * EN: Deletes reports by id, ALSO drops their queue tasks so we don't keep
 *     ghost POSTs for non-existent reports. Used by the journal "Delete
 *     filtered" button and the map card delete button.
 * UA: Видаляє звіти за id, ТАКОЖ прибирає їх завдання з черги — щоб не
 *     лишалися "POST-привиди" для неіснуючих звітів. Використовує кнопка
 *     «Видалити список» у журналі та видалення з картки на мапі.
 * @param {string[]} ids
 */
export async function deleteReportsByIds(ids) {
  await reportsStore.deleteReportsByIds(ids);
  for (const id of ids) {
    await queueStore.removeQueueItemsForReport(id);
  }
  emitReportsChanged();
}

/**
 * EN: Wipes the local archive — all reports + every queue task. Called from
 *     the Data screen "Delete all reports" button. Does NOT touch the
 *     spreadsheet on Google's side.
 * UA: Стирає локальний архів — усі звіти + всі завдання у черзі.
 *     Викликає кнопка «Видалити всі звіти» на екрані «Дані».
 *     Таблицю Google НЕ чіпає.
 * @returns {Promise<void>}
 */
export async function deleteAllReports() {
  await reportsStore.clearAllReports();
  const items = await queueStore.listQueueItems();
  for (const q of items) {
    await queueStore.removeQueueItem(q.queueId);
  }
  emitReportsChanged();
}