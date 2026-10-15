/**
 * RSVP receiver and guest lookup for chanelsonwedding.online
 *
 * Paste this into the Google Sheet's Apps Script editor
 * (Extensions -> Apps Script), then deploy as a Web app:
 *   Execute as: Me
 *   Who has access: Anyone
 * Copy the Web app URL into RSVP_ENDPOINT in index.html.
 *
 * Redeploy after editing: Deploy -> Manage deployments -> edit -> New version.
 * A saved edit does nothing on its own; the live URL keeps serving the old one.
 *
 * GUEST_SHEET is read as the seating chart it already is: one column per
 * table, the table's name at the top, a guest in every cell below it. The
 * script only ever reads that tab — it never writes to it — so nothing can
 * disturb the seating plan. Replies are appended to RSVP_SHEET instead.
 */

var RSVP_SHEET  = 'Website RSVP';
var GUEST_SHEET = 'GUEST LIST';

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

var MIN_QUERY = 3;        // shorter than this is not a search, it is a trawl
var HEADER_MIN = 3;       // a row with this many filled cells is the table header row
var SCAN_ROWS  = 25;      // how far down to hunt for that header row

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
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/**
 * With ?q= this answers the guest lookup. Without it, visiting the URL in a
 * browser shows a health check, which is handy after a deploy.
 *
 * The reply carries one guest at a time and never a list, so the endpoint
 * confirms a name someone already knows rather than handing out the guest list.
 */
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.names) return checkNames_(p.names);
  var q = p.q || "";
  if (!q) return json_({ ok: true, message: "RSVP endpoint is live." });
  try {
    var hit = findGuest_(q);
    if (!hit) return json_({ ok: true, found: false });
    return json_({ ok: true, found: true, name: hit.name, table: hit.table });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/**
 * The companions on one reply, checked in a single request. The chart is read
 * once for the whole party rather than once per name.
 */
function checkNames_(raw) {
  try {
    var list = String(raw).split("|").map(tidy_).filter(String).slice(0, 12);
    if (!list.length) return json_({ ok: true, results: [] });
    var guests = readGuests_();
    var results = list.map(function (n) {
      var hit = matchIn_(guests, n);
      return hit
        ? { q: n, found: true, name: hit.name, table: hit.table }
        : { q: n, found: false };
    });
    return json_({ ok: true, results: results });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/* ------------------------------------------------------------ guest lookup */

/**
 * Flattens the seating chart into one entry per guest.
 *
 * The header row is found rather than hard-coded, so blank rows above it and
 * columns added later both survive. Every column with a heading contributes
 * its guests; the heading travels with them as their table.
 */
function readGuests_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(GUEST_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return [];

  var values = sheet.getDataRange().getValues();
  var header = -1;
  for (var r = 0; r < values.length && r < SCAN_ROWS; r++) {
    var filled = 0;
    for (var c = 0; c < values[r].length; c++) {
      if (tidy_(values[r][c])) filled++;
    }
    if (filled >= HEADER_MIN) { header = r; break; }
  }
  if (header === -1) return [];

  var out = [];
  for (var col = 0; col < values[header].length; col++) {
    var table = tidy_(values[header][col]);
    if (!table) continue;
    for (var row = header + 1; row < values.length; row++) {
      var name = tidy_(values[row][col]);
      if (name) out.push({ name: name, table: table });
    }
  }
  return out;
}

/**
 * Three passes, each needing a single winner: an exact match, then one name
 * that starts the same way, then one name containing every word typed. A tie
 * returns nothing rather than guessing between two guests — so a sheet entry
 * like a bare surname shared by three people will never resolve.
 */
function findGuest_(q) {
  return matchIn_(readGuests_(), q);
}

function matchIn_(guests, q) {
  var want = norm_(q);
  if (want.length < MIN_QUERY) return null;

  var words = want.split(' ');
  var exact = [], prefix = [], loose = [];

  for (var i = 0; i < guests.length; i++) {
    var got = norm_(guests[i].name);
    if (!got) continue;
    if (got === want) { exact.push(guests[i]); continue; }
    if (got.indexOf(want) === 0 || want.indexOf(got) === 0) { prefix.push(guests[i]); continue; }
    if (hasEveryWord_(got, words)) loose.push(guests[i]);
  }

  return pickOne_(exact) || pickOne_(prefix) || pickOne_(loose);
}

/** One winner, or nothing. Two rows naming the same person at the same table
 *  count as one, which is what a name repeated across a merged cell looks like. */
function pickOne_(list) {
  if (!list.length) return null;
  for (var i = 1; i < list.length; i++) {
    if (norm_(list[i].name) !== norm_(list[0].name)) return null;
  }
  return list[0];
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

/** Cell text as a person would read it: no stray newlines or double spaces. */
function tidy_(v) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
}

/* ------------------------------------------------------------------ sheets */

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

/* -------------------------------------------------------------------- test */

/**
 * Run this from the editor (Run -> checkGuestList) and read the log. It says
 * how the sheet was understood and which names cannot be matched, without
 * changing anything.
 */
function checkGuestList() {
  var guests = readGuests_();
  Logger.log('Guests found: ' + guests.length);
  if (!guests.length) {
    Logger.log('Nothing read. Is the tab named exactly "' + GUEST_SHEET + '"?');
    return;
  }

  var tables = {};
  var seen = {};
  var clashes = [];
  guests.forEach(function (g) {
    tables[g.table] = (tables[g.table] || 0) + 1;
    var k = norm_(g.name);
    if (seen[k] && seen[k] !== g.name) clashes.push(g.name);
    seen[k] = g.name;
  });

  Logger.log('Tables: ' + Object.keys(tables).join(' | '));
  Logger.log('Sample: ' + guests.slice(0, 5).map(function (g) {
    return g.name + ' -> ' + g.table;
  }).join(', '));

  var oneWord = guests.filter(function (g) { return norm_(g.name).split(' ').length < 2; });
  if (oneWord.length) {
    Logger.log('Single-word entries, hard to match: ' +
      oneWord.map(function (g) { return g.name; }).join(', '));
  }
  if (clashes.length) Logger.log('Repeated names: ' + clashes.join(', '));
}
