# ABC Clinic — Next.js + Supabase rewrite

Rewrite of the Apps Script bot in [`../src`](../src) (patient/doctor WhatsApp
bot + Google Sheets/Calendar) into a Next.js + Postgres (Supabase) app with a
receptionist/admin web UI. See the root [README](../README.md) and this
branch's history for the architecture decisions behind this rewrite.

For every configuration knob (env vars, `settings` table keys, per-doctor
fields) organized by module — including which ones are actually wired up
vs. reserved for a not-yet-ported feature — see
[`CONFIGURATION.md`](CONFIGURATION.md).

**Status**: in progress, built in stages.

- ✅ Stage 1: project scaffold + complete database schema
- ✅ Stage 2: core business logic — settings, doctors, availability,
  leaves, patients, the slot-availability engine, and
  book/cancel/reschedule appointment logic, all as tested TypeScript
  modules
- ✅ Stage 3: the WhatsApp webhook + patient booking conversation flow —
  see "What's covered" below for exactly what's in vs. deferred
- ✅ Stage 4: the receptionist/admin web UI (this stage) — login,
  dashboard, doctors (incl. availability/leaves), appointments, patients,
  and configurable settings

---

## Stack

- **Next.js 15** (App Router), TypeScript, Tailwind — single app, single
  deployable (e.g. Vercel), covering both the WhatsApp webhook (`/api/...`
  routes) and the admin UI (`/admin/...` pages).
- **Supabase** (Postgres) — replaces every Google Sheet. Schema in
  [`supabase/migrations/`](supabase/migrations).
- **Google Calendar API** (kept) — per-doctor calendar sync via a service
  account, same behavior as the Apps Script version's `CalendarApp` calls.
- **Vitest** — unit tests for pure logic (phone/date parsing, availability
  computation, etc.), run without needing a database.

## Why Next 15, not the newest Next.js

Next 16 is current upstream as of this writing, but it shipped after this
assistant's knowledge cutoff — pinned to the patched Next **15** line
(`15.5.25`) instead, since its API surface (async `cookies()`/`headers()`,
`params`/`searchParams` as Promises, etc.) is well-understood and it isn't
flagged for any known vulnerability. Revisit this once Next 16 has been
out long enough to have real-world docs/guidance to work from.

## Known dependency audit findings (as of this stage)

`npm audit` reports issues in the `vitest`/`vite`/`esbuild` dev-tooling
chain and in `googleapis`'s transitive `uuid` dependency. All are
build-time/dev-server-only (not reachable by a deployed production
request) or low-severity transitive noise — not blocking, but worth
revisiting periodically (`npm audit`) as patched versions land upstream.

---

## Local setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Environment variables**: copy `.env.example` to `.env.local` and fill
   in real values (WhatsApp Cloud API credentials are the same ones already
   used by the Apps Script bot; Supabase URL/keys come from step 3 below;
   Google service-account credentials are new — see below).

