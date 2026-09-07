# ABC Clinic — Next.js + Supabase rewrite

Rewrite of the Apps Script bot in [`../src`](../src) (patient/doctor WhatsApp
bot + Google Sheets/Calendar) into a Next.js + Postgres (Supabase) app with a
receptionist/admin web UI. See the root [README](../README.md) and this
branch's history for the architecture decisions behind this rewrite.

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
   npm run db:reset   # applies every migration in supabase/migrations/ fresh
   ```
   `db:start` prints a local `anon`/`service_role` key pair and API URL —
   put those into `.env.local`.

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

**Deferred to a later increment** (each follows the same pattern
established here, so this is scoping work, not redesign work):
- My Appointments / cancel / reschedule patient sub-flows
- The "More" menu (change language, etc.)
- Doctor conversation flow entirely (a doctor messaging in gets a
  placeholder reply, not the Doctor Portal)
- Home blood-sample-collection flow
- Doctor-selection and slot-list **pagination** (this version lists
  everything on one screen, capped at WhatsApp's 10-row list limit —
  fine for a handful of doctors, not yet built out for more)
- The shareable appointment receipt card (image generation)
- Appointment reminders, after-hours auto-reply, auto-complete-past-
  appointments background jobs

### Verification

`npm run typecheck`, `npm run build`, `npm run lint`, and `npm test`
(61 tests) all pass. As with stage 2, the parts with real branching
logic and no required I/O are unit-tested (inbound message parsing,
localization incl. round-tripping every language against the extracted
dictionaries, menu spec builders, slot-selection id encoding/decoding).
The webhook route and the conversation flow handlers that orchestrate
Supabase + WhatsApp Cloud API + Calendar calls are typechecked but not
yet exercised against a live WhatsApp number/database — see "What's
tested vs. what isn't yet" under stage 2 above; the same caveat applies
here.

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
| `/admin/doctors` | List + create doctors |
| `/admin/doctors/[id]` | Edit a doctor's details, manage weekly availability sessions, manage upcoming leaves |
| `/admin/appointments` | Filterable list (doctor/date/status) with actions: mark Completed/No-Show, cancel |
| `/admin/patients` | Read-only, searchable patient registry |
| `/admin/settings` | Every configurable option from the `settings` table, grouped and editable as a real form |

### Design notes

- **Auth is hand-rolled, not Supabase Auth**: `admin_users` (password hashed with Node's built-in `scrypt`, no external dependency) + a signed HTTP-only session cookie (`lib/auth/session.ts`, HMAC-SHA256 keyed by `ADMIN_SESSION_SECRET`, verified with `timingSafeEqual`). Chose this over Supabase Auth because the admin console is a small, fixed set of clinic staff accounts, not end-user signup — didn't want to pull in Auth's email verification/magic-link/OAuth machinery for a need this simple. `supabase/config.toml` has `[auth] enabled = false` accordingly.
- **Every mutation goes through Next.js Server Actions calling the same `lib/*.ts` functions the WhatsApp bot uses** (e.g. admin appointment cancellation calls the identical `cancelAppointment()` from stage 2, with the same Calendar cleanup and status-transition rules) — not a separate, parallel admin-only code path that could drift from the bot's rules over time.
- **No ADMIN vs. RECEPTIONIST permission split yet** — the `admin_users.role` column exists (for exactly this purpose later) but every logged-in user currently sees the same full UI. Worth adding once there's a real policy for what a receptionist shouldn't be able to touch (e.g. maybe settings, or deleting doctors).

### Verification

`npm run typecheck`, `npm run build`, `npm run lint` all pass; `npm test` — 65 tests (4 new, covering password hashing: correct/incorrect verification, salting, and graceful rejection of a corrupted hash instead of throwing). The pages/Server Actions themselves are typechecked and built successfully but — same caveat as every stage so far — not yet exercised against a live Supabase instance from this environment.

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

## Deploying

Not yet documented — this stage is scaffold-only. Once the app has real
functionality, this section will cover: creating a real (cloud) Supabase
project, applying migrations to it, setting environment variables on
Vercel (or your chosen host), and pointing Meta's WhatsApp webhook at the
deployed `/api/whatsapp/webhook` URL.
