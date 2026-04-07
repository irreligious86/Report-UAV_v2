/**
 * Journal & statistics: structured reports, sync actions, field-based stats.
 * @module screens/journal
 */

import { $, isoToDDMMYYYY, setStatus } from "../utils.js";
import { copyText } from "../clipboard.js";
import {
  listReports,
  deleteReportsByIds,
  getReport,
  trySendReportNow,
  scheduleSend,
  cancelScheduledSend,
  cancelQueuedReport,
  updateReportFieldsDraft,
  applyCorrectionAfterSent,
  enqueueReportsForSheetSync,
  SYNC_STATUS,
} from "../report-actions.js";
import { REPORTS_LIMIT } from "../constants.js";
import { normalizeFields } from "../report-format.js";
import { loadSyncSettings } from "../sync-settings.js";
import {
  loadPeriodFilter,
  savePeriodFilter,
  isWithinPeriodFilter,
  getImpactTimestampForReport,
} from "../filters.js";
import { mapResultToCategory, isKpiHit, isKpiLoss } from "../result-mapping.js";

let initialized = false;

/** Розгорнутий список карток журналу (майже на весь екран). */
let journalListExpanded = false;

// ── Utility helpers ───────────────────────────────────────────────────────────

/** Copy text to clipboard with status message. */
async function copyTextSmart(text) {
  const ok = await copyText(text);
  setStatus(ok ? "Скопійовано." : "Помилка копіювання.");
}

