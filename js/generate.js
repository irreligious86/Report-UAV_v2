/**
 * Report generation — what happens when the user presses «Готово».
 *
 * EN:
 *   This module is the bridge between the main form (`screens/mainForm.js`)
 *   and the data layer (`report-actions.createAndStoreReport`). It is
 *   intentionally tiny and side-effect-heavy — it touches the DOM
 *   (textarea / date picker), the clipboard, IndexedDB and localStorage in
 *   a fixed order.
 *
 *   Flow of one «Готово» press:
 *     1) Refresh date field if a new day has begun
 *        (`refreshMissionDateForNewDay`). Avoids the gotcha where the user
 *        opened the form yesterday and the picker still says "yesterday".
 *     2) Collect structured fields from the DOM via
 *        `collectFieldsFromMainForm()`. If MGRS coords are invalid this
 *        returns null and the flow aborts (the form already showed an
 *        inline error).
 *     3) Build the canonical text via `buildReportText()` and write it into
 *        the readonly `#output` textarea so the user sees what was sent.
 *     4) Remember the stream value (autocomplete in Settings).
 *     5) Copy the text to the clipboard. Failures are non-fatal — we just
 *        change the status line so the user can retry the copy manually.
 *     6) Persist to IndexedDB via `createAndStoreReport(fields)` — this
 *        also enqueues the report for Google Sheets if sendMode says so.
 *     7) Advance the crew counter (1 → 2 → … → 25) and reset the date for
 *        the NEXT sortie. We do this AFTER the save so a crash mid-save
 *        does not skip a number.
 *     8) Update empty-field highlights (visual cue).
 *
 *   Concurrency:
 *     `generateChain` is a Promise chain. Two fast «Готово» taps cannot
 *     interleave: the second waits for the first to finish reading the
 *     form before it starts. Without this lock the counter would advance
 *     twice but only one report would land.
 *
 * UA:
 *   Цей модуль — місток між головною формою (`screens/mainForm.js`) і шаром
 *   даних (`report-actions.createAndStoreReport`). Свідомо мінімальний і
 *   "побічно-ефектний" — у фіксованому порядку чіпає DOM
 *   (textarea / date picker), буфер обміну, IndexedDB і localStorage.
 *
 *   Послідовність одного натискання «Готово»:
 *     1) Освіжити поле дати, якщо настав новий день
 *        (`refreshMissionDateForNewDay`). Інакше може лишатись «вчора».
 *     2) Зібрати структурні поля з DOM через
 *        `collectFieldsFromMainForm()`. Якщо MGRS-координати некоректні —
 *        повертає null і ми зупиняємось (помилку вже показано біля поля).
 *     3) Побудувати канонічний текст через `buildReportText()` і
 *        записати у readonly `#output` — щоб користувач бачив, що
 *        відправили.
 *     4) Запам’ятати значення стріму (автодоповнення в Налаштуваннях).
 *     5) Скопіювати текст у буфер. Помилка копіювання НЕ зупиняє потік —
 *        просто змінюємо статус, користувач зможе скопіювати руками.
 *     6) Зберегти у IndexedDB через `createAndStoreReport(fields)` — там
 *        же звіт ставиться в чергу для Google Sheets, якщо це задано
 *        режимом.
 *     7) Збільшити лічильник екіпажу (1 → 2 → … → 25) і скинути дату
 *        для НАСТУПНОГО вильоту. Робимо це ПІСЛЯ збереження, щоб збій
 *        під час запису не пропустив число.
 *     8) Оновити підсвітку порожніх полів.
 *
 *   Конкурентність:
 *     `generateChain` — Promise-ланцюг. Два швидких натискання «Готово»
 *     не можуть змішатися: друге чекає на завершення першого до
 *     зчитування форми. Без цього блокування лічильник зросте двічі, а
 *     звіт збережеться лише один.
 *
 * @module generate
 */

