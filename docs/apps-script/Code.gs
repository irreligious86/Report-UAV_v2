/**
 * Web App для UAV Report (POST JSON з додатку).
 * Один звіт = один РЯДОК, заголовки в рядку 1.
 *
 * ВАЖЛИВО: скрипт пише дані за ІМЕНЕМ заголовка, а не за номером стовпця.
 * Тому стовпці можна вільно переставляти, ховати, додавати нові —
 * скрипт знайде потрібний стовпець за назвою у першому рядку.
 *
 * Налаштування:
 * 1) Якщо скрипт "прив'язаний" до таблиці (Extensions → Apps Script) —
 *    можна лишити getSpreadsheet_() через getActive().
 * 2) Якщо скрипт окремий — у Script properties додайте ключ SHEET_ID = ID з URL таблиці.
 *
 * Розгортання: Deploy → New deployment → Web app
 *   Execute as: Me, Who has access: Anyone / Anyone with link.
 */

/**
 * За замовчуванням збігається з типовою назвою вкладки.
 * Опційно: у Script properties — SHEET_TAB_NAME.
 */
var SHEET_NAME = 'Reports';

/**
 * Канонічний набір заголовків. Використовується ТІЛЬКИ якщо таблиця порожня
 * (перше створення). Після цього — порядок стовпців визначається виключно
 * тим, що є в рядку 1 таблиці.
 */
var DEFAULT_HEADERS = [
  'date',
  'takeoff_time',
  'impact_time',
  'crew',
  'crew_counter',
  'drone',
  'mission_type',
  'coords',
  'ammo',
  'result',
  'stream',
  'report_id',
  'published_at',
  'created_at',
  'updated_at',
  'sync_status',
  'version',
  'device_id'
];

/**
 * Службові стовпці: можна сховати з вигляду.
 */
var SERVICE_HEADER_NAMES = [
  'report_id',
  'version',
  'sync_status',
  'published_at',
  'created_at',
  'updated_at',
  'device_id'
];

/**
 * true — після кожного успішного upsert службові стовпці згортаються.
 */
var HIDE_SERVICE_COLUMNS_AFTER_UPSERT = false;

/**
 * true — після кожного upsert усі рядки даних (від 2) сортуються за кінцем місії:
 * колонки date + impact_time, спочатку найновіші зверху. Черга на клієнті може йти
 * за crew_counter — порядок у таблиці все одно вирівнюється тут.
 */
var SORT_ROWS_BY_MISSION_END_DESC = true;

/* ───────────────────────── helpers ───────────────────────── */

/**
 * Дата YYYY-MM-DD → DD.MM.YYYY
 */
function formatMissionDate_(ymd) {
  if (ymd == null || String(ymd).trim() === '') return '';
  var s = String(ymd).trim();
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[3] + '.' + m[2] + '.' + m[1];
  return s;
}

/**
 * Час зльоту/ураження: HH:mm
 */
function formatShortTime_(t) {
  if (t == null || String(t).trim() === '') return '';
  var s = String(t).trim();
  var match = s.match(/^(\d{1,2})[:.](\d{2})/);
  if (!match) return s;
  var h = parseInt(match[1], 10);
  var mm = match[2];
  if (!isFinite(h) || h < 0 || h > 23) return s;
  var hh = h < 10 ? '0' + h : String(h);
  return hh + ':' + mm;
}

/**
 * ISO datetime → DD.MM.YYYY HH:mm
 */
function formatIsoDateTime_(iso) {
  if (iso == null || String(iso).trim() === '') return '';
  var d = new Date(String(iso).trim());
  if (isNaN(d.getTime())) return String(iso);
  var tz = Session.getScriptTimeZone();
  return Utilities.formatDate(d, tz, 'dd.MM.yyyy HH:mm');
}

function safe_(v) {
  return v != null ? String(v) : '';
}

/* ───────────────────────── spreadsheet access ───────────────────────── */

function getSpreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (id && String(id).trim()) {
    return SpreadsheetApp.openById(String(id).trim());
  }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error(
      'Немає доступу до таблиці: додайте SHEET_ID у «Властивості скрипту» ' +
      'або відкрийте скрипт через меню Розширення в потрібній таблиці.'
    );
  }
  return ss;
}