/** Increment a Map<string, number> counter for key. */
function inc(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

/** Update KPI dashboard widgets. */
function updateKPI(total, hits, loss) {
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

/** @type {(() => void) | null} */
let journalLayoutResizeBound = null;

function updateJournalExpandedGeometry() {
  const panel = $("journalListPanel");
  const titleEl = $("title");
  if (!panel || !journalListExpanded) return;
  if (titleEl instanceof HTMLElement) {
    const topPx = Math.ceil(titleEl.getBoundingClientRect().bottom + 4);
    panel.style.setProperty("--journal-fs-top", `${topPx}px`);
  }
  const card = panel.closest(".card");
  if (card instanceof HTMLElement) {
    const cr = card.getBoundingClientRect();
    const pad = 12;
    panel.style.setProperty("--journal-inset-left", `${cr.left + pad}px`);
    panel.style.setProperty(
      "--journal-inset-right",
      `${Math.max(0, window.innerWidth - cr.right + pad)}px`
    );
  } else {
    panel.style.setProperty("--journal-inset-left", "12px");
    panel.style.setProperty("--journal-inset-right", "12px");
  }
}

/** @type {import("../report-model.js").Report|null} */
let editingReport = null;

/** @type {"draft"|"correction"} */
let editingMode = "draft";

const FIELD_DEF = [
  { key: "crew", label: "Екіпаж", type: "text" },
  { key: "crewCounter", label: "Лічильник", type: "number" },
  { key: "date", label: "Дата", type: "date" },
  { key: "drone", label: "Борт", type: "text" },
  { key: "missionType", label: "Характер", type: "text" },
  { key: "takeoff", label: "Час зльоту", type: "time" },
  { key: "impact", label: "Час ураження", type: "time" },
  { key: "coords", label: "Координати", type: "text" },
  { key: "ammo", label: "Боєприпас", type: "text" },
  { key: "stream", label: "Стрім", type: "text" },
  { key: "result", label: "Результат", type: "text" },
];

/**
 * @param {import("../report-model.js").Report[]} reports
 */
function filterReportsForJournal(reports, period, searchStr) {
  const q = (searchStr || "").trim().toLowerCase();
  return reports.filter((r) => {
    const impactMs = getImpactTimestampForReport(r);
    if (impactMs == null) return false;
    if (!isWithinPeriodFilter(impactMs, period)) return false;
    if (q) {
      const hay = (r.text || "").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function fmtIso(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("uk-UA", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function statusBadgeClass(st) {
  const m = {
    [SYNC_STATUS.DRAFT]: "status-draft",
    [SYNC_STATUS.SCHEDULED]: "status-scheduled",
    [SYNC_STATUS.QUEUED]: "status-queued",
    [SYNC_STATUS.SENDING]: "status-sending",
    [SYNC_STATUS.SENT]: "status-sent",
    [SYNC_STATUS.RESYNC_REQUIRED]: "status-resync",
    [SYNC_STATUS.ERROR]: "status-error",
    [SYNC_STATUS.LOCKED]: "status-locked",
  };
  return m[st] || "status-draft";
}

/** Підказка до кольорової крапки статусу синхронізації. */
function syncStatusTitle(st) {
  const m = {
    [SYNC_STATUS.DRAFT]: "Чернетка — ще не надіслано в Google Таблицю",
    [SYNC_STATUS.SCHEDULED]: "Відправка запланована",
    [SYNC_STATUS.QUEUED]: "У черзі на відправку",
    [SYNC_STATUS.SENDING]: "Надсилається…",
    [SYNC_STATUS.SENT]: "Записано в Google Таблицю",
    [SYNC_STATUS.RESYNC_REQUIRED]:
      "Є зміни, яких немає в таблиці — натисніть «Надіслати зміни» (помаранчевий ≠ уже в таблиці)",
    [SYNC_STATUS.ERROR]: "Помилка відправки — повторіть або перевірте URL Apps Script",
    [SYNC_STATUS.LOCKED]: "Заблоковано після відправки (корекції залежать від налаштувань)",
  };
  return m[st] || String(st);
}

/**
 * @param {boolean} expanded
 */
function setJournalListExpanded(expanded) {
  journalListExpanded = expanded;
  const panel = $("journalListPanel");
  const expandBar = $("journalListExpandBar");
  if (panel) {
    panel.classList.toggle("journal-list-panel--expanded", expanded);
    if (expanded) {
      updateJournalExpandedGeometry();
      if (!journalLayoutResizeBound) {
        journalLayoutResizeBound = () => updateJournalExpandedGeometry();
        window.addEventListener("resize", journalLayoutResizeBound);
      }
    } else {
      panel.style.removeProperty("--journal-fs-top");
      panel.style.removeProperty("--journal-inset-left");
      panel.style.removeProperty("--journal-inset-right");
      if (journalLayoutResizeBound) {
        window.removeEventListener("resize", journalLayoutResizeBound);
        journalLayoutResizeBound = null;
      }
    }
  }
  if (expandBar) {
    expandBar.setAttribute("aria-expanded", expanded ? "true" : "false");
    if (expanded) {
      expandBar.title = "Згорнути список";
      expandBar.setAttribute("aria-label", "Згорнути список журналу");
    } else {
      expandBar.title = "Розгорнути список на всю висоту екрана";
      expandBar.setAttribute("aria-label", "Розгорнути список журналу на всю висоту екрана");
    }
  }
}

/** Скинути розгортання списку (інший екран або вкладка «Статистика»). */
export function resetJournalListLayout() {
  if (!journalListExpanded) return;
  setJournalListExpanded(false);
}

function renderEditFields(container, report) {
  if (!container) return;
  container.innerHTML = "";
  const f = normalizeFields(report.fields);
  for (const def of FIELD_DEF) {
    const wrap = document.createElement("label");
    wrap.className = "journal-edit-field";
    const lab = document.createElement("span");
    lab.className = "journal-edit-field-label";
    lab.textContent = def.label;
    const input = document.createElement("input");
    input.className = "journal-edit-field-input";
    input.dataset.fieldKey = def.key;
    input.type = def.type || "text";
    const v = f[def.key];
    if (def.key === "crewCounter" && v != null) input.value = String(v);
    else input.value = v != null && v !== undefined ? String(v) : "";
    wrap.appendChild(lab);
    wrap.appendChild(input);
    container.appendChild(wrap);
  }
}

function readEditFields(container) {
  const inputs = container?.querySelectorAll("[data-field-key]") || [];
  /** @type {Record<string, string>} */
  const raw = {};
  inputs.forEach((el) => {
    if (!(el instanceof HTMLInputElement)) return;
    const k = el.dataset.fieldKey;
    if (!k) return;
    raw[k] = el.value;
  });
  let crewCounter = null;
  if (raw.crewCounter !== undefined && raw.crewCounter !== "") {
    const n = parseInt(raw.crewCounter, 10);
    crewCounter = Number.isFinite(n) ? n : null;
  }
  return normalizeFields({
    ...raw,
    crewCounter,
  });
}

/**
 * @param {import("../report-model.js").Report} report
 */
function openEditDialog(report, mode) {
  const dialog = $("journalEditDialog");
  const title = $("journalEditTitle");
  const fieldsEl = $("journalEditFields");
  if (!(dialog instanceof HTMLDialogElement) || !fieldsEl) return;
  editingReport = report;
  editingMode = mode;
  if (title) {
    title.textContent =
      mode === "correction" ? "Виправлення опублікованого звіту" : "Редагування звіту";
  }
  renderEditFields(fieldsEl, report);
  dialog.showModal();
  const first = fieldsEl.querySelector("input");
  if (first instanceof HTMLInputElement) first.focus();
}

export async function initJournalScreen() {
  if (initialized) return;
  initialized = true;

  window.addEventListener("reportsUpdated", () => {
    void renderForSelectedPeriod();
  });

  applySharedFilterToInputs();

  const btnApply = $("btnJournalApply");
  if (btnApply) {
    btnApply.onclick = () => {
      saveCurrentInputsToSharedFilter();
      void renderForSelectedPeriod();
    };
  }

  const btnCopy = $("btnCopyJournalSummary");
  if (btnCopy) {
    btnCopy.onclick = async () => {
      const summaryEl = $("journalSummary");
      const text = (summaryEl?.textContent || "").trim();
      if (!text) return;
      await copyTextSmart(text);
    };
  }

  const tabStats = $("tabStats");
  const tabJournal = $("tabJournal");
  const statsSection = $("statsSection");
  const journalSection = $("journalSection");

  const setTab = (name) => {
    const isStats = name === "stats";
    if (isStats) resetJournalListLayout();
    if (tabStats) tabStats.classList.toggle("active", isStats);
    if (tabJournal) tabJournal.classList.toggle("active", !isStats);
    if (statsSection) statsSection.style.display = isStats ? "" : "none";
    if (journalSection) journalSection.style.display = isStats ? "none" : "";
  };

  if (tabStats) tabStats.onclick = () => setTab("stats");
  if (tabJournal) tabJournal.onclick = () => setTab("journal");
  setTab("stats");

  const searchEl = $("journalSearch");
  if (searchEl) {
    let t = null;
    searchEl.oninput = () => {
      clearTimeout(t);
      t = setTimeout(() => void renderForSelectedPeriod(), 200);
    };
  }

  await renderForSelectedPeriod();

  const expandBar = $("journalListExpandBar");
  if (expandBar) {
    expandBar.onclick = () => setJournalListExpanded(!journalListExpanded);
  }

  const btnEnqueueSheet = $("btnJournalEnqueueSheet");
  if (btnEnqueueSheet) {
    btnEnqueueSheet.onclick = async () => {
      const period = loadPeriodFilter();
      const searchStr = (($("journalSearch")?.value) || "").trim();
      const reports = await listReports();
      const filtered = filterReportsForJournal(reports, period, searchStr);
      const pending = filtered.filter((r) => r.syncStatus !== SYNC_STATUS.SCHEDULED);
      if (pending.length === 0) {
        window.alert(
          "У списку лише звіти з відкладеною відправкою (scheduled) або список порожній. Оберіть період і «Показати», скасуйте відкладення за потреби, або відкрийте картку й надішліть вручну."
        );
        return;
      }
      const settings = await loadSyncSettings();
      if (!String(settings.appsScriptUrl || "").trim()) {
        window.alert(
          "Спочатку збережіть URL веб-застосунку Apps Script на екрані «Дані та інтеграція» — без нього таблиця не оновиться."
        );
        return;
      }

      const ok = window.confirm(
        `Поставити в чергу відправку в Google Sheets для ${pending.length} звіт(ів) зі списку (у т.ч. уже надіслані — повторний запис у таблицю за report_id)? Відкладені (scheduled) пропускаються.`
      );
      if (!ok) return;
      const { queued } = await enqueueReportsForSheetSync(pending.map((r) => r.id));
      window.alert(
        queued > 0
          ? `У чергу додано ${queued} звіт(ів). Перевірте статус на картках.`
          : "Нічого не додано до черги."
      );
      await renderForSelectedPeriod();
    };
  }

  const btnDelFiltered = $("btnJournalDeleteFiltered");
  if (btnDelFiltered) {
    btnDelFiltered.onclick = async () => {
      const period = loadPeriodFilter();
      const searchStr = (($("journalSearch")?.value) || "").trim();
      const reports = await listReports();
      const filtered = filterReportsForJournal(reports, period, searchStr);
      if (filtered.length === 0) {
        window.alert(
          "Немає що видаляти: за цим періодом і пошуком список порожній."
        );
        return;
      }
      const ok = window.confirm(
        `Видалити ${filtered.length} звіт(ів)? Це незворотно.`
      );
      if (!ok) return;
      await deleteReportsByIds(filtered.map((r) => r.id));
      await renderForSelectedPeriod();
    };
  }

  setupEditDialog();
}

function applySharedFilterToInputs() {
  const period = loadPeriodFilter();
  const fromEl = $("journalFrom");
  const toEl = $("journalTo");
  const timeFromEl = $("journalTimeFrom");
  const timeToEl = $("journalTimeTo");
  if (fromEl) fromEl.value = period.fromDate || "";
  if (toEl) toEl.value = period.toDate || "";
  if (timeFromEl) timeFromEl.value = period.fromTime || "";
  if (timeToEl) timeToEl.value = period.toTime || "";
}

function saveCurrentInputsToSharedFilter() {
  savePeriodFilter({
    fromDate: ($("journalFrom")?.value || "").trim(),
    toDate: ($("journalTo")?.value || "").trim(),
    fromTime: ($("journalTimeFrom")?.value || "").trim(),
    toTime: ($("journalTimeTo")?.value || "").trim(),
  });
}

async function renderForSelectedPeriod() {
  const period = loadPeriodFilter();
  const fromIso = period.fromDate || "";
  const toIso = period.toDate || "";
  const fromTimeStr = period.fromTime || "";
  const toTimeStr = period.toTime || "";

  const summaryEl = $("journalSummary");
  const cardsEl = $("journalCards");
  const archiveEl = $("journalArchiveInfo");
  if (!summaryEl || !cardsEl) return;

  const searchRaw = (($("journalSearch")?.value) || "").trim();
  const reports = await listReports();

  if (archiveEl) {
    archiveEl.textContent = `Архів (IndexedDB, v2): ${reports.length} з ${REPORTS_LIMIT} звітів.`;
  }

  const filtered = filterReportsForJournal(reports, period, searchRaw);

  const filterCountEl = $("journalFilterCount");
  if (filterCountEl) {
    filterCountEl.textContent = `Відібрано: ${filtered.length} із ${reports.length}.`;
  }

  cardsEl.textContent = "";

  filtered.sort((a, b) => {
    const ta = getImpactTimestampForReport(a) ?? 0;
    const tb = getImpactTimestampForReport(b) ?? 0;
    return tb - ta;
  });

  if (filtered.length === 0) {
    summaryEl.textContent = "За обраний період звітів не знайдено.";
    updateKPI(0, 0, 0);
    return;
  }

  const counts = {
    total: filtered.length,
    drones: new Map(),
    ammo: new Map(),
    missionTypes: new Map(),
    results: new Map(),
  };
  let hits = 0;
  let loss = 0;
  const allTexts = [];

  for (const item of filtered) {
    const f = normalizeFields(item.fields);
    allTexts.push(item.text);

    if (f.drone) inc(counts.drones, f.drone);
    if (f.ammo) inc(counts.ammo, f.ammo);
    if (f.missionType) inc(counts.missionTypes, f.missionType);
    if (f.result) {
      inc(counts.results, mapResultToCategory(f.result));
      if (isKpiHit(f.result)) hits += 1;
      if (isKpiLoss(f.result)) loss += 1;
    }

    const dateHuman = f.date
      ? /^\d{4}-\d{2}-\d{2}$/.test(f.date)
        ? isoToDDMMYYYY(f.date)
        : f.date
      : "";
    const crewLabel = (f.crew || "").trim() || "Звіт";
    const counterPart = f.crewCounter != null ? ` #${f.crewCounter}` : "";
    const cardSummary = dateHuman
      ? `${crewLabel}${counterPart} · ${dateHuman}`
      : `${crewLabel}${counterPart}`;

    const card = document.createElement("div");
    card.className = "journal-card";

    // ── Header: status dot + summary ──
    const head = document.createElement("div");
    head.className = "journal-card-head";

    const statusDot = document.createElement("span");
    statusDot.className = `card-status-dot ${statusBadgeClass(item.syncStatus)}`;
    statusDot.title = syncStatusTitle(item.syncStatus);

    const summary = document.createElement("div");
    summary.className = "journal-card-summary";
    summary.textContent = cardSummary;

    head.appendChild(statusDot);
    head.appendChild(summary);

    // ── Body: report text, always visible ──
    const body = document.createElement("div");
    body.className = "journal-card-body";
    body.textContent = item.text;

    // ── Action icons row (bottom) ──
    const actionsRow = document.createElement("div");
    actionsRow.className = "journal-card-icon-actions";
    appendActionIcons(actionsRow, item);

    card.appendChild(head);
    card.appendChild(body);
    card.appendChild(actionsRow);
    cardsEl.appendChild(card);
  }

  const parts = [];
  const fmtPeriod = (d, t) => (d ? (t ? `${d} ${t}` : d) : "");
  parts.push(`Період: ${fmtPeriod(fromIso, fromTimeStr)} → ${fmtPeriod(toIso, toTimeStr)}`);
  parts.push("");
  parts.push(`Кількість вильотів: ${counts.total}`);

  const block = (label, map) => {
    if (!map.size) return;
    const entries = Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => `- ${name}: ${count}`)
      .join("\n");
    parts.push(`${label}:\n${entries}`);
  };

  block("Бортів", counts.drones);
  block("Боєприпасів", counts.ammo);
  block("Типів місій", counts.missionTypes);
  block("Результатів", counts.results);

  summaryEl.textContent = parts.join("\n\n");

  const btnCopyAll = $("btnJournalCopyAll");
  if (btnCopyAll) {
    btnCopyAll.onclick = () => copyTextSmart(allTexts.join("\n\n---\n\n"));
  }

  updateKPI(counts.total, hits, loss);
}

/**
 * Відправка з оновленням списку й поясненням, якщо в таблиці ще немає рядка.
 * @param {string} reportId
 */
async function trySendWithFeedback(reportId) {
  const settings = await loadSyncSettings();
  const ok = await trySendReportNow(reportId);
  await renderForSelectedPeriod();
  if (ok) return;

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    window.alert(
      "Немає мережі. Звіт поставлено в чергу; після з’єднання почекайте або натисніть кнопку відправки ще раз."
    );
    return;
  }

  if (!String(settings.appsScriptUrl || "").trim()) {
    window.alert(
      "Не збережено URL веб-застосунку Apps Script. Відкрийте «Дані та інтеграція», вставте URL і збережіть. Без цього рядок у Google Таблиці не з’явиться — помаранчевий маркер означає «зміни тільки в телефоні», а не вже в таблиці."
    );
    return;
  }

  const after = await getReport(reportId);

  if (after?.syncStatus === SYNC_STATUS.ERROR) {
    window.alert(
      "Відправка не вдалася. Перевірте URL, доступ скрипта до таблиці та журнал «Виконання» в Apps Script."
    );
    return;
  }

  if (after?.syncStatus === SYNC_STATUS.RESYNC_REQUIRED) {
    window.alert(
      "Зміни досі не записані в таблицю. Спробуйте ще раз або «Відправити список у таблицю», після перевірки інтернету та URL."
    );
    return;
  }

  if (after?.syncStatus === SYNC_STATUS.QUEUED || after?.syncStatus === SYNC_STATUS.SENDING) {
    window.alert(
      "Звіт у черзі або надсилається. Зачекайте кілька секунд; якщо статус не зміниться — перевірте з’єднання."
    );
  }
}

// ── SVG icon strings ────────────────────────────────────────────────────────
const IC = {
  copy:    `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  share:   `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`,
  send:    `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`,
  edit:    `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  cancel:  `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  clock:   `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  trash:   `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`,
  resync:  `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`,
};

/**
 * Іконки дій внизу картки журналу.
 * @param {HTMLElement} row
 * @param {import("../report-model.js").Report} item
 */
function appendActionIcons(row, item) {
  const st = item.syncStatus;

  /** @param {string} svg @param {string} title @param {() => any | Promise<any>} fn @param {string} [mod] */
  const mk = (svg, title, fn, mod = "") => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "card-action-icon" + (mod ? ` ${mod}` : "");
    b.title = title;
    b.innerHTML = svg;
    b.onclick = () => void fn();
    row.appendChild(b);
  };

  mk(IC.copy, "Копіювати текст", async () => {
    await copyTextSmart(item.text || "");
  });

  if (navigator.share) {
    mk(IC.share, "Поділитися", async () => {
      try {
        await navigator.share({ text: item.text || "" });
      } catch {
        /* скасовано */
      }
    });
  }

  if (st === SYNC_STATUS.DRAFT) {
    mk(IC.send, "Відправити", async () => {
      await trySendWithFeedback(item.id);
    }, "accent");
    mk(IC.edit, "Редагувати", async () => {
      const r = await getReport(item.id);
      if (r) openEditDialog(r, "draft");
    });
    mk(IC.clock, "Запланувати", async () => {
      const s = await loadSyncSettings();
      const def = s.sendDelayMinutes ?? 60;
      const v = window.prompt("Затримка (хв)", String(def));
      if (v == null) return;
      const n = parseInt(v, 10);
      await scheduleSend(item.id, Number.isFinite(n) ? n : def);
      await renderForSelectedPeriod();
    });
  } else if (st === SYNC_STATUS.SCHEDULED) {
    mk(IC.cancel, "Скасувати відправку", async () => {
      await cancelScheduledSend(item.id);
      await renderForSelectedPeriod();
    });
    mk(IC.edit, "Редагувати", async () => {
      const r = await getReport(item.id);
      if (r) openEditDialog(r, "draft");
    });
  } else if (st === SYNC_STATUS.QUEUED || st === SYNC_STATUS.SENDING) {
    mk(IC.send, "Надіслати зараз", async () => {
      await trySendWithFeedback(item.id);
    }, "accent");
    mk(IC.cancel, "Скасувати чергу", async () => {
      await cancelQueuedReport(item.id);
      await renderForSelectedPeriod();
    });
  } else if (st === SYNC_STATUS.SENT) {
    mk(IC.edit, "Виправити", async () => {
      const r = await getReport(item.id);
      if (r) openEditDialog(r, "correction");
    });
    mk(IC.resync, "Повторно синхронізувати", async () => {
      await trySendWithFeedback(item.id);
    });
  } else if (st === SYNC_STATUS.RESYNC_REQUIRED) {
    mk(IC.send, "Надіслати зміни", async () => {
      await trySendWithFeedback(item.id);
    }, "accent");
    mk(IC.edit, "Редагувати", async () => {
      const r = await getReport(item.id);
      if (r) openEditDialog(r, "draft");
    });
  } else if (st === SYNC_STATUS.ERROR) {
    mk(IC.send, "Повторити відправку", async () => {
      await trySendWithFeedback(item.id);
    }, "warn");
    mk(IC.edit, "Редагувати", async () => {
      const r = await getReport(item.id);
      if (r) openEditDialog(r, "draft");
    });
  } else if (st === SYNC_STATUS.LOCKED) {
    mk(IC.edit, "Виправлення після публікації", async () => {
      const r = await getReport(item.id);
      if (r) openEditDialog(r, "correction");
    });
  }
}

// ── Edit dialog save handler ──────────────────────────────────────────────────
function collectFieldsFromEditDialog() {
  const fieldsEl = $("journalEditFields");
  if (!fieldsEl) return null;
  const result = {};
  for (const def of FIELD_DEF) {
    const input = fieldsEl.querySelector(`[data-field-key="${def.key}"]`);
    if (input instanceof HTMLInputElement || input instanceof HTMLSelectElement) {
      result[def.key] = input.value;
    }
  }
  return normalizeFields(result);
}

async function handleEditSave() {
  if (!editingReport) return;
  const fields = collectFieldsFromEditDialog();
  if (!fields) return;
  const dialog = $("journalEditDialog");

  if (editingMode === "correction") {
    await applyCorrectionAfterSent(editingReport.id, fields);
  } else {
    await updateReportFieldsDraft(editingReport.id, fields);
  }

  editingReport = null;
  editingMode = "draft";
  if (dialog instanceof HTMLDialogElement) dialog.close();
  await renderForSelectedPeriod();
}

function setupEditDialog() {
  const saveBtn = $("journalEditSave");
  const cancelBtn = $("journalEditCancel");
  const dialog = $("journalEditDialog");

  if (saveBtn) saveBtn.addEventListener("click", handleEditSave);
  if (cancelBtn && dialog instanceof HTMLDialogElement) {
    cancelBtn.addEventListener("click", () => {
      editingReport = null;
      editingMode = "draft";
      dialog.close();
    });
  }
}