/**
 * RSVP receiver and guest lookup for chanelsonwedding.online
 *
 * Paste this into the Google Sheet's Apps Script editor
 * (Extensions -> Apps Script), then deploy as a Web app:
 *   Execute as: Me
 *   Who has access: Anyone
 * Copy the Web app URL into RSVP_ENDPOINT in index.html.
 *
 * Two tabs are used:
 *   GUEST_SHEET — the invitation list you fill in. One row per invitation.
 *   RSVP_SHEET  — one row appended per reply.
 * Both are created, with headers, on first use if they are missing.
 *
 * Redeploy after editing: Deploy -> Manage deployments -> edit -> New version.
 * A saved edit does nothing on its own; the live URL keeps serving the old one.
 */

var RSVP_SHEET  = 'Website RSVP';
var GUEST_SHEET = 'Guest List';

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

// Fill in the first three. 'Replied' is stamped for you when a reply lands,
// so an empty cell there is someone still to chase.
var GUEST_COLUMNS = ['Invitation name', 'Seats', 'Party members', 'Replied'];

var MIN_QUERY = 3;        // shorter than this is not a search, it is a trawl

/* --------------------------------------------------------------- endpoints */

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
    markReplied_(p.name);
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/**
 * With ?q= this answers the guest lookup. Without it, visiting the URL in a
 * browser shows a health check, which is handy after a deploy.
 *
 * The reply carries one invitation at a time and never a list, so the endpoint
 * confirms a name someone already knows rather than handing out the guest list.
 */
function doGet(e) {
  var q = (e && e.parameter && e.parameter.q) || '';
  if (!q) return json_({ ok: true, message: 'RSVP endpoint is live.' });
  try {
    var hit = findGuest_(q);
    if (!hit) return json_({ ok: true, found: false });
    return json_({
      ok: true,
      found: true,
      name: hit.name,
      seats: hit.seats,
      party: hit.party,
      replied: hit.replied
    });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/* ------------------------------------------------------------ guest lookup */

/**
 * Three passes, each needing a single winner: an exact match, then one name
 * that starts the same way, then one name containing every word typed. A tie
 * returns nothing rather than guessing between two guests.
 */
function findGuest_(q) {
  var want = norm_(q);
  if (want.length < MIN_QUERY) return null;

  var sheet = getGuestSheet_();
  if (sheet.getLastRow() < 2) return null;

  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, GUEST_COLUMNS.length).getValues();
  var wantWords = want.split(' ');
  var exact = [], prefix = [], loose = [];

  for (var i = 0; i < rows.length; i++) {
    var name = String(rows[i][0] || '').trim();
    if (!name) continue;
    var got = norm_(name);
    if (got === want) { exact.push(rows[i]); continue; }
    if (got.indexOf(want) === 0 || want.indexOf(got) === 0) { prefix.push(rows[i]); continue; }
    if (hasEveryWord_(got, wantWords)) loose.push(rows[i]);
  }

  var hit = pickOne_(exact) || pickOne_(prefix) || pickOne_(loose);
  if (!hit) return null;

  return {
    name: String(hit[0]).trim(),
    seats: Math.max(1, parseInt(hit[1], 10) || 1),
    party: splitNames_(hit[2]),
    replied: String(hit[3] || '').trim() !== ''
  };
}

function pickOne_(list) {
  return list.length === 1 ? list[0] : null;
}

function hasEveryWord_(haystack, words) {
  for (var i = 0; i < words.length; i++) {
    if (!words[i]) continue;
    if ((' ' + haystack + ' ').indexOf(' ' + words[i]) === -1) return false;
  }
  return true;
}

/** Lowercase, drop accents and punctuation, collapse spaces, so that
 *  "Peña-Dela Cruz, Ma." and "pena dela cruz ma" are the same person. */
function norm_(s) {
  s = String(s == null ? '' : s);
  try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (err) {}
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function splitNames_(v) {
  return String(v == null ? '' : v)
    .split(/[,;\n]+/)
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s !== ''; });
}

/** Stamp the matching invitation so an unreplied row is visible at a glance. */
function markReplied_(name) {
  if (!name) return;
  var sheet = getGuestSheet_();
  if (sheet.getLastRow() < 2) return;
  var want = norm_(name);
  var names = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < names.length; i++) {
    if (norm_(names[i][0]) === want) {
      sheet.getRange(i + 2, 4)
        .setValue(Utilities.formatDate(new Date(), 'Asia/Manila', 'yyyy-MM-dd HH:mm'));
      return;
    }
  }
}

/* ------------------------------------------------------------------ sheets */

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(RSVP_SHEET) || ss.insertSheet(RSVP_SHEET);
  // A tab that already exists but is still blank needs its headers too.
  if (sheet.getLastRow() === 0) {
    writeHeader_(sheet, COLUMNS);
    return sheet;
  }
  addGuestNamesColumn_(sheet);
  return sheet;
}

function getGuestSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(GUEST_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(GUEST_SHEET);
    writeHeader_(sheet, GUEST_COLUMNS);
    sheet.getRange(2, 1, 1, 3).setValues([['Nelson Reyes', 3, 'Chanel Reyes, Gabriel Reyes']]);
    sheet.getRange(2, 1, 1, 3).setFontStyle('italic').setFontColor('#999999');
    sheet.setColumnWidth(1, 220).setColumnWidth(3, 320);
  } else if (sheet.getLastRow() === 0) {
    writeHeader_(sheet, GUEST_COLUMNS);
  }
  return sheet;
}

function writeHeader_(sheet, columns) {
  sheet.appendRow(columns);
  sheet.getRange(1, 1, 1, columns.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
}

// Sheets written before the guest list existed are one column short. Open a
// gap in the right place so replies already collected keep their alignment.
function addGuestNamesColumn_(sheet) {
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (header.indexOf(GUEST_NAMES) !== -1) return;
  sheet.insertColumnAfter(GUEST_NAMES_AT - 1);
  sheet.getRange(1, GUEST_NAMES_AT).setValue(GUEST_NAMES).setFontWeight('bold');
}

/* ------------------------------------------------------------------ shared */

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
