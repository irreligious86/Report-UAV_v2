/**
 * Crew counter logic: parse, save/load from localStorage, sanitize input.
 * Логика счётчика экипажа: разбор, сохранение/загрузка из localStorage, проверка ввода.
 * @module counter
 */

import { $ } from "./utils.js";
import { STORAGE_KEY_COUNTER } from "./constants.js";
import { updateEmptyHighlights } from "./config.js";

/**
 * Parses the raw counter string. Valid range: 1–25; empty string is allowed.
 * Разбирает строку счётчика. Допустимый диапазон: 1–25; пустая строка допустима.
 * @param {string | null | undefined} raw - Raw input. Исходная строка.
 * @returns {{ ok: boolean, empty?: boolean, value?: number | null }} ok: valid; empty: no value; value: number if not empty.
 */
export function parseCounterRaw(raw) {
  const s = String(raw ?? "").trim();
  if (s === "") return { ok: true, empty: true, value: null };
  if (!/^\d+$/.test(s)) return { ok: false };
  const n = parseInt(s, 10);
  if (!Number.isFinite(n) || n < 1 || n > 25) return { ok: false };
  return { ok: true, empty: false, value: n };
}

/**
 * Saves counter to localStorage or removes the key if value is null.
 * Сохраняет счётчик в localStorage или удаляет ключ, если значение null.
 * @param {number | null} valOrNull - Value 1–25 or null to clear. Значение 1–25 или null для очистки.
 */
export function saveCounterMaybe(valOrNull) {
  if (valOrNull === null) localStorage.removeItem(STORAGE_KEY_COUNTER);
  else localStorage.setItem(STORAGE_KEY_COUNTER, String(valOrNull));
}

/**
 * Loads counter from localStorage and writes it into the crewCounter input.
 * Загружает счётчик из localStorage и записывает в поле crewCounter.
 */
export function loadCounter() {
  const raw = localStorage.getItem(STORAGE_KEY_COUNTER);
  const el = $("crewCounter");
  if (!el) return;
  if (raw === null) {
    el.value = "";
    return;
  }
  const parsed = parseCounterRaw(raw);
  el.value = (parsed.ok && !parsed.empty) ? String(parsed.value) : "";
}

/**
 * Sanitizes crewCounter input (digits only, max 2 chars), validates, saves, shows error if invalid.
 * Очищает ввод crewCounter (только цифры, макс. 2 символа), проверяет, сохраняет, показывает ошибку при неверном значении.
 */
export function sanitizeCounterField() {
  const el = $("crewCounter");
  const err = $("counterError");
  if (!el) return;
  el.value = el.value.replace(/[^\d]/g, "").slice(0, 2);
  const parsed = parseCounterRaw(el.value);
  if (parsed.ok) {
    saveCounterMaybe(parsed.empty ? null : parsed.value);
    if (err) err.textContent = "";
  } else {
    if (err) err.textContent = "Лічильник: 1–25.";
  }
  updateEmptyHighlights();
}