import {
  $,
  todayISO,
  autosizeTextarea,
  setStatus,
  refreshMissionDateForNewDay,
  isoToDDMMYYYY,
} from "./utils.js";
import { saveCounterMaybe } from "./counter.js";
import { createAndStoreReport } from "./report-actions.js";
import { collectFieldsFromMainForm, buildReportText } from "./report-format.js";
import { copyText } from "./clipboard.js";
import { updateEmptyHighlights } from "./config.js";
import { addStreamValue } from "./streams.js";
import { syncNativePickerFromDisplay } from "./ui-native-datetime.js";

/**
 * EN: Serialisation lock — the second «Готово» tap queues behind the first,
 *     preventing mixed field reads and double counter increments.
 * UA: Замок серіалізації — друге натискання «Готово» стає у чергу за
 *     першим, виключаючи перемішані зчитування форми і подвійний
 *     інкремент лічильника.
 * @type {Promise<void>}
 */
let generateChain = Promise.resolve();

/**
 * EN: Advances the crew counter in DOM + localStorage AFTER the report is
 *     written. Doing this BEFORE save would let a concurrent tab read an
 *     incremented number while the report is not yet on disk — duplicates
 *     or gaps in Google Sheets become possible. Counter is capped at 25
 *     to match the input's max.
 * UA: Збільшує лічильник екіпажу в DOM + localStorage ПІСЛЯ запису звіту.
 *     Якщо робити ДО запису — паралельна вкладка може прочитати збільшене
 *     число, поки звіт ще не на диску, що дасть дублі або пропуски у
 *     Google Sheets. Стеля — 25, як у поля форми.
 * @param {import("./report-format.js").ReportFields} fields
 */
function advanceCrewCounterAfterSnapshot_(fields) {
  if (fields.crewCounter == null) return; // counter not used for this sortie
  const next = Math.min(25, fields.crewCounter + 1);
  const el = $("crewCounter");
  if (el instanceof HTMLInputElement) el.value = String(next);
  saveCounterMaybe(next);
}

/**
 * EN: Main entry — bound to the «Готово» button. Collects form state,
 *     copies text, saves the report, advances the counter. Serialised via
 *     `generateChain` to prevent race conditions on fast taps. On any
 *     thrown error the status line is updated; the chain is preserved so
 *     subsequent taps still work.
 * UA: Точка входу — повішена на кнопку «Готово». Збирає стан форми,
 *     копіює текст, зберігає звіт, збільшує лічильник. Серіалізується
 *     через `generateChain` — без рейсів на швидких натисканнях. На будь-яку
 *     помилку оновлюємо статус; ланцюг лишається живий, наступні
 *     натискання працюють.
 * @returns {Promise<void>}
 */
export function generate() {
  generateChain = generateChain.then(doGenerate_).catch((err) => {
    setStatus("Помилка генерації: " + (err instanceof Error ? err.message : String(err)));
  });
  return generateChain;
}

async function doGenerate_() {
  // Ensure date field is fresh (may have crossed midnight since last use)
  refreshMissionDateForNewDay();
  const dp = $("datePicker");
  if (dp instanceof HTMLInputElement && !String(dp.value || "").trim()) {
    dp.value = isoToDDMMYYYY(todayISO());
    syncNativePickerFromDisplay(dp);
  }

  // Collect fields — returns null if coords are invalid (error shown inside)
  const fields = collectFieldsFromMainForm();
  if (!fields) return;

  // Build human-readable text and show it in the output textarea
  const text = buildReportText(fields);
  const outputEl = $("output");
  if (outputEl instanceof HTMLTextAreaElement) {
    outputEl.value = text;
    autosizeTextarea(outputEl);
  }

  // Remember stream value for autocomplete list in Settings
  addStreamValue(fields.stream || "");

  // Copy to clipboard (works in Android WebView + modern browsers)
  const ok = await copyText(text);
  setStatus(ok ? "Звіт скопійовано." : "Помилка копіювання.");

  // Persist to IndexedDB; sync queue / immediate send handled inside
  await createAndStoreReport(fields);

  // Advance counter and reset date AFTER successful save
  advanceCrewCounterAfterSnapshot_(fields);
  const dpAfter = $("datePicker");
  if (dpAfter instanceof HTMLInputElement) {
    dpAfter.value = isoToDDMMYYYY(todayISO());
    syncNativePickerFromDisplay(dpAfter);
  }

  updateEmptyHighlights();
}
