/**
 * Імпорт зашифрованого архіву v1 (`kind: uav-reports-export`): лише id, ts, text.
 * Текст збирається тим самим шаблоном, що й buildReportText() у report-format.js.
 * @module crypto/legacy-import
 */

import { STREAM_PLACEHOLDER } from "../constants.js";
import { emptyFields, normalizeFields, buildReportText } from "../report-format.js";
import { generateReportId, SYNC_STATUS } from "../report-model.js";

/** @type {string} */
export const LEGACY_EXPORT_KIND = "uav-reports-export";

const PREFIX_DRONE = "Борт:";
const PREFIX_MISSION = "Характер:";
const PREFIX_TAKEOFF = "Час зльоту:";
const PREFIX_IMPACT = "Час ураження/втрати:";
const PREFIX_COORDS = "Координати:";
const PREFIX_AMMO = "Боєприпас:";
const PREFIX_STREAM = "Стрім:";
const PREFIX_RESULT = "Результат:";

/**
 * @param {string} line
 * @param {string} prefix
 * @returns {string}
 */
function valueAfterPrefix_(line, prefix) {
  const s = String(line || "");
  if (!s.startsWith(prefix)) return "";
  return s.slice(prefix.length).trim();
}

/**
 * @param {string[]} lines
 * @param {string} prefix
 * @returns {string}
 */
function firstLineValue_(lines, prefix) {
  for (const line of lines) {
    if (line.startsWith(prefix)) return valueAfterPrefix_(line, prefix);
  }
  return "";
}

/**
 * DD.MM.YYYY → YYYY-MM-DD
 * @param {string} raw
 * @returns {string}
 */
function ddmmyyyyToIso_(raw) {
  const s = String(raw || "").trim();
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return "";
  const dd = String(parseInt(m[1], 10)).padStart(2, "0");
  const mm = String(parseInt(m[2], 10)).padStart(2, "0");
  return `${m[3]}-${mm}-${dd}`;
}

/**
 * Перший рядок: «Екіпаж» або «Екіпаж (N)».
 * @param {string} raw
 * @returns {{ crew: string, crewCounter: number|null }}
 */
function parseCrewLine_(raw) {
  const line = String(raw || "").trim();
  if (!line) return { crew: "", crewCounter: null };
  const m = line.match(/^(.+?)\s*\((\d+)\)\s*$/);
  if (m) {
    const n = Number(m[2]);
    return {
      crew: m[1].trim(),
      crewCounter: Number.isFinite(n) ? Math.floor(n) : null,
    };
  }
  return { crew: line, crewCounter: null };
}

/**
 * Розбирає текст v1 у поля. Якщо шаблон не збігається — мінімально валідні поля + увесь текст у «результаті».
 * @param {string} rawText
 * @returns {import("../report-format.js").ReportFields}
 */
export function parseLegacyExportTextToFields(rawText) {
  const normalized = String(rawText || "").replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines.length < 2) {
    const f = emptyFields();
    f.result = normalized.trim();
    return normalizeFields(f);
  }

  const crewPart = parseCrewLine_(lines[0]);
  const dateIso = ddmmyyyyToIso_(lines[1]);
  const rest = lines.slice(2);

  const drone = firstLineValue_(rest, PREFIX_DRONE);
  const missionType = firstLineValue_(rest, PREFIX_MISSION);
  const takeoff = firstLineValue_(rest, PREFIX_TAKEOFF);
  const impact = firstLineValue_(rest, PREFIX_IMPACT);
  const coords = firstLineValue_(rest, PREFIX_COORDS);
  const ammo = firstLineValue_(rest, PREFIX_AMMO);
  let stream = firstLineValue_(rest, PREFIX_STREAM);
  const result = firstLineValue_(rest, PREFIX_RESULT);

  const hasStructure =
    drone ||
    missionType ||
    takeoff ||
    impact ||
    coords ||
    ammo ||
    stream ||
    result;

  if (!hasStructure) {
    const f = emptyFields();
    f.crew = crewPart.crew;
    f.crewCounter = crewPart.crewCounter;
    f.date = dateIso;
    f.result = normalized.trim();
    return normalizeFields(f);
  }

  if (!stream) stream = STREAM_PLACEHOLDER;

  return normalizeFields({
    crew: crewPart.crew,
    crewCounter: crewPart.crewCounter,
    date: dateIso,
    drone,
    missionType,
    takeoff,
    impact,
    coords,
    ammo,
    stream,
    result,
  });
}

/**
 * Запис v1: є непорожній `text`, немає структурованих `fields` і немає `createdAt` (як у звіті v2).
 * @param {unknown} item
 * @returns {boolean}
 */
export function isLegacyReportItemShape(item) {
  if (!item || typeof item !== "object") return false;
  const o = /** @type {Record<string, unknown>} */ (item);
  if (typeof o.text !== "string" || !String(o.text).trim()) return false;
  if (o.fields && typeof o.fields === "object") return false;
  if (typeof o.createdAt === "string" && o.createdAt.trim()) return false;
  return true;
}

/**
 * @param {unknown} payload
 * @returns {boolean}
 */
export function isLegacyEncryptedExport(payload) {
  if (!payload || typeof payload !== "object") return false;
  const p = /** @type {Record<string, unknown>} */ (payload);
  return p.kind === LEGACY_EXPORT_KIND && Array.isArray(p.reports);
}

/**
 * Масив звітів без поля `kind` або з «кривим» kind, але зі структурою v1.
 * @param {unknown} payload
 * @returns {boolean}
 */
export function isLegacyExportByReportShapes(payload) {
  if (!payload || typeof payload !== "object") return false;
  const p = /** @type {Record<string, unknown>} */ (payload);
  if (!Array.isArray(p.reports) || p.reports.length === 0) return false;
  return p.reports.every(isLegacyReportItemShape);
}

/**
 * @param {unknown} item
 * @returns {import("../report-model.js").Report|null}
 */
function legacyItemToReport_(item) {
  if (!item || typeof item !== "object") return null;
  const o = /** @type {Record<string, unknown>} */ (item);
  if (typeof o.text !== "string" || !String(o.text).trim()) return null;

  const id =
    typeof o.id === "string" && o.id.trim() ? String(o.id).trim() : generateReportId();
  const tsRaw = typeof o.ts === "string" && o.ts.trim() ? String(o.ts).trim() : "";
  const ts = tsRaw || new Date().toISOString();

  const fields = parseLegacyExportTextToFields(o.text);
  const text = buildReportText(fields);

  return {
    id,
    createdAt: ts,
    updatedAt: ts,
    publishedAt: null,
    version: 1,
    syncStatus: SYNC_STATUS.DRAFT,
    locked: false,
    sendAfter: null,
    sheetRowId: null,
    fields,
    text,
  };
}

/**
 * @param {unknown[]} reports
 * @returns {import("../report-model.js").Report[]}
 */
export function legacyReportItemsToReports(reports) {
  const out = [];
  for (const item of reports) {
    const r = legacyItemToReport_(item);
    if (r) out.push(r);
  }
  return out;
}

/**
 * @param {unknown} payload
 * @returns {import("../report-model.js").Report[]}
 */
export function legacyEncryptedExportToReports(payload) {
  const p =
    payload && typeof payload === "object"
      ? /** @type {{ reports?: unknown[] }} */ (payload)
      : null;
  const list = Array.isArray(p?.reports) ? p.reports : [];
  const out = legacyReportItemsToReports(list);
  if (!out.length) {
    throw new Error("У файлі немає коректних записів старого формату.");
  }
  return out;
}
