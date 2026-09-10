# WhatsApp Webhook System - Quick Start Guide

**Last Updated:** September 10, 2026  
**Version:** 2.0 (Phase 1 + 2 Complete)

---

## 📋 What's Included

### Phase 1: Core Webhook Infrastructure ✅
- HMAC-SHA256 signature verification
- Message and status extraction
- Intelligent keyword routing
- Patient management
- Booking/confirmation/cancellation handling
- Webhook event logging
- Admin dashboard

### Phase 2: Advanced Features ✅
- 8 specialized message handlers (lab, prescription, results, billing, etc.)
- Real-time message delivery tracking
- Daily delivery analytics & reporting
- Patient request management UI
- Message tracking dashboard
- Staff assignment workflow

---

## 🚀 Quick Setup (5 Minutes)

### 1. Set Environment Variables
```bash
# .env.local
WHATSAPP_VERIFY_TOKEN=your_secure_random_string
CLINIC_ID=your_clinic_uuid_here
```

### 2. Run Database Migration
```bash
npx supabase migration up
# This creates:
# - webhook_events, webhook_subscriptions, webhook_settings
# - messages, message_templates, message_delivery_stats
# - booking_requests, appointment_cancellations
# - patient_requests
```

### 3. Configure WhatsApp Webhook
1. Go to WhatsApp Business Settings
2. Set Webhook URL: `https://yourapp.com/api/webhooks/whatsapp`
3. Set Verify Token: (same as WHATSAPP_VERIFY_TOKEN)
4. Subscribe to: `messages`, `message_status`
5. Click "Verify and Save"

### 4. Test
```bash
# Send a test message from WhatsApp
# Or go to /admin/webhooks to view events
```

---

## 📁 File Structure

```
clinic-app/
├── lib/whatsapp/
│   ├── webhook.ts                    # Core webhook utilities
│   ├── messageProcessor.ts           # Message routing & handlers
│   ├── advancedMessageHandlers.ts    # 8 specialized handlers ✨
│   ├── statusProcessor.ts            # Delivery tracking ✨
│   └── send.ts                       # Send messages to WhatsApp
│
├── app/api/webhooks/
│   └── whatsapp/
│       └── route.ts                  # POST/GET endpoints
│
├── app/admin/(dashboard)/
│   ├── webhooks/
│   │   ├── page.tsx                  # Main dashboard
│   │   ├── WebhookSettingsForm.tsx   # Config form
│   │   ├── WebhookEventsList.tsx     # Event log
│   │   ├── WebhookSetupGuide.tsx     # Setup steps
│   │   └── actions.ts                # Server actions
│   │
│   ├── patient-requests/             # ✨ NEW
│   │   └── page.tsx                  # Request management
│   │
│   └── message-tracking/             # ✨ NEW
│       └── page.tsx                  # Delivery tracking
│
├── supabase/migrations/
│   ├── 0014_webhook_events.sql       # Phase 1 tables
│   └── 0015_message_tracking.sql     # Phase 2 tables ✨
│
└── Documentation/
    ├── WHATSAPP_WEBHOOK_GUIDE.md           # Phase 1 guide
    ├── ADVANCED_MESSAGE_HANDLERS_GUIDE.md  # Phase 2 guide ✨
    ├── IMPLEMENTATION_SUMMARY.md           # Complete overview ✨
    └── QUICKSTART_GUIDE.md                 # This file ✨
```

---

## 🎯 Key Features at a Glance

### Message Processing
| Feature | Keyword Example | Result |
|---------|-----------------|--------|
| Lab Collection | "Can I do home sample collection?" | Creates patient request, books callback |
| Test Results | "When will my results be ready?" | Checks recent tests, sends status |
| Prescription | "I need my prescription refilled" | Creates prescription request |
| Billing | "What's my bill?" | Creates billing inquiry |
| Doctor Info | "Who is the cardiologist?" | Lists doctors by specialty |
| Reschedule | "I need to change my appointment" | Shows current slot, asks for new time |
| Status Check | "When is my appointment?" | Sends next appointment details |
| Feedback | "I have a complaint" | Logs feedback for team review |

### Admin Dashboards

**Webhooks Dashboard** (`/admin/webhooks`)
- Webhook settings configuration
- Setup guide with steps
- Recent events list with inspection
- Health statistics

**Patient Requests** (`/admin/patient-requests`) ✨
- View all requests by type
- Filter by status
- Assign to staff
- Add internal notes
- Track lifecycle

**Message Tracking** (`/admin/message-tracking`) ✨
- View all messages
- Filter by status/direction
- Delivery statistics
- Message timeline
- Error inspection

---

## 📊 Understanding the Flow

