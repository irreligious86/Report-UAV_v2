/**
 * Settings screen — editor for local list overrides.
 *
 * EN:
 *   This screen lets the user customise the dropdown contents on the main
 *   form (drones, mission types, ammo, results, MGRS prefixes) without
 *   editing `config.json`. Changes are stored in localStorage as
 *   "overrides" — the runtime merges base config + overrides and feeds the
 *   result to the main form's selects/datalists.
 *
 *   UI:
 *     - a tab strip — one tab per list,
 *     - an "add" input on top; a new item is inserted at the TOP of the list,
 *     - a sortable `<ul>` of the active list (drag handle on each row,
 *       delete button on the right).
 *
 *   Autosave: there is NO save button. Every action — add, delete, reorder —
 *   goes through `commitActiveList_()`, which in one step
 *     1) stores the overrides in localStorage,
 *     2) re-applies the lists to the main form (the form keeps whatever is
 *        currently selected, see `config.applyConfig`),
 *     3) re-renders the list and shows a short "saved" status.
 *   So nothing can be lost by forgetting to press a button.
 *
 *   Drag-and-drop is provided by the vendored Sortable.js
 *   (`js/vendor/Sortable.min.js` → `window.Sortable`).
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
 *     - поле «додати» зверху; новий пункт вставляється на ПОЧАТОК списку,
 *     - сортовний `<ul>` активного списку (drag-ручка ліворуч, кнопка
 *       видалення праворуч).
 *
 *   Автозбереження: кнопки «зберегти» НЕМАЄ. Кожна дія — додати, видалити,
 *   перетягнути — проходить через `commitActiveList_()`, яка за один крок
 *     1) зберігає перевизначення у localStorage,
 *     2) перезастосовує списки до головної форми (форма зберігає поточний
 *        вибір, див. `config.applyConfig`),
 *     3) перемальовує список і показує короткий статус «збережено».
 *   Тож нічого не загубиться через забуту кнопку.
 *
 *   Drag-and-drop реалізує локальна копія Sortable.js
 *   (`js/vendor/Sortable.min.js` → `window.Sortable`).
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
import { FORM_TEXT_FIELD_MAX_LENGTH } from "../constants.js";

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

/** EN: Timer that clears the "saved" status. UA: Таймер, що прибирає статус «збережено». */
let statusTimer = 0;

/** EN: Value to flash after the next render (just-added item). UA: Значення, яке підсвітити після рендеру (щойно доданий пункт). */
let justAddedValue = null;

const LIST_KEYS_MAX_32 = new Set(["drones", "missionTypes", "ammo"]);

function updateListNewItemMaxLength() {
  const input = $("listNewItem");
  if (!input) return;
  if (LIST_KEYS_MAX_32.has(activeListKey)) {
    input.maxLength = FORM_TEXT_FIELD_MAX_LENGTH;
  } else {
    input.removeAttribute("maxlength");
  }
}

function normalizeValue(s) {
  return String(s || "").trim();
}

function toLowerSafe(s) {
  return normalizeValue(s).toLowerCase();
}

function getList(key) {
  return Array.isArray(effectiveLists?.[key]) ? effectiveLists[key] : [];
}

/**
 * EN: Shows a status line under the "add" input. `ok` paints it as a
 *     confirmation and makes it disappear after a few seconds.
 * UA: Показує рядок статусу під полем «додати». `ok` фарбує його як
 *     підтвердження і прибирає через кілька секунд.
 * @param {string} msg
 * @param {boolean} [ok]
 */
function setStatus(msg, ok = false) {
  const el = $("settingsStatus");
  if (!el) return;
  window.clearTimeout(statusTimer);
  el.textContent = msg || "";
  el.classList.toggle("is-saved", ok && !!msg);
  if (ok && msg) {
    statusTimer = window.setTimeout(() => {
      el.textContent = "";
      el.classList.remove("is-saved");
    }, 2500);
  }
}

/**
 * EN: Current working copy of the active list (override if present, else the
 *     effective base list).
 * UA: Поточна робоча копія активного списку (перевизначення, якщо є, інакше
 *     ефективний базовий список).
 * @returns {string[]}
 */
function activeListCopy_() {
  return Array.isArray(overrides?.lists?.[activeListKey])
    ? [...overrides.lists[activeListKey]]
    : [...getList(activeListKey)];
}

/**
 * EN: THE autosave point. Stores the new content of the active list, pushes
 *     the lists to the main form right away and re-renders the editor.
 *     Every mutation (add / delete / reorder) must end here.
 * UA: ЄДИНА точка автозбереження. Зберігає новий вміст активного списку,
 *     одразу передає списки головній формі й перемальовує редактор.
 *     Кожна зміна (додати / видалити / перетягнути) має закінчуватися тут.
 * @param {string[]} nextList
 * @param {string} statusMsg
 */
function commitActiveList_(nextList, statusMsg) {
  if (!overrides) overrides = {};
  if (!overrides.lists) overrides.lists = {};
  overrides.lists[activeListKey] = nextList;

  let saved = true;
  try {
    saveConfigOverrides(overrides);
  } catch {
    // EN: Quota / private mode: the change still works until reload.
    // UA: Квота / приватний режим: зміна діє до перезавантаження.
    saved = false;
  }
  rebuildEffectiveLists();

  if (baseCfg) applyConfigWithOverrides(baseCfg, overrides);

  renderItems();
  if (saved) setStatus(`${statusMsg} Збережено ✓`, true);
  else setStatus(`${statusMsg} Не вдалося зберегти у сховище браузера — зміна зникне після перезапуску.`);
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
      updateListNewItemMaxLength();
      setStatus("");
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
    onEnd: (evt) => {
      if (evt.oldIndex === evt.newIndex) return;
      const ordered = Array.from(ul.children)
        .map((li) => li?.dataset?.value)
        .filter(Boolean);
      commitActiveList_(ordered, "Порядок змінено.");
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
    if (value === justAddedValue) li.classList.add("lists-item--new");

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

  justAddedValue = null;
  setupSortable();
}

function addItem(raw) {
  const v = normalizeValue(raw);
  if (!v) {
    setStatus("Порожнє значення не додаємо.");
    return;
  }
  if (LIST_KEYS_MAX_32.has(activeListKey) && v.length > FORM_TEXT_FIELD_MAX_LENGTH) {
    setStatus(`Максимум ${FORM_TEXT_FIELD_MAX_LENGTH} символів.`);
    return;
  }

  const list = activeListCopy_();

  if (list.some((x) => toLowerSafe(x) === toLowerSafe(v))) {
    setStatus("Такий пункт уже існує.");
    return;
  }

  // EN: New items go to the TOP — right under the input, where the user is
  //     looking, and first in the form's dropdown.
  // UA: Нові пункти йдуть НАГОРУ — одразу під полем вводу, куди дивиться
  //     користувач, і першими у випадаючому списку форми.
  list.unshift(v);

  const input = $("listNewItem");
  if (input) input.value = "";

  justAddedValue = v;
  commitActiveList_(list, "Пункт додано.");

  const ul = $("listsItems");
  if (ul) ul.scrollTop = 0;
}

function removeItem(valueToRemove) {
  const filtered = activeListCopy_().filter((x) => String(x) !== String(valueToRemove));
  commitActiveList_(filtered, "Пункт видалено.");
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
  updateListNewItemMaxLength();

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
}