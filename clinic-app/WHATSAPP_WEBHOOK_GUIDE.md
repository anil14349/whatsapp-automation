# WhatsApp Webhook Infrastructure Guide

**Date:** September 10, 2026  
**Status:** ✅ Complete  
**Components:** 8 files  
**Database:** 3 new tables with RLS policies

---

## Overview

This guide explains the WhatsApp webhook infrastructure built for the clinic SaaS system. Webhooks enable real-time processing of incoming messages and status updates from the WhatsApp Cloud API.

---

## Architecture

### 🏗️ System Flow

```
WhatsApp Cloud API
        ↓
   (HTTPS POST)
        ↓
/api/webhooks/whatsapp
        ↓
   [Signature Verification]
        ↓
   [Extract Messages & Statuses]
        ↓
   [Log to Database]
        ↓
[Process Message / Update Status]
        ↓
[Send Response to WhatsApp]
        ↓
[Update Database Records]
```

---

## Database Schema

### 1. webhook_events
Logs all incoming webhook events for auditing and debugging.

```sql
CREATE TABLE webhook_events (
  id UUID PRIMARY KEY,
  clinic_id UUID NOT NULL,
  source VARCHAR(50),        -- 'whatsapp', 'razorpay', etc.
  event_type VARCHAR(100),   -- 'message', 'payment', etc.
  payload JSONB,             -- Full webhook payload
  status VARCHAR(20),        -- 'pending', 'processed', 'failed', 'retrying'
  retry_count INT,           -- Number of retry attempts
  error_message TEXT,        -- Error details if failed
  processed_at TIMESTAMP,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

### 2. webhook_subscriptions
Manages which webhooks a clinic subscribes to.

```sql
CREATE TABLE webhook_subscriptions (
  id UUID PRIMARY KEY,
  clinic_id UUID NOT NULL,
  webhook_url VARCHAR(500),
  events VARCHAR[],          -- ['message', 'message_status']
  is_active BOOLEAN,
  last_triggered_at TIMESTAMP,
  failure_count INT,
  last_error TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

### 3. webhook_settings
Stores clinic-specific webhook configuration.

```sql
CREATE TABLE webhook_settings (
  id UUID PRIMARY KEY,
  clinic_id UUID UNIQUE NOT NULL,
  whatsapp_verify_token VARCHAR(500),
  whatsapp_business_account_id VARCHAR(100),
  whatsapp_webhook_enabled BOOLEAN,
  auto_process_bookings BOOLEAN,
  auto_send_confirmations BOOLEAN,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

---

## Files Created

### 1. Database Migration
**File:** `supabase/migrations/0014_webhook_events.sql`

Creates:
- `webhook_events` table
- `webhook_subscriptions` table
- `webhook_settings` table
- Indexes for performance
- RLS policies for security
- Webhook columns on appointments table

### 2. Webhook Utilities
**File:** `lib/whatsapp/webhook.ts`

Core functions:
- `verifyWhatsAppSignature()` - HMAC SHA256 verification
- `extractMessages()` - Parse incoming messages
- `extractStatuses()` - Parse message delivery statuses
- `logWebhookEvent()` - Database logging
- `getWebhookSettings()` - Fetch clinic settings
- `normalizePhoneNumber()` - Standardize phone numbers

### 3. Message Processor
**File:** `lib/whatsapp/messageProcessor.ts`

Handles different message types:
- Text messages with keyword routing
- Media messages (audio, image, video, document)
- Location messages
- Button and interactive messages
- Appointment booking requests
- Confirmation/cancellation requests
- Help menu requests

**Key Functions:**
- `processIncomingMessage()` - Main entry point
- `handleBookingRequest()` - Parse and create bookings
- `handleConfirmation()` - Process confirmations
- `handleCancellation()` - Handle cancellations
- `handleHelpRequest()` - Send menu
- `retryFailedWebhook()` - Retry logic

### 4. Webhook Route Handler
**File:** `app/api/webhooks/whatsapp/route.ts`

HTTP Endpoints:
- **GET** - Webhook verification (handshake)
- **POST** - Receive messages and statuses
- **OPTIONS** - CORS handling

Features:
- Signature verification
- Async message processing
- 30-second timeout handling
- Event logging
- Error handling

### 5. Admin UI Pages
**File:** `app/admin/(dashboard)/webhooks/page.tsx`

Main dashboard showing:
- Setup guide
- Webhook settings form
- Recent events table
- Health statistics
- Test webhook button

### 6. Settings Form Component
**File:** `app/admin/(dashboard)/webhooks/WebhookSettingsForm.tsx`

Form inputs:
- WhatsApp Business Account ID
- Verify Token (password field)
- Enable/disable webhooks
- Auto-process bookings toggle
- Auto-send confirmations toggle

### 7. Setup Guide Component
**File:** `app/admin/(dashboard)/webhooks/WebhookSetupGuide.tsx`

Step-by-step guide:
1. Create WhatsApp Business Account
2. Get credentials
3. Configure webhook
4. Test connection

### 8. Server Actions
**File:** `app/admin/(dashboard)/webhooks/actions.ts`

`updateWebhookSettingsAction()` - Updates webhook configuration in database

---

## How It Works

### 1. Webhook Verification (GET)
```
WhatsApp Cloud API sends:
GET /api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=xxx&hub.challenge=yyy

Your app responds:
200 OK
Body: yyy (the challenge value)

WhatsApp verifies and enables webhook.
```

### 2. Incoming Message (POST)
```
WhatsApp Cloud API sends:
POST /api/webhooks/whatsapp
X-Hub-Signature-256: sha256=<hash>
Body: {
  "object": "whatsapp_business_account",
  "entry": [{
    "changes": [{
      "value": {
        "messages": [{
          "from": "919876543210",
          "type": "text",
          "text": {"body": "Book appointment tomorrow 2 PM"},
          "id": "wamid.xxx",
          "timestamp": "1234567890"
        }]
      }
    }]
  }]
}

Your app:
1. Verifies signature using WHATSAPP_VERIFY_TOKEN
2. Extracts message data
3. Logs event to webhook_events table
4. Processes message (parse intent, create booking, etc.)
5. Sends confirmation to patient via WhatsApp
6. Marks event as "processed"
7. Returns 200 OK immediately
```

### 3. Message Processing Flow
```
Extract text: "Book appointment tomorrow 2 PM"
    ↓
Find/create patient from phone number
    ↓
Route based on keywords:
  - "book/appointment" → handleBookingRequest()
  - "confirm/yes" → handleConfirmation()
  - "cancel" → handleCancellation()
  - else → handleHelpRequest()
    ↓
Each handler:
  - Parse details
  - Update database
  - Send WhatsApp response
  - Return success/error
    ↓
Log result to webhook_events
```

---

## Setup Instructions

### Step 1: Set Environment Variable
Add to `.env.local`:
```
WHATSAPP_VERIFY_TOKEN=your_secure_random_token_here
CLINIC_ID=your_clinic_uuid_here
```

### Step 2: Run Migration
```bash
npx supabase migration up
```

This creates the three new tables and RLS policies.

### Step 3: WhatsApp Business Setup
1. Go to [developers.facebook.com](https://developers.facebook.com)
2. Create WhatsApp Business Account
3. Create an app and add WhatsApp product
4. Get your:
   - Access Token
   - Business Account ID
   - Phone Number ID

### Step 4: Configure Webhook
1. Go to Admin Dashboard → Webhooks
2. Fill in WhatsApp Business Account ID
3. Enter your Verify Token (same as environment variable)
4. Copy the Webhook URL displayed
5. In WhatsApp Business Settings → Webhooks:
   - Paste Webhook URL
   - Paste Verify Token
   - Subscribe to:
     - `messages` event
     - `message_status` event
   - Click "Verify and Save"

### Step 5: Test
1. Send a test message from WhatsApp
2. Check Admin Dashboard → Webhooks → Recent Events
3. You should see your message logged with status "processed"

---

## Message Routing

### Supported Message Types

| Type | Handler | Example |
|------|---------|---------|
| Text | Route by keywords | "Book appointment" |
| Media | Media handler | Image, audio, video |
| Location | Location handler | GPS coordinates |
| Button | Button reply handler | Pre-defined buttons |
| Interactive | Interactive handler | List menus |

### Keyword Routing

```
"book" / "appointment" → handleBookingRequest()
"confirm" / "yes" → handleConfirmation()
"cancel" → handleCancellation()
"help" / "menu" → handleHelpRequest()
<media> → handleMediaMessage()
<default> → Send help menu
```

---

## Error Handling & Retries

### Automatic Retries
- Max 3 retry attempts per webhook event
- Triggered if processing fails
- Status: `pending` → `retrying` → `processed` or `failed`

### Failure Handling
```
1. Process message
2. If error:
   - Log error message
   - Increment retry_count
   - Set status to "retrying"
   - Schedule retry
3. If max retries exceeded:
   - Set status to "failed"
   - Log final error
   - Alert admin (optional)
```

### Monitoring
Check Admin Dashboard for:
- Failed events (status = "failed")
- Retry attempts (retry_count > 0)
- Error messages in event details

---

## Security

### Signature Verification
Every incoming webhook is signed by WhatsApp using HMAC-SHA256:

```
signature = "sha256=" + HMAC-SHA256(body, VERIFY_TOKEN)
```

Your app verifies this to ensure:
- Request is from WhatsApp
- Request has not been tampered with
- Request is authentic

### RLS Policies
All webhook tables have Row-Level Security:
- Users only see webhooks for their clinic
- Only admins can modify settings
- Automatic clinic_id filtering in queries

### Best Practices
1. ✅ Keep VERIFY_TOKEN secret (store in env only)
2. ✅ Use HTTPS only (WhatsApp requirement)
3. ✅ Verify signatures on every request
4. ✅ Log all webhook events for debugging
5. ✅ Monitor failed events
6. ✅ Set up alerts for high error rates

---

## Limitations & Future Enhancements

### Current Limitations
- Single clinic per webhook endpoint (env-based CLINIC_ID)
- Manual retry handling (no background jobs yet)
- Basic keyword routing (no NLP)
- No message persistence

### Future Enhancements
1. **Multiple Clinics Per Endpoint**
   - Look up clinic from phone number
   - Support multiple webhooks

2. **Async Job Queue**
   - Use BullMQ or similar
   - Background processing for heavy tasks

3. **Natural Language Processing**
   - AI-powered intent detection
   - Better booking extraction

4. **Message History**
   - Store all messages in database
   - Build conversation context

5. **Delivery Reports**
   - Track message delivery status
   - Handle failed/expired messages

6. **Webhook Subscriptions**
   - Let clinics subscribe/unsubscribe from events
   - Custom webhook URLs

---

## Troubleshooting

### Webhook Not Receiving Messages
1. Check WHATSAPP_VERIFY_TOKEN matches WhatsApp settings
2. Verify webhook URL is correct and publicly accessible
3. Check webhook_events table for any "failed" events
4. Review error messages in event details

### Messages Failing to Process
1. Check webhook_events for status = "failed"
2. Review error_message in event details
3. Verify clinic_id is correct
4. Check patient lookup is working

### Signature Verification Failing
1. Ensure WHATSAPP_VERIFY_TOKEN matches WhatsApp settings exactly
2. Verify token hasn't been rotated
3. Check logs for signature mismatch errors

---

## Testing

### Manual Test
1. Send message from real WhatsApp
2. Check Admin Dashboard → Webhooks
3. Click on event to view payload

### Curl Test
```bash
curl -X POST http://localhost:3000/api/webhooks/whatsapp \
  -H "X-Hub-Signature-256: sha256=test_signature" \
  -H "Content-Type: application/json" \
  -d '{"object":"whatsapp_business_account","entry":[...]}'
```

### WhatsApp Test Interface
Use WhatsApp Business API's test message feature to send sample messages without a real phone number.

---

## Configuration Reference

| Setting | Environment | Type | Required |
|---------|-------------|------|----------|
| Verify Token | `WHATSAPP_VERIFY_TOKEN` | String | Yes |
| Clinic ID | `CLINIC_ID` | UUID | Yes |
| Business Account ID | Form Input | String | No |
| Auto-process Bookings | Form Toggle | Boolean | No |
| Auto-send Confirmations | Form Toggle | Boolean | No |

---

## Next Steps

1. ✅ Run database migration
2. ✅ Set environment variables
3. ✅ Configure webhook in WhatsApp Business
4. ✅ Test with real message
5. ⏳ Monitor for production issues
6. ⏳ Add advanced features (NLP, history, etc.)

---

**Last Updated:** September 10, 2026  
**Version:** 1.0  
**Status:** Production Ready
