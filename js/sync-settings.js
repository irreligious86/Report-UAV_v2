/**
 * Google Sheets / sync integration settings (stored via settings-store).
 * @module sync-settings
 */

import { getSetting, setSetting } from "./settings-store.js";

const KEY = "sync_integration_v1";

/**
 * @typedef {Object} SyncIntegrationSettings
 * @property {string} googleSheetUrl
 * @property {string} appsScriptUrl
 * @property {"manual"|"immediate"|"delayed"} sendMode
 * @property {number} sendDelayMinutes
 * @property {boolean} lockAfterSend
 * @property {boolean} correctionsOnlyAfterSend
 */

/** @returns {SyncIntegrationSettings} */
export function getDefaultSyncSettings() {
  return {
    googleSheetUrl: "",
    appsScriptUrl: "",
    sendMode: "manual",
    sendDelayMinutes: 60,
    lockAfterSend: true,
    correctionsOnlyAfterSend: true,
  };
}

/**
 * @returns {Promise<SyncIntegrationSettings>}
 */
export async function loadSyncSettings() {
  const raw = await getSetting(KEY);
  if (!raw || typeof raw !== "object") return getDefaultSyncSettings();
  const d = getDefaultSyncSettings();
  return {
    googleSheetUrl: typeof raw.googleSheetUrl === "string" ? raw.googleSheetUrl : d.googleSheetUrl,
    appsScriptUrl: typeof raw.appsScriptUrl === "string" ? raw.appsScriptUrl : d.appsScriptUrl,
    sendMode:
      raw.sendMode === "immediate" || raw.sendMode === "delayed" || raw.sendMode === "manual"
        ? raw.sendMode
        : d.sendMode,
    sendDelayMinutes:
      typeof raw.sendDelayMinutes === "number" && raw.sendDelayMinutes >= 0
        ? Math.floor(raw.sendDelayMinutes)
        : d.sendDelayMinutes,
    lockAfterSend: typeof raw.lockAfterSend === "boolean" ? raw.lockAfterSend : d.lockAfterSend,
    correctionsOnlyAfterSend:
      typeof raw.correctionsOnlyAfterSend === "boolean"
        ? raw.correctionsOnlyAfterSend
        : d.correctionsOnlyAfterSend,
  };
}

/**
 * @param {Partial<SyncIntegrationSettings>} patch
 * @returns {Promise<SyncIntegrationSettings>}
 */
export async function saveSyncSettings(patch) {
  const cur = await loadSyncSettings();
  const next = { ...cur, ...patch };
  await setSetting(KEY, next);
  return next;
}

/**
 * @param {string} url
 * @returns {boolean}
 */
export function validateAppsScriptUrl(url) {
  const s = String(url || "").trim();
  if (!s) return false;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}
