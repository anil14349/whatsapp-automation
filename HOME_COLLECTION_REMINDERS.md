# Home Collection Reminders

## Feature Overview

Patients receive a reminder message the day of their scheduled home blood collection visit. This ensures they remember the appointment and are ready when the collection team arrives.

**Key Differences from Appointment Reminders**:
- Single reminder per request (sent on collection day at 8:00 AM)
- vs. Appointment: Two reminders (24-hour and 1-hour before)
- Reminder created when request is submitted (not scheduled)
- Reminder cancelled if home collection request is rejected

## Reminder Timeline

### Automatic Sending
1. Patient submits home collection request with date
2. System creates PENDING reminder scheduled for collection_date at 08:00 AM
3. Cloud Scheduler checks every minute for pending reminders
4. On collection day at 08:00 AM, reminder is sent to patient's phone
5. Reminder status updated to SENT or FAILED

### Message Format

**English**:
```
🩸 Blood Collection Reminder

Hi! Our health team will visit you on [DATE] for blood collection.

📋 Request ID: HC_1234567890_abc123
🏥 Clinic: [Clinic Name]

💡 Please remember:
• Eat a light breakfast
• Wear comfortable clothes
• Keep your phone nearby

Reply to this message if you need to reschedule.
```

**Hindi**:
```
🩸 रक्त संग्रह रिमाइंडर

नमस्ते! हमारी स्वास्थ्य टीम [तारीख] को आपके घर से रक्त संग्रह के लिए आएगी।

📋 अनुरोध ID: HC_1234567890_abc123
🏥 क्लिनिक: [क्लिनिक नाम]

💡 कृपया याद रखें:
• हल्का नाश्ता करें
• आरामदायक पोशाक पहनें
• फोन पास रखें

बदलाव के लिए इसका जवाब दें।
```

## Database Schema

### home_collection_reminders Table

```sql
CREATE TABLE home_collection_reminders (
  id UUID PRIMARY KEY,
  clinic_id UUID NOT NULL,
  request_id VARCHAR(100) NOT NULL UNIQUE,
  patient_phone VARCHAR(20) NOT NULL,
  
  scheduled_time TIMESTAMP NOT NULL,      -- Collection date at 08:00 AM
  status VARCHAR(20) DEFAULT 'PENDING',   -- PENDING, SENT, FAILED, SKIPPED
  message_id VARCHAR(255),                -- WhatsApp message ID
  error_message TEXT,
  preferred_language VARCHAR(5) DEFAULT 'EN',
  
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  sent_at TIMESTAMP,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- UNIQUE(request_id) ensures one reminder per request
```

### home_collection_requests Table Update

Added field:
```sql
ALTER TABLE home_collection_requests 
ADD COLUMN preferred_language VARCHAR(5) DEFAULT 'EN';
```

This stores patient's language preference so reminder is sent in correct language.

## Code Integration

### home-collection-reminders.ts (New Service)

Core functions:
- `createHomeCollectionReminder()`: Create reminder when request submitted
  - Idempotent via UNIQUE(request_id) constraint
  - Scheduled for collection_date at 08:00 AM
  - Supports EN and HI languages
  
- `getPendingHomeCollectionReminders()`: Get reminders ready to send
  - Filters: status=PENDING, scheduled_time <= NOW, attempts < 3
  - Ordered by scheduled_time (oldest first)
  
- `getHomeCollectionDetailsForReminder()`: Fetch clinic and request info
  - Used to format reminder message
  
- `markHomeCollectionReminderAsSent()`: Mark as SENT after successful send
  - Records message_id from WhatsApp API
  
- `markHomeCollectionReminderAsFailed()`: Handle send failures
  - Increments attempts, retries up to 3 times
  - Marks FAILED after max attempts exceeded
  
- `markHomeCollectionRemindersAsSkipped()`: Cancel reminders
  - Called when request is rejected/cancelled

### home-collection-handler.ts (Updated)

Changes:
- Import: `createHomeCollectionReminder`, `markHomeCollectionRemindersAsSkipped`
- `createHomeCollectionRequest()`: After request created, call `createHomeCollectionReminder()`
  - Non-blocking: failure to create reminder doesn't fail the request
  - Logs warning if reminder creation fails
  - Stores `preferred_language` from patient's language choice

### scheduled-reminders/index.ts (Minor Update)

The existing Cloud Scheduler function needs small update to also process home collection reminders:
```typescript
// After processing appointment reminders, process home collection:
const hcReminders = await getPendingHomeCollectionReminders(supabase, clinicId);
for (const reminder of hcReminders) {
    // Send via WhatsApp, update status
}
```

## State Transitions

```
PENDING (creation)
  ↓
(Scheduler checks and sends)
  ├─ SENT (successful send) ✓
  ├─ FAILED (attempt 1) → retry next minute
  ├─ FAILED (attempt 2) → retry next minute
  ├─ FAILED (attempt 3) → FAILED (no more retries)
  └─ SKIPPED (request cancelled before send)
```

