# What decides whether a slot is offered

Four separate settings narrow the times a patient can book, they live in three
different tables, and **only some of them are enforced on both booking paths**.
This page says where each one lives, who reads it, and what is not yet wired.

Read it before adding a fifth. The last two knobs added to `config.ts` turned
out to have no callers at all — see [Dead settings](#dead-settings) below.

---

## The four settings

| What it limits | Column | Set from | Applies to |
|---|---|---|---|
| When the premises are open | `clinic_hours.opening_time` / `closing_time` / `is_active` | Settings → Opening hours | everything |
| When a doctor works | `doctor_available_hours`, `doctor_home_visit_hours` | Staff → doctor | doctor services only |
| How much notice a booking needs | `clinic_services.min_booking_window_hours` | Services → **Least notice (hours)** | every service |
| What time of day a service runs | `clinic_services.available_from` / `available_to` | Services → **Runs from / Runs until** | every service |
| How far ahead it may be booked | `clinic_services.max_booking_window_days` | Services → **Book up to (days ahead)** | every service |

Plus one that is not about time of day:

| What it limits | Column | Set from |
|---|---|---|
| Home visits one collector can take in a day | `sample_collectors.max_collections_per_day` | Staff → collector |

### Least notice (hours)

New field on the Services page, stored in `min_booking_window_hours`. `8` means
the earliest bookable slot is eight hours from now; `0` means a patient can
book the next free slot.

The column had existed since `002` and **nothing read it**, so no notice was
enforced anywhere until the slot generator was changed to honour it. A clinic
that had set it was getting no protection from the setting it had configured.

At Wellsun, Sample Collection is `8`, which is why today's first offer is 08:30
when a week ahead offers 07:00.

### Available from / to

Added by [`036_service_time_of_day.sql`](../../supabase/migrations/036_service_time_of_day.sql).
`NULL` on either column means "follow the premises hours", which is what every
row did before.

This exists because slots for a doctor-free service come from the building's
hours. Once Wellsun's real opening times were set, Sample Collection offered
102 slots on a Monday, the last at **23:20** — a home blood draw bookable for
twenty past eleven at night. The migration sets `DIAGNOSTIC` and `IMAGING`
services to 07:00–19:00, which takes that Monday to 72 slots ending 18:50.

**Set on the Services page as "Runs from" and "Runs until".** Leaving either
blank follows the premises hours. A start on or after the end is refused rather
than stored, since it would offer nothing at all.

---

## The two slot paths

There are still two, and they are still separate code, but they now apply the
same per-service rules.

[`getClinicServiceSlots`](../../supabase/functions/shared/clinic-slots.ts) —
services with no doctor, such as sample collection and imaging. Honours clinic
hours, closures, `available_from` / `available_to`, `min_booking_window_hours`,
`duration_minutes`, and `concurrent_capacity`.

[`getAvailableSlots`](../../supabase/functions/shared/multi-clinic-supabase-client.ts) —
consultations, keyed on a doctor. Honours the doctor's hours clipped to the
clinic's, the doctor's availability status, clinic closures, doctor leave,
existing appointments, and — when the caller passes the service — the same
window and notice period.

**The service has to be passed in.** It takes a doctor id, so a caller that
omits the service gets the doctor's whole day, exactly as before. Every caller
that knows which service is being booked now supplies it; one that does not is
not refused, it simply gets no narrowing.

---

## Everything is computed in the clinic's timezone

The edge runtime is UTC and the clinics are not. "Today" has to come from
`todayInTimezone(await getClinicTimezone(supabase, clinicId))`, never
`new Date().toISOString().slice(0, 10)` — six production call sites had the
latter, which after 05:30 IST puts a patient on the wrong day.

`npm run verify:clinic-time` fails the build on a reintroduction. It has
already caught one.

---

## Dead settings

Removed, and named here so they are not re-added:

- `HOME_COLLECTION_MIN_LEAD_HOURS` — no callers. The real setting is
  `clinic_services.min_booking_window_hours`, per service, per clinic.
- `MAX_COLLECTIONS_PER_COLLECTOR_PER_DAY` — no callers. The real setting is
  `sample_collectors.max_collections_per_day`, per collector.

Both read like working configuration. Setting either one did nothing at all.

`clinic_services.max_booking_window_days` was the same shape — present since
`002`, read by nothing, while a week was hardcoded in four places. It is now
**Book up to (days ahead)** on the Services page. A service left unset keeps
the week that was enforced before, so nothing moved by being wired.
