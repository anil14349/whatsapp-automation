# Deployment & Operations Guide

This guide covers deployment, monitoring, and operational procedures for Supabase Edge Functions.

## Pre-Deployment Checklist

### Prerequisites
- [ ] Supabase CLI installed (`npm install -g supabase`)
- [ ] Supabase project created
- [ ] All environment variables configured
- [ ] Google service account credentials added
- [ ] Database migrations applied
- [ ] All tests passing locally
- [ ] Code reviewed and approved

### Environment Variables

Production environment must have:

```bash
SB_URL=https://[project].supabase.co
SB_ANON_KEY=[your-anon-key]
SB_SERVICE_ROLE_KEY=[your-service-role-key]
WHATSAPP_ACCESS_TOKEN=[your-access-token]
WHATSAPP_PHONE_NUMBER_ID=[your-phone-id]
WHATSAPP_VERIFY_TOKEN=[your-verify-token]
WHATSAPP_WEBHOOK_POST_TOKEN=[your-post-token]
GOOGLE_SHEETS_ID=[your-sheets-id]
GOOGLE_SHEETS_PRIVATE_KEY=[your-service-account-private-key]
GOOGLE_SHEETS_CLIENT_EMAIL=[service-account-email]
GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL=[service-account-email]
DEBUG_MODE=false
TIMEZONE=Asia/Kolkata
```

### Database Schema

Verify all tables exist:

```bash
supabase db list
```

Expected tables:
- `whatsapp_sessions`
- `whatsapp_log`
- `message_dedup`
- `session_cache`
- `audit_log`
- `analytics_events`
- `app_settings`

---

## Deployment Steps

### 1. Local Testing

```bash
# Start local Supabase environment
supabase start

# In another terminal, serve functions
supabase functions serve

# Test webhook (in third terminal)
curl "http://localhost:54321/functions/v1/webhook?hub.mode=subscribe&hub.verify_token=test&hub.challenge=TESTCHALLENGE"
# Expected: TESTCHALLENGE
```

### 2. Staging Deployment

```bash
# Link to staging project
supabase link --project-ref your-staging-id

# Deploy database migrations
supabase db push

# Deploy all functions
supabase functions deploy

# Verify deployment
supabase functions list
```

### 3. Staging Validation

```bash
# Get staging webhook URL
supabase functions list | grep webhook

# Test webhook verification
curl "https://[staging-project].supabase.co/functions/v1/webhook?hub.mode=subscribe&hub.verify_token=YOUR_VERIFY_TOKEN&hub.challenge=TESTCHALLENGE"

# Send test message
curl -X POST "https://[staging-project].supabase.co/functions/v1/webhook?token=YOUR_POST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "entry": [{
      "changes": [{
        "value": {
          "messages": [{
            "from": "919876543210",
            "id": "msg123",
            "type": "text",
            "text": {"body": "test"}
          }],
          "contacts": [{"profile": {"name": "Test User"}}],
          "metadata": {"phone_number_id": "123456789"}
        }
      }]
    }]
  }'

# Check logs
supabase functions logs webhook --limit 50
```

### 4. Production Deployment

```bash
# Switch to production project
supabase link --project-ref your-production-id

# Verify you're on correct project
supabase status

# Deploy (with confirmation)
supabase functions deploy

# Double-check deployment
supabase functions list
supabase functions logs webhook --limit 20
```

### 5. Update WhatsApp Webhook

