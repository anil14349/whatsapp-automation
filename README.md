# ABC Clinic WhatsApp Automation

Google Apps Script project for ABC Clinic appointment booking over WhatsApp, backed by Google Sheets and Google Calendar.

**Active development branch:** `feature/welcome-clinic-image` (Growth features: owner digest, reminder buttons, branding, waitlist, feedback, visit types). Stable baseline: `refactor/whatsapp-v2`.

---

## Apps Script files

There are two equivalent ways to source the production code — pick **one**, don't bind both:

### Option A — single file (original)

| File | Bind in production? | Purpose |
|------|---------------------|---------|
| `ABC_Clinic_WhatsApp_Complete.gs` | **Required** | Production code (webhook, booking, doctor portal) |
| `ABC_Clinic_Tests.gs` | Optional | Test helpers — bind for dev/staging; safe to leave bound |

### Option B — `src/` split (recommended)

The same code, reorganized into 24 smaller files by responsibility (Model/View/Controller-style). Apps Script merges every bound `.gs` file into one shared global scope regardless of file name or count, so this is behaviorally identical to Option A — just easier to navigate. Bind **every file in `src/`** (all 24) plus, optionally, `ABC_Clinic_Tests.gs`:

| File | Purpose |
|------|---------|
| `src/Config.gs` | Constants, Settings sheet, debug/log-mode flags |
| `src/Util_Common.gs` | Phone/date/time parsing & formatting helpers |
| `src/Logging.gs` | `WhatsApp_Log` / `WhatsApp_Debug` sheets, retention cleanup |
| `src/Model_Reminders.gs` | Appointment reminder scheduling & sending |
| `src/Model_OwnerDigest.gs` | Daily owner WhatsApp summary |
| `src/Model_Waitlist.gs` | Slot-alert waitlist & cancellation offers |
| `src/Model_Feedback.gs` | Post-visit star ratings & review link |
| `src/Model_Services.gs` | Visit type catalog & per-service slot durations |
| `src/Model_AppointmentStatus.gs` | Completed/No-Show status workflow, auto-complete |
| `src/Model_AfterHours.gs` | Clinic-hours gate & after-hours auto-reply |
| `src/Model_Doctors.gs` | Doctor records, availability, leaves, schedule views |
| `src/Model_Calendar.gs` | Calendar event lookup & slot-availability engine |
| `src/Model_Patients.gs` | Patients registry (find/upsert/sync) |
| `src/Model_Appointments.gs` | Book/cancel/reschedule, appointment lookups |
| `src/Model_Session.gs` | `WhatsApp_Sessions` sheet read/write |
| `src/Api.gs` | `api()` HTTP-style dispatcher for external callers |
| `src/Webhook.gs` | `doGet`/`doPost` entry points, inbound idempotency |
| `src/View_Menus.gs` | Interactive list/button menu specs |
| `src/View_Messages.gs` | WhatsApp reply text builders & localization |
| `src/Controller_Shared.gs` | Flow helpers shared by patient & doctor state machines |
| `src/Controller_Router.gs` | Top-level message dispatch (greeting/navigation/router) |
| `src/Controller_DoctorFlow.gs` | Doctor-portal conversation state machine |
| `src/Controller_PatientFlow.gs` | Patient conversation state machine |
| `src/WhatsApp_Send.gs` | Low-level WhatsApp Cloud API senders |

Every function/variable name is still globally unique across all files (Apps Script requirement). Keep Option A and Option B in sync with `node scripts/sync-monolith-from-src.js` after editing `src/` (~390 functions as of the Growth feature set).

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

## Implemented features

### Core (all branches)

- WhatsApp webhook (`doGet` / `doPost`) with idempotency and outbound dedup
- Patient flows: book, cancel, reschedule, language (EN / TE / HI / KA / TA / ML)
- Doctor flows: schedule views + self-service portal (availability, leaves, patients, cancel/reschedule, visit status)
- Google Sheets + Calendar booking with locking and rollback on reschedule failure
- **Patient main menu:** Book Appointment · My Appointments · **More** (Cancel, Reschedule, Change Language, Contact & Location, Slot alerts)
- **No appointment IDs in patient-facing WhatsApp copy** (IDs remain in sheets/calendar for staff)
- Welcome clinic image on first `Hi` when `CLINIC_WELCOME_IMAGE_URL` is set

