/**
 * Application entry: DB, sync service, screens, navigation.
 * @module app
 */

import { openDatabase } from "./db.js";
import { startSyncService } from "./sync-service.js";
import { initMainFormScreen } from "./screens/mainForm.js";
import { initJournalScreen } from "./screens/journal.js";
import { initDataScreen } from "./screens/data.js";
import { initSettingsScreen } from "./screens/settings.js";
import { initMapScreen } from "./screens/map.js";
import { initNavigation } from "./navigation.js";

/**
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
}

initApp();
