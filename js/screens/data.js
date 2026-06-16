/**
 * Data & integration screen — three independent sections in one place.
 *
 * EN:
 *   Originally these features were scattered between the journal and the
 *   settings screen. They were extracted here so all "data transfer"
 *   concerns are reachable from a single tab.
 *
 *   Sections:
 *     1) Google Sheets / Apps Script integration form
 *        - Spreadsheet URL (UI link only — actual writes go to the script).
 *        - Apps Script Web App URL (validated by `validateAppsScriptUrl`).
 *        - Send mode: manual / immediate / delayed; delay minutes.
 *        - "Lock after send" + "Corrections only after send" — these
 *          control how SENT reports can be edited (full edit vs.
 *          correction flow).
 *        - "Test connection" → `testAppsScriptConnection` (ping action).
 *        - "Save" → persists to IDB via `sync-settings.saveSyncSettings`.
 *        - "Reset" → `getDefaultSyncSettings` + re-bind.
 *
 *     2) Encrypted backup — export / import
 *        - Export: prompts for a passphrase TWICE (no recovery — typo
 *          protection), encrypts via `crypto/importExport`, triggers a
 *          file download.
 *        - Import: lets the user pick a `.json` file, prompts for the
 *          passphrase, decrypts, merges into the local DB (newest-wins
 *          by id), notifies UI to refresh.
 *
 *     3) Danger zone — "Delete all reports"
 *        - Confirms, calls `report-actions.deleteAllReports`, fires
 *          `reportsChanged` so the journal reloads.
 *        - Does NOT touch the spreadsheet on Google's side.
 *
 * UA:
 *   Раніше ці три речі були розкидані по журналу та налаштуваннях. Тут
 *   все звʼязано з «передачею даних» лежить в одній вкладці.
 *
 *   Розділи:
 *     1) Google Sheets / Apps Script
 *        - URL таблиці (лише UI-посилання — запис фактично йде у скрипт).
 *        - URL Apps Script Web App (валідація — `validateAppsScriptUrl`).
 *        - Режим відправки: manual / immediate / delayed; затримка в хв.
 *        - «Lock after send» + «Corrections only after send» — задають
 *          поведінку редагування SENT-звітів (повна правка vs. виправлення).
 *        - «Перевірити з’єднання» → `testAppsScriptConnection` (ping).
 *        - «Зберегти» → пише у IDB через `sync-settings.saveSyncSettings`.
 *        - «Скинути» → `getDefaultSyncSettings` + повторний bind.
 *
 *     2) Зашифрований бекап — експорт / імпорт
 *        - Експорт: запитує пароль ДВІЧІ (немає відновлення — захист
 *          від друкарських помилок), шифрує через `crypto/importExport`,
 *          тригерить завантаження файлу.
 *        - Імпорт: користувач обирає `.json`, ми просимо пароль,
 *          розшифровуємо, зливаємо у локальну БД (за id перемагає файл),
 *          сповіщаємо UI про оновлення.
 *
 *     3) Небезпечна зона — «Видалити всі звіти»
 *        - Підтвердження, виклик `report-actions.deleteAllReports`,
 *          подія `reportsChanged` — журнал перевантажиться.
 *        - Таблицю Google НЕ чіпає.
 *
 * @module screens/data
 */

import { $ } from "../utils.js";
import {
  loadSyncSettings,
  saveSyncSettings,
  getDefaultSyncSettings,
  validateAppsScriptUrl,
} from "../sync-settings.js";
import { testAppsScriptConnection } from "../google-sheets-api.js";
import {
  exportEncryptedReports,
  importEncryptedReports,
} from "../crypto/importExport.js";
import { deleteAllReports, listReports } from "../report-actions.js";

let initialized = false;

// ─────────────────────────────────────────────────────────────────────────────
// Public init
// ─────────────────────────────────────────────────────────────────────────────

/**
 * EN: Single entry point — called once from `app.js` after the DOM is
 *     ready. Idempotent. Wires the three sections (integration form,
 *     export/import, delete-all).
 * UA: Єдина точка входу — викликає `app.js` один раз після готовності DOM.
 *     Ідемпотентна. Налаштовує три секції (інтеграція, експорт/імпорт,
 *     "видалити все").
 */
export async function initDataScreen() {
  if (initialized) return;
  initialized = true;

  await bindIntegrationForm();
  bindTransferButtons();
  bindDeleteAllReports();
}

// ─────────────────────────────────────────────────────────────────────────────
// Google Sheets integration form
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Populate the integration form from stored settings and wire up all buttons.
 * Re-entrant: safe to call again after a reset to refresh field values.
 */
