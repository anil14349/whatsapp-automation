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

## 3. Home collection asks for latitude and longitude

Settings → Home collection asks a clinic administrator for `17.5255` and
`78.2721`. The field accepts a pasted Google Maps pair and splits it, which is
the only reason it is usable at all, but it still asks someone who books blood
tests for a living to think in coordinates.

**The coordinates are not decoration.** The WhatsApp flow measures every shared
location pin against them, so a clinic that has not set them accepts a booking
from any distance — the failure is silent and one-way, which is why the card
spells out which of the two states the clinic is in.

What it should ask for is an address, with the coordinates derived and kept
behind an Advanced disclosure. That needs a geocoding provider, and the choice
is not free:

- an API key and a billing account, per deployment
- a provider that covers Indian addresses properly, which rules out some
- the clinic's address already sits in `clinics.address`, so the first offer
  should be "use the clinic's own address" and not a search box at all

The last point is probably most of the value for a tenth of the work: one
button that fills both boxes from the address already on file, leaving the
search box for clinics whose collection centre is not their front door.

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
