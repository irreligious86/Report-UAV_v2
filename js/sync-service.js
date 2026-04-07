/**
 * Orchestrates queue processing, retries, delayed send hooks.
 * @module sync-service
 */

import { SYNC_STATUS, patchReportMeta } from "./report-model.js";
import * as reportsStore from "./reports-store.js";
import * as queueStore from "./sync-queue-store.js";
import { loadSyncSettings } from "./sync-settings.js";
import { postUpsertReport } from "./google-sheets-api.js";
import { openDatabase } from "./db.js";
import { emitReportsChanged } from "./events.js";

/**
 * Retry delays in ms: 1m, 5m, 15m, 30m
 */
const RETRY_MS = [60_000, 300_000, 900_000, 1_800_000];

/** Maximum sync_log entries before rotation. */
const SYNC_LOG_LIMIT = 200;

/** @type {number|null} */
let tickTimer = null;

/**
 * Послідовна обробка drain — усі виклики processSyncQueue стають у чергу,
 * щоб не було паралельних POST і змішування порядку відправки.
 * @type {Promise<void>}
 */
let drainChain = Promise.resolve();

/**
 * Числовий ключ лічильника місії для сортування черги (якщо є).
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
 * Порядок відправки: crew_counter ↑, потім createdAt ↑, потім reportId.
 * @param {import("./report-model.js").Report|null|undefined} repA
 * @param {import("./report-model.js").Report|null|undefined} repB
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
 * @param {string} reportId
 * @param {string|null} message
 * @param {"success"|"error"} status
 */
async function appendSyncLog(reportId, message, status) {
  try {
    const db = await openDatabase();
    const id = `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const row = {
      id,
      reportId,
      timestamp: new Date().toISOString(),
      action: "upsert_report",
      status,
      message: message || "",
    };
    await new Promise((resolve, reject) => {
      const tx = db.transaction("sync_log", "readwrite");
      tx.objectStore("sync_log").put(row);
      tx.oncomplete = () => resolve(undefined);
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore */
  }
}

/**
 * Rotate sync_log: keep only the newest SYNC_LOG_LIMIT entries.
 */
async function rotateSyncLog() {
  try {
    const db = await openDatabase();
    const all = await new Promise((resolve, reject) => {
      const tx = db.transaction("sync_log", "readonly");
      const idx = tx.objectStore("sync_log").index("timestamp");
      const req = idx.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    if (all.length <= SYNC_LOG_LIMIT) return;

    // Sort ascending by timestamp, drop the oldest
    all.sort((a, b) => (a.timestamp || "").localeCompare(b.timestamp || ""));
    const toRemove = all.slice(0, all.length - SYNC_LOG_LIMIT);

    await new Promise((resolve, reject) => {
      const tx = db.transaction("sync_log", "readwrite");
      const store = tx.objectStore("sync_log");
      for (const entry of toRemove) {
        if (entry.id) store.delete(entry.id);
      }
      tx.oncomplete = () => resolve(undefined);
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore */
  }
}

/**
 * Process one queue item: load fresh report, POST, update status.
 * @returns {Promise<boolean>} true if work was done
 */
async function processOneQueueItem() {
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
    })
  );
  withCreated.sort((a, b) => compareQueueReports_(a.rep, b.rep, a.ms, b.ms, a.q.reportId, b.q.reportId));
  const item = withCreated[0].q;

  const settings = await loadSyncSettings();
  const report = withCreated[0].rep || (await reportsStore.getReportById(item.reportId));
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
        (settings.correctionsOnlyAfterSend === true || settings.correctionsOnlyAfterSend === undefined);
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

/**
 * Повертає звіт зі статусу SENDING у QUEUED/ERROR (після невдалого POST або винятку).
 */
async function applySendFailure_(item, rSending, nextAttempts, errMsg) {
  const failIdx = Math.min(nextAttempts - 1, RETRY_MS.length - 1);
  const delay = RETRY_MS[Math.max(0, failIdx)];
  const nextRetry = new Date(Date.now() + delay).toISOString();

  if (nextAttempts > RETRY_MS.length + 2) {
    await queueStore.removeQueueItem(item.queueId);
    await reportsStore.putReport(
      patchReportMeta(rSending, { syncStatus: SYNC_STATUS.ERROR, locked: false })
    );
  } else {
    await queueStore.updateQueueItem({
      ...item,
      attempts: nextAttempts,
      lastError: errMsg,
      nextRetryAt: nextRetry,
    });
    await reportsStore.putReport(
      patchReportMeta(rSending, { syncStatus: SYNC_STATUS.QUEUED, locked: false })
    );
  }
  emitReportsChanged();
}

const MAX_DRAIN_PER_RUN = 500;

/**
 * Drain the send queue sequentially (one item per loop iteration).
 * All callers share a single drainChain promise so only one POST runs at a time.
 * Returns when the queue is empty or MAX_DRAIN_PER_RUN iterations are done.
 * @returns {Promise<void>}
 */
export async function processSyncQueue() {
  drainChain = drainChain.then(_drain);
  return drainChain;
}

async function _drain() {
  for (let i = 0; i < MAX_DRAIN_PER_RUN; i++) {
    const didWork = await processOneQueueItem();
    if (!didWork) break;
  }
}

/**
 * Enqueue a report for sending: marks it QUEUED in IndexedDB and adds
 * a queue item. Safe to call multiple times — duplicate queue items for
 * the same reportId are deduplicated by the queue store.
 * @param {string} reportId
 */
export async function enqueueSendReport(reportId) {
  const r = await reportsStore.getReportById(reportId);
  if (!r) return;
  await reportsStore.putReport(
    patchReportMeta(r, { syncStatus: SYNC_STATUS.QUEUED })
  );
  await queueStore.enqueueQueueItem({ reportId, action: "send" });
  emitReportsChanged();
}

/**
 * Scan SCHEDULED reports and enqueue any whose sendAfter time has passed.
 * Called on startup and periodically by startSyncService tick.
 * @returns {Promise<void>}
 */
export async function processScheduledReports() {
  const scheduled = await reportsStore.getReportsBySyncStatus(SYNC_STATUS.SCHEDULED);
  const now = Date.now();
  for (const r of scheduled) {
    if (!r.sendAfter) continue;
    const t = Date.parse(r.sendAfter);
    if (Number.isNaN(t) || t > now) continue;
    await enqueueSendReport(r.id);
  }
}

/**
 * On startup, move any SENDING reports back to QUEUED so they are retried.
 * A report stuck in SENDING means the app crashed mid-POST.
 */
async function recoverStuckSendingReports_() {
  const stuck = await reportsStore.getReportsBySyncStatus(SYNC_STATUS.SENDING);
  for (const r of stuck) {
    await reportsStore.putReport(
      patchReportMeta(r, { syncStatus: SYNC_STATUS.QUEUED })
    );
    await queueStore.enqueueQueueItem({ reportId: r.id, action: "send" });
  }
  if (stuck.length) emitReportsChanged();
}

/**
 * Start the background sync loop.
 * Initialises recovery, rotates log, then ticks every 60 s to:
 *   - process SCHEDULED reports that have matured
 *   - drain the send queue
 * Safe to call multiple times — only one timer runs.
 */
export async function startSyncService() {
  if (tickTimer !== null) return; // already running

  // Recover any reports that were stuck in SENDING when the app last crashed
  await recoverStuckSendingReports_();
  await rotateSyncLog();

  const tick = async () => {
    await processScheduledReports();
    await processSyncQueue();
  };

  // First tick immediately, then every 60 s
  void tick();
  tickTimer = window.setInterval(() => void tick(), 60_000);
}