### UI principle

**Text explains. Interactive controls act.** — Short message bodies; lists/buttons carry the choices. Typed numbers (`1`, `2`, `0`, `9`) still work as fallback when interactive mode is off or Meta API fails.

### Growth features (`feature/welcome-clinic-image`)

| Feature | Patient / owner experience | Settings / sheets |
|---------|---------------------------|-------------------|
| **Owner daily digest** | WhatsApp summary to owner each morning | `ENABLE_OWNER_DAILY_DIGEST`, `CLINIC_OWNER_PHONE`, `OWNER_DIGEST_HOUR`, `CLINIC_NAME` |
| **Reminder action buttons** | Confirm / Reschedule / Cancel on reminder messages | `ENABLE_REMINDER_ACTION_BUTTONS` · log: `Reminder_Responses` |
| **Contact & location** | More → Contact & Location (address, phone, hours, map) | `CLINIC_ADDRESS`, `CLINIC_PHONE`, `CLINIC_MAP_URL` |
| **Waitlist / slot alerts** | More → Slot alerts; notified when a slot opens on cancel | `ENABLE_APPOINTMENT_WAITLIST`, `WAITLIST_NOTIFY_COUNT` · `Waitlist`, `Slot_Offers` |
| **Post-visit feedback** | 1–5 star rating after completed visits; review link for 4–5 stars | `ENABLE_POST_VISIT_FEEDBACK`, `FEEDBACK_HOURS_AFTER`, `CLINIC_REVIEW_URL` · requires status **Completed** (doctor marks visit or auto-complete enabled) |
| **Visit type selection** | Pick service after doctor (Consultation, Follow-up, …) | `ENABLE_VISIT_TYPE_SELECTION` · `Services` sheet (auto-seeded) |
| **Welcome clinic image** | Image on first `Hi` for new/returning patients | `CLINIC_WELCOME_IMAGE_URL` — public HTTPS URL (e.g. host from [`landing/`](landing/README.md)) |

---

## Core detail (patient & doctor)

### Core booking & registry

- Auto-created `Patients` sheet; `BOOK_NAME` for first-time bookers
- Name from appointment history; language sync on select/change and Hi greeting
- Patient ID on Appointments column 9; session column 10 for booking name
- One-time backfill: `syncPatientsFromAppointments()` (admin; requires `DEBUG_MODE=true`)

### Doctor portal (3-button menus + More tiers)

Doctors see **3 tap buttons** per screen (not a flat 1–10 list). Use **More** to drill into deeper options. Typed numbers still work as fallback where noted.

| Screen | Buttons |
|--------|---------|
| **Main** | Today's Schedule · Next Appointment · **More** |
| **More tier 1** | This Week · Schedule by Date · **More** |
| **More tier 2** | Manage Availability · Manage Leaves · **More** |
| **More tier 3** | My Patients · Cancel Patient · **More** |
| **More tier 4** | Reschedule Patient · Mark Visit Status *(2 buttons only)* |

| Feature | Sheet / effect |
|---------|----------------|
| Today's / week / date schedule, next appointment | Read-only from `Appointments` + Calendar |
| Manage Availability | `Availability` |
| Manage Leaves | `Doctor_Leaves` |
| My Patients | Derived from `Appointments` |
| Cancel / reschedule patient appointment | `Appointments` + Calendar; **patient notified** |
| Mark Visit Status (Completed / No-Show) | `Appointments` |

**Navigation**

- **`0`** — return to doctor main menu (or patient main menu for patients)
- **`9`** — **Back** one step on sub-screens (universal nav)
- **`9` on doctor main menu only** — shortcut to **Reschedule Patient** (not Back; main menu is excluded from universal Back)
- Options **3–10** still work as typed shortcuts from the doctor main menu when interactive mode is off

When a doctor cancels or reschedules, the **patient is notified** via WhatsApp automatically.

### Interactive WhatsApp menus

