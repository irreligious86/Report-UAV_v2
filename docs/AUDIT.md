# AUDIT — Report UAV v2 / Аудит проєкту

_Перший аудит: 2026-04-16 (рефакторинг v21 → v22). Оновлено: 2026-04-16 (консолідація доків, code cleanup → v23)._

EN: History of refactoring decisions and executed changes. Use as the "why" reference.
UA: Історія рішень рефакторингу та виконаних змін. Використовуйте як довідник "чому так зроблено".

---

## 1. Архітектура (фактичний стан)

```
┌─ screens/ ──────────────────────────────── (UI layer / шар інтерфейсу)
│  mainForm.js  journal.js  map.js  data.js  settings.js
├─ Facade ────────────────────────────────── (єдина точка входу до домену)
│  report-actions.js
├─ Business Logic ──────────────────────────
│  report-model.js  report-format.js  generate.js
│  sync-service.js  sync-queue-processor.js  ← NEW
│  filters.js  result-mapping.js  date-utils.js ← NEW
├─ Storage ─────────────────────────────────
│  db.js  idb-helpers.js ← NEW
│  reports-store.js  sync-queue-store.js
│  settings-store.js  sync-settings.js
├─ Network ─────────────────────────────────
│  google-sheets-api.js
├─ Crypto ─────────────────────────────────
│  crypto/crypto.js  crypto/importExport.js  crypto/legacy-import.js
└─ Utilities ───────────────────────────────
   constants.js  utils.js  coords.js  counter.js
   clipboard.js  config.js  events.js  streams.js
   longPressEdit.js  navigation.js  pwa-install.js
   logger.js ← NEW
```

Нові модулі (`date-utils.js`, `idb-helpers.js`, `sync-queue-processor.js`, `logger.js`) створені під час рефакторингу і вже долучені у `sw.js` ASSETS та `index.html`.

---

## 2. Знайдені проблеми та що зроблено

### 2.1 Мертвий код / dead files

| Файл / Line | Проблема | Дія |
|-------------|----------|-----|
| `js/screens/image.png` | 67 KB, нічим не використовується (перевірено grep-ом) | **Видалено** |
| `tools/legacy-export-converter/` | порожня директорія-плейсхолдер | **Видалено** |
| `js/report-model.js:9` | Re-export `{ emptyFields, normalizeFields, buildReportText }` — пряма дублююча точка входу | **Видалено re-export**, імпорти в `legacy-import.js` та інших перенесено прямо на `report-format.js` |
| `js/coords.js:7–8` | Два окремі `import` з `utils.js` замість одного | **Об'єднано** в один statement |

### 2.2 Дублювання коду

EN: Two files (`report-format.js` lines 116–131 and `filters.js` lines 130–142) independently implemented almost identical `normalizeDateToISO()` + `combineDateTime()` helpers. This duplication was fragile — changing the logic in one place silently diverged the other.

UA: Функції нормалізації дати/часу були реалізовані двічі. Виніс їх у новий модуль `js/date-utils.js`, обидва попередні місця тепер імпортують звідти.

**Дія:**
- Створено `js/date-utils.js` з функціями `normalizeDateToISO()`, `combineDateAndTime()`, `getLocalTodayIso()`, `isoToDdMmYyyy()`.
- `report-format.js` і `filters.js` імпортують з нього.
- Локальні дублі видалено.

### 2.3 Архітектурні проблеми

**Велике модульне "тіло" (god-modules):**
- `js/sync-service.js` (309 LOC) — суміщав оркестрацію і внутрішню логіку обробки черги.
  - **Дія:** виокремив `js/sync-queue-processor.js`, куди перенесено `processOneQueueItem`, `applySendFailure_`, `compareQueueReports_`, `crewCounterSortKey_`, `RETRY_MS`, `SYNC_LOG_LIMIT`, `appendSyncLog`, `rotateSyncLog`. У `sync-service.js` залишилися тільки публічне API (`startSyncService`, `processSyncQueue`, `enqueueSendReport`, `processScheduledReports`, recovery стартапу).
- `js/screens/journal.js` (761 LOC) і `js/screens/map.js` (595 LOC) — залишені як є в цьому раунді (ризик зламати рендер дуже високий і юніт-тестів немає). Додано коментарі-маркери із планом виокремлення.

