/**
 * Generic key/value storage on top of the `settings` object store.
 *
 * EN:
 *   Both functions accept any JSON-serialisable value. Higher-level
 *   modules (`sync-settings.js`, future per-feature configs) wrap these
 *   calls with their own typed `load*()` / `save*()` helpers.
 *   We keep this layer "dumb" on purpose so the schema stays simple —
 *   one row = `{ key: string, value: anyJSON }`.
 *
 * UA:
 *   Обидві функції приймають будь-яке JSON-сериалізоване значення.
 *   Модулі вище (`sync-settings.js`, майбутні конфіги фіч) огортають ці
 *   виклики у свої типізовані `load*()` / `save*()`. Цей шар свідомо
 *   "дубовий" — схема проста: один рядок = `{ key: string, value: anyJSON }`.
 *
 * @module settings-store
 */

import { openDatabase } from "./db.js";

/**
 * EN: Reads a single value by key. Returns `undefined` for missing keys
 *     (NOT `null`) so callers can distinguish "never written" from
 *     "explicitly stored null".
 * UA: Читає одне значення за ключем. Повертає `undefined` для відсутніх
 *     ключів (НЕ `null`) — щоб викликач міг відрізнити «ніколи не
 *     записано» від «явно збережено null».
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
 * EN: Writes a single key. Value is stored as-is — IndexedDB serialises it
 *     using the structured-clone algorithm, so plain JSON-friendly shapes
 *     are safest (no Functions, no DOM nodes).
 * UA: Пише одне значення за ключем. IndexedDB сериалізує його алгоритмом
 *     structured-clone — тож найбезпечніше передавати JSON-подібні форми
 *     (без функцій, без DOM-вузлів).
 * @param {string} key
 * @param {unknown} value
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
