# The guest list manager

**chanelsonwedding.online/manage.html** — passcode, then the list. It is a page
on your own site, in your own fonts and colours, not a Google page. Its tabs:
Guests, Tables, Replies, Needs attention, and the Checklist.

The wedding site's home screen has a **Guest list & checklist** button under
the menu, but only in a browser that has signed in here before. Guests never
see it, so there is no door for two hundred of them to notice and push on. On
a new phone or computer, type the address once; from then on the button is
there, even after *Sign out*.

---

## How it fits together

```
manage.html            the screen. A static file on Hostinger, like the rest
   │                   of the site. Holds no data and no passcode.
   │  POST op=…
   ▼
RSVP Apps Script       the only thing that touches the sheet. Checks the
   │                   passcode, hands out tokens, reads and writes GUESTS
   │                   and CHECKLIST.
   ▼
Vicencio-Reyes Wedding Plan
   GUESTS              one row per guest — the manager's own tab
   TABLES              table sizes, made the first time one is set
   CHECKLIST           the Checklist tab, made the first time it is opened
   GUEST LIST          the seating chart. Read only, never written
   Website RSVP        replies as they arrive
```

The same endpoint already receives your guests' RSVPs, so the manager adds no
new moving parts — one script, one deployment, one sheet.

---

## The passcode

It is not written in any file here. **This repository is public**, so anything
in it can be read by anyone, and `manage.html` is public too (Ctrl+U). The
passcode lives in the Apps Script project instead:

Spreadsheet → Extensions → Apps Script → **Project Settings** (the gear) →
**Script Properties** → *Add script property* → Property `ADMIN_CODE`, Value
your passcode → Save.

Until it is set the door stays shut, and the page says "No passcode is set up
yet." The passcode used before November 2026 was written in this repository
and is still in its history, so it must never be used again.

`SESSION_DAYS` near the top of `rsvp-apps-script.gs` sets how long a sign-in
lasts.

Typed once per device. The server then issues a 64-character token that the
browser keeps for a month, and that token is what every later request carries.
That is what lets the code be long without being a nuisance.

**Changing it:** edit the `ADMIN_CODE` property. That alone signs everyone out,
on every device, at once, with no redeploy: each sign-in is stamped with the
passcode it was made under, and a stamp that no longer matches is refused.
*Sign out* in the top right signs out just the one device.

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
`syncRoster()` does the same for `CONFIRMED GUESTS`, carrying every answer
across by name.

Both rewrite their tab in place and leave no copy beside it. They used to
leave one each time, as "GUESTS before 10-28 23:34" and the like; any of those
still in the sheet are old snapshots nothing reads, and can be deleted. To undo
a run, use **File → Version history** in the sheet.

Last run: 196 guests, 174 households, 18 tables.

---

## The checklist

The **Checklist** tab is the coordinator's Big Day Ezzentials list by section
(Bride, Groom, Church, Reception). Tick an item when it is done; the pencil
edits it, adds a note (who has it, what it cost, when it arrives) or removes
it; *+ Add to …* adds one to that section. `manage.html#checklist` opens
straight onto it, and the manager reopens on whichever tab you used last.

It is kept in a `CHECKLIST` tab of the spreadsheet, one row per item:

| Section | Item | Status | Note |
| ------- | ---- | ------ | ---- |

Status is `OK` when done and blank when not. The script makes the tab and
fills it from `CHECK_SEED` the first time the checklist is opened, so there is
nothing to run. After that the sheet is the list: change it there or on the
website and each shows the other's changes. Deleting the whole tab starts it
over from `CHECK_SEED`.

It sits behind the same passcode as the guest list, and none of it is in
`manage.html`.

---

## If something breaks

| What you see                               | What it means                                |
| ------------------------------------------ | -------------------------------------------- |
| "That passcode did not work."              | wrong code, or the script was not redeployed  |
| "No passcode is set up yet."               | no `ADMIN_CODE` script property — see above   |
| "Too many tries. Wait N minutes."          | the lockout; it clears itself                 |
| "That sign-in has expired."                | token older than 30 days, or the code changed |
| "Could not reach the guest list."          | the endpoint is down — load it in a browser   |
| The page sits on "Loading…"                | a server-side error — see below               |
| "The checklist needs the updated script"   | paste the new script in and redeploy          |

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
