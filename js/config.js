/**
 * Form configuration — list values for selects/datalists, defaults, overrides.
 *
 * EN:
 *   This module owns the dropdown / autocomplete contents of the main form
 *   (drones, mission types, ammo, results, MGRS prefixes). Two layers:
 *     - `config.json` (read-only, served as a static asset) — base values
 *       shipped with the app.
 *     - `localStorage[STORAGE_KEY_CONFIG_OVERRIDES]` — per-device user
 *       overrides edited on the Settings screen.
 *   At runtime the two are merged (overrides win) before populating the
 *   form. This keeps user customisation isolated from app updates.
 *
 *   "Empty highlights" are a small UX nicety: form inputs whose value is
 *   currently empty get the `is-empty` class so CSS can colour them.
 *
 * UA:
 *   Цей модуль відповідає за вміст випадаючих списків / автодоповнення
 *   головної форми (дрони, типи місій, боєприпаси, результати, префікси
 *   MGRS). Два шари:
 *     - `config.json` (read-only, віддається як статика) — базові
 *       значення, що йдуть разом із застосунком.
 *     - `localStorage[STORAGE_KEY_CONFIG_OVERRIDES]` — користувацькі
 *       перевизначення на цьому пристрої, редагуються на екрані
 *       «Налаштування списків».
 *   У рантаймі обидва зливаються (перевизначення перемагають) і
 *   заповнюють форму. Так кастомізація користувача ізольована від
 *   оновлень коду.
 *
 *   «Empty highlights» — невелика UX-фіча: поля форми з порожнім
 *   значенням отримують клас `is-empty`, CSS їх підсвічує.
 *
 * @module config
 */

import { $ } from "./utils.js";
import { CONFIG_URL, STORAGE_KEY_CONFIG_OVERRIDES } from "./constants.js";

/**
 * EN: Replaces a `<select>`'s options with the given strings (value === text).
 *     Anything that is not a real `<select>` is ignored — while a field is in
 *     long-press edit mode its id temporarily belongs to an `<input>`.
 * UA: Замінює опції `<select>` заданими рядками (value === text). Усе, що не
 *     є справжнім `<select>`, ігнорується — у режимі long-press-редагування
 *     цей id тимчасово належить `<input>`.
 * @param {HTMLElement | null} selectEl
 * @param {string[]} items
 */
export function fillSelect(selectEl, items) {
  if (!(selectEl instanceof HTMLSelectElement)) return;
  selectEl.innerHTML = "";
  for (const name of (items || [])) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    selectEl.appendChild(opt);
  }
}

/**
 * EN: Selects `value` in a `<select>`. If no such option exists and
 *     `allowCustom` is set, a new option is appended and marked with
 *     `data-custom="1"` (free text typed by the user, not a list item).
 *     Returns true when the select now shows `value`.
 * UA: Обирає `value` у `<select>`. Якщо такої опції немає і дозволено
 *     `allowCustom` — додає нову опцію з міткою `data-custom="1"` (вільний
 *     текст користувача, а не пункт списку). Повертає true, якщо select
 *     тепер показує `value`.
 * @param {HTMLElement | null} selectEl
 * @param {string} value
 * @param {{ allowCustom?: boolean }} [opt]
 * @returns {boolean}
 */
export function setSelectValue(selectEl, value, opt = {}) {
  if (!(selectEl instanceof HTMLSelectElement)) return false;
  const v = String(value ?? "");
  if (!v) return false;
  const exists = Array.from(selectEl.options).some((o) => o.value === v);
  if (!exists) {
    if (!opt.allowCustom) return false;
    const custom = new Option(v, v);
    custom.dataset.custom = "1";
    selectEl.add(custom);
  }
  selectEl.value = v;
  return true;
}

/**
 * EN: Fills a `<datalist>` (autocomplete suggestions for a free-text input
 *     after long-press swap; see `longPressEdit.js`).
 * UA: Заповнює `<datalist>` (підказки автодоповнення для поля з вільним
 *     вводом після long-press; див. `longPressEdit.js`).
 * @param {HTMLDataListElement | null} datalistEl
 * @param {string[]} items
 */
export function fillDatalist(datalistEl, items) {
  if (!datalistEl) return;
  datalistEl.innerHTML = "";
  for (const name of (items || [])) {
    const opt = document.createElement("option");
    opt.value = name;
    datalistEl.appendChild(opt);
  }
}

/**
 * EN: Fetches and parses `config.json`. We disable HTTP caching so a user
 *     who pushes a new config sees it on the next reload (the Service
 *     Worker still caches the file for offline use).
 * UA: Завантажує і парсить `config.json`. Вимикаємо HTTP-кеш — щоб
 *     користувач, який оновив конфіг, побачив зміни при наступному
 *     перезавантаженні (Service Worker все одно кешує файл для офлайну).
 * @returns {Promise<object>}
 * @throws {Error}
 */
export async function loadConfig() {
  const res = await fetch(CONFIG_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`config.json error: ${res.status}`);
  return await res.json();
}

/**
 * EN: Select id → [list key in config, key in `cfg.defaults`].
 * UA: id select-а → [ключ списку в config, ключ у `cfg.defaults`].
 */
const SELECT_BINDINGS = [
  ["drone", "drones", "drone"],
  ["missionType", "missionTypes", "missionType"],
  ["ammo", "ammo", "ammo"],
  ["result", "results", "result"],
  ["mgrsPrefix", "mgrsPrefixes", "mgrsPrefix"],
];

