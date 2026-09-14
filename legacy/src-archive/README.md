# ABC Clinic WhatsApp Automation — `src/` (split layout)

This is the multi-file version of the ABC Clinic WhatsApp bot: the same code as
[`ABC_Clinic_WhatsApp_Complete.gs`](../ABC_Clinic_WhatsApp_Complete.gs), reorganized into
23 files by responsibility (Model / View / Controller style) instead of one ~15,700-line file.

**Apps Script merges every bound `.gs` file into one shared global scope** — file names,
file count, and file order don't affect behavior at all. This split is purely for humans
navigating the code; it is behaviorally identical to the single-file version.

Don't bind this folder's files *and* `ABC_Clinic_WhatsApp_Complete.gs` in the same Apps
Script project — every function would be declared twice and the project would fail to save.

---

## File structure

| File | Responsibility |
|------|-----------------|
| `Config.gs` | Constants (`TIMEZONE`, `APPOINTMENT_STATUS`, etc.), `Settings` sheet read/ensure/cache, debug-mode flags |
| `Util_Common.gs` | Phone normalization/matching, date/time parsing & formatting helpers used everywhere |
| `Logging.gs` | Single `WhatsApp_Log` sheet creation, log settings, retention cleanup |
| `Model_Reminders.gs` | Appointment reminder scheduling, dedup log, every-30-minutes trigger |
| `Model_AppointmentStatus.gs` | Completed / No-Show status workflow, auto-complete trigger |
| `Model_AfterHours.gs` | Clinic-hours parsing, after-hours gate, closed-message auto-reply |
| `Model_Doctors.gs` | Doctor records, weekly availability, leave management, schedule views (today/date/week/next) |
| `Model_Calendar.gs` | Calendar event lookups and the slot-availability engine (`getAvailableSlots`) |
| `Model_Patients.gs` | `Patients` registry — find/upsert/sync, name & language resolution |
| `Model_Appointments.gs` | `bookAppointment` / `cancelAppointment` / `rescheduleAppointment`, appointment lookups |
| `Model_HomeCollection.gs` | `Home_Collection_Requests` sheet — home blood-sample-collection requests |
| `Model_Session.gs` | `WhatsApp_Sessions` sheet read/write (conversation state persistence) |
| `Setup.gs` | `initializeWhatsAppBotSheets()` — one-time idempotent creation of every required sheet with its header row |
| `Api.gs` | `api()` — HTTP-style dispatcher for external callers (dashboards, etc.) |
| `Webhook.gs` | `doGet` / `doPost` webhook entry points, token verification, inbound idempotency |
| `View_Menus.gs` | Interactive WhatsApp list/button menu spec builders |
| `View_Messages.gs` | WhatsApp reply text builders and EN/TE/HI/KA/TA/ML localization |
| `Controller_Shared.gs` | Flow helpers shared by both the patient and doctor conversation state machines |
| `Controller_Router.gs` | Top-level message dispatch: greeting, universal navigation, `processWhatsAppTextMessage` |
| `Controller_DoctorFlow.gs` | Doctor-portal conversation state machine (`handleWhatsAppDoctorMessage`) |
| `Controller_PatientFlow.gs` | Patient conversation state machine (`handleWhatsAppPatientMessage`) |
| `Controller_HomeCollection.gs` | Home blood-sample-collection request flow (location-gated by radius) |
| `WhatsApp_Send.gs` | Low-level WhatsApp Cloud API senders (text, interactive, template) |

Every top-level function/constant from the original single file exists across these 23
files exactly once — kept in sync automatically by `scripts/sync-monolith-from-src.js`
(`node scripts/sync-monolith-from-src.js --check` reports drift without writing).

---

## Supported languages

Patients can pick **English, Telugu, Hindi, Kannada, Tamil, or Malayalam** from a WhatsApp
list menu (`getLanguageMenuSpec()` in `View_Menus.gs`). Translation happens via keyed
phrase substitution in `localizeWhatsAppReply()` (`View_Messages.gs`) — untranslated keys
silently fall back to English rather than erroring, so partial coverage is safe.

Patient-facing **message bodies** are localized (including UI cleanup copy: main menu,
doctor/date/slot prompts, confirmations, custom date, pagination). **Interactive list/button
titles** (Today, Confirm, etc.) remain English. Menu **fallback text** is localized when
interactive mode fails.

Smoke test: `testLocalizationUiCleanup()` in `ABC_Clinic_Tests.gs`.

⚠️ **Kannada/Tamil/Malayalam translations are an initial AI-assisted pass**, not yet
reviewed by a native speaker — verify against real clinic usage before relying on them in
production, especially for time/date-sensitive phrases. Telugu/Hindi predate this and have
been in production use.

Doctor Portal text and most error/validation messages remain English-only by design —
localization covers patient-facing message bodies listed in the translation dictionaries
in `View_Messages.gs`.

---

## Required Google Sheet structure

This bot is a **container-bound** Apps Script project — it must run attached to a specific
Google Sheet (`SpreadsheetApp.getActiveSpreadsheet()` is used throughout) that acts as the
data store.