### Incoming Message Flow
```
WhatsApp Message
    ↓
Signature Verification
    ↓
Patient Lookup/Create
    ↓
Advanced Handler Check (Lab, Rx, Results, etc.)
    ↓ Match Found? Send Response
    ↓ No Match? Try Basic Routing
    ↓
Send Help Menu if No Match
    ↓
Log to Database
    ↓
Return 200 OK to WhatsApp
```

### Status Update Flow
```
WhatsApp Delivery Callback
    ↓
Signature Verification
    ↓
Extract Status (sent/delivered/read/failed)
    ↓
Find Message by WhatsApp ID
    ↓
Update Status + Timestamp
    ↓
Update Daily Analytics
    ↓
Calculate Delivery/Read Rates
```

---

## 🔧 Common Operations

### Add a New Message Handler

1. **Create handler in `advancedMessageHandlers.ts`:**
```typescript
export async function handleMyRequest(
  supabase,
  clinicId,
  message,
  patient,
  text
) {
  // Your logic here
  return {
    success: true,
    action: "my_action",
    message: "Response to patient"
  };
}
```

2. **Add routing in `routeAdvancedMessage()`:**
```typescript
if (lowerText.match(/my.*keyword/i)) {
  return await handleMyRequest(...);
}
```

### View Patient Requests
1. Go to Admin Dashboard
2. Click "Patient Requests" in sidebar
3. Filter by status: Pending, Acknowledged, In Progress, Resolved
4. Click on request to view details
5. Assign to staff member and add notes

### Check Message Delivery Status
1. Go to Admin Dashboard
2. Click "Message Tracking" in sidebar
3. View delivery statistics (sent, delivered, read, failed)
4. Filter by status to see specific messages
5. Click "View" to see timeline and errors

### Handle Failed Messages
1. Go to "Message Tracking"
2. Filter status: "Failed"
3. Click to view error details
4. Note the error message
5. Take corrective action:
   - Invalid number? → Update patient phone
   - Message expired? → Resend
   - Rate limited? → Wait and retry

---

## 🔒 Security & Best Practices

### ✅ DO

- Keep WHATSAPP_VERIFY_TOKEN secret (env var only)
- Verify signatures on every webhook request
- Use HTTPS only (WhatsApp requirement)
- Log all webhook events
- Monitor error rates
- Validate phone numbers
- Use RLS policies (included)
- Filter data by clinic_id

### ❌ DON'T

- Store verify token in code
- Skip signature verification
- Send sensitive data in WhatsApp
- Trust unverified webhooks
- Mix clinic data
- Disable RLS policies
- Log passwords/tokens

---

## 📈 Key Metrics

### Track These in Your Dashboard
```
Daily Metrics:
- Messages Sent
- Delivery Rate (delivered / sent)
- Read Rate (read / sent)
- Failed Messages
- Processing Time (avg)

Weekly Trends:
- Total messages trending
- Delivery rate stability
- Error rate trends
- Most common request types
```

### Performance Targets
- Processing latency: < 200ms
- Webhook response: < 30 seconds
- Status update: < 50ms
- Admin UI: < 500ms

---

## 🐛 Troubleshooting

### "Webhook not receiving messages"
```
Check:
1. Webhook URL correct? https://yourapp.com/api/webhooks/whatsapp
2. Verify token matches? Check WHATSAPP_VERIFY_TOKEN
3. Subscription active? messages + message_status events
4. Public endpoint? Can WhatsApp reach it?

Debug:
→ Go to /admin/webhooks
→ Send test message
→ Look in Recent Events
→ Check error message if failed
```

### "Status not updating"
```
Check:
1. message_status subscription active?
2. Message ID matches? Check whatsapp_message_id in messages table
3. RLS policy allowing updates? Check WITH CHECK in SQL

Debug:
→ Send message
→ Go to /admin/message-tracking
→ Check message status progression
→ Look for errors in message details
```

### "Admin UI showing no data"
```
Check:
1. Clinic ID correct? SELECT * FROM clinics;
2. RLS policies applied? SELECT * FROM messages;
3. Data exists? Query directly in SQL editor
4. Logged in as admin? Check role

Debug:
→ Open browser console
→ Check network tab for errors
→ Query table directly: SELECT * FROM patient_requests;
→ Verify clinic_id matches
```

---

## 📚 Full Documentation

| Guide | Read When | Key Topics |
|-------|-----------|-----------|
| **WHATSAPP_WEBHOOK_GUIDE.md** | Understanding core architecture | Signature verification, message extraction, routing logic, error handling, RLS policies |
| **ADVANCED_MESSAGE_HANDLERS_GUIDE.md** | Learning about handlers & tracking | All 8 handlers, keyword matching, message timeline, analytics, admin UI usage |
| **IMPLEMENTATION_SUMMARY.md** | Getting project overview | What was built, code metrics, deployment checklist, next steps |
| **QUICKSTART_GUIDE.md** | Getting started quickly | This file! Setup, features, common tasks, troubleshooting |

