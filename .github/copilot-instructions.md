# Working on this repository

A WhatsApp booking system for clinics. Patients book, cancel and reschedule
over WhatsApp; staff work in a Next.js portal; reminders go out on a cron.
Multi-tenant — every row belongs to a clinic, and that is load-bearing.

**No secrets in this file.** Names and locations only; the values live in
`.env.local`, Supabase function secrets, and Vault.

---

## Layout

| Path | What it is |
|---|---|
| `supabase/functions/` | 19 Deno edge functions. `shared/` holds everything reused. |
| `supabase/functions/shared/handlers/patient-handler.ts` | The WhatsApp conversation, state by state. The biggest file here. |
| `supabase/migrations/` | 36 SQL files, applied in filename order. |
| `clinic-app/` | The staff portal (Next.js, app router). |
| `docs/` | Start at [INDEX.md](../docs/INDEX.md). [BACKLOG.md](../docs/BACKLOG.md) is the accepted-gaps list. |
| `scripts/` | The verification gates. |

---

## Commands

```powershell
npm run verify        # types, tests, and seven static gates. No network.
npm run verify:schema # every column reference against the live database
npm run typecheck     # edge functions only, much faster
```

**Run `npm run verify` on its own and read `EXIT=`.** Piping it through
`Select-String` or `Select-Object` loses the exit code, and a green-looking tail
has hidden a failure here before.

A whole conversation against the live webhook, asserted and cleaned up:

```powershell
.\scripts\flow.ps1 -Scenario home-collection
```

It signs the payloads the way Meta does, so it exercises the real function.
Two things to know: forging an inbound message does **not** open a 24-hour
window at Meta, so replies to that number fail `131047` today but could be
delivered once a template is approved — which is why it defaults to the test
handset rather than inventing a number. And a patient may hold only one
confirmed appointment, so the script refuses to start if the number already
has one rather than reporting nine confusing failures.

Deploying an edge function:

```powershell
$a = @("supabase","functions","deploy","<name>","--project-ref","<ref>","--use-api")
npx @a
```

Splat an array — `npx @a`. Do **not** use `$args`: it is a PowerShell automatic
variable, and using it opened an interactive sub-shell that deployed nothing
while appearing to succeed.

Commit messages go through a file, because they are long and contain characters
the shell will eat:

```powershell
[IO.File]::WriteAllText("$env:TEMP\msg.txt", $m)
git commit -F "$env:TEMP\msg.txt"
```

---

## Traps that have already cost time

**`--no-verify-jwt` is mandatory for `webhook` and `scheduled-reminders`.**
Redeploying either without it silently breaks them: the gateway rejects the
call before the function runs, cron still reports success, and rows sit
`PENDING`. Check after every deploy — a plain-text refusal is the function
talking; a JSON body with a `code` field is the gateway, and means the flag is
missing.

**Never run `npm run build` in `clinic-app` while `npm run dev` is running.**
They share `.next` and the production build corrupts the dev server's chunks.
The symptom is `Cannot find module './543.js'` and server actions doing nothing.

**Dates come from the clinic, not the server.** The runtime is UTC and the
clinics are not. Always
`todayInTimezone(await getClinicTimezone(supabase, clinicId))`, never
`new Date().toISOString().slice(0, 10)`. `npm run verify:clinic-time` fails the
build on a reintroduction, and has caught one.

**`clinic_operating_hours.opening_time` is `varchar(5)`, not `time`.** Casting
`::time` produces `06:30:00` and Postgres refuses it.

**Partial updates must send only what the form carried.** The settings PATCH
writes any key it is given, so reading a field the current form does not have
yields `""` and blanks the column. An unticked checkbox is absent from a form
post exactly like a field from another section, so a section that owns one posts
a hidden marker to tell the two apart.

**Migrations are applied through the dashboard SQL editor**, in filename order.
`DATABASE_URL` in the repo is a placeholder, so `supabase db push` does not run
here. Every migration is written to be safe to run twice.

---

## Conventions that are deliberate

**Clinic scoping.** Every clinic-scoped query names a clinic, enforced by
`verify:clinic-scope`. That gate checks *queries*, not *inserts* — inbound
WhatsApp messages were being written with a null `clinic_id` for months and it
passed throughout. When you add an insert, check the clinic id is on it.

**Two slot paths, same rules.** `getClinicServiceSlots` serves services with no
doctor; `getAvailableSlots` serves anything with one. Both honour the service's
notice period and time window, but `getAvailableSlots` takes a doctor id, so
**the service must be passed in** or you get the doctor's whole day.

**Unconfigured means permissive, not broken.** A clinic with no coordinates
accepts any location rather than refusing every patient. This is why the portal
refuses to switch home collection on until the four things it needs exist.

**Settings is routed sections**, one card per route, under a shared layout with
a sticky nav. There is no `width` prop on `PortalShell` — header, main and
footer all read one constant, so they cannot drift apart.

**Secondary text stops at `slate-500`.** `slate-400` on white is 2.56:1 and
fails WCAG AA at these sizes. Disabled controls are exempt. Design feedback
repeatedly asks for fainter labels; the answer is size, weight and position,
not less contrast.

**Comments say why, not what.** Most explain a decision or name a failure that
has actually happened. Match that.

---

## Verifying work

Claims about behaviour are expected to be backed by something. In practice:

- read the database back after a write, and compare against a baseline you
  captured **before**
- measure the DOM rather than describing a screenshot
- restore any test data you changed, and say so if you cannot

Test appointments are prefixed so they can be found and deleted. Check for
rows the action created as a side effect — marking a no-show writes an audit
entry.

---

## Infrastructure

- Supabase project region matters: the clinic is in India and the project is in
  Mumbai (`ap-south-1`). An earlier Tokyo project is kept only as a rollback.
  The live project is still *named* `migration-replay-scratch` — renaming is
  dashboard-only. [docs/DEPLOYMENT/LIVE_PROJECT.md](../docs/DEPLOYMENT/LIVE_PROJECT.md)
  says which ref is which and how to roll back.
- The portal needs `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `DEFAULT_CLINIC_ID` and
  `PORTAL_SESSION_SECRET`, all server-side. None takes a `NEXT_PUBLIC_` prefix:
  the browser never talks to Supabase directly, and the session cookie is
  HMAC-signed so its contents can be trusted.
- The scheduler reads its URL and token from Vault, because
  `ALTER DATABASE ... SET app.*` fails on Supabase with `42501`.
- WhatsApp templates must be approved by Meta before any message reaches a
  patient outside the 24-hour window. Deleting a template name makes it
  unusable for some time — hence `patient_document_v2`.

Read [docs/BACKLOG.md](../docs/BACKLOG.md) before assuming something is
finished. It lists what is knowingly unbuilt and why.
