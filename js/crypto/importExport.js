/**
 * Encrypted export / import for Report UAV v2 (IndexedDB).
 *
 * Export: serialises all reports → encrypts with AES-GCM → downloads .json file.
 * Import: reads .json file → decrypts → validates → merges with existing DB →
 *         replaces all records (newest-wins by id, capped at REPORTS_LIMIT).
 *
 * Legacy v1 archives (kind: "uav-reports-export", plain id/ts/text shape) are
 * also accepted on import — conversion is handled by legacy-import.js.
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

const EXPORT_FILE_NAME = "uav_reports_v2.enc.json";

// ─────────────────────────────────────────────────────────────────────────────
// Validation helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal structural check — does not validate field contents.
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
 * Coerce a raw object into a Report: re-normalise fields, rebuild text.
 * Returns null if the item fails validation.
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
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract a list of Report objects from a decrypted payload.
 * Accepts: legacy-v1 shape, plain array, or v2 {reports:[…]} envelope.
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
// Merge strategy: newest-wins by id, sorted by createdAt, capped at limit
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Merge current DB reports with imported ones.
 * Imported records overwrite existing records with the same id.
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
// ─────────────────────────────────────────────────────────────────────────────

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

/** @param {File} file @returns {Promise<string>} */
function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Не вдалося прочитати файл."));
    reader.readAsText(file);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Encrypt all reports and trigger a .json file download.
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
 * Decrypt a .json file and merge the reports into the local DB.
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
