# Client Offboarding Checklist
### Hosted WhatsApp clinic booking · Provider internal use

Copy this checklist per clinic when service ends (cancellation, non-payment, or migration).

**Clinic:** [Clinic Name]  
**Offboarding date:** [Date]  
**Reason:** [ ] Client cancelled · [ ] Non-payment · [ ] Migration · [ ] Other  
**Handled by:** [Your Name]

---

## Phase 1 — Notify (Day 0)

- [ ] Send written notice confirmation (email or WhatsApp) with effective shutdown date  
- [ ] Confirm last day of active booking: [Date]  
- [ ] Inform clinic: after shutdown, patients sending Hi will [no auto-reply / manual message sent once]  
- [ ] Save copy of final agreement / fee status  

---

## Phase 2 — Data handover (before disconnect)

### Google Sheet

- [ ] Export full sheet to Excel/CSV — store copy in `[client-folder]/final-export-[date].xlsx`  
- [ ] Verify tabs exported: Appointments, Doctors, Availability, Patients, Settings, logs if needed  
- [ ] **Choose one path:**

  **Option A — Transfer ownership (recommended if clinic continues elsewhere)**  
  - [ ] Transfer spreadsheet ownership to clinic Google account: [email]  
  - [ ] Remove provider admin access after confirmation received  

  **Option B — Keep provider copy, clinic retains export only**  
  - [ ] Deliver export file to clinic contact  
  - [ ] Document that provider archive retained for [90] days then deleted  

- [ ] Clinic contact confirmed receipt: [Name] · [Date]

### Google Calendar

- [ ] Confirm: existing calendar events **stay on clinic/doctor calendars** (default)  
- [ ] Remove provider service account / sharing only if clinic requests  
- [ ] No mass deletion of events unless clinic explicitly requests in writing  

### Patient / operational data

- [ ] Reminder_Log — include in export or archive if clinic wants history  
- [ ] WhatsApp_Log — offer export of last [90] days if useful for clinic records  

---

## Phase 3 — Disconnect platform (shutdown day)

### WhatsApp / Meta

- [ ] Disable or delete webhook subscription for clinic number in Meta dashboard  
- [ ] Remove clinic number from provider WABA **or** hand Meta Business admin to clinic (if clinic-owned BM)  
- [ ] Revoke / rotate access tokens that included this clinic  
- [ ] Remove clinic-specific Script Properties / config keys from central deploy  
- [ ] Test: send message to clinic number → **no** booking bot response (expected)  

### Apps Script / hosting

- [ ] Remove clinic spreadsheet ID from multi-tenant config (if applicable)  
- [ ] Delete time-based triggers **only** if dedicated per clinic; else remove clinic from job scope  
- [ ] Archive deployment notes: webhook URL version, go-live date, offboard date  

### Billing

- [ ] Final invoice or credit note issued  
- [ ] Meta pass-through charges settled through [last active month]  
- [ ] Mark client **inactive** in CRM/spreadsheet tracker  

---

## Phase 4 — Clinic communication (shutdown message)

Send once to clinic owner (not bulk to patients unless clinic asks):

> *WhatsApp booking automation for [Clinic Name] was deactivated on [date]. Your appointment export has been shared. Your WhatsApp number remains yours. Patients will no longer receive automated booking replies until you connect a new system. Existing Google Calendar appointments are unchanged.*

Optional — if clinic wants a **patient-facing** one-time WhatsApp broadcast, clinic must approve text; provider sends only if agreed.

---

## Phase 5 — Internal cleanup (within 7 days)

- [ ] Remove clinic contacts from support rotation  
- [ ] Archive credentials / notes in `[client-folder]/closed/`  
- [ ] Update landing page / client count if published  
- [ ] Lessons learned: [notes]  

---

## Quick reference — what clinic keeps vs loses

| Keeps | Does not keep (unless buyout agreed) |
|-------|--------------------------------------|
| WhatsApp number | Hosted booking bot on that number |
| Sheet export or transferred sheet | Provider-hosted webhook |
| Calendar events already created | Platform updates & support |
| Patient relationship | Source code / Apps Script |

---

## Non-payment offboarding (shorter path)

1. Day 0: Payment reminder (already sent per contract)  
2. Day 7: Warning — service pause in 7 days  
3. Day 14: Execute Phase 2 export + Phase 3 disconnect  
4. Offer reactivation if payment received within [30] days — [ ] fee ₹[____] reconnection  

---

## Reactivation (if client returns)

- [ ] Verify sheet still exists or restore from archive  
- [ ] Re-link webhook & test patient Hi flow  
- [ ] Confirm Meta token valid  
- [ ] Charge reactivation fee if applicable  
- [ ] New go-live confirmation to clinic  

---

## Template tracker row (optional Google Sheet)

| Clinic | Sheet URL | WABA | Go-live | Offboard | Export done | Webhook off | Owner transfer |

---

*Keep completed checklists for [2] years for billing/dispute reference.*
