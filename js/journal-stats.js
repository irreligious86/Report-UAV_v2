/**
 * EN: Statistics computation for the journal screen — counting, KPI, summary text.
 *     Extracted from `screens/journal.js` to keep the screen module focused on UI.
 * UA: Обчислення статистики для екрану журналу — підрахунки, KPI, текст зведення.
 *     Виокремлено з `screens/journal.js`, щоб UI-модуль не розростався.
 * @module journal-stats
 */

import { normalizeFields } from "./report-format.js";
import { mapResultToCategory, isKpiHit, isKpiLoss } from "./result-mapping.js";
import { $ } from "./utils.js";
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
 * @returns {{ total: number, hits: number, loss: number, drones: Map<string,number>, ammo: Map<string,number>, missionTypes: Map<string,number>, results: Map<string,number>, allTexts: string[] }}
 */
export function computeStats(reports) {
  const drones = new Map();
  const ammo = new Map();
  const missionTypes = new Map();
  const results = new Map();
  let hits = 0;
  let loss = 0;
  const allTexts = [];

  for (const item of reports) {
    const f = normalizeFields(item.fields);
    allTexts.push(item.text);

    if (f.drone) inc(drones, f.drone);
    if (f.ammo) inc(ammo, f.ammo);
    if (f.missionType) inc(missionTypes, f.missionType);
    if (f.result) {
      inc(results, mapResultToCategory(f.result));
      if (isKpiHit(f.result)) hits += 1;
      if (isKpiLoss(f.result)) loss += 1;
    }
  }

  return { total: reports.length, hits, loss, drones, ammo, missionTypes, results, allTexts };
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

/**
 * EN: Update KPI dashboard widgets in the DOM.
 * UA: Оновити KPI-віджети на сторінці.
 * @param {number} total
 * @param {number} hits
 * @param {number} loss
 */
export function updateKPI(total, hits, loss) {
  const kpiTotal = $("kpiTotal");
  const kpiHits = $("kpiHits");
  const kpiLoss = $("kpiLoss");
  const kpiRate = $("kpiRate");
  if (kpiTotal) kpiTotal.textContent = String(total);
  if (kpiHits) kpiHits.textContent = String(hits);
  if (kpiLoss) kpiLoss.textContent = String(loss);
  if (kpiRate) {
    const rate = total > 0 ? Math.round((hits / total) * 100) : 0;
    kpiRate.textContent = rate + "%";
  }
}
