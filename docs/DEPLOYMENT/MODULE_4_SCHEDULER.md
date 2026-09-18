# Module 4 — Reminder scheduler

A pg_cron job that calls `scheduled-reminders` every minute. Without it,
reminders are created and never sent.

## What is deployed

`supabase/migrations/019_schedule_reminders.sql`, plus two secrets held in
Vault.

## Configuration required

The job needs a URL and a token, and neither can live in a custom database
setting: `ALTER DATABASE ... SET app.*` fails on Supabase with `42501` because
the postgres role is not superuser. They go in Vault instead.

Run once, in the SQL editor:

```sql
CREATE EXTENSION IF NOT EXISTS supabase_vault;

SELECT vault.create_secret('<SCHEDULER_AUTH_TOKEN value>', 'scheduler_token');
SELECT vault.create_secret('https://<ref>.supabase.co/functions/v1', 'functions_url');
```

The URL is stored rather than hardcoded so the migration stays portable between
projects. Migration 019 raises an error naming whichever secret is missing,
rather than creating a job that silently fails.

`scheduler_token` must equal the `SCHEDULER_AUTH_TOKEN` secret from
[Module 2](MODULE_2_EDGE_FUNCTIONS.md). The function rejects the call
otherwise.

## Deploying

1. Create the Vault secrets above.
2. Run `019_schedule_reminders.sql`.
3. Deploy `scheduled-reminders` **with the flag**:

```powershell
npx supabase functions deploy scheduled-reminders --project-ref <ref> --use-api --no-verify-jwt
```

The cron job authenticates with `Authorization: Bearer <scheduler_token>`, and
that token is a random string rather than a Supabase JWT. With gateway
verification on, the request is rejected with
`UNAUTHORIZED_INVALID_JWT_FORMAT` before the function runs. The function checks
the token itself, so nothing is lost by turning the gateway check off.

**This has already happened once.** The function was redeployed without the
flag during unrelated work and reminders stopped, with nothing to show for it:
cron still reported success, the function logged nothing because it never ran,
and the rows stayed `PENDING`. Check after every deployment of this function:

```powershell
curl.exe -s -X POST -H "Authorization: Bearer not-a-jwt" `
    "https://<ref>.supabase.co/functions/v1/scheduled-reminders"
```

`{"error":"Unauthorized"}` is correct — that is the function talking. A
response with a `code` field is the gateway, and means the flag is missing.

## Verifying

**`cron.job_run_details` says "succeeded" even when the call never lands**,
because `net.http_post` only queues the request and returns an id. Real status
codes are in `net._http_response`.

The reliable check needs no database access. Plant an overdue reminder and wait:

```sql
INSERT INTO appointment_reminders
    (clinic_id, appointment_id, patient_phone, reminder_type, scheduled_time, status)
VALUES
    ('<clinic>', '<an appointment id>', '<number>', '24_HOUR', NOW() - INTERVAL '5 minutes', 'PENDING');
```

Poll that row for about five minutes without triggering anything. Still
`PENDING` means nothing is calling the function. It should move to `SENT` with
a real `wamid` within roughly two minutes.

To confirm the function itself is healthy, call it directly:

```powershell
curl.exe -s -X POST -H "Authorization: Bearer <SCHEDULER_AUTH_TOKEN>" `
    "https://<ref>.supabase.co/functions/v1/scheduled-reminders"
```

## `SENT` does not mean delivered

The scheduler sends a reminder as an interactive message with Cancel and
Reschedule buttons. Meta accepts that call, returns a message id, and reports
`131047` **afterwards**, on the status webhook — the patient last wrote to us
more than 24 hours ago, which is true of almost every reminder. The row was
marked `SENT` the moment the id came back, so nothing retried and nobody knew.

Two pieces close that gap, both from
`036`-era work (`035_reminder_force_template.sql`):

- The status webhook matches Meta's message id back to the reminder through
  `appointment_reminders_by_message` and calls `recordReminderDelivery` in
  [delivery-status.ts](../../supabase/functions/shared/delivery-status.ts).
- A late failure puts the row back to `PENDING` with `force_template = TRUE`,
  and the next scheduler pass sends the approved template rather than repeating
  the same doomed free-form message.

So a reminder can legitimately go `PENDING → SENT → PENDING → SENT`, and a row
sitting at `FAILED` with a `132001` is telling you the **template is not
approved**, not that the scheduler is broken.

Counting sent reminders therefore means counting `SENT` **and** `DELIVERED`.
The owner's summary read zero for a working day because it counted only the
first, and the "Not delivered" tile exists to make the failures visible rather
than letting them read as silence.

## Things that have bitten before

**`CLINIC_IDS` is an optional filter, not a list of clinics to serve.** While it
was set, newly added clinics were silently skipped by the scheduler. Leave it
unset unless you are deliberately restricting the run.

**One client per clinic.** The scheduler enumerates active clinics and builds a
WhatsApp client for each. A single environment-based client would send every
clinic's reminders from the default number — a cross-tenant leak. A clinic with
a bad token fails alone and does not affect the others.

**Rotate the token if it has ever been committed.** `SCHEDULER_AUTH_TOKEN` was
rotated once for exactly this reason. Changing it means updating both the
Supabase secret and the Vault secret, in either order, quickly.
