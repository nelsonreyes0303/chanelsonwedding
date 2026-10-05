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
 * The tab is created, and its headers written, on first use if needed.
 */

var RSVP_SHEET = 'Website RSVP';

var GUEST_NAMES = 'Who is coming';
var GUEST_NAMES_AT = 5;   // 1-based column, straight after Guests

var COLUMNS = [
  'Received (Manila)',
  'Name',
  'Attending',
  'Guests',
  GUEST_NAMES,
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
      clean_(p.party),
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
  var sheet = ss.getSheetByName(RSVP_SHEET) || ss.insertSheet(RSVP_SHEET);
  // A tab that already exists but is still blank needs its headers too.
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(COLUMNS);
    sheet.getRange(1, 1, 1, COLUMNS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
    return sheet;
  }
  addGuestNamesColumn_(sheet);
  return sheet;
}

// Sheets written before the guest list existed are one column short. Open a
// gap in the right place so replies already collected keep their alignment.
function addGuestNamesColumn_(sheet) {
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (header.indexOf(GUEST_NAMES) !== -1) return;
  sheet.insertColumnAfter(GUEST_NAMES_AT - 1);
  sheet.getRange(1, GUEST_NAMES_AT).setValue(GUEST_NAMES).setFontWeight('bold');
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