function getOrCreateSheet_(ss) {
  var props = PropertiesService.getScriptProperties();
  var fromProp = props.getProperty('SHEET_TAB_NAME');
  var name = fromProp && String(fromProp).trim()
    ? String(fromProp).trim()
    : String(SHEET_NAME || 'Reports').trim();

  var byExact = ss.getSheetByName(name);
  if (byExact) return byExact;

  var lower = name.toLowerCase();
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (String(sheets[i].getName()).toLowerCase() === lower) {
      return sheets[i];
    }
  }
  if (sheets.length === 1) return sheets[0];
  return ss.insertSheet(name);
}

/* ───────────────────── header map (key change) ───────────────────── */

/**
 * Читає заголовки з рядка 1 і повертає Map: headerName → columnIndex (1-based).
 * Якщо рядок 1 порожній або не містить report_id — вставляє рядок з DEFAULT_HEADERS
 * і зсуває існуючі дані вниз, щоб не перезаписувати їх.
 * @returns {Object<string, number>}
 */
function getHeaderMap_(sheet) {
  var needsHeaders = false;

  if (sheet.getLastRow() === 0) {
    // Sheet completely empty
    needsHeaders = true;
  } else {
    // Sheet has rows — check if row 1 looks like headers
    var lastCol = Math.max(sheet.getLastColumn(), DEFAULT_HEADERS.length);
    var firstRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

    // Row 1 is headers if it contains 'report_id' (case-insensitive)
    var hasReportId = false;
    for (var c = 0; c < firstRow.length; c++) {
      if (String(firstRow[c] || '').trim().toLowerCase() === 'report_id') {
        hasReportId = true;
        break;
      }
    }
    if (!hasReportId) {
      needsHeaders = true;
    }
  }

  if (needsHeaders) {
    // Insert a new row 1 with headers (pushes existing data down)
    if (sheet.getLastRow() > 0) {
      sheet.insertRowBefore(1);
    }
    sheet.getRange(1, 1, 1, DEFAULT_HEADERS.length).setValues([DEFAULT_HEADERS]);
    SpreadsheetApp.flush();
  }

  // Now read actual headers from row 1
  var lastCol2 = sheet.getLastColumn();
  if (lastCol2 < 1) lastCol2 = DEFAULT_HEADERS.length;

  var headerRow = sheet.getRange(1, 1, 1, lastCol2).getValues()[0];
  var map = {};
  for (var i = 0; i < headerRow.length; i++) {
    var name = String(headerRow[i] || '').trim().toLowerCase();
    if (name) {
      map[name] = i + 1; // 1-based column index
    }
  }
  return map;
}

/**
 * Якщо якихось потрібних заголовків немає — дописує їх у кінець рядка 1.
 */
function ensureMissingHeaders_(sheet, headerMap, requiredHeaders) {
  var missing = [];
  for (var i = 0; i < requiredHeaders.length; i++) {
    var key = requiredHeaders[i].toLowerCase();
    if (!headerMap[key]) {
      missing.push(requiredHeaders[i]);
    }
  }
  if (missing.length === 0) return headerMap;

  var lastCol = sheet.getLastColumn();
  for (var j = 0; j < missing.length; j++) {
    var col = lastCol + 1 + j;
    sheet.getRange(1, col).setValue(missing[j]);
    headerMap[missing[j].toLowerCase()] = col;
  }
  return headerMap;
}

/**
 * Гарантує рядок 1 з DEFAULT_HEADERS і повний набір колонок.
 * Викликати на початку upsert і з окремого prepare_sheet (масова відправка після очищення листа).
 * @returns {Object<string, number>}
 */
function ensureReportSheetStructure_(sheet) {
  var headerMap = getHeaderMap_(sheet);
  headerMap = ensureMissingHeaders_(sheet, headerMap, DEFAULT_HEADERS);
  SpreadsheetApp.flush();
  return headerMap;
}

/**
 * Тільки відновлення заголовків без запису звіту — зручно перед чергою з фронтенду.
 */
