/**
 * EN: Binds visible DD.MM.YYYY / HH:MM text fields to hidden native
 *     `<input type="date|time">` pickers (Android / mobile-friendly).
 * UA: Зв’язує видимі поля ДД.ММ.РРРР / ГГ:ХХ із прихованими нативними
 *     `<input type="date|time">` (зручно на Android).
 * @module ui-native-datetime
 */

import {
  normalizeDateToISO,
  isoToDdMmYyyy,
  normalizeTime24,
} from "./date-utils.js";

/**
 * @param {HTMLElement | null} displayEl
 * @returns {HTMLInputElement | null}
 */
function getNativeInput(displayEl) {
  const wrap = displayEl?.closest(".ui-datetime-wrap");
  if (!wrap) return null;
  const native = wrap.querySelector("input.ui-datetime-native");
  return native instanceof HTMLInputElement ? native : null;
}

/**
 * EN: Sync hidden native picker from the visible display value.
 * UA: Синхронізує прихований нативний пікер із видимим полем.
 * @param {HTMLElement | null} displayEl
 */
export function syncNativePickerFromDisplay(displayEl) {
  if (!(displayEl instanceof HTMLInputElement)) return;
  const native = getNativeInput(displayEl);
  if (!native) return;

  if (native.type === "date") {
    const iso = normalizeDateToISO(displayEl.value);
    native.value = iso || "";
    if (iso) displayEl.value = isoToDdMmYyyy(iso);
    return;
  }

  if (native.type === "time") {
    const t = normalizeTime24(displayEl.value);
    native.value = t || "";
    if (t) displayEl.value = t;
  }
}

/**
 * @param {HTMLInputElement} displayEl
 * @returns {HTMLElement}
 */
function ensureWrap(displayEl) {
  const parent = displayEl.parentElement;
  if (parent?.classList.contains("ui-datetime-wrap")) return parent;

  const wrap = document.createElement("span");
  wrap.className = "ui-datetime-wrap";
  parent?.insertBefore(wrap, displayEl);
  wrap.appendChild(displayEl);
  return wrap;
}

/**
 * @param {HTMLInputElement} native
 */
function openNativePicker(native) {
  if (typeof native.showPicker === "function") {
    try {
      native.showPicker();
      return;
    } catch {
      /* fallback below */
    }
  }
  native.click();
}

/**
 * EN: Visible DD.MM.YYYY field + native date picker overlay.
 * UA: Видиме поле ДД.ММ.РРРР + нативний календар поверх.
 * @param {HTMLElement | null} displayEl
 */
export function bindNativeDatePicker(displayEl) {
  if (!(displayEl instanceof HTMLInputElement)) return;
  if (displayEl.dataset.nativeBound === "1") {
    syncNativePickerFromDisplay(displayEl);
    return;
  }
  displayEl.dataset.nativeBound = "1";

  displayEl.readOnly = true;
  displayEl.classList.add("ui-datetime-display");
  displayEl.removeAttribute("inputmode");
  displayEl.removeAttribute("maxlength");

  const wrap = ensureWrap(displayEl);

  const native = document.createElement("input");
  native.type = "date";
  native.className = "ui-datetime-native";
  native.setAttribute("aria-hidden", "true");
  native.tabIndex = -1;
  wrap.appendChild(native);

  const syncFromNative = () => {
    const iso = native.value;
    displayEl.value = iso ? isoToDdMmYyyy(iso) : "";
    displayEl.dispatchEvent(new Event("change", { bubbles: true }));
  };

  native.addEventListener("change", syncFromNative);
  native.addEventListener("input", syncFromNative);

  displayEl.addEventListener("click", () => {
    syncNativePickerFromDisplay(displayEl);
    openNativePicker(native);
  });

  syncNativePickerFromDisplay(displayEl);
}

/**
 * EN: Visible HH:MM field + native time picker overlay.
 * UA: Видиме поле ГГ:ХХ + нативний вибір часу поверх.
 * @param {HTMLElement | null} displayEl
 */
export function bindNativeTimePicker(displayEl) {
  if (!(displayEl instanceof HTMLInputElement)) return;
  if (displayEl.dataset.nativeBound === "1") {
    syncNativePickerFromDisplay(displayEl);
    return;
  }
  displayEl.dataset.nativeBound = "1";

  displayEl.readOnly = true;
  displayEl.classList.add("ui-datetime-display");
  displayEl.removeAttribute("inputmode");
  displayEl.removeAttribute("maxlength");

  const wrap = ensureWrap(displayEl);

  const native = document.createElement("input");
  native.type = "time";
  native.step = "60";
  native.className = "ui-datetime-native";
  native.setAttribute("aria-hidden", "true");
  native.tabIndex = -1;
  wrap.appendChild(native);

  const syncFromNative = () => {
    const t = normalizeTime24(native.value);
    displayEl.value = t || "";
    displayEl.dispatchEvent(new Event("change", { bubbles: true }));
  };

  native.addEventListener("change", syncFromNative);
  native.addEventListener("input", syncFromNative);

  displayEl.addEventListener("click", () => {
    syncNativePickerFromDisplay(displayEl);
    openNativePicker(native);
  });

  syncNativePickerFromDisplay(displayEl);
}
