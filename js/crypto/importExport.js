/**
 * Encrypted export / import for Report UAV v2 (full archive).
 *
 * EN:
 *   This module is the *application-level* glue around `crypto/crypto.js`.
 *   The crypto module knows nothing about reports — it only encrypts JSON
 *   blobs. Here we decide *what* is in those blobs and how the file is laid
 *   out for the user.
 *
 *   Export flow ("Експорт" button on the Data screen):
 *     1) Read every report from IndexedDB via `listReports()`.
 *     2) Wrap them in an envelope `{ kind: "uav-reports-export-v2",
 *        version: 2, exportedAt, reports: [...] }`.
 *     3) Encrypt the envelope with `crypto/crypto.encryptJSON` → encrypted
 *        wrapper { version, algo, salt, iv, data, ... }.
 *     4) Stringify the wrapper as JSON and trigger a browser download as
 *        `uav_reports_v2.enc.json`.
 *
 *   Import flow ("Імпорт" button):
 *     1) The user picks a .json file. Read its text via FileReader.
 *     2) JSON.parse → encrypted wrapper.
 *     3) `decryptJSON(wrapper, passphrase)` → plaintext payload (envelope).
 *     4) `extractReportsArray(payload)` recognises three layouts:
 *           - legacy v1 export (kind: "uav-reports-export", reports with
 *             plain { id, ts, text } shape — converted by `legacy-import.js`),
 *           - plain array of v2 reports,
 *           - v2 envelope with `reports: [...]`.
 *        Every coerced report is re-normalised through `normalizeFields` and
 *        its `text` is rebuilt from fields, so external edits to the JSON
 *        cannot diverge text from structured data.
 *     5) `mergeReports(current, imported)`:
 *           - keys reports by `id`,
 *           - imported records overwrite same-id current records
 *             (newest-wins by content from the file),
 *           - sorts by `createdAt` ascending,
 *           - trims to the newest `REPORTS_LIMIT` records.
 *     6) `replaceAllReports(merged)` clears the `reports` store and rewrites it.
 *     7) UI is notified through `reportsChanged` / `reportsUpdated`.
 *
 *   Why merge by id (instead of "replace all"):
 *     - The user may have created reports on the new device after the backup
 *       was made; we keep them.
 *     - If the same id appears in both, the file version wins — that is the
 *       "restore from backup" expectation.
 *
 * UA:
 *   Цей модуль — клей рівня застосунку поверх `crypto/crypto.js`. Криптомодуль
 *   нічого не знає про звіти, він просто шифрує JSON-обʼєкти. А тут ми
 *   визначаємо, що саме лежить у тих обʼєктах і як файл виглядає для
 *   користувача.
 *
 *   Експорт (кнопка «Експорт» на екрані «Дані»):
 *     1) Прочитати всі звіти з IndexedDB через `listReports()`.
 *     2) Загорнути їх у конверт `{ kind: "uav-reports-export-v2", version: 2,
 *        exportedAt, reports: [...] }`.
 *     3) Зашифрувати конверт через `crypto/crypto.encryptJSON` → шифрована
 *        обгортка { version, algo, salt, iv, data, ... }.
 *     4) JSON.stringify обгортки + завантажити як `uav_reports_v2.enc.json`.
 *
 *   Імпорт (кнопка «Імпорт»):
 *     1) Користувач обирає .json файл; читаємо його текст через FileReader.
 *     2) JSON.parse → шифрована обгортка.
 *     3) `decryptJSON(обгортка, пароль)` → відкритий payload (конверт).
 *     4) `extractReportsArray(payload)` підтримує три формати:
 *           - старий v1 експорт (`kind: "uav-reports-export"`, записи з
 *             простими { id, ts, text } — конвертує `legacy-import.js`),
 *           - звичайний масив звітів v2,
 *           - v2 конверт із `reports: [...]`.
 *        Кожен звіт повторно нормалізується через `normalizeFields`, а його
 *        `text` будується з полів — тож редагування JSON руками не зможе
 *        «розсинхронізувати» текст і поля.
 *     5) `mergeReports(current, imported)`:
 *           - ключ — `id`,
 *           - запис із файлу перезаписує локальний при збігу id
 *             («найновіший == той, що у файлі»),
 *           - сортування за `createdAt` за зростанням,
 *           - обрізаємо до `REPORTS_LIMIT` найновіших записів.
 *     6) `replaceAllReports(merged)` очищає сховище `reports` і пише заново.
 *     7) UI отримує `reportsChanged` / `reportsUpdated` і перемальовується.
 *
 *   Чому merge за id (а не «замінити все»):
 *     - На новому пристрої могли з’явитися записи після бекапу — їх не
 *       втрачаємо.
 *     - Якщо однаковий id є і там, і там — перевагу має файл (це сенс
 *       «відновлення з резервної копії»).
 *
 * @module crypto/importExport
 */

