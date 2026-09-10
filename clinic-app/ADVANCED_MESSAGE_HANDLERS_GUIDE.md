# Advanced Message Handlers & Status Tracking Guide

**Date:** September 10, 2026  
**Status:** ✅ Complete  
**Components:** 4 new files  
**Features:** 8 advanced message handlers + delivery status tracking + admin UI

---

## Overview

This guide explains the enhanced WhatsApp webhook system with advanced message handlers and message delivery tracking. The system now supports:

- ✅ Lab/sample collection requests
- ✅ Test results inquiries
- ✅ Prescription requests
- ✅ Billing/invoice queries
- ✅ Doctor information requests
- ✅ Appointment reschedule requests
- ✅ Appointment status checking
- ✅ Feedback and complaint collection
- ✅ Message delivery status tracking (pending → sent → delivered → read → failed)
- ✅ Daily delivery analytics

---

## Architecture

### Message Processing Pipeline

```
Incoming WhatsApp Message
        ↓
[Extract & Validate]
        ↓
[Find/Create Patient]
        ↓
[Route to Appropriate Handler]
        ├─ Advanced Handlers (Lab, Rx, Results, etc.)
        ├─ Basic Booking/Confirm/Cancel
        └─ Default Help Menu
        ↓
[Log Message to Database]
        ↓
[Send Response to Patient]
        ↓
[Track Delivery Status]
```

### Status Update Pipeline

```
WhatsApp Delivery Callback
        ↓
[Extract Status Updates]
        ↓
[Find Message in Database]
        ↓
[Update Message Status]
        ├─ sent
        ├─ delivered
        ├─ read
        └─ failed
        ↓
[Update Delivery Stats]
        ↓
[Calculate Analytics]
```

---

## Files Created

### 1. Advanced Message Handlers
**File:** `lib/whatsapp/advancedMessageHandlers.ts` (~500 lines)

Specialized handlers for patient requests:

- `handleLabCollectionRequest()` - Process home sample collection requests
- `handleResultsRequest()` - Handle test results inquiries
- `handlePrescriptionRequest()` - Process prescription requests
- `handleBillingRequest()` - Handle billing/invoice queries
- `handleDoctorInfoRequest()` - Provide doctor information
- `handleRescheduleRequest()` - Process appointment reschedule requests
- `handleStatusRequest()` - Check appointment status
- `handleFeedbackRequest()` - Collect patient feedback
- `routeAdvancedMessage()` - Route messages to appropriate handler based on keywords

**Key Features:**
- Intelligent keyword matching
- Patient request logging
- Contextual responses with emojis
- Clinic data lookup
- Staff assignment

### 2. Status Processor
**File:** `lib/whatsapp/statusProcessor.ts` (~300 lines)

Handle WhatsApp delivery status updates:

- `extractStatusUpdates()` - Parse status payload
- `processStatusUpdate()` - Update single message status
- `processStatusUpdates()` - Batch process status updates
- `updateDeliveryStats()` - Maintain daily analytics
- `getDeliverySummary()` - Calculate delivery rates
- `getFailedMessages()` - Retrieve failed message list

**Key Features:**
- Automatic timestamp tracking
- Error message logging
- Daily statistics aggregation
- Delivery/read rate calculation
- Failed message reporting

### 3. Patient Requests Admin UI
**File:** `app/admin/(dashboard)/patient-requests/page.tsx` (~300 lines)

Manage all patient requests:

- View all requests by type
- Filter by status (pending, acknowledged, in progress, resolved)
- Assign requests to staff
- Add notes/comments
- Track request lifecycle

**Columns:**
- Patient name & phone
- Request type (with color-coded badges)
- Status with quick edit
- Request text (truncated)
- Date created
- Assigned staff member

### 4. Message Tracking Admin UI
**File:** `app/admin/(dashboard)/message-tracking/page.tsx` (~350 lines)

Track message delivery:

- View all messages with status
- Filter by status (pending, sent, delivered, read, failed)
- Filter by direction (incoming/outgoing)
- Daily delivery statistics
- Message timeline with timestamps
- Error details for failed messages

**Features:**
- Real-time status updates
- Delivery rate visualization
- Read rate analytics
- Failed message inspection
- Status timeline view

---

## Message Routing Logic

### Advanced Handler Keywords

| Keywords | Handler | Action |
|----------|---------|--------|
| lab, collect, sample, blood, test | Lab Collection | Create patient request |
| result, report, ready, test ready | Results | Check recent tests, send status |
| prescription, medicine, drug, refill | Prescription | Create prescription request |
| bill, invoice, cost, charge, pay | Billing | Create billing request |
| doctor, specialist, cardiologist | Doctor Info | List available doctors |
| reschedule, change, different time, postpone | Reschedule | Show current appointment, ask for new time |
| status, when, time, appointment time | Status | Show next appointment details |
| feedback, complaint, suggest, issue, problem | Feedback | Log feedback and thank patient |

