# ABC Clinic WhatsApp --- Missing UI Cleanup

## Purpose

This document tracks the **remaining WhatsApp UI cleanup** after the
latest UI pass.

The core appointment engine is already working and should be treated as
stable.

This document is intentionally limited to **presentation/UI cleanup**.
Do not modify appointment business logic unless a separate functional
defect is discovered.

------------------------------------------------------------------------

# 1. Current UI Cleanup Status

## Already cleaned

The following screens have been updated to the new concise UI style:

-   [x] Main Menu
-   [x] Doctor Selection
-   [x] Booking Date Selection
-   [x] Reschedule Date Selection
-   [x] Time Selection
-   [x] Booking Confirmation

The current style follows:

> **Text explains. Interactive controls act.**

------------------------------------------------------------------------

# 2. Main Menu Structure

The latest implementation uses:

``` text
Book Appointment
My Appointments
More
```

`More` contains secondary functions such as:

-   Cancel Appointment
-   Reschedule Appointment
-   Change Language

This three-item main menu should be retained unless testing shows a
usability problem.

Do not revert it to a long five-item numbered menu.

------------------------------------------------------------------------

# 3. Remaining UI Cleanup

## 3.1 My Appointments

### Current issue

The appointment screen still contains older-style explanatory/selection
text.

### Target

Use a concise header:

``` text
📋 Your appointments

Select an appointment.
```

Then show the appointment list interactively.

Example:

``` text
Dr Anil
24-Aug-2026 · 11:00 AM
```

The appointment ID can remain in the details where appropriate.

### Requirements

-   Remove unnecessary repeated "Choose an option" wording.
-   Do not duplicate the appointment list in both text and interactive
    UI.
-   Keep appointment selection IDs unchanged.
-   Preserve existing appointment retrieval logic.

------------------------------------------------------------------------

# 4. Cancel Appointment

## 4.1 Appointment Selection

### Target

``` text
❌ Cancel appointment

Select an appointment to cancel.
```

Then display the selectable appointment list.

Do not display a second numbered representation when the interactive
list is available.

------------------------------------------------------------------------

## 4.2 Cancellation Confirmation

### Target

``` text
⚠️ Cancel this appointment?

👨‍⚕️ Dr Anil
📅 19-Aug-2026
🕐 10:00 AM
🆔 AB29A571C
```

Interactive choices:

``` text
Yes, cancel
No, go back
```

### Requirements

-   Keep the existing confirmation IDs.
-   Keep typed-input fallback.
-   Do not change the cancellation transaction logic.
-   Do not change Google Calendar handling as part of this UI task.

### Calendar note

A previous cancellation failure was identified as a manual
Calendar-state issue.

That is **not part of this UI cleanup**.

------------------------------------------------------------------------

# 5. Reschedule Appointment

## 5.1 Appointment Selection

### Target

``` text
🔄 Reschedule appointment

Select an appointment to reschedule.
```

Then display the selectable appointments.

------------------------------------------------------------------------

## 5.2 Reschedule Date

Target:

``` text
🔄 Dr Anil

Choose a new appointment date.
```

Interactive choices:

``` text
Today
Tomorrow
Other date
```

The current semantic IDs must remain unchanged.

------------------------------------------------------------------------

## 5.3 Reschedule Time

Target:

``` text
📅 24-Aug-2026

Choose a new time.
```

Then show the available time slots interactively.

Pagination must continue to work:

``` text
More times
Earlier times
```

where applicable.

Do not modify slot-pagination logic.

------------------------------------------------------------------------

## 5.4 Reschedule Confirmation

### Target

``` text
🔄 Confirm reschedule?

👨‍⚕️ Dr Anil
📅 24-Aug-2026
🕐 11:00 AM
```

Interactive choices:

``` text
Confirm
Other time
Cancel
```

Existing semantic IDs must remain:

``` text
confirm_yes
confirm_other_time
confirm_cancel
```

Typed fallback must continue to work.

------------------------------------------------------------------------

# 6. Change Language

The language-selection flow is already interactive.

The remaining cleanup is primarily presentation copy.

### Target

