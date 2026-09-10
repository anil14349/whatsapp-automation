# WhatsApp Webhook System - Deployment Guide

**Version:** 1.0  
**Date:** September 10, 2026  
**Status:** Ready for Production Deployment  
**Estimated Duration:** 1-2 hours

---

## 🎯 Deployment Overview

This guide provides step-by-step instructions for deploying Phase 1 & 2 to production.

**What's Being Deployed:**
- ✅ Core webhook infrastructure (Phase 1)
- ✅ Advanced message handlers (Phase 2)
- ✅ Real-time delivery tracking (Phase 2)
- ✅ Admin dashboards (Phase 2)
- ✅ Database migrations
- ✅ 6 new database tables with RLS policies

**Deployment Strategy:** Blue-Green (zero downtime)

---

## ⚠️ Pre-Deployment Checklist

### Code Review
- [ ] All code reviewed and approved
- [ ] No console.log left in production code
- [ ] All TypeScript errors resolved
- [ ] No security vulnerabilities found

**Verify:**
```bash
# Check for console.log
grep -r "console\." clinic-app/lib/whatsapp/*.ts --include="*.ts" | grep -v "error\|warn"

# Check TypeScript
npm run type-check

# Security scan
npm audit --audit-level=moderate
```

### Testing
- [ ] Webhook verification tested locally
- [ ] Message processing tested
- [ ] Status updates tested
- [ ] Admin UI tested
- [ ] Error scenarios tested
- [ ] RLS policies verified

### Environment Setup
- [ ] Production environment variables prepared
- [ ] Database backups scheduled
- [ ] Monitoring alerts configured
- [ ] Rollback plan documented

### Team Readiness
- [ ] DevOps team notified
- [ ] On-call rotation set up
- [ ] Support team trained
- [ ] Documentation available

---

## 📋 Step-by-Step Deployment

### Phase 1: Pre-Deployment (Day Before)

#### 1. Database Backup
```bash
# Full backup of production database
pg_dump -h production-host -U postgres database_name > backup_2026-09-10.sql

# Verify backup size (should be 100MB+)
ls -lh backup_2026-09-10.sql

# Upload to secure storage
aws s3 cp backup_2026-09-10.sql s3://clinic-backups/
```

#### 2. Prepare Environment Variables
Create `.env.production`:
```bash
# WhatsApp Configuration
WHATSAPP_VERIFY_TOKEN=your_secure_token_here
CLINIC_ID=your_clinic_uuid_here

# Database
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# API Configuration
NEXT_PUBLIC_API_URL=https://yourapp.com
API_SECRET_KEY=your_secret_key

# Monitoring
SENTRY_DSN=your_sentry_dsn_here
DATADOG_API_KEY=your_datadog_key_here
```

#### 3. Prepare Database Migration
```bash
# Export migration file locally
cp clinic-app/supabase/migrations/0015_message_tracking.sql .

# Review migration
cat 0015_message_tracking.sql | head -50

# Verify it doesn't have breaking changes
# Should only ADD tables, EXTEND existing tables, never DROP
```

#### 4. Notify Stakeholders
- Email ops team: "Deployment scheduled for [TIME]"
- Slack announcement: "Maintenance window scheduled"
- Set status page to "Scheduled Maintenance"

---

### Phase 2: Pre-Deployment Testing (2 Hours Before)

#### 1. Test in Staging Environment
```bash
# Deploy to staging first
git checkout feature/whatsapp-flows-booking
npm install
npm run build

# Run migrations on staging
npx supabase migration up --project staging

# Test webhook
curl -X GET "http://staging.yourapp.com/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=test&hub.challenge=test123"

# Should return: test123

# Test message processing
curl -X POST http://staging.yourapp.com/api/webhooks/whatsapp \
  -H "X-Hub-Signature-256: sha256=test_signature" \
  -H "Content-Type: application/json" \
  -d '{"object":"whatsapp_business_account","entry":[...]}'

# Check logs
tail -f /var/log/staging.log | grep "Webhook received"
```

#### 2. Verify Admin UI
```bash
# Open staging environment in browser
https://staging.yourapp.com/admin

# Test navigation
- Click "Webhooks" → Should load
- Click "Patient Requests" → Should load
- Click "Message Tracking" → Should load

# Test webhook form
- Fill in Business Account ID
- Enter Verify Token
- Save settings → Should succeed
```

