# ABC Clinic WhatsApp — UI Cleanup Reference

> **Status: COMPLETE** (implemented in `src/` and synced to `ABC_Clinic_WhatsApp_Complete.gs`)

This document records the WhatsApp **UI/presentation cleanup** that was applied to the ABC Clinic appointment system. It is a reference for future copy changes — not an open task list.

The appointment engine (state machine, booking, calendar, session storage) was **not** redesigned.

------------------------------------------------------------------------

## Summary of what shipped

- **Short contextual message bodies** — no numbered option lists in interactive message text
- **Interactive controls as primary navigation** — lists/buttons for menus; typed `1`/`2`/`0`/`9` still works as fallback
- **Semantic interactive IDs** — `date_today`, `slot_1`, `confirm_yes`, etc. (numeric fallback preserved)
- **Slot pagination copy** — `📅 dd-MMM-yyyy` + `Choose an available time.` + `Page N of M`
- **Localization** — new UI strings added for TE/HI/KA/TA/ML; smoke test `testLocalizationUiCleanup()`
- **Principle:** *Text explains. Interactive controls act.*

Sync after editing `src/`: `node scripts/sync-monolith-from-src.js`

Related docs: [`ABC_Clinic_WhatsApp_UI_README.md`](ABC_Clinic_WhatsApp_UI_README.md) (original interactive-UI plan; some items deferred — see its status section).

------------------------------------------------------------------------

## 1. Purpose

The patient flows below were working before cleanup and remain working after:

-   Main menu
-   Doctor selection
-   Date selection
-   Time selection
-   Slot pagination
-   Booking confirmation
-   Appointment creation
-   My Appointments
-   Cancel appointment flow
-   Reschedule appointment
-   Reschedule confirmation
-   Reschedule "Other time" flow

Cleanup was **UI/presentation only**. Do not rewrite the appointment state
machine or booking business logic unless a UI change exposes a real functional
defect.

------------------------------------------------------------------------

# 2. UI Design Goal (achieved)

The WhatsApp experience should feel like a simple selectable application
rather than a numbered text chatbot.

## Previous pattern (fallback only)

When interactive menus are disabled or the Meta API fails, numbered text is
still shown — but it is no longer duplicated in the primary interactive body.

## Current pattern (shipped)

``` text
👨‍⚕️ Dr Anil

Choose an appointment date.
```

Then:

``` text
Today
Tomorrow
Other date
```

The numeric values should remain supported internally as a **typed-input
fallback**, but should not dominate the primary interactive UI.

------------------------------------------------------------------------

# 3. Important Architecture Rule

Do **not** change these core functions merely to perform UI cleanup:

-   `sendWhatsAppInteractiveMessage()`
-   `sendWhatsAppMenuReply()`
-   `extractInboundWhatsAppMessage()`
-   `handleWhatsAppSlotSelection()`
-   Booking state handlers
-   Rescheduling state handlers
-   Calendar/business logic

The current architecture already separates:

``` text
UI specification
    ↓
sendWhatsAppMenuReply()
    ↓
interactive WhatsApp message
```

The cleanup should therefore happen mainly in the functions that
construct the menu body text/specifications.

------------------------------------------------------------------------

# 4. Main Menu

## Current function

``` javascript
function sendPatientMainMenuReply(
    ss,
    phone,
    prefix
)
```

## Current approved change

The main-menu body has already been changed to:

``` javascript
const body =
    String(prefix || "👋 Welcome to ABC Clinic!") +
    "\n\nHow can we help you today?";
```

### Target

``` text
👋 Welcome to ABC Clinic!

How can we help you today?
```

Interactive choices (5-item list — cancel and reschedule remain top-level menu items):

-   Book Appointment
-   My Appointments
-   Cancel Appointment
-   Reschedule Appointment
-   Change Language

### Status

**DONE** — do not modify unless testing reveals a problem.

> Note: An earlier spec proposed collapsing cancel/reschedule under **Manage Appointment**; that submenu was **not** implemented. The live menu keeps five top-level options.

------------------------------------------------------------------------

# 5. Doctor Selection

