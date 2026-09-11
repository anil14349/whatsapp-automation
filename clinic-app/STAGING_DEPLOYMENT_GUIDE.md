# Staging Deployment Guide

**Version:** 1.0  
**Date:** September 11, 2026  
**Purpose:** Deploy to Vercel staging for testing  
**Estimated Time:** 45 minutes

---

## 🎯 Overview

This guide walks you through deploying the WhatsApp webhook system to **Vercel staging** for testing before production.

**What you'll have after:**
- ✅ App running on Vercel staging
- ✅ WhatsApp webhook connected
- ✅ Admin dashboards accessible
- ✅ Ready to test all features

---

## ✅ Pre-Deployment Checklist

### Code & Repository
- [ ] All code committed to feature/whatsapp-flows-booking
- [ ] No uncommitted changes
- [ ] Latest commits pulled

### Credentials & Secrets
- [ ] WHATSAPP_VERIFY_TOKEN generated (secure, random)
- [ ] CLINIC_ID obtained from database
- [ ] Supabase credentials ready:
  - [ ] SUPABASE_URL
  - [ ] SUPABASE_ANON_KEY
  - [ ] SUPABASE_SERVICE_ROLE_KEY
- [ ] WhatsApp Business Account setup

### Infrastructure
- [ ] Vercel account ready
- [ ] Project created on Vercel
- [ ] GitHub repo connected (if auto-deploy)
- [ ] Database migrations prepared

---

## 📋 Step-by-Step Deployment

### Phase 1: Get CLINIC_ID (5 minutes)

**Follow:** CLINIC_ID_SETUP_GUIDE.md

1. Open Supabase SQL Editor
2. Run query to find/create clinic
3. Copy the UUID

**Result:**
```
CLINIC_ID = 550e8400-e29b-41d4-a716-446655440000
```

---

### Phase 2: Configure Vercel (15 minutes)

#### Step 1: Create/Open Project