- Tap-to-select **list** and **button** menus (Meta interactive messages) — no need to type `1`, `2`, `3` for most steps
- **Patient:** language, main menu, doctor picker, date (Today / Tomorrow / Other), time slots, booking confirm, cancel/reschedule pickers, yes/no confirms
- **Doctor:** 3-button menus with **More** tiers (schedule, availability, patients, cancel/reschedule, visit status)
- **Free-text steps** (not menus): custom date (`YYYY-MM-DD`), patient name, availability times, leave reason
- **Navigation:** users can still type `0` (main menu / doctor portal) and `9` (back one step)
- Toggle via **`Settings`** → `ENABLE_INTERACTIVE_MENUS` (`TRUE` / `FALSE`, default `TRUE`)
- Falls back to **numbered text** only when menus are disabled, the Meta API fails, or a list cannot be built
- **UI copy:** short contextual bodies — no duplicated numbered menus in interactive message text (see [UI principle](#ui-principle) above)

#### Meta limits & pagination

WhatsApp allows **at most 10 rows** per list menu and **3 reply buttons** per message.

| Flow | Behavior when > limit |
|------|------------------------|
| **Time slots** | **Paginated** — tap **More times** / **Earlier times** (page tracked in `WhatsApp_Sessions` → **Slot Page** column, auto-created) |
| **Doctor portal** | Exactly 10 list rows (one per option) |
| **Language** | 6 languages in one list (under limit) |
| **Appointment pickers** (cancel/reschedule) | First 10 shown as list; if a patient has **>10** upcoming appointments, falls back to numbered text for the full list |

Typed numbers still work everywhere as a backup (including global slot numbers across pages).

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
- Hourly trigger via `installAppointmentReminderTrigger()`; manual run via `sendAppointmentReminders()`
- Dedup via auto-created **`Reminder_Log`** sheet

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
- Optional auto-close: set `AUTO_COMPLETE_PAST_APPOINTMENTS` to `TRUE` in **`Settings`**, then run `installAutoCompletePastAppointmentsTrigger()` — confirmed appointments auto-mark **Completed** after `AUTO_COMPLETE_HOURS_AFTER` (default 4 hours). **Post-visit feedback** only runs for **Completed** appointments, so enable auto-complete or have doctors mark visits completed.

### Visit type selection (detail)

When `ENABLE_VISIT_TYPE_SELECTION` is `TRUE`:

- **2+ active rows** on the auto-created **`Services`** sheet → patient picks visit type after doctor
- **Exactly 1 active service** → auto-selected (no extra step)
- **Per-service duration** in `Services` column C overrides doctor `AppointmentDuration` for slot calculation; leave blank/`0` to use the doctor default
- Visit type name is stored on **`Appointments`** column **Visit Type** and in the calendar event title

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

Follow these in order for a **new install** or when promoting a feature branch to production.

### Before you start

You need:

- A **Google account** with access to Google Sheets and Google Calendar
- A **Meta WhatsApp Business** app with a phone number connected to the Cloud API
- **Graph API credentials:** long-lived `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID`
- A **Google Sheet** that will hold clinic data (create new, or use your existing production sheet)
- **Node.js** (optional, for local repo checks) — run `node scripts/verify-*.mjs` and `node scripts/sync-monolith-from-src.js` from a clone of this repo

**Important:** The Apps Script project must be **container-bound** to the clinic spreadsheet (**Extensions → Apps Script** from that sheet). Standalone script projects cannot access `SpreadsheetApp.getActiveSpreadsheet()` correctly.

**Timezone:** All dates/times use **`Asia/Kolkata`** (`TIMEZONE` in `Config.gs`). Clinics in other regions should change this constant in `Config.gs` (and the monolith header if using Option A) before go-live.

Bind **either** `ABC_Clinic_WhatsApp_Complete.gs` **or** every file under `src/` (see [Apps Script files](#apps-script-files) above) — not both — plus, optionally, `ABC_Clinic_Tests.gs`. Don't add other `.gs` files with duplicate function names.

---

### Step 1 — Prepare the spreadsheet

1. Create or open the clinic Google Sheet (this becomes the data store).
2. Add a **`Doctors`** sheet with header row:

   | Doctor ID | Doctor Name | Clinic | Calendar ID | WhatsApp | AppointmentDuration |
   |-----------|-------------|--------|-------------|----------|---------------------|

   - **Calendar ID** — from Google Calendar → Settings → Integrate calendar → Calendar ID
   - **WhatsApp** — doctor’s mobile number (with country code, e.g. `919876543210`)
   - **AppointmentDuration** — slot length in minutes (e.g. `30`)

3. Add an **`Availability`** sheet (or let doctors fill it via WhatsApp option 5 later):

   | Doctor ID | Day | Start | End |
   |-----------|-----|-------|-----|

   Example: `D001`, `Monday`, `09:00 AM`, `01:00 PM`

4. Add an **`Appointments`** sheet if you don’t have one (**required** — unlike most other sheets, this one is not auto-created):

   | Appointment ID | Date | Time | Doctor ID | Patient Name | Phone | Status | Calendar Event ID | Patient ID | Visit Type |

   Column **Visit Type** is auto-added on first booking when visit types are used.

5. Other sheets (`Patients`, `Doctor_Leaves`, `WhatsApp_Sessions`, `WhatsApp_Log`, `WhatsApp_Debug`, `Settings`, `Reminder_Log`, `Reminder_Responses`, `Waitlist`, `Slot_Offers`, `Feedback_Sent_Log`, `Feedback_Responses`, `Owner_Digest_Log`, `Services`) are **auto-created** on first use. On upgrade, `WhatsApp_Sessions` may gain new columns (**Language**, **Patient Name**, **Slot Page**, **Service ID**) automatically when a session is saved.

---

### Step 2 — Create the Apps Script project

1. In the spreadsheet: **Extensions → Apps Script**
2. Remove any old/default `Code.gs` content if present (or delete the file).
3. Add the production code — pick one:
   - **Single file:** add **`ABC_Clinic_WhatsApp_Complete.gs`**, copying the full file from this repo into a script file with that name.
   - **Split (`src/`):** add all **24** files from `src/` as separate script files, each with the same name (minus `.gs`, which the editor appends automatically).
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

4. Send **Hi** from a doctor’s WhatsApp number — you should see the doctor main menu (Today's Schedule · Next Appointment · More).
5. Send **Hi** from a patient number — you should see the patient main menu (Book · My Appointments · More).

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
| `ENABLE_DEBUG_LOG` | `TRUE` | Log outbound sends to `WhatsApp_Debug` |
| `ENABLE_APPOINTMENT_REMINDERS` | `TRUE` | Send WhatsApp reminders before appointments |
| `REMINDER_HOURS_BEFORE` | `24` | Comma-separated hours before appt (e.g. `24,2`) |
| `REMINDER_WINDOW_MINUTES` | `45` | Send window for hourly trigger |
| `ENABLE_INTERACTIVE_MENUS` | `TRUE` | Tap-to-select list/button menus (see [Interactive WhatsApp menus](#interactive-whatsapp-menus)) |
| `AUTO_COMPLETE_PAST_APPOINTMENTS` | `FALSE` | Auto-mark past confirmed appointments Completed |
| `AUTO_COMPLETE_HOURS_AFTER` | `4` | Hours after appointment start before auto-complete |
| `ENABLE_AFTER_HOURS_REPLY` | `FALSE` | Auto-reply when patients message outside clinic hours |
| `CLINIC_OPEN_TIME` | `09:00` | Clinic opens (24h or 12h format) |
| `CLINIC_CLOSE_TIME` | `18:00` | Clinic closes |
| `CLINIC_WORKING_DAYS` | `Mon,Tue,Wed,Thu,Fri,Sat` | Days the clinic accepts patient messages |
| `AFTER_HOURS_MESSAGE` | *(empty)* | Optional custom closed message (overrides default) |
| `CLINIC_WELCOME_IMAGE_URL` | *(empty)* | Public **HTTPS** URL for welcome image on first Hi (e.g. deploy [`landing/`](landing/README.md) and use the hosted image URL) |
| `CLINIC_NAME` | `ABC Clinic` | Branding, digest, contact block |
| `CLINIC_ADDRESS` | *(empty)* | Shown in Contact & Location |
| `CLINIC_PHONE` | *(empty)* | Shown in Contact & Location |
| `CLINIC_MAP_URL` | *(empty)* | Google Maps link in Contact & Location |
| `ENABLE_OWNER_DAILY_DIGEST` | `FALSE` | Daily WhatsApp summary to owner |
| `CLINIC_OWNER_PHONE` | *(empty)* | Owner WhatsApp number (with country code) |
| `OWNER_DIGEST_HOUR` | `8` | Hour (0–23) to send digest |
| `ENABLE_REMINDER_ACTION_BUTTONS` | `TRUE` | Confirm / Reschedule / Cancel on reminders |
| `ENABLE_APPOINTMENT_WAITLIST` | `TRUE` | Slot alerts + notify on cancel |
| `WAITLIST_NOTIFY_COUNT` | `3` | Max waitlisted patients per opened slot |
| `ENABLE_POST_VISIT_FEEDBACK` | `TRUE` | Star rating request after completed visits |
| `FEEDBACK_HOURS_AFTER` | `2` | Hours after visit end before feedback send |
| `FEEDBACK_WINDOW_MINUTES` | `45` | Hourly job catch window |
| `FEEDBACK_MIN_RATING_FOR_REVIEW` | `4` | Min stars before showing review link |
| `CLINIC_REVIEW_URL` | *(empty)* | Google review URL (4–5 star thank-you) |
| `ENABLE_VISIT_TYPE_SELECTION` | `TRUE` | Service picker after doctor (when 2+ services) |

Optional scheduled jobs (run **once** in Apps Script editor after deploy):

```javascript
installDailyLogCleanupTrigger()              // log cleanup at 3 AM daily
installAppointmentReminderTrigger()          // check reminders every hour
installAutoCompletePastAppointmentsTrigger() // auto-complete at 11 PM daily (if enabled)
installOwnerDailyDigestTrigger()             // owner digest at OWNER_DIGEST_HOUR
installPostVisitFeedbackTrigger()            // post-visit feedback every hour
sendAppointmentReminders()                   // manual reminder run
sendPostVisitFeedbackRequests()              // manual feedback run
sendOwnerDailyDigest()                       // manual digest preview
previewPostVisitFeedback()                   // feedback settings + dry run
autoCompletePastAppointments()               // manual auto-complete run
cleanupAllWhatsAppLogs()                     // manual log cleanup
```

#### Upgrading from an older version

If you already have appointments but no **`Patients`** registry, run once (requires `DEBUG_MODE=true`):

```javascript
syncPatientsFromAppointments()
```

---

### Step 9 — Verify deployment

#### Local static checks (from repo clone)

No Apps Script deploy required — validates wiring in `src/`:

```bash
node scripts/sync-monolith-from-src.js --check   # optional: monolith in sync with src/
node scripts/verify-flow-coverage.mjs
node scripts/verify-menu-flows.mjs
node scripts/verify-appointment-list-pages.mjs
node scripts/verify-owner-digest.mjs
node scripts/verify-reminder-actions.mjs
node scripts/verify-clinic-branding.mjs
node scripts/verify-waitlist.mjs
node scripts/verify-post-visit-feedback.mjs
node scripts/verify-visit-type.mjs
```

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
| Patient | Book appointment | Doctor → *(visit type if enabled)* → date → time → confirm; row in `Appointments`; calendar event |
| Patient | More → Contact & Location | Clinic address/phone/hours/map when configured |
| Patient | More → Slot alerts | Join waitlist for a doctor |
| Patient | Tap reminder Confirm / Cancel / Reschedule | Ack or enters cancel/reschedule flow |
| Patient | After completed visit (~2h) | Feedback star rating; review link if 4–5 stars + URL set |
| Patient | Cancel (doctor or patient) | Waitlisted patients may receive **Book this slot** offer |
| Patient | Book on a busy day (>9 slots) | Slot list shows **More times** / **Earlier times** pages |
| Patient | Cancel | Appointment status updated; calendar event removed |
| Patient | Reschedule | New slot saved; calendar updated |
| Doctor | Send `Hi` | Doctor main menu: Today's Schedule · Next Appointment · More |
| Doctor | More → tier 1 | This Week · Schedule by Date · More |
| Doctor | More → tier 2 | Manage Availability · Manage Leaves · More |
| Doctor | More → tier 3 | My Patients · Cancel Patient · More |
| Doctor | More → tier 4 | Reschedule Patient · Mark Visit Status |
| Doctor | Manage Availability | Add/remove sessions (tappable day + action menus) |
| Doctor | Manage Leaves | Single-day or range leave |
| Doctor | Cancel / reschedule patient | Patient notified; sheet + calendar updated |
| Doctor | Mark Visit Status | Completed or No-Show |
| Patient | Send `Hi` outside hours (with after-hours enabled) | Closed message with clinic hours |
| Patient | Mid-booking outside hours | Flow continues until complete |
| Doctor | Send `Hi` outside hours | Doctor Portal still works |

Confirm **`WhatsApp_Log`** receives inbound rows and **`WhatsApp_Debug`** logs outbound replies.

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
- [ ] `installOwnerDailyDigestTrigger()` run if owner digest enabled (optional)
- [ ] `installPostVisitFeedbackTrigger()` run if feedback enabled (optional)
- [ ] `installAutoCompletePastAppointmentsTrigger()` run if auto-complete enabled (optional)
- [ ] `ENABLE_AFTER_HOURS_REPLY` configured if using closed auto-reply (optional)
- [ ] `CLINIC_REVIEW_URL` / `Services` sheet reviewed if using feedback / visit types (optional)
- [ ] `syncPatientsFromAppointments()` run if upgrading (one-time)

---

## Unified API (`api()`)

For dashboards or external tools in the **same** Apps Script project, call `api(action, data)` (`Api.gs`):

| Action | `data` fields | Returns |
|--------|---------------|---------|
| `getDoctors` | — | Doctor list |
| `getAvailableSlots` | `doctorId`, `date`, optional `serviceId` | Slot strings |
| `book` | `doctorId`, `date`, `time`, `patientName`, `patientPhone`, `patientLanguage`, optional `serviceId` | Booking result |
| `getMyAppointments` | `patientPhone` | Appointments for phone |
| `cancel` | `appointmentId`, `patientPhone` | Cancel result |
| `reschedule` | `appointmentId`, `patientPhone`, `newDate`, `newTime` | Reschedule result |
| `doctorToday` / `doctorWeek` / `doctorNext` | `doctorId` | Schedule helpers |
| `doctorPatients` | `doctorId` | Patients seen |
| `doctorAvailability` / `doctorLeaves` | `doctorId` | Availability / leave rows |

There is no public HTTP endpoint — wrap in your own web app if you need remote access.

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
| `testOwnerDailyDigest` | Owner digest settings and message build |
| `testReminderActionButtons` | Reminder button IDs and confirm ack |
| `testClinicBranding` | Contact & location message |
| `testWaitlist` | Waitlist offer parsing and menu spec |
| `testPostVisitFeedback` | Feedback rating parsing and thank-you copy |
| `testVisitTypeSelection` | Services sheet, duration resolution, confirm message |
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

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Meta webhook verify fails | `WHATSAPP_VERIFY_TOKEN` mismatch | Match Meta dashboard and Script Properties exactly |
| No rows in `WhatsApp_Log` | Wrong URL, missing `?token=`, or stale deployment | Use full web app URL with `WHATSAPP_WEBHOOK_POST_TOKEN`; **Deploy → New version** after code changes |
| Patient gets no reply | After-hours gate, or script error | Check `Settings` → `ENABLE_AFTER_HOURS_REPLY`; check **Executions** in Apps Script |
| Reminders never send | Trigger not installed or reminders disabled | Run `installAppointmentReminderTrigger()`; check `ENABLE_APPOINTMENT_REMINDERS` |
| Feedback never send | No **Completed** appointments, or trigger missing | Mark visits completed (doctor or auto-complete); run `installPostVisitFeedbackTrigger()` |
| Owner digest missing | Disabled or no owner phone | Set `ENABLE_OWNER_DAILY_DIGEST`, `CLINIC_OWNER_PHONE`; run `installOwnerDailyDigestTrigger()` |
| “Booking is busy” | Concurrent booking lock | Retry; avoid double-tapping confirm |
| Slots look wrong after visit types | Service duration differs from doctor default | Edit **`Services`** sheet or disable `ENABLE_VISIT_TYPE_SELECTION` |
| `runAllTests()` fails immediately | `DEBUG_MODE` not set | Script Property `DEBUG_MODE=true` |

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
src/                               ← production, Option B: 24 files (see [Apps Script files](#apps-script-files))
landing/                           ← marketing site — see landing/README.md
marketing/                         ← brochure, one-pager, offboarding docs
scripts/
  sync-monolith-from-src.js        ← copy src/ function bodies into ABC_Clinic_WhatsApp_Complete.gs
  verify-*.mjs                     ← static flow/feature checks (no deploy)
README.md
```

Option A and Option B are kept in sync with `node scripts/sync-monolith-from-src.js` after editing `src/` — the script copies all **24** `src/*.gs` function bodies into the monolith (function bodies only). Use `--check` for a dry-run. Run it before deploying the monolith. If you only use one layout, you can ignore the script.
