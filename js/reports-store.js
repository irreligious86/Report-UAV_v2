/**
 * CRUD for reports in IndexedDB.
 * @module reports-store
 */

import { openDatabase } from "./db.js";
import { REPORTS_LIMIT } from "./constants.js";

/**
 * @typedef {import("./report-model.js").Report} Report
 */

/**
 * @returns {Promise<Report[]>}
 */
export async function listReportsSorted() {
  const db = await openDatabase();
  const all = await new Promise((resolve, reject) => {
    const tx = db.transaction("reports", "readonly");
    const req = tx.objectStore("reports").getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
  const arr = Array.isArray(all) ? all : [];
  arr.sort((a, b) => {
    const am = Date.parse(a.createdAt || "") || 0;
    const bm = Date.parse(b.createdAt || "") || 0;
    return am - bm;
  });
  return arr;
}

/**
 * @param {string} id
 * @returns {Promise<Report|undefined>}
 */
export async function getReportById(id) {
  const k = String(id || "").trim();
  if (!k) return undefined;
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("reports", "readonly");
    const req = tx.objectStore("reports").get(k);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * @param {Report} report
 * @returns {Promise<void>}
 */
export async function putReport(report) {
  if (!report?.id) return;
  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("reports", "readwrite");
    tx.objectStore("reports").put(report);
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Trim to REPORTS_LIMIT (oldest dropped).
 * @param {Report[]} reports
 * @returns {Report[]}
 */
function trimReports(reports) {
  if (reports.length <= REPORTS_LIMIT) return reports;
  const sorted = [...reports].sort(
    (a, b) =>
      (Date.parse(a.createdAt || "") || 0) - (Date.parse(b.createdAt || "") || 0)
  );
  return sorted.slice(-REPORTS_LIMIT);
}

/**
 * Replaces all reports (e.g. import).
 * @param {Report[]} reports
 * @returns {Promise<void>}
 */
export async function replaceAllReports(reports) {
  const trimmed = trimReports(Array.isArray(reports) ? reports : []);
  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("reports", "readwrite");
    const store = tx.objectStore("reports");
    store.clear();
    for (const r of trimmed) {
      if (r?.id) store.put(r);
    }
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * @param {string[]} ids
 * @returns {Promise<void>}
 */
export async function deleteReportsByIds(ids) {
  if (!Array.isArray(ids) || !ids.length) return;
  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("reports", "readwrite");
    const store = tx.objectStore("reports");
    for (const id of ids) {
      const k = String(id || "").trim();
      if (k) store.delete(k);
    }
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Fetch reports by syncStatus index value.
 * @param {string} status
 * @returns {Promise<Report[]>}
 */
export async function getReportsBySyncStatus(status) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("reports", "readonly");
    const idx = tx.objectStore("reports").index("syncStatus");
    const req = idx.getAll(status);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

/**
 * @returns {Promise<void>}
 */
export async function clearAllReports() {
  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("reports", "readwrite");
    tx.objectStore("reports").clear();
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error);
  });
}