### First-time setup: run `initializeWhatsAppBotSheets()`

After binding this project to a new Google Sheet, run `initializeWhatsAppBotSheets()` once
from the Apps Script editor (select it in the function dropdown → Run) **before** the first
webhook call arrives. It creates every sheet the bot needs, with the correct header row, if
it doesn't already exist — safe to re-run any time (it no-ops on sheets that already exist).
This is the same logic each sheet's own "ensure" function uses on first real use (see
`Setup.gs`), so skipping this step just means the first sheet gets created lazily on demand
instead of all at once — except you still need to fill in **actual data** for the sheets
below before booking will work.

**`Doctors`** — one row per doctor:

| Doctor ID | Doctor Name | Clinic | Calendar ID | WhatsApp | AppointmentDuration | Active | Specialization |
|-----------|-------------|--------|-------------|----------|----------------------|--------|----------------|

- **Doctor ID** — any short unique string, e.g. `D001`
- **Calendar ID** — from Google Calendar → Settings → Integrate calendar → Calendar ID
- **WhatsApp** — doctor's mobile number with country code, e.g. `919876543210`
- **AppointmentDuration** — slot length in minutes, e.g. `30`
- **Active** — `YES` to allow this doctor to log into the Doctor Portal via WhatsApp
- **Specialization** — optional, e.g. `Cardiologist`. Shown next to the doctor's name in the
  "choose a doctor" list during booking; blank is fine if not set. Existing sheets get this
  column's header added automatically the next time the doctor list loads (no manual sheet
  edit needed) — you only need to fill in the values per doctor

**`Availability`** — weekly recurring hours per doctor (or let doctors fill this via WhatsApp
Doctor Portal → option 5 instead of pre-populating it):

| Doctor ID | Day | Start | End |
|-----------|-----|-------|-----|

Example row: `D001`, `Monday`, `09:00 AM`, `01:00 PM`. Add multiple rows for multiple
sessions per day (e.g. morning + evening).

**`Appointments`** — one row per booking, appended automatically by `bookAppointment()`:

| Appointment ID | Date | Time | Doctor ID | Patient Name | Phone | Status | Calendar Event ID | Patient ID |
|----------------|------|------|-----------|---------------|-------|--------|--------------------|------------|

**`Doctor_Leaves`** *(optional, pre-load known holidays)*:

| Doctor ID | Date | Reason | Active |
|-----------|------|--------|--------|

Use `TRUE` in **Active** for leave rows that should block booking on that date.

### Sheets that auto-create themselves on first use

You do **not** need to create these — `initializeWhatsAppBotSheets()` creates them upfront,
or the code creates them lazily the first time they're needed:

| Sheet | Created by | Purpose |
|-------|-----------|---------|
| `Patients` | `Model_Patients.gs` | Patient registry (phone, name, language, visit history) |
| `WhatsApp_Sessions` | `Model_Session.gs` | Per-phone-number conversation state |
| `WhatsApp_Log` | `Logging.gs` | Single consolidated log — inbound messages, send/webhook errors (successful sends are not logged), and the reminder dedup ledger. Rows are distinguished by a `Direction` column (`INBOUND` / `OUTBOUND` / `WEBHOOK` / `REMINDER`); `Appointment ID`/`Hours Before` are only populated for `REMINDER` rows |
| `Settings` | `Config.gs` | Log retention & feature toggles (see below) |
| `Doctors` / `Availability` / `Appointments` / `Doctor_Leaves` | `Setup.gs` | Header row only — see above for the data you still need to enter |
| `Home_Collection_Requests` | `Model_HomeCollection.gs` | Home blood-sample-collection requests (phone, location, distance, preferred date/time, status) |

---

## Script Properties

Set these under **Project Settings → Script properties** in the Apps Script editor.

### Required

| Property | Purpose |
|----------|---------|
| `WHATSAPP_ACCESS_TOKEN` | Meta Graph API token for sending messages |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp Business phone number ID |
| `WHATSAPP_VERIFY_TOKEN` | Webhook GET verification. **Must be set** — there is no hardcoded fallback. If unset, `doGet` rejects Meta's verification handshake. |
| `WHATSAPP_WEBHOOK_POST_TOKEN` | POST webhook lock via `?token=...`. **Must be set** — if unset, `doPost` rejects all inbound requests. |

### Optional

| Property | Purpose |
|----------|---------|
| `DEBUG_MODE` | `true` enables debug logging and test/admin-only functions |
| `TEST_SKIP_WHATSAPP_SEND` | With `DEBUG_MODE=true`, skips real WhatsApp sends during `runAllTests()` |

`WHATSAPP_VERIFY_TOKEN` and `WHATSAPP_WEBHOOK_POST_TOKEN` fail **closed**: if either is
missing, the webhook rejects requests instead of silently accepting unauthenticated traffic.

### `Settings` sheet (auto-created, key/value)

Adjust after the first inbound message creates the sheet:

