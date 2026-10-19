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

/* The way in to the guest list manager at chanelsonwedding.online/manage.html.
 *
 * The code lives here, not in manage.html, because that page is public and
 * this script is not. Changing it means editing this line and redeploying;
 * nothing on the website moves. Everyone signed in is signed out by it.
 *
 * It is typed once per device and then traded for a token that lasts a month,
 * which is what lets it be long enough to be worth having. */
var ADMIN_CODE  = 'chanelson-132611';
var SESSION_DAYS = 30;

/* Wrong codes are counted across everybody, because the endpoint cannot tell
 * who is asking. Eight inside a quarter of an hour and it stops answering.
 * That is blunt — a stranger hammering it locks the two of you out as well —
 * but a guest list is better unreachable for fifteen minutes than guessable
 * in an afternoon. */
var MAX_TRIES      = 8;
var TRY_WINDOW_MIN = 15;

var TABLES_SHEET     = 'TABLES';
var UNSEATED         = 'Not yet seated';
var DEFAULT_CAPACITY = 10;

/* 1-based columns of the GUESTS tab, in the order buildGuests writes them. */
var GCOL   = { name:1, side:2, household:3, table:4, seats:5, status:6, replied:7, note:8 };
var GWIDTH = 8;

var RSVP_SHEET  = 'Website RSVP';
var GUEST_SHEET = 'GUEST LIST';
var SEATS_SHEET = 'Plus Ones';   // name/seats column pairs, side by side
var ROSTER_SHEET = 'CONFIRMED GUESTS';
var GUESTS_SHEET = 'GUESTS';   // the single tab the admin app will own
var GUESTS_COLUMNS = ['Name','Side','Household','Table','Seats','Status','Replied','Note'];
var ROSTER_STATUS_COL = 2;   // column B, the one holding Pending

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
    if (p.op) return adminApi_(p);
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

    try {
      markRoster_(p.party ? String(p.party).split(',') : [p.name],
                  String(p.attending).toLowerCase() === 'yes');
    } catch (rosterErr) {
      // The reply is already recorded. A roster that cannot be reached is
      // worth fixing later, not worth refusing the guest over.
    }

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
    return json_({
      ok: true,
      found: true,
      name: hit.name,
      table: hit.table,
      seats: readSeats_()[norm_(hit.name)] || 1
    });
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

/**
 * Seats set aside per invitation, read from a tab of name-and-number pairs
 * sitting side by side — one block per host, and room for more later.
 *
 * The pairs are found rather than fixed: any header naming seats marks the
 * number, and the column to its left holds the name. So a third block can be
 * added beside the others without touching this.
 *
 * The tab is optional. A guest with no row there is simply one seat.
 */
function readSeats_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SEATS_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return {};

  var values = sheet.getDataRange().getValues();
  var header = values[0] || [];
  var pairs = [];
  for (var c = 1; c < header.length; c++) {
    if (/seat/i.test(tidy_(header[c]))) pairs.push({ name: c - 1, count: c });
  }
  if (!pairs.length) pairs.push({ name: 0, count: 1 });

  var out = {};
  for (var r = 1; r < values.length; r++) {
    for (var i = 0; i < pairs.length; i++) {
      var name = norm_(values[r][pairs[i].name]);
      var n = parseInt(values[r][pairs[i].count], 10);
      if (name && n > 0) out[name] = n;
    }
  }
  return out;
}

/**
 * Answers each person on a reply in the roster, turning Pending into Yes or No.
 *
 * A name repeated down the column is several people sharing a placeholder —
 * three rows of "Daddy +1" are three seats, not one written thrice. So each
 * name takes the first row still unanswered, and the local copy is marked as
 * it goes, letting one reply name the same placeholder more than once and
 * answer a different row each time.
 *
 * Rows already answered are left alone unless every row for that name is
 * answered, in which case the first is updated, so a guest who replies twice
 * is not silently ignored. Nothing is ever cleared, and a name absent from
 * the roster is skipped rather than added.
 */
