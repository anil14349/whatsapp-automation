# ABC Clinic WhatsApp Automation

Google Apps Script project for ABC Clinic appointment booking over WhatsApp, backed by Google Sheets and Google Calendar.

**Active branch:** `refactor/whatsapp-v2`

---

## Apps Script files

| File | Bind in production? | Purpose |
|------|---------------------|---------|
| `ABC_Clinic_WhatsApp_Complete.gs` | **Required** | Production code (webhook, booking, doctor portal) |
| `ABC_Clinic_Tests.gs` | Optional | Test helpers — bind for dev/staging; safe to leave bound |

Only bind the two files listed above — do not add other `.gs` files with duplicate function names.

---

## Script Properties

### Required

| Property | Purpose |
|----------|---------|
| `WHATSAPP_ACCESS_TOKEN` | Meta Graph API token for sending messages |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp Business phone number ID |

### Optional

| Property | Purpose |
|----------|---------|
| `WHATSAPP_VERIFY_TOKEN` | Webhook GET verification (defaults to `ABC_CLINIC_VERIFY_2026` if unset) |
| `WHATSAPP_WEBHOOK_POST_TOKEN` | Extra POST lock via `?token=...` on webhook URL — **skip if unset** |
| `DEBUG_MODE` | Enables debug logging and test/admin functions |
| `TEST_SKIP_WHATSAPP_SEND` | With `DEBUG_MODE`, skips real WhatsApp sends during tests |

---

## Implemented on `refactor/whatsapp-v2`

### Core

- WhatsApp webhook (`doGet` / `doPost`) with idempotency and outbound dedup
- Patient flows: book, cancel, reschedule, language (EN / TE / HI)
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

- Tap-to-select **list** and **button** menus (Meta interactive messages)
- Used for patient/doctor main menus, language, dates, doctors, slots, and confirmations
- Doctor portal list menu supports **10 options** (Meta’s list limit)
- Toggle via **`Settings`** → `ENABLE_INTERACTIVE_MENUS` (`TRUE` / `FALSE`)
- Falls back to numbered text menus if disabled, API fails, or list exceeds 10 items
- Users can still type `1`, `2`, `3` or `0` / `9` for navigation

### Refactor / reliability

- Shared helpers: date menu, slot picker, appointment list picker
- Router split: `handleWhatsAppGreeting`, `handleWhatsAppUniversalNavigation`, `handleWhatsAppDoctorMessage`, `handleWhatsAppPatientMessage`, thin `processWhatsAppTextMessage`
- `registerPatientForBooking` inside booking lock; normalized reschedule rollback sheet writes
- Phone/date matching fixes; shared `findCalendarEventForAppointment()`

### Localization

- TE/HI via `localizeWhatsAppReply` for main booking strings (name prompt, confirmation, pickers)
- Appointment reminder messages localized (EN / TE / HI)
- Doctor portal and many error strings remain **English only** (by design)

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
- Optional auto-close: set `AUTO_COMPLETE_PAST_APPOINTMENTS` to `TRUE` in **`Settings`**, then run `installAutoCompletePastAppointmentsTrigger()` — confirmed appointments auto-mark **Completed** after `AUTO_COMPLETE_HOURS_AFTER` (default 4 hours)

### After-hours / clinic closed reply

- Auto-reply when patients message **outside clinic hours** (disabled by default)
- Configure open/close times and working days from **`Settings`**
- **Doctors bypass** after-hours — Doctor Portal works 24/7
- Patients **mid-booking** (any state other than `MAIN_MENU`) can finish their current flow
- Optional custom message via `AFTER_HOURS_MESSAGE`
- Closed message localized for EN / TE / HI patients

---

## Deployment steps

Follow these in order for a **new install** or when promoting `refactor/whatsapp-v2` to production.

### Before you start

You need:

- A **Google account** with access to Google Sheets and Google Calendar
- A **Meta WhatsApp Business** app with a phone number connected to the Cloud API
- **Graph API credentials:** long-lived `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID`
- A **Google Sheet** that will hold clinic data (create new, or use your existing production sheet)

Only bind `ABC_Clinic_WhatsApp_Complete.gs` (and optionally `ABC_Clinic_Tests.gs`) — do not add other `.gs` files with duplicate function names.

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

4. Add an **`Appointments`** sheet if you don’t have one:

   | Appointment ID | Date | Time | Doctor ID | Patient Name | Phone | Status | Calendar Event ID | Patient ID |

5. Other sheets (`Patients`, `Doctor_Leaves`, `WhatsApp_Sessions`, `WhatsApp_Log`, `WhatsApp_Debug`, `Settings`, `Reminder_Log`) are **auto-created** on first use — you do not need to create them manually.

---

### Step 2 — Create the Apps Script project

1. In the spreadsheet: **Extensions → Apps Script**
2. Remove any old/default `Code.gs` content if present (or delete the file).
3. Add **`ABC_Clinic_WhatsApp_Complete.gs`** — copy the full file from this repo into a script file with that name.
4. *(Optional, recommended for staging)* Add **`ABC_Clinic_Tests.gs`** for in-editor smoke tests.
5. **Save** the project (Ctrl+S). Give the project a clear name, e.g. `ABC Clinic WhatsApp`.

---

### Step 3 — Set Script Properties

In Apps Script: **Project Settings** (gear) → **Script properties** → add:

