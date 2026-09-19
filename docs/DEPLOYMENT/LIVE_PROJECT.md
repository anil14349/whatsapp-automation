# Which project is live

Two Supabase projects exist. Only one serves patients. Knowing which, without
guessing, is the point of this page — the names do not tell you, and one of
them actively misleads.

---

## The live one

| | |
|---|---|
| Ref | `tedircrxgkktxzhlgolt` |
| Region | `ap-south-1`, Mumbai |
| Name in the dashboard | **`migration-replay-scratch`** |

**That name is wrong and cannot be fixed from here.** Renaming a Supabase
project is a dashboard-only action; there is no CLI or API for it. It was
created to rehearse the move and became production when the rehearsal
succeeded, which is a good outcome with an embarrassing label. Anyone who
opens the dashboard, reads "scratch", and treats the project as disposable
will delete the clinic's live data. Until somebody renames it, this page is
the correction.

Mumbai is not cosmetic. The clinic is in Hyderabad, and the round trip to the
previous region was adding latency to every webhook — WhatsApp waits for the
`200`, so that delay was visible to patients as a pause before the bot replied.

---

## The retired one

| | |
|---|---|
| Ref | `xovsbwwuftpvnpktwkse` |
| Region | Tokyo |
| Kept for | Rollback only |

It holds the data as it stood at cutover and nothing since. It receives no
webhooks and runs no cron. It is kept because a rollback with no destination
is not a rollback, and deleting it is the one step of this move that cannot be
undone.

A `supabase link` run from `clinic-app/` once committed a `.temp` file still
pointing at this project, which meant a CLI command typed in that directory
would have targeted Tokyo without saying so. That file is deleted and
`.gitignore` now matches `**/supabase/.temp/` at any depth rather than only at
the root, which is why it escaped the first time. Nothing in the repository
links to a project now: every deploy passes `--project-ref` explicitly, which
is the safer habit anyway.

---

## Rolling back

Two things point at Mumbai, and both have to move together. A half rollback is
worse than none: Meta would deliver to one project while staff read another.

1. **Restore the environment.** `.env.local.tokyo-backup` at the repository
   root and in `clinic-app/` are the pre-cutover values. Copy each over the
   matching `.env.local`. They are gitignored, so they exist on the machine
   that did the cutover and nowhere else — if you are on a different machine,
   you do not have them and must read the values from the Tokyo dashboard.
2. **Point Meta back.** POST the Tokyo webhook URL to the WhatsApp Business
   account's callback configuration. Until that happens, patient messages keep
   arriving at Mumbai regardless of what the portal is reading.

Then confirm inbound messages land: a plain-text refusal from the webhook is
the function answering, a JSON body with a `code` field is the gateway, and the
second means `--no-verify-jwt` was lost somewhere along the way.

---

## Deploying

Always name the project. The splat is not a style preference — `$args` is a
PowerShell automatic variable, and using it here opened an interactive
sub-shell that deployed nothing while appearing to succeed.

```powershell
$a = @("supabase","functions","deploy","<name>","--project-ref","tedircrxgkktxzhlgolt","--use-api")
npx @a
```

`webhook` and `scheduled-reminders` additionally need `--no-verify-jwt`, every
time, and must be checked afterwards — see
[Module 2](./MODULE_2_EDGE_FUNCTIONS.md).

Connecting with `psql`:

```powershell
psql "postgresql://postgres.tedircrxgkktxzhlgolt@aws-0-ap-south-1.pooler.supabase.com:5432/postgres" -P pager=off
```

`-P pager=off` is not optional in a non-interactive shell; without it the
pager waits for a keypress that never arrives and the command appears to hang.

---

## What is still seed data

Accurate as of 2026-09-18. Checked against the live database, not remembered.

- `clinics.phone` is `911112345678` and `clinics.email` is
  `info@abc-clinic.com` — both from the original seed, both still wrong. They
  are shown to patients. See [BACKLOG](../BACKLOG.md).
- One collector, `Ravi (test collector)`, has no PIN set. He will be asked to
  choose one on first contact, which is the designed behaviour, but the name
  says what the account is for.
- Three `CANCELLED` appointments remain from cutover proofs: `Anil`,
  `Mumbai reminder test`, `Cutover proof`. They are cancelled, so they affect
  no count on Summary, which deliberately excludes cancellations.