/**
 * EN: Applies a fully-merged config object to the form: fills every
 *     select/datalist and refreshes empty-field highlights.
 *
 *     The call is safe to repeat while the user is filling the form (the
 *     Settings screen re-applies lists after every edit): whatever is
 *     currently selected stays selected. Per select:
 *       1) value still in the list            → keep it,
 *       2) value was free text (long-press)   → keep it as a custom option,
 *       3) value is gone / first boot         → `cfg.defaults`, if that
 *          default exists in the list; otherwise the first item.
 * UA: Застосовує повністю злитий обʼєкт config до форми: заповнює всі
 *     select/datalist і оновлює підсвітку порожніх полів.
 *
 *     Виклик безпечно повторювати, поки користувач заповнює форму (екран
 *     «Налаштування» перезастосовує списки після кожної правки): обране
 *     значення лишається обраним. Для кожного select:
 *       1) значення ще є у списку            → лишаємо,
 *       2) значення було вільним текстом     → лишаємо як custom-опцію,
 *       3) значення зникло / перший запуск   → `cfg.defaults`, якщо воно є
 *          у списку; інакше — перший пункт.
 * @param {object} cfg
 */
export function applyConfig(cfg) {
  const lists = cfg?.lists || {};
  const defaults = cfg?.defaults || {};

  for (const [id, listKey, defaultKey] of SELECT_BINDINGS) {
    const el = $(id);
    if (!(el instanceof HTMLSelectElement)) continue;

    const prevValue = el.value;
    const prevWasCustom = el.selectedOptions[0]?.dataset.custom === "1";

    fillSelect(el, lists[listKey] || []);

    const kept =
      setSelectValue(el, prevValue) ||
      (prevWasCustom && setSelectValue(el, prevValue, { allowCustom: true }));
    if (!kept) setSelectValue(el, defaults[defaultKey]);
  }

  fillDatalist($("droneList"), lists.drones || []);
  fillDatalist($("missionTypeList"), lists.missionTypes || []);
  fillDatalist($("ammoList"), lists.ammo || []);
  fillDatalist($("resultList"), lists.results || []);

  updateEmptyHighlights();
}

/**
 * EN: Reads the user-edited config overrides from localStorage. Returns
 *     `{}` on missing / corrupt JSON so the caller can safely spread it.
 * UA: Читає користувацькі перевизначення з localStorage. Повертає `{}`
 *     при відсутності / зіпсованому JSON — щоб викликач міг безпечно
 *     робити spread.
 * @returns {{lists?: object, defaults?: object}}
 */
export function loadConfigOverrides() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY_CONFIG_OVERRIDES)) || {};
  } catch {
    return {};
  }
}

/**
 * EN: Saves the user-edited config overrides into localStorage. A null /
 *     non-object value REMOVES the key — i.e. "reset to defaults".
 * UA: Зберігає користувацькі перевизначення у localStorage. null /
 *     не-обʼєкт ВИДАЛЯЄ ключ — тобто «скинути до типових».
 * @param {{lists?: object, defaults?: object}} overrides
 */
export function saveConfigOverrides(overrides) {
  if (!overrides || typeof overrides !== "object") {
    localStorage.removeItem(STORAGE_KEY_CONFIG_OVERRIDES);
    return;
  }
  localStorage.setItem(STORAGE_KEY_CONFIG_OVERRIDES, JSON.stringify(overrides));
}

/**
 * EN: Convenience — merges `config.json` with the localStorage overrides
 *     (overrides win) and applies the result to the form.
 * UA: Зручний хелпер — зливає `config.json` із перевизначеннями з
 *     localStorage (перевизначення перемагають) і застосовує результат до
 *     форми.
 * @param {object} cfg
 * @param {{lists?: object, defaults?: object}} overrides
 */
export function applyConfigWithOverrides(cfg, overrides) {
  const baseCfg = cfg || {};
  const ov = overrides || {};

  const mergedLists = {
    ...(baseCfg.lists || {}),
    ...(ov.lists || {}),
  };

  const mergedDefaults = {
    ...(baseCfg.defaults || {}),
    ...(ov.defaults || {}),
  };

  applyConfig({
    ...baseCfg,
    lists: mergedLists,
    defaults: mergedDefaults,
  });
}

/**
 * EN: Form fields that visually highlight when empty (CSS `is-empty`).
 *     The list is intentionally hard-coded — it matches the report fields
 *     a complete record needs.
 * UA: Поля форми, які підсвічуються при порожньому значенні (CSS
 *     `is-empty`). Список свідомо хардкодений — відповідає полям, які
 *     потрібні для повного звіту.
 */
const EMPTY_HIGHLIGHT_IDS = ["crew", "datePicker", "drone", "missionType", "takeoff", "impact", "mgrsPrefix", "easting", "northing", "ammo", "stream", "result"];

/**
 * EN: Toggles `is-empty` on the configured fields based on whether their
 *     current value is blank. Called on init, after every input change
 *     and after «Готово» finishes (so post-save state is reflected).
 * UA: Перемикає клас `is-empty` на сконфігурованих полях залежно від
 *     того, чи значення зараз порожнє. Викликається при ініціалізації,
 *     після кожної зміни поля і після завершення «Готово» (щоб стан
 *     після збереження відобразився).
 */
export function updateEmptyHighlights() {
  for (const id of EMPTY_HIGHLIGHT_IDS) {
    const el = $(id);
    if (!el) continue;
    if ((el.value ?? "").trim() === "") el.classList.add("is-empty");
    else el.classList.remove("is-empty");
  }
}
