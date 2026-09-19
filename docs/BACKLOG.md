# Backlog

Known gaps that are **accepted for now**, with enough detail to pick each one
up cold. Anything genuinely broken belongs in a fix, not here — this page is
for things we have decided to live with, and the reason why.

---

## 1. Message templates are all PENDING

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

## 2. Clinic phone and email are still seed data

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

## 3. Patients' comments are collected and never shown — DONE

After a completed appointment the bot asks for a rating out of five, then an
optional comment in the patient's own words. Both are stored in `feedback`:
`rating`, `comments`, `patient_name`, `doctor_name`, `status`.

The portal used to show **the average rating and nothing else** — one tile on
Summary reading "Patient rating, from N patients". No screen read
`feedback.comments`. So the clinic asked a patient what they thought, kept the
answer, and no member of staff could ever read it. That is worse than not
asking: the patient believes they have been heard, and a complaint about a
specific visit goes nowhere.

Fixed on 2026-09-18. `feedbackSummary` now also returns the rows —
`{ rated, average, comments[] }`, newest first, capped at 20 — and Summary
renders a "What patients said" panel under the tiles: rating, the words, the
patient, the doctor, the date. A rating of 1 or 2 is tinted amber so it is not
read past. Ratings with no words still count towards the average but are not
listed, because there is nothing to read; two tests cover exactly that, and
that another clinic's feedback is never read.

Still undecided, and deliberately left: whether a low rating should reach the
desk the day it arrives rather than waiting in a panel someone remembers to
open. The panel is the floor, not the ceiling.

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

- `FEEDBACK_SAMPLING_RATE` and `COST_OPTIMIZATION_SKIP_24H_REMINDER` were
  seeded by `001`, typed in `types.ts`, and read by nothing — every completed
  appointment got a survey, and the 24-hour reminder could not be switched
  off. Both deleted on 2026-09-19 by `039` rather than honoured: sampling is a
  decision about how often to contact patients and nobody has made it. **Done.**
- A clinic switched on **before** the readiness guard existed could have
  `enable_home_collection` true with no coordinates, and would accept a pin any
  distance away because there was nothing to measure from. Fixed on 2026-09-19:
  `getEnabledServices` now requires a latitude, a longitude and a radius above
  zero before it will offer anything at the patient's home, so a clinic seeded
  by SQL keeps its counter appointments and is not asked to visit a house it
  cannot locate. The distance check itself is unchanged and still permissive —
  see the convention note; this decides whether to *offer*, not whether to
  accept. **Done.**
- `ALLOWED_ORIGINS` is still `http://localhost:3001`, and that is harmless:
  `withCors` only omits the allow header, it never refuses a request, and the
  portal calls the functions from the Next server where CORS does not apply.
  It would matter the day something calls an edge function **from a browser** —
  nothing does today.
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
