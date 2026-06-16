/**
 * Crew callsign and sortie counter — parsing, persistence, sanitisation.
 *
 * EN:
 *   `#crew` — last-used callsign in `localStorage[STORAGE_KEY_CREW_NAME]`;
 *   persisted on every input (like MGRS prefix / counter).
 *   `#crewCounter` — sortie number 1..25 in `STORAGE_KEY_COUNTER`.
 *
 * UA:
 *   `#crew` — останній позивний у `localStorage[STORAGE_KEY_CREW_NAME]`;
 *   зберігається при кожному вводі (як префікс MGRS / лічильник).
 *   `#crewCounter` — номер вильоту 1..25 у `STORAGE_KEY_COUNTER`.
 *
 * @module counter
 */

import { $, setStatus } from "./utils.js";
import { STORAGE_KEY_COUNTER, STORAGE_KEY_CREW_NAME } from "./constants.js";
import { updateEmptyHighlights } from "./config.js";

/**
 * EN: Parses raw counter input. Three return shapes:
 *       { ok: true, empty: true, value: null } — the user cleared the field.
 *       { ok: true, empty: false, value: N }   — valid integer 1..25.
 *       { ok: false }                          — invalid input (digits-only
 *                                                check + range check failed).
 * UA: Розбирає сирий ввід лічильника. Три форми результату:
 *       { ok: true, empty: true, value: null } — користувач очистив поле.
 *       { ok: true, empty: false, value: N }   — коректне ціле 1..25.
 *       { ok: false }                          — некоректний ввід (тільки
 *                                                цифри + перевірка діапазону).
 * @param {string | null | undefined} raw
 * @returns {{ ok: boolean, empty?: boolean, value?: number | null }}
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
 * EN: Writes counter to localStorage; null REMOVES the key (no counter
 *     for the next sortie).
 * UA: Пише лічильник у localStorage; null ВИДАЛЯЄ ключ (наступний виліт
 *     без лічильника).
 * @param {number | null} valOrNull
 */
export function saveCounterMaybe(valOrNull) {
  if (valOrNull === null) localStorage.removeItem(STORAGE_KEY_COUNTER);
  else localStorage.setItem(STORAGE_KEY_COUNTER, String(valOrNull));
}

/**
 * EN: Loads the counter from localStorage into the `#crewCounter` input on
 *     form initialisation. Empty / invalid storage value → empty field.
 * UA: Завантажує лічильник із localStorage у поле `#crewCounter` при
 *     ініціалізації форми. Порожнє / некоректне значення у сховищі →
 *     порожнє поле.
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
 * EN: Persists crew callsign; empty string REMOVES the key.
 * UA: Зберігає позивний; порожній рядок ВИДАЛЯЄ ключ.
 * @param {string} name
 */
export function saveCrewName(name) {
  const trimmed = String(name ?? "").trim();
  try {
    if (!trimmed) localStorage.removeItem(STORAGE_KEY_CREW_NAME);
    else localStorage.setItem(STORAGE_KEY_CREW_NAME, trimmed);
  } catch {
    /* localStorage unavailable */
  }
}

/**
 * EN: Loads the saved crew callsign into `#crew` on form init.
 * UA: Завантажує збережений позивний у `#crew` при ініціалізації форми.
 */
export function loadCrewName() {
  const el = $("crew");
  if (!el) return;
  try {
    const stored = localStorage.getItem(STORAGE_KEY_CREW_NAME);
    if (stored && stored.trim()) el.value = stored.trim();
  } catch {
    /* localStorage unavailable */
  }
}

/**
 * EN: Validates `#crew` — returns trimmed callsign or shows `#crewError`,
 *     focuses the field and returns `null` when empty.
 * UA: Перевіряє `#crew` — повертає позивний або показує `#crewError`,
 *     фокусує поле і повертає `null`, якщо порожньо.
 * @returns {string|null}
 */
export function validateCrewOrError() {
  const el = $("crew");
  const err = $("crewError");
  if (err) err.textContent = "";
  const name = el instanceof HTMLInputElement ? el.value.trim() : "";
  if (!name) {
    if (err) err.textContent = "Екіпаж: введіть позивний.";
    setStatus("Помилка: не вказано екіпаж.");
    if (el instanceof HTMLInputElement) {
      el.focus();
      updateEmptyHighlights();
    }
    return null;
  }
  return name;
}

/**
 * EN: `oninput` handler for `#crew` — saves callsign on every change.
 * UA: Обробник `oninput` для `#crew` — зберігає позивний при кожній зміні.
 */
export function persistCrewField() {
  const el = $("crew");
  if (!el) return;
  saveCrewName(el.value);
  const err = $("crewError");
  if (err && String(el.value || "").trim()) err.textContent = "";
  updateEmptyHighlights();
}

/**
 * EN: `oninput` handler for `#crewCounter`. Strips non-digits, caps to two
 *     chars, then validates: on success — saves value (or clears it) and
 *     hides the inline error; on failure — shows "Лічильник: 1–25.".
 *     Always refreshes the empty-field highlights.
 * UA: Обробник `oninput` для `#crewCounter`. Прибирає не-цифри, обмежує
 *     до двох символів, валідує: на успіх — зберігає (або очищує) і
 *     ховає помилку біля поля; на помилку — показує «Лічильник: 1–25.».
 *     Завжди оновлює підсвітку порожніх полів.
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
