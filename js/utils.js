/**
 * Tiny DOM / date / status helpers used everywhere.
 *
 * EN: This module is intentionally trivial — pure helpers, no domain logic.
 *     If you find yourself adding business rules here, you probably want
 *     `report-format.js` or `screens/*` instead.
 * UA: Цей модуль свідомо тривіальний — лише допоміжні функції без домену.
 *     Якщо тут зʼявляється бізнес-логіка, її місце, ймовірно, у
 *     `report-format.js` або `screens/*`.
 *
 * @module utils
 */

import { isoToDdMmYyyy, syncDateInputToUiFormat } from "./date-utils.js";
import { syncNativePickerFromDisplay } from "./ui-native-datetime.js";

/**
 * EN: Shorthand for `document.getElementById`. The whole codebase uses `$`
 *     to read DOM nodes — keep it that way for grep-ability.
 * UA: Скорочення для `document.getElementById`. У всьому коді DOM-вузли
 *     читаються через `$` — лишаємо так заради зручного пошуку.
 * @param {string} id
 * @returns {HTMLElement | null}
 */
export const $ = (id) => document.getElementById(id);

/**
 * EN: Pads a number with a leading zero to two digits ("5" → "05").
 *     Used by date / time formatters across the app.
 * UA: Доповнює число провідним нулем до двох цифр («5» → «05»).
 *     Використовують форматтери дати/часу по всьому застосунку.
 * @param {number} n
 * @returns {string}
 */
export function pad2(n) {
  return String(n).padStart(2, "0");
}

/**
 * EN: Returns the current local time as "HH:MM" (24h). Used by the «Зараз»
 *     button next to takeoff / impact time fields.
 * UA: Повертає поточний локальний час у форматі «ГГ:ХХ» (24 год). Викликає
 *     кнопка «Зараз» біля полів зльоту / ураження.
 * @returns {string}
 */
export function nowTime() {
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * EN: sessionStorage anchor — the calendar day for which the date field
 *     was last refreshed. We compare against today on each visibility /
 *     screen change to detect midnight crossing.
 * UA: Якір у sessionStorage — календарний день, для якого востаннє
 *     оновлювали поле дати. Порівнюємо з today при кожній зміні
 *     видимості / екрану — щоб ловити перехід через північ.
 */
const SESSION_DATE_ANCHOR_KEY = "uav_mission_date_calendar_anchor_v1";

/**
 * EN: Today's date in the device's local timezone, formatted "YYYY-MM-DD".
 *     We deliberately do NOT use `toISOString().slice(0, 10)` because that
 *     converts to UTC and around midnight gives "yesterday" in eastern
 *     timezones — which is wrong for a mission journal.
 * UA: Сьогоднішня дата в локальному часовому поясі пристрою у форматі
 *     «РРРР-ММ-ДД». Свідомо НЕ використовуємо `toISOString().slice(0,10)`
 *     — біля півночі у східних поясах це дасть «вчора», що неправильно
 *     для журналу місій.
 * @returns {string}
 */
export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * EN: Refreshes the date picker only when a new calendar day has begun
 *     (or the field was empty). If the user manually picked a different
 *     day within the same session, we leave that choice intact —
 *     `SESSION_DATE_ANCHOR_KEY` already equals today and the function
 *     does nothing.
 * UA: Оновлює поле дати тільки коли настав новий календарний день (або
 *     поле порожнє). Якщо користувач у межах тієї самої сесії вручну
 *     обрав іншу дату — лишаємо її, бо `SESSION_DATE_ANCHOR_KEY` вже
 *     дорівнює сьогодні й функція нічого не робить.
 */
export function refreshMissionDateForNewDay() {
  const today = todayISO();
  const todayUi = isoToDDMMYYYY(today);
  const dp = $("datePicker");
  if (!(dp instanceof HTMLInputElement)) return;

  const anchor = sessionStorage.getItem(SESSION_DATE_ANCHOR_KEY);
  if (anchor !== today) {
    dp.value = todayUi;
    sessionStorage.setItem(SESSION_DATE_ANCHOR_KEY, today);
    return;
  }

  if (!String(dp.value || "").trim()) {
    dp.value = todayUi;
    return;
  }

  syncDateInputToUiFormat(dp);
  syncNativePickerFromDisplay(dp);
}

/**
 * EN: Converts ISO date "YYYY-MM-DD" to human "DD.MM.YYYY". Returns "" on
 *     malformed input — the caller decides how to render an empty date.
 * UA: Конвертує ISO-дату «РРРР-ММ-ДД» у людський формат «ДД.ММ.РРРР».
 *     Повертає "", коли ввід некоректний — викликач сам вирішує, як
 *     показати порожню дату.
 * @param {string} iso
 * @returns {string}
 */
export function isoToDDMMYYYY(iso) {
  return isoToDdMmYyyy(iso);
}

/**
 * EN: Writes a short status string into `#status` (clears on empty input).
 *     Used as a single-line notification area on the form screen.
 * UA: Пише короткий рядок статусу у `#status` (на порожній вхід — очищає).
 *     Слугує однорядковою областю сповіщень на екрані форми.
 * @param {string} msg
 */
export function setStatus(msg) {
  const el = $("status");
  if (el) el.textContent = msg || "";
}

/**
 * EN: Resizes a textarea to fit its content (no scrollbar). Called once
 *     after building the canonical report text into `#output` so the
 *     entire report is visible without scrolling.
 * UA: Підлаштовує висоту textarea під вміст (без смуги прокрутки).
 *     Викликається після запису канонічного тексту у `#output` — щоб
 *     увесь звіт було видно без прокрутки.
 * @param {HTMLTextAreaElement | null} el
 */
export function autosizeTextarea(el) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = (el.scrollHeight + 2) + "px";
}
