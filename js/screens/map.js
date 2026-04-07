/**
 * Map screen: display all saved report points on Leaflet map.
 * Екран мапи: показ усіх збережених точок звітів на Leaflet-мапі.
 * @module screens/map
 */

import { listReports, deleteReportsByIds } from "../report-actions.js";
import { STORAGE_KEY_MAP_BASEMAP } from "../constants.js";
import { $, setStatus, isoToDDMMYYYY } from "../utils.js";
import { copyText } from "../clipboard.js";
import { toPoint } from "https://esm.sh/mgrs@2.1.0";
import {
  loadPeriodFilter,
  isWithinPeriodFilter,
  getImpactTimestampForReport,
} from "../filters.js";
import { getImpactTimestampMs } from "../report-format.js";

let initialized = false;
let map = null;
let markersLayer = null;
let activeMissionGroup = null;
let activeReport = null;

/** Чи мапа розгорнута на весь екран застосунку (fixed layout). */
let mapLayoutExpanded = false;

/**
 * Повертає макет мапи до звичайного (вихід з «на весь екран»).
 * Викликається при переході на інший екран.
 */
export function resetMapLayout() {
  if (!mapLayoutExpanded) return;
  setMapLayoutExpanded(false);
}

/**
 * @param {boolean} expanded
 */
function setMapLayoutExpanded(expanded) {
  mapLayoutExpanded = expanded;
  const screenEl = $("screen-map");
  const btn = $("mapToggleFullscreen");
  const titleEl = $("title");

  if (screenEl) {
    screenEl.classList.toggle("map-screen--expanded", expanded);
    if (expanded && titleEl) {
      const topPx = Math.ceil(titleEl.getBoundingClientRect().bottom + 4);
      screenEl.style.setProperty("--map-fs-top", `${topPx}px`);
    } else {
      screenEl.style.removeProperty("--map-fs-top");
    }
  }
  if (btn) {
    btn.setAttribute("aria-expanded", expanded ? "true" : "false");
    if (expanded) {
      btn.title = "Звичайний розмір мапи";
      btn.setAttribute("aria-label", "Повернути мапу до звичайного розміру");
    } else {
      btn.title = "Розгорнути мапу";
      btn.setAttribute("aria-label", "Розгорнути мапу на весь екран");
    }
  }

  window.setTimeout(() => {
    if (map) map.invalidateSize();
  }, expanded ? 320 : 100);
}

function createMarkerIcon(count) {
  const safeCount = Number.isFinite(count) && count > 0 ? count : 1;

  if (safeCount === 1) {
    const size = 22;

    return window.L.divIcon({
      className: "map-marker-wrapper",
      html: `<div class="map-marker-dot"></div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      popupAnchor: [0, -size / 2],
    });
  }

  let size = 34;
  let variantClass = "is-low";

  if (safeCount >= 4 && safeCount <= 5) {
    size = 40;
    variantClass = "is-medium";
  } else if (safeCount >= 6) {
    size = 46;
    variantClass = "is-high";
  }

  return window.L.divIcon({
    className: "map-marker-wrapper",
    html: `<div class="map-marker-badge ${variantClass}" style="width:${size}px;height:${size}px;">${safeCount}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -Math.round(size * 0.45)],
  });
}

function buildMissionListTitle(report) {
  const f = report?.fields;
  if (!f) return "Місія";
  const parts = [];
  const crewLine =
    f.crew && f.crewCounter != null ? `${f.crew} (${f.crewCounter})` : f.crew || "";
  if (crewLine) parts.push(crewLine);
  if (f.date) parts.push(isoToDDMMYYYY(f.date));
  if (f.impact) parts.push(f.impact);
  return parts.join(" • ") || "Місія";
}

function coordsFromReport(report) {
  const raw = report?.fields && typeof report.fields.coords === "string"
    ? report.fields.coords.trim()
    : "";
  return raw;
}

function getSortableMissionTimestamp(report) {
  if (!report?.fields) return Date.parse(report.createdAt || "") || 0;
  const ms = getImpactTimestampMs(report.fields);
  if (ms != null) return ms;
  const fb = Date.parse(report.createdAt || "");
  return Number.isNaN(fb) ? 0 : fb;
}

