# AI Context — Report UAV

Єдиний вхідний документ для AI-асистентів (Cursor, Claude, Copilot тощо).
Містить архітектуру, правила та контракти. Деталі — у файлах за посиланнями.

## Посилання

| Файл | Зміст |
|------|-------|
| [`README.md`](../README.md) | Можливості, інструкція користувача |
| [`docs/apps-script/README.md`](./apps-script/README.md) | Розгортання Apps Script, поля payload |
| [`docs/google-sheets-sync-tz.md`](./google-sheets-sync-tz.md) | ТЗ sync (бізнес-правила, модель, lifecycle) |
| [`docs/AUDIT.md`](./AUDIT.md) | Історія рефакторингу, рішення, QA-чеклист |

---

## Архітектура

### Шари

```
┌─ screens/ ──────────────────────────────────┐
│  mainForm.js  journal.js  map.js            │
│  data.js      settings.js                   │
├─ Facade ────────────────────────────────────┤
│  report-actions.js (create, edit, send,     │
│                      import, bulk actions)   │
├─ Business Logic ────────────────────────────┤
│  report-model.js   report-format.js         │
│  sync-service.js   filters.js               │
│  result-mapping.js generate.js              │
│  journal-stats.js                           │
├─ Storage ───────────────────────────────────┤
│  db.js             reports-store.js         │
│  sync-queue-store.js  settings-store.js     │
│  sync-settings.js                           │
├─ Network ───────────────────────────────────┤
│  google-sheets-api.js (POST → Apps Script)  │
├─ Crypto ────────────────────────────────────┤
│  crypto/crypto.js      (PBKDF2+AES-256-GCM)│
│  crypto/importExport.js (v2 enc/dec)        │
│  crypto/legacy-import.js (v1 → v2 convert)  │
├─ Utilities ─────────────────────────────────┤
│  constants.js  utils.js  coords.js          │
│  counter.js    clipboard.js  config.js      │
│  events.js     streams.js  longPressEdit.js │
│  navigation.js                              │
└─────────────────────────────────────────────┘
```

### IndexedDB: `report_uav_db_v2` (v1)

| Store | keyPath | Індекси |
|-------|---------|---------|
| `reports` | `id` | `createdAt`, `updatedAt`, `publishedAt`, `syncStatus`, `sendAfter` |
| `sync_queue` | `queueId` | `reportId`, `action`, `nextRetryAt` |
| `settings` | `key` | — |
| `sync_log` | `id` | `reportId`, `timestamp` |

### Сутність Report

```
{ id, createdAt, updatedAt, publishedAt, version, syncStatus,
  locked, sendAfter, sheetRowId,
  fields: { crew, crewCounter, date, drone, missionType,
            takeoff, impact, coords, ammo, stream, result },
  text }
```

`id` формат: `rpt_YYYYMMDD_XXXXXXXX`. `fields` — camelCase. `text` завжди будується з `fields` через `report-format.js`.

### Статуси синхронізації

```
DRAFT → SCHEDULED (delayed) → QUEUED → SENDING → SENT [→ locked]
                                ↑                   ↓
                            QUEUED ← ERROR      RESYNC_REQUIRED
                         (retry: 1m/5m/15m/30m)     (correction flow)
```

### Потік даних

1. **Форма «Готово»:** `generate.js` → `report-actions.createAndStoreReport` → IDB → events
2. **Фільтрація:** `filters.js` — `getImpactTimestampForReport` використовує `fields.date + fields.impact`, fallback `createdAt`
3. **Журнал:** `journal.js` — `renderForSelectedPeriod()`, KPI, картки, редагування
4. **Карта:** `map.js` — ті ж відфільтровані звіти, `fields.coords` (MGRS→lat/lng)
5. **Sync:** `sync-service.js` → `processSyncQueue` (drain chain, serialized) → `google-sheets-api.js` POST
6. **UI-події:** `reportsChanged` / `reportsUpdated` — журнал підписаний і перемальовується

### localStorage

| Ключ | Модуль | Зміст |
|------|--------|-------|
| `uav_report_config_overrides_v1` | `config.js` | Перевизначення списків |
| `STORAGE_KEY_DEVICE_ID` | `constants.js` | Ідентифікатор пристрою |
| counter | `counter.js` | Лічильник екіпажу |
| streams | `streams.js` | Кеш стрімів |
| period filter | `filters.js` | Останній вибраний період |
| basemap | `map.js` | Вибрана підкладка карти |

### Зовнішні залежності (CDN)

- **Leaflet 1.9.4** — CSS: `<link>` в index.html; JS: dynamic import в `map.js` (esm.sh)
- **mgrs 2.1.0** — dynamic import в `map.js` (esm.sh)
- **Sortable.js** — dynamic import в `settings.js` (esm.sh)

Жодного build-степу. Pure ES modules. Service Worker кешує всі локальні assets.

