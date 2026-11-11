/**
 * EN: Statistics computation for the journal screen — counting and summary text.
 *     Extracted from `screens/journal.js` to keep the screen module focused on UI.
 * UA: Обчислення статистики для екрану журналу — підрахунки і текст зведення.
 *     Виокремлено з `screens/journal.js`, щоб UI-модуль не розростався.
 * @module journal-stats
 */

import { normalizeFields } from "./report-format.js";
import { mapResultToCategory } from "./result-mapping.js";
import { isoToDdMmYyyy } from "./date-utils.js";

/**
 * EN: Increment a Map<string, number> counter for the given key.
 * UA: Збільшити лічильник у Map<string, number> для даного ключа.
 * @param {Map<string, number>} map
 * @param {string} key
 */
function inc(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

/**
 * EN: Compute aggregated statistics from a list of reports.
 * UA: Обчислити агреговану статистику зі списку звітів.
 * @param {import("./report-model.js").Report[]} reports
 * @returns {{ total: number, drones: Map<string,number>, ammo: Map<string,number>, missionTypes: Map<string,number>, results: Map<string,number>, allTexts: string[] }}
 */
export function computeStats(reports) {
  const drones = new Map();
  const ammo = new Map();
  const missionTypes = new Map();
  const results = new Map();
  const allTexts = [];

  for (const item of reports) {
    const f = normalizeFields(item.fields);
    allTexts.push(item.text);

    if (f.drone) inc(drones, f.drone);
    if (f.ammo) inc(ammo, f.ammo);
    if (f.missionType) inc(missionTypes, f.missionType);
    if (f.result) inc(results, mapResultToCategory(f.result));
  }

  return { total: reports.length, drones, ammo, missionTypes, results, allTexts };
}

/**
 * EN: Build human-readable summary text from computed stats and period info.
 * UA: Побудувати читабельний текст зведення з обчисленої статистики та періоду.
 * @param {{ total: number, drones: Map<string,number>, ammo: Map<string,number>, missionTypes: Map<string,number>, results: Map<string,number> }} stats
 * @param {{ fromDate: string, toDate: string, fromTime: string, toTime: string }} period
 * @returns {string}
 */
export function buildSummaryText(stats, period) {
  const fmtDate = (d) =>
    d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? isoToDdMmYyyy(d) : d || "";
  const fmtPeriod = (d, t) => {
    const datePart = fmtDate(d);
    return datePart ? (t ? `${datePart} ${t}` : datePart) : "";
  };
  const parts = [];
  parts.push(`Період: ${fmtPeriod(period.fromDate, period.fromTime)} → ${fmtPeriod(period.toDate, period.toTime)}`);
  parts.push("");
  parts.push(`Кількість вильотів: ${stats.total}`);

  const block = (label, map) => {
    if (!map.size) return;
    const entries = Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => `- ${name}: ${count}`)
      .join("\n");
    parts.push(`${label}:\n${entries}`);
  };

  block("Бортів", stats.drones);
  block("Боєприпасів", stats.ammo);
  block("Типів місій", stats.missionTypes);
  block("Результатів", stats.results);

  return parts.join("\n\n");
}