function markRoster_(names, attending) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ROSTER_SHEET);
  if (!sheet || sheet.getLastRow() < 1) return;

  var rows = sheet.getRange(1, 1, sheet.getLastRow(), ROSTER_STATUS_COL).getValues();
  var answer = attending ? 'Yes' : 'No';
  var col = ROSTER_STATUS_COL - 1;

  names.forEach(function (raw) {
    var want = norm_(raw);
    if (!want) return;

    var answered = -1;
    for (var i = 0; i < rows.length; i++) {
      if (rosterName_(rows[i][0]) !== want) continue;
      var status = tidy_(rows[i][col]);
      if (status === '' || status.toLowerCase() === 'pending') {
        sheet.getRange(i + 1, ROSTER_STATUS_COL).setValue(answer);
        rows[i][col] = answer;
        return;
      }
      if (answered === -1) answered = i;
    }

    if (answered !== -1) {
      sheet.getRange(answered + 1, ROSTER_STATUS_COL).setValue(answer);
      rows[answered][col] = answer;
    }
  });
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
    if (startsWith_(got, want) || longerForm_(want, got)) { prefix.push(guests[i]); continue; }
    if (hasEveryWord_(got, words)) loose.push(guests[i]);
  }

  return pickOne_(exact) || pickOne_(prefix) || pickOne_(loose);
}

/** What was typed opens the name on the chart: "nelson rey" finds "Nelson Reyes". */
function startsWith_(got, want) {
  return got.indexOf(want) === 0;
}

/**
 * The chart entry opens what was typed, so "Mai Villa" still answers to "Mai
 * Villa Jr". Only whole words count, and only entries of two words or more:
 * a lone nickname like "Mai" must not swallow every name beginning with it.
 */
function longerForm_(want, got) {
  if (got.split(" ").length < 2) return false;
  return want.indexOf(got + " ") === 0;
}

/** One winner, or nothing. Two rows naming the same person at the same table
 *  count as one, which is what a name repeated across a merged cell looks like. */
function pickOne_(list) {
  if (!list.length) return null;
  var seats = {};
  for (var i = 0; i < list.length; i++) {
    if (norm_(list[i].name) !== norm_(list[0].name)) return null;
    seats[list[i].table] = true;
  }
  // The same name twice is one person written twice; the same name at two
  // tables is two people, and guessing a seat for them would seat one wrongly.
  if (Object.keys(seats).length > 1) return { name: list[0].name, table: "" };
  return list[0];
}

function hasEveryWord_(haystack, words) {
  for (var i = 0; i < words.length; i++) {
    if (!words[i]) continue;
    if ((' ' + haystack + ' ').indexOf(' ' + words[i]) === -1) return false;
  }
  return true;
}

/**
 * A roster row numbers itself in its name cell — "1. Raven" — so the number is
 * part of the layout, not the person, and comes off before any comparison.
 */
function rosterName_(v) {
  return norm_(String(v == null ? '' : v).replace(/^\s*\d+\s*[.)]\s*/, ''));
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

/* -------------------------------------------------------------------- sync */

/**
 * Rebuilds the roster from the seating chart, so a guest added to the chart
 * appears here too. Run it from the editor; nothing calls it on its own.
 *
 * Answers already given are carried across by name, and a name appearing more
 * than once keeps its answers in order, so three rows of one placeholder stay
 * three distinct rows rather than collapsing into one. The old tab is copied
 * aside first, because this rewrites the sheet rather than editing it.
 */
function syncRoster() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var guests = readGuests_();
  if (!guests.length) {
    Logger.log('Read nothing from "' + GUEST_SHEET + '". Nothing was changed.');
    return;
  }

  var sheet = ss.getSheetByName(ROSTER_SHEET);
  var answers = {};
  if (sheet && sheet.getLastRow() > 0) {
    sheet.getRange(1, 1, sheet.getLastRow(), ROSTER_STATUS_COL).getValues()
      .forEach(function (r) {
        var k = rosterName_(r[0]);
        var v = tidy_(r[ROSTER_STATUS_COL - 1]);
        if (!k || !v) return;
        (answers[k] = answers[k] || []).push(v);
      });
    sheet.copyTo(ss).setName(
      ROSTER_SHEET + ' before ' +
      Utilities.formatDate(new Date(), 'Asia/Manila', 'MM-dd HH:mm'));
  } else if (!sheet) {
    sheet = ss.insertSheet(ROSTER_SHEET);
  }

  var order = [], byTable = {};
  guests.forEach(function (g) {
    if (!byTable[g.table]) { byTable[g.table] = []; order.push(g.table); }
    byTable[g.table].push(g.name);
  });

  var rows = [], heads = [], pending = [], carried = 0;
  order.forEach(function (table) {
    heads.push(rows.length + 1);
    rows.push([table, '']);
    rows.push(['', '']);
    byTable[table].forEach(function (name, i) {
      var k = rosterName_(name);
      var had = (answers[k] && answers[k].length) ? answers[k].shift() : 'Pending';
      if (had.toLowerCase() !== 'pending') carried++;
      if (had.toLowerCase() === 'pending') pending.push(rows.length + 1);
      rows.push([(i + 1) + '. ' + name, had]);
    });
    rows.push(['', '']);
  });

  sheet.clear();
  sheet.getRange(1, 1, rows.length, 2).setValues(rows);
  heads.forEach(function (r) { sheet.getRange(r, 1).setFontWeight('bold'); });
  pending.forEach(function (r) { sheet.getRange(r, ROSTER_STATUS_COL).setBackground('#FCE5CD'); });
  sheet.setColumnWidth(1, 260);
  sheet.setFrozenRows(0);

  Logger.log('Rebuilt ' + ROSTER_SHEET + ': ' + guests.length + ' guests across ' +
    order.length + ' tables. Answers carried over: ' + carried +
    '. The previous tab was copied aside.');
}

