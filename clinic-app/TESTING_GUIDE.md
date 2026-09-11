# Complete Testing Guide

**Version:** 1.0  
**Date:** September 11, 2026  
**Purpose:** Comprehensive testing before production  
**Estimated Time:** 2-3 hours

---

## 🎯 Overview

This guide provides detailed test cases for all features.

**Test Categories:**
- ✅ Webhook Integration
- ✅ Message Handlers (8 types)
- ✅ Appointment Management
- ✅ Admin Dashboards
- ✅ Database & Security
- ✅ Performance & Load

---

## 🧪 Phase 1: Webhook Integration Tests (30 minutes)

### Test 1.1: Webhook Verification

**Step 1:** Test endpoint is accessible

```bash
curl -X GET "https://your-staging.vercel.app/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=YOUR_TOKEN&hub.challenge=test123"
```

**Expected:** Returns `test123` ✅

**Step 2:** Test with wrong token

```bash
curl -X GET "https://your-staging.vercel.app/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=WRONG_TOKEN&hub.challenge=test123"
```

**Expected:** Returns 403 Forbidden ✅

### Test 1.2: Signature Verification

**Test:** Send message with invalid signature

```bash
curl -X POST https://your-staging.vercel.app/api/webhooks/whatsapp \
  -H "X-Hub-Signature-256: sha256=invalid_signature" \
  -H "Content-Type: application/json" \
  -d '{"object":"whatsapp_business_account"}'
```

**Expected:** Returns 403 Forbidden ✅

### Test 1.3: Message Reception

**Step 1:** Send WhatsApp message

```
Phone message: "book appointment"
```

**Step 2:** Check admin dashboard

```
Go to: https://your-staging.vercel.app/admin/webhooks
Look for: Recent Events section
Expected: Message appears with status "processed" ✅
```

---

## 🧪 Phase 2: Message Handler Tests (90 minutes)

### Test 2.1: Booking Handler

**Message:** "book appointment tomorrow 2 PM"

**Expected Results:**
- [ ] Message logged in webhooks
- [ ] Booking request created in database
- [ ] Patient request created
- [ ] Response sent to WhatsApp

**Verification:**
```sql
SELECT * FROM booking_requests 
WHERE patient_phone LIKE '%your_number%' 
ORDER BY created_at DESC LIMIT 1;
```

---

### Test 2.2: Lab Collection Handler

**Message:** "Can I book lab collection?"

**Expected Results:**
- [ ] Patient request created with type "lab_collection"
- [ ] Response sent with timeframe (2-4 hours)
- [ ] Shows in Patient Requests dashboard

**Verification:**
```bash
# Check Patient Requests dashboard
https://your-staging.vercel.app/admin/patient-requests
# Filter: type = "lab_collection"
# Status: "pending"
```

---

### Test 2.3: Test Results Handler

**Message:** "Where are my results?"

**Expected Results:**
- [ ] Checks for recent lab requests
- [ ] Responds with status
- [ ] Creates results request

**Verification:**
```sql
SELECT * FROM patient_requests 
WHERE request_type = 'results' 
ORDER BY created_at DESC LIMIT 1;
```

---

### Test 2.4: Prescription Handler

**Message:** "Prescription refill"

**Expected Results:**
- [ ] Creates prescription request
- [ ] Response: "will send via email in 2 hours"
- [ ] Status: "pending"

**Verification:**
```bash
# Check Patient Requests
# Filter: type = "prescription"
```

---

### Test 2.5: Billing Handler

**Message:** "What's my bill?"

**Expected Results:**
- [ ] Creates billing request
- [ ] Response: "invoice within 1 hour"
- [ ] Shown in Patient Requests

**Verification:**
```sql
SELECT * FROM patient_requests 
WHERE request_type = 'bill';
```

---

### Test 2.6: Doctor Info Handler

**Message:** "Tell me about doctors"

**Expected Results:**
- [ ] Lists available doctors
- [ ] Shows specialty for each
- [ ] Mentions booking option

**Verification:**
- [ ] Response received in WhatsApp ✅
- [ ] Doctor names visible ✅

---

### Test 2.7: Reschedule Handler

**Message:** "I need to reschedule"

**Expected Results:**
- [ ] Finds current appointment
- [ ] Shows current date/time
- [ ] Asks for new date/time
- [ ] Creates reschedule request

