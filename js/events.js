/**
 * Shared event dispatchers to avoid circular dependencies.
 * @module events
 */

/**
 * Notify UI that reports data changed (journal, map, etc.).
 */
export function emitReportsChanged() {
  try {
    window.dispatchEvent(new Event("reportsChanged"));
    window.dispatchEvent(new Event("reportsUpdated"));
  } catch {
    /* ignore */
  }
}