## Target body

Replace the long instructional wording with:

``` text
📅 Book Appointment

Choose your doctor.
```

The interactive list should contain the doctors.

Example:

``` text
Dr Anil
ABC Clinic

Dr Pradeep
ABC Clinic
```

Keep the numeric doctor IDs/numbers in the fallback logic so typed input
continues to work.

### Status

**DONE**

------------------------------------------------------------------------

# 6. Date Selection

## Target body

Instead of:

``` text
Please choose a date:

1️⃣ Today
2️⃣ Tomorrow
3️⃣ Enter another date

0️⃣ Main Menu
9️⃣ Back
```

use:

``` text
👨‍⚕️ Dr Anil

Choose an appointment date.
```

Interactive choices:

-   Today
-   Tomorrow
-   Other date

Navigation controls should remain available according to the current
implementation.

## Internal IDs

Keep the semantic IDs already introduced:

``` text
date_today
date_tomorrow
date_custom
```

Do not revert them to generic IDs such as:

``` text
1
2
3
```

The semantic IDs prevent collisions between date, time and confirmation
menus.

### Status

**DONE**

------------------------------------------------------------------------

# 7. Custom Date Entry

Keep the custom-date input flow.

Target prompt:

``` text
📅 Enter the appointment date.

Format: YYYY-MM-DD
Example: 2026-08-25
```

The user should still be able to type the date.

Do not convert this into an interactive menu unnecessarily.

### Status

**DONE**

------------------------------------------------------------------------

# 8. Time Selection

## Target body

Instead of:

``` text
📅 Date selected: 2026-08-24

Available slots:
Please choose a time.

Page 1 of 2
```

use:

``` text
📅 24-Aug-2026

Choose an available time.

Page 1 of 2
```

The actual slots remain interactive.

Example:

``` text
10:00 AM
10:15 AM
10:30 AM
...
```

## Internal IDs

Keep:

``` text
slot_1
slot_2
slot_3
...
```

Do not revert to generic numeric IDs.

Navigation IDs:

``` text
slot_prev
slot_next
```

must remain distinct from actual time-slot IDs.

### Status

**DONE**

------------------------------------------------------------------------

# 9. Booking Confirmation

## Target structure

Instead of a large paragraph, use a compact appointment summary:

``` text
✅ Confirm appointment?

👤 Anil
👨‍⚕️ Dr Anil
📅 24-Aug-2026
🕐 10:00 AM
```

Interactive controls:

-   Confirm
-   Other time
-   Cancel

## Internal IDs

Keep:

``` text
confirm_yes
confirm_other_time
confirm_cancel
```

The handlers must continue accepting the numeric fallback:

``` text
1 → confirm
2 → other time
3 → cancel
```

Do not remove this fallback.

### Status

**DONE**

------------------------------------------------------------------------

# 10. My Appointments

## Target body

Use:

``` text
📋 Your appointments
```

Then display the appointment details.

Avoid repeating:

``` text
Choose an option
```

inside both the text body and the interactive menu unless the screen
actually requires a new selection.

The appointment list itself should remain selectable where currently
supported.

### Status

**DONE**

------------------------------------------------------------------------

# 11. Cancel Appointment

## Selection screen

Target:

``` text
❌ Cancel appointment

Select an appointment to cancel.
```

Then show the selectable appointments.

## Confirmation screen

Target:

``` text
⚠️ Cancel this appointment?

👨‍⚕️ Dr Anil
📅 19-Aug-2026
🕐 10:00 AM
🆔 AB29A571C
```

Interactive choices should clearly communicate:

-   Yes, cancel
-   No, go back

Do not alter the underlying cancellation transaction logic.

### Calendar note

A previous cancellation test returned:

``` text
Could not remove the Google Calendar event; appointment was not cancelled.
```

This has been identified as a **manual Calendar state issue**, not a
current UI-code issue.

Do not redesign cancellation logic because of that result.

### Status

**DONE**

------------------------------------------------------------------------

# 12. Reschedule Appointment

## Selection screen

Target:

``` text
🔄 Reschedule appointment

Select an appointment to reschedule.
```

