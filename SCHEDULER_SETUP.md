# Appointment Reminder Scheduler Setup

## Overview

The reminder scheduler is a Cloud Function that runs every minute to send pending appointment reminders via WhatsApp. It:

1. Queries pending reminders from the `appointment_reminders` table
2. Fetches appointment details for each reminder
3. Formats messages in the patient's preferred language (EN or हिंदी)
4. Sends via WhatsApp API
5. Updates reminder status (SENT/FAILED)
6. Automatically retries failed sends (max 3 attempts)

## Architecture

```
Cloud Scheduler (every minute)
        ↓
scheduled-reminders function
        ↓
appointment-reminder-scheduler.ts
        ↓
[getPendingReminders] → [formatReminderMessage] → [sendTextMessage] → [markReminderAsSent/Failed]
        ↓
appointment_reminders table updated with status
```

## Deployment Steps

### 1. Deploy Cloud Function

```bash
# From project root
cd supabase/functions
supabase functions deploy scheduled-reminders
```

This deploys the function to:
```
https://<project-id>.supabase.co/functions/v1/scheduled-reminders
```

### 2. Set Environment Variables

Add to your Supabase project settings (or `.env.local`):

```env
# Supabase (should already be set)
SUPABASE_URL=https://<project-id>.supabase.co
SUPABASE_SERVICE_KEY=<service-key-with-admin-privileges>

# WhatsApp Cloud API
WHATSAPP_BUSINESS_ACCOUNT_ID=<your-business-account-id>
WHATSAPP_API_ACCESS_TOKEN=<your-access-token>

# Clinic Configuration
CLINIC_IDS=<clinic-uuid-1>,<clinic-uuid-2>,<clinic-uuid-3>

# Security
SCHEDULER_AUTH_TOKEN=<random-token-for-cloud-scheduler-auth>
```

**Getting these values**:
- `WHATSAPP_BUSINESS_ACCOUNT_ID`: From WhatsApp Business App settings
- `WHATSAPP_API_ACCESS_TOKEN`: From Meta for Developers dashboard
- `CLINIC_IDS`: UUIDs from clinics table (comma-separated)
- `SCHEDULER_AUTH_TOKEN`: Generate with: `openssl rand -base64 32`

### 3. Set Up Cloud Scheduler

**In Google Cloud Console**:

1. Go to Cloud Scheduler
2. Create Job:
   - **Name**: `appointment-reminder-scheduler`
   - **Frequency**: `* * * * *` (every minute)
   - **Timezone**: UTC
   - **Execution timeout**: 5 minutes
3. Execution settings:
   - **HTTP**: POST
   - **URL**: `https://<project-id>.supabase.co/functions/v1/scheduled-reminders`
   - **Auth header**: Add `Authorization: Bearer <SCHEDULER_AUTH_TOKEN>`
   - **User-Agent**: `Cloud-Scheduler`

### 4. Test the Function

**Manual Test**:
```bash
curl -X POST https://<project-id>.supabase.co/functions/v1/scheduled-reminders \
  -H "Authorization: Bearer <SCHEDULER_AUTH_TOKEN>" \
  -H "Content-Type: application/json"
```

**Expected Response**:
```json
{
  "success": true,
  "clinics_processed": 3,
  "reminders_sent": 5,
  "reminders_failed": 0
}
```

**Check Logs**:
```bash
supabase functions logs scheduled-reminders
```

## Configuration

### Clinic IDs

The scheduler processes reminders for clinics listed in `CLINIC_IDS`. To add/remove clinics:

```bash
# Current setup
CLINIC_IDS=clinic-1-uuid,clinic-2-uuid

# Add new clinic
CLINIC_IDS=clinic-1-uuid,clinic-2-uuid,clinic-3-uuid
```

Then update in Supabase project settings.

### Concurrency

Default: Max 5 reminders sent concurrently per clinic. To change:

Edit `appointment-reminder-scheduler.ts` line ~174:
```typescript
const result = await runReminderScheduler(supabase, whatsappClient, {
    clinicIds,
    maxConcurrent: 10  // ← Change here
});
```

### Retry Logic

Built-in to `markReminderAsFailed()`:
- Max 3 attempts per reminder
- Automatic retry on next scheduler run if attempts < 3
- Marked FAILED after 3 failed attempts

## Monitoring

### Check Reminder Status

```sql
-- Pending reminders
SELECT * FROM appointment_reminders 
WHERE status = 'PENDING' 
AND scheduled_time <= NOW()
ORDER BY scheduled_time ASC;

-- Failed reminders ready to retry
SELECT * FROM appointment_reminders 
WHERE status = 'PENDING' 
AND attempts < max_attempts
ORDER BY updated_at ASC;

-- Sent reminders today
SELECT COUNT(*), reminder_type 
FROM appointment_reminders 
WHERE status = 'SENT' 
AND created_at::date = TODAY()
GROUP BY reminder_type;

-- Failure rate
SELECT 
  status,
  COUNT(*) as count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) as percentage
FROM appointment_reminders 
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY status;
```