In [Meta Developers Dashboard](https://developers.facebook.com/):

1. Go to WhatsApp API
2. Navigate to Configuration
3. Update Webhook URL:
   ```
   https://[project].supabase.co/functions/v1/webhook?token=[YOUR_WEBHOOK_POST_TOKEN]
   ```
4. Verify Token: `[YOUR_VERIFY_TOKEN]`
5. Click **Verify and Save**

---

## Monitoring & Alerts

### Setting Up Monitoring

#### 1. Supabase Dashboard

Monitor in real-time:
- Go to `Functions` → Select function → `Logs` tab
- See invocations, duration, errors
- Filter by function, time range, status

#### 2. Database Monitoring

```sql
-- Monitor message volume
SELECT 
  DATE(created_at) as date,
  COUNT(*) as message_count,
  COUNT(CASE WHEN status = 'ERROR' THEN 1 END) as error_count
FROM whatsapp_log
GROUP BY DATE(created_at)
ORDER BY date DESC
LIMIT 30;

-- Check session health
SELECT 
  role,
  COUNT(*) as active_sessions,
  COUNT(CASE WHEN updated_at < NOW() - INTERVAL '1 hour' THEN 1 END) as stale
FROM whatsapp_sessions
WHERE expires_at > NOW()
GROUP BY role;

-- Monitor error trends
SELECT 
  DATE(created_at) as date,
  error_type,
  COUNT(*) as count
FROM whatsapp_log
WHERE status = 'ERROR'
GROUP BY DATE(created_at), error_type
ORDER BY date DESC, count DESC;
```

#### 3. Set Up Alerts (Optional: Using Datadog, PagerDuty, etc.)

```sql
-- Alert if error rate > 5%
SELECT 
  COUNT(*) as total,
  COUNT(CASE WHEN status = 'ERROR' THEN 1 END) as errors,
  ROUND(100.0 * COUNT(CASE WHEN status = 'ERROR' THEN 1 END) / COUNT(*), 2) as error_rate
FROM whatsapp_log
WHERE created_at > NOW() - INTERVAL '5 minutes'
HAVING COUNT(*) > 0;

-- Alert if no messages in last 15 minutes
SELECT COUNT(*) as recent_messages
FROM whatsapp_log
WHERE created_at > NOW() - INTERVAL '15 minutes';

-- Alert if function latency > 5 seconds
-- (Check in Supabase Functions logs)
```

### Key Metrics to Monitor

| Metric | Threshold | Alert |
|--------|-----------|-------|
| Error Rate | > 5% | High |
| Function Latency (P95) | > 5s | Medium |
| Database Connections | > 90% | High |
| Webhook Response Time | > 3s | Medium |
| Message Volume Drop | > 50% decrease | Low |

---

## Troubleshooting

### Webhook Not Receiving Messages

**Symptom:** Messages not appearing in logs

**Diagnosis:**
```bash
# Check function logs
supabase functions logs webhook --limit 100

# Check if URL is correct in Meta dashboard
# Verify token in URL matches WHATSAPP_WEBHOOK_POST_TOKEN

# Check Supabase project is running
supabase status
```

**Solutions:**
1. Verify webhook URL in Meta dashboard
2. Verify token matches environment variable
3. Check function deployment status: `supabase functions list`
4. Restart functions: `supabase functions deploy webhook`

### High Latency

**Symptom:** Messages taking > 5 seconds to process

**Diagnosis:**
```bash
# Check Google Sheets API latency
# Check database query performance

SELECT 
  query,
  AVG(query_time) as avg_ms,
  MAX(query_time) as max_ms
FROM pg_stat_statements
WHERE query LIKE '%whatsapp%'
ORDER BY avg_ms DESC;
```

**Solutions:**
1. Add database indexes
2. Enable caching for Google Sheets reads
3. Use connection pooling
4. Consider async operations

### Database Connection Errors

**Symptom:** "Connection refused" or "FATAL: sorry, too many clients"

**Diagnosis:**
```bash
# Check active connections
SELECT count(*) FROM pg_stat_activity;

# Check connection limits
SHOW max_connections;
```

**Solutions:**
1. Increase `max_connections` in Supabase settings
2. Use connection pooling (PgBouncer)
3. Close idle connections
4. Optimize query performance

### Google Sheets API Errors

**Symptom:** "403 Forbidden" or "Rate limit exceeded"

**Diagnosis:**
```bash
# Check function logs for Google API errors
supabase functions logs webhook | grep -i "google"

# Verify service account has Sheet access
# Check Sheet permissions in Google Drive
```

**Solutions:**
1. Verify service account email has access to Sheet
2. Implement exponential backoff for retries
3. Add caching to reduce API calls
4. Split large operations into batches

---

## Backup & Recovery

### Database Backup

Supabase provides automated daily backups. To create manual backup:

```bash
# Via CLI (if available)
supabase db pull > backup.sql

# Via Supabase dashboard
# Navigate to Settings → Backups → Request a backup
```

### Restore from Backup

```bash
# Restore database
psql postgresql://postgres:password@db.supabase.co/postgres < backup.sql

# Or use Supabase dashboard to restore to point-in-time
```

### Data Export

```sql
-- Export all sessions
COPY (
  SELECT * FROM whatsapp_sessions
  WHERE created_at > NOW() - INTERVAL '30 days'
) TO '/tmp/sessions.csv' WITH CSV HEADER;

-- Export all messages
COPY (
  SELECT * FROM whatsapp_log
  WHERE created_at > NOW() - INTERVAL '30 days'
) TO '/tmp/messages.csv' WITH CSV HEADER;
```

---

## Performance Tuning

### Database Optimization

```sql
-- Add missing indexes
CREATE INDEX IF NOT EXISTS idx_sessions_phone_expires 
  ON whatsapp_sessions(phone, expires_at);

CREATE INDEX IF NOT EXISTS idx_log_created_phone 
  ON whatsapp_log(created_at, phone);

CREATE INDEX IF NOT EXISTS idx_dedup_message_expires 
  ON message_dedup(message_id, expires_at);

-- Analyze query plans
EXPLAIN ANALYZE 
  SELECT * FROM whatsapp_sessions 
  WHERE phone = '919876543210';
```

### Function Optimization

```typescript
// Use connection pooling
const pool = new pg.Pool({
  connectionString: Deno.env.get("DATABASE_URL"),
  max: 10,  // Max connections per function
  idleTimeoutMillis: 30000
});

// Implement caching
const cache = new Map<string, CacheEntry>();

function getCachedValue(key: string): any | null {
  const entry = cache.get(key);
  if (entry && Date.now() < entry.expiresAt) {
    return entry.value;
  }
  return null;
}

// Use async/await properly
async function batchOperation() {
  const promises = items.map(item => processItem(item));
  const results = await Promise.all(promises);
  return results;
}
```

---

## Scaling Considerations

### When to Scale

As usage grows:

| Metric | Action |
|--------|--------|
| > 1000 msg/hour | Consider read replicas for reports |
| > 100 concurrent sessions | Increase database connection limits |
| > 10,000 total messages | Archive old logs to external storage |
| > 5sec avg latency | Implement caching layer |

### Supabase Pro Plan

If you need higher capacity:
- Increased database connections (500 vs 200)
- Increased storage (up to 8TB vs 500GB)
- Higher function execution limits
- Priority support

See [Supabase Pricing](https://supabase.com/pricing) for details.

---

## Disaster Recovery

### RTO & RPO Targets

| Scenario | RTO | RPO | Plan |
|----------|-----|-----|------|
| Database down | 30 min | 1 min | Restore from automated backup |
| Function deleted | 5 min | 0 min | Redeploy from Git |
| API key leaked | 10 min | 0 min | Rotate keys in Supabase |
| Data corruption | 1 hour | 1 min | Restore to point-in-time |
| Full outage | 2 hours | 5 min | Failover to backup region |

### Incident Response

1. **Detect:** Monitor alerts / manual report
2. **Assess:** Check logs, identify root cause
3. **Communicate:** Notify stakeholders
4. **Mitigate:** Implement quick fix or rollback
5. **Resolve:** Deploy permanent fix
6. **Postmortem:** Document and improve

### Rollback Procedure

If critical issue after deployment:

```bash
# Option 1: Redeploy previous version from Git
git checkout HEAD~1  # Go back one commit
supabase functions deploy

# Option 2: Rollback database migration
supabase db reset  # CAUTION: Drops all data

# Option 3: Switch to Apps Script (if still available)
# Update WhatsApp webhook URL back to:
# https://script.google.com/macros/d/xxx/usercontent
```

---

## Cost Optimization

### Reduce Function Costs

1. **Batch operations** - Process multiple items per invocation
2. **Cache aggressively** - Reduce API calls to Google Sheets
3. **Archive logs** - Move old logs to cheaper storage (Cloud Storage)
4. **Async processing** - Send message, then update Sheets asynchronously

### Monitoring Costs

```bash
# Check function execution count
supabase functions list

# Estimate monthly cost
# Supabase: $25/month per function (on Pro plan)
# Google Sheets API: Free (1M reads/day)
# Google Calendar API: Free
# WhatsApp: $0.04-$0.06 per message

# Example: 1000 messages/day
# Supabase: $25
# WhatsApp: $30-45
# Google: Free
# Total: $55-70/month
```

---

## Maintenance Tasks

### Daily Tasks

- [ ] Check error logs
- [ ] Verify webhook is receiving messages
- [ ] Monitor error rate < 1%

### Weekly Tasks

- [ ] Review database metrics
- [ ] Check function performance
- [ ] Review cost trends

### Monthly Tasks

- [ ] Archive old logs (> 90 days)
- [ ] Review and update retention policies
- [ ] Performance analysis and tuning
- [ ] Security audit

### Quarterly Tasks

- [ ] Disaster recovery drill
- [ ] Capacity planning
- [ ] Cost optimization review
- [ ] Security assessment

---

## References

- [Supabase Functions Documentation](https://supabase.com/docs/guides/functions)
- [Supabase Edge Functions Deployment](https://supabase.com/docs/guides/functions/deploy)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [WhatsApp Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started)
- [Google Sheets API](https://developers.google.com/sheets/api/guides)

---

## Support

For issues or questions:

1. Check Supabase logs: `supabase functions logs [function-name]`
2. Review database queries in Supabase dashboard
3. Check WhatsApp webhook payload in Meta dashboard
4. Consult [Supabase Support](https://supabase.com/support)