import { REPORTS_LIMIT } from "../constants.js";
import { generateReportId } from "../report-model.js";
import { normalizeFields, buildReportText } from "../report-format.js";
import { listReports } from "../report-actions.js";
import { replaceAllReports } from "../reports-store.js";
import { encryptJSON, decryptJSON } from "./crypto.js";
import {
  isLegacyEncryptedExport,
  isLegacyExportByReportShapes,
  legacyEncryptedExportToReports,
} from "./legacy-import.js";

/** EN: Default file name suggested for the encrypted backup download. UA: Стандартне ім’я файлу зашифрованого бекапу при завантаженні. */
const EXPORT_FILE_NAME = "uav_reports_v2.enc.json";

// ─────────────────────────────────────────────────────────────────────────────
// Validation helpers
// EN: Structural sanity checks for imported records — protect IDB from junk.
// UA: Структурна перевірка імпортованих записів — захист IDB від сміття.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * EN: Minimal structural check for a v2 Report. Does NOT validate field
 *     contents — we only refuse obviously broken objects (missing id, no
 *     fields object, etc.). Field-level normalisation happens in `coerceReport`.
 * UA: Мінімальна структурна перевірка звіту v2. Не перевіряє вміст полів —
 *     відкидаються лише явно зіпсовані об’єкти (без id, без об’єкта fields
 *     тощо). Нормалізація полів — у `coerceReport`.
 * @param {unknown} item
 * @returns {item is import("../report-model.js").Report}
 */
function isValidReport(item) {
  if (!item || typeof item !== "object") return false;
  const r = /** @type {Record<string, unknown>} */ (item);
  if (typeof r.id !== "string" || !r.id.trim()) return false;
  if (typeof r.createdAt !== "string" || !r.createdAt.trim()) return false;
  if (typeof r.updatedAt !== "string" || !r.updatedAt.trim()) return false;
  if (typeof r.text !== "string" || !r.text.trim()) return false;
  if (!r.fields || typeof r.fields !== "object") return false;
  if (typeof r.version !== "number" || r.version < 1) return false;
  if (typeof r.syncStatus !== "string") return false;
  return true;
}

/**
 * EN: Coerces a raw object into a Report: re-normalises fields and rebuilds
 *     `text` from those fields. Returns null when the structure is invalid.
 *     We rebuild `text` to keep a single source of truth — manual JSON edits
 *     to the file cannot make `text` and `fields` disagree on import.
 * UA: Зводить сирий об’єкт до Report: нормалізує `fields` і відбудовує `text`
 *     з полів. Повертає null, коли структура некоректна. Перебудова `text` —
 *     щоб після ручного редагування JSON-файлу не виникало розсинхрону між
 *     `text` і `fields`.
 * @param {unknown} raw
 * @returns {import("../report-model.js").Report|null}
 */
