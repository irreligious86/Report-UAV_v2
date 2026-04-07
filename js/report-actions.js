/**
 * High-level report operations (facade for UI). Replaces legacy history.js.
 * Legacy import/export format is handled separately; no migration inside the app.
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

export { SYNC_STATUS, emitReportsChanged };

/** @returns {Promise<import("./report-model.js").Report[]>} */
export async function listReports() {
  return reportsStore.listReportsSorted();
}

/** @param {string} reportId */
export async function getReport(reportId) {
  return reportsStore.getReportById(reportId);
}

/**
 * Clear queue row and return report to draft (user cancelled send).
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
 * Create a new report from form fields; apply send mode (manual / immediate / delayed).
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
 * Постановка в чергу й послідовна відправка (за датою створення звіту, не «хто швидший»).
 * @param {string} reportId
 * @returns {Promise<boolean>} чи дійшло до статусу SENT після drain черги
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

/** Статуси, які не чіпає масова відправка (відкладена відправка має спрацювати за розкладом). */
const BULK_SHEETS_SKIP = new Set([SYNC_STATUS.SCHEDULED]);

/**
 * Черга відправки в Google Sheets для кількох звітів: чернетки, помилки, уже надіслані (повторний upsert
 * після очищення таблиці), resync/черга тощо — усе, крім відкладеного SCHEDULED.
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
 * Edit draft / scheduled — full fields replace.
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
 * Correction path after publish.
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
 * Delete reports by ids (delegates to store).
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
 * Delete all reports and clear the sync queue.
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