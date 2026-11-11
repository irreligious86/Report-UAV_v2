/**
 * Toast — a short message visible on ANY screen.
 *
 * EN:
 *   `utils.setStatus()` writes into `#status`, which lives on the form screen.
 *   Journal and map used it for "copied" / "deleted" / "copy failed", so the
 *   user standing on those screens never saw the message. A toast is attached
 *   to `<body>`, floats above every screen and overlay, and hides itself.
 *
 * UA:
 *   `utils.setStatus()` пише у `#status`, який живе на екрані форми. Журнал і
 *   карта писали туди «скопійовано» / «видалено» / «помилка копіювання» —
 *   користувач на цих екранах повідомлення не бачив. Тост чіпляється до
 *   `<body>`, висить над усіма екранами й оверлеями і зникає сам.
 *
 * @module toast
 */

/** EN: How long a toast stays on screen (ms). UA: Скільки тост лишається на екрані (мс). */
const TOAST_MS = 2600;

/** @type {HTMLElement | null} */
let toastEl = null;
let hideTimer = 0;

/**
 * EN: Shows a toast. A new message replaces the current one.
 * UA: Показує тост. Нове повідомлення замінює поточне.
 * @param {string} message
 * @param {{ error?: boolean }} [opt] EN: `error` paints it red and keeps it a bit longer. UA: `error` — червоний і тримається трохи довше.
 */
export function showToast(message, opt = {}) {
  const text = String(message || "").trim();
  if (!text) return;

  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.className = "toast";
    toastEl.setAttribute("role", "status");
    toastEl.setAttribute("aria-live", "polite");
    document.body.appendChild(toastEl);
  }

  toastEl.textContent = text;
  toastEl.classList.toggle("toast--error", !!opt.error);
  // EN: Force a reflow so the transition restarts for back-to-back toasts.
  // UA: Примусовий reflow — щоб перехід перезапускався для тостів поспіль.
  toastEl.classList.remove("toast--visible");
  void toastEl.offsetWidth;
  toastEl.classList.add("toast--visible");

  window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(
    () => toastEl?.classList.remove("toast--visible"),
    opt.error ? TOAST_MS * 1.5 : TOAST_MS,
  );
}
