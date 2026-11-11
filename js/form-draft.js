/**
 * Form draft — keeps the main form's in-progress values safe.
 *
 * EN:
 *   The operator fills the report in pieces (takeoff time now, coordinates and
 *   result later) and in between visits other screens. Nothing typed on the
 *   form may be lost on the way. Within one page load the DOM itself keeps the
 *   values; this module covers everything that rebuilds the DOM:
 *     - a page reload (pull-to-refresh, "apply update" button),
 *     - Android discarding the backgrounded tab and restoring it later.
 *
 *   The draft lives in `sessionStorage`, on purpose:
 *     - it survives reloads and tab restore (same browsing session),
 *     - it is gone on a fresh launch of the app, so a new shift starts with a
 *       clean form and the current time instead of yesterday's values.
 *
 *   Crew callsign, crew counter and date are NOT part of the draft — they have
 *   their own persistence rules (`counter.js`, `utils.js`).
 *
 * UA:
 *   Оператор заповнює звіт частинами (час зльоту зараз, координати й
 *   результат — пізніше) і між цим ходить по інших екранах. Нічого з
 *   введеного не має зникнути. У межах одного завантаження сторінки значення
 *   тримає сам DOM; цей модуль страхує все, що DOM перебудовує:
 *     - перезавантаження сторінки (pull-to-refresh, кнопка «Застосувати
 *       оновлення»),
 *     - вивантаження фонової вкладки Android-ом і її відновлення.
 *
 *   Чернетка свідомо лежить у `sessionStorage`:
 *     - переживає перезавантаження і відновлення вкладки (та сама сесія),
 *     - зникає при новому запуску застосунку — нова зміна починається з
 *       чистої форми і поточного часу, а не з учорашніх значень.
 *
 *   Позивний, лічильник і дата НЕ входять у чернетку — у них власні правила
 *   збереження (`counter.js`, `utils.js`).
 *
 * @module form-draft
 */

import { $ } from "./utils.js";
import { setSelectValue, updateEmptyHighlights } from "./config.js";
import { syncNativePickerFromDisplay } from "./ui-native-datetime.js";
import { STORAGE_KEY_FORM_DRAFT } from "./constants.js";

/**
 * EN: Ids of the form controls stored in the draft. A select that is in
 *     long-press edit mode is temporarily an `<input>` with the same id —
 *     reading `.value` works for both.
 * UA: Id полів форми, що зберігаються у чернетці. Select у режимі
 *     long-press-редагування тимчасово є `<input>` з тим самим id —
 *     читання `.value` працює для обох.
 */
const DRAFT_FIELD_IDS = [
  "drone",
  "missionType",
  "takeoff",
  "impact",
  "mgrsPrefix",
  "easting",
  "northing",
  "ammo",
  "stream",
  "result",
];

/** EN: Selects where the user may type free text. UA: Select-и з вільним вводом. */
const FREE_TEXT_SELECT_IDS = new Set(["drone", "missionType", "ammo", "result"]);

/**
 * EN: Snapshots the current form values into sessionStorage. Cheap enough to
 *     call on every input event. Storage errors (private mode, quota) are
 *     swallowed — the draft is a safety net, not a requirement.
 * UA: Зберігає поточні значення форми у sessionStorage. Достатньо дешево,
 *     щоб викликати на кожну подію вводу. Помилки сховища (приватний режим,
 *     квота) ігноруються — чернетка є страховкою, а не вимогою.
 */
export function saveFormDraft() {
  /** @type {Record<string, string>} */
  const values = {};
  for (const id of DRAFT_FIELD_IDS) {
    const el = $(id);
    if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) {
      values[id] = el.value;
    }
  }
  try {
    sessionStorage.setItem(STORAGE_KEY_FORM_DRAFT, JSON.stringify(values));
  } catch {
    /* storage unavailable */
  }
}

/**
 * EN: Reads the stored draft; `null` when there is none or it is corrupt.
 * UA: Читає збережену чернетку; `null`, якщо її немає або вона зіпсована.
 * @returns {Record<string, string> | null}
 */
function loadFormDraft_() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY_FORM_DRAFT);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * EN: Writes the stored draft back into the form. Must run AFTER the selects
 *     are filled from config. A select value missing from the list is
 *     restored as free text for fields that allow it, otherwise skipped.
 * UA: Повертає збережену чернетку у форму. Викликати ПІСЛЯ заповнення
 *     select-ів із config. Значення select, якого немає у списку,
 *     відновлюється як вільний текст для полів, де це дозволено, інакше
 *     пропускається.
 * @returns {boolean} EN: true if a draft was applied. UA: true, якщо чернетку застосовано.
 */
export function restoreFormDraft() {
  const draft = loadFormDraft_();
  if (!draft) return false;

  for (const id of DRAFT_FIELD_IDS) {
    const value = draft[id];
    if (typeof value !== "string") continue;
    const el = $(id);
    if (el instanceof HTMLSelectElement) {
      setSelectValue(el, value, { allowCustom: FREE_TEXT_SELECT_IDS.has(id) });
    } else if (el instanceof HTMLInputElement) {
      el.value = value;
    }
  }

  syncNativePickerFromDisplay($("takeoff"));
  syncNativePickerFromDisplay($("impact"));
  updateEmptyHighlights();
  return true;
}

/**
 * EN: Starts auto-saving the draft. Listeners are delegated to the form
 *     screen, so they keep working when a select is swapped for an input by
 *     long-press edit. Besides `input` / `change` we also save on:
 *       - `click`    — the «Зараз» buttons set a value without an input event,
 *       - `focusout` — leaving long-press edit mode restores the select,
 *       - `pagehide` / hidden tab — last chance before the page is discarded.
 * UA: Запускає автозбереження чернетки. Слухачі делеговано на екран форми,
 *     тому вони працюють і тоді, коли long-press замінює select на input.
 *     Окрім `input` / `change`, зберігаємо також на:
 *       - `click`    — кнопки «Зараз» ставлять значення без події input,
 *       - `focusout` — вихід із long-press-редагування повертає select,
 *       - `pagehide` / прихована вкладка — останній шанс перед вивантаженням.
 */
export function initFormDraft() {
  const screen = $("screen-main");
  if (!screen) return;

  // EN: Defer one tick so handlers that run after us on the same event
  //     (e.g. long-press restoring the select on blur) are already done.
  // UA: Відкладаємо на тік — щоб обробники тієї ж події, які йдуть після
  //     нас (напр. long-press повертає select на blur), уже відпрацювали.
  const saveSoon = () => setTimeout(saveFormDraft, 0);

  for (const type of ["input", "change", "click", "focusout"]) {
    screen.addEventListener(type, saveSoon);
  }

  window.addEventListener("pagehide", saveFormDraft);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveFormDraft();
  });
}