function closeMapOverlay(overlayEl) {
  if (!overlayEl) return;
  overlayEl.classList.add("screenHidden");
  overlayEl.setAttribute("aria-hidden", "true");
}

function openMapOverlay(overlayEl) {
  if (!overlayEl) return;
  overlayEl.classList.remove("screenHidden");
  overlayEl.setAttribute("aria-hidden", "false");
}

/**
 * Стабільний id звіту (після міграції завжди є; для старих — пошук у сховищі).
 * @param {{ id?: string, ts?: string, text?: string }|null|undefined} report
 * @returns {string|null}
 */
function resolveReportStorageId(report) {
  if (!report?.id) return null;
  return String(report.id).trim() || null;
}

async function shareReportText(report) {
  const text = String(report?.text || "").trim();
  if (!text) {
    setStatus("Немає тексту для поширення.");
    return;
  }

  try {
    if (navigator.share) {
      await navigator.share({
        title: "Звіт місії",
        text,
      });
      setStatus("Звіт передано в меню поширення.");
      return;
    }

    const copied = await copyText(text);
    setStatus(
      copied
        ? "Меню поширення недоступне. Текст скопійовано."
        : "Меню поширення недоступне."
    );
  } catch (err) {
    if (err && err.name === "AbortError") {
      return;
    }

    const copied = await copyText(text);
    setStatus(
      copied
        ? "Не вдалося відкрити поширення. Текст скопійовано."
        : "Не вдалося відкрити поширення."
    );
  }
}

function renderSingleReportOverlay(report, group = null) {
  const reportOverlay = $("mapReportOverlay");
  const titleEl = $("mapReportTitle");
  const subtitleEl = $("mapReportSubtitle");
  const contentEl = $("mapReportContent");

  if (!reportOverlay || !titleEl || !subtitleEl || !contentEl) return;

  activeMissionGroup = group;
  activeReport = report || null;

  titleEl.textContent = buildMissionListTitle(report || null);
  subtitleEl.textContent = coordsFromReport(report || null) || "";
  contentEl.textContent = report?.text || "";

  openMapOverlay(reportOverlay);
}

function renderMissionGroupOverlay(group) {
  const groupOverlay = $("mapGroupOverlay");
  const titleEl = $("mapGroupTitle");
  const subtitleEl = $("mapGroupSubtitle");
  const listEl = $("mapMissionList");

  if (!groupOverlay || !titleEl || !subtitleEl || !listEl) return;

  titleEl.textContent = `Місії у точці: ${group.reports.length}`;
  subtitleEl.textContent = group.coordsText || "";

  listEl.innerHTML = "";

  const sortedReports = [...group.reports].sort((a, b) => {
    return getSortableMissionTimestamp(b) - getSortableMissionTimestamp(a);
  });

  sortedReports.forEach((report, index) => {
    const impact =
      report?.fields?.impact && String(report.fields.impact).trim();
    const c = coordsFromReport(report || null);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "map-mission-item";

    btn.innerHTML = `
      <span class="map-mission-item-title">${escapeHtml(buildMissionListTitle(report || null))}</span>
      <span class="map-mission-item-meta">
        ${impact ? `Час: ${escapeHtml(impact)}` : `Місія ${index + 1}`}
        ${c ? ` • ${escapeHtml(c)}` : ""}
      </span>
    `;

    btn.addEventListener("click", () => {
      renderSingleReportOverlay(report, group);
    });

    listEl.appendChild(btn);
  });

  openMapOverlay(groupOverlay);
}