function coerceReport(raw) {
  if (!isValidReport(raw)) return null;
  const r = /** @type {import("../report-model.js").Report} */ (raw);
  const fields = normalizeFields(r.fields);
  const text = buildReportText(fields);
  return { ...r, fields, text };
}

// ─────────────────────────────────────────────────────────────────────────────
// Payload parsing
// EN: Recognise the three supported payload shapes (v1 / array / v2 envelope).
// UA: Розпізнавання трьох підтримуваних форматів payload (v1 / масив / v2).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * EN: Extract a list of Report objects from a decrypted payload. Order of
 *     checks matters — v1 detection runs first because v1 archives also have
 *     a `reports` array but with a totally different inner shape.
 * UA: Дістати список Report з розшифрованого payload. Порядок перевірок
 *     важливий — v1 має теж масив `reports`, але з іншою внутрішньою формою.
 * @param {unknown} payload
 * @returns {import("../report-model.js").Report[]}
 */
function extractReportsArray(payload) {
  // Legacy v1 format
  if (isLegacyEncryptedExport(payload) || isLegacyExportByReportShapes(payload)) {
    return legacyEncryptedExportToReports(payload);
  }

  // Plain array of v2 reports
  if (Array.isArray(payload)) {
    const out = payload.map(coerceReport).filter(Boolean);
    if (!out.length) throw new Error("Файл не містить коректних звітів для імпорту.");
    return /** @type {import("../report-model.js").Report[]} */ (out);
  }

  // v2 envelope: { kind, version, reports: [...] }
  if (payload && typeof payload === "object" && Array.isArray(
    /** @type {Record<string,unknown>} */ (payload).reports
  )) {
    const out = /** @type {unknown[]} */ (
      /** @type {Record<string,unknown>} */ (payload).reports
    ).map(coerceReport).filter(Boolean);
    if (!out.length) throw new Error("Файл не містить коректних звітів для імпорту.");
    return /** @type {import("../report-model.js").Report[]} */ (out);
  }

  throw new Error("Невідома структура JSON файлу.");
}

// ─────────────────────────────────────────────────────────────────────────────
// Merge strategy: import-wins by id, then sort by createdAt, then trim to limit
// EN: A Map keyed by id deduplicates between local and imported records;
//     since `imported` is added after `current`, file values overwrite local.
// UA: Map за id одночасно дедуплікує між локальними та імпортованими записами;
//     `imported` додаються після `current`, тому значення з файлу перевизначають.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * EN: Merges DB reports with imported reports. For records with matching id
 *     the imported version wins (file is the source of truth on restore).
 *     Entries with empty/missing id receive a fresh `generateReportId()`.
 *     Result is sorted by `createdAt` ascending and capped at REPORTS_LIMIT
 *     (oldest dropped to fit).
 * UA: Зливає звіти з БД та імпорту. Якщо id збігається — перемагає запис із
 *     файлу (файл — джерело правди при відновленні). Записи без/з порожнім
 *     id отримують свіжий `generateReportId()`. Результат сортується за
 *     `createdAt` за зростанням і обрізається до REPORTS_LIMIT (найстаріші
 *     відкидаються).
 * @param {import("../report-model.js").Report[]} current
 * @param {import("../report-model.js").Report[]} imported
 * @returns {import("../report-model.js").Report[]}
 */
function mergeReports(current, imported) {
  const map = new Map();
  for (const r of current) {
    const id = (typeof r.id === "string" && r.id.trim()) ? r.id.trim() : generateReportId();
    map.set(id, { ...r, id });
  }
  for (const r of imported) {
    const id = (typeof r.id === "string" && r.id.trim()) ? r.id.trim() : generateReportId();
    map.set(id, { ...r, id });
  }
  const merged = Array.from(map.values()).sort(
    (a, b) => (Date.parse(a.createdAt || "") || 0) - (Date.parse(b.createdAt || "") || 0)
  );
  return merged.length > REPORTS_LIMIT ? merged.slice(-REPORTS_LIMIT) : merged;
}

