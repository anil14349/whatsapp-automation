# WhatsApp Message Triggers & Actions

Complete map of all current WhatsApp message triggers, what they do, and the conversation flows they initiate.

---

## Overview

The system uses **state machines** to handle conversations:
- **Patient Portal**: Booking, my appointments, cancel, reschedule, home collection
- **Doctor Portal**: Manage availability, leaves, appointments, broadcasts
- **Cron Triggers**: Scheduled jobs (reminders, cleanup, auto-complete)

Each incoming WhatsApp message triggers specific actions based on the patient/doctor's current state.

---

## Patient Portal Triggers

### Main Menu (Entry Points)

When patient sends any message while in `MAIN_MENU` state:

| Input | Trigger | Action | Next State |
|-------|---------|--------|-----------|
| **1** | Book Appointment | Show doctor selection menu | `BOOK_DOCTOR` |
| **2** | My Appointments | List patient's confirmed appointments | `APPOINTMENT_LIST` |
| **3** | My Language | Show language selector | `LANGUAGE_SELECT` |
| **\*** | More Menu | Show additional options | `MORE_MENU` |
| Other | Invalid | Show "Invalid option" message | `MAIN_MENU` |

### Language Selection (LANGUAGE_SELECT)

| Input | Trigger | Action | Next State |
|-------|---------|--------|-----------|
| **1** | English | Set language to EN | `MAIN_MENU` |
| **2** | తెలుగు (Telugu) | Set language to TE | `MAIN_MENU` |
| **3** | हिन्दी (Hindi) | Set language to HI | `MAIN_MENU` |
| **4** | ಕನ್ನಡ (Kannada) | Set language to KA | `MAIN_MENU` |
| **5** | தமிழ் (Tamil) | Set language to TA | `MAIN_MENU` |
| **6** | മലയാളം (Malayalam) | Set language to ML | `MAIN_MENU` |

---

## Booking Flow

### Step 1: Doctor Selection (BOOK_DOCTOR)

| Input | Trigger | Action | Next State |
|-------|---------|--------|-----------|
| **1-9** | Select Doctor | Choose doctor from list | `BOOK_DATE` |
| **prev** | Previous Doctors | Show previous page of doctors | `BOOK_DOCTOR` (refresh) |
| **next** | Next Doctors | Show next page of doctors | `BOOK_DOCTOR` (refresh) |
| **0** | Back | Return to main menu | `MAIN_MENU` |

**Example:**
```
🏥 Select Doctor:
1. Dr. Sharma - General
2. Dr. Patel - Cardiology  
3. Dr. Singh - Pediatrics
prev | next | 0. Back
```

### Step 2: Date Selection (BOOK_DATE)

| Input | Trigger | Action | Next State |
|-------|---------|--------|-----------|
| **1-7** | Quick Date | Book for predefined date option | `BOOK_TIME` |
| **custom** | Custom Date | Enter date manually (YYYY-MM-DD) | `BOOK_DATE_CUSTOM` |
| **0** | Back | Return to doctor selection | `BOOK_DOCTOR` |

**Example:**
```
📅 Select Date:
1. Tomorrow
2. 3 days later
3. Next week
...
custom. Enter custom date
0. Back
```

### Step 2b: Custom Date Entry (BOOK_DATE_CUSTOM)

| Input | Trigger | Action | Next State |
|-------|---------|--------|-----------|
| **YYYY-MM-DD** | Date Input | Validate & proceed | `BOOK_TIME` |
| Invalid format | Invalid Date | Show "Invalid date format" | `BOOK_DATE_CUSTOM` |

**Example:**
```
📅 Enter date (YYYY-MM-DD):
2026-09-25
```

### Step 3: Time Selection (BOOK_TIME)

| Input | Trigger | Action | Next State |
|-------|---------|--------|-----------|
| **1-X** | Select Time | Choose available time slot | `BOOK_NAME` or `BOOK_CONFIRM` |
| **0** | Back | Return to date selection | `BOOK_DATE` |

