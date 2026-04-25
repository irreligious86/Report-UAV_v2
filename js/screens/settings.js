/**
 * Settings screen — editor for local list overrides.
 *
 * EN:
 *   This screen lets the user customise the dropdown contents on the main
 *   form (drones, mission types, ammo, results, MGRS prefixes) without
 *   editing `config.json`. Changes are stored in localStorage as
 *   "overrides" — the runtime then merges base config + overrides and
 *   feeds the result to `screens/mainForm.js` selects/datalists.
 *
 *   UI:
 *     - a tab strip — one tab per list,
 *     - a sortable `<ul>` of the active list (drag handle on each row,
 *       delete button on the right),
 *     - an "add" input at the bottom,
 *     - a "save" button (overrides are also saved on every individual
 *       change; the button is mostly a UX confirmation cue).
 *
 *   Drag-and-drop is provided by Sortable.js (loaded from a CDN in
 *   `index.html`). On drop we read the new order, store it as an
 *   override, and re-render the list.
 *
 *   Note: Google Sheets integration USED to live here in early versions
 *   and was extracted into `screens/data.js`. This module is purely about
 *   the field-list editor.
 *
 * UA:
 *   Екран дозволяє користувачу налаштувати вміст випадаючих списків
 *   головної форми (дрони, типи місій, боєприпаси, результати, префікси
 *   MGRS) без редагування `config.json`. Зміни зберігаються у localStorage
 *   як «перевизначення» — у рантаймі зливаються з базовим конфігом і
 *   подаються у select/datalist головної форми.
 *
 *   UI:
 *     - смуга вкладок — одна вкладка на список,
 *     - сортовний `<ul>` активного списку (drag-ручка ліворуч, кнопка
 *       видалення праворуч),
 *     - поле «додати» унизу,
 *     - кнопка «зберегти» (перевизначення зберігаються і на кожній
 *       окремій зміні; ця кнопка — переважно UX-сигнал «збережено»).
 *
 *   Drag-and-drop реалізує Sortable.js (підключається з CDN у
 *   `index.html`). На drop читаємо новий порядок, зберігаємо як
 *   перевизначення і перемальовуємо список.
 *
 *   Примітка: Google Sheets-інтеграція раніше була тут і була винесена
 *   у `screens/data.js`. Цей модуль — лише про редактор списків.
 *
 * @module screens/settings
 */

import { $ } from "../utils.js";
import {
  loadConfig,
  loadConfigOverrides,
  saveConfigOverrides,
  applyConfigWithOverrides,
} from "../config.js";
// Google Sheets integration is handled by screens/data.js

let initialized = false;

const LIST_UI = [
  { key: "drones", label: "Дрони" },
  { key: "missionTypes", label: "Типи місій" },
  { key: "ammo", label: "Боєприпаси" },
  { key: "results", label: "Результати" },
  { key: "mgrsPrefixes", label: "Префікси MGRS" },
];

let activeListKey = "drones";

let baseCfg = null;
let overrides = null;
let effectiveLists = null;

let sortableInstance = null;

function normalizeValue(s) {
  return String(s || "").trim();
}

function toLowerSafe(s) {
  return normalizeValue(s).toLowerCase();
}

function getList(key) {
  return Array.isArray(effectiveLists?.[key]) ? effectiveLists[key] : [];
}

function setStatus(msg) {
  const el = $("settingsStatus");
  if (el) el.textContent = msg || "";
}

function rebuildEffectiveLists() {
  effectiveLists = {
    ...(baseCfg?.lists || {}),
    ...(overrides?.lists || {}),
  };
}

function renderTabs() {
  const tabsEl = $("listsTabs");
  if (!tabsEl) return;

  tabsEl.innerHTML = "";

  for (const item of LIST_UI) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tab";
    btn.textContent = item.label;

    if (item.key === activeListKey) btn.classList.add("active");

    btn.onclick = () => {
      activeListKey = item.key;
      renderTabs();
      renderHint();
      renderItems();
    };

    tabsEl.appendChild(btn);
  }
}

function renderHint() {
  const editor = $("listsEditor");
  if (!editor) return;

  let hint = editor.querySelector(".lists-hint");
  if (!hint) {
    hint = document.createElement("div");
    hint.className = "lists-hint";
    const header = editor.querySelector(".listsEditorHeader");
    editor.insertBefore(hint, header ? header.nextSibling : null);
  }

  const label = LIST_UI.find((x) => x.key === activeListKey)?.label || activeListKey;
  hint.textContent = `Активний список: ${label}`;
}

function destroySortable() {
  if (sortableInstance) {
    sortableInstance.destroy();
    sortableInstance = null;
  }
}

