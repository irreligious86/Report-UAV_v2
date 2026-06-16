/**
 * Google Sheets transport — single POST endpoint to a user-deployed Apps
 * Script Web App.
 *
 * EN:
 *   This module is the only place in the app that talks HTTP to Google.
 *   We do NOT use Google's REST APIs directly — instead the user deploys a
 *   small Apps Script Web App (see `docs/apps-script/Code.gs`) that has
 *   permission to write into THEIR spreadsheet, and we POST JSON to its URL.
 *
 *   Why Apps Script (and not the Sheets REST API)?
 *     - No OAuth flow inside the PWA — the user does the auth once when
 *       deploying the script.
 *     - The script can use the spreadsheet *it is bound to*, with no
 *       application-wide credentials.
 *     - It runs on Google's side, so a write inside the script costs zero
 *       requests against any of our quotas.
 *
 *   CORS / no preflight:
 *     We send `fetch(url, { method: "POST", body: JSON.stringify(...) })`
 *     WITHOUT setting `Content-Type: application/json`. The browser then
 *     uses a "simple" Content-Type and skips the OPTIONS preflight, which
 *     Apps Script Web Apps cannot answer correctly. The server still parses
 *     the body as JSON because it inspects `e.postData.contents` itself.
 *
 *   Three POST actions are supported (the request body always contains
 *   `action`, `device_id`, plus action-specific fields):
 *
 *     1) action: "ping"            — health check. Used by "Перевірити
 *                                     з'єднання" on the Data screen.
 *                                     Response: `{ ok: true }`.
 *
 *     2) action: "prepare_sheet"   — make sure the spreadsheet has the
 *                                     header row and the report_id column.
 *                                     Called once before bulk sends and
 *                                     before single sends. Old script
 *                                     deployments without this action
 *                                     respond `{ ok: false, error: "unknown
 *                                     action" }` and we treat that as
 *                                     successful "skip" (`skippedLegacy`).
 *
 *     3) action: "upsert_report"   — write or replace a row by `report_id`.
 *                                     Payload includes structured `fields`,
 *                                     a `report_text` view, sync metadata
 *                                     and an optional `sheet_row_id` echo.
 *                                     Server returns `{ ok: true,
 *                                     sheet_row_id }`. We persist that id
 *                                     so the next upsert can target the
 *                                     same row even if the user reordered
 *                                     the sheet.
 *
 *   Every request has a 30-second AbortController timeout — Apps Script
 *   sometimes hangs cold-starts and we don't want the queue to stall on
 *   one stuck POST.
 *
 * UA:
 *   Цей модуль — єдине місце у застосунку, що ходить HTTP до Google. Ми
 *   НЕ використовуємо REST API Sheets напряму — користувач розгортає
 *   маленький Apps Script Web App (див. `docs/apps-script/Code.gs`), який
 *   має права писати у ЙОГО таблицю, а ми POST-имо JSON на його URL.
 *
 *   Чому саме Apps Script (а не Sheets REST API)?
 *     - У PWA не потрібен OAuth — користувач один раз авторизує скрипт
 *       при розгортанні.
 *     - Скрипт використовує таблицю, до якої «прив’язаний», без
 *       глобальних креденшелів застосунку.
 *     - Запис відбувається на стороні Google, тож не споживає квоти
 *       застосунку.
 *
 *   CORS / без preflight:
 *     Ми робимо `fetch(url, { method: "POST", body: JSON.stringify(...) })`
 *     БЕЗ `Content-Type: application/json`. Тоді браузер використовує
 *     «простий» Content-Type і не робить OPTIONS-preflight, на який Apps
 *     Script Web App не вміє коректно відповісти. На сервері тіло все
 *     одно парситься як JSON через `e.postData.contents`.
 *
 *   Підтримуються три POST-дії (у тілі завжди `action`, `device_id` і
 *   специфічні для дії поля):
 *
 *     1) action: "ping"            — перевірка з’єднання, кнопка
 *                                     «Перевірити з’єднання» на екрані
 *                                     «Дані». Очікувана відповідь —
 *                                     `{ ok: true }`.
 *
 *     2) action: "prepare_sheet"   — переконатися, що в таблиці є рядок
 *                                     заголовків і колонка report_id.
 *                                     Викликається перед масовою та
 *                                     одиночною відправкою. Старі
 *                                     розгортання без цієї дії віддадуть
 *                                     `{ ok: false, error: "unknown
 *                                     action" }` — ми трактуємо це як
 *                                     успішний «пропуск» (`skippedLegacy`).
 *
 *     3) action: "upsert_report"   — записати або оновити рядок за
 *                                     `report_id`. У payload — структурні
 *                                     `fields`, текстовий вигляд
 *                                     `report_text`, метадані синхронізації
 *                                     і необов’язковий `sheet_row_id`.
 *                                     Сервер повертає `{ ok: true,
 *                                     sheet_row_id }`. Ми зберігаємо
 *                                     повернутий id рядка, щоб наступний
 *                                     upsert цілився саме у нього навіть
 *                                     якщо користувач переставив рядки.
 *
 *   Кожен запит має 30-секундний AbortController-таймаут — Apps Script
 *   іноді «прокидається» довго, ми не хочемо, щоб черга зависла на одному
 *   POST.
 *
 * @module google-sheets-api
 */

