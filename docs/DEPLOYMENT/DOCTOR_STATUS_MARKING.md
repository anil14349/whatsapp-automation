# Doctor Appointment Status Marking

## Feature Overview

Doctors can now mark appointments as **COMPLETED** or **NO_SHOW** after seeing patients. This allows clinics to:
- Track completed appointments for billing and record-keeping
- Record no-show appointments to identify patients who missed scheduled visits
- Maintain accurate appointment status for analytics and reporting

## User Flow

### 1. Doctor Portal Menu
After authentication, doctor sees menu with new option:
```
👨‍⚕️ Doctor Portal Menu:

📅 Availability
🗓️ Leave
📋 Appointments
✅ Mark Status    ← NEW
🚪 Logout
```

### 2. Select "Mark Status"
Doctor taps "Mark Status" button → System displays today's CONFIRMED appointments:
```
📌 Select appointment to mark status:

1. 10:00 - John Doe
2. 14:30 - Jane Smith
3. 16:00 - Robert Johnson

Reply with number (e.g., 1):
```

### 3. Select Appointment
Doctor replies with appointment number → System shows status options:
```
Mark appointment for Jane Smith at 14:30:

✅ Completed
❌ No Show
```

### 4. Confirm Status
Doctor taps one of the status buttons → System updates database and confirms:
```
✅ Appointment for Jane Smith marked as Completed.

Returning to menu...
```

Doctor is returned to main menu and can mark more appointments.

## Database Changes

### Appointments Table Updates

**New Status Values**:
- `COMPLETED`: Appointment was completed and patient was seen
- `NO_SHOW`: Patient did not attend the appointment

**New/Updated Columns**:
- `completed_at` (TIMESTAMP): Timestamp when appointment was marked COMPLETED
  - Automatically set to current timestamp when status changes to COMPLETED
  - Set to NULL if status changes away from COMPLETED

**Existing Columns Used**:
- `status`: Updated to COMPLETED or NO_SHOW
- `updated_at`: Updated to current timestamp

**Statuses Flow**:
```
CONFIRMED
  ↓
(Doctor action)
  ├─ COMPLETED (completed_at set)
  └─ NO_SHOW (completed_at remains NULL)
```

## Code Changes

### Button IDs (button-ids.ts)
Added to `DOCTOR_MENU`:
```typescript
MARK_STATUS: "doctor_mark_status",   // NEW - was CANCEL
LOGOUT: "doctor_logout",              // NEW - was CANCEL
```

### Doctor Handler (doctor-handler.ts)

**New State Handlers**:
1. `DOCTOR_MARK_STATUS`: Display list of confirmable appointments
2. `DOCTOR_MARK_STATUS_SELECT`: Receive appointment selection number
3. `DOCTOR_MARK_STATUS_CONFIRM`: Receive status choice and update database

**New Methods**:
- `showMarkStatusAppointments()`: Query today's appointments, filter CONFIRMED, format with indices
- `handleMarkStatus()`: Route from menu to mark status flow
- `handleMarkStatusSelect()`: Parse appointment number, show status options
- `handleMarkStatusConfirm()`: Parse status choice, call updateAppointmentStatus()

**Updated Methods**:
- `showMenu()`: Added MARK_STATUS and LOGOUT buttons, removed CANCEL
- `handleMenu()`: Added case for MARK_STATUS, changed CANCEL to LOGOUT
- `showTodayAppointments()`: Now fetches real appointments from database, shows status icons

### Supabase Client (multi-clinic-supabase-client.ts)
**Method Already Exists**:
- `updateAppointmentStatus(clinicId, appointmentId, newStatus, reason)`: Updates status and completed_at timestamp

**Query Already Exists**:
- `getDoctorAppointments(clinicId, doctorId, date)`: Fetches doctor's appointments for date, filters CONFIRMED

## Security & Validation

### Access Control
- Only authenticated doctors can access
- Doctor can only mark their own appointments (filtered by doctorId)
- Only CONFIRMED appointments can be marked (filtered in query)

### Input Validation
- Appointment selection must be valid number within range
- Status choice must be one of: "status_completed" or "status_no_show"
- Invalid inputs trigger error messages and re-prompt

### Data Integrity
- UNIQUE constraint on appointment_id prevents duplicate status updates
- Transaction handling in updateAppointmentStatus() ensures atomicity
- Timestamps (updated_at, completed_at) are server-side generated

## Multi-Language Support (Future Enhancement)

Current implementation is in English. Can be extended to Hindi with:
```typescript
const messages = {
  EN: {
    selectStatus: "Select appointment to mark status:",
    completed: "✅ Completed",
    noShow: "❌ No Show",
    marked: "Appointment marked as",
    error: "Error updating appointment"
  },
  HI: {
    selectStatus: "स्थिति को चिह्नित करने के लिए अपॉइंटमेंट चुनें:",
    completed: "✅ पूर्ण",
    noShow: "❌ उपस्थित नहीं",
    marked: "अपॉइंटमेंट को चिह्नित किया गया",
    error: "अपॉइंटमेंट को अपडेट करने में त्रुटि"
  }
};
```

