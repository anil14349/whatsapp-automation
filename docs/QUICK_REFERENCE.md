# Quick Reference Guide

Fast lookup for common tasks, commands, and configurations.

## Commands Cheat Sheet

### Supabase CLI

```bash
# Initialize
supabase init
supabase login
supabase link --project-ref project-id

# Database
supabase db push                    # Deploy migrations
supabase db pull > backup.sql       # Backup database
supabase db reset                   # Clear database

# Functions
supabase functions serve            # Local development
supabase functions deploy           # Deploy to production
supabase functions list             # List all functions
supabase functions logs webhook     # View function logs
supabase functions logs webhook --tail  # Stream logs

# Project
supabase status                     # Check project status
supabase projects list              # List projects
supabase start                      # Start local environment
supabase stop                       # Stop local environment
```

### Testing

```bash
# Unit tests
deno test --allow-all tests/validators_test.ts

# Integration tests
deno test --allow-all --allow-net tests/webhook_message_test.ts

# All tests
deno test --allow-all --allow-net tests/

# With coverage
deno test --allow-all --coverage=coverage tests/
deno coverage coverage --lcov --output=coverage.lcov
```

### Curl Examples

```bash
# Webhook verification
curl "https://[project].supabase.co/functions/v1/webhook?hub.mode=subscribe&hub.verify_token=TOKEN&hub.challenge=CHALLENGE"

# Send test message
curl -X POST "https://[project].supabase.co/functions/v1/webhook?token=TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"entry":[{"changes":[{"value":{"messages":[{"from":"919876543210","id":"msg1","type":"text","text":{"body":"test"}}],"contacts":[{"profile":{"name":"User"}}],"metadata":{"phone_number_id":"123"}}}]}]}'

# Check function logs
curl -H "Authorization: Bearer $ACCESS_TOKEN" \
  "https://[project].supabase.co/functions/v1/webhook/logs"
```

---

## Environment Variables

### Required (Production)

```
SB_URL=https://[project].supabase.co
SB_ANON_KEY=[your-key]
SB_SERVICE_ROLE_KEY=[your-key]
WHATSAPP_ACCESS_TOKEN=[your-token]
WHATSAPP_PHONE_NUMBER_ID=[your-id]
WHATSAPP_VERIFY_TOKEN=[your-token]
WHATSAPP_WEBHOOK_POST_TOKEN=[your-token]
GOOGLE_SHEETS_ID=[your-id]
GOOGLE_SHEETS_PRIVATE_KEY=[base64-encoded-key]
GOOGLE_SHEETS_CLIENT_EMAIL=[service-account@project.iam.gserviceaccount.com]
```

### Optional

```
DEBUG_MODE=false
TIMEZONE=Asia/Kolkata
LOG_RETENTION_DAYS=90
SESSION_TIMEOUT_HOURS=24
FEATURE_FLAGS=json-string
```

---

## Database Schema Quick Ref

### whatsapp_sessions
```sql
SELECT phone, role, state, data, created_at 
FROM whatsapp_sessions 
WHERE phone = '919876543210';
```

### whatsapp_log
```sql
SELECT direction, phone, name, status, message, created_at 
FROM whatsapp_log 
WHERE created_at > NOW() - INTERVAL '1 hour' 
ORDER BY created_at DESC;
```

### message_dedup
```sql
SELECT message_id, phone, status, created_at 
FROM message_dedup 
WHERE phone = '919876543210';
```

---

## Common Error Codes

| Error | Cause | Fix |
|-------|-------|-----|
| 401 Unauthorized | Invalid token | Check webhook token in URL |
| 403 Forbidden | Failed verification | Verify token matches environment variable |
| 404 Not Found | Function not deployed | Run `supabase functions deploy` |
| 500 Internal Server Error | Function error | Check logs: `supabase functions logs [name]` |
| Connection refused | Database down | Check Supabase project status |
| Rate limit exceeded | Too many API calls | Implement caching or rate limiting |

---

## Database Queries

### Monitor Activity

```sql
-- Last 10 messages
SELECT phone, message, direction, status, created_at 
FROM whatsapp_log 
ORDER BY created_at DESC LIMIT 10;

-- Active sessions
SELECT phone, role, state, updated_at 
FROM whatsapp_sessions 
WHERE expires_at > NOW() 
ORDER BY updated_at DESC;

-- Error rate
SELECT 
  COUNT(*) as total,
  SUM(CASE WHEN status = 'ERROR' THEN 1 ELSE 0 END) as errors,
  ROUND(100.0 * SUM(CASE WHEN status = 'ERROR' THEN 1 ELSE 0 END) / COUNT(*), 2) as error_rate
FROM whatsapp_log 
WHERE created_at > NOW() - INTERVAL '1 hour';
```

### Maintenance

```sql
-- Clean old sessions
DELETE FROM whatsapp_sessions 
WHERE expires_at < NOW();

-- Clean old messages
DELETE FROM whatsapp_log 
WHERE created_at < NOW() - INTERVAL '90 days';

-- Clean expired cache
DELETE FROM message_dedup 
WHERE expires_at < NOW();
```

---

## File Paths Reference

