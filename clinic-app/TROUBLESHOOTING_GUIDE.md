# Troubleshooting Guide

**Version:** 1.0  
**Date:** September 11, 2026  
**Purpose:** Quick fixes for common issues

---

## 🆘 Quick Fix Index

| Issue | Time to Fix | Difficulty |
|-------|------------|-----------|
| App won't start | 5 min | Easy |
| Webhook not receiving | 10 min | Easy |
| Admin dashboard empty | 10 min | Easy |
| Messages not sending | 10 min | Medium |
| Database errors | 15 min | Medium |
| High error rate | 20 min | Hard |

---

## 🔴 Critical Issues

### App Crashed / Not Responding

**Symptoms:** Can't access app at all

**Fix:**
```bash
# Check app status
curl https://your-app.com/health

# If fails, restart
vercel rollback
# or
docker restart clinic-app
```

### Database Connection Lost

**Symptoms:** Admin shows "Error loading data"

**Fix:**
```bash
# Check credentials
echo $SUPABASE_URL
echo $SUPABASE_ANON_KEY

# Reconnect
vercel env pull

# Redeploy
vercel --prod
```

### Webhook Not Processing Any Messages

**Symptoms:** Send message, nothing happens

**Fix:**
1. Check webhook URL in WhatsApp matches exactly
2. Check verify token matches
3. Test endpoint:
   ```bash
   curl -X GET "https://your-app.com/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=TOKEN&hub.challenge=test123"
   # Must return: test123
   ```

---

## 🟠 High Priority Issues

### Messages Show as "Failed"

**Why:** Couldn't deliver to WhatsApp

**Diagnosis:**
```bash
# Check failed messages
curl "https://your-app.com/admin/message-tracking?status=failed"

# Click message to see error
# Common errors:
# - "Invalid recipient number" → Fix phone
# - "Rate limited" → Wait 1 hour
# - "Message template error" → Check template
```

**Fix:**
```sql
-- Check phone number format
SELECT patient_phone FROM messages 
WHERE status = 'failed' LIMIT 5;

-- Should be: +919876543210 (with country code)
-- Fix if missing country code

UPDATE patients SET phone = '+919876543210'
WHERE phone = '9876543210';
```

### Admin Dashboard Shows No Data

**Why:** RLS or CLINIC_ID issue

**Diagnosis:**
```bash
# Check if logged in
curl -c cookies.txt https://your-app.com/admin

# Check browser console for errors
# (F12 → Console tab)
```

**Fix:**
1. Logout and login again
2. Clear browser cache (Ctrl+Shift+Delete)
3. Check CLINIC_ID is correct:
   ```sql
   SELECT * FROM admin_users WHERE user_id = 'your_user_id';
   -- clinic_id must not be NULL
   ```
4. Verify RLS policies:
   ```sql
   SELECT * FROM pg_policies WHERE tablename = 'patient_requests';
   ```

### High Error Rate (> 1%)

**Symptoms:** Multiple message processing failures

**Diagnosis:**
```bash
# Check error logs
vercel logs --follow

# Look for pattern
grep -i error /var/log/app.log

# Check error tracking
# Go to Sentry or DataDog dashboard
```

**Common Causes & Fixes:**

**1. Database Connections Maxed**
```sql
SELECT count(*) FROM pg_stat_activity;
-- If > 50, connections leaked

-- Kill stale connections
SELECT pg_terminate_backend(pid) 
FROM pg_stat_activity 
WHERE state = 'idle' AND query_start < NOW() - INTERVAL '30 minutes';
```

**2. Memory Leak**
```bash
# Monitor memory
watch 'ps aux | grep node'

# If growing, restart app
vercel rollback
# or
docker restart clinic-app
```

**3. Database Slow**
```sql
-- Check slow queries
SELECT * FROM pg_stat_statements 
ORDER BY mean_time DESC LIMIT 10;

-- Add missing index if needed
CREATE INDEX idx_webhook_clinic ON webhook_events(clinic_id, created_at);
```

---

## 🟡 Medium Priority Issues

### Webhook Events Show as "Retrying"

**Why:** Processing failed but will retry

**Diagnosis:**
```sql
SELECT * FROM webhook_events 
WHERE status = 'retrying' 
ORDER BY created_at DESC;
```

**Fix:**
1. Check retry_count (should be < 3)
2. Wait for automatic retry (5 min)
3. If still retrying after 15 min:
   ```bash
   # Manually retry
   curl -X POST https://your-app.com/admin/webhooks/retry/event-id
   ```

### Message Delivery Rate Dropped

**Why:** More failures than usual

**Diagnosis:**
```bash
# Go to Message Tracking
# Check "Failed" status messages
# Click each to see error pattern
```

**Fix (by error type):**

**Invalid phone:**
```sql
UPDATE patients SET phone = '+919876543210'
WHERE phone LIKE '9876543210' 
AND phone NOT LIKE '+%';
```

**Rate limited:**
- Wait 1 hour
- Implement message queue/delays
- Contact WhatsApp support if persistent

**Template not found:**
- Check message_templates table
- Recreate missing template
- Verify template IDs in code

### Appointment Filter Not Working

**Why:** View button not responding

**Diagnosis:**
```bash
# Check browser console (F12)
# Look for JavaScript errors

# Try different filter
# Reload page
```

**Fix:**
```bash
# Clear browser cache
# Hard refresh: Ctrl+Shift+R

# Check URL parameters
# Should include: ?view=today
```

---

## 🟢 Low Priority Issues

### Admin Dashboard Loading Slowly

**Why:** Too many records

**Fix:**
1. Use filters (Today/Future/History)
2. Don't load "All" records
3. Limit date range
4. Reload page

### Webhook Event Details Not Showing

**Why:** Payload too large or malformed

**Fix:**
```bash
# Event still processed, just can't display payload
# This is informational only, not critical

# Check processing worked:
SELECT * FROM messages 
WHERE created_at > NOW() - INTERVAL '5 minutes';
```

### Staff Name Shows as "Assigned" Instead of Name

**Why:** Admin user record missing

**Fix:**
```sql
-- Create missing admin user
INSERT INTO admin_users (clinic_id, user_id, full_name, email, role)
VALUES ('clinic-uuid', 'auth-user-id', 'Staff Name', 'email@clinic.com', 'ADMIN');
```

---

## 🧪 Testing Fixes

### After Making a Fix, Verify:

```bash
# 1. Health check
curl https://your-app.com/health
# Expected: 200 OK

# 2. Webhook endpoint
curl -X GET "https://your-app.com/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=TOKEN&hub.challenge=test"
# Expected: "test"

# 3. Send test message
# Message: "help"
# Check: Message appears in admin dashboard

# 4. Check logs
vercel logs --follow
# Expected: No errors
```

---

## 📞 When to Escalate

**Escalate if:**
- Error persists > 15 min
- Multiple systems affected
- Data lost or corrupted
- Can't find root cause
- Need database expert

**Escalation:**
1. Page on-call engineer
2. Provide:
   - Symptom
   - Steps to reproduce
   - Error message
   - Relevant logs
   - Time issue started

---

**Version:** 1.0  
**Last Updated:** September 11, 2026

For detailed investigation, see: DEVELOPER_ONBOARDING_GUIDE.md
