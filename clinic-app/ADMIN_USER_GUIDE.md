# Admin User Guide

**Version:** 1.0  
**Date:** September 11, 2026  
**Purpose:** How to use admin dashboards  
**Audience:** Clinic admin staff

---

## 🎯 Overview

This guide explains how to use the 3 admin dashboards:
1. **Webhooks Dashboard** - Monitor WhatsApp integration
2. **Patient Requests Dashboard** - Manage patient requests
3. **Message Tracking Dashboard** - View delivery status

---

## 📊 Webhooks Dashboard

**URL:** https://your-app.com/admin/webhooks

### Features

#### 1. Setup Guide
- Step-by-step WhatsApp configuration
- Business Account ID entry
- Verify Token setup
- Event subscription

#### 2. Settings Form
```
Business Account ID: [Enter your ID]
Verify Token: [Enter secure token]
Auto-process bookings: [Toggle]
Auto-send confirmations: [Toggle]
```

#### 3. Recent Events List
- Shows latest webhook events
- Event type (message, status)
- Status (processed, failed, retrying)
- Timestamp
- Click to view full payload

#### 4. Health Statistics
- Total events (today)
- Processing rate
- Error count
- Average response time

### How to Use

**Step 1: Configure Settings**
1. Enter Business Account ID
2. Enter Verify Token (same as WhatsApp)
3. Click "Save Settings"
4. Should show "✅ Settings Updated"

**Step 2: Monitor Events**
1. Look at "Recent Events"
2. Click any event to see full details
3. Check status:
   - ✅ processed = Working fine
   - ❌ failed = Problem occurred
   - ⏳ retrying = Being retried

**Step 3: Troubleshoot**
If events show as "failed":
1. Click on event
2. Read error message
3. Check troubleshooting guide
4. Fix issue and try again

---

## 👥 Patient Requests Dashboard

**URL:** https://your-app.com/admin/patient-requests

### What Are Patient Requests?

Requests created when patients send WhatsApp messages for:
- Lab collection
- Test results
- Prescription refills
- Billing inquiries
- Doctor information
- Appointment reschedule
- Appointment status
- Feedback/complaints

### Dashboard Overview

```
┌─────────────────────────────────────┐
│ View: [Today] [Future] [History]   │
├─────────────────────────────────────┤
│ Patient Name | Request Type | Status │
│                                     │
│ Click row for details panel        │
└─────────────────────────────────────┘
```

### Filter Options

**By Status:**
- Pending (needs attention)
- Acknowledged (we saw it)
- In Progress (being worked on)
- Resolved (completed)