#### 3. Database Sanity Check
```sql
-- Verify tables exist in staging
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name LIKE '%webhook%' OR table_name LIKE '%message%';

-- Expected results:
-- webhook_events
-- webhook_subscriptions
-- webhook_settings
-- messages
-- message_templates
-- message_delivery_stats
-- booking_requests (extended)
-- patient_requests (extended)

-- Verify indexes
SELECT indexname FROM pg_indexes 
WHERE schemaname = 'public' 
AND indexname LIKE 'idx_%';

-- Verify RLS enabled
SELECT relname, relrowsecurity 
FROM pg_class WHERE relrowsecurity = true;
```

#### 4. Performance Testing
```bash
# Load test webhook endpoint
ab -n 1000 -c 10 http://staging.yourapp.com/api/webhooks/whatsapp

# Expected: < 200ms response time, 0 errors

# Check memory usage
ps aux | grep node
# Should show stable memory usage

# Check database connections
psql -c "SELECT count(*) as connections FROM pg_stat_activity;"
# Should be < 20 connections
```

---

### Phase 3: Production Deployment (During Maintenance Window)

#### 1. Merge Code to Main Branch
```bash
# Create pull request
gh pr create \
  --base main \
  --head feature/whatsapp-flows-booking \
  --title "Deploy: WhatsApp Webhook Phase 1 & 2" \
  --body "See DEPLOYMENT_GUIDE.md for details"

# Get PR number (e.g., #123)
# Wait for all checks to pass
# Merge PR
gh pr merge 123 --squash --delete-branch
```

#### 2. Pull Latest Main Branch
```bash
# On production server
git fetch origin
git checkout main
git pull origin main

# Verify commit is latest (should be merge commit)
git log --oneline | head -5
```

#### 3. Update Dependencies
```bash
# Install any new packages
npm ci --production

# Build application
npm run build

# Verify build succeeded
ls -la .next/

# Should have ~50MB of compiled code
```

#### 4. Run Database Migration
```bash
# CRITICAL: Do this carefully!

# Set maintenance mode first
export MAINTENANCE_MODE=true

# Run migration on production
# Option A: Using Supabase CLI (Recommended)
npx supabase migration up --project production

# Option B: Using psql directly
psql -h production-host -U postgres database_name < 0015_message_tracking.sql

# Monitor migration progress
watch 'psql -c "SELECT count(*) as tables FROM information_schema.tables WHERE table_schema='\''public'\''"'

# Verify migration completed (should see 8 tables)
psql -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public'" | wc -l
```

#### 5. Deploy Application
```bash
# Restart application service (zero-downtime)
# Option A: Docker (recommended)
docker pull yourregistry/clinic-app:latest
docker stop clinic-app || true
docker rm clinic-app || true
docker run -d \
  --name clinic-app \
  -p 3000:3000 \
  --env-file .env.production \
  yourregistry/clinic-app:latest

# Wait for health check
sleep 10
curl http://localhost:3000/health
# Should return: {"status":"ok"}

# Option B: PM2
pm2 start ecosystem.config.js
pm2 save

# Option C: systemd
sudo systemctl restart clinic-app
sudo systemctl status clinic-app
```

#### 6. Verify Production Deployment
```bash
# Health check
curl https://yourapp.com/health
# Should return: {"status":"ok"}

# Check webhook endpoint
curl -X GET "https://yourapp.com/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=YOUR_TOKEN&hub.challenge=test123"
# Should return: test123

# Verify database connection
curl https://yourapp.com/admin/webhooks
# Should load webhook dashboard
# Should show no errors in console
```

#### 7. Disable Maintenance Mode
```bash
# Remove maintenance mode
export MAINTENANCE_MODE=false

# Or update status page
# Your status page: Update status to "Operational"
```

#### 8. Monitor Logs
```bash
# Watch application logs for errors
tail -f /var/log/clinic-app.log | grep -i "error\|warning"

# Should see no errors in first 5 minutes
# Normal output should show:
# - Webhook events being logged
# - No 500 errors
# - All database queries succeeding
```

---

### Phase 4: Post-Deployment Verification (First Hour)

