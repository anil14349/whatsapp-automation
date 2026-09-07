# ABC Clinic WhatsApp Automation

Google Apps Script project for ABC Clinic appointment booking over WhatsApp, backed by Google Sheets and Google Calendar. **This is the current production system** — everything below (Option A/B, deployment steps, Script Properties) describes it.

---

## `clinic-app/` — in-progress Next.js + Supabase rewrite

This branch (`rewrite/supabase-backend`) also contains a ground-up rewrite of this same bot onto Next.js + Postgres (Supabase), plus a new receptionist/admin web UI that has no equivalent in the Apps Script version. It is **not yet a replacement for the production system above** — several WhatsApp flows (cancel/reschedule, doctor portal, home collection, reminders) aren't ported yet, and it hasn't been run against a real Supabase project or WhatsApp number. See [`clinic-app/README.md`](clinic-app/README.md) for full details, what's covered vs. deferred, and setup instructions.

---

## Apps Script files

There are two equivalent ways to source the production code — pick **one**, don't bind both:

### Option A — single file (original)

| File | Bind in production? | Purpose |
|------|---------------------|---------|
| `ABC_Clinic_WhatsApp_Complete.gs` | **Required** | Production code (webhook, booking, doctor portal) |
| `ABC_Clinic_Tests.gs` | Optional | Test helpers — bind for dev/staging; safe to leave bound |

### Option B — `src/` split (recommended)

The same code, reorganized into 23 smaller files by responsibility (Model/View/Controller-style). Apps Script merges every bound `.gs` file into one shared global scope regardless of file name or count, so this is behaviorally identical to Option A — just easier to navigate. Bind **every file in `src/`** (all 23) plus, optionally, `ABC_Clinic_Tests.gs`:

| File | Purpose |
|------|---------|
| `src/Config.gs` | Constants, Settings sheet, debug/log-mode flags |
| `src/Util_Common.gs` | Phone/date/time parsing & formatting helpers |
| `src/Logging.gs` | Single `WhatsApp_Log` sheet (inbound/errors/reminder ledger), retention cleanup |
| `src/Model_Reminders.gs` | Appointment reminder scheduling & sending |
| `src/Model_AppointmentStatus.gs` | Completed/No-Show status workflow, auto-complete |
| `src/Model_AfterHours.gs` | Clinic-hours gate & after-hours auto-reply |
| `src/Model_Doctors.gs` | Doctor records, availability, leaves, schedule views |
| `src/Model_Calendar.gs` | Calendar event lookup & slot-availability engine |
| `src/Model_Patients.gs` | Patients registry (find/upsert/sync) |
| `src/Model_Appointments.gs` | Book/cancel/reschedule, appointment lookups |
| `src/Model_HomeCollection.gs` | `Home_Collection_Requests` sheet — home blood-sample-collection requests |
| `src/Model_Session.gs` | `WhatsApp_Sessions` sheet read/write |
| `src/Setup.gs` | `initializeWhatsAppBotSheets()` — one-time creation of every required sheet |
| `src/Api.gs` | `api()` HTTP-style dispatcher for external callers |
| `src/Webhook.gs` | `doGet`/`doPost` entry points, inbound idempotency |
| `src/View_Menus.gs` | Interactive list/button menu specs |
| `src/View_Messages.gs` | WhatsApp reply text builders & localization |
| `src/Controller_Shared.gs` | Flow helpers shared by patient & doctor state machines |
| `src/Controller_Router.gs` | Top-level message dispatch (greeting/navigation/router) |
| `src/Controller_DoctorFlow.gs` | Doctor-portal conversation state machine |
| `src/Controller_PatientFlow.gs` | Patient conversation state machine |
| `src/Controller_HomeCollection.gs` | Home blood-sample-collection request flow (location-gated by radius) |
| `src/WhatsApp_Send.gs` | Low-level WhatsApp Cloud API senders |

Every function/variable name is still globally unique across all files (Apps Script requirement) — kept in sync automatically by `scripts/sync-monolith-from-src.js` (`node scripts/sync-monolith-from-src.js --check` reports drift between Option A and Option B without writing).

Don't bind both options at once — that would double-declare every function.

---

## Script Properties

### Required

