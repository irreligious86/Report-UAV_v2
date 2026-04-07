/**
 * Domain model: Report entity, ids, status transitions.
 * Text is always derived from fields via report-format.buildReportText.
 * @module report-model
 */

import { buildReportText, normalizeFields, emptyFields } from "./report-format.js";

export { emptyFields, normalizeFields, buildReportText };

/** @readonly */
export const SYNC_STATUS = Object.freeze({
  DRAFT: "draft",
  SCHEDULED: "scheduled",
  QUEUED: "queued",
  SENDING: "sending",
  SENT: "sent",
  RESYNC_REQUIRED: "resync_required",
  ERROR: "error",
  LOCKED: "locked",
});

/**
 * @typedef {import("./report-format.js").ReportFields} ReportFields
 */

/**
 * @typedef {Object} Report
 * @property {string} id
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {string|null} publishedAt
 * @property {number} version
 * @property {string} syncStatus
 * @property {boolean} locked
 * @property {string|null} sendAfter
 * @property {string|null} sheetRowId
 * @property {ReportFields} fields
 * @property {string} text
 */

/**
 * @returns {string}
 */
export function generateReportId() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const datePart = `${y}${m}${day}`;
  let rnd = "";
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const a = new Uint8Array(4);
    crypto.getRandomValues(a);
    rnd = Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
  } else {
    rnd = Math.random().toString(16).slice(2, 10).padEnd(8, "0");
  }
  return `rpt_${datePart}_${rnd}`;
}

/**
 * @param {ReportFields} fields
 * @param {object} [opt]
 * @param {string} [opt.id]
 * @param {string} [opt.syncStatus]
 * @param {string|null} [opt.sendAfter]
 * @returns {Report}
 */
export function createReport(fields, opt = {}) {
  const now = new Date().toISOString();
  const f = normalizeFields(fields);
  const text = buildReportText(f);
  return {
    id: opt.id?.trim() || generateReportId(),
    createdAt: now,
    updatedAt: now,
    publishedAt: null,
    version: 1,
    syncStatus: opt.syncStatus || SYNC_STATUS.DRAFT,
    locked: false,
    sendAfter: opt.sendAfter ?? null,
    sheetRowId: null,
    fields: f,
    text,
  };
}

/**
 * Rebuilds text from fields and bumps version.
 * @param {Report} r
 * @param {ReportFields} nextFields
 * @param {object} [extra]
 * @param {string} [extra.syncStatus]
 * @param {boolean} [extra.locked]
 * @param {string|null} [extra.publishedAt]
 * @param {string|null} [extra.sendAfter]
 * @param {string|null} [extra.sheetRowId]
 * @returns {Report}
 */
export function applyFieldsUpdate(r, nextFields, extra = {}) {
  const f = normalizeFields(nextFields);
  const text = buildReportText(f);
  const now = new Date().toISOString();
  return {
    ...r,
    fields: f,
    text,
    updatedAt: now,
    version: (r.version || 1) + 1,
    syncStatus: extra.syncStatus ?? r.syncStatus,
    locked: extra.locked ?? r.locked,
    publishedAt: extra.publishedAt !== undefined ? extra.publishedAt : r.publishedAt,
    sendAfter: extra.sendAfter !== undefined ? extra.sendAfter : r.sendAfter,
    sheetRowId: extra.sheetRowId !== undefined ? extra.sheetRowId : r.sheetRowId,
  };
}

/**
 * @param {Report} r
 * @param {object} patch
 * @returns {Report}
 */
export function patchReportMeta(r, patch) {
  return {
    ...r,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
}
