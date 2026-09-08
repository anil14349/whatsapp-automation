# Configuration reference

Every configuration knob in `clinic-app`, organized by module, with where
it lives, what it controls, and — importantly — **whether the code
actually reads it yet**. Several `settings` table keys are seeded with
defaults and editable in `/admin/settings` today but have no code
consuming them (the feature they'd control hasn't been ported from the
Apps Script version yet — see [`README.md`](README.md)'s stage 3 "What's
covered vs. deferred"). Marked clearly below so this document doesn't
imply more works than actually does.

## The three configuration layers

| Layer | Where | Changing it requires | Who can change it |
|---|---|---|---|
| **Environment variables** | `.env.local` / your host's env var settings | A redeploy (or container restart) | Whoever has deploy access |
| **`settings` table** | Postgres, seeded by `supabase/migrations/0001_init.sql` | Nothing — takes effect on the next message/request | Anyone logged into `/admin/settings` |
| **Per-record configuration** | `doctors`, `doctor_availability`, `doctor_leaves` tables | Nothing | Anyone logged into `/admin/doctors` |

---

## Environment variables (`lib/env.ts`)

All validated at first use via a `zod` schema (`getServerEnv()`) — a
missing required variable throws a clear error naming exactly which one,
rather than failing confusingly deep inside whichever module needed it.
Full list with descriptions: [`.env.example`](.env.example).

### Supabase — used by every module that touches the database

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Not currently used by any browser code (the admin UI never talks to Supabase directly — see `README.md`'s RLS note) but required by the schema since `@supabase/supabase-js` expects it |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-only. Bypasses Row Level Security — see `lib/supabase/server.ts` |

### WhatsApp Cloud API — `lib/whatsapp/send.ts`, `app/api/whatsapp/webhook/route.ts`

| Variable | Required | Notes |
|---|---|---|
| `WHATSAPP_ACCESS_TOKEN` | Yes | Meta Graph API token |
| `WHATSAPP_PHONE_NUMBER_ID` | Yes | Which WhatsApp Business number this deployment sends as |
| `WHATSAPP_VERIFY_TOKEN` | Yes | Must match Meta's webhook config exactly. **Fails closed** — `GET /api/whatsapp/webhook` rejects verification if this doesn't match, no fallback |
| `WHATSAPP_WEBHOOK_POST_TOKEN` | Yes | Appended as `?token=...` on the callback URL. **Fails closed** — `POST /api/whatsapp/webhook` rejects every request without a matching token |

### Google Calendar — `lib/calendar/google.ts`

| Variable | Required | Notes |
|---|---|---|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Only if any doctor has a `calendar_id` set | Must be shared on each doctor's Google Calendar (see README "Deploying" step 2) |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | Only if any doctor has a `calendar_id` set | Keep `\n` sequences literal, not real newlines, when pasting into an env var |

A doctor with a blank `calendar_id` simply gets no Calendar sync for
their appointments — booking still works, just without an event created
(`lib/scheduling/slots.ts` returns no slots at all if `calendar_id` is
blank, actually — see note under "Per-doctor configuration" below).

### WhatsApp Flows — `lib/whatsapp/flowCrypto.ts`, `app/api/whatsapp/flow/route.ts`

| Variable | Required | Notes |
|---|---|---|
| `WHATSAPP_FLOW_ID` | Only if `ENABLE_WHATSAPP_FLOW_BOOKING` is on | The published Flow's ID from Meta's Flow Builder |
| `WHATSAPP_FLOW_PRIVATE_KEY` | Only if `ENABLE_WHATSAPP_FLOW_BOOKING` is on | Generate with `node scripts/generate-flow-keypair.mjs`. Same `\n`-literal convention as `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` |
| `WHATSAPP_FLOW_PRIVATE_KEY_PASSPHRASE` | Only if `ENABLE_WHATSAPP_FLOW_BOOKING` is on | Printed alongside the private key by the same script |

All three are optional and unused unless `ENABLE_WHATSAPP_FLOW_BOOKING`
is turned on below — see `clinic-app/README.md`'s "WhatsApp Flows"
section for full setup steps.

### Admin auth — `lib/auth/session.ts`

| Variable | Required | Notes |
|---|---|---|
| `ADMIN_SESSION_SECRET` | Yes, min 32 chars | Signs the admin session cookie (HMAC-SHA256). Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. **Never share this value across separate hospital deployments** — see `clinic-app/README.md`'s multi-hospital section |

### Misc

| Variable | Required | Notes |
|---|---|---|
| `CLINIC_TIMEZONE` | No, defaults to `Asia/Kolkata` | IANA timezone name. Used everywhere date/time math happens — `lib/scheduling/dates.ts` |

---

## `settings` table (runtime config, `/admin/settings`)

| Key | Default | Controls | **Wired up?** |
|---|---|---|---|
| `CLINIC_NAME` | `ABC Clinic` | Substituted for every `{{CLINIC_NAME}}` placeholder in bot messages | ✅ Active |
| `ENABLE_INTERACTIVE_MENUS` | `TRUE` | Tap-to-select WhatsApp menus vs. falling back to plain numbered text | ✅ Active |
| `ENABLE_WHATSAPP_FLOW_BOOKING` | `FALSE` | Use a native WhatsApp Flow form for Book Appointment instead of the list/button conversation | ✅ Active, but requires `WHATSAPP_FLOW_ID` + a keypair configured (see env vars above) — falls back to the list/button flow if either is missing, even when this is `TRUE` |
| `LOG_RETENTION` | `month` | How long `message_log` rows are kept | ⛔ Not yet wired — no cleanup job exists; `message_log` currently grows unbounded |
| `LOG_MAX_ROWS` | `5000` | Row cap after retention cleanup | ⛔ Not yet wired (depends on the cleanup job above) |
| `LOG_MESSAGE_MAX_CHARS` | `500` | Truncate long logged message text | ⛔ Not yet wired — `lib/whatsapp/log.ts` logs the full message text untruncated |
| `ENABLE_INBOUND_LOG` | `TRUE` | Whether to log inbound messages at all | ⛔ Not yet wired — the webhook logs unconditionally regardless of this toggle |
| `ENABLE_DEBUG_LOG` | `TRUE` | Whether to log outbound sends | ⛔ Not yet wired — no outbound logging exists yet at all (inbound only) |
| `ENABLE_APPOINTMENT_REMINDERS` | `TRUE` | Send WhatsApp reminders before appointments | ⛔ Not yet wired — the reminders job isn't ported (README stage 3 deferred list) |
| `REMINDER_HOURS_BEFORE` | `24` | Comma-separated lead times | ⛔ Not yet wired (same as above) |
| `REMINDER_WINDOW_MINUTES` | `45` | Send window for the reminder job | ⛔ Not yet wired (same as above) |
| `AUTO_COMPLETE_PAST_APPOINTMENTS` | `FALSE` | Auto-mark past Confirmed appointments Completed | ⛔ Not yet wired — no background job exists; use `/admin/appointments`'s manual Completed/No-Show buttons instead |
| `AUTO_COMPLETE_HOURS_AFTER` | `4` | Grace period before auto-completing | ⛔ Not yet wired (same as above) |
| `ENABLE_AFTER_HOURS_REPLY` | `FALSE` | Auto-reply when patients message outside clinic hours | ⛔ Not yet wired — after-hours gating isn't ported (README stage 3 deferred list) |
| `CLINIC_OPEN_TIME` / `CLINIC_CLOSE_TIME` | `09:00` / `18:00` | Clinic hours for the above | ⛔ Not yet wired (same as above) |
| `CLINIC_WORKING_DAYS` | `Mon,Tue,Wed,Thu,Fri,Sat` | Days the after-hours gate treats as open | ⛔ Not yet wired (same as above) |
| `AFTER_HOURS_MESSAGE` | *(empty)* | Custom closed-message override | ⛔ Not yet wired (same as above) |
| `HOSPITAL_LATITUDE` / `HOSPITAL_LONGITUDE` | *(empty)* | Clinic location for the home-collection radius check | ✅ Active — `getHospitalLocation` (`lib/settings.ts`), used by `lib/whatsapp/patientFlow.ts`'s Home Sample Collection flow. Leave either blank and the flow tells patients it isn't set up yet, rather than silently treating (0, 0) as the clinic's location |
| `HOME_COLLECTION_RADIUS_KM` | `5` | Service radius for home collection | ✅ Active — `getHomeCollectionRadiusKm` (`lib/settings.ts`) |

**Why they're editable in the admin UI if most don't do anything yet**:
the `settings` table and its admin form were built as the general
mechanism stage 2/4 established; each toggle activates the moment its
corresponding bot feature gets ported in a future increment, with no
schema or UI change needed then — only the missing plumbing in between.
Treat the ⛔ rows today as "reserved, has no effect yet," not as broken.

This isn't just documented here — `/admin/settings` itself shows a
**"Not yet active"** badge next to every dormant field, so someone using
the UI (not reading this doc) still finds out. The badge is driven by
`DORMANT_SETTING_KEYS` in `lib/settings.ts`, the single source of truth
for this table — keep it in sync with the ⛔ rows above if a future
change wires up one of these settings.

---

## Per-doctor configuration (`doctors` table, `/admin/doctors`)

| Field | Controls | Notes |
|---|---|---|
| `doctor_code` | Human-readable ID (e.g. `D001`) | Immutable in the UI once set — used in WhatsApp doctor-selection payloads |
| `name`, `specialization`, `clinic_name` | Display text shown to patients when picking a doctor | |
| `appointment_duration_minutes` | Slot length used by the availability engine (`lib/scheduling/availability.ts`) | Changing it only affects future slot computations, not existing booked appointments |
| `calendar_id` | Which Google Calendar to sync bookings to | **Leave blank and the doctor gets zero available slots at all** — `getAvailableSlotsForDoctor()` returns `[]` immediately if `calendar_id` is empty (see `lib/scheduling/slots.ts`). This is a real gotcha: a doctor added without a Calendar ID looks "available" in the UI but can never actually be booked via WhatsApp until one is set |
| `whatsapp_phone` | Which inbound number routes to the Doctor Portal instead of the patient flow | Consumed by `findDoctorByWhatsAppPhone` (`lib/doctors.ts`), checked on every inbound message via `lib/whatsapp/router.ts`. Must match the number the doctor actually messages from, `active` must be `true` |
| `active` | Whether the doctor appears in patient-facing doctor selection | `listDoctors(supabase, { activeOnly: true })` filters on this |

## Per-doctor availability & leaves

- **`doctor_availability`** (`/admin/doctors/[id]` → Weekly availability): one row per recurring weekly session (day + start + end time). Multiple rows per day are fine (e.g. morning + evening sessions).
- **`doctor_leaves`** (same page → Upcoming leaves): one row per date a doctor is unavailable. `active = false` rows are cancelled leaves kept for history, not deleted.

Both feed directly into `lib/scheduling/slots.ts` — no caching, so a
change here is reflected on the very next slot lookup.

---

## Hardcoded configuration (not exposed as env vars or settings — code edit required to change)

| Value | Where | Current value |
|---|---|---|
| Admin session duration | `lib/auth/session.ts` → `SESSION_DURATION_MS` | 12 hours |
| Password hash algorithm | `lib/auth/password.ts` | Node's built-in `scrypt`, 64-byte derived key |
| Appointment-code / patient-code format | `lib/appointments.ts` / `lib/patients.ts` | `A` + 8 hex chars / `PAT-YYYYMMDD-NNNN` |
| Supported languages | `lib/patients.ts` → `SUPPORTED_LANGUAGES` | EN, TE, HI, KA, TA, ML |
| Appointment receipt card layout/colors, no clinic logo | `lib/whatsapp/receipt.tsx` | Green header, clinic name text only — no env var/setting for a logo image yet |

---

## Deployment-level configuration

| File | Controls |
|---|---|
| [`next.config.mjs`](next.config.mjs) | `output: "standalone"` (Docker), `typedRoutes`, `outputFileTracingRoot` |
| [`supabase/config.toml`](supabase/config.toml) | **Local dev only** — ports, disables Supabase Auth (`[auth] enabled = false`, since admin auth is hand-rolled — see README stage 4) and Realtime (unused) |
| [`Dockerfile`](Dockerfile) | Build-time placeholder env vars (never used at runtime — see the file's own comments) |
| [`docker-compose.yml`](docker-compose.yml) | Local convenience only — reads `.env.local` via `env_file` |
| [`.dockerignore`](.dockerignore) | Excludes `node_modules`, `.next`, `.git`, `.env*` from the build context |

---

## Quick "where do I change X" index

| I want to… | Change this |
|---|---|
| Rename the clinic in bot messages | `settings.CLINIC_NAME` via `/admin/settings` |
| Add/remove a doctor | `/admin/doctors` |
| Change a doctor's slot length | `/admin/doctors/[id]` → doctor details form |
| Fix "doctor shows up but can't be booked" | Check `calendar_id` is set for that doctor |
| Turn off tap-to-select menus (numbered text only) | `settings.ENABLE_INTERACTIVE_MENUS` via `/admin/settings` |
| Switch Book Appointment to a native WhatsApp Flow form | Set up `WHATSAPP_FLOW_ID` + keypair env vars, then `settings.ENABLE_WHATSAPP_FLOW_BOOKING` via `/admin/settings` — see README's "WhatsApp Flows" section |
| Rotate the WhatsApp access token | `WHATSAPP_ACCESS_TOKEN` env var + redeploy |
| Change how long an admin stays logged in | Edit `SESSION_DURATION_MS` in `lib/auth/session.ts` (no UI/env var yet) |
| Add a new language | Add its translations to `lib/whatsapp/localization.json`, add the code to `SUPPORTED_LANGUAGES` in `lib/patients.ts`, and add it to the `LANGUAGE_BY_CHOICE` map in `lib/whatsapp/patientFlow.ts` and the language menu in `lib/whatsapp/menus.ts` |
