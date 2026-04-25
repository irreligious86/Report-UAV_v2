/**
 * Navigation between logical screens — long-press menu on the title.
 *
 * EN:
 *   The app is a single-page bundle. Each "screen" is a top-level `<div>`
 *   in `index.html` with an `id="screen-*"` class `.screen`; switching
 *   screens means toggling the `screenHidden` class.
 *
 *   How the user navigates:
 *     - long-press the title for `LONG_PRESS_MS` → menu pops up,
 *     - tap a menu item → `navigateTo(id)` flips classes and updates the
 *       title text.
 *
 *   Per-screen housekeeping:
 *     - leaving the map → `resetMapLayout()` collapses fullscreen mode,
 *     - leaving the journal → `resetJournalListLayout()` collapses the
 *       expanded list,
 *     - entering the form → `refreshMissionDateForNewDay()` to handle
 *       midnight crossings while the tab was open,
 *     - entering the map → `onMapScreenShown()` so Leaflet can
 *       `invalidateSize()` and refresh tiles.
 *
 *   The title doubles as a "v2 badge" on the form screen and a clean
 *   text on others — handled in the switch at the bottom of `navigateTo`.
 *
 * UA:
 *   Застосунок — один SPA-бандл. Кожен «екран» — це `<div>` верхнього
 *   рівня у `index.html` із `id="screen-*"` та класом `.screen`;
 *   перемикання екранів = перемикання класу `screenHidden`.
 *
 *   Як користувач навігує:
 *     - довго утримує заголовок `LONG_PRESS_MS` → випливає меню,
 *     - тап по пункту → `navigateTo(id)` перемикає класи і оновлює
 *       текст заголовка.
 *
 *   Покроково на кожному переході:
 *     - вихід із мапи → `resetMapLayout()` згортає fullscreen,
 *     - вихід із журналу → `resetJournalListLayout()` згортає
 *       розгорнутий список,
 *     - вхід у форму → `refreshMissionDateForNewDay()` ловить перехід
 *       через північ, поки вкладка була відкрита,
 *     - вхід у мапу → `onMapScreenShown()`, щоб Leaflet зробив
 *       `invalidateSize()` і освіжив тайли.
 *
 *   На екрані форми заголовок несе «v2-бейдж», на інших — чистий текст;
 *   усе це у switch в кінці `navigateTo`.
 *
 * @module navigation
 */

import { $, refreshMissionDateForNewDay } from "./utils.js";
import { onMapScreenShown, resetMapLayout } from "./screens/map.js";
import { resetJournalListLayout } from "./screens/journal.js";
import { LONG_PRESS_MS } from "./constants.js";

/** EN: Known screen ids (order matches the menu in `index.html`). UA: Відомі id екранів (порядок відповідає меню в `index.html`). */
const SCREEN_IDS = ["main", "journal", "data", "map", "settings", "help"];

/** EN: Currently active screen id. UA: Поточний активний екран. */
let currentScreenId = "main";

/** EN: setTimeout id for the title long-press detection. UA: id setTimeout, що чекає довгого натискання. */
let longPressTimer = null;

/** EN: Cached `#screenMenu` root for repeated DOM look-ups. UA: Кешований корінь `#screenMenu`. */
let menuElement = null;

/**
 * EN: Initialises navigation — wires long-press on the title, menu clicks
 *     and the initial screen render. Idempotent in practice (safe to call
 *     once at boot).
 * UA: Ініціалізує навігацію — навішує long-press на заголовок, обробник
 *     кліків по меню і робить перший рендер екрана. Викликати один раз
 *     під час старту.
 */
