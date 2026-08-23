# Marketing materials — hosted clinic WhatsApp booking

**Business model:** You (provider) host Meta config + Apps Script. Each clinic gets a **shared Google Sheet**, **their WhatsApp number**, and **their Google Calendars**.

## Files

| File | Audience | Use |
|------|----------|-----|
| [`../landing/`](../landing/) | Public web | Next.js site — deploy on Vercel or Replit |
| [CLINIC_OWNER_BROCHURE.md](./CLINIC_OWNER_BROCHURE.md) | Clinic owners | Print PDF, WhatsApp send, walk-in leave-behind |
| [LANDING_PAGE_COPY.md](./LANDING_PAGE_COPY.md) | Public web | Legacy copy reference (site lives in `../landing/`) |
| [CLIENT_SERVICE_ONE_PAGER.md](./CLIENT_SERVICE_ONE_PAGER.md) | Signing clinic | Ownership, fees, term — send before payment |
| [OFFBOARDING_CHECKLIST.md](./OFFBOARDING_CHECKLIST.md) | You (internal) | When client cancels or churns |

## Replace before use

- `[Your Name / Brand]`
- `[Your City]`
- `[91XXXXXXXXXX]`
- Pricing numbers
- Term length and notice days in one-pager

## Suggested client flow

1. **Lead** — landing page or brochure → WhatsApp demo  
2. **Proposal** — fill in CLIENT_SERVICE_ONE_PAGER fees + email PDF  
3. **Go-live** — README deployment steps (technical repo root)  
4. **Churn** — OFFBOARDING_CHECKLIST  

## Pitch (one sentence)

*We host WhatsApp booking on your clinic number; your appointments live in a Google Sheet shared with you — no app for patients, no IT team for you.*
