/**
 * PWA update handler — checks for a new Service Worker build and applies it
 * without reinstalling the app.
 *
 * EN:
 *   Registers `./sw.js`, listens for `updatefound` / `waiting`, and wires
 *   `#btnPwaUpdate` so the user can pull fresh assets from the server
 *   (e.g. after a GitHub Pages deploy). Applying an update posts
 *   `SKIP_WAITING` to the waiting worker, then reloads on `controllerchange`.
 *
 * UA:
 *   Реєструє `./sw.js`, слухає `updatefound` / `waiting` і кнопку
 *   `#btnPwaUpdate` — підтягнути свіжі файли з сервера (після деплою на
 *   GitHub Pages) без перевстановлення PWA. Застосування оновлення надсилає
 *   `SKIP_WAITING` очікуючому воркеру, потім перезавантажує сторінку.
 *
 * @module pwa-update
 */

import { $ } from "./utils.js";

/** @type {ServiceWorkerRegistration | null} */
let registration = null;

/** @type {boolean} */
let userRequestedReload = false;

/** @type {boolean} */
let updateReady = false;

/**
 * EN: Writes status into `#pwaUpdateStatus`.
 * UA: Пише статус у `#pwaUpdateStatus`.
 * @param {string} msg
 */
function setUpdateStatus(msg) {
  const el = $("pwaUpdateStatus");
  if (el) el.textContent = msg || "";
}

/**
 * EN: Updates `#btnPwaUpdate` label and accent class.
 * UA: Оновлює підпис і акцент кнопки `#btnPwaUpdate`.
 */
function refreshUpdateButton() {
  const btn = $("btnPwaUpdate");
  if (!(btn instanceof HTMLButtonElement)) return;

  if (updateReady) {
    btn.textContent = "Застосувати оновлення";
    btn.classList.add("pwa-update-btn--ready");
    setUpdateStatus(
      "Доступна нова версія. Натисніть кнопку — застосунок перезавантажиться з оновленими файлами."
    );
    return;
  }

  btn.textContent = "Підтягнути оновлення";
  btn.classList.remove("pwa-update-btn--ready");
}

/**
 * EN: Marks that a waiting worker is ready to take over.
 * UA: Позначає, що очікуючий воркер готовий замінити поточний.
 */
function markUpdateReady() {
  if (!navigator.serviceWorker?.controller) return;
  updateReady = true;
  refreshUpdateButton();
}

/**
 * EN: Applies the waiting Service Worker and reloads the page.
 * UA: Активує очікуючий Service Worker і перезавантажує сторінку.
 */
function applyWaitingUpdate() {
  const waiting = registration?.waiting;
  if (!waiting) return;

  userRequestedReload = true;
  setUpdateStatus("Застосування оновлення…");
  waiting.postMessage({ type: "SKIP_WAITING" });
}

/**
 * EN: Asks the browser to check the server for a newer `sw.js`.
 * UA: Просить браузер перевірити сервер на новіший `sw.js`.
 * @returns {Promise<void>}
 */
async function checkForUpdate() {
  const btn = $("btnPwaUpdate");
  if (btn instanceof HTMLButtonElement) btn.disabled = true;

  try {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setUpdateStatus("Немає мережі. Підключіться до інтернету й спробуйте знову.");
      return;
    }

    const reg =
      registration ||
      (await navigator.serviceWorker.getRegistration("./")) ||
      (await navigator.serviceWorker.getRegistration());

    if (!reg) {
      setUpdateStatus("Service Worker ще не зареєстровано. Спробуйте оновити сторінку.");
      return;
    }

    registration = reg;

    if (reg.waiting && navigator.serviceWorker.controller) {
      markUpdateReady();
      return;
    }

    setUpdateStatus("Перевірка оновлень на сервері…");
    await reg.update();

    if (reg.waiting && navigator.serviceWorker.controller) {
      markUpdateReady();
      return;
    }

    if (reg.installing) {
      setUpdateStatus("Завантаження оновлення… Зачекайте кілька секунд.");
      return;
    }

    setUpdateStatus("Оновлень немає — у вас остання версія з сервера.");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setUpdateStatus("Не вдалося перевірити оновлення: " + msg);
  } finally {
    if (btn instanceof HTMLButtonElement) btn.disabled = false;
  }
}

/**
 * EN: Wire worker lifecycle events on a registration.
 * UA: Підписує події життєвого циклу воркера на реєстрації.
 * @param {ServiceWorkerRegistration} reg
 */
function bindRegistration(reg) {
  registration = reg;

  const trackWorker = (worker) => {
    if (!worker) return;
    worker.addEventListener("statechange", () => {
      if (
        worker.state === "installed" &&
        navigator.serviceWorker.controller &&
        reg.waiting
      ) {
        markUpdateReady();
      }
    });
  };

  trackWorker(reg.installing);
  trackWorker(reg.waiting);

  reg.addEventListener("updatefound", () => {
    trackWorker(reg.installing);
    setUpdateStatus("Знайдено оновлення, завантаження…");
  });

  if (reg.waiting && navigator.serviceWorker.controller) {
    markUpdateReady();
  }
}

/**
 * EN: Initialise update UI and Service Worker registration (idempotent).
 * UA: Ініціалізує UI оновлення та реєстрацію Service Worker.
 */
export function initPwaUpdate() {
  const btn = $("btnPwaUpdate");
  if (!(btn instanceof HTMLButtonElement)) return;

  if (!("serviceWorker" in navigator)) {
    btn.hidden = true;
    setUpdateStatus("Цей браузер не підтримує фонове оновлення застосунку.");
    return;
  }

  btn.hidden = false;
  refreshUpdateButton();

  btn.addEventListener("click", () => {
    if (updateReady) {
      applyWaitingUpdate();
      return;
    }
    void checkForUpdate();
  });

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!userRequestedReload) return;
    window.location.reload();
  });

  void navigator.serviceWorker
    .register("./sw.js", { scope: "./" })
    .then((reg) => {
      bindRegistration(reg);
      if (!navigator.serviceWorker.controller) {
        setUpdateStatus(
          "Офлайн-кеш увімкнено. Після наступних оновлень на сервері натискайте «Підтягнути оновлення»."
        );
      }
    })
    .catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      setUpdateStatus("Помилка реєстрації Service Worker: " + msg);
    });
}