// ─────────────────────────────────────────────────────────────────────────────
// File helpers
// EN: Browser file I/O without a server — Blob + <a download>; FileReader.
// UA: Файлові операції в браузері без сервера — Blob + <a download>; FileReader.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * EN: Triggers a browser download of `content` as `fileName`. Uses an
 *     in-memory Blob URL so we never write through any server.
 * UA: Тригерить завантаження вмісту як файлу в браузері. Використовує
 *     in-memory Blob URL — тож вміст не йде через жоден сервер.
 */
function downloadTextFile(content, fileName) {
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * EN: Promise wrapper around FileReader.readAsText(). Browser handles charset.
 * UA: Promise-обгортка над FileReader.readAsText(). Кодування — за браузером.
 * @param {File} file
 * @returns {Promise<string>}
 */
function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Не вдалося прочитати файл."));
    reader.readAsText(file);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API — called from screens/data.js
// EN: The two functions below are the entire public surface of this module.
// UA: Дві функції нижче — увесь публічний API модуля.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * EN: Encrypts every report in the local DB into a single backup file and
 *     triggers a download. The resulting `.json` file contains:
 *       - cipher metadata (version, algo, kdf, hash, iterations, salt, iv),
 *       - ciphertext (base64) of the v2 envelope.
 *     Without the passphrase this file cannot be restored — by design.
 * UA: Шифрує всі звіти локальної БД в один файл бекапу і тригерить його
 *     завантаження. У підсумковому `.json`:
 *       - метадані шифру (version, algo, kdf, hash, iterations, salt, iv),
 *       - ciphertext (base64) v2-конверта.
 *     Без пароля файл не відновити — це навмисне обмеження.
 * @param {string} passphrase
 * @returns {Promise<{ fileName: string, count: number }>}
 */
export async function exportEncryptedReports(passphrase) {
  const reports = await listReports();
  const payload = {
    kind: "uav-reports-export-v2",
    version: 2,
    exportedAt: new Date().toISOString(),
    reports,
  };
  const encrypted = await encryptJSON(payload, passphrase);
  downloadTextFile(JSON.stringify(encrypted, null, 2), EXPORT_FILE_NAME);
  return { fileName: EXPORT_FILE_NAME, count: reports.length };
}

/**
 * EN: Decrypts a .json backup file and merges the reports into the local DB.
 *     Returns counts that the UI shows to the user: how many were in DB
 *     before, how many were in the file, how many were freshly added (the
 *     rest are overwrites of existing ids), and the final DB size.
 * UA: Розшифровує `.json` файл бекапу і зливає звіти у локальну БД.
 *     Повертає лічильники, які UI показує користувачу: скільки було в БД до,
 *     скільки у файлі, скільки додано (решта — перезапис існуючих id),
 *     підсумковий розмір БД.
 * @param {File} file
 * @param {string} passphrase
 * @returns {Promise<{ before: number, imported: number, added: number, after: number }>}
 */
export async function importEncryptedReports(file, passphrase) {
  if (!(file instanceof File)) throw new Error("Файл не вибрано.");

  const fileText = await readFileAsText(file);
  let encryptedPayload;
  try {
    encryptedPayload = JSON.parse(fileText);
  } catch {
    throw new Error("Файл не є коректним JSON.");
  }

  // Decrypt
  let decrypted;
  try {
    decrypted = await decryptJSON(encryptedPayload, passphrase);
  } catch {
    throw new Error("Не вдалося розшифрувати файл. Перевірте ключ.");
  }

  // Parse & validate
  const importedReports = extractReportsArray(decrypted);

  // Merge with current DB
  const current = await listReports();
  const before = current.length;
  const merged = mergeReports(current, importedReports);
  const after = merged.length;

  // Persist
  await replaceAllReports(merged);

  return {
    before,
    imported: importedReports.length,
    added: after - before,
    after,
  };
}