function initMapOverlays() {
  const groupOverlay = $("mapGroupOverlay");
  const reportOverlay = $("mapReportOverlay");

  const groupCloseBtn = $("mapGroupCloseBtn");
  const reportCloseBtn = $("mapReportCloseBtn");
  const reportBackBtn = $("mapReportBackBtn");
  const copyBtn = $("mapReportCopyBtn");
  const shareBtn = $("mapReportShareBtn");
  const deleteBtn = $("mapReportDeleteBtn");

  if (groupCloseBtn) {
    groupCloseBtn.onclick = () => closeMapOverlay(groupOverlay);
  }

  if (reportCloseBtn) {
    reportCloseBtn.onclick = () => {
      activeMissionGroup = null;
      activeReport = null;
      closeMapOverlay(reportOverlay);
    };
  }

  if (reportBackBtn) {
    reportBackBtn.onclick = () => {
      closeMapOverlay(reportOverlay);

      if (activeMissionGroup) {
        renderMissionGroupOverlay(activeMissionGroup);
      }
    };
  }

  document.querySelectorAll("[data-map-overlay-close='group']").forEach((el) => {
    el.addEventListener("click", () => closeMapOverlay(groupOverlay));
  });

  document.querySelectorAll("[data-map-overlay-close='report']").forEach((el) => {
    el.addEventListener("click", () => {
      activeMissionGroup = null;
      activeReport = null;
      closeMapOverlay(reportOverlay);
    });
  });

  if (copyBtn) {
    copyBtn.onclick = async () => {
      const text = String(activeReport?.text || "").trim();
      if (!text) {
        setStatus("Немає тексту для копіювання.");
        return;
      }

      const ok = await copyText(text);
      setStatus(ok ? "Звіт скопійовано." : "Помилка копіювання.");
    };
  }

  if (shareBtn) {
    shareBtn.onclick = async () => {
      await shareReportText(activeReport);
    };
  }

  if (deleteBtn) {
    deleteBtn.onclick = async () => {
      const rid = resolveReportStorageId(activeReport);
      if (!rid) {
        setStatus("Не вдалося знайти запис у журналі для видалення.");
        return;
      }
      const ok = window.confirm(
        "Видалити цей звіт з архіву на пристрої? Дію не можна скасувати."
      );
      if (!ok) return;

      await deleteReportsByIds([rid]);
      setStatus("Звіт видалено з архіву.");

      activeReport = null;
      activeMissionGroup = null;
      closeMapOverlay(reportOverlay);
      closeMapOverlay(groupOverlay);
      void renderReportsOnMap();
    };
  }
}

/**
 * Safe HTML escaping for popup content.
 * Безпечне екранування HTML для popup.
 * @param {string} value
 * @returns {string}
 */
function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * Converts MGRS string to Leaflet lat/lng.
 * Конвертує MGRS-рядок у Leaflet lat/lng.
 * @param {string} mgrsText
 * @returns {{lat:number,lng:number}|null}
 */
function mgrsToLatLng(mgrsText) {
  try {
    const point = toPoint(mgrsText); // returns [lon, lat]
    if (!Array.isArray(point) || point.length < 2) return null;

    const [lng, lat] = point;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    return { lat, lng };
  } catch {
    return null;
  }
}

/**
 * Renders all saved reports as markers on the map.
 * Малює всі збережені звіти як маркери на мапі.
 */
async function renderReportsOnMap() {
  if (!map || !markersLayer) return;

  markersLayer.clearLayers();

  const statusEl = $("mapStatus");
  const period = loadPeriodFilter();
  const reports = await listReports();

  const filtered = reports.filter((report) => {
    const impactMs = getImpactTimestampForReport(report);
    if (impactMs == null) return false;
    return isWithinPeriodFilter(impactMs, period);
  });

  if (!filtered.length) {
    if (statusEl) statusEl.textContent = "У журналі ще немає збережених звітів.";
    map.setView([48.3794, 31.1656], 6);
    return;
  }

  const bounds = [];
  let validCount = 0;
  let invalidCount = 0;

  const groupedByCoords = new Map();

  for (const report of filtered) {
    const coordsText = coordsFromReport(report);
    if (!coordsText) {
      invalidCount += 1;
      continue;
    }

    const pos = mgrsToLatLng(coordsText);
    if (!pos) {
      invalidCount += 1;
      continue;
    }

    const key = `${pos.lat.toFixed(6)},${pos.lng.toFixed(6)}`;

    if (!groupedByCoords.has(key)) {
      groupedByCoords.set(key, {
        pos,
        coordsText,
        reports: [],
      });
    }

    groupedByCoords.get(key).reports.push(report);
  }

  for (const group of groupedByCoords.values()) {
    const { pos, reports } = group;
    const marker = window.L.marker([pos.lat, pos.lng], {
      icon: createMarkerIcon(reports.length),
    });

    if (reports.length === 1) {
      const report = reports[0];
      marker.on("click", () => {
        renderSingleReportOverlay(report, null);
      });
    } else {
      marker.on("click", () => {
        renderMissionGroupOverlay(group);
      });
    }

    marker.addTo(markersLayer);
    bounds.push([pos.lat, pos.lng]);
    validCount += reports.length;
  }

  if (validCount > 0) {
    map.fitBounds(bounds, { padding: [24, 24] });
    if (statusEl) {
      statusEl.textContent =
        invalidCount > 0
          ? `Показано місій: ${validCount}. Пропущено некоректних координат: ${invalidCount}.`
          : `Показано місій: ${validCount}.`;
    }
  } else {
    map.setView([48.3794, 31.1656], 6);
    if (statusEl) {
      statusEl.textContent = "Не вдалося розпізнати координати у збережених звітах.";
    }
  }
}

