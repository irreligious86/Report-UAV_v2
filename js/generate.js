/**
 * Report generation: fields → entity → storage, clipboard, counter, date.
 *
 * Single exported function: `generate()`.
 * Called from the «Готово» button on the main form screen.
 *
 * Flow:
 *   1. Sync date field to today if empty / stale.
 *   2. Collect fields from DOM via collectFieldsFromMainForm() — validates coords.
 *   3. Copy report text to clipboard.
 *   4. Persist to IndexedDB via createAndStoreReport() (handles sync queue too).
 *   5. Advance crew counter and update date for the next sortie.
 *
 * Concurrency: generateChain serialises rapid taps on «Готово» so that
 * field collection and counter increment never interleave between two calls.
 *
 * @module generate
 */

import {
  $,
  todayISO,
  autosizeTextarea,
  setStatus,
  refreshMissionDateForNewDay,
} from "./utils.js";
import { saveCounterMaybe } from "./counter.js";
import { createAndStoreReport } from "./report-actions.js";
import { collectFieldsFromMainForm, buildReportText } from "./report-format.js";
import { copyText } from "./clipboard.js";
import { updateEmptyHighlights } from "./config.js";
import { addStreamValue } from "./streams.js";

/**
 * Serialisation lock: the second «Готово» tap queues behind the first,
 * preventing mixed field reads and counter increments.
 * @type {Promise<void>}
 */
let generateChain = Promise.resolve();

/**
 * Advance crew counter in DOM + localStorage AFTER the report is saved.
 * Must not run before putReport completes — doing so would expose a window
 * where a concurrent tab reads the incremented number before the current
 * report is written, causing duplicates or gaps in Google Sheets.
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
 * Main generation entry point.
 * Collects form state, copies text, saves report, advances counter.
 * Serialised via generateChain to prevent race conditions on fast taps.
 * @returns {Promise<void>}
 */
export function generate() {
  generateChain = generateChain.then(_doGenerate).catch((err) => {
    setStatus("Помилка генерації: " + (err instanceof Error ? err.message : String(err)));
  });
  return generateChain;
}

async function _doGenerate() {
  // Ensure date field is fresh (may have crossed midnight since last use)
  refreshMissionDateForNewDay();
  const dp = $("datePicker");
  if (dp instanceof HTMLInputElement && !String(dp.value || "").trim()) {
    dp.value = todayISO();
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
  if (dpAfter instanceof HTMLInputElement) dpAfter.value = todayISO();

  updateEmptyHighlights();
}
