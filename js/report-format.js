/**
 * Report fields: form collection, normalisation, canonical text, mission
 * timestamp.
 *
 * EN:
 *   This is the schema definition for a report payload — the structured
 *   `fields` object. The textual representation (the multi-line string the
 *   user copies into Telegram / Signal / etc.) is ALWAYS derived from these
 *   fields via `buildReportText()` so there is exactly one source of truth.
 *   Filters, the map, statistics — everything reads structured fields, not
 *   text. The text is only for humans and clipboard.
 *
 *   Field semantics (single line each, since the user types them by hand):
 *     crew         — call-sign string. Free text, trimmed.
 *     crewCounter  — sortie counter inside the day, integer 1..25 or null
 *                    (null = the user did not use the counter for this
 *                    sortie). Used for ordering and as "Name (3)" suffix.
 *     date         — mission date in ISO "YYYY-MM-DD" (local timezone of
 *                    the device). NEVER UTC — see `utils.todayISO`.
 *     drone        — UAV name from the list or free text.
 *     missionType  — kind of mission ("Розвідка", "Ударна" …).
 *     takeoff      — takeoff time "HH:MM" (24h, local).
 *     impact       — impact / loss time "HH:MM" — used together with `date`
 *                    as the timestamp for filtering, statistics, map.
 *     coords       — full MGRS string "PREFIX EASTING NORTHING".
 *     ammo         — payload / weapon used.
 *     stream       — stream URL or `---` placeholder.
 *     result       — outcome free text. Format convention is
 *                    "Тип (деталі)", e.g. "Ураження (знищення антени)";
 *                    only the part before "(" drives KPI / categorisation
 *                    in `result-mapping.js`.
 *
 *   Why a single canonical text builder:
 *     - copy-to-clipboard, shared text on Telegram, the journal card view —
 *       all show the SAME exact bytes, regardless of where they came from
 *       (manual entry, edited later, restored from backup),
 *     - import from v1 archives can also rebuild text from the parsed
 *       fields, so legacy data ends up in the same canonical layout.
 *
 * UA:
 *   Це опис схеми payload звіту — структурний обʼєкт `fields`. Текстове
 *   представлення (багаторядковий стрінг, який користувач копіює в
 *   Telegram / Signal тощо) ЗАВЖДИ будується з цих полів через
 *   `buildReportText()` — щоб джерело правди було одне. Фільтри, мапа,
 *   статистика — все читає структурні поля, не текст. Текст — лише для
 *   людей і буфера обміну.
 *
 *   Семантика полів (один рядок кожне — бо користувач вводить їх вручну):
 *     crew         — позивний. Вільний текст, тримається.
 *     crewCounter  — лічильник вильоту в межах дня, ціле 1..25 або null
 *                    (null = користувач не використовував лічильник для
 *                    цього вильоту). Використовується для сортування і як
 *                    суфікс «Позивний (3)».
 *     date         — дата місії у ISO «YYYY-MM-DD» (локальний пояс
 *                    пристрою). НЕ UTC — див. `utils.todayISO`.
 *     drone        — назва БПЛА зі списку або довільний текст.
 *     missionType  — характер місії («Розвідка», «Ударна» …).
 *     takeoff      — час зльоту «HH:MM» (24 год, локальний).
 *     impact       — час ураження/втрати «HH:MM» — разом із `date` дає
 *                    timestamp для фільтрів, статистики, мапи.
 *     coords       — повний рядок MGRS «PREFIX EASTING NORTHING».
 *     ammo         — боєприпас / зброя.
 *     stream       — URL стріму або плейсхолдер `---`.
 *     result       — текст результату. Конвенція — «Тип (деталі)»,
 *                    наприклад «Ураження (знищення антени)»; лише
 *                    частина до «(» визначає KPI / категорію в
 *                    `result-mapping.js`.
 *
 *   Чому єдиний канонічний будівельник тексту:
 *     - копіювання у буфер, шеринг у Telegram, картка журналу — усе
 *       показує ОДНАКОВІ байти, незалежно від походження (ручний ввід,
 *       пізніше редагування, відновлення з бекапу),
 *     - імпорт з v1-архівів теж відбудовує текст із розпарсених полів —
 *       старі дані лягають у той самий канонічний макет.
 *
 * @module report-format
 */

import { STREAM_PLACEHOLDER } from "./constants.js";
import { $, isoToDDMMYYYY } from "./utils.js";
import { normalizeDateToISO, normalizeTime24, combineDateAndTime } from "./date-utils.js";
import { parseCounterRaw, validateCrewOrError } from "./counter.js";
import { buildCoordsOrError } from "./coords.js";