#### 1. Send Test Message
```bash
# Use WhatsApp test interface or real phone
# Send message: "book appointment"

# Verify in admin dashboard
# 1. Go to https://yourapp.com/admin/webhooks
# 2. Check "Recent Events"
# 3. Should see event with status "processed"
# 4. Click on event to see full payload

# Expected output:
# - Event Type: message
# - Status: processed
# - Timestamp: now
# - Message text: "book appointment"
```

#### 2. Verify Database Tables
```sql
-- Check webhook_events table
SELECT COUNT(*) as event_count FROM webhook_events;
-- Should be > 0

-- Check if message was logged
SELECT * FROM webhook_events 
ORDER BY created_at DESC LIMIT 1;

-- Check patient was created
SELECT COUNT(*) as patient_count FROM patients;
```

#### 3. Test Admin Dashboards
```
1. Go to https://yourapp.com/admin
2. Click "Patient Requests" in sidebar
   - Should load with no errors
   - Should show any requests from test message

3. Click "Message Tracking" in sidebar
   - Should load with no errors
   - Should show statistics (Sent, Delivered, Failed, etc.)
   - Should show recent messages
```

#### 4. Check Monitoring & Alerts
```
1. Open your monitoring dashboard (DataDog, New Relic, etc.)
2. Check metrics:
   - API response time: < 200ms
   - Error rate: < 0.1%
   - Database latency: < 50ms
   - Memory usage: < 500MB
   - CPU usage: < 50%

3. Check logs for warnings/errors
   - Should be none
   - Or only informational messages

4. Check WhatsApp message delivery
   - Send 5 test messages
   - Each should deliver within 10 seconds
   - Status should be "sent" then "delivered"
```

#### 5. Enable Full Monitoring
```bash
# Enable all alerts
export ALERTS_ENABLED=true

# If using DataDog
datadog-agent restart

# If using Sentry
curl https://sentry.io/api/0/projects/yourorg/yourproject/releases/v1.0/ \
  -X POST \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"version":"v1.0"}'
```

---

### Phase 5: Rollback Plan (If Issues Found)

#### Immediate Actions (< 5 minutes)
```bash
# If critical issue found:

# 1. Enable maintenance mode
export MAINTENANCE_MODE=true

# 2. Check logs
tail -f /var/log/clinic-app.log

# 3. Identify issue
# Common issues:
# - RLS policy blocking queries
# - Signature verification failing
# - Database migration incomplete
# - Environment variable missing
```

#### Rollback to Previous Version
```bash
# If rollback needed:

# 1. Revert database migration
psql < rollback_0015_message_tracking.sql

# 2. Checkout previous code
git checkout main~1
npm ci --production
npm run build

# 3. Restart service
docker restart clinic-app
# or
pm2 restart clinic-app
# or
sudo systemctl restart clinic-app

# 4. Verify
curl https://yourapp.com/health

# 5. Notify team
# Email: "Deployment rolled back - investigating issue"
```

#### Database Rollback
```bash
# If database corrupted:

# Restore from backup
psql < backup_2026-09-10.sql

# Verify restoration
psql -c "SELECT COUNT(*) as patient_count FROM patients;"

# Restart application
docker restart clinic-app
```

---

## 🚨 Troubleshooting

### Issue 1: Webhook Events Not Appearing

**Symptoms:**
- Send WhatsApp message
- No event appears in admin dashboard
- Logs show no activity

**Diagnosis:**
```bash
# Check webhook endpoint is accessible
curl https://yourapp.com/api/webhooks/whatsapp \
  -X GET \
  -G \
  -d "hub.mode=subscribe" \
  -d "hub.verify_token=YOUR_TOKEN" \
  -d "hub.challenge=test123"

# Should return: test123

# Check database connection
psql -c "SELECT 1" # Should return 1

# Check environment variables
echo $WHATSAPP_VERIFY_TOKEN
echo $CLINIC_ID
```

**Solution:**
1. Verify WhatsApp webhook URL is correct: `https://yourapp.com/api/webhooks/whatsapp`
2. Verify verify token matches: Check WhatsApp settings vs `.env`
3. Verify HTTPS is enabled (WhatsApp requires HTTPS)
4. Re-subscribe webhook in WhatsApp Business settings

---

### Issue 2: Signature Verification Failing

