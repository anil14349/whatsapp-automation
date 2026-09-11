# Production Deployment Guide

**Version:** 1.0  
**Date:** September 11, 2026  
**Purpose:** Deploy to production safely  
**Estimated Time:** 2-3 hours  
**Risk Level:** LOW (well-documented, zero-downtime)

---

## 🎯 Overview

This guide ensures safe production deployment with:
- ✅ Zero downtime (blue-green deployment)
- ✅ Rollback procedures
- ✅ Monitoring setup
- ✅ Performance verification

---

## ⚠️ Pre-Production Checklist

### Code Quality
- [ ] All staging tests passed
- [ ] Code review completed
- [ ] No TypeScript errors
- [ ] No console.log statements
- [ ] Security scan passed
- [ ] Dependencies audited

### Database
- [ ] Backup created and verified
- [ ] Backup uploaded to secure storage
- [ ] Backup restoration tested
- [ ] Migration tested on staging
- [ ] RLS policies verified

### Infrastructure
- [ ] Production Vercel project ready
- [ ] Monitoring tools configured
- [ ] Alert rules set up
- [ ] On-call engineer assigned
- [ ] Rollback plan documented

### Team
- [ ] All stakeholders notified
- [ ] Deployment window scheduled
- [ ] Team trained on features
- [ ] Support team briefed
- [ ] Communication plan ready

---

## 🚀 5-Phase Production Deployment

### Phase 1: Pre-Production Setup (Day Before)

#### Step 1: Backup Database

```bash
# Create full backup
pg_dump -h production-host -U postgres database_name > backup_production_2026-09-11.sql

# Verify size (should be > 100MB)
ls -lh backup_production_2026-09-11.sql

# Upload to secure storage
aws s3 cp backup_production_2026-09-11.sql s3://backups/clinic-prod/
```

#### Step 2: Prepare Production Environment

```
PRODUCTION ENVIRONMENT VARIABLES:
✓ CLINIC_ID = production_clinic_uuid
✓ WHATSAPP_VERIFY_TOKEN = production_token
✓ SUPABASE_URL = production_supabase_url
✓ SUPABASE_ANON_KEY = production_key
✓ SUPABASE_SERVICE_ROLE_KEY = production_key
✓ SENTRY_DSN = error_tracking_url (optional)
```

#### Step 3: Notify Stakeholders

```
Email Template:
─────────────────────────────
Subject: WhatsApp System Production Deployment

Dear Team,

Production deployment scheduled:
Date: [DATE]
Time: [TIME] - [TIME]
Duration: 2-3 hours
Window: [WINDOW]

What's changing:
- Advanced message handlers (8 types)
- Real-time delivery tracking
- Admin dashboards
- Enhanced appointment management

Expected Impact:
- ZERO downtime
- Users can continue using app
- New features available after deployment

Questions? Contact: [DevOps Lead]
─────────────────────────────
```

---

### Phase 2: Pre-Deployment Testing (2 Hours Before)

#### Step 1: Final Staging Verification

```bash
# Test all endpoints on staging
curl https://staging.vercel.app/health
curl https://staging.vercel.app/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=TOKEN&hub.challenge=test

# Run full test suite (see TESTING_GUIDE.md)
# All tests must pass ✓
```

#### Step 2: Database Sanity Check

```sql
-- Verify staging data integrity
SELECT COUNT(*) FROM webhooks_events;
SELECT COUNT(*) FROM appointments;
SELECT COUNT(*) FROM patients;

-- Verify RLS policies
SELECT * FROM pg_policies WHERE tablename IN ('messages', 'patient_requests');
```

#### Step 3: Enable Maintenance Mode

```bash
# Set environment variable
export MAINTENANCE_MODE=true

# Or update in Vercel
# Add: MAINTENANCE_MODE=true
```

---

### Phase 3: Production Deployment (During Window)

#### Step 1: Set Maintenance Mode

1. Go to Vercel dashboard
2. Settings → Environment Variables
3. Add or update: `MAINTENANCE_MODE=true`
4. Redeploy with maintenance message

#### Step 2: Database Migration

```bash
# Connect to production database
# Run migration
npx supabase migration up --project production

# Verify migration
psql -c "SELECT COUNT(*) as tables FROM information_schema.tables WHERE table_schema='public';"
# Should show increased count (6 new tables)

# Verify RLS
psql -c "SELECT COUNT(*) FROM pg_policies WHERE tablename IN ('messages', 'patient_requests');"
# Should show RLS policies
```

#### Step 3: Deploy Code

**Option A: Vercel Dashboard**
1. Go to Deployments
2. Find latest
3. Click "Promote to Production"

**Option B: GitHub**
```bash
# Merge feature branch to main
git checkout main
git pull
git merge feature/whatsapp-flows-booking
git push origin main
```

#### Step 4: Verify Production Deployment

```bash
# Check health
curl https://your-prod.com/health
# Should return: {"status":"ok"}

# Check webhook
curl -X GET "https://your-prod.com/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=TOKEN&hub.challenge=test123"
# Should return: test123

# Check admin
curl https://your-prod.com/admin
# Should return 200 status
```

#### Step 5: Disable Maintenance Mode

1. Vercel Settings → Environment Variables
2. Remove or set `MAINTENANCE_MODE=false`
3. Redeploy
4. Update status page to "Operational"

---

### Phase 4: Post-Deployment Verification (First Hour)

#### Step 1: Health Checks

```bash
# API health
curl https://your-prod.com/health

# Webhook endpoint
curl -X GET "https://your-prod.com/api/webhooks/whatsapp?..."

# Admin dashboard
curl https://your-prod.com/admin
```

#### Step 2: Send Test Message