3. **Local Supabase** (needs [Docker](https://docs.docker.com/get-docker/)
   and the [Supabase CLI](https://supabase.com/docs/guides/cli)):
   ```bash
   npm run db:start   # starts local Postgres + Studio via Docker
   npm run db:reset   # applies every migration, then supabase/seed.sql
   ```
   `db:start` prints a local `anon`/`service_role` key pair and API URL —
   put those into `.env.local`. `db:reset` also runs
   [`supabase/seed.sql`](supabase/seed.sql) automatically (standard
   Supabase CLI behavior) — sample doctors, patients, and appointments
   in a spread of statuses, so `/admin` isn't empty on first login. Seed
   data is local-dev/demo only — never run `db:reset` against a real
   clinic's database. It doesn't create an admin login; run
   `npm run create-admin` (see "Receptionist/admin web UI" below) for
   that regardless.

4. **Google Calendar service account** (only needed once you get to
   booking flows that touch Calendar): create a Google Cloud service
   account, enable the Calendar API, and **share each doctor's Google
   Calendar** with the service account's email address (Calendar Settings
   → "Share with specific people" → grant "Make changes to events"). This
   mirrors how the Apps Script bot worked — it needed the *executing
   Google account* to have access to each `calendar_id` in the `doctors`
   table.

5. **Run the dev server**:
   ```bash
   npm run dev
   ```

6. **Run tests**:
   ```bash
   npm test          # single run
   npm run test:watch
   ```

7. **Typecheck / lint / build** (same commands CI should run):
   ```bash
   npm run typecheck
   npm run lint
   npm run build
   ```

---

## Core business logic (stage 2)

| Module | Was (Apps Script) | Notes |
|---|---|---|
| `lib/settings.ts` | `getSetting`/`ensureSettingsSheet` (Config.gs) | No caching layer needed — a single indexed Postgres SELECT replaces what used to require scanning/caching an entire Sheet |
| `lib/doctors.ts` | Model_Doctors.gs (CRUD portions) | The four near-duplicate "schedule view" functions (today/date/week/next) aren't ported 1:1 — real SQL makes them one function with a date filter |
| `lib/patients.ts` | Model_Patients.gs | `upsertPatient` no longer needs `LockService` — `INSERT ... ON CONFLICT` is atomic by construction |
| `lib/scheduling/dates.ts` | Date/time helpers scattered across Util_Common.gs/Model_Calendar.gs | Timezone-safe by construction (see the `combineDateAndTime`/`isoDateToWeekday` doc comments for the specific bug class this avoids) |
| `lib/scheduling/availability.ts` | `getAvailableSlots`'s slot-math (Model_Calendar.gs) | Pure function, no I/O — fully unit-tested (18 tests) |
| `lib/scheduling/slots.ts` | `getAvailableSlots`'s I/O (Model_Calendar.gs) | Wraps the pure function with real Supabase + Calendar reads |
| `lib/calendar/` | `CalendarApp.*` calls throughout | Abstracted behind a `CalendarPort` interface — `google.ts` is the real Google Calendar implementation (untested here, no live credentials), `fake.ts` is an in-memory test double |
| `lib/appointments.ts` | `bookAppointment`/`cancelAppointment`/`rescheduleAppointment` (Model_Appointments.gs) | See below — the double-booking guarantee moved from application code to the database itself |

### Booking integrity: constraints, not just application checks

The Apps Script version prevented double-booking with `LockService` (a
mutex) plus a "scan for conflicts" check before writing — best-effort,
not a guarantee. This rewrite adds two **partial unique indexes**
instead (`supabase/migrations/0003…`, `0004…`):

- One doctor can never have two `Confirmed` appointments at the same
  date+time.
- One patient can never have two `Confirmed` appointments on the same
  date (across all doctors) — this is also what makes reschedule "safe"
  without needing the Apps Script version's `excludedAppointmentId`
  special-casing, since a reschedule is an `UPDATE` of the same row.

Application code still does the same checks *first*, for a friendly
error message — but if a race ever slips through, the database itself
refuses the write rather than silently double-booking.

### What's tested vs. what isn't (yet)

This environment has no live Supabase/Docker or Google Calendar
credentials to test against (see Stage 1 notes above). Everything with
real branching logic and no required I/O is unit-tested (settings
parsing, date/time math, the slot-availability engine, time-string
normalization, appointment-ownership authorization). The functions that
orchestrate real Supabase + Calendar calls (`bookAppointment`,
`cancelAppointment`, `rescheduleAppointment`, and everything in
`lib/doctors.ts`/`lib/patients.ts`) are typechecked but **not yet
exercised against a live database** — that's the first thing to verify
once `npm run db:start` is available to you locally.

---

## WhatsApp webhook + patient booking flow (stage 3)

| Module | Was (Apps Script) | Notes |
|---|---|---|
| `app/api/whatsapp/webhook/route.ts` | `doGet`/`doPost` (Webhook.gs) | Same fail-closed token verification; always replies 200 to Meta even on internal error (there's no useful non-2xx response that would help) |
| `lib/whatsapp/dedup.ts` | The `WA_PROCESSED_*`/`WA_PROCESSING_*`/`WA_OUTBOUND_*` CacheService dance in Webhook.gs | Collapses to one `INSERT ... ON CONFLICT DO NOTHING` — a real unique constraint (migration 0005) is atomic by construction, so the multi-key lock-with-retry-fallback logic the Apps Script version needed doesn't have a reason to exist here |
| `lib/whatsapp/inbound.ts` | `extractInboundWhatsAppMessage` | Pure function, unit-tested |
| `lib/whatsapp/send.ts` | The core of WhatsApp_Send.gs | Only the two send primitives (text, interactive) plus a menu-reply wrapper — not all ~30 of that file's per-flow convenience wrappers; each gets added as its flow is ported |
| `lib/whatsapp/menus.ts` | The relevant subset of View_Menus.gs | Doctor-portal menus, appointment-list pickers, pagination controls aren't ported yet |
| `lib/whatsapp/localize.ts` + `localization.json` | `localizeWhatsAppReply` (View_Messages.gs) | The ~600 lines of TE/HI/KA/TA/ML translation dictionaries were **extracted programmatically** from the Apps Script source (see the script referenced in the localize.ts doc comment), not hand-retyped — guarantees fidelity for scripts this assistant can't fully proofread by eye |
| `lib/sessions.ts` | Model_Session.gs | No caching layer needed, same reasoning as `lib/settings.ts` |
| `lib/whatsapp/router.ts` + `patientFlow.ts` | Controller_Router.gs + Controller_PatientFlow.gs | See below for exactly what's covered |

### What's covered vs. deferred

**Working end-to-end**: greeting ("Hi") → language selection (first-time
users) or straight to the main menu (returning users) → Book Appointment
→ choose doctor → choose date (today/tomorrow/custom) → choose an
available time slot → capture patient name (first-time bookers only) →
confirm → **real booking against Postgres + Google Calendar**, with the
same booking-integrity guarantees from stage 2.

Also working end-to-end: **My Appointments** (paginated list of the
patient's confirmed appointments, 7 per page) → pick one → **Cancel** or
**Reschedule** (choose a new date/time, same availability engine as
booking) → confirmed against Postgres + Calendar. The **"More" menu**
(Cancel Appointment / Reschedule Appointment / Change Language) is the
entry point for cancel/reschedule when the patient hasn't first opened
My Appointments. See `lib/whatsapp/patientFlow.ts`'s
`handleAppointmentListChoice`/`startAppointmentListFlow` for the shared
pagination/selection logic all three list screens (My Appointments,
Cancel, Reschedule) reuse.

Also working end-to-end: the **Doctor Portal** conversation flow
(`lib/whatsapp/doctorFlow.ts`) — a WhatsApp number matching a doctor's
`whatsapp_phone` (see `lib/doctors.ts`'s `findDoctorByWhatsAppPhone`,
wired into `lib/whatsapp/router.ts`) gets a completely different menu:
today's schedule, managing appointments (mark Completed/No-Show, cancel,
reschedule any patient's booking — the same `cancelAppointment`/
`rescheduleAppointment`/`markAppointmentStatus` functions the admin UI
uses, with `authorizedDoctorId` instead of an admin session), managing
weekly availability (add/remove sessions), and managing leave dates —
single day or a date range in one step (`addDoctorLeaveRange`).
Condensed from `src/Controller_DoctorFlow.gs`'s ~26 states to ~20 by
using list menus (no 3-button pressure) instead of a tiered "More"
sub-menu. A cancel/reschedule initiated by the doctor sends the patient
a best-effort notification text, localized to the patient's own saved
language.

Also working end-to-end: **Home Sample Collection**
(More menu → Home Sample Collection) — ports
`src/Controller_HomeCollection.gs`/`Model_HomeCollection.gs`. The patient
shares their WhatsApp location (the `location` inbound message type,
now threaded through `lib/whatsapp/router.ts` →
`handlePatientMessage`'s optional `location` parameter — previously
only `"text"`/`"interactive"` messages reached the conversation flow at
all); `lib/scheduling/geo.ts`'s `haversineDistanceKm` checks it's within
`HOME_COLLECTION_RADIUS_KM` of the clinic's `HOSPITAL_LATITUDE`/
`HOSPITAL_LONGITUDE` settings (both now wired — see `lib/settings.ts`'s
`getHospitalLocation`/`getHomeCollectionRadiusKm`), then a preferred
date + time window is captured and saved as a `home_collection_requests`
row (`lib/homeCollection.ts`) for staff to follow up by phone. Staff
manage these at **`/admin/home-collection`** — filterable by status,
with a per-row status dropdown (Requested → Contacted → Completed, or
Cancelled) via `updateHomeCollectionStatusAction`.

Also working end-to-end: the **shareable appointment receipt card**
(`lib/whatsapp/receipt.tsx`) — sent as a WhatsApp image message right
after every successful booking. Ports
`src/Model_Appointments.gs`'s `createAppointmentReceiptCardBlob` (which
built a throwaway Google Slide and exported it as a PNG — the only
image-rendering option available from Apps Script) using Next.js's
built-in `next/og` (`ImageResponse` — Satori + resvg under the hood,
already bundled with Next, **no new dependency, no native binary to
compile**, so it works the same in a Vercel deploy or the Docker image).
`lib/whatsapp/send.ts`'s new `uploadWhatsAppMedia`/`sendWhatsAppImage`
port `uploadWhatsAppImageBlob` using Node's built-in `FormData`/`Blob`
instead of `UrlFetchApp`'s payload object. An optional clinic logo
(`CLINIC_LOGO_URL` setting — any publicly reachable image URL, unlike
the Apps Script version's hardcoded Google Drive file id) renders in
the header if set; `isRenderableLogoUrl` rejects anything that isn't an
absolute `http(s)` URL up front, and a logo that's set but unfetchable
(bad URL, host down) degrades to "no logo" rather than breaking the
whole card — see `lib/whatsapp/receipt.test.ts`'s test against a
deliberately unfetchable URL. A failure generating
or sending the card is swallowed after logging — it must never undo or
fail a booking that already succeeded, same as the original's
try/catch. **This is the one place in the whole rewrite with an actual
runtime test** (`lib/whatsapp/receipt.test.ts` calls the real image
renderer and asserts on the PNG magic bytes) rather than typecheck-only
verification, since image rendering is exactly the kind of thing that
can silently produce garbage without ever throwing.

Also working end-to-end: **appointment reminders**, **auto-complete-past-
appointments**, and the **after-hours auto-reply** — see the "Scheduled
jobs" section below for reminders/auto-complete (both run on a schedule,
not per-message) and `lib/afterHours.ts` for the after-hours gate (runs
inline in `lib/whatsapp/router.ts`, before every greeting/patient
message dispatch — no scheduling needed for that one).

Also now working: **doctor-selection pagination** —
`getDoctorSelectionMenuSpec` (`lib/whatsapp/menus.ts`) pages past
WhatsApp's 10-row list limit exactly like the appointment lists already
did, using the `list_page` session column and `doctor_prev`/`doctor_next`
ids (matching the Apps Script version's own naming); **log
retention/truncation**, via `lib/logCleanup.ts` and the daily
`/api/cron/log-cleanup` job; and **doctor leave-range add/cancel** —
the Doctor Portal's leave menu now offers "Add Leave (Single Day)" and
"Add Leave (Date Range)" side by side (`DOCTOR_LEAVE_RANGE_START/END/REASON`
states in `lib/whatsapp/doctorFlow.ts`, calling the
`addDoctorLeaveRange` that already existed in `lib/doctors.ts` since
stage 2 but was never wired into the WhatsApp flow until now).
`DORMANT_SETTING_KEYS` in `lib/settings.ts` is now empty — every
setting seeded so far has real code behind it.

Every item from this rewrite's original "deferred to a later increment"
list is now closed. Remaining known gaps are narrower and noted inline
above (no clinic-logo asset upload UI — it's a URL field — and the
"Not yet exercised against a live [service]" caveat that applies to
this entire project, not any one feature).

### Verification

`npm run typecheck`, `npm run build`, `npm run lint`, and `npm test`
(112 tests as of the receipt-logo addition) all pass. As
with stage 2, the parts with real branching logic and no required I/O
are unit-tested (inbound message parsing, localization incl.
round-tripping every language against the extracted dictionaries, menu
spec builders, slot-selection id encoding/decoding, appointment-list
pagination and choice classification, doctor-portal weekday/session/leave
selection parsing, haversine distance, after-hours clinic-hours gating
across timezones, and — the one actual runtime test in the whole
rewrite — real PNG generation for the receipt card).
The webhook route and the conversation flow handlers that orchestrate
Supabase + WhatsApp Cloud API + Calendar calls are typechecked but not
yet exercised against a live WhatsApp number/database — see "What's
tested vs. what isn't yet" under stage 2 above; the same caveat applies
here.

---

## WhatsApp Flows (native "Book Appointment" form)

An optional alternative to the list/button booking conversation above:
[WhatsApp Flows](https://developers.facebook.com/docs/whatsapp/flows)
open a real multi-screen native form inside the chat (dropdowns, a date
picker, radio buttons) instead of a back-and-forth of separate list
messages — mainly useful once you have more doctors/slots than
WhatsApp's 10-row list-message limit comfortably fits.

| Module | Purpose |
|---|---|
| `lib/whatsapp/flowCrypto.ts` | Implements Meta's Flow endpoint encryption contract (RSA-OAEP/SHA-256 to unwrap an AES key, AES-128-GCM for the actual payload) — the one genuinely fiddly part of this feature, isolated with its own round-trip test |
| `lib/whatsapp/flowBooking.ts` | Screen-by-screen booking logic (doctor → date → time → name/confirm), reusing the exact same `lib/appointments.ts`/`lib/scheduling` functions the list/button flow uses — same booking rules, same double-booking guarantees, just a different UI driving them |
| `app/api/whatsapp/flow/route.ts` | The Flow's "Data Exchange" HTTPS endpoint — decrypts, dispatches, encrypts the response, handles Meta's `ping` health check and the required 421-on-decryption-failure behavior |
| `whatsapp-flows/booking-flow.json` | The Flow definition itself (screens/components) — paste into Meta's Flow Builder, or publish via its API |
| `scripts/generate-flow-keypair.mjs` | One-time RSA keypair generator for the endpoint |

### Turning it on

This is off by default (`ENABLE_WHATSAPP_FLOW_BOOKING` seeds to `FALSE` —
see migration `0006_whatsapp_flow_booking_setting.sql`) and falls back to
the existing list/button flow whenever it's off, `WHATSAPP_FLOW_ID` isn't
configured, or sending the flow-trigger message fails for any reason —
see `startBooking()` in `lib/whatsapp/patientFlow.ts`.

1. **Generate a keypair**: `node scripts/generate-flow-keypair.mjs`.
   Paste the printed `WHATSAPP_FLOW_PRIVATE_KEY` /
   `WHATSAPP_FLOW_PRIVATE_KEY_PASSPHRASE` into your `.env`.
2. **Upload the public key** it printed to Meta, for your WhatsApp phone
   number:
   ```bash
   curl -X POST \
     "https://graph.facebook.com/v26.0/<PHONE_NUMBER_ID>/whatsapp_business_encryption" \
     -H "Authorization: Bearer <WHATSAPP_ACCESS_TOKEN>" \
     -F "business_public_key=<paste the PEM public key>"
   ```
3. **Create the Flow** in Meta's Flow Builder (Business Manager → WhatsApp
   Manager → Flows), paste in `whatsapp-flows/booking-flow.json` (or
   recreate the same screens in the visual builder), and set its
   "Endpoint URI" to
   `https://<your-deployed-app>/api/whatsapp/flow?token=<WHATSAPP_WEBHOOK_POST_TOKEN>`
   (same token as the main webhook — see that route's comment for why
   this is fail-closed rather than a separate secret).
4. Publish the Flow, copy its **Flow ID** into `WHATSAPP_FLOW_ID`.
5. Turn on **"Use a native WhatsApp Flow form for Book Appointment"** in
   `/admin/settings`.
6. Use the Flow Builder's own **Preview** panel to test the screens end
   to end before relying on it with real patients.

### Verification status — please read before relying on this

**Not exercised against a live WhatsApp Flow or a real Meta test number**
— there's no reachable WhatsApp Business Account, Flow Builder, or
public HTTPS endpoint from this development environment. What *is*
verified:
- `lib/whatsapp/flowCrypto.ts` has a full round-trip test: a real
  generated RSA keypair encrypts a request the way Meta's servers do
  (per the published spec), this code decrypts it, and the reverse for
  the response — confirms the crypto is internally self-consistent and
  matches the documented algorithm choices.
- `npm run typecheck`, `npm run build`, `npm run lint`, `npm test` all
  pass with these files in place.

What's **not** verified, and worth testing carefully against a real Flow
before going live with it:
- The exact screen/component names and `data`/`payload` wiring in
  `whatsapp-flows/booking-flow.json` — Flow JSON's schema has evolved
  across versions; treat this file as a solid starting draft to validate
  in the Flow Builder's JSON editor, not a guaranteed-correct artifact.
- Whether a completed Flow's `nfm_reply` message reliably arrives at the
  main webhook the way `lib/whatsapp/inbound.ts`/
  `app/api/whatsapp/webhook/route.ts` assume — the booking itself doesn't
  depend on this (it's created server-side inside the Flow endpoint's
  final `data_exchange` call), so a `nfm_reply` that never arrives, or
  arrives in a different shape than expected, degrades to "no
  acknowledgement text sent" rather than a failed or duplicated booking.

---

## Receptionist/admin web UI (stage 4)

A new capability — no equivalent existed in the Apps Script version, which only had the WhatsApp Doctor Portal conversation and direct Google Sheet editing for staff.

### First login (bootstrap)

There's no signup page — admin accounts are only ever created by someone who already has database access, by design (a public signup form for an admin console would be a real security hole). Create the first one with:

```bash
source .env.local  # or otherwise export NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
npm run create-admin -- --email you@clinic.com --password 'a strong password' --name "Your Name"
```

Then sign in at `/admin/login`.

### What's there

| Page | Purpose |
|---|---|
| `/admin/login` | Email/password login (own `admin_users` table + a signed session cookie — **not** Supabase Auth, see below) |
| `/admin` | Dashboard — today's/upcoming appointment counts, active doctor count |
| `/admin/doctors` | List + create doctors — **ADMIN only** |
| `/admin/doctors/[id]` | Edit a doctor's details, manage weekly availability sessions, manage upcoming leaves — **ADMIN only** |
| `/admin/appointments` | Filterable list (doctor/date/status) with actions: mark Completed/No-Show, cancel |
| `/admin/patients` | Read-only, searchable patient registry |
| `/admin/home-collection` | Home sample collection requests, filterable by status, with a per-row status dropdown |
| `/admin/settings` | Every configurable option from the `settings` table, grouped and editable as a real form — **ADMIN only** |

### Design notes

- **Auth is hand-rolled, not Supabase Auth**: `admin_users` (password hashed with Node's built-in `scrypt`, no external dependency) + a signed HTTP-only session cookie (`lib/auth/session.ts`, HMAC-SHA256 keyed by `ADMIN_SESSION_SECRET`, verified with `timingSafeEqual`). Chose this over Supabase Auth because the admin console is a small, fixed set of clinic staff accounts, not end-user signup — didn't want to pull in Auth's email verification/magic-link/OAuth machinery for a need this simple. `supabase/config.toml` has `[auth] enabled = false` accordingly.
- **Every mutation goes through Next.js Server Actions calling the same `lib/*.ts` functions the WhatsApp bot uses** (e.g. admin appointment cancellation calls the identical `cancelAppointment()` from stage 2, with the same Calendar cleanup and status-transition rules) — not a separate, parallel admin-only code path that could drift from the bot's rules over time.

### Admin/Receptionist roles

`admin_users.role` (`ADMIN` | `RECEPTIONIST`) is enforced by
`lib/auth/authorize.ts`:

| Area | ADMIN | RECEPTIONIST |
|---|---|---|
| Dashboard, Appointments, Patients | ✅ | ✅ |
| Doctors (add/edit, availability, leaves) | ✅ | ⛔ redirected to `/admin` |
| Settings | ✅ | ⛔ redirected to `/admin` |

This is a default split, not a policy handed down from the Apps Script
version (which had no admin UI at all, so no precedent existed) — a
receptionist can run day-to-day operations (manage appointments, look up
patients) but not reconfigure doctor rosters/availability or clinic-wide
settings. Adjust `NAV_ITEMS` in `layout.tsx` and the `requireAdminRole`/
`assertAdminRole` calls in each page/action if a clinic wants a
different split.

Two enforcement points per restricted area, not one:
- **Pages/layouts** use `requireAdminRole` (redirects to `/admin/login`
  if not logged in at all, or to `/admin` if logged in with the wrong
  role) — this is what makes a direct URL visit to `/admin/settings`
  redirect a receptionist away instead of rendering the page.
- **Server Actions** use `assertAdminRole` (throws instead of
  redirecting — an action has no page of its own to redirect from). This
  also closed a real gap found while adding this: **none of the admin
  Server Actions checked any session at all before this change**, valid
  or not — a Server Action is a directly callable endpoint independent
  of whichever page renders a button for it, so "the page is behind the
  layout's login check" was never actually sufficient on its own. Every
  mutating action across doctors/appointments/settings now requires a
  valid session at minimum, with the doctors/settings ones additionally
  requiring the `ADMIN` role.

### Verification

`npm run typecheck`, `npm run build`, and `npm test` (107 tests) all
pass; `npm run lint` remains broken for the pre-existing, unrelated Next
16 reason noted elsewhere in this README — ESLint itself via the direct
binary (`./node_modules/.bin/eslint . --ext .ts,.tsx`) is clean. No
dedicated test file for `lib/auth/authorize.ts` — it's coupled to
Next.js's `cookies()`, same reasoning `lib/auth/session.ts` itself has
never had one either (only the pure `lib/auth/password.ts` does). The
pages/Server Actions themselves are typechecked and built successfully
but — same caveat as every stage so far — not yet exercised against a
live Supabase instance from this environment, so the actual
redirect/rejection behavior for a real RECEPTIONIST login hasn't been
clicked through end to end.

---

## Database schema

See [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql)
for the full schema with column-level comments cross-referencing the
original Google Sheet each table replaces. Summary:

| Table | Was (Apps Script sheet) |
|---|---|
| `doctors` | `Doctors` |
| `doctor_availability` | `Availability` |
| `doctor_leaves` | `Doctor_Leaves` |
| `patients` | `Patients` |
| `appointments` | `Appointments` |
| `whatsapp_sessions` | `WhatsApp_Sessions` |
| `home_collection_requests` | `Home_Collection_Requests` |
| `message_log` | `WhatsApp_Log` (consolidated inbound/outbound/reminder ledger) |
| `settings` | `Settings` |
| `admin_users` | *(new — no admin UI existed before this rewrite)* |

[`0002_rls.sql`](supabase/migrations/0002_rls.sql) enables Row Level
Security on every table with **no** policies for anon/authenticated roles
— every read/write goes through a Next.js API route using the Supabase
service-role key (`lib/supabase/server.ts`), which bypasses RLS by design.
The browser never talks to Supabase directly.

Regenerate TypeScript types from the live schema once local Supabase is
running (this overwrites the hand-written
[`lib/supabase/database.types.ts`](lib/supabase/database.types.ts), which
was written by hand to match the migration since Docker/Supabase CLI
weren't available in the environment this scaffold was first built in):
```bash
npm run db:types
```

---

## Scheduled jobs (reminders, auto-complete-past-appointments)

Two background jobs need something external to trigger them
periodically — they're plain HTTPS `GET` endpoints, not self-scheduling:

| Job | Endpoint | Suggested cadence | Reads |
|---|---|---|---|
| Appointment reminders | `/api/cron/reminders` | Every 30 minutes | `lib/reminders.ts` |
| Auto-complete past appointments | `/api/cron/auto-complete` | Hourly | `lib/autoComplete.ts` |
| `message_log` retention cleanup | `/api/cron/log-cleanup` | Daily | `lib/logCleanup.ts` |

All three are protected by `CRON_SECRET` (see `.env.example`) — every
request must send `Authorization: Bearer <CRON_SECRET>`, checked with a
constant-time comparison (`lib/cronAuth.ts`), same fail-closed pattern
as `WHATSAPP_WEBHOOK_POST_TOKEN`. **Reminders/auto-complete are also
still gated by their own setting** (`ENABLE_APPOINTMENT_REMINDERS`,
`AUTO_COMPLETE_PAST_APPOINTMENTS` in `/admin/settings`) — the schedule
below only controls how often the endpoint is *checked*, not whether it
does anything. Log cleanup has no on/off setting of its own — `LOG_RETENTION`/
`LOG_MAX_ROWS` control how aggressive it is, not whether it runs at all.

### Option A — Vercel Cron (if deploying to Vercel)

[`vercel.json`](vercel.json) already declares all three schedules. Vercel
sends the `Authorization` header automatically as long as `CRON_SECRET`
is set in the project's environment variables — nothing else to
configure. **Note**: Vercel's free (Hobby) tier historically limits
cron jobs to once/day — running every 30 minutes may require a paid
plan. Check Vercel's current pricing page rather than trusting this
number, since it's the kind of detail that changes.

### Option B — any external scheduler (Docker / self-hosted deployments)

`vercel.json` has no effect outside a Vercel deployment. Point any
scheduler capable of an HTTPS call + a custom header at the same three
URLs — a `crontab` entry, a GitHub Actions scheduled workflow, an
external uptime/cron service (cron-job.org, etc.):

```bash
# Example crontab entries (adjust the host):
*/30 * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://your-app.example.com/api/cron/reminders
0 * * * *    curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://your-app.example.com/api/cron/auto-complete
0 3 * * *    curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://your-app.example.com/api/cron/log-cleanup
```

**Verification status**: not exercised against a live scheduler from
this environment (no reachable Vercel project or external cron
service) — `lib/reminders.ts`/`lib/autoComplete.ts`'s logic is
typechecked, tested where the logic is timezone-sensitive
(`lib/afterHours.test.ts` for the related after-hours gate), and the
routes themselves build successfully, but the actual scheduled
invocation path (Vercel Cron's request shape, or a real `curl` hitting
a deployed URL) hasn't been run for real.

---

## Deploying

**Verification status**: the steps below follow standard, well-documented
patterns for each piece (Supabase cloud projects, Vercel, Docker's
official Next.js "standalone" pattern) — but they have **not been run
end-to-end** from this environment. There's no reachable Supabase
account, Docker daemon, or hosting account here to actually execute a
deploy and confirm it works — see the note at the top of this repo's
[root README](../README.md) and the "What's tested vs. what isn't yet"
sections above. Treat this as a solid starting runbook, not a
verified-working one; expect to debug the first real attempt.

### 1. Create a Supabase project

1. Create a project at [supabase.com](https://supabase.com) (or self-host
   Supabase — out of scope here).
2. Apply the migrations in [`supabase/migrations/`](supabase/migrations)
   in order, either via `supabase link` + `supabase db push` (Supabase
   CLI), or by pasting each file's contents into the SQL Editor in order.
3. From **Project Settings → API**, note the **Project URL**, **anon
   public key**, and **service_role key** (server-only, treat as a
   secret).
4. Run [`scripts/create-admin-user.mjs`](scripts/create-admin-user.mjs)
   once against this project (see "First login" above) to create your
   first admin login.

### 2. Set up Google Calendar access

1. Create a Google Cloud project (or reuse one) and enable the
   **Google Calendar API**.
2. Create a **service account**, generate a JSON key for it.
3. From the key JSON, take `client_email` →
   `GOOGLE_SERVICE_ACCOUNT_EMAIL`, and `private_key` →
   `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` (keep the `\n` sequences literal
   when pasting into an env var — see `.env.example`'s comment).
4. For **each doctor**, share their Google Calendar with the service
   account's email address (Calendar → Settings → "Share with specific
   people" → grant **"Make changes to events"**).

### 3. Collect the rest of the environment variables

Fill in every variable in [`.env.example`](.env.example) — same
`WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` as the Apps Script
version if you're migrating from it, plus two you choose yourself:
`WHATSAPP_VERIFY_TOKEN` (must match what you enter in Meta's webhook
config) and `WHATSAPP_WEBHOOK_POST_TOKEN` (appended as `?token=...` to
the callback URL you give Meta). Generate `ADMIN_SESSION_SECRET` with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 4a. Deploy to Vercel (simplest path)

1. Import the repo into [Vercel](https://vercel.com), setting the
   **root directory** to `clinic-app` (this isn't the repo root).
2. Add every variable from step 3 under Project Settings → Environment
   Variables.
3. Deploy. Your webhook URL is
   `https://<your-vercel-domain>/api/whatsapp/webhook`.

### 4b. Deploy as a Docker container (self-hosted / any container host)

A [`Dockerfile`](Dockerfile) is included, using Next.js's
[`output: "standalone"`](next.config.mjs) mode — a multi-stage build
that ships only the traced runtime dependencies, not the full dev
`node_modules` or source tree.

```bash
docker build -t clinic-app .
docker run --env-file .env.local -p 3000:3000 clinic-app
```

or, for local convenience, `docker compose up --build` (see
[`docker-compose.yml`](docker-compose.yml)). This runs the same image
you'd deploy to Fly.io, Render, Cloud Run, a VPS, etc. — point whichever
host at this `Dockerfile` and supply the same environment variables from
step 3. Your webhook URL is `https://<your-host>/api/whatsapp/webhook`.

One thing the Dockerfile deliberately does **not** do: it doesn't copy
this repo's `.npmrc` into the build (that file sets `strict-ssl=false`,
a workaround for a broken CA bundle in the sandbox this project was
first scaffolded in — not something that should silently disable TLS
verification in your own build environment too).

### 5. Configure Meta's WhatsApp webhook

In [Meta for Developers](https://developers.facebook.com/) → your app →
**WhatsApp → Configuration**:

1. **Callback URL**: your deployed `/api/whatsapp/webhook` URL, with
   `?token=YOUR_WHATSAPP_WEBHOOK_POST_TOKEN` appended.
2. **Verify token**: must exactly match `WHATSAPP_VERIFY_TOKEN`.
3. Click **Verify and save**, then subscribe to the **`messages`**
   webhook field.

### 6. Smoke test

- Send **Hi** from a WhatsApp number not yet in `patients` — expect the
  language menu (or main menu, if you've pre-set a language), and a new
  row appear in `message_log`.
- Complete a full booking — expect a row in `appointments` and a new
  event on the doctor's Google Calendar.
- Log into `/admin` with the account from step 1.4 and confirm the
  booking shows up under Appointments.

---

## Deploying to multiple hospitals

**The codebase has no multi-tenancy** — every table assumes one
hospital's data, and every env var assumes one WhatsApp Business number.
The supported way to serve multiple hospitals is **one Docker image,
deployed once per hospital**, each pointed at its own Supabase project
and its own WhatsApp number. Same code everywhere; only environment
variables differ between deployments. This isn't a limitation to work
around so much as the standard pattern for healthcare-adjacent
software — each hospital's data physically lives in its own database,
never mixed with anyone else's, which is also the easiest thing to tell
a hospital's compliance/privacy officer.

*(The alternative — one shared deployment/database serving every
hospital, with a `hospital_id` column threaded through every table and
query — is real, substantial implementation work this rewrite hasn't
done. Worth revisiting only once managing N separate Supabase projects
is itself the bottleneck, which for WhatsApp-bot-scale traffic means a
lot of hospitals.)*

### What's shared across hospitals vs. what isn't

| Resource | Shared across all hospitals? |
|---|---|
| This codebase / Docker image | **Yes** — build once, deploy the same image everywhere |
| Google Cloud project + service account | **Can be shared** — Calendar access is granted per-*calendar* (each doctor shares their calendar with the service account's email), not per Google Cloud project, so one service account can serve every hospital's doctors |
| Container registry | **Yes** — push one image, reference it from every hospital's deployment |
| Supabase project (database) | **No — one per hospital**, full isolation |
| WhatsApp Business phone number, access token, verify token, webhook post token | **No — one per hospital.** Meta issues a `phone_number_id` per number regardless of architecture, and each hospital's webhook subscription must point at *that hospital's* deployed URL, so this was never shareable either way |
| `ADMIN_SESSION_SECRET` | **No — unique per hospital.** Sharing it would let a forged/leaked session cookie from one hospital's deployment be replayed against another's |
| Admin user accounts (`admin_users` rows) | **No** — each hospital's database is separate, so this falls out automatically |

### Provisioning a new hospital

Repeat the full "Deploying" runbook above per hospital, tracking these
per-hospital values somewhere (a spreadsheet, a secrets manager, your
hosting provider's project-naming convention — anything that scales
better than memory once you're past 2-3):

| Field | Example |
|---|---|
| Hospital name / slug | `sunrise-clinic` |
| Supabase project URL + keys | *(from Supabase dashboard)* |
| WhatsApp `phone_number_id` + access token | *(from Meta for Developers)* |
| `WHATSAPP_VERIFY_TOKEN` / `WHATSAPP_WEBHOOK_POST_TOKEN` | generate fresh per hospital, don't reuse |
| `ADMIN_SESSION_SECRET` | generate fresh per hospital, don't reuse |
| Deployed URL | `https://sunrise-clinic.yourhost.com` |
| Admin login | created via `npm run create-admin` against that hospital's Supabase project |

### Rolling out an update to every hospital

Since every deployment runs the identical image:

1. Build and push one new image version (tag it, e.g. `clinic-app:v1.2.0`) to your registry.
2. Update each hospital's deployment to the new tag — one at a time if
   you want a staggered rollout (catch a bug against one hospital before
   it reaches the rest), or all at once if your hosting platform
   supports a fleet-wide redeploy.
3. Database migrations (new files under `supabase/migrations/`) still
   need to be applied to **each hospital's Supabase project**
   individually — there's no shared database to migrate once and be
   done. `supabase link` + `supabase db push` against each project (or
   a small script looping over your list of project refs) is the
   practical way to do this once you have more than a couple.

### Auto-scaling

Each hospital's deployment can auto-scale independently on whatever
host you choose (replica count, restart-on-crash, etc.) — the app is
stateless (all state lives in that hospital's Postgres/Supabase, not in
the container), so running multiple replicas of one hospital's
deployment is safe. In practice, a single clinic's WhatsApp message
volume is unlikely to need more than 1-2 replicas; auto-scaling here is
mostly about availability (a crashed container gets replaced) rather
than handling real load spikes.
