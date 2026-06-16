/**
 * EN: MGRS-style coordinates — 5-digit easting/northing normalisation and
 *     validation for the main report form.
 * UA: Координати MGRS-стилю — нормалізація та перевірка 5-значних
 *     easting/northing для головної форми звіту.
 * @module coords
 */

import { $, setStatus } from "./utils.js";

/**
 * EN: Keeps only digits in the input and truncates to at most 5 characters.
 * UA: Залишає у полі вводу тільки цифри, обрізаючи до максимум 5 символів.
 * @param {HTMLInputElement} el — EN: input element. / UA: елемент input.
 * @returns {void}
 */
export function normalize5(el) {
  el.value = el.value.replace(/\D/g, "").slice(0, 5);
}

/**
 * EN: Returns true when the string is exactly 5 digits.
 * UA: Повертає true, якщо рядок — рівно 5 цифр.
 * @param {string} s
 * @returns {boolean}
 */
export function onlyDigits5(s) {
  return /^\d{5}$/.test(s);
}

/**
 * EN: Builds the full coordinate string "prefix easting northing" or shows an
 *     inline error in #coordError and returns `null`.
 * UA: Формує повний рядок координат "префікс easting northing" або показує
 *     повідомлення про помилку у #coordError та повертає `null`.
 * @returns {string|null}
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