function prepareSheetHeaders_() {
  var ss = getSpreadsheet_();
  var sheet = getOrCreateSheet_(ss);
  var headerMap = ensureReportSheetStructure_(sheet);
  if (SORT_ROWS_BY_MISSION_END_DESC) {
    sortDataRowsByMissionEndDesc_(sheet, headerMap);
  }
}

/**
 * Найбільший індекс стовпця з map заголовків (1-based).
 */
function maxColumnIndex_(headerMap) {
  var m = 0;
  for (var k in headerMap) {
    if (!headerMap.hasOwnProperty(k)) continue;
    var n = headerMap[k];
    if (typeof n === 'number' && n > m) m = n;
  }
  return m;
}

/* ───────────────────── coords map link ───────────────────── */

/**
 * MGRS → lat/lng (потребує Mgrs.gs у проєкті).
 */
function mgrsToLatLngForMaps_(mgrsText) {
  try {
    var s = mgrsText != null ? String(mgrsText).trim() : '';
    if (!s) return null;
    if (typeof toPoint !== 'function') return null;
    var point = toPoint(s);
    if (!point || point.length < 2) return null;
    var lng = point[0];
    var lat = point[1];
    if (!isFinite(lat) || !isFinite(lng)) return null;
    return { lat: lat, lng: lng };
  } catch (e) {
    return null;
  }
}

function applyCoordsMapLink_(sheet, rowNum, coordText, headerMap) {
  var col = headerMap['coords'];
  if (!col || rowNum < 1) return;
  var raw = coordText != null ? String(coordText).trim() : '';
  if (raw === '') {
    sheet.getRange(rowNum, col).clearContent();
    return;
  }
  var ll = mgrsToLatLngForMaps_(raw);
  var url;
  if (ll) {
    url = 'https://www.google.com/maps?q=' + ll.lat + ',' + ll.lng + '&z=16';
  } else {
    url = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(raw);
  }
  var rich = SpreadsheetApp.newRichTextValue().setText(raw).setLinkUrl(url).build();
  sheet.getRange(rowNum, col).setRichTextValue(rich);
}

/* ───────────────────── hide service columns ───────────────────── */

function hideServiceColumns_(sheet) {
  var headerMap = getHeaderMap_(sheet);
  for (var i = 0; i < SERVICE_HEADER_NAMES.length; i++) {
    var col = headerMap[SERVICE_HEADER_NAMES[i].toLowerCase()];
    if (col) sheet.hideColumns(col);
  }
}

function showServiceColumns_(sheet) {
  var headerMap = getHeaderMap_(sheet);
  for (var i = 0; i < SERVICE_HEADER_NAMES.length; i++) {
    var col = headerMap[SERVICE_HEADER_NAMES[i].toLowerCase()];
    if (col) sheet.showColumns(col);
  }
}

/* ───────────────────── Web App endpoints ───────────────────── */

function doPost(e) {
  var out = { ok: false };
  try {
    if (!e || !e.postData || !e.postData.contents) {
      out.error = 'no body';
      return jsonResponse_(out);
    }
    var data = JSON.parse(e.postData.contents);

    if (data.action === 'ping') {
      return jsonResponse_({ ok: true, pong: true, device_id: data.device_id || null });
    }

    if (data.action === 'prepare_sheet') {
      prepareSheetHeaders_();
      return jsonResponse_({ ok: true, headers_ready: true });
    }

    if (data.action === 'upsert_report') {
      var result = upsertReportRow_(data);
      return jsonResponse_({ ok: true, sheet_row_id: result.sheetRowId || null });
    }

    out.error = 'unknown action';
    return jsonResponse_(out);
  } catch (err) {
    out.error = err && err.message ? err.message : String(err);
    return jsonResponse_(out);
  }
}

