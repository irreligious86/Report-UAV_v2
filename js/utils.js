/**
 * DOM helpers and small utilities (dates, time, status, textarea).
 * Вспомогательные функции DOM и утилиты (даты, время, статус, textarea).
 * @module utils
 */

/**
 * Returns the DOM element by id.
 * Возвращает элемент DOM по id.
 * @param {string} id - Element id. Идентификатор элемента.
 * @returns {HTMLElement | null}
 */
export const $ = (id) => document.getElementById(id);

/**
 * Pads a number with leading zero to two digits (e.g. 5 → "05").
 * Дополняет число ведущим нулём до двух цифр (напр. 5 → "05").
 * @param {number} n - Number. Число.
 * @returns {string}
 */
export function pad2(n) {
  return String(n).padStart(2, "0");
}

/**
 * Returns current time as "HH:MM" (24h).
 * Возвращает текущее время в формате "ЧЧ:ММ" (24ч).
 * @returns {string}
 */
export function nowTime() {
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Останній календарний день («якір»), на який уже підлаштовано поле дати — щоб раз на нову добу оновити інтерфейс. */
const SESSION_DATE_ANCHOR_KEY = "uav_mission_date_calendar_anchor_v1";

/**
 * Поточна календарна дата в часовому поясі пристрою (не UTC), формат YYYY-MM-DD.
 * toISOString().slice(0,10) дає UTC і біля півночі дає «вчора» — тому лише локальні getFullYear/Month/Date.
 * @returns {string}
 */
export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Якщо настав новий календарний день або поле дати порожнє — підставляє сьогоднішню локальну дату.
 * Не чіпає дату, якщо користувач штучно вибрав інший день у межах тієї ж доби сесії (якір уже = сьогодні).
 */
export function refreshMissionDateForNewDay() {
  const today = todayISO();
  const dp = $("datePicker");
  if (!(dp instanceof HTMLInputElement)) return;

  const anchor = sessionStorage.getItem(SESSION_DATE_ANCHOR_KEY);
  if (anchor !== today) {
    dp.value = today;
    sessionStorage.setItem(SESSION_DATE_ANCHOR_KEY, today);
    return;
  }

  if (!String(dp.value || "").trim()) {
    dp.value = today;
  }
}

/**
 * Converts ISO date "YYYY-MM-DD" to "DD.MM.YYYY".
 * Преобразует дату "ГГГГ-ММ-ДД" в "ДД.ММ.ГГГГ".
 * @param {string} iso - ISO date string. Строка даты в формате ISO.
 * @returns {string} Formatted date or empty string if invalid. Форматированная дата или пустая строка при неверном вводе.
 */
export function isoToDDMMYYYY(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

/**
 * Sets the status message in the #status element.
 * Устанавливает текст статуса в элементе #status.
 * @param {string} msg - Message. Сообщение.
 */
export function setStatus(msg) {
  const el = $("status");
  if (el) el.textContent = msg || "";
}

/**
 * Adjusts textarea height to fit its content (no scrollbar).
 * Подстраивает высоту textarea под содержимое (без полосы прокрутки).
 * @param {HTMLTextAreaElement | null} el - Textarea element. Элемент textarea.
 */
export function autosizeTextarea(el) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = (el.scrollHeight + 2) + "px";
}