```
whatsapp-automation/
├── supabase/
│   ├── functions/
│   │   ├── webhook/
│   │   │   └── index.ts              ← Main webhook
│   │   ├── api/
│   │   │   ├── appointments.ts
│   │   │   ├── doctors.ts
│   │   │   └── slots.ts
│   │   └── shared/
│   │       ├── types.ts              ← Type definitions
│   │       ├── validators.ts         ← Input validation
│   │       ├── logger.ts             ← Logging functions
│   │       ├── whatsapp-client.ts    ← WhatsApp API wrapper
│   │       └── message-processor.ts  ← Message routing
│   └── migrations/
│       └── 001_create_tables.sql     ← Database schema
├── SUPABASE_SETUP.md                ← Setup guide
├── SUPABASE_MIGRATION.md            ← Architecture
├── IMPLEMENTATION_GUIDE.md          ← Step-by-step
├── DEPLOYMENT.md                    ← Deployment & ops
├── TESTING.md                       ← Testing strategy
└── README.md
```

---

## Debugging Workflow

### 1. Check Function Logs
```bash
supabase functions logs webhook --limit 50 --follow
```

### 2. Query Database
```sql
SELECT * FROM whatsapp_log 
WHERE phone = '919876543210' 
ORDER BY created_at DESC 
LIMIT 5;
```

### 3. Verify Message Payload
Check Meta WhatsApp dashboard → Logs for webhook payload details

### 4. Local Testing
```bash
supabase start
supabase functions serve
# In another terminal:
curl "http://localhost:54321/functions/v1/webhook?token=test" ...
```

### 5. Check Google APIs
- Google Sheets: Drive → Shared with me → [Sheet name]
- Google Calendar: Share settings for service account email
- Service Account: [Console.cloud.google.com](https://console.cloud.google.com)

---

## Performance Targets

| Operation | Target | Alert Threshold |
|-----------|--------|-----------------|
| Webhook verification | < 100ms | > 500ms |
| Text message response | < 2s | > 5s |
| Appointment booking | < 5s | > 10s |
| Query available slots | < 3s | > 5s |
| Database query | < 500ms | > 1s |
| Google Sheets API | < 1s | > 2s |
| Google Calendar API | < 1s | > 2s |

---

## Monitoring Checklist

### Daily
- [ ] Error rate < 1%
- [ ] No function crashes
- [ ] Messages received and processed
- [ ] Response times normal

### Weekly
- [ ] Database size reasonable
- [ ] Backup completed
- [ ] Cost trends reviewed
- [ ] Performance metrics stable

### Monthly
- [ ] Security audit
- [ ] Dependency updates
- [ ] Log archival
- [ ] Capacity planning

---

## Emergency Procedures

### Service Degradation

1. Check function logs: `supabase functions logs webhook`
2. Check database: `SELECT count(*) FROM pg_stat_activity`
3. Check error logs: `SELECT * FROM whatsapp_log WHERE status = 'ERROR'`
4. If Google API issue: Check service account permissions
5. If database issue: Check connection pool, restart if needed
6. If critical: Rollback to previous deployment

### Data Loss Prevention

1. Automated backups (daily via Supabase)
2. Manual exports: `supabase db pull > backup.sql`
3. Regular testing of restore procedures
4. Archive old logs: Move to Cloud Storage after 90 days

### Security Incident

1. Rotate API tokens immediately
2. Check audit log for unauthorized access
3. Review recent deployments
4. Run security scan on code
5. Update security groups/firewall

---

## Quick Setup (New Developer)

```bash
# 1. Clone repo
git clone <repo>
cd whatsapp-automation

# 2. Install Supabase CLI
npm install -g supabase

# 3. Link to project
supabase link --project-ref your-project-id

# 4. Start local environment
supabase start

# 5. Serve functions
supabase functions serve

# 6. Test in another terminal
curl "http://localhost:54321/functions/v1/webhook?hub.mode=subscribe&hub.verify_token=test&hub.challenge=TEST"

# 7. View function code
ls supabase/functions/

# 8. View database schema
psql postgresql://postgres:postgres@localhost:54322/postgres -c "\dt"

# Done! Ready to develop
```

---

## Useful Resources

- [Supabase Docs](https://supabase.com/docs)
- [Edge Functions Guide](https://supabase.com/docs/guides/functions)
- [PostgreSQL Docs](https://www.postgresql.org/docs/)
- [Deno Manual](https://deno.land/manual)
- [WhatsApp API](https://developers.facebook.com/docs/whatsapp)
- [Google Sheets API](https://developers.google.com/sheets/api)
- [GitHub Copilot Docs](https://docs.github.com/en/copilot)

---

## Common Patterns

### Query with Error Handling
```typescript
try {
    const { data, error } = await supabase
        .from("table")
        .select("*")
        .eq("id", value);
    
    if (error) throw error;
    return data;
} catch (error) {
    await logError(supabase, error);
    throw error;
}
```

### Send WhatsApp Message
```typescript
const client = new WhatsAppClient();
await client.sendTextMessage(
    "919876543210",
    "Hello! 👋",
    supabase
);
```

### Update Session
```typescript
import { updateSession } from "./message-processor.ts";

await updateSession(supabase, phone, {
    state: "MAIN_MENU",
    data: { language: "EN" }
});
```

### Log Message
```typescript
import { logWhatsAppMessage } from "./logger.ts";

await logWhatsAppMessage(supabase, {
    direction: "OUTBOUND",
    phone: "919876543210",
    name: "John Doe",
    status: "TEXT",
    message: "Response text"
});
```

---

## Support Contacts

- **Supabase Support**: [supabase.com/support](https://supabase.com/support)
- **WhatsApp Business**: [businesssupport.whatsapp.com](https://businesssupport.whatsapp.com)
- **Google Cloud Support**: [console.cloud.google.com](https://console.cloud.google.com)
- **GitHub Issues**: [github.com/your-repo/issues](https://github.com)

---

**Last Updated:** 2026-03-15
**Version:** 1.0.0
