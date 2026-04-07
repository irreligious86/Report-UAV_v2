# Архітектура UAV Report v2 (актуальний стан)

Цей документ описує **поточну** реалізацію в репозиторії. Старі плани з фасадом `history.js`, `reportEntity.js` та міграцією з `localStorage` **не застосовуються** — основний застосунок працює лише з новою моделлю без legacy-імпорту.

---

## Джерело правди

| Шар | Файли | Призначення |
|-----|--------|-------------|
| База IndexedDB | `js/db.js` | Ім’я БД: **`report_uav_db_v2`**. Stores: **`reports`**, **`sync_queue`**, **`settings`**, **`sync_log`** |
| Модель звіту | `js/report-model.js` | `Report`: `id`, `createdAt`, `updatedAt`, `publishedAt`, `version`, `syncStatus`, `locked`, `sendAfter`, `sheetRowId`, `fields`, `text` |
| Текст і поля | `js/report-format.js` | Збір полів з форми, `buildReportText`, нормалізація, час для фільтрів |
| CRUD звітів | `js/reports-store.js` | Операції з store `reports` |
| Налаштування синку | `js/sync-settings.js` + `js/settings-store.js` | Інтеграція Google Sheets у IDB |
| Черга | `js/sync-queue-store.js` | Елементи з `reportId` (не снапшот звіту) |
| Мережа | `js/google-sheets-api.js` | `fetch` POST на Apps Script (`upsert_report`, `ping`) |
| Оркестрація | `js/sync-service.js` | Черга, backoff, відкладена відправка, події `reportsChanged` / `reportsUpdated` |
| Фасад для UI | `js/report-actions.js` | Створення, редагування, відправка, імпорт |

Екрани **не** читають звіти з `localStorage`; лічильник екіпажу та перевизначення списків форми лишаються в **`localStorage`** (`counter.js`, `config.js`).

---

## Legacy та конвертер

Імпорт старих записів `{ ts, text }` **не входить** у цей застосунок. За потреби окремий інструмент **Legacy Report Converter** може готувати файли у форматі експорту **v2** для `importExport.js`.

---

## Пов’язані документи

- **[google-sheets-sync-tz.md](./google-sheets-sync-tz.md)** — бізнес-правила синхронізації (узгоджувати з кодом при змінах).
- **[sprint1-indexeddb-implementation-plan.md](./sprint1-indexeddb-implementation-plan.md)** — **архівний** поетапний план першої міграції; фактична реалізація — `report_uav_db_v2` без міграції старих звітів у застосунку.

---

## Історична примітка

Раніше в цьому файлі був роадмап під `history.js` / `reportsDb.js`. Він замінений описом v2, щоб не плутати читачів застарілими шляхами файлів.