| Property | Purpose |
|----------|---------|
| `WHATSAPP_ACCESS_TOKEN` | Meta Graph API token for sending messages |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp Business phone number ID |
| `WHATSAPP_VERIFY_TOKEN` | Webhook GET verification — **must be set**; there is no hardcoded fallback. If unset, `doGet` rejects the Meta verification handshake (fails closed). |
| `WHATSAPP_WEBHOOK_POST_TOKEN` | POST webhook lock via `?token=...` — **must be set**; if unset, `doPost` rejects all inbound requests (fails closed). |

### Optional

| Property | Purpose |
|----------|---------|
| `DEBUG_MODE` | Enables debug logging and test/admin functions |
| `TEST_SKIP_WHATSAPP_SEND` | With `DEBUG_MODE`, skips real WhatsApp sends during tests |

---

## Implemented on `refactor/whatsapp-v2`

### Core

- WhatsApp webhook (`doGet` / `doPost`) with idempotency and outbound dedup
- Patient flows: book, cancel, reschedule, language (EN / TE / HI / KA / TA / ML)
- Doctor flows: schedule views (options 1–4) + self-service portal (options 5–10)
- Google Sheets + Calendar booking with locking and rollback on reschedule failure

### Patients registry

- Auto-created `Patients` sheet; `BOOK_NAME` for first-time bookers
- Name from appointment history; language sync on select/change and Hi greeting
- Patient ID on Appointments column 9; session column 10 for booking name
- One-time backfill: `syncPatientsFromAppointments()` (admin; requires `DEBUG_MODE=true`)

### Doctor portal (WhatsApp options 5–10)

| Option | Feature | Sheet |
|--------|---------|-------|
| 5 | Manage Availability — multiple sessions per weekday | `Availability` |
| 6 | Manage Leaves — single day or date range | `Doctor_Leaves` |
| 7 | My Patients — unique patients from history | `Appointments` |
| 8 | Cancel Patient Appointment — cancel on behalf of patient | `Appointments` + Calendar |
| 9 | Reschedule Patient Appointment — move to new slot | `Appointments` + Calendar |
| 10 | Mark Visit Status — mark **Completed** or **No-Show** | `Appointments` |

Navigation: `0` → Doctor Portal · `9` → back one step (`goBackInDoctorWhatsAppFlow`)

When a doctor cancels or reschedules, the **patient is notified** via WhatsApp automatically.

### Interactive WhatsApp menus

- Tap-to-select **list** and **button** menus (Meta interactive messages) — no need to type `1`, `2`, `3` for most steps
- **Patient:** language, main menu, doctor picker, date (Today / Tomorrow / Other), time slots, booking confirm, cancel/reschedule pickers, yes/no confirms
- **Doctor:** portal menu (10 options), weekday availability, day actions, leaves, appointment pickers, status (Completed / No-Show), confirm/cancel dialogs
- **Free-text steps** (not menus): custom date (`YYYY-MM-DD`), patient name, availability times, leave reason
- **Navigation:** users can still type `0` (main menu / doctor portal) and `9` (back one step)
- Toggle via **`Settings`** → `ENABLE_INTERACTIVE_MENUS` (`TRUE` / `FALSE`, default `TRUE`)
- Falls back to **numbered text** only when menus are disabled, the Meta API fails, or a list cannot be built
- **UI copy:** short contextual message bodies (no duplicated numbered menus in interactive text) — *text explains, interactive controls act*

#### Meta limits & pagination

WhatsApp allows **at most 10 rows** per list menu and **3 reply buttons** per message. Every list menu (time slots, appointment pickers, doctor selection, doctor leave/session lists) reserves one of those 10 rows for a persistent **Main Menu / Doctor Portal** nav row, so real content is capped at 9 items per screen.