function doGet(e) {
  return ContentService.createTextOutput('UAV Report Web App OK. Use POST JSON.')
    .setMimeType(ContentService.MimeType.TEXT);
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ───────────────────── empty row cleanup ───────────────────── */

/**
 * Видаляє лише «хвостові» порожні рядки знизу листа (після останнього рядка з даними).
 * Раніше видалялися ВСІ порожні рядки між 2 і last — через це могли зникати
 * проміжні рядки (порожній рядок між двома звітами, зіпсований запис тощо).
 */
function removeTrailingEmptyDataRows_(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return;

  var last = sheet.getLastRow();
  while (last >= 2) {
    var rowValues = sheet.getRange(last, 1, 1, lastCol).getValues()[0];
    var isEmpty = true;
    for (var c = 0; c < rowValues.length; c++) {
      if (rowValues[c] !== '' && rowValues[c] != null) {
        isEmpty = false;
        break;
      }
    }
    if (!isEmpty) break;
    sheet.deleteRow(last);
    last--;
  }
}

/**
 * Парсить дату з комірки (Date, DD.MM.YYYY або YYYY-MM-DD) + час ураження → ms у локальному TZ скрипта.
 */
function missionEndMillisFromCells_(dateVal, timeVal) {
  var y;
  var mo;
  var d;
  var h = 0;
  var mi = 0;

  var tm = String(timeVal || '').trim();
  var tmatch = tm.match(/^(\d{1,2})[:.](\d{2})/);
  if (tmatch) {
    h = parseInt(tmatch[1], 10);
    mi = parseInt(tmatch[2], 10);
  } else if (timeVal instanceof Date) {
    h = timeVal.getHours();
    mi = timeVal.getMinutes();
  }

  if (dateVal instanceof Date) {
    y = dateVal.getFullYear();
    mo = dateVal.getMonth() + 1;
    d = dateVal.getDate();
  } else {
    var s = String(dateVal || '').trim();
    var dm = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    if (dm) {
      d = parseInt(dm[1], 10);
      mo = parseInt(dm[2], 10);
      y = parseInt(dm[3], 10);
    } else {
      var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (iso) {
        y = parseInt(iso[1], 10);
        mo = parseInt(iso[2], 10);
        d = parseInt(iso[3], 10);
      } else {
        return 0;
      }
    }
  }

  var dt = new Date(y, mo - 1, d, h, mi, 0, 0);
  var ms = dt.getTime();
  return isNaN(ms) ? 0 : ms;
}

/**
 * Сортує рядки 2…last за mission end (date + impact_time) спадно; відновлює гіперпосилання coords.
 */
function sortDataRowsByMissionEndDesc_(sheet, headerMap) {
  var last = sheet.getLastRow();
  if (last < 2) return;

  var dateCol = headerMap['date'];
  var impactCol = headerMap['impact_time'];
  if (!dateCol || !impactCol) return;

  var lastCol = Math.max(sheet.getLastColumn(), maxColumnIndex_(headerMap));
  if (lastCol < 1) return;

  var numRows = last - 1;
  var range = sheet.getRange(2, 1, numRows, lastCol);
  var matrix = range.getValues();
  if (!matrix || matrix.length === 0) return;

  var ridCol = headerMap['report_id'];
  var decorated = [];
  for (var i = 0; i < matrix.length; i++) {
    var row = matrix[i];
    var ms = missionEndMillisFromCells_(row[dateCol - 1], row[impactCol - 1]);
    var rid = ridCol ? String(row[ridCol - 1] || '') : String(i);
    decorated.push({ ms: ms, row: row, rid: rid });
  }

  decorated.sort(function (a, b) {
    if (b.ms !== a.ms) return b.ms - a.ms;
    return String(a.rid).localeCompare(String(b.rid));
  });

  var out = [];
  for (var j = 0; j < decorated.length; j++) {
    out.push(decorated[j].row);
  }

  range.setValues(out);

  var coordsCol = headerMap['coords'];
  if (coordsCol) {
    for (var r = 0; r < out.length; r++) {
      var coordText = out[r][coordsCol - 1];
      applyCoordsMapLink_(sheet, r + 2, coordText, headerMap);
    }
  }
}

function findDataRowByReportId_(sheet, headerMap, reportId) {
  var last = sheet.getLastRow();
  var col = headerMap['report_id'];
  if (!col || last < 2) return 0;
  var numRows = last - 1;
  var ids = sheet.getRange(2, col, numRows, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(reportId)) return i + 2;
  }
  return 0;
}

/* ───────────────────── core upsert logic ───────────────────── */

/**
 * @param {{
 *   device_id?: string,
 *   report: {
 *     report_id: string,
 *     version: number,
 *     sync_status: string,
 *     created_at: string,
 *     updated_at: string,
 *     published_at: string|null,
 *     sheet_row_id: string|null,
 *     fields: Object,
 *     report_text: string
 *   }
 * }} data
 * @returns {{ sheetRowId: string }}
 */
