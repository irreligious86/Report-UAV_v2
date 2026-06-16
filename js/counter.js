/**
 * Crew sortie counter — parsing, persistence, sanitisation.
 *
 * EN:
 *   The counter is the small "1..25" number shown next to the crew name
 *   ("Дакар (3)"). It tracks how many sorties this crew has flown today
 *   and is auto-incremented after each successful «Готово».
 *
 *   Persistence: `localStorage[STORAGE_KEY_COUNTER]`. Writing null /
 *   missing value REMOVES the key — that is how the user explicitly
 *   "turns off" the counter for the next sortie.
 *
 *   Range: 1..25 (matches the input's `maxlength=2` and the visible cap
 *   in the UI). Values outside that range are rejected with `ok: false`
 *   so the inline error appears.
 *
 * UA:
 *   Лічильник — це невелике число «1..25» поряд із позивним
 *   («Дакар (3)»). Показує, скільки вильотів сьогодні в екіпажу;
 *   автоматично росте після кожного успішного «Готово».
 *
 *   Збереження: `localStorage[STORAGE_KEY_COUNTER]`. Запис null /
 *   відсутність значення ВИДАЛЯЄ ключ — так користувач явно «вимикає»
 *   лічильник для наступного вильоту.
 *
 *   Діапазон: 1..25 (збігається з `maxlength=2` поля та UI-обмеженням).
 *   Значення поза діапазоном відхиляються (`ok: false`), тоді біля поля
 *   зʼявляється помилка.
 *
 * @module counter
 */

import { $ } from "./utils.js";
import { STORAGE_KEY_COUNTER, STORAGE_KEY_CREW_NAME } from "./constants.js";
import { updateEmptyHighlights } from "./config.js";

/** EN: Default callsign when nothing is stored yet. UA: Позивний за замовчуванням, якщо ще нічого не збережено. */
const DEFAULT_CREW_NAME = "Дакар";

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
 * EN: Returns the saved crew callsign, or {@link DEFAULT_CREW_NAME} if none.
 * UA: Повертає збережений позивний екіпажу або {@link DEFAULT_CREW_NAME}.
 * @returns {string}
 */
export function getCrewFallback() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_CREW_NAME);
    if (stored && stored.trim()) return stored.trim();
  } catch {
    /* localStorage unavailable */
  }
  return DEFAULT_CREW_NAME;
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
 * EN: Persists the crew callsign after a successful report.
 * UA: Зберігає позивний екіпажу після успішного звіту.
 * @param {string} name
 */
export function saveCrewName(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return;
  try {
    localStorage.setItem(STORAGE_KEY_CREW_NAME, trimmed);
  } catch {
    /* localStorage unavailable */
  }
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
