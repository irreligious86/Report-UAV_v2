/**
 * Legacy v1 archive importer — converts old "uav-reports-export" payloads.
 *
 * EN:
 *   The previous version of the app (Report-UAV v1) stored a report as just
 *   `{ id, ts, text }` — no structured fields. Some users still have v1
 *   encrypted backups they want to restore into v2.
 *
 *   This module:
 *     1) recognises a v1 payload (by `kind` or by the inner shape),
 *     2) parses each `text` back into v2 `fields` using the same line layout
 *        that `report-format.buildReportText` produces in v2 (so the round
 *        trip is stable),
 *     3) wraps the result in a v2 Report (DRAFT status, locked = false).
 *
 *   If the v1 text doesn't match the structured layout (free-form note),
 *   we fall back to filling crew + date and dumping the whole text into
 *   the `result` field, so nothing is lost.
 *
 * UA:
 *   Попередня версія застосунку (Report-UAV v1) зберігала звіт як
 *   `{ id, ts, text }` — без структурованих полів. Дехто з користувачів
 *   досі має зашифровані v1-бекапи, які треба відновити у v2.
 *
 *   Цей модуль:
 *     1) розпізнає v1-payload (за `kind` або за внутрішньою формою),
 *     2) парсить кожен `text` назад у поля v2 — використовуючи той самий
 *        рядковий шаблон, що й `report-format.buildReportText` у v2 (тож
 *        round-trip стабільний),
 *     3) загортає результат у v2 Report (статус DRAFT, locked = false).
 *
 *   Якщо v1-текст не підходить під шаблон (вільна нотатка) — заповнюємо
 *   crew і date, а весь текст кладемо у `result`. Так нічого не губиться.
 *
 * @module crypto/legacy-import
 */

import { STREAM_PLACEHOLDER } from "../constants.js";
import { emptyFields, normalizeFields, buildReportText } from "../report-format.js";
import { generateReportId, SYNC_STATUS } from "../report-model.js";

/** EN: `kind` field used by v1 encrypted archives. UA: `kind` для зашифрованих архівів v1. @type {string} */
export const LEGACY_EXPORT_KIND = "uav-reports-export";

/* EN: v1 line prefixes — must match what `report-format.buildReportText` emits
 *     so v1 → v2 conversion is the inverse of v2 text rendering.
 * UA: Префікси рядків v1 — мають збігатися з тим, що віддає
 *     `report-format.buildReportText`, тоді конверсія v1 → v2 є оберненою. */
const PREFIX_DRONE = "Борт:";
const PREFIX_MISSION = "Характер:";
const PREFIX_TAKEOFF = "Час зльоту:";
const PREFIX_IMPACT = "Час ураження/втрати:";
const PREFIX_COORDS = "Координати:";
const PREFIX_AMMO = "Боєприпас:";
const PREFIX_STREAM = "Стрім:";
const PREFIX_RESULT = "Результат:";

/**
 * EN: If a line starts with the given prefix — return its trailing text
 *     trimmed; otherwise an empty string.
 * UA: Якщо рядок починається з префікса — повертає трим-частину після
 *     нього; інакше — порожній рядок.
 * @param {string} line
 * @param {string} prefix
 * @returns {string}
 */
function valueAfterPrefix_(line, prefix) {
  const s = String(line || "");
  if (!s.startsWith(prefix)) return "";
  return s.slice(prefix.length).trim();
}

/**
 * EN: Searches `lines` for the first one starting with `prefix` and returns
 *     its trailing value. Empty string when none match.
 * UA: Шукає у `lines` перший рядок, який починається з `prefix`, і повертає
 *     його хвостове значення. Порожній рядок — якщо не знайдено.
 * @param {string[]} lines
 * @param {string} prefix
 * @returns {string}
 */
function firstLineValue_(lines, prefix) {
  for (const line of lines) {
    if (line.startsWith(prefix)) return valueAfterPrefix_(line, prefix);
  }
  return "";
}

/**
 * EN: Converts a "DD.MM.YYYY" date string to ISO "YYYY-MM-DD". Returns "" on
 *     any malformed input — caller decides what to do with that.
 * UA: Конвертує рядок дати "DD.MM.YYYY" у ISO "YYYY-MM-DD". Повертає ""
 *     при будь-якому некоректному вводі — рішення приймає викликач.
 * @param {string} raw
 * @returns {string}
 */
function ddmmyyyyToIso_(raw) {
  const s = String(raw || "").trim();
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return "";
  const dd = String(parseInt(m[1], 10)).padStart(2, "0");
  const mm = String(parseInt(m[2], 10)).padStart(2, "0");
  return `${m[3]}-${mm}-${dd}`;
}