**Event bus:**
- `events.js` продовжує слати обидві події — `reportsChanged` і `reportsUpdated`. Код споживає тільки `reportsUpdated`, але обидві згадані в `docs/AI-CONTEXT.md` і в `docs/google-sheets-sync-tz.md`. Залишив обидві для зворотної сумісності з зовнішніми інтеграціями; документовано в JSDoc.
- `screens/data.js` двічі дублював `window.dispatchEvent(new Event("reportsChanged"))` і `reportsUpdated` напряму, минаючи `emitReportsChanged()`. Замінено на виклик `emitReportsChanged()`.

**IDB boilerplate:**
- `reports-store.js`, `sync-queue-store.js`, `settings-store.js`, `sync-service.js` містили однаковий шаблон `await new Promise((res, rej) => { const tx = db.transaction(...); tx.oncomplete = ...; tx.onerror = ...; })`.
- Додав модуль `js/idb-helpers.js` з функціями `runReadonly()`, `runReadwrite()`, `getAll()`, `getByKey()`.
- Сховища тепер використовують ці обгортки (де це не жертвує читабельністю багаторядкових транзакцій).

### 2.4 Мова коментарів

EN: Per project convention (see `AI-CONTEXT.md`) comments should be English + Ukrainian. In practice many utility files (`constants.js`, `utils.js`, `coords.js`, `counter.js`, `clipboard.js`, `navigation.js`, `longPressEdit.js`) had Russian in JSDoc blocks.

UA: Зустрічалися російськомовні коментарі в JSDoc-блоках — це суперечить конвенції проєкту (мають бути англійська та українська). Всі переписано.

**Дія:** всі Russian-only і мішані (RU + EN) коментарі замінено на EN + UA у форматі:
```js
/**
 * EN: Short English description of what it does.
 * UA: Стислий український опис що робить.
 * @param ... — EN note / UA примітка
 */
```

### 2.5 Deprecated / risky patterns

- `innerHTML = ""` для очищення списків — залишено (усі місця — зі статичним безпечним markup), але у `config.js` додано коментар про це; для майбутнього додавання динамічного контенту рекомендовано `replaceChildren()`.
- У `navigation.js` є два місця з `titleEl.innerHTML = "..." + v2Badge` — залишено, бо `v2Badge` статична строка.
- Clipboard: сучасний `navigator.clipboard` + Android WebView bridge — без `document.execCommand` fallback. ОК.
- `var`, `arguments`, `new Function` — не знайдено. Код сучасний.

### 2.6 Логування

EN: Previously silent catch blocks (`catch { /* ignore */ }`) dropped errors unconditionally, making it hard to diagnose sync bugs. Added a lightweight `js/logger.js` with a dev-mode flag (`localStorage.setItem('uav.debug','1')`) that routes swallowed errors through a prefixed `console.debug`. No logs are printed in production. This is additive — the swallow behaviour is preserved for release users.

UA: Раніше усі `catch { /* ignore */ }` "ковтали" помилки. Тепер вони йдуть через `logger.debug()`, який тихий у продакшні й друкує у консоль якщо у localStorage ввімкнений прапор `uav.debug=1`. Поведінка для кінцевих користувачів не змінилася.

### 2.7 Масштабованість — що лишилося "на майбутнє"

_Свідомо НЕ зроблено в цьому раунді, бо потребує unit-тестів і ризикує зламати працюючу логіку:_

1. **Журнал та мапа** завантажують усі звіти в пам'ять через `listReports()`. При REPORTS_LIMIT=500 це прийнятно; якщо ліміт зросте — треба курсорну пагінацію. Додано коментар у `reports-store.js`.
2. **Journal.js (761 LOC)** варто розбити на `journal-renderer.js`, `journal-editor.js`, `journal-kpi.js`. Залишено маркери `// TODO(split): ...` у коді.
3. **Map.js (595 LOC)** — аналогічно. Логіка кластера маркерів + вибір підкладки + fullscreen живуть в одному файлі.
4. **Service Worker** — стратегія "cache-first, fetch-fallback". Нема щоб фонове оновлення (background sync) — додати можна, коли список пристроїв стабілізується.

