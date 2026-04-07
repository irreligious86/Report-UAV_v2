/**
 * Key/value settings in IndexedDB (store `settings`).
 * @module settings-store
 */

import { openDatabase } from "./db.js";

/**
 * @param {string} key
 * @returns {Promise<unknown>}
 */
export async function getSetting(key) {
  const k = String(key || "").trim();
  if (!k) return undefined;
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("settings", "readonly");
    const req = tx.objectStore("settings").get(k);
    req.onsuccess = () => resolve(req.result?.value);
    req.onerror = () => reject(req.error);
  });
}

/**
 * @param {string} key
 * @param {unknown} value — JSON-serializable
 * @returns {Promise<void>}
 */
export async function setSetting(key, value) {
  const k = String(key || "").trim();
  if (!k) return;
  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("settings", "readwrite");
    tx.objectStore("settings").put({ key: k, value });
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error);
  });
}
