/**
 * EN: Shared "period" filter used by the journal/statistics screen and the map
 *     screen. Persists in localStorage so the filter survives reloads.
 *
 *     Pure date/time helpers live in `./date-utils.js` — importing them here
 *     keeps a single source of truth for date normalisation / combination.
 *
 * UA: Спільний фільтр "період", який використовує екран журналу/статистики
 *     та екран мапи. Зберігається у localStorage, аби переживати
 *     перезавантаження.
 *
 *     Чисті хелпери роботи з датою/часом лежать у `./date-utils.js` — тут ми
 *     їх просто реекспортуємо, аби був один джерельний модуль для
 *     нормалізації/поєднання.
 *
 * @module filters
 */

import { getImpactTimestampMs } from "./report-format.js";
import {
  combineDateAndTime,
  normalizeDateToISO as _normalizeDateToISO,
} from "./date-utils.js";
import { pad2 } from "./utils.js";
import * as logger from "./logger.js";

/** EN: localStorage key for the saved filter. / UA: Ключ у localStorage для збереженого фільтра. */
const STORAGE_KEY_PERIOD_FILTER = "uav_period_filter_v1";

/**
 * @typedef {Object} PeriodFilter
 * @property {string} fromDate — EN: ISO "YYYY-MM-DD". / UA: ISO "РРРР-ММ-ДД".
 * @property {string} toDate
 * @property {string} fromTime — EN: "HH:MM". / UA: "ГГ:ХХ".
 * @property {string} toTime
 */

/**
 * EN: Returns the default filter — the entire current month 00:00–23:59.
 * UA: Повертає фільтр за замовчуванням — увесь поточний місяць 00:00–23:59.
 * @returns {PeriodFilter}
 */
export function getDefaultPeriodFilter() {
  const now = new Date();
  const year = now.getFullYear();
  const monthIndex = now.getMonth(); // 0..11

  const month = pad2(monthIndex + 1);
  const firstDay = "01";
  const lastDayDate = new Date(year, monthIndex + 1, 0); // EN: last day of the month. / UA: останній день місяця.
  const lastDay = pad2(lastDayDate.getDate());

  return {
    fromDate: `${year}-${month}-${firstDay}`,
    toDate: `${year}-${month}-${lastDay}`,
    fromTime: "00:00",
    toTime: "23:59",
  };
}

/**
 * EN: Loads the period filter from localStorage. Falls back to default when
 *     storage is empty, unparsable, or partially missing fields.
 * UA: Завантажує фільтр періоду з localStorage. Повертає default, якщо
 *     сховище порожнє/нечитабельне/неповне.
 * @returns {PeriodFilter}
 */
export function loadPeriodFilter() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PERIOD_FILTER);
    if (!raw) return getDefaultPeriodFilter();

    const parsed = JSON.parse(raw);
    const def = getDefaultPeriodFilter();
    return {
      fromDate: parsed?.fromDate || def.fromDate,
      toDate: parsed?.toDate || def.toDate,
      fromTime: parsed?.fromTime || def.fromTime,
      toTime: parsed?.toTime || def.toTime,
    };
  } catch (err) {
    logger.debug("loadPeriodFilter fallback", err);
    return getDefaultPeriodFilter();
  }
}

/**
 * EN: Saves the period filter to localStorage, filling blanks from defaults.
 * UA: Зберігає фільтр періоду у localStorage, порожні поля беруться з default.
 * @param {Partial<PeriodFilter>} filter
 * @returns {void}
 */
export function savePeriodFilter(filter) {
  const def = getDefaultPeriodFilter();
  const normalized = {
    fromDate: filter?.fromDate || def.fromDate,
    toDate: filter?.toDate || def.toDate,
    fromTime: filter?.fromTime || def.fromTime,
    toTime: filter?.toTime || def.toTime,
  };
  localStorage.setItem(STORAGE_KEY_PERIOD_FILTER, JSON.stringify(normalized));
}

/**
 * EN: Re-export of {@link combineDateAndTime} under the legacy name
 *     `combineDateTime` — preserves the previous public API for screens that
 *     import from this module.
 * UA: Реекспорт {@link combineDateAndTime} під старим іменем `combineDateTime`
 *     для збереження попереднього публічного API для екранів.
 *
 * @param {string} dateStr
 * @param {string} [timeStr]
 * @returns {Date|null}
 */
export function combineDateTime(dateStr, timeStr) {
  return combineDateAndTime(dateStr, timeStr);
}

/**
 * EN: Returns true when the given value falls inside the filter's date/time
 *     range (inclusive). Accepts a number (ms), Date, or parseable string.
 * UA: Повертає true, якщо значення входить у діапазон фільтра (включно).
 *     Приймає число (ms), Date або рядок, який парситься у Date.
 * @param {number|Date|string} value
 * @param {PeriodFilter} filter
 * @returns {boolean}
 */
export function isWithinPeriodFilter(value, filter) {
  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dt.getTime())) return false;

  const from = combineDateAndTime(filter?.fromDate, filter?.fromTime || "00:00");
  const to = combineDateAndTime(filter?.toDate, filter?.toTime || "23:59");

  if (!from || !to) return true;
  return dt >= from && dt <= to;
}

/**
 * EN: Re-export of {@link _normalizeDateToISO} (from `./date-utils.js`) under
 *     the same name. Kept for callers that historically imported it from
 *     `./filters.js` to avoid touching every screen in this refactor pass.
 * UA: Реекспорт {@link _normalizeDateToISO} з `./date-utils.js` під тією ж
 *     назвою — щоб не правити усі екрани, які історично імпортували його
 *     звідси.
 *
 * @param {unknown} dateStr
 * @returns {string}
 */
export function normalizeDateToISO(dateStr) {
  return _normalizeDateToISO(dateStr);
}

/**
 * EN: Returns the mission-impact timestamp (ms) for a report. Uses the
 *     structured `fields` first; falls back to `createdAt` only as a safety net.
 * UA: Повертає ms позначки часу ураження для звіту. Спочатку бере зі
 *     структурних `fields`; `createdAt` — лише як запасний варіант.
 *
 * @param {{ fields?: import("./report-format.js").ReportFields, createdAt?: string }} report
 * @returns {number|null}
 */
export function getImpactTimestampForReport(report) {
  if (!report?.fields) return null;
  const ms = getImpactTimestampMs(report.fields);
  if (ms != null) return ms;
  const fb = Date.parse(report.createdAt || "");
  return Number.isNaN(fb) ? null : fb;
}