**Verification:**
```sql
SELECT * FROM patient_requests 
WHERE request_type = 'reschedule';
```

---

### Test 2.8: Status Check Handler

**Message:** "When is my appointment?"

**Expected Results:**
- [ ] Finds next confirmed appointment
- [ ] Shows date, time, doctor
- [ ] Provides reschedule option

**Verification:**
- [ ] Response contains date/time ✅
- [ ] Doctor name shown ✅

---

### Test 2.9: Feedback Handler

**Message:** "I have a complaint"

**Expected Results:**
- [ ] Logs feedback request
- [ ] Thanks patient for feedback
- [ ] Status: "acknowledged"

**Verification:**
```sql
SELECT * FROM patient_requests 
WHERE request_type = 'feedback';
```

---

### Test 2.10: Help/Menu Handler

**Message:** "help" or "menu"

**Expected Results:**
- [ ] Displays menu options
- [ ] Shows numbered list
- [ ] Mentions all features

**Verification:**
- [ ] Response shows menu items ✅
- [ ] Properly formatted ✅

---

## 🧪 Phase 3: Appointment Management Tests (30 minutes)

### Test 3.1: Today's View

**Step 1:** Click [📅 Today] button

**Expected:**
- [ ] Shows only today's appointments
- [ ] Date filter cleared
- [ ] Button highlighted in blue

**Verification:**
```sql
SELECT COUNT(*) FROM appointments 
WHERE appointment_date = '2026-09-11';
# Should match count in UI
```

---

### Test 3.2: Future View

**Step 1:** Click [🔮 Future] button

**Expected:**
- [ ] Shows tomorrow onwards (30 days)
- [ ] No past appointments shown
- [ ] Button highlighted

**Verification:**
```sql
SELECT COUNT(*) FROM appointments 
WHERE appointment_date >= '2026-09-12' 
AND appointment_date <= DATE_ADD(NOW(), INTERVAL 30 DAY);
```

---

### Test 3.3: History View

**Step 1:** Click [📜 History] button

**Expected:**
- [ ] Shows past 30 days only
- [ ] No future appointments shown
- [ ] Button highlighted

**Verification:**
```sql
SELECT COUNT(*) FROM appointments 
WHERE appointment_date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
AND appointment_date < CURDATE();
```

---

### Test 3.4: Date Filter Override

**Step 1:** Select custom date (e.g., Sept 15)

**Expected:**
- [ ] Shows ONLY that date's appointments
- [ ] Overrides view buttons
- [ ] View buttons unfocused

---

### Test 3.5: Doctor Filter

**Step 1:** Select specific doctor

**Expected:**
- [ ] Shows only that doctor's appointments
- [ ] Works with all view filters
- [ ] Count matches query

---

### Test 3.6: Status Filter

**Step 1:** Select status "Confirmed"

**Expected:**
- [ ] Shows only confirmed appointments
- [ ] Other statuses hidden
- [ ] Count accurate

---

## 🧪 Phase 4: Admin Dashboard Tests (30 minutes)

### Test 4.1: Webhooks Dashboard

**URL:** https://your-staging.vercel.app/admin/webhooks

**Verify:**
- [ ] Settings form loads
- [ ] Can enter Business Account ID
- [ ] Can enter Verify Token
- [ ] Setup guide visible
- [ ] Recent events list shown
- [ ] Event details visible on click

---

### Test 4.2: Patient Requests Dashboard

**URL:** https://your-staging.vercel.app/admin/patient-requests

**Verify:**
- [ ] Lists all requests
- [ ] Filter buttons work (Today/Future/History)
- [ ] Status filter works
- [ ] Can click request for details
- [ ] Can assign to staff
- [ ] Can add notes
- [ ] Notes save automatically

---

### Test 4.3: Message Tracking Dashboard

**URL:** https://your-staging.vercel.app/admin/message-tracking

**Verify:**
- [ ] Statistics display (sent, delivered, read, failed)
- [ ] Delivery rate shows percentage
- [ ] Read rate shows percentage
- [ ] Message list displays
- [ ] Can filter by status
- [ ] Can filter by direction
- [ ] Can click message for timeline
- [ ] Timeline shows all timestamps

---