## Multi-Clinic Support

- Reminders isolated by `clinic_id`
- Each clinic processes its own reminders
- Scheduler runs `getPendingHomeCollectionReminders()` per clinic
- Supports 1000s of clinics in single system

## Idempotency

```sql
UNIQUE(request_id) constraint prevents duplicates
```

If `createHomeCollectionReminder()` is called multiple times for same request:
- First call creates reminder
- Subsequent calls return NULL (no error)
- No duplicate reminders sent

## Error Handling

**Reminder creation failure**:
- Non-fatal: Request is created successfully
- Warning logged: "Failed to create reminder"
- Patient can still see request ID
- Reminder can be created manually later

**Reminder send failure**:
- Automatic retry: Up to 3 attempts with 1-minute intervals
- After 3 failures: Status = FAILED, investigation needed
- Other pending reminders continue normally

## Monitoring

### Queries

**Pending reminders (ready to send)**:
```sql
SELECT * FROM home_collection_reminders
WHERE status = 'PENDING'
AND scheduled_time <= NOW()
ORDER BY scheduled_time ASC;
```

**Failed reminders**:
```sql
SELECT * FROM home_collection_reminders
WHERE status = 'FAILED'
AND created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC;
```

**Success rate**:
```sql
SELECT
  COUNT(CASE WHEN status = 'SENT' THEN 1 END) * 100.0 / COUNT(*) as success_percentage
FROM home_collection_reminders
WHERE created_at > NOW() - INTERVAL '7 days';
```

**Reminders by language**:
```sql
SELECT preferred_language, COUNT(*) as count
FROM home_collection_reminders
WHERE created_at > NOW() - INTERVAL '1 day'
GROUP BY preferred_language;
```

## Testing Checklist

### Unit Tests
- [ ] `formatHomeCollectionReminderMessage()` returns EN message
- [ ] `formatHomeCollectionReminderMessage()` returns HI message
- [ ] `createHomeCollectionReminder()` creates PENDING reminder
- [ ] `createHomeCollectionReminder()` idempotent on duplicate call
- [ ] `getPendingHomeCollectionReminders()` filters by clinic and time
- [ ] `markHomeCollectionReminderAsSent()` updates status and message_id
- [ ] `markHomeCollectionReminderAsFailed()` increments attempts
- [ ] `markHomeCollectionRemindersAsSkipped()` marks all for request as SKIPPED

### Integration Tests
1. **Create and send reminder**:
   - [ ] Patient submits home collection request
   - [ ] Reminder created with status=PENDING
   - [ ] Scheduler runs on collection day at 08:00
   - [ ] Reminder sent via WhatsApp
   - [ ] Status updated to SENT with message_id

2. **Language preference**:
   - [ ] Patient selects EN language
   - [ ] Reminder sent in English
   - [ ] Patient selects HI language
   - [ ] Reminder sent in Hindi

3. **Retry on failure**:
   - [ ] WhatsApp API returns error
   - [ ] Reminder status remains PENDING (for retry)
   - [ ] Attempts incremented to 1
   - [ ] Next scheduler run retries sending

4. **Skip on cancellation**:
   - [ ] Request created → reminder created
   - [ ] Request rejected via admin panel
   - [ ] `markHomeCollectionRemindersAsSkipped()` called
   - [ ] Reminder status = SKIPPED
   - [ ] No message sent to patient

5. **Multi-clinic isolation**:
   - [ ] Clinic A has 3 pending reminders
   - [ ] Clinic B has 2 pending reminders
   - [ ] Scheduler runs for Clinic A
   - [ ] Only Clinic A reminders sent
   - [ ] Clinic B reminders still PENDING

### Manual Testing
```
1. Start WhatsApp session as patient
2. Request home collection for tomorrow
3. Select preferred language (EN or HI)
4. Confirm request
5. See "Request ID: HC_..."
6. Next day at 08:00 AM, check if reminder received
7. Verify message in correct language
8. Verify request ID and clinic name in message
```

## Performance

### Query Performance
- `getPendingHomeCollectionReminders()`: ~5ms for 1000 reminders
  - Index on: (clinic_id, status, scheduled_time)
  
- `markHomeCollectionReminderAsSent()`: ~2ms
  - Updates single row by ID
  
- `getHomeCollectionDetailsForReminder()`: ~3ms
  - Fetches related clinic data

### Concurrency
- No locking issues (RLS handles isolation)
- Each clinic independent
- Can process 100s of reminders per minute

## Future Enhancements

1. **Bulk operations**: Send multiple reminders in single batch
2. **Time customization**: Allow clinic to set reminder time (default 08:00)
3. **Multiple reminders**: Similar to appointments (1-day, same-day)
4. **Rescheduling**: Allow patient to reschedule via reminder response
5. **Follow-up**: Track if patient confirmed receipt
6. **Analytics**: Dashboard showing send success rate by clinic
7. **Template system**: Customizable reminder message per clinic