---

## 3. Змінений public API

Нічого в публічному API модулів (експортованих функцій, що викликаються зовні) не змінилося, за винятком:

- `js/report-model.js` більше НЕ експортує `emptyFields`, `normalizeFields`, `buildReportText` (re-export з `report-format.js`). Якщо десь у зовнішньому коді (поза цим репо) використовувався imports from `./report-model.js`, треба перейти на `./report-format.js`. В межах репо всі виправлено.

---

## 4. Нові публічні модулі

| Файл | Експортує | Призначення |
|------|-----------|-------------|
| `js/date-utils.js` | `normalizeDateToISO`, `combineDateAndTime`, `getLocalTodayIso`, `isoToDdMmYyyy` | Єдина бібліотека дат, без залежностей |
| `js/idb-helpers.js` | `runReadonly`, `runReadwrite`, `getAll`, `getByKey` | Обгортки над IDB-транзакціями |
| `js/sync-queue-processor.js` | `processOneQueueItem`, `appendSyncLog`, `rotateSyncLog` | Виокремлена логіка обробки одного елемента черги з `sync-service.js` |
| `js/logger.js` | `debug`, `warn`, `error`, `isDebugEnabled` | Мінімальний логер з dev-прапором |

---

## 5. Кеш і деплой

- `sw.js`: CACHE_NAME підвищено з `uav-report-v20` → `uav-report-v21` + до ASSETS додано нові модулі. При першому завантаженні після оновлення старий кеш буде очищено хуком `activate`.
- `docs/AI-CONTEXT.md` оновлено під нову структуру (див. секцію "Шари").
- `README.md` — оновлено дерево `Структура проєкту` й прибрано згадку про `js/screens/image.png`.

---

## 6. Раунд 2: консолідація документації та code cleanup (v22 → v23)

### Видалено файли
- `docs/sprint1-indexeddb-implementation-plan.md` — 6 рядків заглушки, нульова цінність.
- `google-script.txt` — містив реальні API-ключі в репо.
- `docs/ARCHITECTURE.md` — дублював `AI-CONTEXT.md` слабшою формою.
- `docs/google-sheets-sync-decomposition.md` — таблиця влита в `google-sheets-sync-tz.md` (Додаток B).

### Код
- **`pad2()` дублікат у `filters.js`** — видалено, імпортується з `utils.js`.
- **Long-press таймер** — уніфіковано: `LONG_PRESS_MS = 500` у `constants.js`, імпортується в `navigation.js` і `longPressEdit.js` (раніше 450 і 600 ms в різних місцях).
- **`journal-stats.js`** — виокремлено `computeStats`, `buildSummaryText`, `updateKPI` з `screens/journal.js` (703 рядки замість 761).
- **`constants.js`** — відновлено з git (файл був обрізаний на диску).
- **`sw.js`** — відновлено з git (файл був обрізаний), додано `journal-stats.js`, bump → `v23`.

### Документація
- `AI-CONTEXT.md` — єдина точка входу для ІІ; додано boot order, масштабування, «Чого НЕ робити», «Типові задачі».
- `google-sheets-sync-tz.md` — додано Додаток B (таблицю з decomposition).
- `AUDIT.md` — оновлено для двох раундів.
- `README.md` — оновлено дерево структури, прибрано мертві посилання.

---

## 7. Як перевірити (manual QA checklist)

1. `npm run verify` — має пройти.
2. Відкрити PWA у браузері; дочекатись що Service Worker активується з CACHE_NAME=v23.
3. Створити новий звіт кнопкою «Готово» — має скопіювати в буфер і з'явитися в журналі.
4. Відкрити Журнал — KPI і картки мають відображатися.
5. Відкрити Мапу — мітки мають з'явитися.
6. Налаштування списків — додати/видалити пункт, перетягнути drag-and-drop.
7. Дані та інтеграція — експорт → введення паролю двічі → .json файл має вивантажитися.
8. Імпорт того самого файлу → після введення паролю журнал має залишитися незмінним (merge за id).

Якщо будь-який пункт не проходить — почати діагностику з DevTools → Application → Service Workers → Unregister, потім Hard Reload.