**Example:**
```
🕐 Select Time:
1. 9:00 AM
2. 10:00 AM
3. 11:00 AM
...
0. Back
```

### Step 4: Name Entry (BOOK_NAME) - Only if needed

| Input | Trigger | Action | Next State |
|-------|---------|--------|-----------|
| **Patient Name** | Name Input | Store name | `BOOK_CONFIRM` |
| Empty | No Name | Show "Name required" | `BOOK_NAME` |

**Shown only if:** Patient doesn't have a valid name on file

### Step 5: Confirmation (BOOK_CONFIRM)

| Input | Trigger | Action | Next State |
|-------|---------|--------|-----------|
| **1** | Confirm | Create appointment, send receipt | `MAIN_MENU` |
| **0** | Cancel | Return to doctor selection | `BOOK_DOCTOR` |

**Shows:**
```
✓ Confirm booking for:
Dr. Sharma
Date: Sept 20, 2026
Time: 2:00 PM

1. Confirm
0. Cancel
```

---

## My Appointments Flow

### Step 1: Appointment List (APPOINTMENT_LIST)

| Input | Trigger | Action | Next State |
|-------|---------|--------|-----------|
| **1-9** | Select Appointment | Show appointment details & actions | `APPOINTMENT_ACTION` |
| **prev** | Previous | Show previous appointments | `APPOINTMENT_LIST` |
| **next** | Next | Show next appointments | `APPOINTMENT_LIST` |
| **0** | Back | Return to main menu | `MAIN_MENU` |

**Shows:**
```
📋 Your Appointments:
1. Dr. Sharma - Sept 20 @ 2:00 PM (A12A3BC4)
2. Dr. Patel - Sept 25 @ 10:00 AM (B23B4CD5)
...
prev | next | 0. Back
```

### Step 2: Appointment Actions (APPOINTMENT_ACTION)

| Input | Trigger | Action | Next State |
|-------|---------|--------|-----------|
| **1** | Cancel | Confirm cancellation | `CANCEL_CONFIRM` |
| **2** | Reschedule | Start reschedule flow | `RESCHEDULE_DATE` |
| **3** | Get Receipt | Send appointment receipt image | `APPOINTMENT_LIST` |
| **0** | Back | Return to appointment list | `APPOINTMENT_LIST` |

**Shows:**
```
ℹ️ Dr. Sharma - Sept 20, 2:00 PM
Code: A12A3BC4

1. Cancel
2. Reschedule
3. Get Receipt
0. Back
```

### Step 3a: Cancel Flow (CANCEL_CONFIRM)

| Input | Trigger | Action | Next State |
|-------|---------|--------|-----------|
| **1** | Confirm | Cancel appointment | `MAIN_MENU` |
| **0** | No | Go back | `APPOINTMENT_ACTION` |

**Shows:**
```
⚠️ Cancel appointment?

1. Yes, cancel
0. No, go back
```

### Step 3b: Reschedule Flow (RESCHEDULE_DATE)

| Input | Trigger | Action | Next State |
|-------|---------|--------|-----------|
| **1-7** | Quick Date | Select new date | `RESCHEDULE_TIME` |
| **custom** | Custom Date | Enter date manually | `RESCHEDULE_DATE_CUSTOM` |
| **0** | Back | Cancel reschedule | `APPOINTMENT_ACTION` |

Then proceed through time selection (`RESCHEDULE_TIME`) and confirm (`RESCHEDULE_CONFIRM`).

---

## More Menu (MORE_MENU)

| Input | Trigger | Action | Next State |
|-------|---------|--------|-----------|
| **1** | My Profile | Show patient info | `MAIN_MENU` |
| **2** | Change Language | Change language preference | `LANGUAGE_SELECT` |
| **3** | Clinic Info | Show clinic contact/details | `MAIN_MENU` |
| **4** | Feedback | Send feedback/complaint | `FEEDBACK_TEXT` |
| **5** | Help | Show FAQs | `MAIN_MENU` |
| **6** | 🩸 Home Sample Collection | Request home blood collection | `HOME_COLLECTION_LOCATION` |
| **0** | Back | Return to main menu | `MAIN_MENU` |

