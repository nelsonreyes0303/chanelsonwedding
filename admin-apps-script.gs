/**
 * Guest list manager for chanelsonwedding.online
 *
 * This is a SECOND, separate Apps Script project — not the RSVP one.
 * Keeping them apart is the point: the RSVP endpoint is deployed to Anyone
 * because guests must reach it, and this must never be. Two projects, two
 * deployments, two access settings, no passphrase to leak.
 *
 * SETUP
 *   1. script.google.com -> New project. Paste this file over Code.gs.
 *   2. Put your spreadsheet id in SHEET_ID below. It is the long string in the
 *      sheet's URL between /d/ and /edit.
 *   3. Run buildGuests() in the RSVP project first, so the GUESTS tab exists.
 *   4. Deploy -> New deployment -> Web app
 *        Execute as:      Me
 *        Who has access:  Only myself      <- never Anyone
 *   5. Open the URL it gives you. Bookmark it. Add Chanel by sharing the
 *      script project with her Google account.
 *
 * It reads and writes the GUESTS tab, and reads Website RSVP for the replies.
 * Table capacities live in a TABLES tab it creates on first use.
 */

var SHEET_ID = 'PUT_YOUR_SPREADSHEET_ID_HERE';

var GUESTS_SHEET = 'GUESTS';
var TABLES_SHEET = 'TABLES';
var RSVP_SHEET   = 'Website RSVP';

var UNSEATED = 'Not yet seated';
var DEFAULT_CAPACITY = 10;

// 1-based columns of the GUESTS tab, in the order buildGuests writes them.
var C = { name: 1, side: 2, household: 3, table: 4, seats: 5, status: 6, replied: 7, note: 8 };
var WIDTH = 8;

/* ------------------------------------------------------------------- serve */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('ui')
    .setTitle('Guest List')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function book_() {
  return SpreadsheetApp.openById(SHEET_ID);
}

/**
 * Every write takes the lock. Two tabs open on a phone and a laptop is the
 * normal way to use this, and without it the later save silently wins.
 */
function guarded_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/* -------------------------------------------------------------------- read */

function getAll() {
  var ss = book_();
  var sheet = ss.getSheetByName(GUESTS_SHEET);
  if (!sheet || sheet.getLastRow() < 2) {
    return { ready: false, guests: [], tables: [], replies: [] };
  }

  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, WIDTH).getValues();
  var guests = [];
  for (var i = 0; i < rows.length; i++) {
    var name = String(rows[i][C.name - 1] || '').trim();
    if (!name) continue;
    guests.push({
      row: i + 2,                                  // the sheet row, used to write back
      name: name,
      side: String(rows[i][C.side - 1] || '').trim(),
      household: String(rows[i][C.household - 1] || '').trim() || name,
      table: String(rows[i][C.table - 1] || '').trim(),
      seats: parseInt(rows[i][C.seats - 1], 10) || 1,
      status: normStatus_(rows[i][C.status - 1]),
      replied: String(rows[i][C.replied - 1] || '').trim(),
      note: String(rows[i][C.note - 1] || '').trim()
    });
  }

  return {
    ready: true,
    guests: guests,
    tables: readTables_(ss, guests),
    replies: readReplies_(ss),
    sides: uniq_(guests.map(function (g) { return g.side; }).filter(String))
  };
}

/** Coming / No reply / Cannot come, however the sheet happens to spell it. */
function normStatus_(v) {
  var s = String(v || '').trim().toLowerCase();
  if (!s || s === 'pending') return 'No reply';
  if (s === 'yes' || s === 'coming' || s === 'confirmed') return 'Coming';
  if (s === 'no' || s === 'declined' || s.indexOf('cannot') === 0) return 'Cannot come';
  return 'No reply';
}

/**
 * Capacities, kept in their own tab so a table can be bigger than the number
 * of people currently at it. A table nobody has sized yet is assumed to hold
 * DEFAULT_CAPACITY, or everyone already seated there if that is more.
 */
