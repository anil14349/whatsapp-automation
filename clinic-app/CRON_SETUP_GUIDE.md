# Cron Job Setup Guide

Complete guide to setting up and running scheduled cron jobs.

## Overview

The cron system consists of:

1. **Database Configuration** - Jobs defined in `trigger_cron_jobs` table
2. **Execution Endpoint** - `/api/cron/execute` orchestrates all jobs
3. **Job Endpoints** - Specific endpoints for each job type
4. **External Trigger** - Vercel Cron, AWS EventBridge, or external scheduler calls the execution endpoint
5. **Monitoring** - Track job runs and errors in database

---

## Step 1: Environment Variables

Add to `.env.local`:

```bash
# Cron job security token
CRON_SECRET_TOKEN=your-super-secret-token-here-change-this

# Application URL (for job endpoints)
NEXT_PUBLIC_APP_URL=https://your-app.com

# Optional: Override clinic ID for global cron jobs
CRON_DEFAULT_CLINIC_ID=clinic-uuid-here
```

## Step 2: Database Configuration

Add cron jobs via admin dashboard or directly in database:

```sql
INSERT INTO trigger_cron_jobs (
  clinic_id,
  job_name,
  schedule_expression,
  endpoint,
  enabled,
  timeout_seconds,
  retry_count,
  retry_delay_seconds
) VALUES
  (
    'clinic-123',
    'appointment_reminders',
    '*/30 * * * *',  -- Every 30 minutes
    '/api/cron/appointment-reminders',
    true,
    300,
    3,
    60
  ),
  (
    'clinic-123',
    'auto_complete',
    '0 * * * *',     -- Every hour
    '/api/cron/auto-complete',
    true,
    300,
    3,
    60
  ),
  (
    'clinic-123',
    'log_cleanup',
    '0 1 * * *',     -- Daily at 1 AM
    '/api/cron/log-cleanup',
    true,
    600,
    1,
    60
  );
```

### Cron Expression Reference

```
*    *    *    *    *
┬    ┬    ┬    ┬    ┬
│    │    │    │    └─ Day of week (0-6, Sunday=0)
│    │    │    └────── Month (1-12)
│    │    └─────────── Day of month (1-31)
│    └──────────────── Hour (0-23)
└───────────────────── Minute (0-59)
```

**Common Patterns:**

| Pattern | Meaning |
|---------|---------|
| `*/30 * * * *` | Every 30 minutes |
| `0 * * * *` | Every hour at :00 |
| `0 9 * * *` | Daily at 9 AM |
| `0 9 * * 1-5` | Weekdays at 9 AM |
| `0 1 * * *` | Daily at 1 AM |
| `0 0 1 * *` | First of month at midnight |

---

## Step 3: Available Endpoints

### Main Orchestrator

**POST /api/cron/execute**

Executes all jobs due to run. Call this periodically (every 5-30 minutes).

```bash
curl -X POST https://your-app.com/api/cron/execute \
  -H "X-Cron-Token: your-super-secret-token-here-change-this" \
  -H "Content-Type: application/json" \
  -d '{"clinic_id": "clinic-123"}'
```

Response:
```json
{
  "success": true,
  "jobs_executed": 2,
  "jobs_failed": 0,
  "total_results": 2,
  "results": [
    {
      "clinic_id": "clinic-123",
      "job_name": "appointment_reminders",
      "status": "completed",
      "duration_ms": 2500,
      "error": null
    }
  ]
}
```

### Appointment Reminders

**POST /api/cron/appointment-reminders**

Sends appointment reminders to patients.

```bash
curl -X POST https://your-app.com/api/cron/appointment-reminders \
  -H "X-Clinic-ID: clinic-123" \
  -H "Content-Type: application/json"
```

Response:
```json
{
  "success": true,
  "reminders_sent": 15,
  "reminders_failed": 1,
  "errors": ["appt-123: Failed to send"],
  "timestamp": "2026-09-10T14:30:00Z"
}
```

---

## Step 4: External Scheduler Setup

### Option A: Vercel Cron (Recommended for Next.js)

Add to `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/execute",
      "schedule": "*/15 * * * *"
    }
  ]
}
```

