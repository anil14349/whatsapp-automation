# Backlog

Known gaps that are **accepted for now**, with enough detail to pick each one
up cold. Anything genuinely broken belongs in a fix, not here — this page is
for things we have decided to live with, and the reason why.

---

## 1. Collectors have no authentication

**Severity: high. This is the one to do first.**

A sample collector is identified by their phone number and nothing else.
`getRoleByPhoneForClinic` in [staff-directory.ts](../supabase/functions/shared/staff-directory.ts)
looks the number up in `sample_collectors`, and if it matches an active row the
sender is a collector from that moment on. There is no PIN, no second factor,
and no session expiry.

Doctors are not like this. A doctor matched by phone lands in `DOCTOR_LOGIN`
and must clear a bcrypt `doctors.pin_hash` before the menu opens. Collectors
have no equivalent column and no login state.

**Why it matters more since 2026-09-18.** The collector round now lists, for
every home visit that day: the patient's name, their appointment time, and
their home address. Before the round existed a spoofed collector number got
very little; now it gets a list of who is home and when.

What an attacker needs: the ability to present a collector's number to the
webhook. Meta's signature check stops a forged inbound message, so the
realistic paths are a lost or borrowed handset, a recycled number, or a SIM
swap — the same exposure doctors have, minus the PIN that covers them.

**The shape of the fix**, mirroring what already works for doctors:

- add `sample_collectors.pin_hash`, nullable
- add a `COLLECTOR_LOGIN` state and gate `COLLECTOR_MENU` behind it
- reuse `validatePinStrength` and the bcrypt helpers in `doctor-auth.ts`
- reuse `login_rate_limits` for lockout (`user_type` already distinguishes)
- issue the first PIN through `POST /staff {type:"collector"}`, which already
  has credential delivery over WhatsApp

Most of the machinery exists. The work is wiring, a migration, and tests.

**Care needed on rollout:** existing collectors have no PIN. Refusing everyone
with `pin_hash IS NULL` locks out whoever is working that day. Either issue
PINs before enforcing, or allow a null hash to log in once and force a set —
the same decision doctors faced.

---

## 2. Message templates are all PENDING

Six templates are registered on WABA `2247488996013974` and none are approved,
so **the 24-hour-window fallback in `sendProactive` has never actually run in
production**. Until one is approved, every clinic-initiated message is relying
on the recipient having messaged us in the last 24 hours.

`patient_document` was registered with no Document header, which would have made
every report send fail. Deleting it to fix that turned out to be a one-way door:
**Meta holds a deleted template name and refuses to recreate it for some time.**
It was therefore re-registered as `patient_document_v2`, with the header, and the
Supabase secret `TEMPLATE_PATIENT_DOCUMENT=patient_document_v2` points the code
at it. Delete a template only when you are ready to live without the name.

A ready-made proof once anything is approved: `918886436111` is outside the
window and returns `131047`, so a single `sendProactive` to it exercises the
whole fallback, with `whatsapp_log.metadata` showing the delivery status.

---

## 3. Clinic phone and email are still seed data

`clinics` for Wellsun now holds the real address and coordinates — APR Praveen's
Luxuria, Patancheru, Hyderabad, at 17.5255 / 78.2721 — but **`phone` is still
`911112345678` and `email` is still `info@abc-clinic.com`**, a domain nobody
owns. Both are printed on **every booking confirmation**, so patients are being
given a number that does not ring and an address to write to that does not
exist.

`logo_url` is still null, so the portal and WhatsApp show initials rather than a
logo.

The WhatsApp business profile carries the real address. Its email is
deliberately left unset until there is a real one to publish.

---

## 4. Two verification gates check nothing that runs — DONE

`verify:menus` and `verify:coverage` both read the legacy Apps Script monolith,
which is no longer production, so they passed regardless of the state of the
edge functions. Two of the ten green ticks in `npm run verify` were decorative.

Both were deleted on 2026-09-18 rather than repointed: `verify:supabase-menus`
already tests the live menus, so they would only have duplicated it. A gate that
cannot fail is worse than no gate, because it is counted.

---

## 5. Smaller open items

- `ALLOWED_ORIGINS` is still `http://localhost:3001`; the portal will break in
  the browser the moment it gets a real domain.
- `WHATSAPP_REQUIRE_SIGNATURE` is not enforced globally. Enforcement currently
  follows the data: a clinic with `whatsapp_app_secret` set requires a
  signature, one without falls back to the query token.
- The WhatsApp number's `code_verification_status` reads `EXPIRED`. Never
  investigated; unclear what it affects.
- Display name is still `Dr Appointment`. `name_status` is
  `AVAILABLE_WITHOUT_REVIEW`, so it can be changed with no Meta review.
- `staff_credential` was deliberately **not** registered as a template: Meta
  would classify it Authentication, and the parameter would hand a one-time
  password to Meta. Fallback to email or returning it to the admin works.
