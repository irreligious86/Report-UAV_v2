/**
 * Help / documentation screen — interactive table of contents, scroll spy,
 * reading progress, expand/collapse all, back-to-top, PWA guide jumps.
 *
 * EN:
 *   This module wires purely presentational behaviour for `#screen-help`.
 *   It keeps markup in `index.html` as the single source of textual content;
 *   behaviour is added here so the help tab stays maintainable as sections grow.
 *
 * UA:
 *   Цей модуль додає лише інтерактив до екрана `#screen-help`: навігація по
 *   розділах, прогрес читання, згортання/розгортання, «вгору», перехід до
 *   інструкцій PWA. Текст лишається в `index.html`.
 *
 * @module screens/help
 */

import { $ } from "../utils.js";

/** @type {boolean} */
let initialized = false;

/** @type {HTMLElement | null} */
let progressBar = null;

/** @type {(() => void) | null} */
let scrollUnsub = null;

/** @type {IntersectionObserver | null} */
let sectionObserver = null;

/**
 * EN: True when the help screen is visible (not `.screenHidden`).
 * UA: Екран довідки зараз показано.
 * @returns {boolean}
 */
function isHelpScreenVisible() {
  const el = $("screen-help");
  return !!(el && !el.classList.contains("screenHidden"));
}

/**
 * EN: All top-level `<details class="help-section">` elements.
 * UA: Усі верхньорівневі секції-довідки.
 * @returns {HTMLDetailsElement[]}
 */
function getHelpSections() {
  const root = $("helpCard");
  if (!root) return [];
  return Array.from(root.querySelectorAll(":scope > details.help-section"));
}

/**
 * EN: Expand or collapse every help section (accordion).
 * UA: Розгорнути або згорнути всі розділи.
 * @param {boolean} open
 */
function setAllHelpSectionsOpen(open) {
  for (const d of getHelpSections()) {
    d.open = open;
  }
  syncHelpToggleAllButton();
}

/**
 * EN: Sync expand/collapse-all toggle icon and labels with section state.
 * UA: Синхронізує іконку та підписи перемикача «всі розділи» зі станом.
 */
function syncHelpToggleAllButton() {
  const btn = $("helpToggleAllBtn");
  if (!(btn instanceof HTMLButtonElement)) return;

  const sections = getHelpSections();
  const allOpen = sections.length > 0 && sections.every((d) => d.open);

  btn.classList.toggle("help-hero-toggle--expanded", allOpen);
  btn.setAttribute("aria-expanded", allOpen ? "true" : "false");
  btn.title = allOpen ? "Згорнути все" : "Розгорнути все";
  btn.setAttribute(
    "aria-label",
    allOpen ? "Згорнути всі розділи довідки" : "Розгорнути всі розділи довідки"
  );
}

/**
 * EN: Expand all sections if any are closed; otherwise collapse all.
 * UA: Розгорнути всі, якщо щось згорнуто; інакше — згорнути всі.
 */
function toggleAllHelpSections() {
  const sections = getHelpSections();
  const allOpen = sections.length > 0 && sections.every((d) => d.open);
  setAllHelpSectionsOpen(!allOpen);
}

/**
 * EN: Scroll an element into view and optionally expand a `<details>` ancestor.
 * UA: Прокрутити до елемента; за потреби відкрити батьківський `<details>`.
 * @param {HTMLElement} el
 * @param {boolean} [openDetails=true]
 */