This calls `/api/cron/execute` every 15 minutes.

**Note:** Requires Vercel Pro or Enterprise.

### Option B: AWS EventBridge

1. Create CloudWatch rule:
   ```
   Name: appointment-reminders
   Schedule: rate(30 minutes)
   ```

2. Add target:
   ```
   Type: HTTPS endpoint
   URL: https://your-app.com/api/cron/execute
   HTTP method: POST
   Auth: API key (header: X-Cron-Token)
   Body:
   {
     "clinic_id": "clinic-123"
   }
   ```

### Option C: External CRON Service

Services like EasyCron, cron-job.org, or custom Lambda:

```bash
# EasyCron
curl -X POST https://www.easycron.com/set?
  token=YOUR_EASYCRON_TOKEN&
  url=https://your-app.com/api/cron/execute&
  method=POST&
  cron=*/15\ *\ *\ *\ *
```

### Option D: GitHub Actions (Free)

Create `.github/workflows/cron.yml`:

```yaml
name: Appointment Reminders

on:
  schedule:
    - cron: '*/30 * * * *'  # Every 30 minutes

jobs:
  cron:
    runs-on: ubuntu-latest
    steps:
      - name: Execute cron jobs
        run: |
          curl -X POST ${{ secrets.APP_URL }}/api/cron/execute \
            -H "X-Cron-Token: ${{ secrets.CRON_SECRET_TOKEN }}" \
            -H "Content-Type: application/json" \
            -d '{"clinic_id": "${{ secrets.CLINIC_ID }}"}'
```

Add secrets to GitHub repository settings.

---

## Step 5: Testing

### Health Check

```bash
curl https://your-app.com/api/cron/execute?token=your-token
```

Should return:
```json
{
  "message": "Cron endpoint is ready",
  "timestamp": "2026-09-10T14:30:00Z",
  "docs": "POST /api/cron/execute with X-Cron-Token header"
}
```

### Manual Test

```bash
curl -X POST https://your-app.com/api/cron/execute \
  -H "X-Cron-Token: your-super-secret-token-here-change-this" \
  -H "Content-Type: application/json" \
  -d '{"clinic_id": "clinic-123", "job_name": "appointment_reminders"}'
```

### Database Check

```sql
-- See all cron jobs
SELECT * FROM trigger_cron_jobs WHERE clinic_id = 'clinic-123';

-- See job run history
SELECT * FROM trigger_cron_jobs
  WHERE job_name = 'appointment_reminders'
  ORDER BY last_run_at DESC
  LIMIT 10;

-- Check for errors
SELECT last_error, last_run_at FROM trigger_cron_jobs
  WHERE last_error IS NOT NULL;
```

---

## Step 6: Monitoring

### View Job History

```sql
-- Jobs that ran today
SELECT 
  job_name,
  last_run_at,
  next_run_at,
  last_error,
  EXTRACT(EPOCH FROM (last_run_at - last_run_at::timestamp)) as seconds_ago
FROM trigger_cron_jobs
WHERE clinic_id = 'clinic-123'
  AND last_run_at > NOW() - INTERVAL '1 day'
ORDER BY last_run_at DESC;
```

### View Analytics

```sql
-- Reminders sent today
SELECT 
  COUNT(*) as reminders_sent,
  COUNT(CASE WHEN action = 'failed' THEN 1 END) as reminders_failed
FROM template_analytics
WHERE clinic_id = 'clinic-123'
  AND template_key = 'APPOINTMENT_REMINDER'
  AND timestamp > NOW() - INTERVAL '1 day';

-- Error messages
SELECT error_message, COUNT(*) as count
FROM template_analytics
WHERE clinic_id = 'clinic-123'
  AND action = 'failed'
  AND timestamp > NOW() - INTERVAL '7 days'
GROUP BY error_message
ORDER BY count DESC;
```

---

## Built-in Job Types

### 1. appointment_reminders

Sends appointment reminders to patients.

**Config:**
```
job_name: appointment_reminders
endpoint: /api/cron/appointment-reminders
schedule: */30 * * * * (every 30 min)
```