## 🧪 Phase 5: Database & Security Tests (30 minutes)

### Test 5.1: Data Isolation (RLS)

**Create 2 clinics:**
```sql
INSERT INTO clinics (name, email) VALUES ('Clinic A', 'a@clinic.com');
INSERT INTO clinics (name, email) VALUES ('Clinic B', 'b@clinic.com');
```

**Create message in Clinic A:**
```sql
INSERT INTO messages (clinic_id, patient_phone, content, status)
VALUES ('clinic-a-uuid', '+919876543210', 'test', 'sent');
```

**Login as Clinic B admin:**
- [ ] Should NOT see Clinic A's message

**Login as Clinic A admin:**
- [ ] Should see message

---

### Test 5.2: RLS Policies

**Verify policies enabled:**
```sql
SELECT relname, relrowsecurity FROM pg_class 
WHERE relrowsecurity = true;
# Should list: messages, patient_requests, etc.
```

---

### Test 5.3: Signature Verification

**Send with invalid signature:**
- [ ] Should return 403
- [ ] Should NOT be processed
- [ ] No database changes

**Send with valid signature:**
- [ ] Should return 200
- [ ] Should be processed
- [ ] Database updated

---

### Test 5.4: No Duplicate Patient Creation

**Send 5 messages from same number:**
```sql
SELECT COUNT(DISTINCT patient_id) 
FROM messages 
WHERE patient_phone = '+919876543210';
# Should be 1, not 5
```

---

## 🧪 Phase 6: Performance Tests (30 minutes)

### Test 6.1: Response Time

**Send message:**
```bash
time curl -X POST https://your-staging.vercel.app/api/webhooks/whatsapp \
  -H "X-Hub-Signature-256: sha256=..." \
  -d '{...}'
```

**Expected:** < 200ms ✅

---

### Test 6.2: Concurrent Messages

**Send 10 messages simultaneously:**

```bash
for i in {1..10}; do
  curl -X POST https://your-staging.vercel.app/api/webhooks/whatsapp \
    -H "X-Hub-Signature-256: sha256=..." \
    -d '{...}' &
done
wait
```

**Expected:**
- [ ] All processed successfully
- [ ] No errors in logs
- [ ] Database consistent

---

### Test 6.3: Database Query Performance

**Check index usage:**
```sql
SELECT schemaname, tablename, indexname 
FROM pg_indexes 
WHERE schemaname = 'public' 
AND indexname LIKE 'idx_%';
# Should show 6+ indexes
```

---

## ✅ Test Results Checklist

### Webhook Integration
- [ ] Verification endpoint works
- [ ] Signature validation works
- [ ] Message reception works
- [ ] Error handling works

### All Message Handlers
- [ ] Booking handler ✓
- [ ] Lab collection ✓
- [ ] Results ✓
- [ ] Prescription ✓
- [ ] Billing ✓
- [ ] Doctor info ✓
- [ ] Reschedule ✓
- [ ] Status check ✓
- [ ] Feedback ✓
- [ ] Help/menu ✓

### Appointment Management
- [ ] Today filter ✓
- [ ] Future filter ✓
- [ ] History filter ✓
- [ ] Date filter override ✓
- [ ] Doctor filter ✓
- [ ] Status filter ✓

### Admin Dashboards
- [ ] Webhooks dashboard ✓
- [ ] Patient requests dashboard ✓
- [ ] Message tracking dashboard ✓

### Database & Security
- [ ] RLS isolation ✓
- [ ] Signature verification ✓
- [ ] No duplicates ✓
- [ ] Data consistency ✓

### Performance
- [ ] Response time < 200ms ✓
- [ ] Concurrent handling ✓
- [ ] Query performance ✓

---

## 📊 Test Report Template

```
Test Date: _______________
Tester: ___________________
Environment: Staging
Total Tests: 30+

Passed: _____
Failed: _____
Skipped: _____

Issues Found:
1. _________________________
2. _________________________

Severity: [ ] Critical [ ] High [ ] Medium [ ] Low

Ready for Production: [ ] Yes [ ] No [ ] Needs Fixes
```

---

**Status:** Ready for Testing  
**Duration:** 2-3 hours  
**Difficulty:** Medium

**Next Guide:** PRODUCTION_DEPLOYMENT_GUIDE.md (if all tests pass)
