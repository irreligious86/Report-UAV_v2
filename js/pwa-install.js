/**
 * PWA install prompt handler — bridges `beforeinstallprompt` to UI buttons.
 *
 * EN:
 *   Chromium-based browsers may fire `beforeinstallprompt`, which we intercept
 *   to show one or more `[data-pwa-install]` buttons. iOS Safari and Firefox
 *   typically do **not** fire this event — users rely on OS-specific instructions
 *   in the help tab; `#pwaStatus` explains that when no prompt is available.
 *
 * UA:
 *   Браузери на базі Chromium можуть надіслати `beforeinstallprompt`; ми
 *   перехоплюємо його й показуємо кнопки з атрибутом `[data-pwa-install]`.
 *   iOS Safari та Firefox зазвичай **не** генерують цю подію — встановлення
 *   лише за інструкцією в довідці; блок `#pwaStatus` пояснює, якщо кнопки немає.
 *
 * @module pwa-install
 */

import { $ } from "./utils.js";

/** @type {BeforeInstallPromptEvent | null} */
let deferredPrompt = null;

/** EN: True after the browser fired `beforeinstallprompt`. UA: Подія вже була. */
let installPromptAvailable = false;

/**
 * EN: Show or hide every install button (primary + duplicates in the help tab).
 * UA: Показати або сховати всі кнопки встановлення.
 * @param {boolean} visible
 */
function toggleInstallButtons(visible) {
  document.querySelectorAll("[data-pwa-install]").forEach((node) => {
    if (node instanceof HTMLElement) node.hidden = !visible;
  });
}

/**
 * EN: Show contextual hint when the native install flow is unavailable.
 * UA: Підказка, коли системна кнопка встановлення недоступна.
 * @param {boolean} visible
 * @param {string} [text]
 */
function setInstallStatus(visible, text = "") {
  const wrap = $("pwaStatus");
  const label = $("pwaStatusText");
  if (!wrap || !label) return;
  wrap.hidden = !visible;
  if (visible) label.textContent = text;
}

/**
 * EN: Detect iOS/iPadOS Safari-like environments without `beforeinstallprompt`.
 * UA: Визначення iOS / iPadOS, де зазвичай немає `beforeinstallprompt`.
 * @returns {boolean}
 */
function isLikelyIos() {
  if (navigator.standalone === true) return true;
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/i.test(ua);
}

/**
 * Initializes PWA install logic. Call once from `app.js` after DOM is ready.
 *
 * EN: Wires click handlers to every `[data-pwa-install]` node.
 * UA: Підписує всі вузли `[data-pwa-install]` на клік.
 */
export function initPwaInstall() {
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    navigator.standalone === true;

  if (standalone) {
    toggleInstallButtons(false);
    setInstallStatus(true, "Запущено як застосунок на пристрої / Running as installed app");
    return;
  }

  toggleInstallButtons(false);
  setInstallStatus(false);

  const onPromptClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") toggleInstallButtons(false);
    deferredPrompt = null;
  };

  document.querySelectorAll("[data-pwa-install]").forEach((node) => {
    node.addEventListener("click", onPromptClick);
  });

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = /** @type {BeforeInstallPromptEvent} */ (e);
    installPromptAvailable = true;
    setInstallStatus(false);
    toggleInstallButtons(true);
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    installPromptAvailable = true;
    toggleInstallButtons(false);
    setInstallStatus(true, "Встановлено / Installed");
  });

  /**
   * EN: If `beforeinstallprompt` never arrives, surface a short hint so users
   *     open the OS-specific guides in section 8.
   * UA: Якщо подія так і не прийшла — показати коротку підказку про розділ 8.
   */
  window.setTimeout(() => {
    if (installPromptAvailable || deferredPrompt) return;

    if (isLikelyIos()) {
      setInstallStatus(
        true,
        "У Safari на iPhone/iPad немає кнопки «Встановити» — розгорніть інструкцію «iPhone / iPad» нижче. " +
          "On iPhone/iPad Safari there is no install button — expand the iOS guide below."
      );
      return;
    }

    setInstallStatus(
      true,
      "Якщо кнопки встановлення немає — розгорніть інструкцію для вашої ОС нижче або відкрийте сайт у Chrome/Edge. " +
        "If no install button appears, use the OS guide below or open the site in Chrome/Edge."
    );
  }, 2600);
}