function setupSortable() {
  const ul = $("listsItems");
  if (!ul || !window.Sortable) return;

  destroySortable();

  sortableInstance = new window.Sortable(ul, {
    animation: 150,
    handle: ".dragHandle",
    onEnd: () => {
      const ordered = Array.from(ul.children)
        .map((li) => li?.dataset?.value)
        .filter(Boolean);

      if (!overrides) overrides = {};
      if (!overrides.lists) overrides.lists = {};
      overrides.lists[activeListKey] = ordered;

      saveConfigOverrides(overrides);
      rebuildEffectiveLists();

      setStatus("Порядок збережено локально.");
      renderItems();
    },
  });
}

function renderItems() {
  const ul = $("listsItems");
  if (!ul) return;

  const arr = getList(activeListKey);
  ul.innerHTML = "";

  for (const value of arr) {
    const li = document.createElement("li");
    li.className = "lists-item";
    li.dataset.value = value;

    // drag handle
    const drag = document.createElement("button");
    drag.type = "button";
    drag.className = "dragHandle";
    drag.title = "Перетягнути";
    drag.innerHTML = `
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <path fill="currentColor"
          d="M7 4H9V6H7V4M11 4H13V6H11V4M15 4H17V6H15V4
             M7 9H9V11H7V9M11 9H13V11H11V9M15 9H17V11H15V9
             M7 14H9V16H7V14M11 14H13V16H11V14M15 14H17V16H15V14
             M7 19H9V21H7V19M11 19H13V21H11V19M15 19H17V21H15V19"/>
      </svg>
    `;

    const txt = document.createElement("div");
    txt.className = "lists-item-text";
    txt.textContent = value;

    const actions = document.createElement("div");
    actions.className = "lists-item-actions";

    const del = document.createElement("button");
    del.type = "button";
    del.className = "listDeleteBtn";
    del.title = "Видалити";
    del.innerHTML = `
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <path fill="currentColor"
          d="M9 3V4H4V6H5V20C5 21.1 5.9 22 7 22H17C18.1 22 19 21.1 19 20V6H20V4H15V3H9
             M7 6H17V20H7V6Z"/>
      </svg>
    `;
    del.onclick = () => {
      removeItem(value);
    };

    actions.appendChild(del);

    li.appendChild(drag);
    li.appendChild(txt);
    li.appendChild(actions);

    ul.appendChild(li);
  }

  setupSortable();
}

function addItem(raw) {
  const v = normalizeValue(raw);
  if (!v) {
    setStatus("Порожнє значення не додаємо.");
    return;
  }

  const current = getList(activeListKey);

  // берём override-список если был, иначе копируем effective
  const list = Array.isArray(overrides?.lists?.[activeListKey])
    ? [...overrides.lists[activeListKey]]
    : [...current];

  if (list.some((x) => toLowerSafe(x) === toLowerSafe(v))) {
    setStatus("Такий пункт уже існує.");
    return;
  }

  list.push(v);

  if (!overrides) overrides = {};
  if (!overrides.lists) overrides.lists = {};
  overrides.lists[activeListKey] = list;

  saveConfigOverrides(overrides);
  rebuildEffectiveLists();

  const input = $("listNewItem");
  if (input) input.value = "";

  setStatus("Пункт додано.");
  renderItems();
}

function removeItem(valueToRemove) {
  const current = getList(activeListKey);

  const list = Array.isArray(overrides?.lists?.[activeListKey])
    ? [...overrides.lists[activeListKey]]
    : [...current];

  const filtered = list.filter((x) => String(x) !== String(valueToRemove));

  if (!overrides) overrides = {};
  if (!overrides.lists) overrides.lists = {};
  overrides.lists[activeListKey] = filtered;

  saveConfigOverrides(overrides);
  rebuildEffectiveLists();

  setStatus("Пункт видалено.");
  renderItems();
}

async function quickSave() {
  // overrides already saved on each change, but user wants a clear “save action”
  saveConfigOverrides(overrides);

  if (baseCfg) {
    applyConfigWithOverrides(baseCfg, overrides || {});
  }

  const btn = $("listsQuickSaveBtn");
  if (btn) {
    btn.classList.add("is-saved");
    setTimeout(() => btn.classList.remove("is-saved"), 900);
  }

  setStatus("Зміни списків збережено локально.");
}

/**
 * Initializes the settings screen once.
 * Ініціалізує екран налаштувань (одноразово).
 */
export async function initSettingsScreen() {
  if (initialized) return;
  initialized = true;

  baseCfg = await loadConfig();
  overrides = loadConfigOverrides() || { lists: {} };

  rebuildEffectiveLists();

  renderTabs();
  renderHint();
  renderItems();

  const addBtn = $("listAddBtn");
  const input = $("listNewItem");

  if (addBtn) addBtn.onclick = () => addItem(input?.value);

  if (input) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addItem(input.value);
      }
    });
  }

  const saveBtn = $("listsQuickSaveBtn");
  if (saveBtn) saveBtn.onclick = async () => quickSave();
}