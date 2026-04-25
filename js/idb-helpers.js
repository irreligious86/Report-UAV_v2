/**
 * EN: Small wrappers around IndexedDB transactions to remove the repeated
 *     `await new Promise((res, rej) => { const tx = db.transaction(...); ... })`
 *     boilerplate from storage modules.
 *
 *     Every helper opens the database via `openDatabase()`, starts a transaction
 *     with the requested mode, and resolves once the transaction completes.
 *     Errors from either the transaction or the passed callback bubble up.
 *
 * UA: Обгортки над транзакціями IndexedDB, що прибирають шаблонний код
 *     `await new Promise(...)` із store-модулів. Кожна функція відкриває базу
 *     через `openDatabase()`, стартує транзакцію у потрібному режимі та
 *     резолвиться після `tx.oncomplete`. Помилки всередині callback або
 *     транзакції піднімаються нагору.
 *
 * @module idb-helpers
 */

import { openDatabase } from "./db.js";

/**
 * @template T
 * @typedef {(tx: IDBTransaction) => T | Promise<T>} TxCallback
 */

/**
 * EN: Runs a read-only transaction over one or more object stores.
 *     The callback receives the active `IDBTransaction`; whatever it returns
 *     (sync or async) becomes the resolved value once the transaction commits.
 * UA: Виконує транзакцію тільки для читання над одним або кількома об'єкт-сторами.
 *     Callback отримує активну `IDBTransaction`; значення, яке він поверне
 *     (синхронно або Promise), буде значенням, з яким зарезолвиться helper
 *     після `oncomplete`.
 *
 * @template T
 * @param {string|string[]} storeNames
 * @param {TxCallback<T>} cb
 * @returns {Promise<T>}
 */
export async function runReadonly(storeNames, cb) {
  const db = await openDatabase();
  return runTx(db, storeNames, "readonly", cb);
}

/**
 * EN: Runs a read-write transaction over one or more object stores.
 * UA: Виконує транзакцію читання-запису над одним або кількома сторами.
 * @template T
 * @param {string|string[]} storeNames
 * @param {TxCallback<T>} cb
 * @returns {Promise<T>}
 */
export async function runReadwrite(storeNames, cb) {
  const db = await openDatabase();
  return runTx(db, storeNames, "readwrite", cb);
}

/**
 * EN: Default timeout for IDB transactions (ms). If a transaction does not
 *     complete within this time, the promise rejects and the tx is aborted.
 *     Prevents the app from hanging indefinitely on stuck transactions.
 * UA: Тайм-аут для IDB-транзакцій (мс). Якщо транзакція не завершиться
 *     за цей час, promise зареджектиться і транзакцію буде перервано.
 *     Запобігає зависанню застосунку на "мертвих" транзакціях.
 */
const TX_TIMEOUT_MS = 10_000;

/**
 * EN: Internal executor shared by read-only and read-write helpers.
 *     Includes a safety timeout that aborts the transaction if it hangs.
 * UA: Спільна реалізація для readonly/readwrite helper-ів.
 *     Включає захисний тайм-аут, що перериває транзакцію при зависанні.
 * @template T
 * @param {IDBDatabase} db
 * @param {string|string[]} storeNames
 * @param {IDBTransactionMode} mode
 * @param {TxCallback<T>} cb
 * @returns {Promise<T>}
 */
function runTx(db, storeNames, mode, cb) {
  return new Promise((resolve, reject) => {
    let tx;
    try {
      tx = db.transaction(storeNames, mode);
    } catch (err) {
      reject(err);
      return;
    }

    let settled = false;
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };

    /* EN: Safety net — abort transaction if it hangs longer than TX_TIMEOUT_MS.
       UA: Захисна сітка — переривання транзакції при зависанні. */
    const timer = setTimeout(() => {
      if (settled) return;
      try { tx.abort(); } catch { /* noop */ }
      settle(reject, new Error(`IDB transaction timeout (${TX_TIMEOUT_MS}ms)`));
    }, TX_TIMEOUT_MS);

    /** @type {T} */
    let result;
    let captured = false;

    /* EN: Start the caller's work synchronously so tx stays open.
       UA: Запускаємо callback одразу — транзакція не встигне "заснути". */
    try {
      const maybePromise = cb(tx);
      if (maybePromise && typeof maybePromise.then === "function") {
        maybePromise.then(
          (v) => {
            result = v;
            captured = true;
          },
          (err) => {
            try { tx.abort(); } catch { /* noop */ }
            settle(reject, err);
          },
        );
      } else {
        result = /** @type {T} */ (maybePromise);
        captured = true;
      }
    } catch (err) {
      try { tx.abort(); } catch { /* noop */ }
      settle(reject, err);
      return;
    }

    tx.oncomplete = () => {
      if (captured) settle(resolve, result);
      /* EN: async callback may still be pending — resolve in next microtask.
         UA: async callback може ще не завершитися — чекаємо наступний мікротик. */
      else queueMicrotask(() => settle(resolve, result));
    };
    tx.onerror = () => settle(reject, tx.error || new Error("IDB transaction failed"));
    tx.onabort = () => {
      if (!settled) settle(reject, tx.error || new Error("IDB transaction aborted"));
    };
  });
}

/**
 * EN: Convenience helper — returns all rows from a single object store.
 * UA: Зручний helper — повертає всі записи з одного об'єкт-стору.
 * @template T
 * @param {string} storeName
 * @returns {Promise<T[]>}
 */
export async function getAll(storeName) {
  return runReadonly(storeName, (tx) =>
    new Promise((resolve, reject) => {
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(/** @type {T[]} */ (req.result || []));
      req.onerror = () => reject(req.error);
    }),
  );
}

/**
 * EN: Convenience helper — returns one row by primary key, or `undefined`.
 * UA: Зручний helper — повертає один запис за ключем або `undefined`.
 * @template T
 * @param {string} storeName
 * @param {IDBValidKey} key
 * @returns {Promise<T|undefined>}
 */
export async function getByKey(storeName, key) {
  return runReadonly(storeName, (tx) =>
    new Promise((resolve, reject) => {
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(/** @type {T|undefined} */ (req.result));
      req.onerror = () => reject(req.error);
    }),
  );
}
