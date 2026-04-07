/**
 * Storage helpers for known stream values.
 * Допоміжні функції для зберігання відомих значень поля «Стрім».
 * @module streams
 */

import { STORAGE_KEY_STREAMS } from "./constants.js";

/**
 * Loads known stream values from localStorage.
 * Завантажує відомі значення «Стрім» з localStorage.
 * @returns {string[]} Array of unique stream strings.
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
 * Saves stream values to localStorage.
 * Зберігає значення «Стрім» у localStorage.
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
 * Adds a single stream value if it does not exist yet.
 * Додає одне значення «Стрім», якщо його ще немає у списку.
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

