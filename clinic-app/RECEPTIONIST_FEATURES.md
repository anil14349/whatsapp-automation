# Receptionist Appointment & Patient Management Features

This document describes the new appointment and patient management features available to receptionists in the clinic-app admin portal.

---

## Overview

Receptionists can now:
1. ✅ **Edit appointment time** (same date, different slot)
2. ✅ **Reschedule appointment** (different date and/or time)
3. ✅ **Reassign doctor** (change to different specialist)
4. ✅ **Correct patient name** (fix typos/incorrect entries)

---

## Features

### 1. Edit Appointment Time

**When to use:** Patient needs to move their appointment to a different time on the same day.

**How it works:**
1. Go to **Appointments** page
2. Find the appointment (search by doctor/date/status if needed)
3. Click **⏰ Time** button on the appointment row
4. Modal opens showing:
   - Doctor name
   - Date (fixed, cannot change)
   - Current time
   - Available time slots for that day
5. Select new time from dropdown
6. Click **Update Time**
7. Appointment time is updated, patient information is logged

**Validation:**
- ✅ Only works for "Confirmed" appointments
- ✅ Validates slot is still available (prevents double-booking)
- ✅ Changes are logged for audit trail

---

### 2. Reschedule Appointment

**When to use:** Patient needs to move appointment to different date (and possibly different time).

**How it works:**
1. Go to **Appointments** page
2. Find the appointment
3. Click **📅 Reschedule** button
4. Modal opens showing:
   - Doctor name (fixed)
   - Current schedule (date + time)
   - Date picker (next 30 days, starting tomorrow)
   - Time selector
5. Select new date
   - Times for that date automatically load
6. Select new time
7. Click **Reschedule**
8. Appointment date and time are updated

**Validation:**
- ✅ Only works for "Confirmed" appointments
- ✅ Cannot reschedule to past dates
- ✅ Validates new slot is available
- ✅ Checks patient doesn't already have appointment on new date
- ✅ Changes are logged for audit trail

**Date Constraints:**
- Minimum: Tomorrow
- Maximum: 30 days from today

---

### 3. Reassign Doctor

**When to use:** Patient needs to see a different specialist.

**How it works:**
1. Go to **Appointments** page
2. Find the appointment
3. Click **👨‍⚕️ Doctor** button
4. Modal opens showing:
   - Date (fixed)
   - Current time
   - Doctor dropdown (lists all active doctors with specialization)
   - Available times for selected doctor
5. Select new doctor from dropdown
   - Times for that doctor automatically load
6. Select new time
7. Click **Reassign Doctor**
8. Doctor and time are updated

**Validation:**
- ✅ Only works for "Confirmed" appointments
- ✅ Shows only active doctors
- ✅ Validates new doctor/time slot is available
- ✅ Changes are logged for audit trail

**Note:** If new doctor has no availability on that date, message shows "No available slots for this doctor on this date"

---

### 4. Edit Patient Name

**When to use:** Correct typos or wrong names in patient records.

**How it works:**
1. Go to **Patients** page
2. Search for patient by name or phone (if needed)
3. Find patient in table
4. Click **Edit Name** button on the row
5. Modal opens showing:
   - Phone number (read-only)
   - Name field (current name pre-filled)
   - Patient code (read-only)
6. Update name
7. Click **Save Name**
8. Patient name is updated everywhere

**Validation:**
- ✅ Name must be at least 2 characters
- ✅ Cannot be empty or numbers-only
- ✅ Detects if name hasn't actually changed
- ✅ Prevents accidental duplicate saves

**Impact:**
- Updates patient record immediately
- Affects all future appointments for this patient
- Does NOT retroactively change past appointment records (for audit trail)

---

## Appointment Status Buttons

On the Appointments page, confirmed appointments show quick action buttons:

| Button | Action | Result |
|--------|--------|--------|
| ⏰ Time | Edit time | Opens time edit modal |
| 📅 Reschedule | Reschedule | Opens date/time reschedule modal |
| 👨‍⚕️ Doctor | Reassign | Opens doctor reassignment modal |
| ✓ Done | Mark completed | Immediately marks as "Completed" |
| ✗ No-Show | Mark no-show | Immediately marks as "No-Show" |
| Cancel | Cancel appointment | Immediately cancels (with confirmation) |

**Note:** For non-confirmed appointments (Completed, No-Show, Cancelled), no action buttons are shown.

---

## Validation & Safety

### Data Integrity
- All changes are validated before saving
- Slot availability is re-checked at submission time
- Double-booking is prevented with database constraints
- Conflicts are reported with clear error messages

### Audit Trail
All appointment changes are logged with:
- Timestamp
- Type of change (time, date, doctor, etc.)
- Old value → New value
- System marker for easy filtering

View logs at: **Supabase Dashboard** → **message_log table** → Filter for "AUDIT" type

### Error Handling
If an edit fails:
1. Error message displayed in modal
2. Form remains open (not cleared)
3. No changes are applied
4. User can retry with different values

---

## Examples

### Example 1: Patient needs morning appointment instead of afternoon

**Current:** Dr. Sharma, Sept 15, 2:00 PM  
**Request:** Change to morning

**Steps:**
1. Click **⏰ Time**
2. Click "Load Available Times"
3. Select "9:00 AM" from dropdown
4. Click "Update Time"