**Shows:**
```
📌 More Options:
1. My Profile
2. Change Language
3. Clinic Info
4. Feedback
5. Help
6. 🩸 Home Sample Collection
0. Back
```

---

## Home Sample Collection Flow (HOME_COLLECTION_LOCATION)

Triggered by: **\* → More → 6. Home Sample Collection**

| Input | Trigger | Action | Next State |
|-------|---------|--------|-----------|
| **Location Share** | Patient shares location | Validate distance from clinic | `HOME_COLLECTION_DATE` |
| Outside radius | Too far | Show "Outside service area" | `HOME_COLLECTION_LOCATION` |

**Distance check:**
- Radius: `HOME_COLLECTION_RADIUS_KM` (default 5 km)
- Center: `HOSPITAL_LOCATION` coordinates
- Uses haversine distance calculation

### Home Collection: Date Selection (HOME_COLLECTION_DATE)

| Input | Trigger | Action | Next State |
|-------|---------|--------|-----------|
| **1-7** | Quick Date | Select date | `HOME_COLLECTION_TIME` |
| **custom** | Custom Date | Enter date (YYYY-MM-DD) | `HOME_COLLECTION_DATE_CUSTOM` |

### Home Collection: Time Window (HOME_COLLECTION_TIME)

| Input | Trigger | Action | Next State |
|-------|---------|--------|-----------|
| **1-4** | Select Window | Choose time window | Create request, `MAIN_MENU` |

**Example windows:**
```
1. Morning (6 AM - 10 AM)
2. Afternoon (10 AM - 2 PM)
3. Evening (2 PM - 6 PM)
4. Custom Time
```

---

## Doctor Portal Triggers

### Doctor Menu (DOCTOR_MENU)

Triggered by: **Doctor sends any message**

| Input | Trigger | Action | Next State |
|-------|---------|--------|-----------|
| **1** | My Appointments | List doctor's appointments | `DOCTOR_APPT_LIST` |
| **2** | Manage Availability | Set working hours | `DOCTOR_AVAIL_MENU` |
| **3** | My Leaves | Manage time off | `DOCTOR_LEAVE_MENU` |
| **4** | Broadcast Message | Send to all patients | `DOCTOR_BROADCAST_DATE` |

### Doctor Appointments (DOCTOR_APPT_LIST)

| Input | Trigger | Action | Next State |
|-------|---------|--------|-----------|
| **1-9** | Select Appointment | Show appointment details | `DOCTOR_APPT_ACTION` |
| **prev/next** | Pagination | Navigate appointments | `DOCTOR_APPT_LIST` |

### Doctor Appointment Actions (DOCTOR_APPT_ACTION)

| Input | Trigger | Action | Next State |
|-------|---------|--------|-----------|
| **1** | Cancel | Confirm cancellation | `DOCTOR_CANCEL_CONFIRM` |
| **2** | Reschedule | Start reschedule | `DOCTOR_RESCHEDULE_DATE` |
| **3** | Mark Complete | Mark appointment done | `DOCTOR_MENU` |
| **4** | Mark No-Show | Patient didn't show | `DOCTOR_MENU` |

### Doctor Availability (DOCTOR_AVAIL_MENU)

| Input | Trigger | Action | Next State |
|-------|---------|--------|-----------|
| **1** | Add Hours | Add working day/hours | `DOCTOR_AVAIL_DAY` |
| **2** | Remove Hours | Remove working day | `DOCTOR_AVAIL_REMOVE` |

**DOCTOR_AVAIL_DAY flow:**
- Select day of week
- Enter start time
- Enter end time
- Confirm and save

### Doctor Leaves (DOCTOR_LEAVE_MENU)