/**
 * Initializes map screen once.
 * Ініціалізує екран мапи (одноразово).
 */
export function initMapScreen() {
  if (initialized) return;
  initialized = true;

  const mapEl = $("map");
  const statusEl = $("mapStatus");

  if (!mapEl) return;

  if (!window.L) {
    if (statusEl) statusEl.textContent = "Leaflet не завантажився.";
    return;
  }

  initMapOverlays();

  const fsBtn = $("mapToggleFullscreen");
  if (fsBtn) {
    fsBtn.onclick = () => setMapLayoutExpanded(!mapLayoutExpanded);
  }

  map = window.L.map(mapEl, {
    zoomControl: true,
    attributionControl: true,
  }).setView([48.3794, 31.1656], 6);

  const osmLayer = window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  });

  const esriSatLayer = window.L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom: 19,
      attribution:
        'Супутник © <a href="https://www.esri.com/">Esri</a> (World Imagery)',
    }
  );

  const openTopoLayer = window.L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
    maxZoom: 17,
    subdomains: "abc",
    attribution:
        'Рельєф: © <a href="https://opentopomap.org">OpenTopoMap</a> '
        + '(<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>), '
        + 'дані © <a href="https://www.openstreetmap.org/copyright">OSM</a>',
  });

  const baseMaps = {
    "Схема (OSM)": osmLayer,
    Супутник: esriSatLayer,
    "Рельєф і висоти": openTopoLayer,
  };

  let initialLabel = "Схема (OSM)";
  try {
    const saved = localStorage.getItem(STORAGE_KEY_MAP_BASEMAP);
    if (saved && Object.prototype.hasOwnProperty.call(baseMaps, saved)) {
      initialLabel = saved;
    }
  } catch {
    /* ignore */
  }

  baseMaps[initialLabel].addTo(map);

  window.L.control
    .layers(baseMaps, null, {
      position: "bottomright",
      collapsed: true,
    })
    .addTo(map);

  map.on("baselayerchange", () => {
    for (const label of Object.keys(baseMaps)) {
      if (map.hasLayer(baseMaps[label])) {
        try {
          localStorage.setItem(STORAGE_KEY_MAP_BASEMAP, label);
        } catch {
          /* ignore */
        }
        break;
      }
    }
  });

  markersLayer = window.L.layerGroup().addTo(map);

  window.addEventListener("reportsUpdated", () => {
    void renderReportsOnMap();
  });

  if (statusEl) {
    statusEl.textContent = "Мапу ініціалізовано. Точки буде завантажено при відкритті екрана.";
  }
}

/**
 * Called when map screen becomes visible.
 * Викликається, коли екран мапи стає активним.
 */
export function onMapScreenShown() {
  if (!map) return;

  // Leaflet needs a size refresh when map was hidden.
  window.setTimeout(() => {
    if (mapLayoutExpanded) {
      const screenEl = $("screen-map");
      const titleEl = $("title");
      if (screenEl && titleEl) {
        const topPx = Math.ceil(titleEl.getBoundingClientRect().bottom + 4);
        screenEl.style.setProperty("--map-fs-top", `${topPx}px`);
      }
    }
    map.invalidateSize();
    void renderReportsOnMap();
  }, 60);
}

