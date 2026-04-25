/**
 * Google Sheets integration settings — typed wrapper over `settings-store`.
 *
 * EN:
 *   These settings are configured by the user on the Data screen and
 *   persist in IndexedDB (object store `settings`, key `sync_integration_v1`).
 *   Other modules read them through `loadSyncSettings()`.
 *
 *   Field meanings:
 *     googleSheetUrl           — link to the user's spreadsheet, used only
 *                                 for the "Open spreadsheet" UI link;
 *                                 actual writes never go through this URL.
 *     appsScriptUrl            — POST endpoint of the deployed Apps Script
 *                                 Web App. WITHOUT this URL the entire
 *                                 sync pipeline refuses to enqueue (see
 *                                 `report-actions.trySendReportNow`).
 *     sendMode                  — when a brand-new report should be sent:
 *                                 "manual"    = nothing happens until the
 *                                                user presses Send;
 *                                 "immediate" = enqueue right after save;
 *                                 "delayed"   = enqueue after
 *                                                `sendDelayMinutes`.
 *     sendDelayMinutes          — the delay used by "delayed" mode.
 *     lockAfterSend             — once a report is SENT, set `locked = true`
 *                                  so further edits go through the
 *                                  correction path (see
 *                                  `applyCorrectionAfterSent`). Recommended:
 *                                  ON.
 *     correctionsOnlyAfterSend  — when `lockAfterSend` is on AND this flag
 *                                  is on, the only way to edit a SENT
 *                                  report is via the corrections dialog
 *                                  (which keeps `report_id` stable in
 *                                  Sheets). When OFF, the user can fully
 *                                  re-edit a SENT report.
 *
 *   Why `_v1` in the key: a future schema change can introduce
 *   `sync_integration_v2` and silently reset old data without overwriting
 *   it — this is the same versioning convention as in `constants.js`.
 *
 * UA:
 *   Ці налаштування користувач задає на екрані «Дані» і зберігаються в
 *   IndexedDB (store `settings`, ключ `sync_integration_v1`). Інші модулі
 *   читають їх через `loadSyncSettings()`.
 *
 *   Значення полів:
 *     googleSheetUrl           — посилання на таблицю користувача, лише
 *                                 для UI-посилання «Відкрити таблицю»; запис
 *                                 фактично йде не через цю URL.
 *     appsScriptUrl            — POST-ендпоінт розгорнутого Apps Script
 *                                 Web App. БЕЗ цієї URL увесь конвеєр
 *                                 відмовляється ставити у чергу (див.
 *                                 `report-actions.trySendReportNow`).
 *     sendMode                  — коли надсилати щойно створений звіт:
 *                                 "manual"    = поки користувач не
 *                                                натисне «Надіслати»,
 *                                                нічого не відбувається;
 *                                 "immediate" = у чергу одразу після
 *                                                збереження;
 *                                 "delayed"   = у чергу через
 *                                                `sendDelayMinutes`.
 *     sendDelayMinutes          — затримка для режиму "delayed".
 *     lockAfterSend             — після SENT виставити `locked = true`,
 *                                  щоб подальші правки йшли через шлях
 *                                  виправлень (`applyCorrectionAfterSent`).
 *                                  Рекомендовано УВІМКНУТИ.
 *     correctionsOnlyAfterSend  — коли `lockAfterSend` увімк. і цей прапор
 *                                  теж увімк., єдиний спосіб правити SENT
 *                                  звіт — через діалог виправлень (що
 *                                  тримає `report_id` стабільним у Sheets).
 *                                  Коли вимкнено — користувач може повністю
 *                                  передагувати SENT.
 *
 *   Чому `_v1` у ключі: майбутня зміна схеми може ввести
 *   `sync_integration_v2` і тихо скинути старі дані без перезапису — та
 *   сама конвенція версіонування, що й у `constants.js`.
 *
 * @module sync-settings
 */

import { getSetting, setSetting } from "./settings-store.js";

/** EN: settings-store key under which the whole settings object is saved. UA: ключ у settings-store, під яким лежить увесь об’єкт. */
const KEY = "sync_integration_v1";

/**
 * @typedef {Object} SyncIntegrationSettings
 * @property {string} googleSheetUrl — EN: spreadsheet URL (UI link only). UA: URL таблиці (лише UI-посилання).
 * @property {string} appsScriptUrl — EN: Apps Script Web App POST URL. UA: POST URL Apps Script Web App.
 * @property {"manual"|"immediate"|"delayed"} sendMode — EN: when to send a new report. UA: коли надсилати новий звіт.
 * @property {number} sendDelayMinutes — EN: delay in minutes for "delayed" mode. UA: затримка у хвилинах для "delayed".
 * @property {boolean} lockAfterSend — EN: lock SENT reports from full edit. UA: блокувати повну правку після SENT.
 * @property {boolean} correctionsOnlyAfterSend — EN: edits after SENT only via correction flow. UA: правки після SENT — лише через діалог виправлень.
 */

/**
 * EN: Returns the built-in defaults — used when nothing is stored yet or
 *     when the user presses "Reset to defaults" on the Data screen.
 * UA: Повертає вбудовані типові значення — використовуються, коли нічого
 *     ще не збережено або користувач натиснув «Скинути до типових».
 * @returns {SyncIntegrationSettings}
 */
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
 * EN: Loads settings from IndexedDB and "fills the gaps" from defaults.
 *     This way a partial / outdated stored object never leaves an
 *     undefined field — every consumer can rely on a fully-shaped result.
 * UA: Завантажує налаштування з IndexedDB і "забиває діри" значеннями за
 *     замовчуванням. Так частковий / застарілий збережений обʼєкт ніколи
 *     не дає `undefined` у полі — кожен споживач отримує повну форму.
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
 * EN: Merges a partial patch over the currently saved settings and writes
 *     the result back. Returns the new full object so the UI can refresh
 *     its inputs without a second read.
 * UA: Зливає частковий patch над поточно збереженими налаштуваннями і
 *     пише результат назад. Повертає повний обʼєкт — щоб UI міг оновити
 *     поля без другого читання.
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
 * EN: Light URL validator — accepts any well-formed http(s) URL. We do NOT
 *     restrict to script.google.com because some users front the script
 *     with a custom proxy or short-link service.
 * UA: Легкий валідатор URL — приймає будь-який коректний http(s).
 *     На script.google.com не обмежуємо: дехто ставить перед скриптом
 *     проксі або короткий лінк.
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