**Result:** Appointment moved to 9:00 AM, patient sees change in WhatsApp

---

### Example 2: Patient moves to different city, needs different week

**Current:** Dr. Patel, Sept 15, 3:00 PM  
**Request:** Reschedule to Sept 22-25

**Steps:**
1. Click **📅 Reschedule**
2. Select date: Sept 22
3. Select time: 10:00 AM
4. Click "Reschedule"

**Result:** Appointment moved to Sept 22 @ 10:00 AM

---

### Example 3: Patient prefers different doctor

**Current:** Dr. Sharma (General), Sept 15, 2:00 PM  
**Request:** Change to Dr. Patel (Cardiology)

**Steps:**
1. Click **👨‍⚕️ Doctor**
2. Select doctor: "Dr. Patel - Cardiology"
3. Select time: 2:30 PM (or available time)
4. Click "Reassign Doctor"

**Result:** Appointment reassigned to Dr. Patel

---

### Example 4: Fix patient name typo

**Current:** "John Smit" (wrong spelling)  
**Fix:** "John Smith"

**Steps:**
1. Go to Patients page
2. Search "John" or "9876543210"
3. Click "Edit Name"
4. Change to "John Smith"
5. Click "Save Name"

**Result:** Patient record corrected, all future appointments show correct name

---

## UI/UX Notes

### Modals
- Modals are overlay with semi-transparent background
- Click outside modal to close (no action taken)
- "Cancel" button dismisses without saving
- Forms clear error messages when user edits fields

### Loading States
- Buttons show "...ing" text during submission
- Buttons are disabled while loading
- Dropdown auto-loads options when date/doctor selected

### Date/Time Pickers
- HTML5 date input (native mobile datepicker)
- Time shown in 12-hour format with AM/PM
- Slots organized chronologically
- Already-booked slots are automatically excluded

---

## Permissions

These features require:
- ✅ **ADMIN** role: Full access
- ✅ **RECEPTIONIST** role: Full access
- ❌ **DOCTOR** role: No access
- ❌ **Unauthenticated**: No access

---

## Database Changes

### New Functions
```typescript
// lib/appointments.ts
export async function updateAppointmentTime(...)
export async function updateAppointmentDateTime(...)
export async function changeAppointmentDoctor(...)

// lib/patients.ts
export async function updatePatientName(...)
```

### New Server Actions
```typescript
// app/admin/appointments/actions.ts
export async function editAppointmentTimeAction(...)
export async function editAppointmentDateTimeAction(...)
export async function editAppointmentDoctorAction(...)
export async function editPatientNameAction(...)
```

### New Components
```typescript
// app/admin/appointments/
EditAppointmentTimeModal.tsx
EditAppointmentDateTimeModal.tsx
EditAppointmentDoctorModal.tsx

// app/admin/patients/
EditPatientNameModal.tsx
```

### Database Tables Affected
- `appointments` (time, date, doctor_id updated)
- `patients` (name updated)
- `message_log` (audit entries created)

---

## Testing Checklist

- [ ] Edit appointment time on same day
  - [ ] Verify time changes
  - [ ] Verify audit log created
  - [ ] Verify no double-booking allowed
  
- [ ] Reschedule to different date
  - [ ] Verify date changes
  - [ ] Verify time changes
  - [ ] Verify cannot reschedule to past
  - [ ] Verify one-per-patient-per-day constraint
  
- [ ] Reassign doctor
  - [ ] Verify doctor changes
  - [ ] Verify time can change
  - [ ] Verify only active doctors shown
  - [ ] Verify availability checked for new doctor
  
- [ ] Edit patient name
  - [ ] Verify name updates
  - [ ] Verify 2-character minimum enforced
  - [ ] Verify no empty/numbers-only names
  - [ ] Verify change affects only patient record, not past appointments

---

## Troubleshooting

### "Time slot is no longer available"
**Cause:** Between when slots loaded and when you submitted, someone else booked it  
**Solution:** Reload modal to see current available times, select another slot

### "No available slots for this doctor on this date"
**Cause:** Doctor has no free time on that date  
**Solution:** Choose different date or different doctor

### "Patient already has an appointment on this date"
**Cause:** Patient has existing "Confirmed" appointment that day  
**Solution:** Cancel existing appointment first, then reschedule this one

### "Cannot edit time for X appointment"
**Cause:** Appointment status is not "Confirmed" (already completed/cancelled/no-show)  
**Solution:** Only confirmed appointments can be edited

### Changes not showing up immediately
**Cause:** Browser cache or stale data  
**Solution:** Refresh page (Ctrl+R or Cmd+R)

---

## Future Enhancements

Possible additions in future versions:
- [ ] Send WhatsApp notification to patient when appointment changed
- [ ] Show appointment history/changelog for each appointment
- [ ] Bulk reschedule multiple appointments
- [ ] Blackout dates (holidays/clinic closed)
- [ ] Edit patient phone number (with validation)
- [ ] Edit doctor availability from UI
- [ ] Email notifications to patients

---

## Questions or Issues?

- Check the troubleshooting section above
- Review Supabase logs for database errors
- Verify patient/doctor/appointment records exist in database
- Ensure you're logged in with ADMIN or RECEPTIONIST role

