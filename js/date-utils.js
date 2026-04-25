/**
 * EN: Pure date/time helpers shared between `filters.js` and `report-format.js`.
 *     No DOM, no storage, no side effects — safe to unit-test and reuse.
 * UA: Чисті функції для роботи з датою/часом, що використовуються у `filters.js`
 *     та `report-format.js`. Жодних DOM/storage/побічних ефектів — зручно тестувати.
 * @module date-utils
 */

/**
 * EN: Pads a number with a leading zero to two digits (e.g. 5 → "05").
 * UA: Доповнює число провідним нулем до двох цифр (напр. 5 → "05").
 * @param {number} n
 * @returns {string}
 */
function pad2(n) {
  return String(n).padStart(2, "0");
}

/**
 * EN: Normalizes a date string in "DD.MM.YYYY" or "YYYY-MM-DD" form to ISO "YYYY-MM-DD".
 *     Returns an empty string for unrecognised / empty input.
 * UA: Нормалізує дату вигляду "ДД.ММ.РРРР" або "РРРР-ММ-ДД" до ISO "РРРР-ММ-ДД".
 *     Повертає порожній рядок для порожнього чи нерозпізнаного вводу.
 * @param {unknown} dateStr — EN: raw date. / UA: вхідний рядок дати.
 * @returns {string} EN: ISO date or "". / UA: ISO-дата або "".
 */
export function normalizeDateToISO(dateStr) {
  const s = String(dateStr ?? "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return "";

  const dd = pad2(parseInt(m[1], 10));
  const mm = pad2(parseInt(m[2], 10));
  return `${m[3]}-${mm}-${dd}`;
}

/**
 * EN: Combines an ISO date and a "HH:MM" time string into a local `Date` object.
 *     Returns `null` when either piece is missing/invalid (so callers can short-circuit).
 * UA: Поєднує ISO-дату і час "ГГ:ХХ" у локальний `Date`. Повертає `null`, якщо
 *     хоч одне значення неприпустиме — аби викликач міг обробити помилку.
 * @param {string} dateStr — EN: ISO date "YYYY-MM-DD". / UA: ISO-дата "РРРР-ММ-ДД".
 * @param {string} [timeStr="00:00"] — EN: time "HH:MM". / UA: час "ГГ:ХХ".
 * @returns {Date|null}
 */
export function combineDateAndTime(dateStr, timeStr = "00:00") {
  if (!dateStr) return null;
  const safeTime = String(timeStr || "00:00");
  const dt = new Date(`${dateStr}T${safeTime}`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/**
 * EN: Returns today's date in the device's local timezone as "YYYY-MM-DD".
 *     Never uses UTC — around midnight `toISOString()` would shift to the previous day.
 * UA: Повертає сьогоднішню дату в локальному часовому поясі пристрою у форматі "РРРР-ММ-ДД".
 *     Не використовує UTC — біля півночі `toISOString()` зсуває на попередній день.
 * @returns {string}
 */
export function getLocalTodayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * EN: Converts an ISO date "YYYY-MM-DD" to the human "DD.MM.YYYY". Returns "" if invalid.
 * UA: Конвертує ISO-дату "РРРР-ММ-ДД" у людський формат "ДД.ММ.РРРР". "" якщо невірний ввід.
 * @param {string} iso
 * @returns {string}
 */
export function isoToDdMmYyyy(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}