1. Go to [vercel.com](https://vercel.com)
2. Click "Add New" → "Project"
3. Select repository
4. Click "Import"

#### Step 2: Add Environment Variables

1. Click "Environment Variables"
2. Add each variable:

```
CLINIC_ID
Value: 550e8400-e29b-41d4-a716-446655440000

WHATSAPP_VERIFY_TOKEN
Value: your_secure_token

SUPABASE_URL
Value: https://your-project.supabase.co

SUPABASE_ANON_KEY
Value: your_anon_key

SUPABASE_SERVICE_ROLE_KEY
Value: your_service_role_key
```

3. Leave all as "Production, Preview, Development"
4. Click "Save" for each

#### Step 3: Deploy

1. Click "Deploy"
2. Wait for deployment (2-3 minutes)
3. Should show: ✅ Ready

---

### Phase 3: Verify Deployment (10 minutes)

#### Step 1: Check Health

```bash
curl https://your-staging.vercel.app/health
# Should return: {"status":"ok"}
```

#### Step 2: Test Webhook Endpoint

```bash
curl -X GET "https://your-staging.vercel.app/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=YOUR_TOKEN&hub.challenge=test123"
# Should return: test123
```

#### Step 3: Access Admin Dashboard

```
https://your-staging.vercel.app/admin
# Should load login page
```

---

### Phase 4: Database Setup (10 minutes)

#### Run Migration

```bash
# Connect to your database and run:
npx supabase migration up --project production
```

#### Verify Tables Created

```sql
SELECT COUNT(*) as table_count 
FROM information_schema.tables 
WHERE table_schema = 'public';
# Should show increased count (6 new tables)
```

#### Verify RLS Enabled

```sql
SELECT relname, relrowsecurity 
FROM pg_class 
WHERE relrowsecurity = true 
LIMIT 10;
# Should show: messages, patient_requests, etc.
```

---

### Phase 5: Configure WhatsApp (5 minutes)

1. Go to WhatsApp Business Settings
2. Navigate to Webhooks
3. Add webhook:
   ```
   URL: https://your-staging.vercel.app/api/webhooks/whatsapp
   Verify Token: your_verify_token
   ```
4. Subscribe to events:
   - ✅ messages
   - ✅ message_status
5. Click "Verify and Save"

---

## 🧪 Initial Testing (10 minutes)

### Send Test Message

1. From phone, message business account:
   ```
   "book appointment"
   ```

### Check Webhook Events

1. Go to admin dashboard
2. Navigate to Webhooks
3. Check "Recent Events"
4. Should see your message logged ✅

### Verify Message in Database

```sql
SELECT * FROM webhook_events 
ORDER BY created_at DESC 
LIMIT 1;
# Should show your message event
```

### Check Booking Request Created

```sql
SELECT * FROM booking_requests 
WHERE patient_phone LIKE '%your_number%' 
ORDER BY created_at DESC 
LIMIT 1;
# Should show your booking request
```

---

## ✅ Success Criteria

**Deployment successful when:**

- [ ] Vercel shows "Ready" status
- [ ] Health endpoint returns 200
- [ ] Webhook endpoint returns verify token
- [ ] Admin dashboard loads
- [ ] Database migration ran without errors
- [ ] RLS policies enabled on all tables
- [ ] WhatsApp webhook verified in settings
- [ ] Test message received and logged
- [ ] Booking request created in database
- [ ] No 500 errors in Vercel logs

---

## 🔍 Verification Checklist

### Application
- [ ] App loads without errors
- [ ] No TypeScript compilation errors
- [ ] All environment variables set
- [ ] Database connection working

### Webhook
- [ ] Webhook endpoint accessible
- [ ] Signature verification working
- [ ] Messages being received
- [ ] Responses being sent to WhatsApp

### Database
- [ ] Migration executed successfully
- [ ] 6 new tables created
- [ ] Indexes created
- [ ] RLS policies enabled
- [ ] Data isolation working

### Admin UI
- [ ] Admin login page loads
- [ ] Webhooks dashboard accessible
- [ ] Patient Requests dashboard accessible
- [ ] Message Tracking dashboard accessible
- [ ] Can see logged events

### WhatsApp Integration
- [ ] Webhook verified in WhatsApp settings
- [ ] Events subscribed (messages, status)
- [ ] Test message received
- [ ] Message appears in admin dashboard

---

## 📊 Monitoring

### View Logs

**Vercel Logs:**
```bash
vercel logs --follow
# Watch for errors in real-time
```

**Check Errors:**
```sql
-- View webhook errors
SELECT * FROM webhook_events 
WHERE status = 'failed' 
ORDER BY created_at DESC;
```

### Monitor Database

```sql
-- Check active connections
SELECT count(*) as connections 
FROM pg_stat_activity;

-- Check table sizes
SELECT schemaname, tablename, 
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) 
FROM pg_tables 
WHERE schemaname = 'public';
```

---

## 🚨 Troubleshooting

### App Won't Deploy
- Check environment variables are set
- Verify GitHub repo is connected
- Check for TypeScript errors: `npm run type-check`

### Webhook Not Receiving Messages
- Verify webhook URL in WhatsApp matches exactly
- Verify verify token matches
- Check Vercel logs for errors
- Test endpoint with curl (see above)

### Admin Dashboard Empty
- Verify CLINIC_ID is correct
- Check RLS policies are enabled
- Verify admin user has same clinic_id
- Try different admin account

### Database Issues
- Verify credentials in environment
- Check database is accessible
- Verify migration ran successfully
- Check for connection timeout errors

---

## 🎯 Next Steps

**After Successful Staging Deployment:**

1. **Run Full Test Suite** (see TESTING_GUIDE.md)
2. **Test All Features**
   - Try all 8 message handlers
   - Test appointment filters
   - Verify admin dashboards
3. **Load Testing** (optional)
   - Send 100+ messages
   - Monitor performance
4. **Prepare for Production**
   - Document any issues found
   - Make necessary fixes
   - Plan production deployment date

---

## 📞 Quick Reference

### Commands

```bash
# Deploy to staging
vercel --prod

# View logs
vercel logs --follow

# Test webhook
curl -X GET "https://your-staging.vercel.app/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=TOKEN&hub.challenge=test123"

# Check app health
curl https://your-staging.vercel.app/health
```

### URLs

```
Vercel Dashboard: https://vercel.com/dashboard
Admin Dashboard: https://your-staging.vercel.app/admin
Webhooks: https://your-staging.vercel.app/admin/webhooks
Patient Requests: https://your-staging.vercel.app/admin/patient-requests
Message Tracking: https://your-staging.vercel.app/admin/message-tracking
```

### Values to Fill In

```
Vercel URL: https://______________________________.vercel.app
CLINIC_ID: ____________________________________
WHATSAPP_VERIFY_TOKEN: ____________________________________
SUPABASE_URL: https://______________________________.supabase.co
WhatsApp Business Number: +____________________________
```

---

**Status:** Ready for Staging Deployment  
**Difficulty:** Easy  
**Time:** 45 minutes  

**Next Guide:** TESTING_GUIDE.md
