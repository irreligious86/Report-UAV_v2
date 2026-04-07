/**
 * MGRS-style coordinates: easting/northing 5-digit normalization and validation.
 * Координаты в стиле MGRS: нормализация и проверка 5-значных easting/northing.
 * @module coords
 */

import { $ } from "./utils.js";
import { setStatus } from "./utils.js";

/**
 * Keeps only digits in the input and limits length to 5.
 * Оставляет в поле ввода только цифры и ограничивает длину до 5.
 * @param {HTMLInputElement} el - Input element. Элемент input.
 */
export function normalize5(el) {
  el.value = el.value.replace(/\D/g, "").slice(0, 5);
}

/**
 * Returns true if the string is exactly 5 digits.
 * Возвращает true, если строка — ровно 5 цифр.
 * @param {string} s - String to check. Строка для проверки.
 * @returns {boolean}
 */
export function onlyDigits5(s) {
  return /^\d{5}$/.test(s);
}

/**
 * Builds full coordinate string "prefix easting northing" or shows error and returns null.
 * Формирует строку координат "префикс easting northing" или показывает ошибку и возвращает null.
 * @returns {string | null} Coordinate string or null if invalid. Строка координат или null при ошибке.
 */
export function buildCoordsOrError() {
  const e = ($("easting")?.value || "").trim();
  const n = ($("northing")?.value || "").trim();
  const err = $("coordError");
  if (err) err.textContent = "";
  if (!onlyDigits5(e) || !onlyDigits5(n)) {
    if (err) err.textContent = "Координати: 2 групи по 5 цифр.";
    setStatus("Помилка в координатах.");
    return null;
  }
  return `${$("mgrsPrefix").value} ${e} ${n}`;
}
