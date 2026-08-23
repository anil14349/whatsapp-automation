# ABC Clinic WhatsApp --- UI Cleanup Change Plan

## 1. Purpose

This document defines the remaining WhatsApp UI cleanup work for the ABC
Clinic appointment system.

The appointment engine is currently working through the tested patient
flows:

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

The current task is **UI/presentation cleanup only**. Do not rewrite the
appointment state machine or booking business logic unless a UI change
exposes a real functional defect.

------------------------------------------------------------------------

# 2. UI Design Goal

The WhatsApp experience should feel like a simple selectable application
rather than a numbered text chatbot.

## Current pattern

Many screens currently contain:

1.  A long text message with numbered options.
2.  An interactive WhatsApp list/button immediately afterward.

Example:

``` text
Please choose a date:

1️⃣ Today
2️⃣ Tomorrow
3️⃣ Enter another date
0️⃣ Main Menu
9️⃣ Back
```

followed by an interactive menu:

``` text
Today
Tomorrow
Other date
Main Menu
Back
```

## Target pattern

Use a short contextual message plus the interactive controls:

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

Interactive choices:

-   Book Appointment
-   My Appointments
-   Manage Appointment
-   Change Language

### Status

**DONE**

Do not modify this again unless testing reveals a problem.

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

### Do not remove

The fallback representation.

The system should still understand a typed:

``` text
1
2
```

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

# 16. Implementation Order

Perform the cleanup in this order:

### Phase 1 --- Completed

-   [x] Main Menu

### Phase 2

-   [ ] Doctor Selection
-   [ ] Date Selection
-   [ ] Custom Date Prompt
-   [ ] Time Selection
-   [ ] Booking Confirmation

### Phase 3

-   [ ] My Appointments
-   [ ] Cancel Appointment
-   [ ] Cancel Confirmation
-   [ ] Reschedule Appointment
-   [ ] Reschedule Date
-   [ ] Reschedule Confirmation
-   [ ] Language Selection

### Phase 4 --- Final QA

Run complete end-to-end tests:

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
→ Manage
→ Cancel
→ Confirm cancellation
```

``` text
Hi
→ Manage
→ Reschedule
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

The UI cleanup is complete when:

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