**Symptoms:**
- Error: "Webhook signature verification failed"
- All webhooks return 403 Forbidden

**Diagnosis:**
```bash
# Check if verify token is set
echo $WHATSAPP_VERIFY_TOKEN

# Check webhook route is loaded
grep -n "verifyWhatsAppSignature" app/api/webhooks/whatsapp/route.ts
```

**Solution:**
1. Regenerate verify token in `.env.production`
2. Update token in WhatsApp Business settings
3. Restart application: `docker restart clinic-app`
4. Re-test webhook

---

### Issue 3: Database Migration Failed

**Symptoms:**
- Error during `npx supabase migration up`
- Tables not created
- Admin dashboard shows errors

**Diagnosis:**
```sql
-- Check which tables exist
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public';

-- Check migration status
SELECT * FROM supabase_migrations_table;
```

**Solution:**
1. Check database logs: `tail -f /var/log/postgresql.log`
2. Review migration SQL: `cat 0015_message_tracking.sql`
3. Retry migration:
   ```bash
   npx supabase migration up --project production
   ```
4. If still failing, manually run SQL:
   ```bash
   psql < 0015_message_tracking.sql
   ```

---

### Issue 4: RLS Policies Not Working

**Symptoms:**
- Admin users can't see their clinic data
- "Permission denied" errors
- Empty dashboards for valid users

**Diagnosis:**
```sql
-- Check RLS is enabled
SELECT relname, relrowsecurity 
FROM pg_class 
WHERE relname IN ('messages', 'patient_requests', 'webhook_events')
AND relrowsecurity = true;

-- Should return 3 rows with relrowsecurity = true

-- Check policies exist
SELECT * FROM pg_policies 
WHERE tablename = 'messages';
```

**Solution:**
1. Verify RLS policies were created: Migration should enable RLS
2. Verify user's clinic_id is set correctly
3. Test with admin user:
   ```sql
   SELECT * FROM messages 
   WHERE clinic_id IN (
     SELECT clinic_id FROM admin_users WHERE user_id = auth.uid()
   );
   ```

---

### Issue 5: Admin Dashboard Showing Empty

**Symptoms:**
- Dashboard loads but shows "No requests found"
- Message tracking shows 0 metrics
- But messages are being sent

**Diagnosis:**
```sql
-- Check if data exists
SELECT COUNT(*) FROM patient_requests;
SELECT COUNT(*) FROM messages;

-- Check current user's clinic_id
SELECT clinic_id FROM admin_users WHERE user_id = auth.uid();

-- Check if data matches clinic_id
SELECT * FROM patient_requests 
WHERE clinic_id = 'your-clinic-id' 
ORDER BY created_at DESC LIMIT 5;
```

**Solution:**
1. Send test message
2. Check database directly for data
3. Verify clinic_id in session matches admin_users table
4. Clear browser cache: Hard refresh (Ctrl+Shift+R)
5. Logout and log back in

---

## 📊 Monitoring Setup

### Key Metrics to Track

```
Real-time (Dashboard):
- API response time (target: < 200ms)
- Error rate (target: < 0.1%)
- Webhook events/minute (expected: 0-50)
- Active users (expected: 1-5)

Database:
- Query latency (target: < 50ms)
- Connection count (target: < 20)
- Table sizes (expected: messages > 1MB)

WhatsApp:
- Messages sent/hour (track trend)
- Delivery rate (target: > 95%)
- Failure rate (alert if > 5%)
- Rate limit errors (should be 0)
```

### Alert Rules

```
Critical (Immediate Action):
- Error rate > 5%
- API response time > 2 seconds
- Database connection timeout
- Webhook endpoint unreachable

Warning (Monitor Closely):
- Error rate > 1%
- API response time > 500ms
- Delivery rate < 90%
- Database latency > 200ms

Info (Log Only):
- Deployment started
- Database migration complete
- Webhook verified
- Admin dashboard accessed
```

### Set Up Alerts

**DataDog Example:**
```python
# Create monitors in DataDog
api.monitor.create(
    type="metric alert",
    query="avg:app.response_time{service:clinic-app} > 200",
    name="High API Response Time",
    message="@opsteam Alert: Response time > 200ms"
)
```

**Sentry Example:**
```
1. Go to Sentry dashboard
2. Project Settings → Alerts
3. Create Alert:
   - Event: All Errors
   - Condition: Frequency > 10/minute
   - Action: Send email + Slack
```