function upsertReportRow_(data) {
  var ss = getSpreadsheet_();
  var sheet = getOrCreateSheet_(ss);
  var headerMap = ensureReportSheetStructure_(sheet);

  var r = data.report;
  var f = r.fields || {};

  // Build a name→value map (NOT a positional array)
  var values = {
    'date':           formatMissionDate_(f.date),
    'takeoff_time':   formatShortTime_(f.takeoff),
    'impact_time':    formatShortTime_(f.impact),
    'crew':           safe_(f.crew),
    'crew_counter':   f.crewCounter != null && f.crewCounter !== '' ? f.crewCounter : '',
    'drone':          safe_(f.drone),
    'mission_type':   safe_(f.missionType),
    'coords':         safe_(f.coords),
    'ammo':           safe_(f.ammo),
    'result':         safe_(f.result),
    'stream':         safe_(f.stream),
    'report_id':      r.report_id,
    'version':        r.version,
    // Успішний запис у таблицю = доставлено; не дублюємо "sending" з клієнта
    'sync_status':    'sent',
    'published_at':   formatIsoDateTime_(r.published_at),
    'created_at':     formatIsoDateTime_(r.created_at),
    'updated_at':     formatIsoDateTime_(r.updated_at),
    'device_id':      data.device_id || ''
  };

  // Find existing row by report_id
  var reportIdCol = headerMap['report_id'];
  if (!reportIdCol) {
    throw new Error('Стовпець report_id не знайдено у заголовках таблиці.');
  }

  var last = sheet.getLastRow();
  var foundRow = 0;
  // У SpreadsheetApp чотири параметри getRange — це (рядок, стовпець, КІЛЬКІСТЬ рядків, КІЛЬКІСТЬ стовпців),
  // а не кінцеві координати. Один стовпець report_id: getRange(2, col, last-1, 1) = рядки 2…last, ширина 1.
  if (last >= 2) {
    var ids = sheet.getRange(2, reportIdCol, last - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(r.report_id)) {
        foundRow = i + 2;
        break;
      }
    }
  }

  // Лише хвостові порожні рядки внизу (див. removeTrailingEmptyDataRows_)
  removeTrailingEmptyDataRows_(sheet);
  last = sheet.getLastRow();

  // Re-search after cleanup (row numbers may have shifted)
  foundRow = 0;
  if (last >= 2) {
    var ids2 = sheet.getRange(2, reportIdCol, last - 1, 1).getValues();
    for (var i2 = 0; i2 < ids2.length; i2++) {
      if (String(ids2[i2][0]) === String(r.report_id)) {
        foundRow = i2 + 2;
        break;
      }
    }
  }

  var targetRow;
  if (foundRow > 0) {
    // Оновлення існуючого рядка
    targetRow = foundRow;
  } else {
    // Новий рядок внизу
    targetRow = last + 1;
  }

  // Запис значень у комірки за іменами заголовків (coords — теж як текст, інакше після sort
  // getValues() не бачить координат і колонка залишається порожньою; гіперпосилання
  // відновлюються в sortDataRowsByMissionEndDesc_ або нижче).
  for (var key in values) {
    if (!values.hasOwnProperty(key)) continue;
    var col = headerMap[key.toLowerCase()];
    if (!col) continue;
    sheet.getRange(targetRow, col).setValue(values[key]);
  }

  if (SORT_ROWS_BY_MISSION_END_DESC) {
    sortDataRowsByMissionEndDesc_(sheet, headerMap);
  } else {
    applyCoordsMapLink_(sheet, targetRow, values['coords'], headerMap);
  }

  // Згортання службових стовпців (якщо ввімкнено)
  if (HIDE_SERVICE_COLUMNS_AFTER_UPSERT) {
    try { hideServiceColumns_(sheet); } catch (_) { /* ignore */ }
  }

  SpreadsheetApp.flush();

  var actualRow = findDataRowByReportId_(sheet, headerMap, r.report_id);
  return { sheetRowId: actualRow ? String(actualRow) : String(targetRow) };
}