| Input | Trigger | Action | Next State |
|-------|---------|--------|-----------|
| **1** | Add Leave | Single day or range off | `DOCTOR_LEAVE_DATE` |
| **2** | Cancel Leave | Remove time off | `DOCTOR_LEAVE_CANCEL_PICK` |

**Single day leave:**
- Select date
- Enter reason (optional)
- Confirm

**Range leave:**
- Start date
- End date
- Reason
- Confirm

### Doctor Broadcast (DOCTOR_BROADCAST_DATE)

| Input | Trigger | Action | Next State |
|-------|---------|--------|-----------|
| **1-30** | Quick Date | Select date | `DOCTOR_BROADCAST_MESSAGE` |
| **custom** | Custom Date | Enter date | `DOCTOR_BROADCAST_DATE_CUSTOM` |

**Then:**
- Enter message text
- Confirm and send to all patients with appointments that day

---

## WhatsApp Flow Triggers

### Native WhatsApp Flows (Not menu-driven)

When **interactive form screens** are used (instead of buttons/lists):

| Trigger | Action | Data Collected |
|---------|--------|---|
| **Doctor Selection Flow** | Native form to pick doctor | Doctor ID |
| **Date Selection Flow** | Native form to pick date | ISO date string |
| **Time Selection Flow** | Native form to pick time | 24-hour time |
| **Confirmation Flow** | Native form to confirm booking | Appointment code |

**Endpoint:** `/api/whatsapp/flow`

- Handles `flow_reply` messages (form responses)
- Creates appointments server-side
- Returns success/error to client

---

## Automatic Triggers (No Message Required)

### Cron Jobs

| Job | Schedule | Trigger | Action |
|-----|----------|---------|--------|
| **Appointment Reminders** | Every 30 min | Auto-trigger | Send "Your appointment is tomorrow" messages |
| **Auto-Complete** | Every 1 hour | Auto-trigger | Mark past appointments as "Completed" |
| **Log Cleanup** | Daily at 1 AM | Auto-trigger | Delete message logs older than retention period |

**Locations:**
```
clinic-app/app/api/cron/reminders/route.ts
clinic-app/app/api/cron/auto-complete/route.ts
clinic-app/app/api/cron/log-cleanup/route.ts
```

---

## Event-Based Triggers

### Receptionist Actions (Admin Portal)

These DON'T require patient WhatsApp messages:

| Action | Trigger | Notification |
|--------|---------|---|
| Edit appointment time | Receptionist clicks "⏰ Time" | WhatsApp sent to patient |
| Reschedule appointment | Receptionist clicks "📅 Reschedule" | WhatsApp sent to patient |
| Change doctor | Receptionist clicks "👨‍⚕️ Doctor" | WhatsApp sent to patient |
| Edit patient name | Receptionist clicks "Edit Name" | No notification |

---

## Message Type Handling

### Text Messages
- Normalized to lowercase
- Matched against state machine

### Interactive Messages (Buttons/Lists)
- ID parsed from button ID
- Action routed based on current state

### Location Messages
- Latitude/longitude extracted
- Distance calculated to clinic
- Validated for home collection service

### Flow Replies (Native Forms)
- Form data parsed as JSON
- Routed to `/api/whatsapp/flow` handler
- Appointment created on server

---

## State Diagram: Patient Booking

```
MAIN_MENU
    ↓ (user sends "1")
BOOK_DOCTOR
    ↓ (select doctor 1-9)
BOOK_DATE
    ↓ (select quick date 1-7 or custom)
BOOK_DATE_CUSTOM (only if custom)
    ↓ (enter YYYY-MM-DD)
BOOK_TIME
    ↓ (select time 1-X)
BOOK_NAME (only if no name on file)
    ↓ (enter patient name)
BOOK_CONFIRM
    ↓ (confirm with 1)
MAIN_MENU (appointment created, receipt sent)
```

---

## State Diagram: Patient Cancel/Reschedule

