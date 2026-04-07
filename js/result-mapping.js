/**
 * Result mapping helpers: convert raw user-entered result text
 * into normalized categories for statistics.
 * Конвенція: «ключ (деталі)» — KPI та категорія визначаються лише за ключем (текст до дужок).
 * @module result-mapping
 */

/**
 * Normalized result categories used by statistics.
 * These values should stay stable so old reports remain compatible.
 */
export const RESULT_CATEGORIES = Object.freeze({
  HIT: "Ураження",
  MISS: "Не уражено",
  BREAK: "Обрив",
  LOSS: "Втрата борта",
  CANCELED: "Скасовано",
  OTHER: "Інше",
});

/**
 * Exact full-string mappings (на ключ після відокремлення коментаря).
 * Keys are stored in lowercase to simplify comparisons.
 */
const EXACT_RESULT_MAP = new Map([
  ["ураження", RESULT_CATEGORIES.HIT],
  ["ураження цілі", RESULT_CATEGORIES.HIT],
  ["ураження укриття", RESULT_CATEGORIES.HIT],

  ["не уражено", RESULT_CATEGORIES.MISS],
  ["не знайдено цілі", RESULT_CATEGORIES.MISS],

  ["обрив", RESULT_CATEGORIES.BREAK],
  ["обрив біля цілі", RESULT_CATEGORIES.BREAK],

  ["втрата борта", RESULT_CATEGORIES.LOSS],
  ["розрядився акум", RESULT_CATEGORIES.LOSS],

  ["скасовано", RESULT_CATEGORIES.CANCELED],
]);

/**
 * Partial-match keyword rules on ключовій частині.
 * The first matching rule wins.
 */
const KEYWORD_RULES = [
  {
    keywords: ["ураження", "уражено"],
    category: RESULT_CATEGORIES.HIT,
  },
  {
    keywords: ["не уражено", "не знайдено", "не знайдено цілі"],
    category: RESULT_CATEGORIES.MISS,
  },
  {
    keywords: ["обрив"],
    category: RESULT_CATEGORIES.BREAK,
  },
  {
    keywords: ["втрата", "розрядився", "розрядився акум", "втрата борта"],
    category: RESULT_CATEGORIES.LOSS,
  },
  {
    keywords: ["скасовано", "відмінено"],
    category: RESULT_CATEGORIES.CANCELED,
  },
];

/**
 * Розбирає рядок результату: ключ для KPI (до дужок) та текст у дужках як коментар.
 * Очікуваний формат: «Ураження (знищення антени)» або без дужок — уесь рядок є ключем.
 * Якщо дужки «зламані» або ключ порожній — повертається весь рядок як ключ без деталей.
 *
 * @param {string} raw
 * @returns {{ keyPart: string, detail: string, full: string }}
 */
export function parseResultField(raw) {
  const full = String(raw || "").trim();
  if (!full) {
    return { keyPart: "", detail: "", full: "" };
  }

  const firstOpen = full.indexOf("(");
  if (firstOpen === -1) {
    return { keyPart: full, detail: "", full };
  }

  const lastClose = full.lastIndexOf(")");
  if (lastClose <= firstOpen || lastClose !== full.length - 1) {
    return { keyPart: full, detail: "", full };
  }

  const keyPart = full.slice(0, firstOpen).trim();
  const detail = full.slice(firstOpen + 1, lastClose).trim();

  if (!keyPart) {
    return { keyPart: full, detail: "", full };
  }

  return { keyPart, detail, full };
}

/**
 * Normalizes raw result text for robust comparison.
 * - trims spaces
 * - lowercases
 * - collapses repeated whitespace
 *
 * @param {string} raw
 * @returns {string}
 */
export function normalizeResultText(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Maps a raw result string to a normalized statistics category.
 * Спочатку виділяється ключова частина (до коментаря в дужках); класифікація тільки по ній,
 * щоб уточнення в дужках не змінювали категорію через випадкові ключові слова.
 *
 * Matching strategy:
 * 1. exact full-string match on key part
 * 2. partial keyword match on key part
 * 3. fallback to "Інше"
 *
 * @param {string} raw
 * @returns {string}
 */
export function mapResultToCategory(raw) {
  const { keyPart } = parseResultField(raw);
  const normalized = normalizeResultText(keyPart);

  if (!normalized) {
    return RESULT_CATEGORIES.OTHER;
  }

  const exact = EXACT_RESULT_MAP.get(normalized);
  if (exact) {
    return exact;
  }

  for (const rule of KEYWORD_RULES) {
    if (rule.keywords.some((keyword) => normalized.includes(keyword))) {
      return rule.category;
    }
  }

  return RESULT_CATEGORIES.OTHER;
}

/**
 * Чи відносить результат до «успішного» вильоту для KPI (підхід ураження).
 * @param {string} raw
 * @returns {boolean}
 */
export function isKpiHit(raw) {
  return mapResultToCategory(raw) === RESULT_CATEGORIES.HIT;
}

/**
 * Чи вважати результат губильним для лічильника втрат у журналі (втрата борта).
 * @param {string} raw
 * @returns {boolean}
 */
export function isKpiLoss(raw) {
  return mapResultToCategory(raw) === RESULT_CATEGORIES.LOSS;
}