function readTables_(ss, guests) {
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

function readReplies_(ss) {
  var sheet = ss.getSheetByName(RSVP_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var values = sheet.getDataRange().getValues();
  var head = values[0].map(function (h) { return String(h || '').trim().toLowerCase(); });
  var iWhen = head.indexOf('received (manila)'), iName = head.indexOf('name'),
      iAtt = head.indexOf('attending'), iCount = head.indexOf('guests'),
      iParty = head.indexOf('who is coming'), iNote = head.indexOf('note');

  var out = [];
  for (var r = values.length - 1; r >= 1 && out.length < 60; r--) {
    var n = String(values[r][iName] || '').trim();
    if (!n) continue;
    out.push({
      when: iWhen > -1 ? String(values[r][iWhen] || '') : '',
      name: n,
      attending: iAtt > -1 ? String(values[r][iAtt] || '') : '',
      count: iCount > -1 ? String(values[r][iCount] || '') : '',
      party: iParty > -1 ? String(values[r][iParty] || '') : '',
      note: iNote > -1 ? String(values[r][iNote] || '') : ''
    });
  }
  return out;
}

/** The sides as the sheet actually spells them, each one once, in the order
 *  they first appear, so the filter offers exactly what is there. */
function uniq_(list) {
  var seen = {}, out = [];
  for (var i = 0; i < list.length; i++) {
    var v = String(list[i]).trim();
    if (!v || seen[v]) continue;
    seen[v] = true;
    out.push(v);
  }
  return out;
}

/* ------------------------------------------------------------------- write */

/** One guest, by the row they came from. */
function saveGuest(g) {
  return guarded_(function () {
    var sheet = book_().getSheetByName(GUESTS_SHEET);
    sheet.getRange(g.row, 1, 1, WIDTH).setValues([[
      g.name, g.side, g.household || g.name,
      g.table === UNSEATED ? '' : g.table,
      parseInt(g.seats, 10) || 1,
      g.status, g.replied || '', g.note || ''
    ]]);
    return getAll();
  });
}

function addGuest(g) {
  return guarded_(function () {
    var sheet = book_().getSheetByName(GUESTS_SHEET);
    sheet.appendRow([
      g.name, g.side || '', g.household || g.name,
      g.table === UNSEATED ? '' : (g.table || ''),
      parseInt(g.seats, 10) || 1,
      g.status || 'No reply', '', ''
    ]);
    return getAll();
  });
}

function removeGuest(row) {
  return guarded_(function () {
    book_().getSheetByName(GUESTS_SHEET).deleteRow(row);
    return getAll();
  });
}

/**
 * Several guests at once. Rows are deleted from the bottom up so that
 * removing one does not shift the next one out from under us.
 */
function bulk(rows, field, value) {
  return guarded_(function () {
    var sheet = book_().getSheetByName(GUESTS_SHEET);
    if (field === 'remove') {
      rows.slice().sort(function (a, b) { return b - a; })
        .forEach(function (r) { sheet.deleteRow(r); });
      return getAll();
    }
    var col = field === 'table' ? C.table : field === 'status' ? C.status :
              field === 'side' ? C.side : 0;
    if (!col) return getAll();
    var v = (field === 'table' && value === UNSEATED) ? '' : value;
    rows.forEach(function (r) { sheet.getRange(r, col).setValue(v); });
    return getAll();
  });
}

function setCapacity(name, capacity) {
  return guarded_(function () {
    var ss = book_();
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
        return getAll();
      }
    }
    sheet.appendRow([name, capacity]);
    return getAll();
  });
}

function renameTable(from, to) {
  return guarded_(function () {
    var ss = book_();
    var sheet = ss.getSheetByName(GUESTS_SHEET);
    var last = sheet.getLastRow();
    if (last > 1) {
      var col = sheet.getRange(2, C.table, last - 1, 1);
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
    return getAll();
  });
}

