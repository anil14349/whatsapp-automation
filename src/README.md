# ABC Clinic WhatsApp Automation — `src/` (split layout)

This is the multi-file version of the ABC Clinic WhatsApp bot: the same code as
[`ABC_Clinic_WhatsApp_Complete.gs`](../ABC_Clinic_WhatsApp_Complete.gs), reorganized into
24 files by responsibility (Model / View / Controller style).

**Apps Script merges every bound `.gs` file into one shared global scope** — file names,
file count, and file order don't affect behavior. This split is for navigation only.

Don't bind this folder's files *and* `ABC_Clinic_WhatsApp_Complete.gs` in the same Apps
Script project — every function would be declared twice.

See the [repo root README](../README.md) for full deployment, Settings keys, triggers,
Growth features, and the manual WhatsApp test checklist.

---

## File structure (24 files)

| File | Responsibility |
|------|-----------------|
| `Config.gs` | Constants, `Settings` sheet, debug-mode flags |
| `Util_Common.gs` | Phone/date/time helpers |
| `Logging.gs` | `WhatsApp_Log` / `WhatsApp_Debug`, retention cleanup |
| `Model_Reminders.gs` | Appointment reminders + action buttons |
| `Model_OwnerDigest.gs` | Daily owner WhatsApp summary |
| `Model_Waitlist.gs` | Slot-alert waitlist & cancellation offers |
| `Model_Feedback.gs` | Post-visit ratings & review link |
| `Model_Services.gs` | Visit types & per-service slot durations |
| `Model_AppointmentStatus.gs` | Completed / No-Show, auto-complete |
| `Model_AfterHours.gs` | Clinic-hours gate, closed auto-reply |
| `Model_Doctors.gs` | Doctors, availability, leaves, schedules |
| `Model_Calendar.gs` | Slot engine (`getAvailableSlots`) |
| `Model_Patients.gs` | `Patients` registry |
| `Model_Appointments.gs` | Book / cancel / reschedule |
| `Model_Session.gs` | `WhatsApp_Sessions` state |
| `Api.gs` | `api()` dispatcher |
| `Webhook.gs` | `doGet` / `doPost` |
| `View_Menus.gs` | Interactive menu specs |
| `View_Messages.gs` | Reply builders & localization |
| `Controller_Shared.gs` | Shared flow helpers |
| `Controller_Router.gs` | Top-level dispatch |
| `Controller_DoctorFlow.gs` | Doctor state machine |
| `Controller_PatientFlow.gs` | Patient state machine |
| `WhatsApp_Send.gs` | Cloud API senders |

---

## Keeping in sync

After editing `src/`:

```bash
node scripts/sync-monolith-from-src.js
```

Then deploy **either** the monolith **or** all `src/` files — not both.

Dry-run: `node scripts/sync-monolith-from-src.js --check`

Static checks (from repo root):

```bash
node scripts/verify-flow-coverage.mjs
node scripts/verify-owner-digest.mjs
node scripts/verify-reminder-actions.mjs
node scripts/verify-clinic-branding.mjs
node scripts/verify-waitlist.mjs
node scripts/verify-post-visit-feedback.mjs
node scripts/verify-visit-type.mjs
```

**Note:** Top-level `const` blocks in `Config.gs` are duplicated manually in the monolith header — only `function` bodies are auto-synced.

---

## Auto-created sheets (beyond manual setup)

| Sheet | Purpose |
|-------|---------|
| `Services` | Visit types (Consultation, Follow-up, …) — seeded on first use |
| `Waitlist` / `Slot_Offers` | Slot-alert waitlist |
| `Feedback_Sent_Log` / `Feedback_Responses` | Post-visit feedback |
| `Owner_Digest_Log` | Daily digest dedup |
| `Reminder_Responses` | Reminder button taps |

Full list and Settings keys: [root README](../README.md).
