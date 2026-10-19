# Turning on the guest list manager

Follow this top to bottom. Nothing here can break the live website as long as
you do not redeploy the RSVP project until Part D.

There are **two** Apps Script projects. They are different things that happen
to share a default filename, `Code.gs`. Telling them apart is the whole trick:

|                     | **RSVP project**                       | **Admin project**                  |
| ------------------- | -------------------------------------- | ---------------------------------- |
| Exists already?     | Yes, live for weeks                    | No, you create it in Part B        |
| How to open it      | Spreadsheet → Extensions → Apps Script | script.google.com → your list      |
| `Code.gs` holds     | `rsvp-apps-script.gs`                  | `admin-apps-script.gs`             |
| Functions you'll see| `doPost`, `syncRoster`, `buildGuests`  | `getAll`, `saveGuest`, `addGuest`  |
| Who may open it     | Anyone (guests must reach it)          | Only myself (never Anyone)         |

If the function dropdown shows the wrong names for the project you think you
are in, stop — you have the wrong window open.

---

## Part A — Put the RSVP project back

You pasted admin code over this project. The live site is unaffected, because
Apps Script serves the last *deployed* version rather than whatever is in the
editor. This puts the editor back in step with the repo.

1. Open your wedding spreadsheet.
2. **Extensions → Apps Script.**
3. Click into `Code.gs`, select all (Ctrl+A), delete.
4. Open `rsvp-apps-script.gs` from this repo, select all, copy, paste it in.
5. Ctrl+S to save.
6. **Check:** the function dropdown at the top now lists `buildGuests`.
   If it does not, the paste did not take.

Do **not** deploy anything yet.

---

## Part B — Create the admin project

7. Go to **script.google.com**.
8. Click **New project** (top left).
9. **Check:** the editor shows only this, and nothing else —

   ```js
   function myFunction() {
   }
   ```

   If there is wedding code in there, you have opened an existing project.
   Back out and click New project again.

10. Select all, delete, and paste the whole of `admin-apps-script.gs`.
11. Click the words **Untitled project** at the top and rename it
    **Guest List Manager**.

---

## Part C — Finish the admin project

### C1. Point it at your spreadsheet

12. Open your spreadsheet in another tab and look at its address bar:

    ```
    https://docs.google.com/spreadsheets/d/1AbC...XyZ/edit#gid=0
                                          └──── copy this ────┘
    ```

    Copy the long string between `/d/` and `/edit`.

13. Back in the admin project, **line 24** reads:

    ```js
    var SHEET_ID = 'PUT_YOUR_SPREADSHEET_ID_HERE';
    ```

    Replace the placeholder, keeping the quotes:

    ```js
    var SHEET_ID = '1AbC...XyZ';
    ```

### C2. Add the screen

14. In the **Files** panel on the left, click **+** → **HTML**.
15. Name it exactly **`ui`** — lowercase, no `.html`. Apps Script adds the
    extension itself. The name must match, because the script asks for the
    file by that name.
16. Select all of the placeholder markup it created, delete it, and paste the
    whole of `admin-ui.html` from this repo.
17. Ctrl+S.

### C3. Deploy it

18. **Deploy → New deployment.**
19. Click the gear beside "Select type" → **Web app**.
20. Set:
    - Description: anything, e.g. *first*
    - Execute as: **Me**
    - Who has access: **Only myself** ← never Anyone
21. **Deploy.**
22. Google will ask for authorisation. Go through
    **Advanced → Go to Guest List Manager (unsafe)** → **Allow**.
    That warning only means the script is unpublished and yours.
23. Copy the **Web app URL** it shows you. It looks like

    ```
    https://script.google.com/macros/s/AKfy............/exec
    ```

    **This is the admin app URL.** Paste it somewhere safe for a moment.

24. **Check:** open that URL in a new tab. The guest list manager should load.
    If it says the guest list is not ready, that is expected until Part D
    step 27 — the `GUESTS` tab does not exist yet.

---

## Part D — Join the two up

Back in the **RSVP project** (spreadsheet → Extensions → Apps Script).

25. **Line 30** reads:

    ```js
    var ADMIN_APP_URL = '';
    ```

    Paste the URL from step 23 between the quotes:

    ```js
    var ADMIN_APP_URL = 'https://script.google.com/macros/s/AKfy............/exec';
    ```

26. Ctrl+S.
27. Pick **`buildGuests`** from the function dropdown and click **Run**. This
    builds the `GUESTS` tab from your seating chart. It is safe to run again
    later; it never writes to `GUEST LIST`.
28. **Deploy → Manage deployments** — *Manage*, not New deployment. A new
    deployment would mint a different URL and your website would stop
    receiving RSVPs.
29. Click the **pencil** icon on the existing deployment.
30. Version: **New version**. Then **Deploy**.

---

## Part E — Try it

31. Go to **chanelsonwedding.online/#/rsvp**.
32. Hard-refresh: **Ctrl+Shift+R**.
33. Click **Manage the guest list** under the RSVP card.
34. Type **123234** and press Enter.
35. **Open the guest list** appears. Click it.

### If it does not work

| What you see                             | What it means                               |
| ---------------------------------------- | ------------------------------------------- |
| "That passcode did not work."            | Part D step 30 was skipped — not redeployed |
| "The guest list manager is not set up yet." | Line 30 is still empty, or step 30 skipped |
| "Could not reach the guest list just now." | The RSVP endpoint is down — check it loads  |
| Nothing happens at all                   | Hard-refresh again; old page is cached      |

---

## Afterwards

- **Delete the blank rows** in the `Website RSVP` tab. Each passcode attempt
  made before Part D was filed as an empty RSVP by the old code.
- **Add Chanel:** in the admin project, **Share** (top right) → add her Google
  account as Editor. She uses the same URL and the same passcode.
- **Changing the passcode later:** edit `ADMIN_CODE` on line 29 of the RSVP
  project, then redo steps 28–30. Nothing on the website changes — the code is
  never written into `index.html`.

## What the passcode does and does not do

It keeps the door off the page for two hundred guests. It is not the lock. The
lock is that the admin project is deployed **Only myself**, so Google refuses
anyone who is not you or Chanel even if they somehow have the URL. That is why
step 20 matters more than the passcode does.