/**
 * @typedef {Object} ReportFields
 * @property {string} crew — EN: callsign, free text. UA: позивний, вільний текст.
 * @property {number|null} crewCounter — EN: sortie number 1..25 or null. UA: номер вильоту 1..25 або null.
 * @property {string} date — EN: ISO "YYYY-MM-DD" (local). UA: ISO «РРРР-ММ-ДД» (локально).
 * @property {string} drone
 * @property {string} missionType
 * @property {string} takeoff — EN: "HH:MM" (24h, local). UA: «ГГ:ХХ» (24 год, локально).
 * @property {string} impact — EN: "HH:MM" used as the mission timestamp. UA: «ГГ:ХХ», timestamp місії.
 * @property {string} coords — EN: full MGRS string. UA: повний MGRS-рядок.
 * @property {string} ammo
 * @property {string} stream — EN: URL or "---" placeholder. UA: URL або плейсхолдер «---».
 * @property {string} result — EN: free text "Тип (деталі)". UA: вільний текст «Тип (деталі)».
 */

/**
 * EN: Returns a fresh empty `ReportFields` object — useful when the parser
 *     can't recognise the v1 text and we need a sane starting shape.
 * UA: Повертає новий порожній `ReportFields` — стане в нагоді, коли
 *     парсер не впізнав v1-текст і нам потрібна базова форма.
 * @returns {ReportFields}
 */
export function emptyFields() {
  return {
    crew: "",
    crewCounter: null,
    date: "",
    drone: "",
    missionType: "",
    takeoff: "",
    impact: "",
    coords: "",
    ammo: "",
    stream: "",
    result: "",
  };
}

/**
 * EN: Coerces an arbitrary value into a clean `ReportFields`. Strings are
 *     trimmed; non-strings become "". `crewCounter` is parsed into an
 *     integer or null. Empty `stream` defaults to `STREAM_PLACEHOLDER`
 *     ("---") so the canonical text is never missing the line.
 *     This function is the entry point that protects the rest of the app
 *     from "raw" data — used in createReport, applyFieldsUpdate, every
 *     import path, every queue message build.
 * UA: Зводить довільне значення до коректного `ReportFields`. Рядки
 *     тримаються; не-рядки стають "". `crewCounter` парситься у ціле або
 *     null. Порожній `stream` стає `STREAM_PLACEHOLDER` («---») — щоб
 *     канонічний текст ніколи не лишився без рядка.
 *     Це точка входу, що захищає решту коду від "сирих" даних —
 *     використовує createReport, applyFieldsUpdate, кожен шлях імпорту,
 *     кожна побудова повідомлення для черги.
 * @param {unknown} fields
 * @returns {ReportFields}
 */
export function normalizeFields(fields) {
  const f =
    fields && typeof fields === "object" && !Array.isArray(fields) ? fields : {};
  const crew = typeof f.crew === "string" ? f.crew.trim() : "";
  let crewCounter = null;
  if (f.crewCounter != null && f.crewCounter !== "") {
    const n = Number(f.crewCounter);
    crewCounter = Number.isFinite(n) ? Math.floor(n) : null;
  }
  return {
    crew,
    crewCounter,
    date: typeof f.date === "string" ? f.date.trim() : "",
    drone: typeof f.drone === "string" ? f.drone.trim() : "",
    missionType: typeof f.missionType === "string" ? f.missionType.trim() : "",
    takeoff: typeof f.takeoff === "string" ? f.takeoff.trim() : "",
    impact: typeof f.impact === "string" ? f.impact.trim() : "",
    coords: typeof f.coords === "string" ? f.coords.trim() : "",
    ammo: typeof f.ammo === "string" ? f.ammo.trim() : "",
    stream:
      typeof f.stream === "string"
        ? (f.stream.trim() || STREAM_PLACEHOLDER)
        : STREAM_PLACEHOLDER,
    result: typeof f.result === "string" ? f.result.trim() : "",
  };
}