async function bindIntegrationForm() {
  const s = await loadSyncSettings();

  const u1   = $("syncGoogleSheetUrl");
  const u2   = $("syncAppsScriptUrl");
  const mode = $("syncSendMode");
  const delay = $("syncDelayMinutes");
  const lock = $("syncLockAfterSend");
  const corr = $("syncCorrectionsOnly");

  if (u1   instanceof HTMLInputElement)   u1.value   = s.googleSheetUrl;
  if (u2   instanceof HTMLInputElement)   u2.value   = s.appsScriptUrl;
  if (mode instanceof HTMLSelectElement)  mode.value = s.sendMode;
  if (delay instanceof HTMLInputElement)  delay.value = String(s.sendDelayMinutes);
  if (lock instanceof HTMLInputElement)   lock.checked = s.lockAfterSend;
  if (corr instanceof HTMLInputElement)   corr.checked = s.correctionsOnlyAfterSend;

  // Save
  const btnSave = $("syncSaveSettings");
  if (btnSave) {
    btnSave.onclick = async () => {
      const appsScriptValue = u2 instanceof HTMLInputElement ? u2.value.trim() : "";
      if (appsScriptValue && !validateAppsScriptUrl(appsScriptValue)) {
        setIntegrationStatus("Некоректний URL Apps Script. Перевірте формат.", true);
        return;
      }
      await saveSyncSettings({
        googleSheetUrl:          u1 instanceof HTMLInputElement  ? u1.value   : "",
        appsScriptUrl:           appsScriptValue,
        sendMode:
          mode instanceof HTMLSelectElement && mode.value
            ? /** @type {"manual"|"immediate"|"delayed"} */ (mode.value)
            : "manual",
        sendDelayMinutes:
          delay instanceof HTMLInputElement
            ? Math.max(0, parseInt(delay.value, 10) || 60)
            : 60,
        lockAfterSend:            lock instanceof HTMLInputElement ? lock.checked : true,
        correctionsOnlyAfterSend: corr instanceof HTMLInputElement ? corr.checked : true,
      });
      setIntegrationStatus("Збережено.");
    };
  }

  // Reset to defaults
  const btnReset = $("syncResetSettings");
  if (btnReset) {
    btnReset.onclick = async () => {
      await saveSyncSettings(getDefaultSyncSettings());
      await bindIntegrationForm();           // re-populate fields
      setIntegrationStatus("Скинуто до типових.");
    };
  }

  // Test connection
  const btnTest = $("syncTestConnection");
  if (btnTest) {
    btnTest.onclick = async () => {
      const cur = await loadSyncSettings();
      if (!validateAppsScriptUrl(cur.appsScriptUrl)) {
        setIntegrationStatus("Некоректний URL Apps Script.", true);
        return;
      }
      setIntegrationStatus("Перевірка з'єднання…");
      const r = await testAppsScriptConnection(cur);
      setIntegrationStatus(
        r.ok ? "З'єднання успішне ✓" : (r.error || "Помилка з'єднання"),
        !r.ok
      );
    };
  }
}

/**
 * Show a status message inside the integration section.
 * @param {string} msg
 * @param {boolean} [isError]
 */
function setIntegrationStatus(msg, isError = false) {
  const el = $("integrationStatus");
  if (!el) return;
  el.textContent = msg || "";
  el.style.color = isError ? "var(--danger)" : "";
}

// ─────────────────────────────────────────────────────────────────────────────
// Encrypted backup (export / import)
// ─────────────────────────────────────────────────────────────────────────────

function bindDeleteAllReports() {
  const btn = $("btnDataDeleteAllReports");
  if (!btn) return;
  btn.onclick = async () => {
    const list = await listReports();
    if (list.length === 0) {
      window.alert("Архів уже порожній.");
      return;
    }
    const ok = window.confirm(
      `Видалити всі ${list.length} звіт(ів) з цього пристрою? Дію не скасувати.`
    );
    if (!ok) return;
    await deleteAllReports();
    setTransferStatus(`Архів очищено (було ${list.length} звітів).`);
    window.dispatchEvent(new Event("reportsChanged"));
    window.dispatchEvent(new Event("reportsUpdated"));
  };
}

function bindTransferButtons() {
  const btnExport   = $("btnExportEncrypted");
  const btnImport   = $("btnImportEncrypted");
  const importInput = $("importEncryptedFile");

  if (btnExport) {
    btnExport.onclick = () => void handleExport();
  }

  if (btnImport && importInput instanceof HTMLInputElement) {
    btnImport.onclick = () => {
      importInput.value = "";
      importInput.click();
    };
    importInput.addEventListener("change", async () => {
      const file = importInput.files?.[0];
      if (!file) return;
      await handleImport(file);
      importInput.value = "";
    });
  }
}

/**
 * Ask for passphrase (twice), encrypt all reports, trigger file download.
 */
async function handleExport() {
  try {
    setTransferStatus("Підготовка експорту…");
    const key1 = promptKey("Введи ключ шифрування для експорту");
    if (key1 == null) { setTransferStatus("Експорт скасовано."); return; }
    const key2 = promptKey("Повтори ключ шифрування");
    if (key2 == null) { setTransferStatus("Експорт скасовано."); return; }
    if (key1 !== key2) throw new Error("Ключі не співпадають.");
    const result = await exportEncryptedReports(key1);
    setTransferStatus(
      `Експорт завершено. Файл: ${result.fileName}. Записів: ${result.count}.`
    );
  } catch (err) {
    setTransferStatus(errMsg(err), true);
  }
}

/**
 * Ask for passphrase, decrypt the selected file, merge into local DB.
 * @param {File} file
 */
async function handleImport(file) {
  try {
    setTransferStatus(`Імпорт файлу "${file.name}"…`);
    const key = promptKey("Введи ключ для розшифрування файлу");
    if (key == null) { setTransferStatus("Імпорт скасовано."); return; }
    const result = await importEncryptedReports(file, key);
    setTransferStatus(
      `Імпорт завершено. Було: ${result.before}, у файлі: ${result.imported}, додано: ${result.added}, стало: ${result.after}.`
    );
    // Notify journal screen to refresh its list
    window.dispatchEvent(new Event("reportsChanged"));
    window.dispatchEvent(new Event("reportsUpdated"));
  } catch (err) {
    setTransferStatus(errMsg(err), true);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Show transfer status on the Data screen.
 * @param {string} msg
 * @param {boolean} [isError]
 */
function setTransferStatus(msg, isError) {
  const el = $("transferStatus");
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle("error", !!isError);
}

/**
 * Prompt for an encryption key.
 * @param {string} message
 * @returns {string|null}
 */
function promptKey(message) {
  return window.prompt(message);
}

/**
 * Extract readable error message.
 * @param {unknown} err
 * @returns {string}
 */
function errMsg(err) {
  if (err instanceof Error) return err.message;
  return String(err);
}