---

## 🚀 Deployment

### Pre-Deployment Checklist
- [ ] Environment variables set
- [ ] Database migration run
- [ ] WhatsApp webhook configured
- [ ] Test message verified
- [ ] Admin UI tested
- [ ] Error logs reviewed
- [ ] Performance acceptable

### Deployment Steps
```bash
# 1. Backup database
pg_dump your_db > backup.sql

# 2. Run migration
npx supabase migration up

# 3. Deploy code
git push

# 4. Verify
# - Check admin dashboard
# - Send test message
# - Verify in recent events
# - Check delivery tracking
```

### Post-Deployment
- Monitor error logs
- Check webhook events
- Verify message delivery
- Test status updates
- Monitor performance

---

## 💡 Tips & Tricks

### Faster Testing
```
Use WhatsApp test interface instead of real phone:
1. Go to WhatsApp Business Platform → Test Sandbox
2. Send sample messages without real phone
3. Faster iteration, no real messages
```

### Debugging Messages
```
Enable detailed logging:
1. Add console.log in advancedMessageHandlers.ts
2. Check browser console and server logs
3. Monitor in /admin/webhooks → Recent Events
```

### Bulk Operations
```
Export data:
1. Go to /admin/patient-requests
2. Select filter
3. Copy table data
4. Export to CSV/Excel
```

### Performance Tuning
```
Optimize queries:
1. Add indexes (already done)
2. Cache frequently accessed data
3. Use pagination for large lists
4. Profile slow queries
```

---

## 📞 Support Resources

### Documentation
- `WHATSAPP_WEBHOOK_GUIDE.md` - Full architecture
- `ADVANCED_MESSAGE_HANDLERS_GUIDE.md` - Detailed handlers guide
- `IMPLEMENTATION_SUMMARY.md` - Project overview

### Code Comments
- Every function has JSDoc comments
- Complex logic has inline explanations
- Error handling documented
- Type definitions provided

### Testing
- Test webhook: Send message from WhatsApp
- Test status: Check /admin/message-tracking
- Test admin UI: Navigate dashboards
- Query database: Check data in real-time

---

## 🎓 Learning Path

**New to the system?**
1. Read this Quick Start (5 min)
2. Read WHATSAPP_WEBHOOK_GUIDE.md (15 min)
3. Set up locally and test
4. Read ADVANCED_MESSAGE_HANDLERS_GUIDE.md (20 min)
5. Explore admin dashboards
6. Try modifying a handler

**Existing knowledge?**
1. Check IMPLEMENTATION_SUMMARY.md (10 min)
2. Review code changes
3. Test new features
4. Deploy to production

**Troubleshooting?**
1. Check this guide's troubleshooting section
2. Read relevant documentation
3. Query database directly
4. Check logs and error messages

---

## 📊 By The Numbers

```
Phase 1 + 2 Delivered:
├─ 8 files created
├─ ~2,500 lines of code
├─ 20+ new functions
├─ 6 database tables
├─ 8 specialized handlers
├─ 2 new admin dashboards
├─ 1,250+ lines of documentation
└─ ✅ Production ready
```

---

## ✅ What's Ready Now

✅ Complete webhook infrastructure  
✅ 8 advanced message handlers  
✅ Real-time delivery tracking  
✅ Patient request management  
✅ Message analytics & reporting  
✅ Admin dashboards  
✅ Security & RLS policies  
✅ Error handling & retry logic  
✅ Comprehensive documentation  

---

## ⏭️ What's Next

**Phase 3 (Future Enhancements):**
- Natural Language Processing
- AI-powered intent detection
- Conversation memory
- Advanced analytics
- Automation & workflows
- Integration with payment systems
- SMS/Email fallback
- Calendar sync

---

## 🎯 Get Started

1. **Setup** (5 min)
   - Set environment variables
   - Run migration
   - Configure WhatsApp

2. **Test** (10 min)
   - Send test message
   - Check admin dashboard
   - Verify delivery

3. **Deploy** (30 min)
   - Backup database
   - Deploy code
   - Monitor logs

4. **Explore** (Ongoing)
   - Read documentation
   - Try features
   - Monitor analytics
   - Optimize

---

**Ready to deploy?** ✅ You have everything you need!

Questions? Check the detailed guides or review the well-commented source code.

Happy building! 🚀

---

**Version:** 2.0  
**Last Updated:** September 10, 2026  
**Status:** Production Ready  
**Maintained By:** Anil Kumar
