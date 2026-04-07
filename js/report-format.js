/**
 * Report field formatting: form collection, canonical text, time helpers for filters/map.
 * No legacy text parsing — fields are the source of truth.
 * @module report-format
 */

import { STREAM_PLACEHOLDER } from "./constants.js";
import { $, isoToDDMMYYYY } from "./utils.js";
import { parseCounterRaw } from "./counter.js";
import { buildCoordsOrError } from "./coords.js";

/**
 * @typedef {Object} ReportFields
 * @property {string} crew
 * @property {number|null} crewCounter
 * @property {string} date — YYYY-MM-DD
 * @property {string} drone
 * @property {string} missionType
 * @property {string} takeoff
 * @property {string} impact
 * @property {string} coords
 * @property {string} ammo
 * @property {string} stream
 * @property {string} result
 */

/**
 * @returns {ReportFields}
 */
export function emptyFields() {
  return {
    crew: "",
    crewCounter: null,
    date: "",
    drone: "",
    missionType: "",
    takeoff: "",
    impact: "",
    coords: "",
    ammo: "",
    stream: "",
    result: "",
  };
}

/**
 * @param {unknown} fields
 * @returns {ReportFields}
 */
export function normalizeFields(fields) {
  const f =
    fields && typeof fields === "object" && !Array.isArray(fields) ? fields : {};
  const crew = typeof f.crew === "string" ? f.crew.trim() : "";
  let crewCounter = null;
  if (f.crewCounter != null && f.crewCounter !== "") {
    const n = Number(f.crewCounter);
    crewCounter = Number.isFinite(n) ? Math.floor(n) : null;
  }
  return {
    crew,
    crewCounter,
    date: typeof f.date === "string" ? f.date.trim() : "",
    drone: typeof f.drone === "string" ? f.drone.trim() : "",
    missionType: typeof f.missionType === "string" ? f.missionType.trim() : "",
    takeoff: typeof f.takeoff === "string" ? f.takeoff.trim() : "",
    impact: typeof f.impact === "string" ? f.impact.trim() : "",
    coords: typeof f.coords === "string" ? f.coords.trim() : "",
    ammo: typeof f.ammo === "string" ? f.ammo.trim() : "",
    stream:
      typeof f.stream === "string"
        ? (f.stream.trim() || STREAM_PLACEHOLDER)
        : STREAM_PLACEHOLDER,
    result: typeof f.result === "string" ? f.result.trim() : "",
  };
}

/**
 * Canonical multi-line report text from structured fields.
 * @param {ReportFields} fields
 * @returns {string}
 */
export function buildReportText(fields) {
  const f = normalizeFields(fields);
  const crewLine =
    f.crewCounter != null ? `${f.crew} (${f.crewCounter})` : f.crew || "";
  const dateHuman = f.date ? isoToDDMMYYYY(f.date) : "";
  const stream = f.stream || STREAM_PLACEHOLDER;
  return `${crewLine}\n${dateHuman}\nБорт: ${f.drone}\nХарактер: ${f.missionType}\nЧас зльоту: ${f.takeoff}\nЧас ураження/втрати: ${f.impact}\nКоординати: ${f.coords}\nБоєприпас: ${f.ammo}\nСтрім: ${stream}\nРезультат: ${f.result}`;
}

/**
 * Reads main form into fields. Returns null if coords invalid.
 * @returns {ReportFields|null}
 */
export function collectFieldsFromMainForm() {
  if ($("crew").value === "") $("crew").value = "Дакар";
  const coords = buildCoordsOrError();
  if (!coords) return null;

  const parsedCounter = parseCounterRaw($("crewCounter").value);
  return {
    crew: $("crew").value.trim() || "",
    crewCounter: parsedCounter.empty ? null : parsedCounter.value,
    date: ($("datePicker").value || "").trim(),
    drone: $("drone").value || "",
    missionType: $("missionType").value || "",
    takeoff: $("takeoff").value || "",
    impact: $("impact").value || "",
    coords,
    ammo: $("ammo").value || "",
    stream: $("stream").value || STREAM_PLACEHOLDER,
    result: $("result").value || "",
  };
}

function normalizeDateToISOField(dateStr) {
  const s = String(dateStr || "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return "";
  const dd = String(parseInt(m[1], 10)).padStart(2, "0");
  const mm = String(parseInt(m[2], 10)).padStart(2, "0");
  return `${m[3]}-${mm}-${dd}`;
}

function combineDateTimeField(dateStr, timeStr) {
  if (!dateStr) return null;
  const dt = new Date(`${dateStr}T${timeStr || "00:00"}`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/**
 * Mission impact instant (ms) for filtering — structured fields only.
 * @param {ReportFields} fields
 * @returns {number|null}
 */
export function getImpactTimestampMs(fields) {
  const f = normalizeFields(fields);
  const iso = normalizeDateToISOField(f.date || "");
  const time = String(f.impact || "").trim();
  if (!iso || !time) return null;
  const dt = combineDateTimeField(iso, time);
  if (!dt) return null;
  const ms = dt.getTime();
  return Number.isNaN(ms) ? null : ms;
}
