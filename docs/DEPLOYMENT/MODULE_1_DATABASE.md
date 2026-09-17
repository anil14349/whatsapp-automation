# Module 1 â€” Database

Postgres schema and the private file bucket. Everything else depends on this,
and nothing else can repair a missing column at run time.

## What is deployed

- `supabase/migrations/*.sql` â€” 29 files, applied in filename order.
- One storage bucket, `patient-documents`.
- One storage bucket, `clinic-logos`.
- One storage bucket, `appointment-calendar`.

## Configuration required

Nothing at run time. Applying migrations needs either the database password or
access to the SQL editor.

## Applying migrations

`DATABASE_URL` in this repo is a placeholder, so `supabase db push` does not
run here. Migrations are applied through the dashboard:

1. Supabase dashboard â†’ **SQL Editor**.
2. Open the migration file, paste the whole thing, run it.
3. Apply in filename order. Never skip one â€” several depend on earlier columns.

Every migration is written to be safe to run twice: columns use
`ADD COLUMN IF NOT EXISTS`, and constraints are wrapped in a `DO` block that
swallows `duplicate_object`. Re-running a migration you are unsure about is
cheaper than guessing.

### Confirming one landed

```powershell
npm run verify:schema
```

This reads the live schema and checks every column name the code references.
An unapplied migration shows as:

```
verify-schema: tables referenced that the database does not have
  supabase\functions\patient-documents\index.ts:46  patient_documents
A migration that has not been applied looks exactly like this.
```

## The storage bucket

Created once. Private, 10 MB per object, and restricted to the three types the
portal accepts.

```powershell
$key = (Select-String -Path .env.local -Pattern '^SU_SERVICE_ROLE_KEY=(.+)$').Matches[0].Groups[1].Value
$body = @{
    id = "patient-documents"
    name = "patient-documents"
    public = $false
    file_size_limit = 10485760
    allowed_mime_types = @("application/pdf", "image/jpeg", "image/png")
} | ConvertTo-Json -Compress
[IO.File]::WriteAllText("$env:TEMP\bucket.json", $body)

curl.exe -s --ssl-revoke-best-effort -H "apikey: $key" -H "Authorization: Bearer $key" `
    -H "Content-Type: application/json" -X POST `
    --data "@$env:TEMP\bucket.json" "https://<ref>.supabase.co/storage/v1/bucket"
```

**Private is not an optimisation.** A lab report in a public bucket is readable
by anyone who guesses the path. Delivery uses a signed URL that expires in ten
minutes, which is long enough for Meta to fetch the file once and no longer.

The size and type limits are enforced by storage itself, so a bad upload is
refused before any of our code sees it. The edge function checks the same
things again for a clear error message, not for safety.

### The logo bucket

Also created once. **Public**, unlike the one above: a logo appears on every
page of the portal, so a signed URL would expire part-way through a session,
and a logo is the one thing a clinic most wants seen.

```powershell
$key = (Select-String -Path .env.local -Pattern '^SU_SERVICE_ROLE_KEY=(.+)$').Matches[0].Groups[1].Value
$body = @{
    id = "clinic-logos"
    name = "clinic-logos"
    public = $true
    file_size_limit = 2097152
    allowed_mime_types = @("image/png", "image/jpeg", "image/webp")
} | ConvertTo-Json -Compress
[IO.File]::WriteAllText("$env:TEMP\bucket.json", $body)

curl.exe -s --ssl-revoke-best-effort -H "apikey: $key" -H "Authorization: Bearer $key" `
    -H "Content-Type: application/json" -X POST `
    --data "@$env:TEMP\bucket.json" "https://<ref>.supabase.co/storage/v1/bucket"
```

**SVG is deliberately not allowed.** A browser opening an SVG directly runs any
script inside it, on the storage origin â€” in a public bucket that is stored
cross-site scripting that anyone can be linked to. PNG, JPEG and WebP cannot do
this.

Objects are keyed `<clinic-id>/<random>.<ext>`, built by the server and never
from the uploaded filename, so one clinic cannot write into or delete from
another's folder. Replacing a logo deletes the previous object; a logo the
clinic hosts elsewhere is left alone, because it was never ours.

### The calendar bucket

Private, small, and `text/plain` only. It holds the `.ics` file sent with a
booking confirmation.

```powershell
$key = (Select-String -Path .env.local -Pattern '^SU_SERVICE_ROLE_KEY=(.+)$').Matches[0].Groups[1].Value
$body = @{
    id = "appointment-calendar"
    name = "appointment-calendar"
    public = $false
    file_size_limit = 65536
    allowed_mime_types = @("text/plain")
} | ConvertTo-Json -Compress
[IO.File]::WriteAllText("$env:TEMP\bucket.json", $body)

curl.exe -s --ssl-revoke-best-effort -H "apikey: $key" -H "Authorization: Bearer $key" `
    -H "Content-Type: application/json" -X POST `
    --data "@$env:TEMP\bucket.json" "https://<ref>.supabase.co/storage/v1/bucket"
```

