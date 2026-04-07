/**
 * Main report form screen: initialization, bindings, config load.
 * Головний екран форми звіту: ініціалізація, обробники, завантаження конфігу.
 * @module screens/mainForm
 */

import { $, nowTime, setStatus, refreshMissionDateForNewDay } from "../utils.js";
import { loadCounter, sanitizeCounterField } from "../counter.js";
import { normalize5 } from "../coords.js";
import {
  loadConfig,
  applyConfigWithOverrides,
  loadConfigOverrides,
  updateEmptyHighlights,
} from "../config.js";
import { enableLongPressToEdit } from "../longPressEdit.js";
import { generate } from "../generate.js";

/** Tracks whether user has started typing in easting (to clear northing on new entry). */
/** Відстежує, чи почав користувач ввод у easting (щоб очистити northing при новому вводі). */
let eastingEditStarted = false;

let initialized = false;

/**
 * Initializes the main form screen once.
 * Ініціалізує головний екран форми (одноразово).
 * @returns {Promise<void>}
 */
export async function initMainFormScreen() {
  if (initialized) return;
  initialized = true;

  const datePicker = $("datePicker");
  const takeoff = $("takeoff");
  if (datePicker) refreshMissionDateForNewDay();
  if (takeoff) takeoff.value = nowTime();

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      refreshMissionDateForNewDay();
    }
  });

  loadCounter();

  const btnNowTakeoff = $("btnNowTakeoff");
  if (btnNowTakeoff) {
    btnNowTakeoff.onclick = () => {
      const el = $("takeoff");
      if (el) el.value = nowTime();
      updateEmptyHighlights();
    };
  }

  const btnNowImpact = $("btnNowImpact");
  if (btnNowImpact) {
    btnNowImpact.onclick = () => {
      const el = $("impact");
      if (el) el.value = nowTime();
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

  // Enable long-press-to-edit for select fields as before.
  enableLongPressToEdit("ammo", "ammoList", 50);
  enableLongPressToEdit("drone", "droneList", 50);
  enableLongPressToEdit("missionType", "missionTypeList", 50);
  enableLongPressToEdit("result", "resultList", 100);

  updateEmptyHighlights();
}