/* --------------------------------------------------------------- migration */

/**
 * Which side of the family a guest belongs to, taken from the Plus Ones tab,
 * where each block of columns is headed by one host's name.
 */
function readSides_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SEATS_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return {};

  var values = sheet.getDataRange().getValues();
  var header = values[0] || [];
  var blocks = [];
  for (var c = 0; c < header.length; c++) {
    var h = tidy_(header[c]);
    if (h && !/seat/i.test(h)) blocks.push({ col: c, side: h.replace(/\s*guests?$/i, '') });
  }

  var out = {};
  for (var r = 1; r < values.length; r++) {
    for (var i = 0; i < blocks.length; i++) {
      var name = norm_(values[r][blocks[i].col]);
      if (name) out[name] = blocks[i].side;
    }
  }
  return out;
}

/** Each guest's answer so far, read from the roster. */
function readStatuses_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ROSTER_SHEET);
  if (!sheet || sheet.getLastRow() < 1) return {};
  var rows = sheet.getRange(1, 1, sheet.getLastRow(), ROSTER_STATUS_COL).getValues();
  var out = {};
  rows.forEach(function (r) {
    var k = rosterName_(r[0]), v = tidy_(r[ROSTER_STATUS_COL - 1]);
    if (k && v) out[k] = v;
  });
  return out;
}

/**
 * The replies already collected, keyed by every person each one names.
 * A reply is what tells us who belongs with whom, so it is also where the
 * households come from — everyone on one reply shares its sender.
 */
function readReplies_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(RSVP_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return {};
  var values = sheet.getDataRange().getValues();
  var head = values[0].map(function (h) { return tidy_(h).toLowerCase(); });
  var iWhen = head.indexOf('received (manila)'),
      iName = head.indexOf('name'),
      iParty = head.indexOf(GUEST_NAMES.toLowerCase()),
      iNote = head.indexOf('note');

  var out = {};
  for (var r = 1; r < values.length; r++) {
    var sender = tidy_(values[r][iName]);
    if (!sender) continue;
    var party = iParty > -1 ? String(values[r][iParty]).split(',') : [];
    if (!party.length) party = [sender];
    party.forEach(function (p) {
      var k = norm_(p);
      if (!k) return;
      out[k] = {
        household: sender,
        when: iWhen > -1 ? tidy_(values[r][iWhen]) : '',
        note: (iNote > -1 && norm_(p) === norm_(sender)) ? tidy_(values[r][iNote]) : ''
      };
    });
  }
  return out;
}

/**
 * Builds GUESTS from the seating chart, the Plus Ones tab and the roster,
 * one row per person. Nothing is read from GUESTS itself and nothing else is
 * touched, so this can be run, inspected, thrown away and run again.
 *
 * Households come from the replies where there are any, and otherwise from
 * the Plus Ones tab, which names the person an invitation was addressed to.
 * Everyone else stands alone until grouped in the app.
 */
