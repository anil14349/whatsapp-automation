# Appointment Reminders Integration Summary

**Date**: September 14, 2026  
**Status**: ✅ Integration Complete (Ready for Scheduler Implementation)

## What Was Implemented

### 1. Database Layer
- ✅ **Migration 003**: `appointment_reminders` table with UNIQUE constraint on (appointment_id, reminder_type)
- ✅ **Migration 004**: `preferred_language` column on appointments table for multi-language support
- Tables include: id, clinic_id, appointment_id, reminder_type, scheduled_time, status, message_id, attempts, error_message

### 2. Service Layer
- ✅ **appointment-reminders.ts** (NEW - 310 lines)
  - `formatReminderMessage()`: EN/हिंदी message formatting for 24h and 1h reminders
  - `createAppointmentReminders()`: Creates PENDING reminders on appointment booking
  - `getPendingReminders()`: Queries reminders ready to send
  - `markReminderAsSent()`: Updates status after successful send
  - `markReminderAsFailed()`: Retry logic with exponential backoff (max 3 attempts)
  - `markReminderAsSkipped()`: Marks as SKIPPED when appointment cancelled
  - `getAppointmentDetailsForReminder()`: Fetches appointment data for reminder formatting

### 3. Handler Integration
- ✅ **patient-handler.ts (UPDATED)**
  - Import: createAppointmentReminders, markReminderAsSkipped
  - handleBookConfirm(): Calls createAppointmentReminders() after appointment created
    - Passes preferred_language to store patient's language preference
    - Logs warning if reminder creation fails, doesn't fail booking
  - handleCancelConfirm(): Calls markReminderAsSkipped() for both reminder types
    - Prevents reminders being sent for cancelled appointments

- ✅ **multi-clinic-supabase-client.ts (UPDATED)**
  - Updated createAppointment() to store preferred_language in appointments table

### 4. Type System
- ✅ **multi-clinic-types.ts (UPDATED)**
  - AppointmentReminder interface
  - SendReminderRequest interface
  - ReminderMessageContent interface
  - CreateAppointmentRequest updated with preferred_language field

## User Experience

### For Patients
1. Books appointment → "You'll receive reminders before your appointment."
2. Receives 24-hour reminder: "Reminder: You have an appointment with Dr. [Name] tomorrow at [Time]"
3. Receives 1-hour reminder: "[Time] your appointment is in 1 hour!"
4. Cancels appointment → Reminders automatically marked as SKIPPED (no duplicate sends)
5. All messages in their preferred language (EN or हिंदी)

### For Clinic Staff
- Reminders are automatically created on booking
- No manual intervention required
- Failed reminders automatically retry up to 3 times
- Idempotency prevents duplicate messages on system retry

## Idempotency & Reliability

✅ **UNIQUE Constraint**: (appointment_id, reminder_type) prevents duplicate reminders
✅ **Retry Logic**: Max 3 attempts per reminder via attempt counter
✅ **Message Tracking**: Stores WhatsApp message_id for deduplication
✅ **Skipping**: Cancelled appointments automatically skip reminders
✅ **Error Handling**: All failures logged with error_message and attempt count

## Remaining Work

### Critical Path (Must Complete for Production)
1. **Implement Scheduler/Webhook**
   - Query getPendingReminders() every minute
   - For each: Send via WhatsAppClient → markReminderAsSent() or markReminderAsFailed()
   - Retry logic built into markReminderAsFailed()

### Optional Enhancements (Post-MVP)
1. Home collection reminders (similar pattern to patient reminders)
2. Clinic admin API to view reminder history
3. Patient opt-out functionality
4. Reminder delivery analytics

## File Changes Summary

| File | Change | Lines |
|------|--------|-------|
| appointment-reminders.ts | NEW | 310 |
| migrations/003_add_appointment_reminders.sql | NEW | 35 |
| migrations/004_add_appointment_language.sql | NEW | 8 |
| patient-handler.ts | UPDATED | +15, -2 |
| home-collection-handler.ts | Identified for next phase | - |
| multi-clinic-supabase-client.ts | UPDATED | +1 |
| multi-clinic-types.ts | UPDATED | +8 |

## Testing Checklist

- [ ] Create test appointment and verify reminder records created with PENDING status
- [ ] Cancel appointment and verify reminders marked as SKIPPED
- [ ] Verify appointment records store correct preferred_language
- [ ] Verify reminder messages format correctly for EN and HI languages
- [ ] Test scheduler sending reminders and marking as SENT with message_id
- [ ] Test retry logic: simulate 3 failed sends then mark as FAILED
- [ ] Verify UNIQUE constraint prevents duplicate reminders on concurrent creates
- [ ] Load test: Create 1000 reminders and verify scheduler handles load

## Deployment Steps

1. Deploy migrations 003 and 004 to Supabase
2. Deploy appointment-reminders.ts to functions/shared
3. Deploy updated patient-handler.ts (includes imports and handleBookConfirm/handleCancelConfirm changes)
4. Implement scheduler function (separate task)
5. Run smoke tests to verify end-to-end reminder flow