### Cloud Logging

**View function logs**:
```bash
supabase functions logs scheduled-reminders --tail
```

**Key log lines**:
```
reminderScheduler: Starting scheduler run
reminderScheduler: Processing pending reminders
reminderScheduler: Reminder sent successfully
reminderScheduler: Failed to send reminder
reminderScheduler: Scheduler run complete
```

### Set Up Alerts

**In Cloud Monitoring**:

1. Create alert for function error rate > 5%:
   ```
   resource.type="cloud_function"
   resource.labels.function_name="scheduled-reminders"
   metric.type="cloudfunctions.googleapis.com/execution_count"
   AND severity="ERROR"
   ```

2. Create alert for function latency > 30s:
   ```
   resource.type="cloud_function"
   resource.labels.function_name="scheduled-reminders"
   metric.type="cloudfunctions.googleapis.com/execution_times"
   > 30000  // milliseconds
   ```

## Troubleshooting

### Function doesn't trigger

**Check**:
- Cloud Scheduler job is enabled and has correct URL
- Authorization token matches SCHEDULER_AUTH_TOKEN
- Firewall allows Cloud Scheduler IPs (0.0.0.0/0 or specific ranges)

### Reminders not sending

**Check**:
1. Pending reminders exist in database:
   ```sql
   SELECT COUNT(*) FROM appointment_reminders 
   WHERE status = 'PENDING';
   ```

2. WhatsApp API credentials are correct:
   ```bash
   # Test directly
   curl -X POST https://graph.instagram.com/v18.0/[BUSINESS_ACCOUNT_ID]/messages \
     -H "Authorization: Bearer $WHATSAPP_API_ACCESS_TOKEN" \
     -d '{"messaging_product":"whatsapp",...}'
   ```

3. Check function logs for errors:
   ```bash
   supabase functions logs scheduled-reminders --limit 100
   ```

4. Verify clinic IDs are correct:
   ```sql
   SELECT id FROM clinics LIMIT 10;
   ```

### High error rate

**Check**:
- WhatsApp API rate limiting (quota exhausted)
- Network connectivity issues
- Invalid phone numbers in patient records
- Database connection pool exhausted

**Solution**:
- Reduce maxConcurrent from 5 to 2-3
- Implement exponential backoff in WhatsApp client
- Scale Supabase connection pool

## Performance

### Expected Throughput

- Single clinic: ~10-20 reminders/minute
- 3 clinics: ~30-60 reminders/minute
- Max concurrency (5): ~100+ reminders/minute

### Optimization

**If processing slow**:
1. Increase maxConcurrent to 10-20
2. Add database indexes (already done in migration)
3. Use read replicas for getPendingReminders()

**If costs high**:
1. Reduce frequency from 1-minute to 5-minute interval
2. Process reminders in batches at specific times (e.g., 8 AM, 2 PM)
3. Implement smart retry backoff (exponential delay)

## Maintenance

### Weekly

1. Monitor error rate from logs
2. Check failed reminder count:
   ```sql
   SELECT COUNT(*) FROM appointment_reminders 
   WHERE status = 'FAILED' 
   AND created_at > NOW() - INTERVAL '7 days';
   ```

### Monthly

1. Review cost in Google Cloud Console
2. Analyze reminder delivery patterns
3. Adjust CLINIC_IDS if clinics added/removed
4. Clean up old reminders (optional):
   ```sql
   DELETE FROM appointment_reminders 
   WHERE created_at < NOW() - INTERVAL '90 days' 
   AND status IN ('SENT', 'FAILED', 'SKIPPED');
   ```

## Disaster Recovery

### Function fails

1. Cloud Scheduler will retry based on retry policy
2. Pending reminders remain in database
3. Reminders will send on next successful run
4. No duplicate sends (UNIQUE constraint prevents it)

### Database connection fails

1. Function returns 500 error
2. Cloud Scheduler retries after delay
3. Alert fires after N retries
4. On-call engineer can manually trigger or investigate

## Testing Checklist

- [ ] Cloud Function deployed successfully
- [ ] Manual test (curl) returns 200
- [ ] Cloud Scheduler job enabled and has correct URL
- [ ] Environment variables set in Supabase
- [ ] Test appointment created with future date
- [ ] Scheduler runs and creates reminders (check logs)
- [ ] Wait for scheduled_time, verify reminder sent
- [ ] Check WhatsApp message received by test patient
- [ ] Verify reminder marked SENT with message_id
- [ ] Cancel appointment, verify reminder marked SKIPPED
- [ ] Monitor error logs for 24 hours (zero errors expected)

## Support

For issues:
1. Check function logs: `supabase functions logs scheduled-reminders`
2. Verify database state: Query appointment_reminders table
3. Test WhatsApp API directly
4. Check Supabase service status
5. Review Cloud Scheduler job configuration