### Routing Flow

```
1. Check if message contains advanced keywords
   ├─ YES → Try advanced handler
   │  ├─ Match found → Execute handler → Return
   │  └─ No match → Continue to basic routing
   └─ NO → Continue to basic routing

2. Basic routing
   ├─ "book" / "appointment" → Booking handler
   ├─ "confirm" / "yes" → Confirmation handler
   ├─ "cancel" → Cancellation handler
   ├─ "help" / "menu" → Help menu
   └─ DEFAULT → Send help menu
```

---

## Database Schema

### Updated Messages Table

```sql
messages (
  id UUID,
  clinic_id UUID,
  patient_phone VARCHAR(20),
  patient_id UUID,
  
  -- Message info
  whatsapp_message_id VARCHAR(100),
  message_type VARCHAR(50),
  direction VARCHAR(20),
  content TEXT,
  message_payload JSONB,
  
  -- Status tracking
  status VARCHAR(20),           -- pending|sent|delivered|read|failed
  error_message TEXT,
  
  -- Timestamps (auto-updated)
  sent_at TIMESTAMP,
  delivered_at TIMESTAMP,
  read_at TIMESTAMP,
  failed_at TIMESTAMP,
  
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)
```

### Extended Patient Requests Table

```sql
patient_requests (
  id UUID,
  clinic_id UUID,
  patient_id UUID,
  patient_phone VARCHAR(20),
  
  -- Request info
  request_type VARCHAR(50),    -- lab_collection|prescription|results|bill|feedback|reschedule
  request_text TEXT,
  request_payload JSONB,
  
  -- Assignment
  status VARCHAR(20),          -- pending|acknowledged|in_progress|resolved
  assigned_to UUID,            -- admin_users reference
  notes TEXT,
  
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)
```

### Delivery Statistics Table

```sql
message_delivery_stats (
  id UUID,
  clinic_id UUID,
  date DATE,
  
  -- Daily counts
  total_sent INT,
  total_delivered INT,
  total_read INT,
  total_failed INT,
  
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)
```

---

## How It Works

### Processing Incoming Message

**Step 1: Message Extraction**
```javascript
const message = {
  from: "919876543210",
  type: "text",
  text: { body: "Can I get my lab results?" }
}
```

**Step 2: Patient Lookup**
```javascript
const patient = await findOrCreatePatient(
  supabase,
  clinicId,
  "919876543210"
);
// Returns: { id, name, phone, clinic_id }
```

**Step 3: Advanced Keyword Matching**
```javascript
const lowerText = "can i get my lab results?";
// Matches: /result|report|ready|test.*ready/i
// Routes to: handleResultsRequest()
```

**Step 4: Handler Execution**
```javascript
const result = await handleResultsRequest(
  supabase,
  clinicId,
  message,
  patient,
  text
);
// Returns: { success, action, message?, error? }
```

**Step 5: Database Logging**
```javascript
// Message stored in 'messages' table
// Patient request stored in 'patient_requests' table
// Status: pending (awaiting WhatsApp confirmation)
```

**Step 6: Send Response**
```javascript
await sendWhatsAppMessage(
  supabase,
  clinicId,
  "919876543210",
  "Found 2 recent test(s). Results ready in 24-48 hours..."
);
```

### Processing Status Updates

**Step 1: Extract Status Callback**
```javascript
// WhatsApp sends:
{
  "entry": [{
    "changes": [{
      "value": {
        "statuses": [{
          "id": "wamid.xxx",
          "status": "delivered",
          "timestamp": "1234567890"
        }]
      }
    }]
  }]
}
```

**Step 2: Update Message Status**
```javascript
await supabase
  .from("messages")
  .update({
    status: "delivered",
    delivered_at: "2026-09-10T14:30:00Z"
  })
  .eq("whatsapp_message_id", "wamid.xxx");
```

**Step 3: Update Daily Statistics**
```javascript
// Get or create today's stats
// Increment: total_delivered += 1
// Calculate: delivery_rate = (delivered / sent) * 100
```

---

## Handler Examples

### Lab Collection Request

**Patient Message:**
> "Can I book home sample collection?"

**Handler Response:**
```
Thanks for your interest in home sample collection! 🏥

Our team will contact you shortly to schedule the collection at your convenience.

Expected timeframe: Within 2-4 hours.
```

**Database:**
- Creates entry in `patient_requests` table
  - `request_type: "lab_collection"`
  - `status: "pending"`
- Admin notified via dashboard
- Staff can be assigned to handle

---

### Results Request

**Patient Message:**
> "When will my test results be ready?"