| Key | Example | Purpose |
|-----|---------|---------|
| `LOG_RETENTION` | `month` | `week`, `month`, `quarter`, `halfyear`, `year`, or `none` |
| `LOG_MAX_ROWS` | `5000` | Row cap after age-based cleanup |
| `LOG_MESSAGE_MAX_CHARS` | `500` | Truncate long log text |
| `ENABLE_INBOUND_LOG` | `TRUE` | Log inbound messages to `WhatsApp_Log` |
| `ENABLE_DEBUG_LOG` | `TRUE` | Log outbound send errors to `WhatsApp_Log` (fatal webhook errors and the reminder dedup ledger always write regardless of this setting — they're not routine diagnostics) |
| `ENABLE_APPOINTMENT_REMINDERS` | `TRUE` | Send WhatsApp reminders before appointments |
| `REMINDER_HOURS_BEFORE` | `24` | Comma-separated hours before appointment (e.g. `24,2`) |
| `REMINDER_WINDOW_MINUTES` | `45` | Send window for the every-30-minutes trigger |
| `ENABLE_INTERACTIVE_MENUS` | `TRUE` | Tap-to-select list/button menus instead of typed numbers (see root README — slot pagination, Meta 10-row limit) |
| `AUTO_COMPLETE_PAST_APPOINTMENTS` | `FALSE` | Auto-mark past confirmed appointments Completed |
| `AUTO_COMPLETE_HOURS_AFTER` | `4` | Hours after appointment start before auto-complete |
| `ENABLE_AFTER_HOURS_REPLY` | `FALSE` | Auto-reply when patients message outside clinic hours |
| `CLINIC_OPEN_TIME` | `09:00` | Clinic opens (24h or 12h format) |
| `CLINIC_CLOSE_TIME` | `18:00` | Clinic closes |
| `CLINIC_WORKING_DAYS` | `Mon,Tue,Wed,Thu,Fri,Sat` | Days the clinic accepts patient messages |
| `AFTER_HOURS_MESSAGE` | *(empty)* | Optional custom closed message (overrides default) |
| `CLINIC_NAME` | `ABC Clinic` | Display name used in the "Welcome to..." greeting and the logo caption |
| `HOSPITAL_LOGO_MEDIA_ID` | *(empty)* | WhatsApp media ID for the hospital logo/photo, sent as an image before the greeting text on every "Hi". Unset by default (no image sent). See `uploadWhatsAppMediaFromDriveFile()` in `Setup.gs` for the one-time upload step to get this ID — it's a WhatsApp media ID, not a public URL |
| `HOSPITAL_LATITUDE` / `HOSPITAL_LONGITUDE` | *(empty)* | Hospital coordinates for the home sample-collection radius check (`getHospitalLocation()` in `Config.gs`) — the feature stays hidden until both are set |
| `HOME_COLLECTION_RADIUS_KM` | `5` | Max distance (km) from the hospital a patient can be to request home sample collection (`getHomeCollectionRadiusKm()` in `Config.gs`) |

---

## Deploying this split layout

1. Open the clinic Google Sheet → **Extensions → Apps Script**.
2. Remove any default `Code.gs` file.
3. For each of the 23 files listed above: click **`+` → Script**, name it exactly the
   filename minus `.gs` (the editor appends `.gs` automatically), then paste in that file's
   contents from this folder.
4. *(Optional, recommended for staging)* Also add
   [`ABC_Clinic_Tests.gs`](../ABC_Clinic_Tests.gs) for in-editor smoke tests.
5. Save the project (Ctrl+S).
6. Set the Script Properties above.
7. Run any function once (e.g. `doGet`) to trigger the OAuth consent screen, and grant
   access to Google Sheets, Google Calendar, and external requests.
8. **Deploy → New deployment → Web app**, execute as **Me**, access **Anyone**. Copy the
   web app URL — that's your webhook callback URL (append `?token=YOUR_WEBHOOK_POST_TOKEN`).
9. In Meta for Developers → your app → WhatsApp → Configuration, set the callback URL and
   verify token (must match `WHATSAPP_VERIFY_TOKEN` exactly), then subscribe to `messages`.
10. Fill in `Doctors` and `Availability`, then send `Hi` from a doctor's number and a
    patient's number to confirm both flows work.

See the [repo root README](../README.md) for the full end-to-end deployment walkthrough,
the manual WhatsApp test checklist, and the single-file
(`ABC_Clinic_WhatsApp_Complete.gs`) alternative — this document only covers what's
specific to the `src/` split.

---

## Keeping in sync

`src/` and `ABC_Clinic_WhatsApp_Complete.gs` contain the same logic in two layouts. After editing files under `src/`, refresh the monolith:

```bash
node scripts/sync-monolith-from-src.js
```

Then deploy **either** the monolith **or** all `src/` files — not both. The sync script copies **all 23** `src/*.gs` function bodies into the monolith; run it before copying Option A into Apps Script. Dry-run: `node scripts/sync-monolith-from-src.js --check`.

**Note:** Top-level `const`/`var` blocks (e.g. `TIMEZONE` in `Config.gs`) are not auto-synced — only `function` bodies. Edit those in both places if you change constants.

If you only maintain one layout, you can skip the script.