function buildGuests() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var chart = readGuests_();
  if (!chart.length) {
    Logger.log('Read nothing from "' + GUEST_SHEET + '". Nothing was written.');
    return;
  }

  var seats = readSeats_(), sides = readSides_(),
      status = readStatuses_(), replies = readReplies_();

  var rows = chart.map(function (g) {
    var k = norm_(g.name), reply = replies[k];
    return [
      g.name,
      sides[k] || '',
      reply ? reply.household : (seats[k] ? g.name : g.name),
      g.table,
      seats[k] || 1,
      status[k] || 'Pending',
      reply ? reply.when : '',
      reply ? reply.note : ''
    ];
  });

  var sheet = ss.getSheetByName(GUESTS_SHEET);
  if (sheet) {
    sheet.copyTo(ss).setName(GUESTS_SHEET + ' before ' +
      Utilities.formatDate(new Date(), 'Asia/Manila', 'MM-dd HH:mm'));
    sheet.clear();
  } else {
    sheet = ss.insertSheet(GUESTS_SHEET);
  }
  sheet.getRange(1, 1, 1, GUESTS_COLUMNS.length).setValues([GUESTS_COLUMNS]).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.getRange(2, 1, rows.length, GUESTS_COLUMNS.length).setValues(rows);
  sheet.setColumnWidth(1, 220).setColumnWidth(3, 200).setColumnWidth(8, 300);

  var withSide = rows.filter(function (r) { return r[1]; }).length;
  var answered = rows.filter(function (r) { return r[5].toLowerCase() !== 'pending'; }).length;
  var grouped = rows.filter(function (r) { return norm_(r[2]) !== norm_(r[0]); }).length;
  Logger.log('Wrote ' + rows.length + ' guests to "' + GUESTS_SHEET + '".');
  Logger.log('  side known: ' + withSide + ' · already answered: ' + answered +
             ' · grouped into another household: ' + grouped);
  Logger.log('Nothing else was changed. The RSVP still reads the old tabs.');
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

  // A name spelled one way on the chart and another on the roster turns the
  // flip into a quiet no-op, so it is worth naming before the replies arrive.
  var roster = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ROSTER_SHEET);
  if (!roster || roster.getLastRow() < 1) {
    Logger.log('No "' + ROSTER_SHEET + '" tab: replies will not flip anything.');
    return;
  }
  var known = {};
  roster.getRange(1, 1, roster.getLastRow(), 1).getValues()
    .forEach(function (r) { var k = norm_(r[0]); if (k) known[k] = true; });
  var missing = guests.filter(function (g) { return !known[norm_(g.name)]; });
  Logger.log(missing.length
    ? 'On the chart but not on the roster (' + missing.length + '): ' +
      missing.map(function (g) { return g.name; }).join(', ')
    : 'Every name on the chart is also on the roster.');
}


/* ========================================================================
   GUEST LIST MANAGER

   The API behind chanelsonwedding.online/manage.html. It reads and writes
   the GUESTS tab, which buildGuests() fills from the seating chart, and
   reads Website RSVP for the replies. Table sizes live in a TABLES tab it
   creates the first time one is set.

   Every call arrives as a POST with op=<name>. Everything except login must
   carry a token, and a request without a good one is answered 'auth' and
   nothing else, so an unauthenticated caller never learns a guest's name.
   ======================================================================== */