**By View:**
- Today (today's requests only)
- Future (tomorrow onwards, 30 days)
- History (past 30 days)

### Using the Dashboard

#### Step 1: Check Pending Requests

1. Click **[Pending]** filter
2. See all unhandled requests
3. These need your attention

#### Step 2: View Request Details

1. Click on any patient name
2. Details panel opens showing:
   - Patient info
   - Request type
   - Full request text
   - Current status
   - Assigned staff
   - Internal notes

#### Step 3: Assign to Staff Member

1. In details panel, click "Click to assign"
2. Select staff member from dropdown
3. Automatically saved ✅
4. Status updates to show who's handling it

#### Step 4: Add Internal Notes

1. Click in "Notes" field
2. Type notes (for your team)
3. Click away to auto-save
4. Notes always visible to admin

#### Step 5: Update Status

1. Click status dropdown
2. Select new status:
   - Pending → Acknowledged (we saw it)
   - Acknowledged → In Progress (working on it)
   - In Progress → Resolved (completed)
3. Auto-saves

### Example Workflow

```
1. Patient sends: "Can I book lab collection?"
   ↓
2. Dashboard shows new pending request
   ↓
3. Click request → See details
   ↓
4. Assign to "Nursing Team"
   ↓
5. Change status to "In Progress"
   ↓
6. Add note: "Scheduled for tomorrow 10 AM"
   ↓
7. Call patient to confirm
   ↓
8. Change status to "Resolved"
```

---

## 📱 Message Tracking Dashboard

**URL:** https://your-app.com/admin/message-tracking

### What's Tracked?

Every WhatsApp message:
- Sent to patient (outgoing)
- Received from patient (incoming)
- Delivery status progression
- Read status
- Failure details

### Status Progression

```
Message Created
    ↓
Pending (waiting to send)
    ↓
Sent (submitted to WhatsApp)
    ↓
Delivered (reached patient's phone)
    ↓
Read (patient opened message)
    ↓
[Or Failed at any stage]
```

### Dashboard Features

#### 1. Statistics Cards (Top)

```
Sent: 150         (total sent today)
Delivered: 145    (reached patient)
Read: 120         (patient opened)
Failed: 5         (couldn't deliver)
```

Delivery Rate: **96.7%** (delivered / sent)  
Read Rate: **80%** (read / sent)

#### 2. Filter Options

**By Status:**
- Pending (not yet sent)
- Sent (at WhatsApp, not delivered)
- Delivered (reached phone)
- Read (patient opened)
- Failed (couldn't deliver)

**By Direction:**
- Incoming (from patient)
- Outgoing (to patient)

#### 3. Message List

Shows:
- Patient name & phone
- Direction (📤 outgoing / 📥 incoming)
- Message preview
- Status badge
- Timestamp

#### 4. Message Timeline

Click any message to see:
```
Created:  2026-09-11 10:00:00 ✓
Sent:     2026-09-11 10:00:05 ✓
Delivered: 2026-09-11 10:00:15 ✓
Read:     2026-09-11 10:05:30 ✓
```

### Using the Dashboard

#### Check Today's Performance

1. Open dashboard
2. Look at statistics
3. Current metrics:
   - Sent count
   - Delivery rate
   - Read rate

#### Find Failed Messages

1. Click Status filter
2. Select "Failed"
3. See all failed messages
4. Click message to see error

#### View Message Timeline

1. Find message in list
2. Click to open details
3. See full progression
4. Understand delivery status

#### Monitor Delivery Rate

1. Watch Delivery Rate % (top)
2. Target: > 95%
3. If dropping:
   - Check failed messages
   - Look for patterns
   - Check error messages

---

## 🔄 Common Admin Tasks

### Task 1: Handle Lab Collection Request

```
Patient sends: "Book lab collection"
1. Check Patient Requests dashboard
2. Find "lab_collection" request
3. Click to view
4. Assign to nursing team
5. Add note: "Scheduled for Sept 12"
6. Change status: Pending → In Progress
7. Call patient to confirm
8. Change status: In Progress → Resolved
```

### Task 2: Check Message Delivery Issues

```
Delivery rate dropped!
1. Go to Message Tracking
2. Filter by Status: "Failed"
3. Click failed message
4. Read error message
5. Common issues:
   - Invalid phone number → Fix patient phone
   - Rate limited → Wait 1 hour, retry
   - Service error → Wait, auto-retry
```

### Task 3: Respond to Patient Request

```
Patient request needs response:
1. Open Patient Requests
2. Find pending request
3. Assign to yourself (if you'll handle)
4. Change to "In Progress"
5. Contact patient (call/WhatsApp)
6. Resolve issue
7. Add note with resolution
8. Change status to "Resolved"
```

### Task 4: Monitor Daily Performance

```
Morning routine:
1. Open Webhooks → Check Recent Events (any errors?)
2. Open Patient Requests → Filter Pending (any urgent?)
3. Open Message Tracking → Check Delivery Rate (healthy?)
4. Note any issues for team meeting
```

---

## ⚙️ Troubleshooting

### Issue: Patient Request Not Showing

**Why:** Message might not have matched keywords

**Solution:**
1. Check Webhooks dashboard
2. See if message was received
3. If received but not as request:
   - Message didn't match keywords
   - Create request manually
4. If not received:
   - Check WhatsApp webhook setup
   - Verify webhook URL
   - Verify verify token

### Issue: Message Shows as "Failed"

**Why:** Couldn't deliver to WhatsApp

**Common Causes:**
- Invalid phone number (missing country code)
- Patient's WhatsApp not active
- Message rate limited (too many messages)
- WhatsApp service issue

**Solution:**
1. Click failed message
2. Read error details
3. If phone issue → Update patient phone
4. If rate limited → Retry after 1 hour
5. If service issue → Wait, auto-retries

### Issue: Dashboard Loading Slowly

**Why:** Too many records

**Solution:**
1. Use filters (Today, Future, History)
2. Don't load "All" records
3. Reload page if still slow
4. Contact admin if persistent

---

## 📋 Best Practices

### For Patient Requests
✅ Assign immediately (so staff knows)
✅ Add notes for context
✅ Update status as progress
✅ Check daily for pending

### For Message Tracking
✅ Monitor delivery rate daily
✅ Investigate failed messages
✅ Note patterns in failures
✅ Alert if rate drops < 90%

### For Webhooks
✅ Check Recent Events daily
✅ Note error patterns
✅ Update settings if needed
✅ Test after changes

---

## 📞 Getting Help

**Issue:** Can't find a message
→ Check Webhooks Recent Events
→ See if it was received

**Issue:** Staff name not showing
→ Check if admin user created
→ Add user if missing

**Issue:** Filter not working
→ Refresh page
→ Try different filter

**Issue:** Something broken
→ See TROUBLESHOOTING_GUIDE.md
→ Contact DevOps if critical

---

**Version:** 1.0  
**Last Updated:** September 11, 2026  
**Difficulty:** Easy  

For technical questions, see: DEVELOPER_ONBOARDING_GUIDE.md