``` text
🌐 Choose your language.
```

Then show the selectable languages.

Keep all existing language IDs and language-processing logic unchanged.

------------------------------------------------------------------------

# 7. Navigation UI

The system currently supports:

``` text
0 = Main Menu
9 = Back
```

These should remain supported as typed fallback.

Where interactive controls are available, the user should preferably be
able to tap:

``` text
Main Menu
Back
```

instead of typing `0` or `9`.

Do not change navigation state handling during this UI pass.

------------------------------------------------------------------------

# 8. Do Not Change

The following are **out of scope**:

-   WhatsApp webhook verification
-   `doGet()`
-   `doPost()`
-   inbound message extraction
-   session management
-   appointment availability logic
-   slot generation
-   slot pagination logic
-   booking state machine
-   rescheduling state machine
-   appointment ID generation
-   Google Calendar business logic
-   duplicate inbound/outbound protection
-   interactive message transport
-   semantic action IDs

The goal is to clean the presentation layer without destabilizing the
working system.

------------------------------------------------------------------------

# 9. Implementation Order

Complete the remaining UI work in this order:

### Phase 1 --- Appointment Management

1.  [ ] My Appointments
2.  [ ] Cancel Appointment selection
3.  [ ] Cancel Confirmation
4.  [ ] Reschedule Appointment selection
5.  [ ] Reschedule Date copy
6.  [ ] Reschedule Time copy
7.  [ ] Reschedule Confirmation

### Phase 2 --- Secondary UI

8.  [ ] Change Language copy
9.  [ ] Review Main Menu → More flow
10. [ ] Standardize Back/Main Menu labels

------------------------------------------------------------------------

# 10. UI Consistency Rules

Every interactive screen should follow these principles:

### Rule 1 --- Short context

Use one or two short sentences.

### Rule 2 --- Interactive controls carry choices

Do not repeat the choices as numbered text when an interactive menu is
successfully sent.

### Rule 3 --- Keep fallback support

Numeric input must continue to work.

### Rule 4 --- Semantic IDs

Use meaningful IDs such as:

``` text
confirm_yes
confirm_other_time
confirm_cancel
slot_next
slot_prev
```

Do not replace them with generic IDs.

### Rule 5 --- No business-logic changes

UI cleanup should not alter how appointments are created, cancelled, or
rescheduled.

------------------------------------------------------------------------

# 11. Final QA

After completing the cleanup, test the full patient journey.

## Booking

``` text
Hi
→ Book Appointment
→ Doctor
→ Tomorrow
→ Time
→ Confirm
```

Expected:

``` text
✅ Appointment confirmed
```

## My Appointments

``` text
Hi
→ My Appointments
→ Select appointment
```

## Cancel

``` text
Hi
→ More
→ Cancel Appointment
→ Select appointment
→ Confirm cancellation
```

## Reschedule

``` text
Hi
→ More
→ Reschedule Appointment
→ Select appointment
→ New date
→ New time
→ Confirm
```

Also test:

-   Other time
-   More times
-   Earlier times
-   Back
-   Main Menu
-   Invalid input
-   Typed numeric fallback
-   Custom date
-   Language selection

------------------------------------------------------------------------

# 12. Definition of Done

The UI cleanup is complete when:

-   [ ] No unnecessary numbered menus are displayed when interactive
    controls are available.
-   [ ] Each screen has concise contextual text.
-   [ ] Interactive controls provide the actual choices.
-   [ ] Appointment details are not unnecessarily duplicated.
-   [ ] Back/Main Menu navigation is consistent.
-   [ ] Typed fallback still works.
-   [ ] Booking still works.
-   [ ] Rescheduling still works.
-   [ ] Cancellation UI works.
-   [ ] Slot pagination still works.
-   [ ] Confirmation actions still work.
-   [ ] No state-machine regressions are introduced.

------------------------------------------------------------------------

# 13. Guiding Principle

The final WhatsApp experience should follow one simple rule:

> **Text explains. Interactive controls act.**

The patient should understand where they are from the message and
perform the action by tapping the appropriate option.

The numbered fallback exists for compatibility, not as the primary UI.
