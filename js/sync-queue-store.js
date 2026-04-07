/**
 * Outbound sync queue (reportId references only).
 * @module sync-queue-store
 */

import { openDatabase } from "./db.js";

/**
 * @typedef {Object} SyncQueueItem
 * @property {string} queueId
 * @property {string} reportId
 * @property {"send"|"resync"} action
 * @property {number} attempts
 * @property {string} createdAt
 * @property {string|null} nextRetryAt
 * @property {string|null} lastError
 */

function genQueueId() {
  return `q_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
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
