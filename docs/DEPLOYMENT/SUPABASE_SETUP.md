# Supabase Setup Guide

## 1. Create Supabase Project

1. Go to [supabase.com](https://supabase.com)
2. Click **"New Project"**
3. Enter:
   - **Project name:** `abc-clinic-whatsapp`
   - **Database password:** Generate strong password (save it!)
   - **Region:** Choose closest to your clinic's location
4. Wait for project initialization (~2 minutes)

## 2. Get Credentials

After project creation:

1. Go to **Settings → API**
2. Copy and save:
   - `SUPABASE_URL` (Project URL)
   - `SUPABASE_ANON_KEY` (anon key)
   - `SUPABASE_SERVICE_ROLE_KEY` (service role key - keep secret!)

## 3. Create Database Tables

### Option A: Using Supabase Dashboard

1. Go to **SQL Editor** in Supabase
2. Click **New Query**
3. Copy the SQL from [`migrations/001_create_tables.sql`](migrations/001_create_tables.sql)
4. Run the query

### Option B: Using Supabase CLI

```bash
# Install CLI
npm install -g supabase

# Link to project
supabase login
supabase link --project-ref your-project-ref

# Run migrations
supabase db push
```

## 4. Set Up Google Service Account

This allows Supabase Edge Functions to read/write Google Sheets and access Google Calendar.

### Step 1: Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Click **Create Project**
3. Name it `abc-clinic-whatsapp`
4. Wait for creation

### Step 2: Enable APIs

1. Search for **"Google Sheets API"** → Click → **Enable**
2. Search for **"Google Calendar API"** → Click → **Enable**

### Step 3: Create Service Account

1. Go to **Credentials** (left sidebar)
2. Click **Create Credentials → Service Account**
3. Fill in:
   - **Service account name:** `abc-clinic-automation`
   - **Description:** `WhatsApp automation for ABC Clinic`
4. Click **Create and Continue**
5. Skip optional steps, click **Done**

### Step 4: Generate Private Key

1. Go to **Service Accounts** (under Credentials)
2. Click on the service account you just created
3. Go to **Keys** tab
4. Click **Add Key → Create new key**
5. Choose **JSON**
6. Save the file (keep it safe!)
7. Extract:
   - `private_key`
   - `client_email`
   - `project_id`

### Step 5: Share Google Sheet with Service Account

1. Open your clinic's Google Sheet
2. Click **Share**
3. Paste the service account's `client_email`
4. Give **Editor** access
5. Click **Share**

## 5. Configure Supabase Project Settings

### Add Secrets

1. Go to **Settings → Secrets** in Supabase
2. Add each secret:

| Key | Value | Source |
|-----|-------|--------|
| `WHATSAPP_ACCESS_TOKEN` | Your WhatsApp token | Meta Graph API |
| `WHATSAPP_PHONE_NUMBER_ID` | Your phone ID | Meta WhatsApp Business |
| `WHATSAPP_VERIFY_TOKEN` | Generate a random string | Your choice (secure) |
| `WHATSAPP_WEBHOOK_POST_TOKEN` | Generate a random string | Your choice (secure) |
| `GOOGLE_SHEETS_ID` | Your sheet's ID | Google Sheets URL: `/d/{ID}/` |
| `GOOGLE_SHEETS_PRIVATE_KEY` | From service account JSON | Service account file |
| `GOOGLE_SHEETS_CLIENT_EMAIL` | From service account JSON | Service account file |
| `GOOGLE_CALENDAR_ID` | Your clinic's calendar ID | Google Calendar settings |
| `TIMEZONE` | `Asia/Kolkata` | Your clinic's timezone |

## 6. Create Scheduled Jobs (Optional)

### Log Cleanup (Daily)

1. Go to **Database → Webhooks**
2. Click **Create Webhook**
3. Configure:
   - **Webhook name:** `daily-log-cleanup`
   - **Table:** `whatsapp_log`
   - **Event:** `INSERT`
   - **HTTP endpoint:** `https://your-project.supabase.co/functions/v1/cleanup-logs`

### Appointment Reminders (Every 30 minutes)

1. Go to **Webhooks** again
2. Create webhook:
   - **Webhook name:** `send-reminders`
   - **Table:** Select any table (webhook won't fire, but job will run)
   - Configure cron: `0 */30 * * * *`
   - **HTTP endpoint:** `https://your-project.supabase.co/functions/v1/send-reminders`

## 7. Deploy Edge Functions

### Using Supabase CLI

```bash
# Navigate to project root
cd path/to/whatsapp-automation

# Link to Supabase project
supabase link --project-ref your-project-ref

# Deploy functions
supabase functions deploy webhook
supabase functions deploy appointments
supabase functions deploy doctors
supabase functions deploy slots

# Verify deployment
supabase functions list
```

### Using GitHub Actions (Recommended)

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Supabase

on:
  push:
    branches: [main]
    paths:
      - 'supabase/functions/**'
      - 'supabase/migrations/**'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: supabase/setup-cli@v1
      - run: supabase link --project-ref ${{ secrets.SUPABASE_PROJECT_REF }}
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
      - run: supabase db push
      - run: supabase functions deploy
```

## 8. Update WhatsApp Webhook URL

1. Go to [Meta Developers Dashboard](https://developers.facebook.com)
2. Go to **Your App → WhatsApp → Configuration**
3. Update **Webhook URL:**
   - **Old:** `https://script.google.com/macros/d/xxx/usercontent`
   - **New:** `https://your-project.supabase.co/functions/v1/webhook?token=YOUR_WEBHOOK_POST_TOKEN`
4. Keep **Verify Token** the same
5. Click **Save**

## 9. Test Connection

```bash
# Test webhook verification
curl "https://your-project.supabase.co/functions/v1/webhook?hub.mode=subscribe&hub.verify_token=YOUR_VERIFY_TOKEN&hub.challenge=TEST123"

# Expected response: TEST123

# Test with sample message
curl -X POST "https://your-project.supabase.co/functions/v1/webhook?token=YOUR_WEBHOOK_POST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "entry": [{
      "changes": [{
        "value": {
          "messages": [{
            "from": "919876543210",
            "id": "wamid.xxx",
            "type": "text",
            "text": {"body": "Hi"}
          }],
          "contacts": [{
            "profile": {"name": "Test User"}
          }],
          "metadata": {
            "phone_number_id": "123456789"
          }
        }
      }]
    }]
  }'
```

## 10. Monitor & Debug

### View Logs

```bash
# Using CLI
supabase functions list
supabase functions logs webhook --limit 100

# Or in Supabase Dashboard
# Go to Functions → Select function → View Logs
```

### Check Database

```sql
-- View recent sessions
SELECT * FROM whatsapp_sessions ORDER BY updated_at DESC LIMIT 10;

-- View recent logs
SELECT * FROM whatsapp_log ORDER BY created_at DESC LIMIT 50;

-- Check idempotency table
SELECT * FROM message_dedup WHERE expires_at > NOW() ORDER BY created_at DESC;
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| **404 on webhook** | Verify function is deployed: `supabase functions list` |
| **401 Unauthorized** | Check `WHATSAPP_WEBHOOK_POST_TOKEN` matches in URL |
| **Google Sheets errors** | Verify service account has Editor access to sheet |
| **Session not persisting** | Check `whatsapp_sessions` table exists: `supabase migration list` |
| **High latency** | Check Edge Function cold start time; consider warming |

---

## Next Steps

1. ✅ Create Supabase project
2. ✅ Set up database tables
3. ✅ Create Google service account
4. ✅ Configure secrets
5. → [Deploy Edge Functions](../supabase/functions/README.md)
6. → [Migrate business logic](../SUPABASE_MIGRATION.md)