### Boot order (`app.js`)

`openDatabase` → `startSyncService` → screen `init*` → `initNavigation` → `initHelpScreen` → `initPwaInstall`.

Залежності — одностороннє зверху вниз. Screens викликають facades, facades — stores, stores — db.js.

### Масштабування

- **Новий екран:** `js/screens/foo.js` з `initFooScreen()` → додати в `navigation.js` (`SCREEN_IDS` + menu HTML) → `app.js` → `index.html` → `sw.js` ASSETS → bump `CACHE_NAME`.
- **Нове поле/persistence:** extend `db.js` `onupgradeneeded` → новий store module → бізнес-правила у фасадах.
- **Нові події:** `events.js` `emitReportsChanged()` з data layer; screens підписані через `window`.
- **Офлайн:** `sw.js` **обов'язково** має містити URL кожного статичного модуля (включно з транзитивними), інакше після першого візиту офлайн-завантаження зламається.

---

## Правила для асистентів

### Критичні контракти (не ламати)

1. **Поля Report:** контракт між `report-format.js`, IndexedDB, `google-sheets-api.js` та `Code.gs`. Змінив поле → перевір усі чотири точки.
2. **`collectFieldsFromEditDialog`** шукає DOM-елементи за `data-field-key` — не прибирай цей атрибут.
3. **`appendActionIcons`** у `journal.js` — без неї цикл карток обривається, KPI не оновлюється.
4. **Відповідь Apps Script:** для upsert/ping/prepare — валідний JSON з `ok: true` при успіху.
5. **Імена stores IDB** зашиті в `db.js` — не перейменовувати без міграції.

### При змінах

- Після змін кешованих файлів — підняти `CACHE_NAME` в `sw.js`.
- Новий JS-файл → додати в `sw.js` ASSETS.
- Перевірка: `npm run verify` (tools/verify-index.mjs).

### Типовий баг: «дані є, журнал порожній»

JS-помилка **під час побудови картки** (виклик неіснуючої функції) — лічильник «Відібрано» вже оновлений, цикл обривається до `updateKPI` і додавання карток. Перевіряй консоль.

### Конвенції нейминга

- **Публічні функції:** `camelCase`, без префіксу — `processOneQueueItem`, `buildReportText`.
- **Приватні (модульні) функції:** trailing underscore — `drain_()`, `doGenerate_()`, `crewCounterSortKey_()`.
- **Константи:** `UPPER_SNAKE_CASE` — `LONG_PRESS_MS`, `REPORTS_LIMIT`, `TX_TIMEOUT_MS`.
- **Не використовувати:** leading underscore `_fn()` для нових приватних функцій (legacy).

### Мова

UI: **українська**. Код: коментарі EN + UA в JSDoc. Документація: EN/UK змішано.

---

### Чого НЕ робити (заборони)

1. **Не міняти формат `reportId`** (`rpt_YYYYMMDD_XXXXXXXX`) — на ньому тримається upsert в Google Sheets, merge при імпорті, пошук у IDB.
2. **Не перейменовувати stores IDB** (`reports`, `sync_queue`, `settings`, `sync_log`) — без написання міграції в `db.js` `onupgradeneeded` це зламає всі дані.
3. **Не прибирати атрибут `data-field-key`** з DOM — `collectFieldsFromEditDialog` залежить від нього.
4. **Не видаляти `appendActionIcons`** у `journal.js` — без неї цикл карток обривається, KPI не оновлюється.
5. **Не використовувати `var`, `arguments`, `new Function`** — код 100% ES modules.
6. **Не додавати JS-файли без оновлення `sw.js` ASSETS** + bump `CACHE_NAME`.

### Типові задачі (рецепти)

**Додати нове поле в звіт:**
1. `config.json` — додати список значень (якщо select).
2. `index.html` — додати поле у форму з `data-field-key="myField"`.
3. `js/report-format.js` — додати в `emptyFields`, `collectFieldsFromForm`, `buildReportText`.
4. `js/google-sheets-api.js` — додати в payload.
5. `docs/apps-script/Code.gs` — додати колонку.
6. Bump `CACHE_NAME` в `sw.js`.

**Додати новий екран:**
1. `js/screens/foo.js` — `export function initFooScreen() {}`.
2. `js/navigation.js` — додати в `SCREEN_IDS`, додати `case "foo"` у switch.
3. `index.html` — додати `<section id="screen-foo">`, кнопку в меню.
4. `js/app.js` — import + виклик `initFooScreen()`.
5. `sw.js` ASSETS — додати `"js/screens/foo.js"`, bump `CACHE_NAME`.

---

## Відоме / TODO

- `icon.png` — дублікат `icon-512.png`, обидва у manifest.json
- Legacy-імпорт старих записів `{ ts, text }` не входить у цей застосунок (окремий конвертер)
