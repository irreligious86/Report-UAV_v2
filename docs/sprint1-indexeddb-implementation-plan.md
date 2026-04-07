# Архів: план «Спринт 1» (IndexedDB + history.js)

> **Статус: архів.** Цей документ описує ранній план, а не поточний код.
> Актуальна архітектура — у [AI-CONTEXT.md](./AI-CONTEXT.md) та [README.md](../README.md).

Фактичний стан замість плану: БД `report_uav_db_v2` (`js/db.js`), stores `reports` / `sync_queue` / `settings` / `sync_log`, фасад `report-actions.js`, модель `report-model.js` + `report-format.js`. Без вбудованої міграції legacy-звітів.
