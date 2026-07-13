/**
 * MOTK Shoot Apps Script endpoint (standalone reference implementation).
 * Deploy as a Web app owned by the production workbook owner. Set the Script
 * Property MOTK_SHOOT_TOKEN, then use an exec URL ending in ?token=... .
 *
 * Existing MOTK deployments may call shootDoGet(e) / shootDoPost(e) from their
 * own doGet/doPost router instead of copying the two wrappers at the bottom.
 */
var MOTK_SHOOT_COLUMNS = [
  'shot_id', 'scene', 'name', 'status', 'planned_frames', 'fps', 'takes',
  'best_take', 'frames', 'duration_s', 'raw_count', 'notes', 'handover',
  'folder', 'updated_at'
];

function shootDoGet(e) {
  try {
    shootAuthorize_(e);
    var action = String((e.parameter && e.parameter.action) || 'shots');
    if (action !== 'shots') throw new Error('Unsupported action: ' + action);
    var sheet = shootSheet_();
    var values = sheet.getDataRange().getDisplayValues();
    if (!values.length) return shootJson_({ ok: true, shots: [] });
    var header = values.shift().map(function (v) { return String(v).trim().toLowerCase(); });
    var shots = values.filter(function (row) { return row.some(String); }).map(function (row) {
      var item = {};
      header.forEach(function (key, index) { if (key) item[key] = row[index] || ''; });
      return item;
    });
    return shootJson_({ ok: true, shots: shots });
  } catch (error) {
    return shootJson_({ ok: false, error: error.message });
  }
}

function shootDoPost(e) {
  try {
    shootAuthorize_(e);
    var payload = JSON.parse((e.postData && e.postData.contents) || '{}');
    var action = String(payload.action || (e.parameter && e.parameter.action) || '');
    if (action === 'note') shootApplyNote_(payload);
    else if (action === 'take-results') shootApplyTakeResult_(payload);
    else throw new Error('Unsupported action: ' + action);
    return shootJson_({ ok: true, action: action, shot_id: payload.shot_id });
  } catch (error) {
    return shootJson_({ ok: false, error: error.message });
  }
}

function shootAuthorize_(e) {
  var expected = PropertiesService.getScriptProperties().getProperty('MOTK_SHOOT_TOKEN');
  if (!expected) throw new Error('MOTK_SHOOT_TOKEN is not configured');
  var supplied = String((e.parameter && e.parameter.token) || '');
  if (!supplied || supplied !== expected) throw new Error('Unauthorized');
}

function shootSheet_() {
  var props = PropertiesService.getScriptProperties();
  var name = props.getProperty('MOTK_SHOOT_SHEET') || 'Shots';
  var sheet = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sheet) sheet = SpreadsheetApp.getActive().insertSheet(name);
  var lastColumn = Math.max(sheet.getLastColumn(), MOTK_SHOOT_COLUMNS.length);
  var header = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
  if (!header.some(String)) sheet.getRange(1, 1, 1, MOTK_SHOOT_COLUMNS.length).setValues([MOTK_SHOOT_COLUMNS]);
  return sheet;
}

function shootRows_(sheet) {
  var values = sheet.getDataRange().getValues();
  var header = (values.shift() || []).map(function (v) { return String(v).trim().toLowerCase(); });
  var map = {};
  header.forEach(function (key, index) { if (key) map[key] = index + 1; });
  MOTK_SHOOT_COLUMNS.forEach(function (key) {
    if (!map[key]) {
      var column = sheet.getLastColumn() + 1;
      sheet.getRange(1, column).setValue(key);
      map[key] = column;
    }
  });
  return { values: values, map: map };
}

function shootFindOrCreate_(sheet, shotId, allowCreate) {
  shotId = String(shotId || '').trim();
  if (!shotId) throw new Error('shot_id is required');
  var data = shootRows_(sheet);
  for (var i = 0; i < data.values.length; i++) {
    if (String(data.values[i][data.map.shot_id - 1]).trim() === shotId) return { row: i + 2, map: data.map };
  }
  if (!allowCreate) throw new Error('Unknown shot_id: ' + shotId);
  var row = Math.max(2, sheet.getLastRow() + 1);
  sheet.getRange(row, data.map.shot_id).setValue(shotId);
  return { row: row, map: data.map };
}

function shootSet_(sheet, location, key, value) {
  if (value !== undefined && location.map[key]) sheet.getRange(location.row, location.map[key]).setValue(value);
}

function shootApplyNote_(payload) {
  var sheet = shootSheet_();
  var location = shootFindOrCreate_(sheet, payload.shot_id, payload.create === true);
  ['scene', 'name', 'status', 'planned_frames', 'fps', 'notes', 'handover'].forEach(function (key) {
    shootSet_(sheet, location, key, payload[key]);
  });
  shootSet_(sheet, location, 'updated_at', new Date().toISOString());
}

function shootApplyTakeResult_(payload) {
  var sheet = shootSheet_();
  var location = shootFindOrCreate_(sheet, payload.shot_id, false);
  var currentTakes = Number(sheet.getRange(location.row, location.map.takes).getValue()) || 0;
  shootSet_(sheet, location, 'takes', Math.max(currentTakes, Number(payload.take) || 0));
  ['fps', 'frames', 'duration_s', 'raw_count', 'folder'].forEach(function (key) {
    shootSet_(sheet, location, key, payload[key]);
  });
  shootSet_(sheet, location, 'updated_at', payload.updated_at || new Date().toISOString());
}

function shootJson_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

// Remove these wrappers when integrating into an existing MOTK router.
function doGet(e) { return shootDoGet(e); }
function doPost(e) { return shootDoPost(e); }