function adminApi_(p) {
  var op = String(p.op || '');
  if (op === 'login') return adminLogin_(p.code);
  if (!adminValid_(p.token)) return json_({ ok: false, error: 'auth' });

  var args;
  try { args = JSON.parse(p.args || '[]'); }
  catch (err) { return json_({ ok: false, error: 'bad arguments' }); }

  try {
    switch (op) {
      case 'getAll':      return json_({ ok: true, data: adminAll_() });
      case 'saveGuest':   return adminWrite_(function () { adminSave_(args[0]); });
      case 'addGuest':    return adminWrite_(function () { adminAdd_(args[0]); });
      case 'removeGuest': return adminWrite_(function () { adminRemove_(args[0]); });
      case 'bulk':        return adminWrite_(function () { adminBulk_(args[0], args[1], args[2]); });
      case 'setCapacity': return adminWrite_(function () { adminCapacity_(args[0], args[1]); });
      case 'renameTable': return adminWrite_(function () { adminRename_(args[0], args[1]); });
    }
    return json_({ ok: false, error: 'unknown request' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/**
 * Every write takes the lock and then hands back the whole list, so the page
 * redraws from what the sheet actually holds rather than what it hoped for.
 * Two tabs open on a phone and a laptop is the normal way to use this, and
 * without the lock the later save silently wins.
 */
function adminWrite_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    fn();
    return json_({ ok: true, data: adminAll_() });
  } finally {
    lock.releaseLock();
  }
}

/* ---------------------------------------------------------------- the door */

function adminLogin_(code) {
  var props = PropertiesService.getScriptProperties();
  var now   = Date.now();

  var tries = Number(props.getProperty('admin_tries') || 0);
  var since = Number(props.getProperty('admin_since') || 0);
  if (!since || now - since > TRY_WINDOW_MIN * 60000) { tries = 0; since = now; }

  if (tries >= MAX_TRIES) {
    return json_({
      ok: false, error: 'locked',
      minutes: Math.max(1, Math.ceil((TRY_WINDOW_MIN * 60000 - (now - since)) / 60000))
    });
  }

  if (String(code || '').trim() !== ADMIN_CODE) {
    Utilities.sleep(1500);
    props.setProperty('admin_tries', String(tries + 1));
    props.setProperty('admin_since', String(since));
    return json_({ ok: false, error: 'code' });
  }

  props.deleteProperty('admin_tries');
  props.deleteProperty('admin_since');
  adminSweep_(props, now);

  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  props.setProperty('tok_' + token, String(now + SESSION_DAYS * 86400000));
  return json_({ ok: true, token: token, data: adminAll_() });
}

function adminValid_(token) {
  var t = String(token || '').trim();
  if (!/^[0-9a-f]{64}$/.test(t)) return false;
  var props = PropertiesService.getScriptProperties();
  var until = Number(props.getProperty('tok_' + t) || 0);
  if (!until) return false;
  if (Date.now() > until) { props.deleteProperty('tok_' + t); return false; }
  return true;
}

/** Expired tokens would otherwise pile up in the script's properties. */
function adminSweep_(props, now) {
  var all = props.getProperties();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('tok_') === 0 && Number(all[k]) < now) props.deleteProperty(k);
  });
}

/* ---------------------------------------------------------------- reading */

function adminAll_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(GUESTS_SHEET);
  if (!sheet || sheet.getLastRow() < 2) {
    return { ready: false, guests: [], tables: [], replies: [], sides: [] };
  }

  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, GWIDTH).getValues();
  var guests = [];
  for (var i = 0; i < rows.length; i++) {
    var name = String(rows[i][GCOL.name - 1] || '').trim();
    if (!name) continue;
    guests.push({
      row: i + 2,                                  // the sheet row, to write back to
      name: name,
      side: String(rows[i][GCOL.side - 1] || '').trim(),
      household: String(rows[i][GCOL.household - 1] || '').trim() || name,
      table: String(rows[i][GCOL.table - 1] || '').trim(),
      seats: parseInt(rows[i][GCOL.seats - 1], 10) || 1,
      status: adminStatus_(rows[i][GCOL.status - 1]),
      replied: String(rows[i][GCOL.replied - 1] || '').trim(),
      note: String(rows[i][GCOL.note - 1] || '').trim()
    });
  }

  return {
    ready: true,
    guests: guests,
    tables: adminTables_(ss, guests),
    replies: adminReplies_(ss),
    sides: adminUniq_(guests.map(function (g) { return g.side; }).filter(String))
  };
}

/** Coming / No reply / Cannot come, however the sheet happens to spell it. */
function adminStatus_(v) {
  var s = String(v || '').trim().toLowerCase();
  if (!s || s === 'pending') return 'No reply';
  if (s === 'yes' || s === 'coming' || s === 'confirmed') return 'Coming';
  if (s === 'no' || s === 'declined' || s.indexOf('cannot') === 0) return 'Cannot come';
  return 'No reply';
}

/**
 * Capacities, kept in their own tab so a table can be bigger than the number
 * of people currently sitting at it. A table nobody has sized yet is assumed
 * to hold DEFAULT_CAPACITY, or everyone already there if that is more.
 */
function adminTables_(ss, guests) {
  var sheet = ss.getSheetByName(TABLES_SHEET);
  var caps = {};
  if (sheet && sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues().forEach(function (r) {
      var n = String(r[0] || '').trim(), c = parseInt(r[1], 10);
      if (n && c > 0) caps[n] = c;
    });
  }

  var order = [], seated = {};
  guests.forEach(function (g) {
    if (!g.table) return;
    if (!seated[g.table]) { seated[g.table] = 0; order.push(g.table); }
    seated[g.table]++;
  });
  Object.keys(caps).forEach(function (n) { if (order.indexOf(n) === -1) order.push(n); });

  return order.map(function (n) {
    return { name: n, capacity: caps[n] || Math.max(DEFAULT_CAPACITY, seated[n] || 0) };
  });
}

