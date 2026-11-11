/**
 * Application entry: IndexedDB, background sync, feature screens, navigation.
 *
 * EN:
 *   Boot order: open the database first, then start the sync scheduler (no-op
 *   until settings exist), then initialise UI modules. Help and PWA install
 *   are lightweight and run last.
 *
 * UA:
 *   Порядок завантаження: спочатку IndexedDB, потім фонова синхронізація (без
 *   дій, доки немає налаштувань), далі екрани. Довідка та PWA — в кінці.
 *
 * @module app
 */

import { openDatabase } from "./db.js";
import { startSyncService } from "./sync-service.js";
import { initMainFormScreen } from "./screens/mainForm.js";
import { initJournalScreen } from "./screens/journal.js";
import { initDataScreen } from "./screens/data.js";
import { initSettingsScreen } from "./screens/settings.js";
import { initMapScreen } from "./screens/map.js";
import { initHelpScreen } from "./screens/help.js";
import { initNavigation } from "./navigation.js";
import { initPwaInstall } from "./pwa-install.js";
import { initPwaUpdate } from "./pwa-update.js";
import { setStatus } from "./utils.js";
import * as logger from "./logger.js";

/**
 * EN: Runs one boot step and never lets its failure stop the next ones.
 *     Without this a single rejected promise (config.json unreachable,
 *     IndexedDB blocked in a private tab) aborted `initApp()` half-way and the
 *     user was left without navigation — unable even to open Help.
 * UA: Виконує один крок запуску і не дає його збою зупинити наступні.
 *     Без цього один відхилений проміс (недоступний config.json, заблокована
 *     IndexedDB у приватній вкладці) обривав `initApp()` посередині, і
 *     користувач лишався без навігації — не міг відкрити навіть Довідку.
 * @param {string} name EN: step label for the log. UA: назва кроку для логу.
 * @param {() => unknown | Promise<unknown>} fn
 * @returns {Promise<boolean>} EN: true if the step succeeded. UA: true, якщо крок успішний.
 */
async function bootStep_(name, fn) {
  try {
    await fn();
    return true;
  } catch (err) {
    logger.error(`boot step failed: ${name}`, err);
    return false;
  }
}

/**
 * EN: Boots the client application (called once at load).
 * UA: Запуск клієнтського застосунку (один раз при завантаженні).
 * @returns {Promise<void>}
 */
async function initApp() {
  const failed = [];
  const step = async (name, fn) => {
    if (!(await bootStep_(name, fn))) failed.push(name);
  };

  await step("база даних", openDatabase);
  await step("синхронізація", startSyncService);
  await step("форма", initMainFormScreen);
  await step("журнал", initJournalScreen);
  await step("дані", initDataScreen);
  await step("списки", initSettingsScreen);
  await step("карта", initMapScreen);
  await step("навігація", initNavigation);
  await step("довідка", initHelpScreen);
  await step("встановлення", initPwaInstall);
  await step("оновлення", initPwaUpdate);

  if (failed.length) {
    setStatus(`Частина застосунку не запустилась: ${failed.join(", ")}. Спробуйте перезавантажити сторінку.`);
  }
}

initApp();