/**
 * EN: Parses the first line of a v1 text. v2 emits either "Дакар" or
 *     "Дакар (3)" depending on whether the user used a counter. We extract
 *     both into structured fields.
 * UA: Парсить перший рядок v1-тексту. v2 пише або «Дакар», або «Дакар (3)»,
 *     залежно від того, використано лічильник. Витягуємо обидва значення
 *     у структуровані поля.
 * @param {string} raw
 * @returns {{ crew: string, crewCounter: number|null }}
 */
function parseCrewLine_(raw) {
  const line = String(raw || "").trim();
  if (!line) return { crew: "", crewCounter: null };
  const m = line.match(/^(.+?)\s*\((\d+)\)\s*$/);
  if (m) {
    const n = Number(m[2]);
    return {
      crew: m[1].trim(),
      crewCounter: Number.isFinite(n) ? Math.floor(n) : null,
    };
  }
  return { crew: line, crewCounter: null };
}

/**
 * EN: Parses a v1 report text into structured v2 `fields`. Two paths:
 *       - Structured: at least one of the prefix lines (Борт / Характер /
 *         Час … / Координати / Боєприпас / Стрім / Результат) is present →
 *         we extract every prefix line and reconstruct fields.
 *       - Free-form: nothing matches the structured layout → fields are
 *         empty except `crew`, `date` and `result` (which receives the
 *         entire original text), so the user does not lose data.
 * UA: Парсить v1-текст звіту у структуровані `fields` v2. Дві гілки:
 *       - Структурований текст: є хоча б один рядок із префіксом
 *         (Борт / Характер / Час … / Координати / Боєприпас / Стрім /
 *         Результат) — витягуємо кожне поле.
 *       - Вільна форма: жоден префікс не знайдено — поля порожні, крім
 *         `crew`, `date` і `result` (туди потрапляє увесь оригінальний
 *         текст), щоб дані не загубилися.
 * @param {string} rawText
 * @returns {import("../report-format.js").ReportFields}
 */
export function parseLegacyExportTextToFields(rawText) {
  const normalized = String(rawText || "").replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines.length < 2) {
    const f = emptyFields();
    f.result = normalized.trim();
    return normalizeFields(f);
  }

  const crewPart = parseCrewLine_(lines[0]);
  const dateIso = ddmmyyyyToIso_(lines[1]);
  const rest = lines.slice(2);

  const drone = firstLineValue_(rest, PREFIX_DRONE);
  const missionType = firstLineValue_(rest, PREFIX_MISSION);
  const takeoff = firstLineValue_(rest, PREFIX_TAKEOFF);
  const impact = firstLineValue_(rest, PREFIX_IMPACT);
  const coords = firstLineValue_(rest, PREFIX_COORDS);
  const ammo = firstLineValue_(rest, PREFIX_AMMO);
  let stream = firstLineValue_(rest, PREFIX_STREAM);
  const result = firstLineValue_(rest, PREFIX_RESULT);

  const hasStructure =
    drone ||
    missionType ||
    takeoff ||
    impact ||
    coords ||
    ammo ||
    stream ||
    result;

  if (!hasStructure) {
    const f = emptyFields();
    f.crew = crewPart.crew;
    f.crewCounter = crewPart.crewCounter;
    f.date = dateIso;
    f.result = normalized.trim();
    return normalizeFields(f);
  }

  if (!stream) stream = STREAM_PLACEHOLDER;

  return normalizeFields({
    crew: crewPart.crew,
    crewCounter: crewPart.crewCounter,
    date: dateIso,
    drone,
    missionType,
    takeoff,
    impact,
    coords,
    ammo,
    stream,
    result,
  });
}

/**
 * EN: True when an item looks like a v1 report record: non-empty `text`,
 *     no structured `fields`, no v2 `createdAt`. Used for "guess by shape"
 *     when the envelope's `kind` is missing or wrong.
 * UA: True, якщо запис схожий на v1: є `text`, немає `fields`, немає
 *     `createdAt`. Використовується для розпізнавання за формою, коли в
 *     обгортці немає або зіпсований `kind`.
 * @param {unknown} item
 * @returns {boolean}
 */
export function isLegacyReportItemShape(item) {
  if (!item || typeof item !== "object") return false;
  const o = /** @type {Record<string, unknown>} */ (item);
  if (typeof o.text !== "string" || !String(o.text).trim()) return false;
  if (o.fields && typeof o.fields === "object") return false;
  if (typeof o.createdAt === "string" && o.createdAt.trim()) return false;
  return true;
}

