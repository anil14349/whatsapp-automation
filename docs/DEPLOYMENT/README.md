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
