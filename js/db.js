/**
 * IndexedDB bootstrap: one database per origin for Report UAV v2.
 *
 * EN:
 *   Object stores: `reports`, `sync_queue`, `settings`, `sync_log`. All other
 *   modules obtain a connection through `openDatabase()`; do not open the DB
 *   ad hoc. Schema migrations: bump `DB_VERSION` and extend `onupgradeneeded`.
 *
 * UA:
 *   Об’єктні сховища: `reports`, `sync_queue`, `settings`, `sync_log`. Інші
 *   модулі завжди використовують `openDatabase()`; не відкривайте БД напряму.
 *   Міграції: збільшити `DB_VERSION` і дописати логіку в `onupgradeneeded`.
 *
 * @module db
 */

/** EN: Database name (stable for backups and docs). UA: Ім’я БД (стабільне для документації). */
export const DB_NAME = "report_uav_db_v2";

/** EN: Schema version — increment when stores/indexes change. UA: Версія схеми — підвищувати при зміні сховищ/індексів. */
export const DB_VERSION = 1;

/** @type {Promise<IDBDatabase>|null} */
let dbPromise = null;

/**
 * Opens the database and ensures object stores (onupgradeneeded).
 * @returns {Promise<IDBDatabase>}
 */
export function openDatabase() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
      req.onsuccess = () => resolve(req.result);
      req.onupgradeneeded = (event) => {
        const db = /** @type {IDBDatabase} */ (event.target).result;

        if (!db.objectStoreNames.contains("reports")) {
          const reports = db.createObjectStore("reports", { keyPath: "id" });
          reports.createIndex("createdAt", "createdAt", { unique: false });
          reports.createIndex("updatedAt", "updatedAt", { unique: false });
          reports.createIndex("publishedAt", "publishedAt", { unique: false });
          reports.createIndex("syncStatus", "syncStatus", { unique: false });
          reports.createIndex("sendAfter", "sendAfter", { unique: false });
        }

        if (!db.objectStoreNames.contains("sync_queue")) {
          const q = db.createObjectStore("sync_queue", { keyPath: "queueId" });
          q.createIndex("reportId", "reportId", { unique: false });
          q.createIndex("action", "action", { unique: false });
          q.createIndex("nextRetryAt", "nextRetryAt", { unique: false });
        }

        if (!db.objectStoreNames.contains("settings")) {
          db.createObjectStore("settings", { keyPath: "key" });
        }

        if (!db.objectStoreNames.contains("sync_log")) {
          const log = db.createObjectStore("sync_log", { keyPath: "id" });
          log.createIndex("reportId", "reportId", { unique: false });
          log.createIndex("timestamp", "timestamp", { unique: false });
        }
      };
    });
  }
  return dbPromise;
}

/**
 * EN: Close connection and reset the singleton — for unit/integration tests or
 *     devtools experiments only; not used in production UI.
 * UA: Закрити з’єднання й скинути singleton — лише для тестів або ручних
 *     експериментів у консолі; у продакшн-UI не викликається.
 * @returns {Promise<void>}
 */
export async function closeDatabaseForTests() {
  if (!dbPromise) return;
  const db = await dbPromise;
  db.close();
  dbPromise = null;
}
