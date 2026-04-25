/**
 * Persistence for the "Стрім" field — remembered values for autocomplete.
 *
 * EN:
 *   The `Стрім` field on the main form accepts free text (typically a URL).
 *   To save typing on repeated mission days we accumulate every saved
 *   value into localStorage; the Settings screen exposes them so the user
 *   can later pick from the list.
 *   The placeholder "---" is never stored — that is the "no stream" marker.
 *
 * UA:
 *   Поле «Стрім» на головній формі приймає вільний текст (зазвичай URL).
 *   Щоб не вводити те саме знов і знов, ми накопичуємо кожне збережене
 *   значення у localStorage; екран «Налаштування» показує їх — тоді
 *   користувач може обрати зі списку.
 *   Плейсхолдер «---» НЕ зберігається — це маркер «без стріму».
 *
 * @module streams
 */

import { STORAGE_KEY_STREAMS } from "./constants.js";

/**
 * EN: Loads remembered stream values from localStorage. Garbage values
 *     (non-array, empty strings) are filtered out so callers can trust
 *     the result is a clean array of strings.
 * UA: Завантажує запамʼятовані значення «Стрім» із localStorage.
 *     Сміттєві значення (не-масив, порожні рядки) відфільтровуються —
 *     викликач отримує чистий масив рядків.
 * @returns {string[]}
 */
export function loadStreams() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY_STREAMS));
    if (!Array.isArray(raw)) return [];
    return raw.map((x) => String(x)).filter((x) => x.trim() !== "");
  } catch {
    return [];
  }
}

/**
 * EN: Saves the stream list to localStorage. Empty list REMOVES the key
 *     (so reading later yields an empty default).
 * UA: Зберігає список значень «Стрім» у localStorage. Порожній список
 *     ВИДАЛЯЄ ключ (читання пізніше дасть порожнє значення).
 * @param {string[]} items
 */
export function saveStreams(items) {
  const arr = Array.isArray(items) ? items.map((x) => String(x).trim()).filter(Boolean) : [];
  if (!arr.length) {
    localStorage.removeItem(STORAGE_KEY_STREAMS);
    return;
  }
  localStorage.setItem(STORAGE_KEY_STREAMS, JSON.stringify(arr));
}

/**
 * EN: Adds a single stream value if it isn't already known. Called from
 *     `generate.js` after each successful save. The placeholder "---" is
 *     ignored on purpose — it is the "no value" marker.
 * UA: Додає одне значення «Стрім», якщо його ще немає у списку.
 *     Викликає `generate.js` після кожного успішного збереження.
 *     Плейсхолдер «---» ігнорується навмисно — це маркер «без значення».
 * @param {string} value
 */
export function addStreamValue(value) {
  const v = (value || "").trim();
  if (!v || v === "---") return;

  const list = loadStreams();
  if (list.includes(v)) return;

  list.push(v);
  saveStreams(list);
}

