/**
 * Main report form screen — initialisation, input bindings, config load.
 *
 * EN:
 *   This is the "default" screen the app boots into. The module wires
 *   together everything the user sees on the form:
 *     - date / time pickers (auto-refresh on midnight crossing),
 *     - "Зараз" buttons for takeoff / impact times,
 *     - crew counter input (validated by `counter.js`),
 *     - MGRS easting / northing inputs (5-digit normalisation in
 *       `coords.js`; auto-jump from easting to northing on full input),
 *     - long-press on selects to switch to free-text mode (longPressEdit),
 *     - the «Готово» button — delegates to `generate.js`.
 *
 *   Config (drones, mission types, ammo, results, MGRS prefixes) is loaded
 *   from `config.json` once on first init, merged with the user's
 *   localStorage overrides, and applied to selects/datalists.
 *
 * UA:
 *   Це «екран за замовчуванням» при запуску застосунку. Модуль звʼязує все,
 *   що користувач бачить на формі:
 *     - календар / тайм-пікери (автооновлення дати при переході через
 *       північ),
 *     - кнопки «Зараз» для часу зльоту / ураження,
 *     - поле лічильника екіпажу (валідація — у `counter.js`),
 *     - поля MGRS easting / northing (нормалізація 5 цифр — у `coords.js`;
 *       авто-перехід з easting у northing при повному вводі),
 *     - long-press на select-ах для переходу у режим вільного вводу
 *       (longPressEdit),
 *     - кнопка «Готово» — делегує у `generate.js`.
 *
 *   Конфіг (дрони, типи місій, боєприпаси, результати, префікси MGRS)
 *   завантажується з `config.json` один раз при ініціалізації, зливається
 *   з користувацькими перевизначеннями з localStorage і застосовується
 *   до select/datalist.
 *
 * @module screens/mainForm
 */

import { $, nowTime, setStatus, refreshMissionDateForNewDay } from "../utils.js";
import { bindNativeDatePicker, bindNativeTimePicker, syncNativePickerFromDisplay } from "../ui-native-datetime.js";
import { loadCounter, loadCrewName, persistCrewField, sanitizeCounterField } from "../counter.js";
import { normalize5 } from "../coords.js";
import {
  loadConfig,
  applyConfigWithOverrides,
  loadConfigOverrides,
  updateEmptyHighlights,
} from "../config.js";
import { enableLongPressToEdit } from "../longPressEdit.js";
import { generate } from "../generate.js";
import { FORM_TEXT_FIELD_MAX_LENGTH } from "../constants.js";

/**
 * EN: Tracks whether the user has started typing in `easting`. When they
 *     start fresh — we clear `northing` so two unrelated coordinates don't
 *     stick together. Reset on each focus / clear.
 * UA: Слідкує, чи почав користувач вводити у `easting`. Коли починає з
 *     нуля — очищаємо `northing`, щоб дві несумісні координати не
 *     "зліплялися". Скидається на focus / очищення.
 */
let eastingEditStarted = false;

/** EN: Idempotency flag — `initMainFormScreen` runs only once. UA: Прапор ідемпотентності — `initMainFormScreen` виконується раз. */
let initialized = false;

/**
 * EN: Initialises the main form screen — runs ONCE at boot from `app.js`.
 *     Subsequent calls are no-ops thanks to the `initialized` flag.
 * UA: Ініціалізує головний екран форми — виконується ОДИН раз при старті
 *     з `app.js`. Наступні виклики нічого не роблять (прапор `initialized`).
 * @returns {Promise<void>}
 */
export async function initMainFormScreen() {
  if (initialized) return;
  initialized = true;

  const datePicker = $("datePicker");
  const takeoff = $("takeoff");
  const impact = $("impact");
  if (datePicker) refreshMissionDateForNewDay();
  if (takeoff) takeoff.value = nowTime();
  bindNativeDatePicker(datePicker);
  bindNativeTimePicker(takeoff);
  bindNativeTimePicker(impact);
  syncNativePickerFromDisplay(takeoff);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      refreshMissionDateForNewDay();
    }
  });

  window.addEventListener("pageshow", () => {
    refreshMissionDateForNewDay();
    syncNativePickerFromDisplay($("datePicker"));
  });

  loadCounter();
  loadCrewName();

  const crewInput = $("crew");
  if (crewInput) {
    crewInput.oninput = persistCrewField;
  }

  const btnNowTakeoff = $("btnNowTakeoff");
  if (btnNowTakeoff) {
    btnNowTakeoff.onclick = () => {
      const el = $("takeoff");
      if (el) el.value = nowTime();
      syncNativePickerFromDisplay(el);
      updateEmptyHighlights();
    };
  }

  const btnNowImpact = $("btnNowImpact");
  if (btnNowImpact) {
    btnNowImpact.onclick = () => {
      const el = $("impact");
      if (el) el.value = nowTime();
      syncNativePickerFromDisplay(el);
      updateEmptyHighlights();
    };
  }

  const btnGenerate = $("btnGenerate");
  if (btnGenerate) {
    btnGenerate.onclick = generate;
  }

  const crewCounter = $("crewCounter");
  if (crewCounter) {
    crewCounter.oninput = sanitizeCounterField;
  }

  const eastingEl = $("easting");
  const northingEl = $("northing");

  if (eastingEl) {
    eastingEl.onfocus = () => {
      eastingEditStarted = false;
    };

    eastingEl.oninput = () => {
      const eEl = $("easting");
      const nEl = $("northing");

      if (!eEl) return;

      normalize5(eEl);
      const now = eEl.value;

      if (now === "") {
        if (nEl) nEl.value = "";
        eastingEditStarted = false;
        updateEmptyHighlights();
        return;
      }

      if (!eastingEditStarted && now.length > 0) {
        eastingEditStarted = true;
        if (nEl && nEl.value.trim() !== "") {
          nEl.value = "";
        }
      }

      if (now.length === 5 && nEl) nEl.focus();

      updateEmptyHighlights();
    };
  }

  if (northingEl) {
    northingEl.oninput = () => {
      const nEl = $("northing");
      if (!nEl) return;

      normalize5(nEl);

      if ((nEl.value || "").length === 5) {
        nEl.blur();
      }

      updateEmptyHighlights();
    };
  }

  // Load base config + user overrides and apply to selects/datalists.
  try {
    const cfg = await loadConfig();
    const overrides = loadConfigOverrides();
    applyConfigWithOverrides(cfg, overrides);
  } catch (e) {
    setStatus("Помилка конфігу.");
  }

  // Browser may restore form fields (ISO dates) after async init — normalize again.
  refreshMissionDateForNewDay();
  syncNativePickerFromDisplay($("datePicker"));
  requestAnimationFrame(() => {
    refreshMissionDateForNewDay();
    syncNativePickerFromDisplay($("datePicker"));
  });

  // Enable long-press-to-edit for select fields as before.
  enableLongPressToEdit("ammo", "ammoList", FORM_TEXT_FIELD_MAX_LENGTH);
  enableLongPressToEdit("drone", "droneList", FORM_TEXT_FIELD_MAX_LENGTH);
  enableLongPressToEdit("missionType", "missionTypeList", FORM_TEXT_FIELD_MAX_LENGTH);
  enableLongPressToEdit("result", "resultList", 100);

  updateEmptyHighlights();
}

