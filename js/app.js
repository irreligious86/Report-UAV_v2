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

/**
 * EN: Boots the client application (called once at load).
 * UA: Запуск клієнтського застосунку (один раз при завантаженні).
 * @returns {Promise<void>}
 */
async function initApp() {
  await openDatabase();
  startSyncService();
  await initMainFormScreen();
  await initJournalScreen();
  await initDataScreen();
  await initSettingsScreen();
  initMapScreen();
  initNavigation();
  initHelpScreen();
  initPwaInstall();
  initPwaUpdate();
}

initApp();
