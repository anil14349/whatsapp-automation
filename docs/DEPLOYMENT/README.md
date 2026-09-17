# Deployment

Six modules. They depend on each other in this order, and deploying one out of
order mostly fails in ways that look like something else — edge functions
deployed before their migrations report missing columns, and the portal without
`ALLOWED_ORIGINS` fails in the browser rather than in a log.

| # | Module | What it is | Deploy when |
|---|--------|-----------|-------------|
| 1 | [Database](MODULE_1_DATABASE.md) | Postgres schema, storage bucket | A migration is added |
| 2 | [Edge functions](MODULE_2_EDGE_FUNCTIONS.md) | The API and the WhatsApp bot | Any `supabase/functions` change |
| 3 | [WhatsApp](MODULE_3_WHATSAPP.md) | Meta app, numbers, templates | Once, then when templates change |
| 4 | [Scheduler](MODULE_4_SCHEDULER.md) | pg_cron job that sends reminders | Once, per project |
| 5 | [Clinic portal](MODULE_5_CLINIC_PORTAL.md) | The Next.js staff portal, and its image | Any `clinic-app` change |
| 6 | [Landing site](MODULE_6_LANDING_SITE.md) | The public marketing page | Any `landing` change |

First deployment runs 1 → 2 → 3 → 4 → 5. Routine changes usually touch one.

Three walkthroughs sit alongside the modules:

- [Registering the WhatsApp message templates](WHATSAPP_TEMPLATES.md) — the eight templates, field by field
- [Creating a clinic](MODULE_1_DATABASE.md#creating-a-clinic) — and everything it needs before it works
- [Portal accounts and sign-in](PORTAL_ACCOUNTS.md) — who can sign in, how to create and reset them

## Before anything

```powershell
npm install                  # repo root, for the Supabase CLI
deno --version               # 2.x, used by the test suite
node --version               # 20 or newer
```

`.env.local` at the repo root holds the values the scripts and checks read:

| Variable | Used by | Notes |
|---|---|---|
| `SU_URL` | scripts | `https://<ref>.supabase.co` |
| `SU_ANON_KEY` | scripts, checks | Public key. No privileges on any table. |
| `SU_SERVICE_ROLE_KEY` | scripts, `verify:schema` | **Bypasses row level security.** Never ship it to a browser. |

These are prefixed `SU_` rather than `SUPABASE_` because the Supabase CLI
claims the latter for its own purposes.

## The gate before every deployment

```powershell
npm run verify          # types, 242 tests, and seven static checks
npm run verify:schema   # every column reference against the live database
```

`verify` needs no network. `verify:schema` does, and it is the one that catches
a migration you have written but not applied — it fails and names the table.

## A note on deploying twice

Supabase occasionally reports `Deployed` while still serving the previous
bundle from a warm isolate. The symptom is unmistakable: a new guard never
fires while an older guard *in the same function* still does. Deploy again
before debugging the code.

## The flag that is easy to lose

`webhook` and `scheduled-reminders` must be deployed with `--no-verify-jwt`.
It is set per deployment, not stored anywhere, so redeploying either without it
turns gateway verification back on and the caller is rejected before the
function runs. Both failures are silent. See
[Module 2](MODULE_2_EDGE_FUNCTIONS.md#telling-the-two-401s-apart) for the
one-line check.

## Before going live

Each of these is off until someone does something, and each one is quiet about
it. The code ships in the safe-but-open state on purpose, so that a half
configured clinic keeps working rather than dropping real patients' messages —
which means nothing here will fail loudly to remind you.

- [ ] **The Meta app secret is stored for every clinic.** Until then the
      webhook is protected only by a token in a URL, and anyone holding it can
      post a message as any phone number.
      [Module 3](MODULE_3_WHATSAPP.md#proving-the-request-came-from-meta)
- [ ] **`WHATSAPP_REQUIRE_SIGNATURE=true`**, once they all have one, so an
      unconfigured clinic cannot be added later and silently run unsigned
- [ ] **The eight message templates are approved.** Without them nothing the
      clinic starts — reminders, delay notices, reports — survives the 24 hour
      window. [Templates](WHATSAPP_TEMPLATES.md)
- [ ] **The Meta app is live, not in development mode.** In development a send
      returns a message id whether or not it reached anyone
- [ ] **`SAMPLE_COLLECTOR_PHONES` is unset** and collectors exist as rows
      instead. That list grants access on a phone number alone, with no PIN
- [ ] **`ALLOWED_ORIGINS` names the portal's real domain**, not localhost
- [ ] [Portal accounts](PORTAL_ACCOUNTS.md#before-going-live) — its own list
