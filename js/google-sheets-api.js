/**
 * Apps Script Web App transport only (no direct Sheets API).
 * Uses no-cors-triggering headers to avoid preflight OPTIONS requests
 * that Apps Script cannot handle.
 * @module google-sheets-api
 */

import { STORAGE_KEY_DEVICE_ID } from "./constants.js";

/** Fetch timeout in milliseconds. */
const FETCH_TIMEOUT_MS = 30_000;

/**
 * @returns {string}
 */
function getDeviceIdForPayload() {
  try {
    let id = localStorage.getItem(STORAGE_KEY_DEVICE_ID);
    if (id && String(id).trim()) return String(id).trim();
    id = `dev_${crypto.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2, 12)}`}`;
    localStorage.setItem(STORAGE_KEY_DEVICE_ID, id);
    return id;
  } catch {
    return "dev_unknown";
  }
}

/**
 * Wrapper around fetch with AbortController timeout.
 * @param {string} url
 * @param {RequestInit} init
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {import("./report-model.js").Report} report
 * @param {import("./sync-settings.js").SyncIntegrationSettings} settings
 * @returns {Promise<{ ok: boolean, status?: number, error?: string, body?: unknown }>}
 */
/**
 * Відновлює рядок заголовків на листі (порожня таблиця або без report_id у рядку 1).
 * Викликати перед масовою чергою; старі деплої без prepare_sheet ігноруються.
 * @param {import("./sync-settings.js").SyncIntegrationSettings} settings
 * @returns {Promise<{ ok: boolean, skippedLegacy?: boolean, error?: string }>}
 */
export async function postPrepareSheet(settings) {
  const url = String(settings.appsScriptUrl || "").trim();
  if (!url) {
    return { ok: false, error: "Apps Script URL не задано." };
  }
  try {
    const res = await fetchWithTimeout(url, {
      method: "POST",
      body: JSON.stringify({
        action: "prepare_sheet",
        device_id: getDeviceIdForPayload(),
      }),
    });
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (!res.ok) {
      return {
        ok: false,
        error: (body && body.error) || res.statusText || "HTTP error",
      };
    }
    if (!body || typeof body !== "object") {
      return { ok: false, error: "Некоректна відповідь prepare_sheet (не JSON)." };
    }
    if (body.ok === true) {
      return { ok: true };
    }
    if (body.ok === false) {
      const err =
        typeof body.error === "string" ? body.error : "Помилка Apps Script.";
      if (/unknown action/i.test(err)) {
        return { ok: true, skippedLegacy: true };
      }
      return { ok: false, error: err };
    }
    return { ok: false, error: "Очікувалось ok: true у відповіді prepare_sheet." };
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      return { ok: false, error: "Таймаут запиту (30 сек)." };
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Test connection to the Apps Script web app (ping action).
 * @param {import("./sync-settings.js").SyncIntegrationSettings} settings
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function testAppsScriptConnection(settings) {
  const url = String(settings.appsScriptUrl || "").trim();
  if (!url) {
    return { ok: false, error: "Apps Script URL не задано." };
  }
  try {
    const res = await fetchWithTimeout(url, {
      method: "POST",
      body: JSON.stringify({
        action: "ping",
        device_id: getDeviceIdForPayload(),
      }),
    });
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (!res.ok) {
      return {
        ok: false,
        error: (body && body.error) || res.statusText || `HTTP ${res.status}`,
      };
    }
    if (body && body.ok === true) {
      return { ok: true };
    }
    return {
      ok: false,
      error: (body && body.error) || "Очікувалась відповідь ok: true.",
    };
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      return { ok: false, error: "Таймаут запиту (30 сек)." };
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function postUpsertReport(report, settings) {
  const url = String(settings.appsScriptUrl || "").trim();
  if (!url) {
    return { ok: false, error: "Apps Script URL не задано." };
  }

  const payload = {
    action: "upsert_report",
    device_id: getDeviceIdForPayload(),
    report: {
      report_id: report.id,
      version: report.version,
      sync_status: report.syncStatus,
      created_at: report.createdAt,
      updated_at: report.updatedAt,
      published_at: report.publishedAt,
      sheet_row_id: report.sheetRowId || null,
      fields: report.fields || {},
      report_text: report.text || "",
    },
  };

  try {
    const res = await fetchWithTimeout(url, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: (body && body.error) || res.statusText || "HTTP error",
        body,
      };
    }

    if (!body || typeof body !== "object") {
      return { ok: false, status: res.status, error: "Некоректна відповідь (не JSON)." };
    }

    if (body.ok === true) {
      return { ok: true, status: res.status, body };
    }

    return {
      ok: false,
      status: res.status,
      error: typeof body.error === "string" ? body.error : "Помилка Apps Script.",
      body,
    };
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      return { ok: false, error: "Таймаут запиту (30 сек)." };
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
  