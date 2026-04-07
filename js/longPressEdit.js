/**
 * Long-press to edit: replace <select> with <input list="..."> after 600ms hold for free-text input.
 * Долгое нажатие для редактирования: замена <select> на <input list="..."> после удержания 600 мс для свободного ввода.
 * @module longPressEdit
 */

import { $ } from "./utils.js";

// Keep original selects (with their event listeners) while we swap to input mode.
const originalSelects = new Map();

/**
 * Ensure select can show a custom value: if option doesn't exist, add it.
 * Гарантируем, что select сможет показать произвольное значение: если опции нет — добавляем.
 */
function ensureSelectHasValue(selectEl, value) {
  if (!value) return;
  const exists = Array.from(selectEl.options).some((o) => o.value === value);
  if (!exists) {
    const opt = new Option(value, value, true, true);
    selectEl.add(opt);
  }
  selectEl.value = value;
}

/**
 * Exits edit mode: replaces <input> back with the original <select>, restores handlers.
 * Выходит из режима редактирования: заменяет <input> обратно на исходный <select>, сохраняет обработчики.
 */
function exitEditMode(selectId, newValue, datalistId, maxLen) {
  const el = $(selectId);
  if (!el || el.tagName !== "INPUT") return;

  const original = originalSelects.get(selectId);
  if (!original) return;

  // Put the original select back (keeps any listeners attached earlier).
  ensureSelectHasValue(original, newValue);

  el.parentNode.replaceChild(original, el);

  // Re-enable long press on the restored select.
  enableLongPressToEdit(selectId, datalistId, maxLen);
}

/**
 * Replaces the select element with an input that has the same id, list attribute, maxLength, value and class; focuses it.
 * Заменяет элемент select на input с тем же id, атрибутом list, maxLength, значением и классом; фокусирует его.
 * @param {string} selectId - ID of the select. ID элемента select.
 * @param {string} datalistId - ID of the datalist for the new input. ID datalist для нового input.
 * @param {number} maxLen - Max length of the input. Максимальная длина ввода.
 */
export function enterEditMode(selectId, datalistId, maxLen) {
  const el = $(selectId);
  if (!el) return;

  // Already in input mode, do nothing.
  if (el.tagName === "INPUT") return;

  // Only allow swapping from SELECT.
  if (el.tagName !== "SELECT") return;

  // Save original select (with listeners) once.
  if (!originalSelects.has(selectId)) originalSelects.set(selectId, el);

  const input = document.createElement("input");
  input.id = selectId;
  input.maxLength = maxLen;
  input.value = el.value;
  input.setAttribute("list", datalistId);
  input.className = el.className;

  // Swap in the input.
  el.parentNode.replaceChild(input, el);

  // On blur, restore select.
  input.addEventListener("blur", () => {
    exitEditMode(selectId, input.value, datalistId, maxLen);
  });

  // Optional: Enter confirms, Escape cancels back to previous select value.
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      input.blur();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      const prev = originalSelects.get(selectId)?.value ?? "";
      exitEditMode(selectId, prev, datalistId, maxLen);
    }
  });

  input.focus();
}

/**
 * Enables long-press (600ms) on a select to switch to edit mode (input + datalist).
 * Включает долгое нажатие (600 мс) по select для перехода в режим редактирования (input + datalist).
 * @param {string} selectId - ID of the select. ID элемента select.
 * @param {string} datalistId - ID of the datalist. ID элемента datalist.
 * @param {number} maxLen - Max length for the replacement input. Максимальная длина для заменяющего input.
 */
export function enableLongPressToEdit(selectId, datalistId, maxLen) {
  const el = $(selectId);
  if (!el) return;
  if (el.tagName !== "SELECT") return;

  let t;
  el.onmousedown = el.ontouchstart = () => {
    t = setTimeout(() => enterEditMode(selectId, datalistId, maxLen), 600);
  };
  el.onmouseup = el.onmouseleave = el.ontouchend = () => clearTimeout(t);
}