**Why not reuse `patient-documents`.** That bucket allows PDF, JPEG and PNG
only, which is a control over what a receptionist can upload. A calendar file
is none of them, and the first attempt to store one there was refused with a
400 â€” widening that allow-list to fit this would have loosened the control for
everything else.

**It is served as `text/plain`, not `text/calendar`.** Meta's document endpoint
accepts only its own list of media types and `text/calendar` is not on it. The
`.ics` filename is what makes a phone offer to add the event to a calendar.

## Creating a clinic

There is no endpoint for this. The `clinics` function only lists clinics and
switches them on and off, so a new clinic is a direct insert â€” the same
exception the first admin makes, and for the same reason.

**You do not generate the id.** `clinics.id` is a UUID column defaulting to
`gen_random_uuid()`, so Postgres produces it on insert and you read it back.
Inventing one by hand works but gains nothing and risks a typo that only
surfaces as an empty portal.

Three columns have no usable default: `clinic_code`, `name`, `phone`.

```sql
INSERT INTO clinics (clinic_code, name, phone, timezone, city)
VALUES ('WELLSUN_02', 'Wellsun Clinic â€” Rohini', '919876500000', 'Asia/Kolkata', 'Delhi')
RETURNING id;
```

`RETURNING id` is the point of the statement: that UUID becomes
`DEFAULT_CLINIC_ID`.

`clinic_code` is yours to choose. It is never shown to a patient and exists so
a human can identify the row; the original is `DEFAULT_CLINIC`.

`timezone` decides what "today" means for every slot, reminder and summary. Get
it wrong and the whole day shifts â€” it is far easier to set now than to correct
after bookings exist.

Over REST instead, if the SQL editor is inconvenient:

```powershell
$key = (Select-String -Path .env.local -Pattern '^SU_SERVICE_ROLE_KEY=(.+)$').Matches[0].Groups[1].Value
'{"clinic_code":"WELLSUN_02","name":"Wellsun Rohini","phone":"919876500000","timezone":"Asia/Kolkata"}' |
    Set-Content "$env:TEMP\clinic.json" -Encoding ascii

curl.exe -s --ssl-revoke-best-effort `
    -H "apikey: $key" -H "Authorization: Bearer $key" `
    -H "Content-Type: application/json" -H "Prefer: return=representation" `
    -X POST --data "@$env:TEMP\clinic.json" `
    "https://<ref>.supabase.co/rest/v1/clinics"
```

`Prefer: return=representation` is what makes PostgREST hand the new row back
rather than an empty body.

### The id alone is not a working clinic

A clinic with nothing else set accepts no bookings and answers no messages. In
order:

| # | What | Where | Without it |
|---|---|---|---|
| 1 | An admin for the clinic | `scripts/create-admin.ts --clinic <uuid>` | Nobody can sign in to do the rest |
| 2 | `clinic_operating_hours` | Portal â†’ Settings | **No slots are ever offered.** The commonest cause of "nothing is available". |
| 3 | A doctor, and their hours | Portal â†’ Staff â†’ Hours | Same |
| 4 | Services and the `enable_*` switches | Portal â†’ Services | The patient is offered nothing to book |
| 5 | WhatsApp credentials on the row | SQL, or leave unset | Falls back to the environment number, so two clinics answer on one number |
| 6 | `DEFAULT_CLINIC_ID` | Portal env and Supabase secret | The portal serves the wrong clinic |
| 7 | Latitude, longitude, radius | Portal â†’ Settings | Home visits accept an address any distance away |

Steps 2 to 4 and 7 are all done in the portal once step 1 gives you a login.

## The first admin

Staff are created through `/staff`, which needs an admin token, which needs an
admin. This is the only step that touches the database directly:

```powershell
deno run --allow-env --allow-read --allow-net scripts/create-admin.ts `
    --email owner@clinic.example --name "Clinic Owner" --clinic <clinic-uuid>
```

Omit `--clinic` to create a platform-wide ADMIN with no clinic of their own.
Omit `--password` and one is generated and printed.

Everything about the other account types â€” doctors, receptionists, resets,
lockout â€” is in [Portal accounts and sign-in](PORTAL_ACCOUNTS.md).

## Things that have bitten before

**Check the live schema before writing `CREATE TABLE`.** This codebase is full
of tables that were declared years ago and never wired to anything.
`clinic_services` already existed, empty and unused, so a `CREATE TABLE IF NOT
EXISTS` silently did nothing and the backfill then failed against the older
shape. Read `/rest/v1/` first.

**`ALTER DATABASE ... SET app.*` fails on Supabase** with `42501`. The postgres
role is not superuser and custom GUCs are unavailable. Use Vault â€” see
[Module 4](MODULE_4_SCHEDULER.md).

**Row level security will not save a forgotten clinic filter.** Edge functions
use the service role key, which bypasses RLS entirely. `npm run
verify:clinic-scope` is what actually guards tenant isolation.