## Testing Checklist

### Unit Tests
- [ ] verifyDoctorAuthenticated() - Check session is authenticated
- [ ] filterConfirmedAppointments() - Only CONFIRMED statuses returned
- [ ] parseAppointmentSelection() - Valid range 1-N, invalid inputs rejected
- [ ] parseStatusChoice() - Only valid status IDs accepted
- [ ] validateDoctorOwnership() - Doctor can only mark own appointments

### Integration Tests
1. **Create appointment** → Mark as COMPLETED
   - [ ] Appointment created with status=CONFIRMED
   - [ ] Doctor selects Mark Status
   - [ ] Appointment appears in list
   - [ ] Doctor selects appointment
   - [ ] Doctor selects COMPLETED
   - [ ] Database updated: status=COMPLETED, completed_at set
   - [ ] Confirmation message received

2. **Create appointment** → Mark as NO_SHOW
   - [ ] Appointment created with status=CONFIRMED
   - [ ] Doctor selects Mark Status
   - [ ] Doctor selects NO_SHOW
   - [ ] Database updated: status=NO_SHOW, completed_at is NULL
   - [ ] Confirmation message received

3. **Cancel appointment** → Cannot mark status
   - [ ] Appointment created and cancelled
   - [ ] Doctor selects Mark Status
   - [ ] Appointment does NOT appear in list (filtered out)

4. **Multiple doctors** → Only own appointments
   - [ ] Doctor A creates appointment with Doctor B
   - [ ] Doctor A logs in and selects Mark Status
   - [ ] Only Doctor A's appointments shown
   - [ ] Doctor B's appointment not visible

5. **Error handling**
   - [ ] Invalid appointment number → Error, re-prompt
   - [ ] Invalid status choice → Error, re-prompt
   - [ ] Database error → Error message, return to menu
   - [ ] Network timeout → Graceful error handling

### Manual Testing
```
1. Start WhatsApp session as doctor
2. Send PIN (e.g., 1234)
3. Wait for "✅ Welcome" message
4. Tap "✅ Mark Status"
5. See list of today's appointments
6. Reply with "1" to select first appointment
7. See status options (Completed / No Show)
8. Tap "✅ Completed"
9. See confirmation message
10. Verify database: SELECT * FROM appointments WHERE status='COMPLETED'
```

## Performance Considerations

### Database Queries
- `getDoctorAppointments()`: Filtered by clinic_id + doctor_id + date
  - Index on: (clinic_id, doctor_id, appointment_date)
  - Exists: ✅
  - Expected: ~5-10ms for 100 appointments

- `updateAppointmentStatus()`: By clinic_id + appointment_id
  - Index on: (clinic_id, id)
  - Exists: ✅ (primary key)
  - Expected: ~2-5ms

### Concurrency
- No locking issues (RLS policies handle isolation)
- Each doctor operates independently
- Parallel updates safe per clinic

### Scalability
- Supports 1000s of doctors per clinic
- Supports 100+ appointments per doctor per day
- No memory leaks (session data cleared after flow)

## Monitoring & Analytics

### Queries for Monitoring

**Completed appointments today**:
```sql
SELECT COUNT(*) FROM appointments
WHERE status = 'COMPLETED'
AND completed_at::date = TODAY()
GROUP BY clinic_id;
```

**No-show rate**:
```sql
SELECT
  COUNT(CASE WHEN status = 'NO_SHOW' THEN 1 END) * 100.0 / COUNT(*) as no_show_percentage
FROM appointments
WHERE appointment_date::date = TODAY()
AND status IN ('COMPLETED', 'NO_SHOW');
```

**Average time to mark**:
```sql
SELECT
  AVG(EXTRACT(EPOCH FROM (updated_at - appointment_date))) / 60 as minutes_to_mark
FROM appointments
WHERE status = 'COMPLETED'
AND completed_at IS NOT NULL
AND appointment_date > NOW() - INTERVAL '7 days';
```

## Troubleshooting

### "No pending appointments to mark"
- **Cause**: All today's appointments are already marked COMPLETED/NO_SHOW
- **Fix**: Confirm appointments are actually scheduled and not cancelled

### "Invalid selection" error after valid input
- **Cause**: Session data lost or stale
- **Fix**: Restart flow from menu

### Status not updating in database
- **Cause**: Clinic ID mismatch in session
- **Fix**: Check session data has correct clinic_id set during login

### Doctor sees other doctor's appointments
- **Cause**: Session has wrong doctor_id
- **Fix**: Re-authenticate with correct PIN

## Future Enhancements

1. **Bulk marking**: Mark multiple appointments in one flow
2. **Time tracking**: Record actual appointment duration
3. **Notes**: Add doctor notes when marking NO_SHOW
4. **Reminders**: Notify patient when appointment marked COMPLETED
5. **Multi-language**: Support Hindi and other languages
6. **Mobile app**: Dedicated app for faster marking
7. **Batch operations**: End-of-day summary with confirmation
