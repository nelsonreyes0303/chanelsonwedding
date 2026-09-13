/**
 * RSVP receiver for chanelsonwedding.online
 *
 * Paste this into the Google Sheet's Apps Script editor
 * (Extensions -> Apps Script), then deploy as a Web app:
 *   Execute as: Me
 *   Who has access: Anyone
 * Copy the Web app URL into RSVP_ENDPOINT in index.html.
 *
 * Every submission is appended as one row to the RSVP_SHEET tab.
 * The tab is created with headers on first use if it does not exist.
 */

var RSVP_SHEET = 'RSVP Responses';

var COLUMNS = [
  'Received (Manila)',
  'Name',
  'Attending',
  'Guests',
  'Dietary restrictions',
  'Note',
  'Sent from browser (ISO)'
];

function doPost(e) {
  try {
    var p = (e && e.parameter) || {};
    var sheet = getSheet_();
    sheet.appendRow([
      Utilities.formatDate(new Date(), 'Asia/Manila', 'yyyy-MM-dd HH:mm:ss'),
      clean_(p.name),
      clean_(p.attending),
      clean_(p.guests),
      clean_(p.diet),
      clean_(p.note),
      clean_(p.sent)
    ]);
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

// Visiting the URL in a browser shows this, which is handy for checking the deploy.
function doGet() {
  return json_({ ok: true, message: 'RSVP endpoint is live.' });
}

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(RSVP_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(RSVP_SHEET);
    sheet.appendRow(COLUMNS);
    sheet.getRange(1, 1, 1, COLUMNS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function clean_(v) {
  v = v == null ? '' : String(v).trim();
  // Stop a reply that starts with = + - @ from being read as a formula.
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