import { STORAGE_KEY_DEVICE_ID } from "./constants.js";

/** EN: Per-request timeout (ms). UA: Таймаут на один запит (мс). */
const FETCH_TIMEOUT_MS = 30_000;

/**
 * EN: Returns a stable per-browser id sent in every payload (`device_id`).
 *     The first call generates and stores it in localStorage; subsequent
 *     calls return the same value. The server uses it for diagnostics and
 *     can de-duplicate / blacklist a device. If localStorage is unavailable
 *     (privacy mode, etc.) we fall back to "dev_unknown" so the request
 *     still succeeds — the script does not require a real id.
 * UA: Повертає стабільний для браузера id, який ми кладемо у кожен запит
 *     (`device_id`). Перший виклик генерує і зберігає його в localStorage;
 *     наступні виклики повертають те саме значення. Сервер використовує
 *     його для діагностики, дедуплікації або «чорного списку». Якщо
 *     localStorage недоступний (приватний режим і т.п.) — повертаємо
 *     "dev_unknown", запит все одно успішний.
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
 * EN: `fetch` with an AbortController-based timeout. Aborts after
 *     {@link FETCH_TIMEOUT_MS}; the rejection then surfaces as
 *     `DOMException name === "AbortError"` in the callers, which translate
 *     it to a user-friendly "Таймаут запиту (30 сек)" message.
 * UA: `fetch` із таймаутом на основі AbortController. Перериває запит
 *     через {@link FETCH_TIMEOUT_MS}; помилка приходить як
 *     `DOMException name === "AbortError"` і вище конвертується у
 *     повідомлення «Таймаут запиту (30 сек)».
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
 * EN: Sends `action: "prepare_sheet"` so the script ensures the spreadsheet
 *     has a header row and a `report_id` column. Called before bulk and
 *     single sends. Old script deployments that don't know this action
 *     respond with `unknown action` — we map that to `{ ok: true,
 *     skippedLegacy: true }` so the rest of the flow proceeds. Errors here
 *     never block the actual upsert: if prepare fails for any other reason,
 *     the upsert may still succeed if the headers are already there.
 * UA: Надсилає `action: "prepare_sheet"` — скрипт повинен переконатись, що
 *     в таблиці є рядок заголовків і колонка `report_id`. Викликається
 *     перед масовою та одиночною відправкою. Старі розгортання, які не
 *     знають цієї дії, повертають `unknown action` — ми перекладаємо це у
 *     `{ ok: true, skippedLegacy: true }`, щоб потік не зупинявся. Помилка
 *     prepare ніколи не блокує сам upsert: якщо заголовки вже є, upsert
 *     спрацює.
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
 * EN: Pings the Apps Script Web App. Used by the "Перевірити з'єднання"
 *     button on the Data screen. Resolves only when the server responds
 *     with `{ ok: true }`. Any timeout, HTTP error or non-`ok: true` JSON
 *     yields `{ ok: false, error }` so the UI shows a precise reason.
 * UA: Робить ping у Apps Script Web App. Викликає кнопка
 *     «Перевірити з'єднання» на екрані «Дані». Розв’язується успішно,
 *     лише якщо сервер відповів `{ ok: true }`. Таймаут, HTTP-помилка або
 *     не-`ok: true` JSON — повертає `{ ok: false, error }`, щоб UI показав
 *     точну причину.
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

/**
 * EN: Sends `action: "upsert_report"` — the workhorse. Called once per queue
 *     drain iteration by `sync-queue-processor.processOneQueueItem`.
 *
 *     Payload shape (must match `docs/apps-script/Code.gs`):
 *       action      = "upsert_report"
 *       device_id   = stable device id (see `getDeviceIdForPayload`)
 *       report.report_id      = stable report id (rpt_YYYYMMDD_XXXXXXXX)
 *       report.version        = monotonic; bumps on every `applyFieldsUpdate`
 *       report.sync_status    = current syncStatus string ("queued",
 *                               "sent", etc.) — informational
 *       report.created_at     = ISO time of original creation
 *       report.updated_at     = ISO time of last fields update
 *       report.published_at   = ISO time of last successful POST, or null
 *       report.sheet_row_id   = the id of the row in the spreadsheet, if
 *                               we received one earlier; lets the script
 *                               find a renamed/reordered row faster
 *       report.fields         = structured fields (crew, drone, …)
 *       report.report_text    = canonical text view (server may store both)
 *
 *     Result handling:
 *       - HTTP non-2xx                 → `{ ok: false, status, error }`.
 *       - Non-JSON / no `ok` field     → `{ ok: false, error }`.
 *       - `body.ok === true`           → `{ ok: true, body }`. The processor
 *                                         will read `body.sheet_row_id` and
 *                                         persist it on the report.
 *       - `body.ok === false`          → `{ ok: false, error: body.error }`.
 *
 * UA: Надсилає `action: "upsert_report"` — головний "робочий" виклик.
 *     Викликається обробником черги (`sync-queue-processor`).
 *
 *     Структура payload (має збігатися з `docs/apps-script/Code.gs`):
 *       action      = "upsert_report"
 *       device_id   = стабільний id пристрою
 *       report.report_id      = стабільний id звіту (rpt_YYYYMMDD_XXXXXXXX)
 *       report.version        = монотонна; росте на кожен `applyFieldsUpdate`
 *       report.sync_status    = поточний syncStatus ("queued", "sent" тощо),
 *                               інформаційно
 *       report.created_at     = ISO час створення
 *       report.updated_at     = ISO час останнього редагування полів
 *       report.published_at   = ISO час останнього успішного POST або null
 *       report.sheet_row_id   = id рядка у таблиці, якщо ми його вже
 *                               отримували; дозволяє скрипту швидше
 *                               знайти переставлений / перейменований рядок
 *       report.fields         = структуровані поля (crew, drone, …)
 *       report.report_text    = канонічний текстовий вигляд (сервер може
 *                               зберігати обидва представлення)
 *
 *     Обробка відповіді:
 *       - HTTP не-2xx                  → `{ ok: false, status, error }`.
 *       - Не-JSON / без поля `ok`      → `{ ok: false, error }`.
 *       - `body.ok === true`           → `{ ok: true, body }`. Обробник
 *                                         читає `body.sheet_row_id` і
 *                                         зберігає його у звіті.
 *       - `body.ok === false`          → `{ ok: false, error: body.error }`.
 *
 * @param {import("./report-model.js").Report} report
 * @param {import("./sync-settings.js").SyncIntegrationSettings} settings
 * @returns {Promise<{ ok: boolean, status?: number, error?: string, body?: unknown }>}
 */
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
  