**What it does:**
1. Gets appointments in next N hours (from clinic setting)
2. Loads reminder template from database
3. Interpolates {{patient_name}}, {{doctor_name}}, {{appointment_time}}
4. Sends via WhatsApp
5. Marks appointment as reminded
6. Tracks analytics

**Required clinic setting:**
- `appointment_reminder_hours` (default: 24)

### 2. auto_complete (Placeholder)

Auto-complete past appointments.

**Config:**
```
job_name: auto_complete
endpoint: /api/cron/auto-complete
schedule: 0 * * * * (every hour)
```

### 3. log_cleanup (Placeholder)

Clean up old logs.

**Config:**
```
job_name: log_cleanup
endpoint: /api/cron/log-cleanup
schedule: 0 1 * * * (daily at 1 AM)
```

---

## Creating New Jobs

To add a new cron job:

### 1. Create Endpoint

Create `app/api/cron/your-job-name/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const maxDuration = 60;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const supabase = getSupabaseServerClient();
  const clinicId = request.headers.get("X-Clinic-ID");

  try {
    // Your job logic here
    const result = await doYourWork(supabase, clinicId);

    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error("Job error:", error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
```

### 2. Add to Database

```sql
INSERT INTO trigger_cron_jobs (
  clinic_id,
  job_name,
  schedule_expression,
  endpoint,
  enabled,
  timeout_seconds,
  retry_count,
  retry_delay_seconds
) VALUES (
  'clinic-123',
  'your_job_name',
  '0 * * * *',
  '/api/cron/your-job-name',
  true,
  300,
  3,
  60
);
```

### 3. Test

```bash
curl -X POST https://your-app.com/api/cron/your-job-name \
  -H "X-Clinic-ID: clinic-123"
```

---

## Troubleshooting

### Jobs not running

**Check 1:** Is job enabled?
```sql
SELECT enabled FROM trigger_cron_jobs WHERE job_name = 'appointment_reminders';
```

**Check 2:** Is cron expression correct?
```typescript
import { isValidCronExpression } from "@/lib/triggers/cronJobs";
console.log(isValidCronExpression("*/30 * * * *")); // Should be true
```

**Check 3:** Is external scheduler calling the endpoint?
- Check your scheduler's logs (Vercel, AWS, GitHub Actions, etc.)
- Look for HTTP 200/400/500 responses

**Check 4:** Are endpoints accessible?
```bash
curl https://your-app.com/api/cron/execute?token=your-token
# Should return 200 OK with message
```

### Jobs timing out

- Increase `timeout_seconds` in database
- Check if jobs are doing too much work
- Split into multiple smaller jobs

### Jobs failing

- Check `last_error` in database
- Look at analytics for specific errors
- Check logs in Vercel/AWS/hosting provider
- Verify X-Clinic-ID header is set

### Too many reminders

- Verify `reminder_sent_at` is being updated
- Check frequency of external scheduler
- Adjust `appointment_reminder_hours` setting

---

## Production Checklist

- [ ] Set strong `CRON_SECRET_TOKEN` (32+ chars)
- [ ] Add cron jobs to database
- [ ] Set up external scheduler (Vercel/AWS/GitHub)
- [ ] Test health endpoint
- [ ] Test manual job execution
- [ ] Monitor analytics for first week
- [ ] Set up alerts for failed jobs
- [ ] Document job schedules in team wiki
- [ ] Create runbook for troubleshooting
- [ ] Schedule regular review of job performance

---

## Performance Tips

1. **Batch operations** - Process multiple appointments in one request
2. **Use database** - Load clinic settings once, not per appointment
3. **Cache templates** - Cache layer already handles this (1-hour TTL)
4. **Retry logic** - Configured to retry 3 times with 60s delay
5. **Timeout** - Set to 300s (5 min), jobs should complete in <60s
6. **Frequency** - Run appointment reminders every 30 min (not every minute)

---

## Support

For issues, check:
1. `TRIGGER_FEATURES_COMPLETE.md` - Cron job section
2. Database logs: `SELECT * FROM trigger_cron_jobs WHERE clinic_id = ?`
3. Analytics: `SELECT * FROM template_analytics WHERE action = 'failed'`
4. Cloud provider logs: Vercel Dashboard / AWS CloudWatch / GitHub Actions
