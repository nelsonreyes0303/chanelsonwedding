# The guest list manager

**Live since 19 October 2026.** Set up and working; this is the reference for
how it is wired and how to change it.

To open it: **chanelsonwedding.online/#/rsvp** → *Manage the guest list* →
passcode **123234** → *Open the guest list*. Google then checks it is you.

---

## The two projects

They are different things that happen to share a default filename, `Code.gs`.
Telling them apart is the whole trick.

|                      | **RSVP (website endpoint)**            | **Guest List Manager**             |
| -------------------- | -------------------------------------- | ---------------------------------- |
| Opens from           | the spreadsheet → Extensions → Apps Script | script.google.com → your list  |
| Bound to the sheet?  | yes (uses `getActiveSpreadsheet`)      | no (uses `SHEET_ID` + `openById`)  |
| `Code.gs` holds      | `rsvp-apps-script.gs`                  | `admin-apps-script.gs`             |
| Also holds           | nothing                                | an HTML file named `ui`            |
| Functions you'll see | `doPost`, `syncRoster`, `buildGuests`  | `getAll`, `saveGuest`, `addGuest`  |
| Deployed to          | Anyone (guests must reach it)          | **Only myself** — never Anyone     |
| Owned by             | Chanel (Nelson is an editor)           | Nelson                             |

If the function dropdown shows the wrong names for the project you think you
are in, stop — you have the wrong window open.

The RSVP script **cannot** run as a standalone project: it calls
`SpreadsheetApp.getActiveSpreadsheet()`, which returns null outside the sheet.

---

## Where the passcode lives

In `rsvp-apps-script.gs`, not in `index.html`:

```js
var ADMIN_CODE    = '123234';
var ADMIN_APP_URL = '...';   // the manager's deployed web-app URL
```

The website posts what was typed to the RSVP endpoint and gets the manager's
address back only when it matches. Neither value is in the public page, and a
wrong code waits a second and a half before saying no.

**What this does and does not do.** It keeps the door off the page for two
hundred guests. It is not the lock. The lock is that the manager is deployed
**Only myself**, so Google refuses anyone who is not Nelson or Chanel even
with the URL in hand.

---

## Changing things

**The passcode** — edit `ADMIN_CODE` in the RSVP project, then redeploy it
(below). Nothing on the website changes.

**Redeploying either project** — Deploy → **Manage** deployments → pencil →
Version: **New version** → Deploy. Never *New deployment*: that mints a
different URL, and for the RSVP project that silently kills the live form.

The RSVP project has several deployments and the dialog does not preselect the
live one. The live one is the deployment whose id matches `RSVP_ENDPOINT` in
`index.html` — check before clicking the pencil.

**A saved edit does nothing on its own.** The live URL keeps serving the last
deployed version until you cut a new one.

**Giving Chanel access** — in the Guest List Manager project, Share (top
right) → add her Google account as Editor. Same URL, same passcode.

---

## Refreshing the data

The manager reads a `GUESTS` tab, which `buildGuests()` in the RSVP project
builds from the `GUEST LIST` seating chart. Run it again (function dropdown →
`buildGuests` → Run) whenever the chart changes. It never writes to
`GUEST LIST`, so the seating plan cannot be disturbed.

Last run wrote 196 guests across 174 households: 77 coming, 119 awaiting
reply.

---

## If something breaks

| What you see                                | What it means                                   |
| ------------------------------------------- | ----------------------------------------------- |
| "That passcode did not work."               | the RSVP project was edited but not redeployed  |
| "The guest list manager is not set up yet." | `ADMIN_APP_URL` is empty                        |
| "Could not reach the guest list just now."  | the RSVP endpoint is down                       |
| The manager sits on "Loading…" forever      | a server-side error — see below                 |

The manager's page cannot see server-side errors; its failure handler never
fires for them. Look in the Guest List Manager project → the **Executions**
icon in the left rail → expand the failed row. That is where
`ReferenceError: uniq_ is not defined` turned up.

---

## Pasting code into Apps Script

Use a UTF-8-safe clipboard. On Windows, `clip.exe` reads its input as the ANSI
codepage and turns every em-dash into `ΓÇö`, every `·` into mojibake, and —
worse — corrupts the combining-diacritic range in `norm_()`, which is what
makes "Peña" match "Pena". Use PowerShell instead:

```powershell
Set-Clipboard -Value (Get-Content -Raw -Encoding UTF8 'path\to\file')
```