/**
 * EN: Builds the canonical multi-line report text from `fields`. Layout:
 *
 *     Альфа (3)
 *     15.03.2024
 *     Борт: Mavic 3
 *     Характер: Ударна
 *     Час зльоту: 14:30
 *     Час ураження/втрати: 14:55
 *     Координати: 36U YA 12345 67890
 *     Боєприпас: ВОГ-17
 *     Стрім: ---
 *     Результат: Ураження (знищення антени)
 *
 *   - First line: `crew` plus optional `(N)` counter.
 *   - Second line: date in DD.MM.YYYY (human readable, local).
 *   - Subsequent lines: prefixed key:value pairs (Border-line v1 format).
 *
 *   This exact layout is also expected by `crypto/legacy-import.js` when
 *   parsing v1 archives — keeping them in lockstep ensures lossless
 *   round-trips between v1 and v2.
 *
 * UA: Будує канонічний багаторядковий текст звіту з `fields`. Розкладка:
 *
 *     Альфа (3)
 *     15.03.2024
 *     Борт: Mavic 3
 *     Характер: Ударна
 *     Час зльоту: 14:30
 *     Час ураження/втрати: 14:55
 *     Координати: 36U YA 12345 67890
 *     Боєприпас: ВОГ-17
 *     Стрім: ---
 *     Результат: Ураження (знищення антени)
 *
 *   - Перший рядок: `crew` плюс необов’язковий лічильник `(N)`.
 *   - Другий рядок: дата у DD.MM.YYYY (для людини, локально).
 *   - Далі — пари «ключ: значення» з префіксами (формат v1).
 *
 *   Цю саму розкладку очікує `crypto/legacy-import.js`, парсячи v1-архіви.
 *   Тримання їх синхронно гарантує round-trip без втрат між v1 і v2.
 *
 * @param {ReportFields} fields
 * @returns {string}
 */
export function buildReportText(fields) {
  const f = normalizeFields(fields);
  const crewLine =
    f.crewCounter != null ? `${f.crew} (${f.crewCounter})` : f.crew || "";
  const dateHuman = f.date ? isoToDDMMYYYY(f.date) : "";
  const stream = f.stream || STREAM_PLACEHOLDER;
  return `${crewLine}\n${dateHuman}\nБорт: ${f.drone}\nХарактер: ${f.missionType}\nЧас зльоту: ${f.takeoff}\nЧас ураження/втрати: ${f.impact}\nКоординати: ${f.coords}\nБоєприпас: ${f.ammo}\nСтрім: ${stream}\nРезультат: ${f.result}`;
}

/**
 * EN: Reads the main report form (`#screen-main`) into structured fields.
 *     Validates crew via `validateCrewOrError` and coordinates via
 *     `buildCoordsOrError` — returns null when invalid (inline errors shown).
 *     Counter is parsed by `parseCounterRaw`; empty input → null.
 *     The caller (`generate.js`) treats `null` as "abort generation".
 * UA: Зчитує головну форму звіту (`#screen-main`) у структурні поля.
 *     Перевіряє екіпаж через `validateCrewOrError` і координати через
 *     `buildCoordsOrError` — при помилці повертає null (помилки біля полів).
 *     Лічильник розбирає `parseCounterRaw`; порожнє → null.
 *     Викликач (`generate.js`) трактує `null` як «припинити генерацію».
 * @returns {ReportFields|null}
 */
export function collectFieldsFromMainForm() {
  const crew = validateCrewOrError();
  if (!crew) return null;

  const coords = buildCoordsOrError();
  if (!coords) return null;

  const parsedCounter = parseCounterRaw($("crewCounter").value);
  return {
    crew,
    crewCounter: parsedCounter.empty ? null : parsedCounter.value,
    date: normalizeDateToISO(($("datePicker").value || "").trim()),
    drone: $("drone").value || "",
    missionType: $("missionType").value || "",
    takeoff: normalizeTime24($("takeoff").value || ""),
    impact: normalizeTime24($("impact").value || ""),
    coords,
    ammo: $("ammo").value || "",
    stream: $("stream").value || STREAM_PLACEHOLDER,
    result: $("result").value || "",
  };
}

/**
 * EN: Returns the mission "impact" instant in ms (epoch). This is the
 *     timestamp used by the journal period filter, KPI calculations and
 *     the map. We deliberately use STRUCTURED `date + impact` (not the
 *     text or `createdAt`) so editing a report's mission time correctly
 *     moves it on the timeline. Returns null when either piece is missing.
 * UA: Повертає момент «ураження» у мс (epoch). Це той timestamp, що
 *     використовує фільтр періоду в журналі, обчислення KPI та мапа.
 *     Свідомо беремо СТРУКТУРНІ `date + impact` (не текст і не `createdAt`)
 *     — щоб редагування часу місії коректно зсувало звіт на таймлайні.
 *     null, якщо хоч одне з полів відсутнє.
 * @param {ReportFields} fields
 * @returns {number|null}
 */
export function getImpactTimestampMs(fields) {
  const f = normalizeFields(fields);
  const iso = normalizeDateToISO(f.date || "");
  const time = normalizeTime24(f.impact || "");
  if (!iso || !time) return null;
  const dt = combineDateAndTime(iso, time);
  if (!dt) return null;
  const ms = dt.getTime();
  return Number.isNaN(ms) ? null : ms;
}
