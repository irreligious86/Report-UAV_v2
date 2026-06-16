/**
 * Lightweight cross-module notifications (browser `window` events).
 *
 * EN:
 *   `report-actions`, `sync-service`, and `sync-queue-processor` must not import
 *   screen modules (that would create cycles). They call `emitReportsChanged()`
 *   instead; journal/map/listeners subscribe via `window.addEventListener`.
 *   Two event names are fired for backward compatibility with older listeners.
 *
 * UA:
 *   Модулі даних не імпортують екрани (уникаємо циклічних залежностей). Замість
 *   цього викликається `emitReportsChanged()`; журнал, карта тощо підписані на
 *   `window`. Дві назви подій — для сумісності зі старими обробниками.
 *
 * @module events
 */

/**
 * EN: Notify all listeners that report list or metadata changed.
 * UA: Сповістити підписників, що змінились звіти або їх метадані.
 */
export function emitReportsChanged() {
  try {
    window.dispatchEvent(new Event("reportsChanged"));
    window.dispatchEvent(new Event("reportsUpdated"));
  } catch {
    /* ignore */
  }
}