---

## ✅ Post-Deployment Checklist

### Immediate (First Hour)
- [ ] Application is running without errors
- [ ] Database migration succeeded
- [ ] Admin dashboards load
- [ ] Test webhook verified
- [ ] Logs show normal activity
- [ ] Monitoring alerts enabled

### Short-term (First Day)
- [ ] 10+ webhook events processed successfully
- [ ] No error rate spikes
- [ ] Staff tested admin UI
- [ ] Message delivery confirmed working
- [ ] Status tracking verified
- [ ] Backup completed successfully

### Medium-term (First Week)
- [ ] 1,000+ webhook events processed
- [ ] Delivery rate > 95%
- [ ] Zero security incidents
- [ ] Performance metrics stable
- [ ] Staff trained on new features
- [ ] Documentation reviewed

### Long-term (First Month)
- [ ] 10,000+ events processed
- [ ] Delivery statistics analyzed
- [ ] Patient satisfaction > 4.0/5.0
- [ ] Request resolution time tracked
- [ ] Cost analysis completed
- [ ] Plan Phase 3 enhancements

---

## 📞 Support Contacts

### During Deployment
- **DevOps Lead:** [name] - [phone]
- **Database Admin:** [name] - [phone]
- **WhatsApp API Support:** [email]
- **On-Call Engineer:** [pagerduty_link]

### After Deployment
- **App Support:** support@yourapp.com
- **Infrastructure Support:** ops@yourapp.com
- **Escalation:** [manager_email]

### Documentation
- **Deployment Guide:** This file
- **Troubleshooting:** DEPLOYMENT_GUIDE.md (this section)
- **Architecture:** WHATSAPP_WEBHOOK_GUIDE.md
- **Features:** ADVANCED_MESSAGE_HANDLERS_GUIDE.md

---

## 📝 Deployment Log Template

```
DEPLOYMENT LOG - September 10, 2026
====================================

Deployment Start Time: [TIME]
Deployed By: [NAME]
Approved By: [NAME]

PRE-DEPLOYMENT:
- Backup completed: [SIZE]
- Tests passed: ✅ Yes / ❌ No
- Team notified: ✅ Yes / ❌ No

DEPLOYMENT:
- Code merged: [COMMIT_HASH]
- Dependencies installed: ✅ / ❌
- Database migration: ✅ / ❌
- App restarted: ✅ / ❌
- Health check passed: ✅ / ❌

POST-DEPLOYMENT:
- Test message sent: ✅ / ❌
- Admin dashboard verified: ✅ / ❌
- Monitoring enabled: ✅ / ❌
- Error rate: [PERCENTAGE]
- Response time: [MS]

Deployment Complete Time: [TIME]
Total Duration: [HOURS:MINUTES]

ISSUES:
[List any issues found]

RESOLUTION:
[How issues were resolved]

SIGN-OFF:
Deployed By: _________________ Date: _________
Verified By: _________________ Date: _________
```

---

## 🎯 Success Criteria

Deployment is successful when:

✅ **Functionality**
- Webhook receives messages and processes them
- Status updates are tracked in database
- Admin dashboards display data correctly
- All 8 message handlers work
- Error handling works as expected

✅ **Performance**
- API response time < 200ms (p95)
- Database queries < 50ms (p95)
- Webhook processing < 30 seconds (p99)
- No memory leaks
- CPU usage < 50%

✅ **Reliability**
- Error rate < 0.1%
- No 500 errors in logs
- Database connections stable
- No transaction timeouts
- Automatic retries working

✅ **Security**
- Signature verification working
- RLS policies enforced
- No SQL injection possible
- All sensitive data encrypted
- Audit logging enabled

✅ **Operations**
- Monitoring alerts enabled
- Backup completed
- Rollback plan ready
- Team trained
- Documentation updated

---

## 🚀 You're Ready!

Once you've completed this guide and verified all checkboxes, your WhatsApp webhook system is successfully deployed to production.

**Congratulations! 🎉**

---

**Version:** 1.0  
**Last Updated:** September 10, 2026  
**Status:** Ready for Production Deployment  
**Questions?** Refer to TROUBLESHOOTING section or contact DevOps team
