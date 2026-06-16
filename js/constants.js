/**
 * Centralized keys and limits — tune without hunting literals across files.
 *
 * EN: Version suffixes on `localStorage` keys intentionally reset user data when semantics change.
 * UA: Суфікси версій у ключах `localStorage` навмисно скидають збережені дані при зміні сенсу.
 *
 * @module constants
 */

/** EN: Relative URL of list defaults (drones, results, …). UA: Відносний URL списків за замовчуванням. */
export const CONFIG_URL = "./config.json";

/** EN: localStorage key for crew flight counter (1–25); bump version to invalidate. UA: Ключ лічильника вильотів екіпажу; змінити версію — скинути збережене значення. */
export const STORAGE_KEY_COUNTER = "uav_report_counter_v13";

/** EN: localStorage key for last-used crew callsign. UA: Ключ останнього позивного екіпажу. */
export const STORAGE_KEY_CREW_NAME = "uav_crew_name_v1";

/** EN: Default stream field placeholder. UA: Плейсхолдер поля «Стрім». */
export const STREAM_PLACEHOLDER = "---";

/** EN: Max length for drone, mission type, ammo and stream text fields. UA: Макс. довжина для борту, характеру, боєприпасу та стріму. */
export const FORM_TEXT_FIELD_MAX_LENGTH = 32;

/** EN: Max reports in IndexedDB; bulk import may drop oldest. UA: Максимум звітів у IndexedDB; при імпорті старі можуть відсіктися. */
export const REPORTS_LIMIT = 500;

/** EN: User overrides for `config.json` lists (settings screen). UA: Перевизначення списків з `config.json` (екран налаштувань). */
export const STORAGE_KEY_CONFIG_OVERRIDES = "uav_report_config_overrides_v1";

/** EN: Known stream values accumulated from submitted reports. UA: Зібрані значення поля «Стрім». */
export const STORAGE_KEY_STREAMS = "uav_report_streams_v1";

/** EN: Saved basemap label for Leaflet layer switcher. UA: Збережений підпис базового шару карти. */
export const STORAGE_KEY_MAP_BASEMAP = "uav_map_basemap_label_v1";

/** EN: Per-browser id for sync / Sheets (stable in localStorage). UA: Стабільний id пристрою для синхронізації. */
export const STORAGE_KEY_DEVICE_ID = "uav_device_id_v1";

/** EN: Hold duration (ms) to trigger long-press actions (title menu, select→input edit). UA: Тривалість утримання (мс) для long-press дій (меню заголовка, редагування select). */
export const LONG_PRESS_MS = 500;