/**
 * EN: True when the decrypted payload is a v1 encrypted archive, recognised
 *     explicitly by `kind === LEGACY_EXPORT_KIND` and a `reports` array.
 * UA: True, якщо розшифрований payload — v1 архів за явним `kind` та
 *     наявністю масиву `reports`.
 * @param {unknown} payload
 * @returns {boolean}
 */
export function isLegacyEncryptedExport(payload) {
  if (!payload || typeof payload !== "object") return false;
  const p = /** @type {Record<string, unknown>} */ (payload);
  return p.kind === LEGACY_EXPORT_KIND && Array.isArray(p.reports);
}

/**
 * EN: Recognises a v1 archive by inner shape — used when the envelope has
 *     no `kind` field or it's wrong, but every `reports[i]` has the v1 shape.
 * UA: Розпізнає v1-архів за внутрішньою формою — коли поля `kind` немає
 *     або воно «криве», але кожен елемент `reports[i]` має v1-форму.
 * @param {unknown} payload
 * @returns {boolean}
 */
export function isLegacyExportByReportShapes(payload) {
  if (!payload || typeof payload !== "object") return false;
  const p = /** @type {Record<string, unknown>} */ (payload);
  if (!Array.isArray(p.reports) || p.reports.length === 0) return false;
  return p.reports.every(isLegacyReportItemShape);
}

/**
 * EN: Converts one v1 record `{ id?, ts?, text }` into a fresh v2 Report:
 *     parses the text into fields, rebuilds the canonical `text` from those
 *     fields, generates a new id when missing, defaults timestamps to "now"
 *     when v1 had no `ts`. Status is DRAFT — restored archives are not yet
 *     "in Google Sheets".
 * UA: Конвертує один v1-запис `{ id?, ts?, text }` у новий v2 Report:
 *     парсить текст у `fields`, заново будує канонічний `text` з полів,
 *     генерує id, коли його немає, ставить часи на «зараз» при відсутності
 *     `ts`. Статус — DRAFT, оскільки відновлений архів ще не «в таблиці».
 * @param {unknown} item
 * @returns {import("../report-model.js").Report|null}
 */
function legacyItemToReport_(item) {
  if (!item || typeof item !== "object") return null;
  const o = /** @type {Record<string, unknown>} */ (item);
  if (typeof o.text !== "string" || !String(o.text).trim()) return null;

  const id =
    typeof o.id === "string" && o.id.trim() ? String(o.id).trim() : generateReportId();
  const tsRaw = typeof o.ts === "string" && o.ts.trim() ? String(o.ts).trim() : "";
  const ts = tsRaw || new Date().toISOString();

  const fields = parseLegacyExportTextToFields(o.text);
  const text = buildReportText(fields);

  return {
    id,
    createdAt: ts,
    updatedAt: ts,
    publishedAt: null,
    version: 1,
    syncStatus: SYNC_STATUS.DRAFT,
    locked: false,
    sendAfter: null,
    sheetRowId: null,
    fields,
    text,
  };
}

/**
 * EN: Converts a v1 reports array to v2 Reports, dropping records that are
 *     unparseable (e.g. completely empty `text`).
 * UA: Конвертує масив v1-записів у v2 Reports, відкидаючи нерозбірливі
 *     (наприклад, з порожнім `text`).
 * @param {unknown[]} reports
 * @returns {import("../report-model.js").Report[]}
 */
export function legacyReportItemsToReports(reports) {
  const out = [];
  for (const item of reports) {
    const r = legacyItemToReport_(item);
    if (r) out.push(r);
  }
  return out;
}

/**
 * EN: Public entry — turns a decrypted v1 envelope (or v1-shaped object)
 *     into a list of v2 Reports. Throws if no convertible records are found
 *     so the user gets a clear error rather than a silent empty import.
 * UA: Публічна точка входу — перетворює розшифрований v1-конверт (або
 *     v1-форму) на список v2-звітів. Кидає виняток, якщо нічого конвертувати
 *     не вдалось — щоб користувач побачив чітку помилку, а не «імпорт
 *     прошов, але нічого не додалось».
 * @param {unknown} payload
 * @returns {import("../report-model.js").Report[]}
 */
export function legacyEncryptedExportToReports(payload) {
  const p =
    payload && typeof payload === "object"
      ? /** @type {{ reports?: unknown[] }} */ (payload)
      : null;
  const list = Array.isArray(p?.reports) ? p.reports : [];
  const out = legacyReportItemsToReports(list);
  if (!out.length) {
    throw new Error("У файлі немає коректних записів старого формату.");
  }
  return out;
}
