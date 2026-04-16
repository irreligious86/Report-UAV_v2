# Report UAV v2 — architecture / архітектура

## EN

**Paradigm:** Single-page app (SPA), ES modules, no bundler. Entry: `js/app.js`.

**Layers (dependency direction is one-way, top → bottom):**

1. **`app.js`** — boot order: `openDatabase` → `startSyncService` → screen `init*` → `initNavigation` → `initHelpScreen` → `initPwaInstall`.
2. **Screens** (`js/screens/*.js`) — DOM for one route; call facades, not raw IDB.
3. **Facades** — `report-actions.js` (reports + sync side effects), `generate.js` (form submit), `sync-service.js` (timer + queue drain).
4. **Data** — `reports-store.js`, `sync-queue-store.js`, `settings-store.js` → `db.js` / `idb-helpers.js`.
5. **Integration** — `google-sheets-api.js`, `sync-queue-processor.js` (HTTP + retries).
6. **Pure helpers** — `report-format.js`, `filters.js` + `date-utils.js`, `result-mapping.js`, `coords.js`.

**Scaling / new features:**

- **New screen:** add `js/screens/foo.js` with `initFooScreen()`, register in `navigation.js` (`SCREEN_IDS`, menu HTML), `app.js`, `index.html`, `sw.js` `ASSETS`, bump `CACHE_NAME`.
- **New persistence:** extend `db.js` `onupgradeneeded`, add store module, keep business rules in facades.
- **Events:** use `events.js` `emitReportsChanged()` from data layer; screens listen on `window`.

**Offline:** `sw.js` must list every static module URL the app imports (including transitive), or offline load fails after first visit.

---

## UA

**Підхід:** односторінковий застосунок, ES-модулі без збірщика. Точка входу: `js/app.js`.

**Шари (залежності лише «вниз»):**

1. **`app.js`** — порядок: БД → синхронізація → ініціалізація екранів → навігація → довідка → PWA.
2. **Екрани** (`js/screens/*.js`) — DOM одного екрану; викликають фасади, не IndexedDB напряму.
3. **Фасади** — `report-actions.js`, `generate.js`, `sync-service.js`.
4. **Дані** — store-модулі → `db.js` / `idb-helpers.js`.
5. **Інтеграції** — Google Sheets, обробка черги в `sync-queue-processor.js`.
6. **Чисті функції** — формат звіту, фільтри дат, мапінг результатів, координати.

**Масштабування:**

- **Новий екран:** модуль `screens/foo.js`, `initFooScreen()`, правки `navigation.js`, `app.js`, `index.html`, `sw.js` + новий `CACHE_NAME`.
- **Нові дані:** міграція схеми в `db.js`, окремий store, бізнес-правила у фасадах.
- **Події:** зміни даних — через `emitReportsChanged()`; UI підписується на `window`.

**Офлайн:** у `sw.js` потрібно кешувати всі статичні `.js`, які імпортує застосунок (включно з транзитивними).