1. Use WhatsApp to send test message to business account
2. Message: "book appointment"
3. Go to admin dashboard
4. Check Webhooks → Recent Events
5. Should see message with status "processed" ✅

#### Step 3: Verify Admin Dashboards

Open each in browser:
- [ ] `/admin/webhooks` - Loads
- [ ] `/admin/patient-requests` - Loads
- [ ] `/admin/message-tracking` - Loads
- [ ] Can see test message logged ✅

#### Step 4: Monitor Logs

```bash
# Watch production logs
vercel logs --follow

# Should see:
# - Webhook received
# - Message processed
# - No errors
```

#### Step 5: Database Verification

```sql
-- Check webhook event
SELECT * FROM webhook_events WHERE created_at > NOW() - INTERVAL '1 hour' LIMIT 1;

-- Check message
SELECT * FROM messages WHERE created_at > NOW() - INTERVAL '1 hour' LIMIT 1;

-- Check patient request
SELECT * FROM patient_requests WHERE created_at > NOW() - INTERVAL '1 hour' LIMIT 1;
```

---

### Phase 5: Post-Deployment Monitoring (24 Hours)

#### Hour 1: Intensive Monitoring

```bash
# Every 5 minutes:
curl https://your-prod.com/health

# Watch logs continuously
vercel logs --follow

# Check error tracking (Sentry, DataDog)
# Should show no new errors related to deployment
```

#### Hour 1-4: Ongoing Monitoring

```bash
# Monitor every 15 minutes:
# - Error rate
# - Response time
# - Database connections
# - Message throughput
```

#### Hours 4-24: Regular Monitoring

```bash
# Monitor hourly:
# - Error rate (should be < 0.1%)
# - Performance metrics
# - Database health
# - Message delivery rate (should be > 95%)
```

---

## 🔄 Rollback Procedure (If Critical Issue)

### Immediate Actions (< 5 minutes)

1. **Enable Maintenance Mode**
   ```
   Add: MAINTENANCE_MODE=true to env
   Redeploy
   ```

2. **Assess Situation**
   - What's broken?
   - How many users affected?
   - Can it be fixed quickly?

3. **Decide: Fix or Rollback**

### If Rolling Back (< 10 minutes)

```bash
# Option 1: Revert deployment
vercel rollback

# Option 2: Checkout previous version
git checkout HEAD~1
npm run build
vercel --prod

# Option 3: Restore from backup
psql < backup_production_2026-09-11.sql
```

### Verification After Rollback

```bash
# Check health
curl https://your-prod.com/health

# Verify endpoints
curl https://your-prod.com/api/webhooks/whatsapp?...

# Check database
SELECT COUNT(*) FROM appointments;
```

### Notify Team

```
Email Template:
─────────────────────────────
Subject: Deployment Rollback Notice

Dear Team,

Production deployment was rolled back at [TIME].

Reason: [Brief explanation]
Action: [What happened]
Impact: System returned to previous stable state
Status: Investigating issue

We will reschedule deployment after fixes.
─────────────────────────────
```

---

## 📊 Success Criteria

✅ **Production deployment successful when:**

- [ ] Vercel shows "Ready" status
- [ ] Health check passes (200 OK)
- [ ] Webhook endpoint responsive
- [ ] Admin dashboards accessible
- [ ] Database migration completed
- [ ] Test message received and logged
- [ ] No 500 errors in logs (first hour)
- [ ] Error rate < 0.1%
- [ ] Response time < 200ms (p95)
- [ ] Delivery rate > 95%
- [ ] All monitoring alerts green

---

## 📈 Performance Baselines

After production deployment, establish baselines:

```
API Response Time: _________ms (target: < 200ms)
Database Query Time: _________ms (target: < 50ms)
Error Rate: _________% (target: < 0.1%)
Message Throughput: _________/min (target: > 100/min)
Webhook Processing Time: _________ms (target: < 30s)
Delivery Rate: _________ % (target: > 95%)
```

---

## 🎯 Post-Production Checklist

### First Day
- [ ] Monitor logs continuously
- [ ] Test all features manually
- [ ] Verify data integrity
- [ ] Check performance metrics
- [ ] Monitor error rates
- [ ] Team on standby

### First Week
- [ ] Daily performance review
- [ ] Weekly analytics review
- [ ] User feedback collection
- [ ] Document issues
- [ ] Plan improvements

### First Month
- [ ] Monthly retrospective
- [ ] Performance optimization
- [ ] Capacity planning
- [ ] Next release planning

---

## 📞 Support During Production

### On-Call Rotation

```
Primary: [Name/Contact]
Secondary: [Name/Contact]
Escalation: [Manager/Contact]
```

### Critical Issues

**Immediate Response (< 15 min):**
- Page on-call engineer
- Assess situation
- Decide: Fix or Rollback
- Notify stakeholders

**Issue Channels:**
- Slack: #production-alerts
- Phone: [Emergency Line]
- Email: [Alert Email]

---

## 🔍 Monitoring & Alerts

### Key Metrics to Monitor

```
✓ API response time (alert if > 500ms)
✓ Error rate (alert if > 1%)
✓ Database connections (alert if > 50)
✓ Memory usage (alert if > 80%)
✓ Disk usage (alert if > 80%)
✓ Message delivery rate (alert if < 90%)
```

### Tools

```
Errors: Sentry, DataDog
Logs: Vercel Logs, CloudWatch
Performance: New Relic, DataDog
Uptime: StatusPage, UptimeRobot
```

---

**Status:** Production Deployment Guide  
**Difficulty:** High (but well-documented)  
**Time:** 2-3 hours  
**Risk:** LOW (rollback available)

**Next:** ADMIN_USER_GUIDE.md
