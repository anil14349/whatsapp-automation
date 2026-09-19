# Documentation

Every document in `docs/`, grouped by what you are trying to do. Links here are
checked against the files that exist — if one is dead, it is a bug in this
page.

**[Working on this repository](../.github/copilot-instructions.md)** — the
commands, the conventions, and the traps that have already cost time. Read it
before your first change on a new machine.

**[Backlog](./BACKLOG.md)** — the gaps we know about and have accepted for now,
and why. Read it before assuming something is finished.

---

## Deploying

**Start here.** Six modules, in the order they have to be deployed:

- [**Which project is live**](./DEPLOYMENT/LIVE_PROJECT.md) — the live project is still *named* `migration-replay-scratch`; read this before touching either project
- [**Deployment index**](./DEPLOYMENT/README.md) — the order, shared prerequisites, and the gate to run first
- [Module 1 — Database](./DEPLOYMENT/MODULE_1_DATABASE.md) — migrations, storage bucket, first admin
- [Module 2 — Edge functions](./DEPLOYMENT/MODULE_2_EDGE_FUNCTIONS.md) — all 19, their secrets, and the `--no-verify-jwt` trap
- [Module 3 — WhatsApp](./DEPLOYMENT/MODULE_3_WHATSAPP.md) — Meta app, webhook, and the 8 message templates
- [Module 4 — Reminder scheduler](./DEPLOYMENT/MODULE_4_SCHEDULER.md) — pg_cron and Vault
- [Module 5 — Clinic portal](./DEPLOYMENT/MODULE_5_CLINIC_PORTAL.md) — the Next.js app and its Docker image
- [Module 6 — Landing site](./DEPLOYMENT/MODULE_6_LANDING_SITE.md) — the static marketing page

### Walkthroughs

