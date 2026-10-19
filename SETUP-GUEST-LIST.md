# The guest list manager

**chanelsonwedding.online/manage.html** — passcode, then the list. It is a page
on your own site, in your own fonts and colours, not a Google page.

Bookmark it. Nothing on the public site links to it, on purpose: there is no
door for two hundred guests to notice and push on.

---

## How it fits together

```
manage.html            the screen. A static file on Hostinger, like the rest
   │                   of the site. Holds no data and no passcode.
   │  POST op=…
   ▼
RSVP Apps Script       the only thing that touches the sheet. Checks the
   │                   passcode, hands out tokens, reads and writes GUESTS.
   ▼
Vicencio-Reyes Wedding Plan
   GUESTS              one row per guest — the manager's own tab
   TABLES              table sizes, made the first time one is set
   GUEST LIST          the seating chart. Read only, never written
   Website RSVP        replies as they arrive
```

The same endpoint already receives your guests' RSVPs, so the manager adds no
new moving parts — one script, one deployment, one sheet.

---

## The passcode

```js
var ADMIN_CODE   = 'chanelson-132611';
var SESSION_DAYS = 30;
```

Both live near the top of `rsvp-apps-script.gs`, not in `manage.html` — that
page is public and anyone can read it with Ctrl+U.

Typed once per device. The server then issues a 64-character token that the
browser keeps for a month, and that token is what every later request carries.
That is what lets the code be long without being a nuisance.

**Changing it:** edit the line, redeploy (below). Everyone signed in anywhere
is signed out by it. *Sign out* in the top right does the same for one device.

**Wrong codes** wait a second and a half before answering, and eight inside a
quarter of an hour stops the door answering at all. The count is shared,
because the endpoint cannot tell who is asking — so a stranger hammering it
locks you out too. A guest list is better unreachable for fifteen minutes than
guessable in an afternoon.

**What this protects.** The passcode is now the whole lock. Before, the manager
was a Google page and Google's sign-in was the lock; moving the screen onto
your own domain is what traded that away. Worth knowing rather than
discovering: anyone with the passcode has the guest list.

---

## Redeploying

Spreadsheet → Extensions → Apps Script → **Deploy → Manage deployments** →
pencil → Version: **New version** → Deploy.

Never *New deployment*: that mints a different URL, and the live form and the
manager both stop working.

**The dialog does not reliably preselect the live deployment.** There are
several. The live one is the deployment whose id matches `RSVP_ENDPOINT` in
`index.html` and `ENDPOINT` in `manage.html`. Check before clicking the pencil.

**A saved edit does nothing on its own** — the URL keeps serving the last
deployed version until you cut a new one.

---

## Refreshing the data

`buildGuests()` fills the `GUESTS` tab from the `GUEST LIST` seating chart.
Run it again (function dropdown → `buildGuests` → Run) whenever the chart
changes. It never writes to `GUEST LIST`, so the seating plan is safe.

Last run: 196 guests, 174 households, 18 tables.

---

## If something breaks

| What you see                               | What it means                                |
| ------------------------------------------ | -------------------------------------------- |
| "That passcode did not work."              | wrong code, or the script was not redeployed  |
| "Too many tries. Wait N minutes."          | the lockout; it clears itself                 |
| "That sign-in has expired."                | token older than 30 days, or the code changed |
| "Could not reach the guest list."          | the endpoint is down — load it in a browser   |
| The page sits on "Loading…"                | a server-side error — see below               |

A server-side error is invisible to the page; its failure handler never fires
for one. Look in the Apps Script project → the **Executions** icon in the left
rail → expand the failed row. That is where `ReferenceError: uniq_ is not
defined` turned up.

---

## Pasting code into Apps Script

Use a UTF-8-safe clipboard. On Windows `clip.exe` reads its input as the ANSI
codepage: every em-dash becomes `ΓÇö`, every `·` turns to mojibake, and — worse
— it corrupts the combining-diacritic range in `norm_()`, which is what makes
"Peña" match a guest typing "Pena". Use PowerShell:

```powershell
Set-Clipboard -Value (Get-Content -Raw -Encoding UTF8 'path\to\file')
```

---

## Still lying around

`admin-apps-script.gs` and `admin-ui.html` are the earlier Google-hosted
version, and the **Guest List Manager** Apps Script project that serves them
is still deployed. It works, and it is Google-locked, so it makes a fallback —
but it is a second codepath writing the same sheet. Delete the project and
those two files when you are happy with this one.