export function initNavigation() {
  const titleEl = $("title");
  const menuEl = $("screenMenu");
  const backdropEl = $("screenMenuBackdrop");

  if (!titleEl || !menuEl) {
    return;
  }

  menuElement = menuEl;

  const clearPress = () => {
    if (longPressTimer !== null) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  };

  const openMenu = () => {
    menuEl.classList.add("is-open");
    menuEl.setAttribute("aria-hidden", "false");
  };

  const closeMenu = () => {
    menuEl.classList.remove("is-open");
    menuEl.setAttribute("aria-hidden", "true");
    clearPress();
  };

  const startPress = () => {
    clearPress();
    longPressTimer = window.setTimeout(() => {
      openMenu();
    }, LONG_PRESS_MS);
  };

  // Mouse / touch bindings for long-press on title.
  titleEl.addEventListener("mousedown", startPress);
  titleEl.addEventListener("touchstart", startPress, { passive: true });

  titleEl.addEventListener("mouseup", clearPress);
  titleEl.addEventListener("mouseleave", clearPress);
  titleEl.addEventListener("touchend", clearPress);
  titleEl.addEventListener("touchcancel", clearPress);

  // Close on backdrop click.
  if (backdropEl) {
    backdropEl.addEventListener("click", () => {
      closeMenu();
    });
  }

  // Handle menu buttons.
  menuEl.addEventListener("click", (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;

    const screenBtn = target.closest("[data-screen]");
    if (screenBtn instanceof HTMLElement && screenBtn.dataset.screen) {
      const nextId = screenBtn.dataset.screen;
      const isOther = nextId !== currentScreenId;

      navigateTo(nextId);
      closeMenu();
      return;
    }

    if (target.hasAttribute("data-screen-menu-close")) {
      closeMenu();
    }
  });

  // Ensure initial screen is visible.
  navigateTo(currentScreenId);
}

/**
 * EN: Switches the active screen and updates the title bar. Unknown ids
 *     are silently ignored. Per-screen housekeeping (collapse fullscreen
 *     map, refresh date, etc.) is also performed here.
 * UA: Перемикає активний екран і оновлює заголовок. Невідомі id тихо
 *     ігноруються. Тут же виконується "прибирання" екранів (згорнути
 *     повноекранну мапу, освіжити дату тощо).
 * @param {string} screenId — EN: one of SCREEN_IDS. UA: один із SCREEN_IDS.
 */
export function navigateTo(screenId) {
  if (!SCREEN_IDS.includes(screenId)) return;

  if (screenId !== "map") {
    resetMapLayout();
  }
  if (screenId !== "journal") {
    resetJournalListLayout();
  }

  currentScreenId = screenId;

  for (const id of SCREEN_IDS) {
    const el = $(`screen-${id}`);
    if (!el) continue;

    if (id === currentScreenId) el.classList.remove("screenHidden");
    else el.classList.add("screenHidden");
  }

  // Highlight active menu item if menu is present.
  if (menuElement) {
    const items = menuElement.querySelectorAll("[data-screen]");
    items.forEach((btn) => {
      if (!(btn instanceof HTMLElement)) return;

      if (btn.dataset.screen === currentScreenId) {
        btn.classList.add("is-active");
      } else {
        btn.classList.remove("is-active");
      }
    });
  }

  const titleEl = $("title");
  if (titleEl) {
    const v2Badge = ' <span class="version-badge">v2</span>';
    switch (currentScreenId) {
      case "main":
        titleEl.innerHTML = "Звіт по БПЛА" + v2Badge;
        break;
      case "journal":
        titleEl.textContent = "Журнал та статистика";
        break;
      case "data":
        titleEl.textContent = "Дані та інтеграція";
        break;
      case "map":
        titleEl.textContent = "Карта місій";
        break;
      case "settings":
        titleEl.textContent = "Налаштування списків";
        break;
      case "help":
        titleEl.textContent = "Довідка та контакти";
        break;
      default:
        titleEl.innerHTML = "Звіт по БПЛА" + v2Badge;
        break;
    }
  }

  if (currentScreenId === "main") {
    refreshMissionDateForNewDay();
  }

  if (currentScreenId === "map") {
    onMapScreenShown();
  }

  // Close the menu overlay when navigating.
  if (menuElement) {
    menuElement.classList.remove("is-open");
  }
}