```
MAIN_MENU
    ↓ (user sends "2")
APPOINTMENT_LIST
    ↓ (select appointment 1-9)
APPOINTMENT_ACTION
    ↓ (select action 1-4)
    
    CANCEL_CONFIRM → MAIN_MENU (appointment cancelled)
    OR
    RESCHEDULE_DATE → RESCHEDULE_TIME → RESCHEDULE_CONFIRM → MAIN_MENU
```

---

## Configuration

### Settings That Affect Triggers

| Setting | Purpose | Triggers Affected |
|---------|---------|---|
| `CLINIC_WELCOME_IMAGE_URL` | Image to send on greeting | Initial message |
| `HOME_COLLECTION_RADIUS_KM` | Service area radius | Home collection validation |
| `HOSPITAL_LOCATION` | Clinic coordinates | Home collection distance check |
| `MAX_BOOKING_DAYS_AHEAD` | Max days to book future | Date selection validation |
| `APPOINTMENT_REMINDER_HOURS` | Hours before reminder sent | Cron reminder trigger |
| `INTERACTIVE_MENUS_ENABLED` | Use buttons/lists vs text | Menu-driven triggers |
| `ENABLE_DOCTOR_PORTAL` | Activate doctor features | Doctor flow availability |

---

## Error Scenarios

### Invalid Input Handling

| Scenario | Current State | Input | Response |
|----------|---|---|---|
| Invalid doctor selection | BOOK_DOCTOR | "abc" | "Invalid option. Please select 1-9" |
| Invalid date format | BOOK_DATE_CUSTOM | "25-09-2026" | "Invalid date format. Use YYYY-MM-DD" |
| Past date | BOOK_DATE | "2020-01-01" | "Cannot book in the past" |
| No available slots | BOOK_TIME | (none available) | "No available slots. Try another date" |
| Invalid language | LANGUAGE_SELECT | "7" | "Invalid option. Select 1-6" |

---

## Testing Triggers Manually

### Start Conversation
```
Send: Hi
Response: Welcome! Select language or continue
```

### Book Appointment
```
Send: 1
Response: Select doctor
Send: 1
Response: Select date
Send: 1
Response: Select time
Send: 1
Response: Confirm booking?
Send: 1
Response: Appointment confirmed + receipt
```

### Check Appointments
```
Send: 2
Response: Your appointments list
Send: 1
Response: Appointment details + actions
```

### Change Language
```
Send: *
Response: More menu
Send: 2
Response: Select language (1-6)
Send: 3
Response: Language changed to Hindi
```

### Home Collection
```
Send: *
Response: More menu
Send: 6
Response: Share your location
[Share location]
Response: Select date
Send: custom
Response: Enter date (YYYY-MM-DD)
Send: 2026-09-25
Response: Select time window
Send: 1
Response: Request confirmed
```

---

## What's NOT Yet Triggerable via WhatsApp

| Feature | Status | Alternative |
|---------|--------|---|
| ✅ Book appointments | Enabled | Native Flow or menu |
| ✅ Cancel appointments | Enabled | Text menu |
| ✅ Reschedule appointments | Enabled | Text menu |
| ✅ Home collection | Enabled | Location + menu |
| ✅ Doctor portal | Enabled | Text menu |
| ✅ Appointment reminders | Enabled | Automatic (cron) |
| ❌ Feedback/complaints | Not yet | Use clinic phone/email |
| ❌ Billing info | Not yet | Use web portal |
| ❌ Test results | Not yet | Use clinic app |
| ❌ Prescriptions | Not yet | Use clinic app |
| ❌ Edit patient profile | Not yet | Receptionist edits in admin |

---

## Future Triggers to Consider

- SMS appointment reminders (backup to WhatsApp)
- Patient-initiated rescheduling via WhatsApp (currently only receptionist can)
- Prescription requests via WhatsApp
- Lab result notifications
- Billing/payment links
- Feedback submission and rating
- Emergency contact triggers