function scrollElementIntoViewSmooth(el, openDetails = true) {
  if (openDetails) {
    let p = el.parentElement;
    while (p) {
      if (p instanceof HTMLDetailsElement) p.open = true;
      p = p.parentElement;
    }
  }
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

/**
 * EN: Highlight the TOC chip that matches the visible section (scroll spy).
 * UA: Підсвітити чіп навігації для видимого розділу.
 * @param {string | null} activeId - `id` of `details.help-section` or null.
 */
function setActiveTocChip(activeId) {
  const toc = document.querySelector(".help-toc");
  if (!toc) return;

  const chips = toc.querySelectorAll("[data-help-jump]");
  chips.forEach((btn) => {
    if (!(btn instanceof HTMLElement)) return;
    const id = btn.dataset.helpJump || "";
    const isActive = activeId != null && id === activeId;
    btn.classList.toggle("is-active", isActive);
    if (isActive) btn.setAttribute("aria-current", "location");
    else btn.removeAttribute("aria-current");
  });
}

/**
 * EN: Update the thin reading progress bar at the top of the help card.
 * UA: Оновити смужку прогресу читання.
 */
function updateReadingProgress() {
  if (!progressBar) return;
  if (!isHelpScreenVisible()) {
    progressBar.style.transform = "scaleX(0)";
    return;
  }

  const doc = document.documentElement;
  const scrollTop = window.scrollY || doc.scrollTop;
  const height = doc.scrollHeight - doc.clientHeight;
  const ratio = height > 0 ? Math.min(1, Math.max(0, scrollTop / height)) : 0;
  progressBar.style.transform = `scaleX(${ratio})`;
}

/**
 * EN: Show or hide the floating "back to top" control.
 * UA: Показати/сховати кнопку «вгору».
 * @param {boolean} visible
 */
function setBackToTopVisible(visible) {
  const btn = $("helpToTopBtn");
  if (!btn) return;
  btn.hidden = !visible;
}

/**
 * EN: Jump to a section by id, open it, update TOC.
 * UA: Перейти до розділу за id, відкрити його.
 * @param {string} sectionId
 */
function jumpToHelpSection(sectionId) {
  const el = document.getElementById(sectionId);
  if (!(el instanceof HTMLElement)) return;

  if (el instanceof HTMLDetailsElement) el.open = true;
  setActiveTocChip(sectionId);
  scrollElementIntoViewSmooth(el, true);

  const title = el.querySelector(".help-section-title");
  if (title instanceof HTMLElement) {
    window.setTimeout(() => title.focus({ preventScroll: true }), 350);
  }
}

/**
 * EN: Jump to a nested PWA OS guide (`details.pwa-guide`) and open it.
 * UA: Відкрити вкладену інструкцію PWA для обраної ОС.
 * @param {string} guideId
 */
function jumpToPwaGuide(guideId) {
  const el = document.getElementById(guideId);
  if (!(el instanceof HTMLElement)) return;

  const sec = document.getElementById("help-sec-8");
  if (sec instanceof HTMLDetailsElement) sec.open = true;
  if (el instanceof HTMLDetailsElement) el.open = true;

  scrollElementIntoViewSmooth(el, true);
}

/**
 * EN: Observe which `.help-section` intersects the viewport for TOC sync.
 * UA: Відстежувати видимий розділ для синхронізації з чіпами.
 */
function setupSectionScrollSpy() {
  const root = $("helpCard");
  if (!root || typeof IntersectionObserver === "undefined") return;

  sectionObserver?.disconnect();

  const sections = root.querySelectorAll("details.help-section[id]");
  if (!sections.length) return;

  /** @type {string | null} */
  let current = null;

  sectionObserver = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => (b.intersectionRatio || 0) - (a.intersectionRatio || 0));

      if (!visible.length) return;
      const id = visible[0].target.getAttribute("id");
      if (id && id !== current) {
        current = id;
        setActiveTocChip(id);
      }
    },
    { root: null, threshold: [0.12, 0.25, 0.4], rootMargin: "-52px 0px -55% 0px" }
  );

  sections.forEach((s) => sectionObserver?.observe(s));
}

/**
 * EN: Attach window scroll listener for progress + back-to-top.
 * UA: Підписатися на scroll для прогресу та кнопки «вгору».
 */
function bindWindowScrollHandlers() {
  scrollUnsub?.();

  const onScroll = () => {
    updateReadingProgress();
    if (!isHelpScreenVisible()) {
      setBackToTopVisible(false);
      return;
    }
    setBackToTopVisible(window.scrollY > 320);
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  scrollUnsub = () => window.removeEventListener("scroll", onScroll);

  onScroll();
}

/**
 * EN: Initialise help screen behaviour (idempotent).
 * UA: Ініціалізувати поведінку екрана довідки (ідемпотентно).
 */
export function initHelpScreen() {
  if (initialized) return;
  initialized = true;

  progressBar = document.getElementById("helpReadingProgressBar");

  const card = $("helpCard");
  if (card) {
    card.addEventListener("click", (ev) => {
      const t = ev.target;
      if (!(t instanceof HTMLElement)) return;

      const jump = t.closest("[data-help-jump]");
      if (jump instanceof HTMLElement && jump.dataset.helpJump) {
        ev.preventDefault();
        jumpToHelpSection(jump.dataset.helpJump);
      }

      const toggleAllBtn = t.closest("#helpToggleAllBtn");
      if (toggleAllBtn instanceof HTMLButtonElement) {
        ev.preventDefault();
        toggleAllHelpSections();
      }

      const pwaJump = t.closest("[data-pwa-guide-jump]");
      if (pwaJump instanceof HTMLElement && pwaJump.dataset.pwaGuideJump) {
        ev.preventDefault();
        jumpToPwaGuide(pwaJump.dataset.pwaGuideJump);
      }
    });
  }

  const toTop = $("helpToTopBtn");
  if (toTop) {
    toTop.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  bindWindowScrollHandlers();
  setupSectionScrollSpy();

  for (const section of getHelpSections()) {
    section.addEventListener("toggle", syncHelpToggleAllButton);
  }
  syncHelpToggleAllButton();

  const helpScreen = $("screen-help");
  if (helpScreen) {
    const mo = new MutationObserver(() => {
      updateReadingProgress();
      if (!isHelpScreenVisible()) setBackToTopVisible(false);
    });
    mo.observe(helpScreen, { attributes: true, attributeFilter: ["class"] });
  }

  updateReadingProgress();

  /* Default TOC highlight matches the first open section (see index.html). */
  setActiveTocChip("help-sec-1");
}