| Property | Required? | Value |
|----------|-----------|-------|
| `WHATSAPP_ACCESS_TOKEN` | **Yes** | Meta Graph API token |
| `WHATSAPP_PHONE_NUMBER_ID` | **Yes** | WhatsApp Business phone number ID |
| `WHATSAPP_VERIFY_TOKEN` | Recommended | Any secret string you choose (must match Meta webhook setup) |
| `WHATSAPP_WEBHOOK_POST_TOKEN` | Optional | Extra POST lock — if set, append `?token=YOUR_VALUE` to the webhook URL |
| `DEBUG_MODE` | Optional | `true` — enables admin/test functions (disable in production if not needed) |
| `TEST_SKIP_WHATSAPP_SEND` | Optional | `true` — with `DEBUG_MODE`, skips real sends during `runAllTests()` |

If `WHATSAPP_VERIFY_TOKEN` is omitted, the default verify token is `ABC_CLINIC_VERIFY_2026`.

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

If you set `WHATSAPP_WEBHOOK_POST_TOKEN`, your callback URL becomes:

```
https://script.google.com/macros/s/...../exec?token=YOUR_POST_TOKEN
```

---

### Step 6 — Configure Meta WhatsApp webhook

In [Meta for Developers](https://developers.facebook.com/) → your app → **WhatsApp → Configuration**:

1. **Callback URL** — paste the Web app URL from Step 5 (include `?token=...` if using POST token).
2. **Verify token** — must match `WHATSAPP_VERIFY_TOKEN` in Script Properties (or `ABC_CLINIC_VERIFY_2026` if unset).
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
| `ENABLE_DEBUG_LOG` | `TRUE` | Log outbound sends to `WhatsApp_Debug` |
| `ENABLE_APPOINTMENT_REMINDERS` | `TRUE` | Send WhatsApp reminders before appointments |
| `REMINDER_HOURS_BEFORE` | `24` | Comma-separated hours before appt (e.g. `24,2`) |
| `REMINDER_WINDOW_MINUTES` | `45` | Send window for hourly trigger |
| `ENABLE_INTERACTIVE_MENUS` | `TRUE` | List/button menus instead of typed numbers |
| `AUTO_COMPLETE_PAST_APPOINTMENTS` | `FALSE` | Auto-mark past confirmed appointments Completed |
| `AUTO_COMPLETE_HOURS_AFTER` | `4` | Hours after appointment start before auto-complete |
| `ENABLE_AFTER_HOURS_REPLY` | `FALSE` | Auto-reply when patients message outside clinic hours |
| `CLINIC_OPEN_TIME` | `09:00` | Clinic opens (24h or 12h format) |
| `CLINIC_CLOSE_TIME` | `18:00` | Clinic closes |
| `CLINIC_WORKING_DAYS` | `Mon,Tue,Wed,Thu,Fri,Sat` | Days the clinic accepts patient messages |
| `AFTER_HOURS_MESSAGE` | *(empty)* | Optional custom closed message (overrides default) |

Optional scheduled jobs (run once in Apps Script editor):

```javascript
installDailyLogCleanupTrigger()       // log cleanup at 3 AM daily
installAppointmentReminderTrigger()   // check reminders every hour
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
| Patient | Send `Hi` | Main menu; language prompt if first time |
| Patient | Book appointment | Confirmation; row in `Appointments`; event on doctor calendar |
| Patient | Cancel | Appointment status updated; calendar event removed |
| Patient | Reschedule | New slot saved; calendar updated |
| Doctor | Send `Hi` | Doctor Portal menu |
| Doctor | Options 1–4 | Schedule views work |
| Doctor | Option 5 | Add/remove availability sessions |
| Doctor | Option 6 | Add single-day or range leave |
| Doctor | Option 7 | Patient list from history |
| Doctor | Option 8 | Cancel a patient appointment |
| Doctor | Option 9 | Reschedule a patient appointment |
| Doctor | Option 10 | Mark appointment Completed or No-Show |
| Patient | Send `Hi` outside hours (with after-hours enabled) | Closed message with clinic hours |
| Patient | Mid-booking outside hours | Flow continues until complete |
| Doctor | Send `Hi` outside hours | Doctor Portal still works |

Confirm **`WhatsApp_Log`** receives inbound rows and **`WhatsApp_Debug`** logs outbound replies.

---

### Step 10 — Updating production later

When you pull new code from this repo:

1. Copy updated `ABC_Clinic_WhatsApp_Complete.gs` into Apps Script (overwrite the existing file).
2. **Deploy → Manage deployments → Edit → New version → Deploy**
3. Re-run a quick manual WhatsApp test (patient Hi + one booking).
4. If new sheets or settings were added, they auto-create on first use — check **`Settings`** for new keys.

You do **not** need to re-verify the Meta webhook unless the deployment URL changes.

---

## Deploy checklist (quick reference)

Use this after you have done the full steps above:

- [ ] `ABC_Clinic_WhatsApp_Complete.gs` bound (only production + optional tests file)
- [ ] `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` set
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
| `testInteractiveMenus` | List/button specs, inbound interactive parsing |
| `testAppointmentSheetFormatting` | Date/time sheet formatting |
| `testWhatsAppRouterStructure` | Router handler functions exist |

Legacy tests (`testBooking`, `testRealBooking`, etc.) may write to live sheets or calendar — run on a **copy** of production data when unsure.

Local Node unit tests (`tests/run-unit-tests.mjs`) are **not included yet** — optional future work.

---

## Known limitations

- Localization is substring-based, not full i18n — only keyed English phrases translate
- `syncPatientsFromAppointments()` requires `DEBUG_MODE=true` (admin-only)
- Some legacy tests (`testRealBooking`, etc.) hit live sheets/calendar — review before running in production spreadsheet
- Doctor portal and many error strings remain English-only
- Router-split handler functions work but have uneven indentation (cosmetic)

---

## Repo layout

```
ABC_Clinic_WhatsApp_Complete.gs   ← production (required)
ABC_Clinic_Tests.gs               ← tests (optional bind)
README.md
```
