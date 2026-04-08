/**
 * PWA install prompt handler.
 *
 * Captures the browser's `beforeinstallprompt` event and wires it
 * to a UI button (#pwaInstallBtn). The button is hidden when:
 *   - the app is already installed (display-mode: standalone),
 *   - the browser doesn't support the prompt (iOS Safari, Firefox),
 *   - the user dismisses the prompt.
 *
 * @module pwa-install
 */

import { $ } from "./utils.js";

/** @type {BeforeInstallPromptEvent | null} */
let deferredPrompt = null;

/** Show/hide the install button. */
function toggleBtn(visible) {
  const btn = $("pwaInstallBtn");
  if (!btn) return;
  btn.hidden = !visible;
}

/**
 * Initializes PWA install logic.
 * Call once from app.js after DOM is ready.
 */
export function initPwaInstall() {
  /* Already running as installed PWA — nothing to show. */
  if (window.matchMedia("(display-mode: standalone)").matches ||
      navigator.standalone === true) {
    toggleBtn(false);
    return;
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = /** @type {BeforeInstallPromptEvent} */ (e);
    toggleBtn(true);
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    toggleBtn(false);
  });

  const btn = $("pwaInstallBtn");
  if (btn) {
    btn.addEventListener("click", async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") {
        toggleBtn(false);
      }
      deferredPrompt = null;
    });
  }
}