## Date screen

Target:

``` text
🔄 Dr Anil

Choose a new appointment date.
```

Interactive choices:

-   Today
-   Tomorrow
-   Other date

## Time screen

Target:

``` text
📅 24-Aug-2026

Choose a new time.
```

Then display the time slots interactively.

## Confirmation screen

Target:

``` text
🔄 Confirm reschedule?

👨‍⚕️ Dr Anil
📅 24-Aug-2026
🕐 11:00 AM
```

Interactive choices:

-   Confirm
-   Other time
-   Cancel

Keep:

``` text
confirm_yes
confirm_other_time
confirm_cancel
```

and retain numeric fallback support.

### Status

**DONE**

------------------------------------------------------------------------

# 13. Language Selection

Target:

``` text
🌐 Choose your language.
```

Interactive choices can remain:

-   English
-   Telugu
-   Hindi
-   Kannada
-   Tamil
-   Malayalam

Keep the existing language IDs and language-processing logic.

### Status

**DONE**

------------------------------------------------------------------------

# 14. Navigation

The application currently supports:

``` text
0 = Main Menu
9 = Back
```

These should remain supported as typed fallback.

However, when interactive menus are available, navigation should
preferably be represented by selectable controls rather than requiring
the user to type `0` or `9`.

Do not change navigation state logic during the initial UI-copy cleanup.

------------------------------------------------------------------------

# 15. What NOT to Change

Do not modify:

-   WhatsApp webhook verification
-   `doGet()`
-   `doPost()`
-   WhatsApp inbound extraction
-   session storage
-   appointment creation
-   appointment ID generation
-   availability calculation
-   slot pagination calculations
-   booking state machine
-   rescheduling state machine
-   Calendar integration
-   duplicate-message protection
-   semantic interactive IDs

These are outside the current UI cleanup scope.

------------------------------------------------------------------------

# 16. Implementation checklist

All phases completed:

### Phase 1

-   [x] Main Menu

### Phase 2

-   [x] Doctor Selection
-   [x] Date Selection
-   [x] Custom Date Prompt
-   [x] Time Selection
-   [x] Booking Confirmation

### Phase 3

-   [x] My Appointments
-   [x] Cancel Appointment
-   [x] Cancel Confirmation
-   [x] Reschedule Appointment
-   [x] Reschedule Date
-   [x] Reschedule Confirmation
-   [x] Language Selection

### Phase 4 — QA

Automated: `testInteractiveMenus`, `testLocalizationUiCleanup`, `testWhatsAppReliability` (partial localization checks).

Manual end-to-end tests (run after each deploy):

``` text
Hi
→ Book
→ Doctor
→ Date
→ Time
→ Confirm
```

``` text
Hi
→ My Appointments
```

``` text
Hi
→ Manage (Cancel Appointment or Reschedule Appointment from main menu)
→ Cancel
→ Confirm cancellation
```

``` text
Hi
→ Reschedule Appointment
→ Date
→ Time
→ Other time
→ Confirm
```

Also test:

-   typed numeric fallback
-   Main Menu
-   Back
-   invalid input
-   expired session
-   slot pagination
-   custom date

------------------------------------------------------------------------

# 17. Definition of Done

All criteria below are met in the current codebase:

-   Interactive controls are the primary way to navigate.
-   Menu text is short and contextual.
-   Numbered instructions are no longer unnecessarily displayed.
-   Typed numeric input still works as fallback.
-   No business/state logic has been broken.
-   Booking works.
-   Cancellation flow works subject to valid Calendar state.
-   Rescheduling works.
-   Slot pagination works.
-   Confirmation actions work.
-   Navigation works.
-   No duplicate interactive controls are accidentally sent.
-   The conversation reads like a clean appointment application rather
    than a numbered chatbot.

------------------------------------------------------------------------

# 18. Recommended Principle

Use this rule for every future menu:

> **Text explains. Interactive controls act.**

The message should tell the patient what they are doing.

The interactive controls should provide the choices.

The fallback text exists primarily for compatibility with typed input
and should not be the dominant visual experience.