function adminReplies_(ss) {
  var sheet = ss.getSheetByName(RSVP_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var values = sheet.getDataRange().getValues();
  var head = values[0].map(function (h) { return String(h || '').trim().toLowerCase(); });
  var iWhen = head.indexOf('received (manila)'), iName = head.indexOf('name'),
      iAtt = head.indexOf('attending'), iCount = head.indexOf('guests'),
      iParty = head.indexOf('who is coming'), iNote = head.indexOf('note');

  var out = [];
  for (var r = values.length - 1; r >= 1 && out.length < 60; r--) {
    var n = iName > -1 ? String(values[r][iName] || '').trim() : '';
    if (!n) continue;
    out.push({
      when:  iWhen  > -1 ? String(values[r][iWhen]  || '') : '',
      name:  n,
      attending: iAtt   > -1 ? String(values[r][iAtt]   || '') : '',
      count:     iCount > -1 ? String(values[r][iCount] || '') : '',
      party:     iParty > -1 ? String(values[r][iParty] || '') : '',
      note:      iNote  > -1 ? String(values[r][iNote]  || '') : ''
    });
  }
  return out;
}

/** The sides as the sheet spells them, each once, in the order they appear. */
function adminUniq_(list) {
  var seen = {}, out = [];
  for (var i = 0; i < list.length; i++) {
    var v = String(list[i]).trim();
    if (!v || seen[v]) continue;
    seen[v] = true;
    out.push(v);
  }
  return out;
}

/* ---------------------------------------------------------------- writing */

function adminGuestSheet_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(GUESTS_SHEET);
  if (!sheet) throw new Error('No GUESTS tab. Run buildGuests() first.');
  return sheet;
}

function adminSave_(g) {
  adminGuestSheet_().getRange(g.row, 1, 1, GWIDTH).setValues([[
    g.name, g.side, g.household || g.name,
    g.table === UNSEATED ? '' : g.table,
    parseInt(g.seats, 10) || 1,
    g.status, g.replied || '', g.note || ''
  ]]);
}

function adminAdd_(g) {
  adminGuestSheet_().appendRow([
    g.name, g.side || '', g.household || g.name,
    g.table === UNSEATED ? '' : (g.table || ''),
    parseInt(g.seats, 10) || 1,
    g.status || 'No reply', '', ''
  ]);
}

function adminRemove_(row) {
  adminGuestSheet_().deleteRow(row);
}

/**
 * Several guests at once. Rows are deleted from the bottom up, so removing
 * one does not shift the next out from under us.
 */
function adminBulk_(rows, field, value) {
  var sheet = adminGuestSheet_();
  if (field === 'remove') {
    rows.slice().sort(function (a, b) { return b - a; })
      .forEach(function (r) { sheet.deleteRow(r); });
    return;
  }
  var col = field === 'table'  ? GCOL.table
          : field === 'status' ? GCOL.status
          : field === 'side'   ? GCOL.side : 0;
  if (!col) return;
  var v = (field === 'table' && value === UNSEATED) ? '' : value;
  rows.forEach(function (r) { sheet.getRange(r, col).setValue(v); });
}

function adminCapacity_(name, capacity) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(TABLES_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(TABLES_SHEET);
    sheet.getRange(1, 1, 1, 2).setValues([['Table', 'Seats']]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  var last = sheet.getLastRow();
  var names = last > 1 ? sheet.getRange(2, 1, last - 1, 1).getValues() : [];
  for (var i = 0; i < names.length; i++) {
    if (String(names[i][0]).trim() === name) {
      sheet.getRange(i + 2, 2).setValue(capacity);
      return;
    }
  }
  sheet.appendRow([name, capacity]);
}

function adminRename_(from, to) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = adminGuestSheet_();
  var last = sheet.getLastRow();
  if (last > 1) {
    var col = sheet.getRange(2, GCOL.table, last - 1, 1);
    var v = col.getValues();
    for (var i = 0; i < v.length; i++) if (String(v[i][0]).trim() === from) v[i][0] = to;
    col.setValues(v);
  }
  var t = ss.getSheetByName(TABLES_SHEET);
  if (t && t.getLastRow() > 1) {
    var tc = t.getRange(2, 1, t.getLastRow() - 1, 1);
    var tv = tc.getValues();
    for (var j = 0; j < tv.length; j++) if (String(tv[j][0]).trim() === from) tv[j][0] = to;
    tc.setValues(tv);
  }
}
