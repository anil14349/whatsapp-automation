# Module 2 — Edge functions

Nineteen Deno functions on Supabase. They are the whole backend: the WhatsApp
bot, the staff API, and the reminder runner.

## What is deployed

| Function | Purpose | JWT |
|---|---|---|
| `webhook` | Every inbound WhatsApp message | **off** |
| `scheduled-reminders` | Called by pg_cron, sends due reminders | on |
| `admins-auth-login` | Owner and platform admin sign-in | on |
| `doctors-auth-login` | Doctor sign-in, by number or email | on |
| `doctors-auth-me` | Current doctor | on |
| `doctors-auth-password-reset` | Doctor reset | on |
| `receptionists-auth-login` | Receptionist sign-in, by number or email | on |
| `receptionists-auth-password-reset` | Receptionist reset | on |
| `receptionists-appointments` | Day list, search, walk-in, delay notice | on |
| `doctors-appointments` | A doctor's own day | on |
| `doctors-appointments-update-status` | Seen / no-show | on |
| `doctor-schedule` | Consulting hours, visiting hours, leave | on |
| `staff` | Create, edit, deactivate, reset credentials | on |
| `services` | Which services a clinic offers | on |
| `clinics` | Activate and deactivate clinics (platform admin) | on |
| `clinic-settings` | Clinic details, hours, closures, location | on |
| `clinic-branding` | Name, logo and colour for any signed-in user | on |
| `clinic-summary` | Owner's figures | on |
| `patient-documents` | Send a report or prescription | on |

## Configuration required

Set as Supabase secrets, not files. `npx supabase secrets list --project-ref <ref>`.

| Secret | Required | Purpose |
|---|---|---|
| `SUPABASE_URL` | provided | Set by the platform |
| `SUPABASE_SERVICE_ROLE_KEY` | provided | Set by the platform |
| `JWT_SECRET` | **yes** | Signs portal tokens. High entropy. |
| `WHATSAPP_ACCESS_TOKEN` | yes | Fallback when a clinic has no token of its own |
| `WHATSAPP_PHONE_NUMBER_ID` | yes | Same |
| `WHATSAPP_VERIFY_TOKEN` | yes | Meta's webhook handshake |
| `WHATSAPP_WEBHOOK_POST_TOKEN` | yes | Query-string token on inbound posts |
| `DEFAULT_CLINIC_ID` | yes | Used when a number matches no clinic |
| `ALLOWED_ORIGINS` | yes | Comma separated. **Must list the portal's real origin** or the browser is blocked. |
| `SCHEDULER_AUTH_TOKEN` | yes | Shared with the cron job |
| `HOME_COLLECTION_MIN_LEAD_HOURS` | no | Default 2 |
| `MAX_COLLECTIONS_PER_COLLECTOR_PER_DAY` | no | Default 8 |
| `RESEND_API_KEY` | no | Email delivery. Unset means credentials are shown to the admin instead. |
| `EMAIL_FROM`, `PORTAL_BASE_URL` | no | Only with Resend |
| `ALLOW_SHARED_DOCTOR_PIN` | no | Leave unset. `true` re-enables a shared PIN. |
| `ALLOW_SELF_SERVICE_PIN_RESET` | no | `false` disables "forgot PIN" |
| `DEBUG_MODE` | no | `true` is very noisy |
| `CLINIC_IDS` | no | Restricts the scheduler to a subset. **Leave unset** or new clinics are silently skipped. |
| `TEMPLATE_*` | no | Override a template name per clinic. See [Module 3](MODULE_3_WHATSAPP.md). |

```powershell
npx supabase secrets set JWT_SECRET=<value> --project-ref <ref>
```

`secrets list` shows a plain unsalted SHA-256 of each value, so a low-entropy
secret there is recoverable from the listing itself. Use random values.

## Deploying

From the **repo root**, not from `supabase/functions`:

```powershell
npx supabase functions deploy <name> --project-ref <ref> --use-api
```

The webhook is the exception and must keep its flag:

```powershell
npx supabase functions deploy webhook --project-ref <ref> --use-api --no-verify-jwt
```

- `--use-api` avoids Docker. Without it the CLI needs a Linux container engine.
- `--no-verify-jwt` is **required** for the webhook. Without it Meta's post is
  rejected with `UNAUTHORIZED_NO_AUTH_HEADER` before the function runs. Every
  other function must keep verification on.

Shared code under `supabase/functions/shared/` is bundled into each function
that imports it, so **changing a shared file means redeploying every function
that uses it**. After a change to `patient-handler.ts` or `proactive.ts`, that
is usually `webhook` and `scheduled-reminders` at minimum.

## Verifying

```powershell
npm run typecheck   # all 19 entrypoints
```

This matters more than it sounds: Supabase does **not** type check on deploy,
and `deno test` only checks what the tests import. This gate has caught calls
to methods that do not exist, which deploy accepts silently.

After deploying, exercise the function rather than trusting the output:

```powershell
curl.exe -s --ssl-revoke-best-effort `
    -H "apikey: <anon>" -H "Authorization: Bearer <anon>" `
    -H "X-Portal-Token: <portal jwt>" `
    "https://<ref>.supabase.co/functions/v1/clinic-summary?range=week"
```

## Authentication shape

Two headers, and both are needed:

- `Authorization: Bearer <anon key>` satisfies the Supabase gateway.
- `X-Portal-Token: <app JWT>` is the application's own session.

Putting the app JWT in `Authorization` returns `401 UNAUTHORIZED_LEGACY_JWT`
from the gateway before the function is reached.

## Things that have bitten before

**Deployed does not always mean deployed.** A warm isolate can keep serving the
previous bundle. If a new guard never fires while an older guard in the same
function still does, deploy again.

**Async bcrypt throws** in this runtime — it spawns a Web Worker, which
Supabase edge functions do not support. Use `hashSync` / `compareSync`.

**SMTP is impossible** here; ports 25 and 587 are blocked. Email must go over
an HTTP API.

**In-memory state does not survive.** Isolates are recycled between messages,
so a login attempt counter held in a module-level variable never locks anyone
out. Rate limiting lives in `login_rate_limits`.
