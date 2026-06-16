/**
 * EN: Lightweight logger. Previously many `catch { /* ignore *\/ }` blocks silently
 *     dropped errors — making sync diagnostics painful. This module preserves the
 *     silent-by-default behaviour in production but lets developers opt in via:
 *
 *       localStorage.setItem("uav.debug", "1")
 *
 *     Once enabled, `logger.debug()` and `logger.warn()` print with a "[uav]" prefix
 *     to the browser console. `logger.error()` always logs — real errors should not
 *     be suppressed even in production.
 *
 * UA: Мінімалістичний логер. Раніше багато блоків `catch { /* ignore *\/ }` беззвучно
 *     ковтали помилки — це ускладнювало діагностику синхронізації. Цей модуль
 *     зберігає "тиху" поведінку в продакшні, але розробники можуть увімкнути
 *     дебаг-режим прапором:
 *
 *       localStorage.setItem("uav.debug", "1")
 *
 *     Після цього `logger.debug()` та `logger.warn()` друкують у консоль з
 *     префіксом "[uav]". `logger.error()` пише завжди — справжні помилки не
 *     мають замовчуватися навіть у продакшні.
 *
 * @module logger
 */

const DEBUG_FLAG_KEY = "uav.debug";

/**
 * EN: True when developer-mode debug flag is set in localStorage.
 *     Safe in environments without `localStorage` (Service Worker, tests).
 * UA: True, якщо у localStorage виставлений прапор розробника.
 *     Безпечно в оточеннях без `localStorage` (Service Worker, тести).
 * @returns {boolean}
 */
export function isDebugEnabled() {
  try {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem(DEBUG_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * EN: Debug-level log. Silent unless `uav.debug=1`. Accepts any printable args.
 * UA: Лог рівня debug. Мовчить, якщо не встановлений `uav.debug=1`.
 * @param {...unknown} args
 */
export function debug(...args) {
  if (!isDebugEnabled()) return;
  try {
    // eslint-disable-next-line no-console
    console.debug("[uav]", ...args);
  } catch {
    /* EN: console may be unavailable — swallow. / UA: консоль може бути недоступна. */
  }
}

/**
 * EN: Warning-level log. Silent unless `uav.debug=1`.
 * UA: Лог рівня warn. Мовчить, якщо не встановлений `uav.debug=1`.
 * @param {...unknown} args
 */
export function warn(...args) {
  if (!isDebugEnabled()) return;
  try {
    // eslint-disable-next-line no-console
    console.warn("[uav]", ...args);
  } catch {
    /* noop */
  }
}

/**
 * EN: Error-level log. Always prints — real errors should not be suppressed.
 * UA: Лог рівня error. Пише завжди — справжні помилки не повинні приховуватися.
 * @param {...unknown} args
 */
export function error(...args) {
  try {
    // eslint-disable-next-line no-console
    console.error("[uav]", ...args);
  } catch {
    /* noop */
  }
}