- [**Registering the WhatsApp message templates**](./DEPLOYMENT/WHATSAPP_TEMPLATES.md) — where to create them, and the exact wording and parameter order for all eight
- [**Creating a clinic**](./DEPLOYMENT/MODULE_1_DATABASE.md#creating-a-clinic) — where the clinic id comes from, and the seven things it needs before it works
- [**Portal accounts and sign-in**](./DEPLOYMENT/PORTAL_ACCOUNTS.md) — the four kinds of login, how to create, reset and remove them

### Earlier deployment notes

These predate the modules above and are kept for history. **Where they
disagree, the module documents are correct.**

- [Deployment Guide](./DEPLOYMENT/DEPLOYMENT_GUIDE.md)
- [Supabase Setup](./DEPLOYMENT/SUPABASE_SETUP.md)
- [Supabase Migration](./DEPLOYMENT/SUPABASE_MIGRATION.md)
- [Scheduler Setup](./DEPLOYMENT/SCHEDULER_SETUP.md)
- [API Integration Guide](./DEPLOYMENT/API_INTEGRATION_GUIDE.md)
- [Home Collection Reminders](./DEPLOYMENT/HOME_COLLECTION_REMINDERS.md)
- [Doctor Status Marking](./DEPLOYMENT/DOCTOR_STATUS_MARKING.md)
- [Daily Archive Setup](./DAILY_ARCHIVE_SETUP.md)

---

## Architecture

- [Multi-Clinic Architecture](./ARCHITECTURE/MULTI_CLINIC_ARCHITECTURE.md) — how tenants are separated
- [Doctor Home Visits](./ARCHITECTURE/DOCTOR_HOME_VISITS.md) — the home visit design
- [Message Processor](./ARCHITECTURE/PHASE_3_MESSAGE_PROCESSOR.md) — how an inbound message is routed
- [Phase 3B Implementation](./ARCHITECTURE/PHASE_3B_IMPLEMENTATION.md)
- [Roadmap](./ARCHITECTURE/ROADMAP.md)
- [Scalability Roadmap](./ARCHITECTURE/SCALABILITY_ROADMAP.md)

---

## Security

- [Security Features](./SECURITY/SECURITY_FEATURES_IMPLEMENTATION.md) — bcrypt, JWT, rate limiting, password reset
- [Deployment Security Checklist](./SECURITY/DEPLOYMENT_READY_SECURITY.md)
- [Code Review Findings](./SECURITY/CODE_REVIEW_FINDINGS.md)
- [Code Review: Deployment](./SECURITY/CODE_REVIEW_DEPLOYMENT.md)

---

## Testing

- [Testing Guide](./TESTING/TESTING_GUIDE.md)
- [WhatsApp Flow Review](./TESTING/WHATSAPP_FLOW_REVIEW.md)
- [Verification Sign-Off](./TESTING/VERIFICATION_SIGN_OFF.md)
- [Completion Status](./TESTING/COMPLETION_STATUS.md)

The checks themselves live in the root `package.json`:

```powershell
npm run verify          # types, tests, and seven static checks. No network.
npm run verify:schema   # every column reference against the live database
```

---

## Reference

- [API Documentation](./REFERENCE/API_DOCUMENTATION.md) — endpoints and payloads
- [**Scheduling rules**](./REFERENCE/SCHEDULING_RULES.md) — the four settings that decide whether a slot is offered, and which of the two booking paths reads each one
- [Business Logic Review](./REFERENCE/BUSINESS_LOGIC_REVIEW.md)
- [Dependencies](./REFERENCE/DEPENDENCIES.md)
- [Deployment Readiness](./REFERENCE/DEPLOYMENT_READY.md)
- [REST API Deployment Verdict](./REFERENCE/REST_API_DEPLOYMENT_VERDICT.md)
- [Phase 2 REST API](./REFERENCE/PHASE_2_REST_API.md)
- [Post-Fix Review](./REFERENCE/POST_FIX_REVIEW.md)
- [Quick Reference](./QUICK_REFERENCE.md) — common commands

---

## Client materials

- [Marketing folder](../marketing/README.md)
  - [Client Service One-Pager](../marketing/CLIENT_SERVICE_ONE_PAGER.md)
  - [Clinic Owner Brochure](../marketing/CLINIC_OWNER_BROCHURE.md)
  - [Landing Page Copy](../marketing/LANDING_PAGE_COPY.md)
  - [Offboarding Checklist](../marketing/OFFBOARDING_CHECKLIST.md)

---

## Environment

`.env.local` in the repo root, copied from [`.env.example`](../.env.example).

The Supabase values are prefixed `SU_` rather than `SUPABASE_` because the
Supabase CLI claims the latter for its own use.

| Variable | Purpose |
|---|---|
| `SU_URL` | `https://<ref>.supabase.co` |
| `SU_ANON_KEY` | Public key. No privileges on any table. |
| `SU_SERVICE_ROLE_KEY` | **Bypasses row level security.** Never ship it to a browser. |
| `JWT_SECRET` | Signs portal tokens |
| `WHATSAPP_*` | Number id, access token, verify token, webhook post token |
| `DATABASE_URL` | Direct database access. A placeholder in this checkout, which is why migrations are applied through the dashboard. |
| `RESEND_API_KEY` | Optional. Unset means credentials are shown to the admin rather than emailed. |

The clinic portal has its own `clinic-app/.env.local` holding three
server-side values — see [Module 5](./DEPLOYMENT/MODULE_5_CLINIC_PORTAL.md).

Secrets used by the edge functions are set on Supabase, not in any file — see
[Module 2](./DEPLOYMENT/MODULE_2_EDGE_FUNCTIONS.md).

---

## I want to…

**Deploy for the first time**
1. [Deployment index](./DEPLOYMENT/README.md), then modules 1 → 5 in order
2. [Security checklist](./SECURITY/DEPLOYMENT_READY_SECURITY.md)
3. [Verification sign-off](./TESTING/VERIFICATION_SIGN_OFF.md)

**Ship a change**
1. `npm run verify` and `npm run verify:schema`
2. Redeploy every function that imports whatever shared file changed — [Module 2](./DEPLOYMENT/MODULE_2_EDGE_FUNCTIONS.md)
3. Confirm the two functions needing `--no-verify-jwt` still have it

**Work out why reminders stopped**
1. [Module 4](./DEPLOYMENT/MODULE_4_SCHEDULER.md) — cron reports success even when the call never lands
2. [Module 3](./DEPLOYMENT/MODULE_3_WHATSAPP.md) — outside the 24-hour window only an approved template is delivered

**Add a feature**
1. [Multi-Clinic Architecture](./ARCHITECTURE/MULTI_CLINIC_ARCHITECTURE.md)
2. [Message Processor](./ARCHITECTURE/PHASE_3_MESSAGE_PROCESSOR.md)
3. [Testing Guide](./TESTING/TESTING_GUIDE.md)

**Troubleshoot**
1. [Quick Reference](./QUICK_REFERENCE.md)
2. [Code Review Findings](./SECURITY/CODE_REVIEW_FINDINGS.md)