**Handler Response:**
```
Hi Raj! 👋

I found 2 recent test(s).

Our lab team will send you the results via email or WhatsApp as soon as they're ready. Typically within 24-48 hours.

If you need it urgently, just let us know! 📊
```

**Database:**
- Queries recent `patient_requests` with `request_type: "lab_collection"`
- Creates new request with `request_type: "results"`
- Status: "acknowledged" (already responded)

---

### Appointment Reschedule

**Patient Message:**
> "I need to reschedule my appointment"

**Handler Response:**
```
Got it! 📅

Your current appointment:
Date: 2026-09-15
Time: 2:00 PM

Please reply with:
• Your preferred date
• Your preferred time

Our team will confirm the new slot!
```

**Database:**
- Finds current confirmed appointment
- Creates patient request with `request_type: "reschedule"`
- Status: "pending" (awaiting patient's new date/time)

---

## Admin Dashboard Features

### Patient Requests Dashboard

**Available at:** `/admin/patient-requests`

Features:
- **Filter by Status:** pending, acknowledged, in progress, resolved
- **Quick View:** Patient name, request type, status
- **Details Panel:** Full request text, notes, assignment, timestamps
- **Assignment:** Drag-and-drop or click to assign to staff
- **Notes:** Add internal notes for team collaboration

Example Workflow:
1. Staff sees "Lab collection" request from Rajesh
2. Click to view details
3. Add note: "Patient prefers weekends"
4. Assign to "Nursing Team"
5. Status changes to "in_progress"
6. Follow up phone call made
7. Status changes to "resolved"

### Message Tracking Dashboard

**Available at:** `/admin/message-tracking`

Features:
- **Statistics:** Sent, delivered, read, failed counts & rates
- **Filters:** By status or direction (incoming/outgoing)
- **Message List:** All messages with status badges
- **Timeline View:** When message was sent/delivered/read
- **Error Details:** Why message failed (if applicable)

Example Workflow:
1. Admin checks dashboard
2. Sees: "Sent: 150, Delivered: 145, Failed: 5"
3. Delivery rate: 96.7%
4. Clicks on failed message
5. Sees error: "Invalid recipient number"
6. Can take corrective action

---

## Keyword Matching Rules

### Exact vs Fuzzy Matching

**Exact Matches:**
```javascript
// These work with exact keywords
"book appointment" → Booking
"help" → Help menu
```

**Regex Matches (Case-Insensitive):**
```javascript
// Advanced handlers use regex for flexibility
/lab|collect|sample|blood|test/ → Lab Collection
/result|report|ready/ → Results
/prescription|medicine|drug|refill|rx/ → Prescription
/bill|invoice|cost|charge|pay|payment/ → Billing
/doctor|specialist|cardiologist|dermatologist/ → Doctor Info
/reschedule|change|different.*time|postpone/ → Reschedule
/status|when|time|appointment.*time|my.*appointment/ → Status
/feedback|complaint|suggest|issue|problem/ → Feedback
```

### Extending Keywords

To add new keywords, update the regex in `advancedMessageHandlers.ts`:

```javascript
// Current
if (lowerText.match(/lab|collect|sample|blood|test|needle|home.*collect/i)) {
  return await handleLabCollectionRequest(...);
}

// Add more keywords
if (lowerText.match(/lab|collect|sample|blood|test|needle|home.*collect|pathology/i)) {
  return await handleLabCollectionRequest(...);
}
```

---

## Configuration

### Environment Variables

```env
WHATSAPP_VERIFY_TOKEN=your_token_here
CLINIC_ID=your_clinic_uuid_here
```

### Admin Settings

Via Admin Dashboard → Webhooks:
- WhatsApp Business Account ID
- Verify Token
- Enable/disable auto-processing
- Enable/disable auto-confirmations

### Database Configuration

Already included in `0015_message_tracking.sql`:
- Messages table with indexes
- Patient requests table with indexes
- Message delivery stats table
- RLS policies for clinic isolation
- All triggers and constraints

---

## Monitoring & Analytics

### Key Metrics

```
Delivery Rate = (total_delivered / total_sent) * 100
Read Rate = (total_read / total_sent) * 100
Failure Rate = (total_failed / total_sent) * 100
```

### Dashboard KPIs

1. **Sent:** Total messages sent today
2. **Delivered:** Messages reached WhatsApp servers
3. **Read:** Messages opened by patients
4. **Failed:** Messages that couldn't be delivered
5. **Delivery %:** Sent vs Delivered rate
6. **Read %:** Sent vs Read rate

### Alerts (Future)

```javascript
// When delivery rate drops below 95%
if (deliveryRate < 95) {
  notifyAdmin("Low delivery rate detected");
}

// When failed messages exceed 10
if (totalFailed > 10) {
  notifyAdmin("Multiple message failures");
}
```

---

## Error Handling

### Message Processing Errors

| Error | Cause | Resolution |
|-------|-------|-----------|
| Patient not found | New patient | Auto-create with phone number |
| Message parsing failed | Malformed JSON | Log and skip |
| Database insert failed | Duplicate/constraint | Log error and retry |
| Network timeout | WhatsApp unavailable | Automatic retry in webhook handler |

### Status Update Errors

| Error | Cause | Resolution |
|-------|-------|-----------|
| Message ID not found | Message from other clinic | Log warning and continue |
| Status update failed | Database error | Log error, alert admin |
| Stats update failed | Calculation error | Continue (non-critical) |

---

## Best Practices

### For Message Handlers

✅ **DO:**
- Always find/create patient first
- Log all requests to database
- Send acknowledgment to patient
- Handle errors gracefully
- Return consistent result format

❌ **DON'T:**
- Assume patient exists
- Send sensitive info in WhatsApp
- Create duplicate requests
- Throw unhandled exceptions

### For Status Processing

✅ **DO:**
- Update all timestamp fields
- Log error details for failed messages
- Update statistics immediately
- Use timezone-aware timestamps

❌ **DON'T:**
- Skip status updates
- Lose error messages
- Update wrong clinic's data
- Create gaps in analytics

### For Admin Features

✅ **DO:**
- Show status badges
- Allow filtering and sorting
- Enable bulk assignment
- Track edit history

❌ **DON'T:**
- Show sensitive patient data
- Allow unauthorized access
- Delete request history
- Mix clinic data

---

## Future Enhancements

### Phase 2 (Planned)

1. **Natural Language Processing**
   - AI-powered intent detection
   - Named entity extraction for dates/times
   - Confidence scoring

2. **Conversation Context**
   - Store message history per patient
   - Multi-turn conversations
   - Context-aware responses

3. **Advanced Analytics**
   - Cohort analysis by request type
   - Patient satisfaction scoring
   - Response time tracking

4. **Automation**
   - Auto-follow-up reminders
   - Auto-escalation for unresolved requests
   - Scheduled message campaigns

### Phase 3 (Roadmap)

- AI chatbot for common queries
- Prescription refill automation
- Bill payment links via WhatsApp
- Appointment reminders
- Patient health updates

---

## Testing

### Manual Testing

**Test Lab Collection:**
```
Send: "Can I book home sample collection?"
Expected: Thanks for interest response + DB entry
```

**Test Status Update:**
```
Message sent to patient
WhatsApp sends delivery callback
Check: Message status updated in database
Check: Delivery stats incremented
```

**Test Admin UI:**
```
Navigate to /admin/patient-requests
Should show all requests with filters
Click on request to view details
Try assigning and adding notes
```

### Automated Testing (Future)

```typescript
describe("Advanced Message Handlers", () => {
  test("handleLabCollectionRequest creates patient request", async () => {
    const result = await handleLabCollectionRequest(...);
    expect(result.success).toBe(true);
  });
});
```

---

## Troubleshooting

### Issue: Messages not being processed

**Check:**
1. Webhook receiving messages? Check `/admin/webhooks` events
2. Advanced handlers matching? Enable debug logs
3. Database inserts working? Check `patient_requests` table

### Issue: Status updates not tracking

**Check:**
1. WhatsApp sending callbacks? Check webhook logs
2. Status processor running? Check for errors
3. Messages table has correct IDs? Check `whatsapp_message_id`

### Issue: Admin UI showing no data

**Check:**
1. RLS policies enabled? Query `information_schema.tables`
2. Clinic ID correct? Check `auth.uid()` context
3. Data exists? Query directly via SQL editor

---

## Configuration Reference

| Setting | Type | Required | Default |
|---------|------|----------|---------|
| WHATSAPP_VERIFY_TOKEN | String | Yes | — |
| CLINIC_ID | UUID | Yes | — |
| Auto-process Bookings | Boolean | No | true |
| Auto-send Confirmations | Boolean | No | true |
| Message Timeout | Milliseconds | No | 30000 |
| Webhook Retry Count | Integer | No | 3 |

---

## Related Documentation

- [WHATSAPP_WEBHOOK_GUIDE.md](./WHATSAPP_WEBHOOK_GUIDE.md) - Core webhook infrastructure
- [Branding System Guide](./BRANDING_SYSTEM_GUIDE.md) - UI components and styling
- [Database Schema](./DATABASE_SCHEMA.md) - Complete schema reference

---

**Last Updated:** September 10, 2026  
**Version:** 2.0  
**Status:** Production Ready  
**Contributors:** Anil Kumar  

🚀 Ready to deploy and use in production!