| Flow | Behavior when > limit |
|------|------------------------|
| **Time slots** | **Paginated** — tap **More times** / **Earlier times** (page tracked in `WhatsApp_Sessions` → **Appointment Page**/**Slot Page** columns, auto-created) |
| **Appointment pickers** (my appointments/cancel/reschedule, doctor-side too) | **Paginated** the same way as time slots |
| **Doctor portal** | 3-button screens, tiered behind a **More** button (options 1–10 spread across 4 tiers) |
| **Language** | 6 languages in one list (under limit) |
| **Doctor selection / session-remove lists** | **Paginated** the same way as time slots (`WhatsApp_Sessions` → **List Page** column) |

Typed numbers still work everywhere as a backup (including global slot numbers across pages).

### Home sample collection

Patient main menu → **More** → **Home Sample Collection**:

1. Patient shares their location via WhatsApp's native **Location** attachment (typed addresses aren't accepted — there's no geocoding step).
2. The bot computes the great-circle distance to `HOSPITAL_LATITUDE`/`HOSPITAL_LONGITUDE` (`haversineDistanceKm`) and rejects requests beyond `HOME_COLLECTION_RADIUS_KM` (default 5 km).
3. Within range, the patient picks a preferred date (Today / Tomorrow / Other) and a time window (Morning / Afternoon / Evening) — no slot inventory to manage.
4. A row is saved to `Home_Collection_Requests` (`Pending` status); a staff member follows up by phone to confirm the exact visit time.

The feature stays hidden (replies "isn't set up yet") until both `HOSPITAL_LATITUDE` and `HOSPITAL_LONGITUDE` are configured in `Settings`.

### Refactor / reliability

- Shared helpers: date menu, slot picker, appointment list picker
- Router split: `handleWhatsAppGreeting`, `handleWhatsAppUniversalNavigation`, `handleWhatsAppDoctorMessage`, `handleWhatsAppPatientMessage`, thin `processWhatsAppTextMessage`
- `registerPatientForBooking` inside booking lock; normalized reschedule rollback sheet writes
- Phone/date matching fixes; shared `findCalendarEventForAppointment()`

### Localization

- 6 languages: **English, Telugu (TE), Hindi (HI), Kannada (KA), Tamil (TA), Malayalam (ML)** via `localizeWhatsAppReply` in `View_Messages.gs`
- Patient-facing **message bodies** localize (main menu, booking flow, confirmations, custom date prompt, slot pagination text, menu fallback text when interactive fails)
- Appointment reminder messages localized in all 6 languages
- Language picker is a tap-to-select **list menu** (not buttons — 6 options exceeds WhatsApp's 3-button limit)
- **Interactive list/button titles** (e.g. Today, Confirm, Other time) remain **English** — Meta sends these as-is; only the message body is translated
- Doctor portal and many error strings remain **English only** (by design)
- ⚠️ **KA/TA/ML translations are an initial AI-assisted pass**, not yet reviewed by a native speaker — verify against real clinic usage before relying on them in production. TE/HI predate this and have been in production use.
- Smoke test: `testLocalizationUiCleanup()` (TE/HI markers for cleanup copy)

### Appointment reminders

- Configurable from **`Settings`** sheet (`ENABLE_APPOINTMENT_REMINDERS`, `REMINDER_HOURS_BEFORE`, `REMINDER_WINDOW_MINUTES`)
- Reminders are sent to **patients** only (not doctors)
- Every-30-minutes trigger via `installAppointmentReminderTrigger()`; manual run via `sendAppointmentReminders()`
- Dedup via `REMINDER` rows in the consolidated **`WhatsApp_Log`** sheet

### Doctor cancel / reschedule for patients

- Doctor Portal **option 8** — cancel a confirmed patient appointment
- Doctor Portal **option 9** — reschedule to a new date/slot
- Updates **`Appointments`** sheet + Google Calendar (same as patient self-service)
- Patient receives an automatic WhatsApp notification when doctor cancels or reschedules

### Appointment status (Completed / No-Show)

- Doctor Portal **option 10** — mark a confirmed appointment as **Completed** or **No-Show**
- Only appointments whose start time has passed (plus a 15-minute grace) appear in the picker
- **Completed** and **No-Show** appointments are hidden from schedule views and excluded from reminders
- Cancel/reschedule is blocked for appointments already marked Completed or No-Show
- Optional auto-close: set `AUTO_COMPLETE_PAST_APPOINTMENTS` to `TRUE` in **`Settings`**, then run `installAutoCompletePastAppointmentsTrigger()` — confirmed appointments auto-mark **Completed** after `AUTO_COMPLETE_HOURS_AFTER` (default 4 hours)

### Reliability & security hardening (latest)

- Fixed a state-machine fallthrough bug where several doctor-portal states (availability, leave management) and the patient `BOOK_DOCTOR` step didn't `return true`, causing wasted work and occasional duplicate/confusing replies
- `updateAppointmentStatus` now fails closed if called without an `authorizedDoctorId` or matching `patientPhone` — no more implicit unauthenticated status changes
- `getAvailableSlots` fetches each day's Calendar events once instead of once per candidate slot (was a real CalendarApp quota risk), and no longer throws uncaught on Calendar/duration lookup failures
- Webhook verification (`doGet` GET handshake, `doPost` POST token check) now **fails closed** — see the mandatory `WHATSAPP_VERIFY_TOKEN` / `WHATSAPP_WEBHOOK_POST_TOKEN` properties above; the old hardcoded fallback verify token has been removed
- `registerPatientForBooking` no longer skips the patient-registry lock, closing a duplicate-row race on retried/duplicate WhatsApp webhook deliveries
- Doctor availability/leave mutation functions (`addDoctorAvailabilitySession`, `removeDoctorAvailabilitySession`, `clearDoctorDayAvailability`, `addDoctorLeave`, `deactivateDoctorLeave`) now use `LockService`, matching the locking already used for booking/cancel
- `rescheduleAppointment`'s lock now covers the full lookup/authorization/validation path, not just the final write
- `Settings` sheet reads are cached per execution instead of re-reading the whole sheet on every `getSetting()` call

### After-hours / clinic closed reply

- Auto-reply when patients message **outside clinic hours** (disabled by default)
- Configure open/close times and working days from **`Settings`**
- **Doctors bypass** after-hours — Doctor Portal works 24/7
- Patients **mid-booking** (any state other than `MAIN_MENU`) can finish their current flow
- Optional custom message via `AFTER_HOURS_MESSAGE`
- Closed message localized for EN / TE / HI / KA / TA / ML patients

---

## Deployment steps

Follow these in order for a **new install** or when promoting `refactor/whatsapp-v2` to production.

### Before you start

You need:

- A **Google account** with access to Google Sheets and Google Calendar
- A **Meta WhatsApp Business** app with a phone number connected to the Cloud API
- **Graph API credentials:** long-lived `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID`
- A **Google Sheet** that will hold clinic data (create new, or use your existing production sheet)

Bind **either** `ABC_Clinic_WhatsApp_Complete.gs` **or** every file under `src/` (see [Apps Script files](#apps-script-files) above) — not both — plus, optionally, `ABC_Clinic_Tests.gs`. Don't add other `.gs` files with duplicate function names.

---

### Step 1 — Prepare the spreadsheet

1. Create or open the clinic Google Sheet (this becomes the data store).
2. After binding the Apps Script project (Step 2 below), run **`initializeWhatsAppBotSheets()`** once from the Apps Script editor — it creates every required sheet with its header row (`Settings`, `WhatsApp_Log`, `Patients`, `WhatsApp_Sessions`, `Doctors`, `Availability`, `Appointments`, `Doctor_Leaves`, `Home_Collection_Requests`) if it doesn't already exist. Safe to re-run any time. See `src/README.md` for details.
3. Fill in the **`Doctors`** sheet, one row per doctor:

   | Doctor ID | Doctor Name | Clinic | Calendar ID | WhatsApp | AppointmentDuration | Active | Specialization |
   |-----------|-------------|--------|-------------|----------|----------------------|--------|-----------------|

   - **Calendar ID** — from Google Calendar → Settings → Integrate calendar → Calendar ID
   - **WhatsApp** — doctor’s mobile number (with country code, e.g. `919876543210`)
   - **AppointmentDuration** — slot length in minutes (e.g. `30`)
   - **Active** — `YES` to allow this doctor to log into the Doctor Portal via WhatsApp
   - **Specialization** — optional, shown to patients when picking a doctor to book with

4. Fill in an **`Availability`** sheet (or let doctors fill it via WhatsApp Doctor Portal → option 5 later):

   | Doctor ID | Day | Start | End |
   |-----------|-----|-------|-----|

   Example: `D001`, `Monday`, `09:00 AM`, `01:00 PM`

5. `Appointments` fills itself in as bookings come through `bookAppointment()` — no data to pre-populate. `Patients`, `WhatsApp_Sessions`, `WhatsApp_Log`, and `Settings` fill themselves in as the bot runs. On upgrade, `WhatsApp_Sessions` may gain new columns (e.g. **Slot Page**, **Appointment Page**, **Doctor Menu Tier**) automatically the next time a session is saved.

---

### Step 2 — Create the Apps Script project

1. In the spreadsheet: **Extensions → Apps Script**
2. Remove any old/default `Code.gs` content if present (or delete the file).
3. Add the production code — pick one:
   - **Single file:** add **`ABC_Clinic_WhatsApp_Complete.gs`**, copying the full file from this repo into a script file with that name.
   - **Split (`src/`):** add all 23 files from `src/` as separate script files, each with the same name (minus `.gs`, which the editor appends automatically).
4. *(Optional, recommended for staging)* Add **`ABC_Clinic_Tests.gs`** for in-editor smoke tests.
5. **Save** the project (Ctrl+S). Give the project a clear name, e.g. `ABC Clinic WhatsApp`.

---

### Step 3 — Set Script Properties

In Apps Script: **Project Settings** (gear) → **Script properties** → add:

| Property | Required? | Value |
|----------|-----------|-------|
| `WHATSAPP_ACCESS_TOKEN` | **Yes** | Meta Graph API token |
| `WHATSAPP_PHONE_NUMBER_ID` | **Yes** | WhatsApp Business phone number ID |
| `WHATSAPP_VERIFY_TOKEN` | **Yes** | Any secret string you choose (must match Meta webhook setup) |
| `WHATSAPP_WEBHOOK_POST_TOKEN` | **Yes** | Append `?token=YOUR_VALUE` to the webhook URL you give Meta |
| `DEBUG_MODE` | Optional | `true` — enables admin/test functions (disable in production if not needed) |
| `TEST_SKIP_WHATSAPP_SEND` | Optional | `true` — with `DEBUG_MODE`, skips real sends during `runAllTests()` |

`WHATSAPP_VERIFY_TOKEN` and `WHATSAPP_WEBHOOK_POST_TOKEN` are mandatory — there is no hardcoded fallback token. If either is left unset, the webhook fails closed (rejects all requests) rather than silently accepting unauthenticated traffic.

---

### Step 4 — Authorize the script (first run)

1. In the Apps Script editor, select any function (e.g. `doGet`) and click **Run**.
2. Approve the OAuth consent screen when prompted.
3. Grant access to:
   - **Google Sheets** (read/write clinic data)
   - **Google Calendar** (create/update/cancel appointment events)
   - **External requests** (call Meta WhatsApp Graph API)

If authorization fails, ensure you are signed in with the same Google account that owns the spreadsheet and calendars listed in `Doctors`.

---

### Step 5 — Deploy the web app

1. **Deploy → New deployment**
2. Click the gear icon → select type **Web app**
3. Settings:
   - **Description:** e.g. `WhatsApp webhook v1`
   - **Execute as:** **Me** (your Google account)
   - **Who has access:** **Anyone** (Meta must reach the URL without Google login)
4. Click **Deploy** and copy the **Web app URL** — this is your webhook callback URL.

**Important:** After any code change in production, use **Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy**. Editing code alone does not update an existing deployment.

Since `WHATSAPP_WEBHOOK_POST_TOKEN` is required, your callback URL must include it:

```
https://script.google.com/macros/s/...../exec?token=YOUR_POST_TOKEN
```

Without the matching `?token=...`, every inbound webhook POST is rejected.

---

### Step 6 — Configure Meta WhatsApp webhook

In [Meta for Developers](https://developers.facebook.com/) → your app → **WhatsApp → Configuration**:

1. **Callback URL** — paste the Web app URL from Step 5, including the `?token=YOUR_POST_TOKEN` query string.
2. **Verify token** — must exactly match `WHATSAPP_VERIFY_TOKEN` in Script Properties. There is no fallback token — verification fails if the property is unset or mismatched.
3. Click **Verify and save**.
4. Under **Webhook fields**, subscribe to **`messages`** (and any other fields you need).

Send a test message to your WhatsApp Business number. Check the **`WhatsApp_Log`** sheet — a new row should appear within a few seconds.

---

### Step 7 — Configure clinic data

1. Fill in all doctors on the **`Doctors`** sheet (including valid **Calendar ID** and **WhatsApp** number for each).
2. Set weekly hours on **`Availability`**, or have each doctor send **Hi** on WhatsApp and use **Doctor Portal → option 5**.
3. *(Optional)* Pre-load **`Doctor_Leaves`** for known holidays:

   | Doctor ID | Date | Reason | Active |
   |-----------|------|--------|--------|

   Use `TRUE` in **Active** for leave rows that should block booking.

4. Send **Hi** from a doctor’s WhatsApp number — you should see the Doctor Portal menu (options 1–10).
5. Send **Hi** from a patient number — you should see the patient main menu.

---

### Step 8 — Post-deploy configuration

#### Log retention (recommended)

After the first inbound message, a **`Settings`** sheet is created. Adjust as needed:

| Key | Example | Purpose |
|-----|---------|---------|
| `LOG_RETENTION` | `month` | `week`, `month`, `quarter`, `halfyear`, `year`, or `none` |
| `LOG_MAX_ROWS` | `5000` | Row cap after age cleanup |
| `LOG_MESSAGE_MAX_CHARS` | `500` | Truncate long log text |
| `ENABLE_INBOUND_LOG` | `TRUE` | Log to `WhatsApp_Log` |
| `ENABLE_DEBUG_LOG` | `TRUE` | Log outbound send errors to `WhatsApp_Log` (fatal webhook errors and the reminder dedup ledger always write regardless of this setting) |
| `ENABLE_APPOINTMENT_REMINDERS` | `TRUE` | Send WhatsApp reminders before appointments |
| `REMINDER_HOURS_BEFORE` | `24` | Comma-separated hours before appt (e.g. `24,2`) |
| `REMINDER_WINDOW_MINUTES` | `45` | Send window for the every-30-minutes trigger |
| `ENABLE_INTERACTIVE_MENUS` | `TRUE` | Tap-to-select list/button menus (see [Interactive WhatsApp menus](#interactive-whatsapp-menus)) |
| `AUTO_COMPLETE_PAST_APPOINTMENTS` | `FALSE` | Auto-mark past confirmed appointments Completed |
| `AUTO_COMPLETE_HOURS_AFTER` | `4` | Hours after appointment start before auto-complete |
| `ENABLE_AFTER_HOURS_REPLY` | `FALSE` | Auto-reply when patients message outside clinic hours |
| `CLINIC_OPEN_TIME` | `09:00` | Clinic opens (24h or 12h format) |
| `CLINIC_CLOSE_TIME` | `18:00` | Clinic closes |
| `CLINIC_WORKING_DAYS` | `Mon,Tue,Wed,Thu,Fri,Sat` | Days the clinic accepts patient messages |
| `AFTER_HOURS_MESSAGE` | *(empty)* | Optional custom closed message (overrides default) |
| `HOSPITAL_LATITUDE` / `HOSPITAL_LONGITUDE` | *(empty)* | Hospital coordinates for the home sample-collection radius check — the feature stays hidden behind a "not set up yet" message until both are set |
| `HOME_COLLECTION_RADIUS_KM` | `5` | Max distance (km) from the hospital a patient can be to request home sample collection |

Optional scheduled jobs (run once in Apps Script editor):

```javascript
installDailyLogCleanupTrigger()       // log cleanup at 3 AM daily
installAppointmentReminderTrigger()   // check reminders every 30 minutes
installAutoCompletePastAppointmentsTrigger() // auto-complete at 11 PM daily (if enabled)
sendAppointmentReminders()            // manual reminder run (also used by trigger)
autoCompletePastAppointments()        // manual auto-complete run
cleanupAllWhatsAppLogs()              // manual log cleanup
```

#### Upgrading from an older version

If you already have appointments but no **`Patients`** registry, run once (requires `DEBUG_MODE=true`):

```javascript
syncPatientsFromAppointments()
```

---

### Step 9 — Verify deployment

#### Automated smoke tests (staging / optional)

Set Script Properties: `DEBUG_MODE=true`, `TEST_SKIP_WHATSAPP_SEND=true`, then run:

```javascript
runAllTests()
```

Review failures — some legacy tests touch live sheets/calendar; run on a copy of production data if unsure.

#### Manual WhatsApp checklist

| Actor | Action | Expected |
|-------|--------|----------|
| Patient | Send `Hi` | Main menu (tap-to-select list); language prompt if first time |
| Patient | Book appointment | Tappable doctor → date → slot menus; confirm with buttons; row in `Appointments`; calendar event |
| Patient | Book on a busy day (>9 slots) | Slot list shows **More times** / **Earlier times** pages |
| Patient | Cancel | Appointment status updated; calendar event removed |
| Patient | Reschedule | New slot saved; calendar updated |
| Doctor | Send `Hi` | Doctor Portal menu (tap-to-select list) |
| Doctor | Options 1–4 | Schedule views work |
| Doctor | Option 5 | Add/remove availability sessions (tappable day + action menus) |
| Doctor | Option 6 | Add single-day or range leave (tappable leave menu) |
| Doctor | Option 7 | Patient list from history |
| Doctor | Option 8 | Cancel a patient appointment |
| Doctor | Option 9 | Reschedule a patient appointment |
| Doctor | Option 10 | Mark appointment Completed or No-Show |
| Patient | Send `Hi` outside hours (with after-hours enabled) | Closed message with clinic hours |
| Patient | Mid-booking outside hours | Flow continues until complete |
| Doctor | Send `Hi` outside hours | Doctor Portal still works |

Confirm **`WhatsApp_Log`** receives `INBOUND` rows for each message (and `OUTBOUND`/`WEBHOOK` rows if anything errors).

---

### Step 10 — Updating production later

When you pull new code from this repo:

1. Copy the updated file(s) into Apps Script (overwrite existing files) — either `ABC_Clinic_WhatsApp_Complete.gs`, or every changed file under `src/` if you're on the split layout.
2. **If you maintain both Option A and Option B**, run `node scripts/sync-monolith-from-src.js` from the repo after editing any `src/*.gs` file, then copy the updated monolith too.
3. **Deploy → Manage deployments → Edit → New version → Deploy**
4. Re-run a quick manual WhatsApp test (patient Hi + one booking; try a date with many slots if possible).
5. If new sheets or settings were added, they auto-create on first use — check **`Settings`** for new keys and confirm `WhatsApp_Sessions` has a **Slot Page** header after the first paginated slot pick.

You do **not** need to re-verify the Meta webhook unless the deployment URL changes.

---

## Deploy checklist (quick reference)

Use this after you have done the full steps above:

- [ ] Production code bound — either `ABC_Clinic_WhatsApp_Complete.gs` **or** all files under `src/` (not both) + optional tests file
- [ ] `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` set
- [ ] `WHATSAPP_VERIFY_TOKEN` and `WHATSAPP_WEBHOOK_POST_TOKEN` set (both required — webhook fails closed without them)
- [ ] Web app deployed (**Execute as: Me**, **Anyone** can access)
- [ ] Meta webhook verified; **`messages`** subscribed
- [ ] `Doctors` and `Availability` populated
- [ ] Patient + doctor WhatsApp smoke tests passed
- [ ] `Settings` log retention configured (optional)
- [ ] `installAppointmentReminderTrigger()` run if reminders enabled (optional)
- [ ] `installAutoCompletePastAppointmentsTrigger()` run if auto-complete enabled (optional)
- [ ] `ENABLE_AFTER_HOURS_REPLY` configured if using closed auto-reply (optional)
- [ ] `syncPatientsFromAppointments()` run if upgrading (one-time)

---

## Testing

| File | How to run |
|------|------------|
| `ABC_Clinic_Tests.gs` | Apps Script editor → `runAllTests()` (needs `DEBUG_MODE=true`) |

Set `TEST_SKIP_WHATSAPP_SEND=true` to avoid real WhatsApp API calls during send tests.

### Smoke tests in `runAllTests()`

| Test | What it checks |
|------|----------------|
| `testBooking` | Creates a test row + calendar event (uses live sheet/calendar) |
| `testRealBooking` | `bookAppointment()` integration |
| `testCancellation` / `testReschedule` | Cancel and reschedule APIs |
| `testAPI` / `testPatientAPI` | HTTP-style API helpers |
| `testGetMyAppointments` | Patient appointment lookup |
| `testSecureCancelAPI` / `testSecureRescheduleAPI` | Phone-ownership checks |
| `testDoctorTodaySchedule` … `testDoctorNextAppointment` | Doctor schedule helpers |
| `testSendWhatsAppMessage` / `testSendWhatsAppTemplate` | Outbound WhatsApp (skipped if `TEST_SKIP_WHATSAPP_SEND`) |
| `testWhatsAppSession` | Session read/write |
| `testPatientRegistry` | Patients sheet helpers |
| `testDoctorPortalHelpers` | Availability/day/time helpers + doctor menu |
| `testWhatsAppFlowHelpers` | Date/appointment picker prompts |
| `testWhatsAppReliability` | Idempotency / dedup helpers |
| `testLogSettings` | Log retention settings |
| `testAppointmentReminders` | Reminder parsing, message build, settings |
| `testDoctorCancelReschedule` | Doctor cancel/reschedule UI helpers |
| `testAppointmentStatus` | Completed / No-Show status workflow |
| `testAfterHoursReply` | Clinic hours parsing, closed message, patient gate |
| `testInteractiveMenus` | List/button specs, slot pagination (20-slot case), inbound interactive parsing |
| `testLocalizationUiCleanup` | TE/HI localization of UI cleanup copy (menus, confirmations, slot intro, fallbacks) |
| `testAppointmentSheetFormatting` | Date/time sheet formatting |
| `testWhatsAppRouterStructure` | Router handler functions exist |

Legacy tests (`testBooking`, `testRealBooking`, etc.) may write to live sheets or calendar — run on a **copy** of production data when unsure.

Local Node unit tests (`tests/run-unit-tests.mjs`) are **not included yet** — optional future work.

---

## Known limitations

- Localization is substring-based, not full i18n — doctor portal tap labels stay English; patient interactive labels and message bodies localize via `localizeInteractiveMenu()` / `localizeWhatsAppReply()`
- Kannada/Tamil/Malayalam translations have not been reviewed by a native speaker — treat as a starting point (see `localizeWhatsAppReply` in `View_Messages.gs` for the comment marking the AI-assisted entries)
- `syncPatientsFromAppointments()` requires `DEBUG_MODE=true` (admin-only)
- Some legacy tests (`testRealBooking`, etc.) hit live sheets/calendar — review before running in production spreadsheet
- Router-split handler functions work but have uneven indentation (cosmetic)

---

## Repo layout

```
ABC_Clinic_WhatsApp_Complete.gs   ← production, Option A: single file
ABC_Clinic_Tests.gs               ← tests (optional bind, either option)
src/                               ← production, Option B: split into 23 files (see above)
  Config.gs
  Util_Common.gs
  Logging.gs
  Model_Reminders.gs
  Model_AppointmentStatus.gs
  Model_AfterHours.gs
  Model_Doctors.gs
  Model_Calendar.gs
  Model_Patients.gs
  Model_Appointments.gs
  Model_HomeCollection.gs
  Model_Session.gs
  Setup.gs
  Api.gs
  Webhook.gs
  View_Menus.gs
  View_Messages.gs
  Controller_Shared.gs
  Controller_Router.gs
  Controller_DoctorFlow.gs
  Controller_PatientFlow.gs
  Controller_HomeCollection.gs
  WhatsApp_Send.gs
  README.md                        ← src/-specific setup notes (sheet schemas, Settings keys)
landing/                           ← marketing website (Vercel / Replit)
marketing/                         ← brochure, one-pager, offboarding docs
clinic-app/                        ← in-progress Next.js + Supabase rewrite (see clinic-app/README.md) — not yet production
scripts/
  sync-monolith-from-src.js        ← copy src/ function bodies into ABC_Clinic_WhatsApp_Complete.gs
  verify-menu-flows.mjs            ← static checks for interactive menu wiring
  verify-flow-coverage.mjs         ← static checks that every session state is reachable
README.md                          ← this file
```

Option A and Option B are kept in sync with `node scripts/sync-monolith-from-src.js` after editing `src/` — the script copies all **23** `src/*.gs` files into the monolith (function bodies only; top-level comments and consts are not copied — see the script's own header comment). Use `--check` for a dry-run. Run it before deploying the monolith. If you only use one layout, you can ignore the script.
