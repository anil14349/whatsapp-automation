# Message Processor Integration Guide

**Date:** September 14, 2026  
**Status:** ✅ COMPLETE - All handlers integrated  
**Last Updated:** Phase 3 Part 4  

---

## Overview

The Message Processor is the central router that connects the WhatsApp webhook to the three conversation handlers (Patient, Doctor, Home Collection). It handles:

1. Session management (get/create/update)
2. Message routing by user role
3. Greeting detection and reset
4. Error handling and recovery
5. Handler delegation

---

## Architecture Diagram

```
WhatsApp Webhook (webhook/index.ts)
    ↓
    POST /webhook
    ↓
handleInboundMessage()
    ↓
processMessage()  ← Message Processor
    ↓
    ├─ Greeting? → Reset to LANGUAGE_SELECT
    │
    ├─ role = DOCTOR
    │   └─ handleDoctorMessage()
    │       └─ new DoctorFlowHandler().handle()
    │
    ├─ role = HOME_COLLECTION_PERSON
    │   └─ handleHomeCollectionMessage()
    │       └─ new HomeCollectionHandler().handle()
    │
    └─ role = PATIENT (default)
        └─ handlePatientMessage()
            └─ new PatientFlowHandler().handle()
```

---

## File Structure

```
supabase/functions/
├── webhook/
│   └── index.ts                    # Entry point
│
├── shared/
│   ├── message-processor.ts        # 🔴 Central Router (THIS FILE)
│   ├── types.ts                    # Type definitions
│   ├── whatsapp-client.ts          # WhatsApp API client
│   ├── validators.ts               # Input validation
│   ├── logger.ts                   # Logging
│   ├── google-sheets.ts            # Sheet integration
│   ├── google-calendar.ts          # Calendar integration
│   ├── appointments.ts             # Business logic
│   │
│   └── handlers/
│       ├── patient-handler.ts      # Patient flow (14 states)
│       ├── doctor-handler.ts       # Doctor flow (8 states)
│       └── home-collection-handler.ts  # Collection flow (4 states)
```

---

## Key Functions

### 1. Main Router: `processMessage()`

**Purpose:** Entry point for all incoming messages

**Signature:**
```typescript
async function processMessage(
    supabase: SupabaseClient,
    whatsappClient: WhatsAppClient,
    context: ProcessMessageContext
): Promise<void>
```

**Parameters:**
- `supabase` - Database client
- `whatsappClient` - WhatsApp API client
- `context` - Message context (phone, name, text, type, latitude, longitude)

**Flow:**
1. Get or create session
2. Check if greeting
3. Route by user role
4. Each handler updates session and sends response

**Called From:** `webhook/index.ts` → `handleInboundMessage()`

---

### 2. Session Manager: `getOrCreateSession()`

**Purpose:** Get existing session or create new one for phone number

**Signature:**
```typescript
async function getOrCreateSession(
    supabase: SupabaseClient,
    phone: string
): Promise<WhatsAppSession>
```

**Behavior:**
- If session exists: Update `updated_at`, return it
- If not: Create new session with:
  - `role: "PATIENT"` (default)
  - `state: "LANGUAGE_SELECT"`
  - Empty `data` and `metadata`
  - `expires_at: 24 hours from now` (TTL for cleanup)

**Error Handling:** Returns default session if database fails (graceful degradation)

---

### 3. Session Updater: `updateSession()`

**Purpose:** Update session state, data, or role

**Signature:**
```typescript
async function updateSession(
    supabase: SupabaseClient,
    phone: string,
    updates: {
        state?: string;
        data?: Record<string, any>;
        metadata?: Record<string, any>;
        role?: string;
    }
): Promise<void>
```

**Behavior:**
- Performs SQL UPDATE on `whatsapp_sessions` table
- Always updates `updated_at` timestamp
- Silently fails on database errors (logged via logger.ts)

**Called From:** Every handler when transitioning states

---

### 4. Greeting Handler: `handleGreeting()`

**Purpose:** Reset conversation when user sends greeting

**Signature:**
```typescript
async function handleGreeting(
    supabase: SupabaseClient,
    whatsappClient: WhatsAppClient,
    phone: string,
    session: WhatsAppSession
): Promise<void>
```

**Behavior:**
- Sets state back to `LANGUAGE_SELECT`
- Clears session data
- Sends welcome message with language options
- Used by: Patient starting over, doctor logging in, anyone lost in flow

**Greeting Phrases Detected:**
- "hi", "hello", "hey", "start"
- "हेलो", "नमस्ते" (Hindi)

---

### 5. Role-Based Routers

#### 5.1 `handleDoctorMessage()`

**Purpose:** Route doctor messages to DoctorFlowHandler

**Signature:**
```typescript
async function handleDoctorMessage(
    supabase: SupabaseClient,
    whatsappClient: WhatsAppClient,
    phone: string,
    name: string,
    text: string,
    normalizedMessage: string,
    session: WhatsAppSession
): Promise<void>
```

**Behavior:**
1. Create ExtractedMessage object
2. Instantiate `new DoctorFlowHandler(supabase, whatsappClient)`
3. Call `handler.handle(session, message)`
4. Catch errors and send user-friendly response

**Handles:**
- PIN authentication
- Availability management
- Leave applications
- Appointment viewing
- Portal logout

---

#### 5.2 `handleHomeCollectionMessage()`

**Purpose:** Route home collection messages to HomeCollectionHandler

**Signature:**
```typescript
async function handleHomeCollectionMessage(
    supabase: SupabaseClient,
    whatsappClient: WhatsAppClient,
    phone: string,
    name: string,
    text: string,
    normalizedMessage: string,
    session: WhatsAppSession
): Promise<void>
```

**Behavior:**
1. Create ExtractedMessage object
2. Instantiate `new HomeCollectionHandler(supabase, whatsappClient)`
3. Call `handler.handle(session, message)`
4. Catch errors and send response

**Handles:**
- Location input (GPS/text)
- Location verification
- Request submission
- Status tracking

---

#### 5.3 `handlePatientMessage()`

**Purpose:** Route patient messages to PatientFlowHandler (default role)

**Signature:**
```typescript
async function handlePatientMessage(
    supabase: SupabaseClient,
    whatsappClient: WhatsAppClient,
    phone: string,
    name: string,
    text: string,
    normalizedMessage: string,
    session: WhatsAppSession,
    latitude?: number,
    longitude?: number
): Promise<void>
```

**Behavior:**
1. Create ExtractedMessage object (includes location if provided)
2. Instantiate `new PatientFlowHandler(supabase, whatsappClient)`
3. Call `handler.handle(session, message)`
4. Catch errors and send response

**Special:** Passes latitude/longitude for future location-based features

**Handles:**
- Language selection
- Doctor browsing
- Appointment booking
- Appointment management (view/cancel/reschedule)

---

## Message Flow Sequence

### Step 1: Webhook Reception (webhook/index.ts)
```
POST /webhook
Body: {
  "entry": [{
    "messaging": [{
      "sender": { "id": "919876543210" },
      "message": {
        "text": "Book appointment",
        "message_id": "wamid.xxx"
      }
    }]
  }]
}
```

### Step 2: Message Extraction (webhook/index.ts)
```
extractInboundMessage() →
{
  type: "text",
  text: "book appointment",
  phone: "919876543210"
}
```

### Step 3: Deduplication (webhook/index.ts)
```
Check message_dedup table
If exists: Skip processing
Else: Proceed
```

### Step 4: Processor Entry (message-processor.ts)
```
processMessage(supabase, whatsappClient, {
  senderPhone: "919876543210",
  senderName: "John Doe",
  messageText: "Book appointment",
  messageType: "text"
})
```

### Step 5: Session Retrieval
```
getOrCreateSession()
  ↓
SELECT * FROM whatsapp_sessions WHERE phone='919876543210'
  ↓
Returns: {
  id: "uuid-xxx",
  phone: "919876543210",
  role: "PATIENT",
  state: "LANGUAGE_SELECT",
  data: {}
}
```

### Step 6: Greeting Check
```
isGreeting("book appointment") → false
(Continue to handler routing)
```

### Step 7: Role Routing
```
session.role = "PATIENT"
  ↓
Call handlePatientMessage()
  ↓
new PatientFlowHandler(supabase, whatsappClient)
  ↓
handler.handle(session, {type:"text", text:"Book appointment"})
```

### Step 8: Handler Processing (patient-handler.ts)
```
PatientFlowHandler.handle(session, message)
  ↓
Match on session.state
  state = "LANGUAGE_SELECT"
  ↓
await handleLanguageSelect(phone, message, session)
  ↓
User chose option 1 (English)
  ↓
updateSession(phone, "MAIN_MENU", {language: "EN"})
sendTextMessage(phone, "Choose: 1=Book, 2=View...")
```

### Step 9: Session Update (Supabase)
```
UPDATE whatsapp_sessions SET
  state='MAIN_MENU',
  data='{language:"EN"}',
  updated_at='2026-09-14T...'
WHERE phone='919876543210'
```

### Step 10: Response to WhatsApp
```
sendTextMessage() →
POST /messages endpoint
Body: {
  "messaging_product": "whatsapp",
  "to": "919876543210",
  "type": "text",
  "text": {
    "body": "Choose: 1=Book, 2=View..."
  }
}
```

### Step 11: Webhook Return
```
Return 200 OK to WhatsApp
(Acknowledge webhook)
```

---

## State Transition Examples

### Example 1: Patient Booking Flow

```
User sends: "hi"
  ↓
isGreeting("hi") = true
  ↓
handleGreeting() → state: LANGUAGE_SELECT
  ↓
sendTextMessage: "Select language: 1=EN, 2=HI"

User sends: "1"
  ↓
handlePatientMessage() → state: LANGUAGE_SELECT
  ↓
PatientFlowHandler.handleLanguageSelect()
  ↓
updateSession(phone, "MAIN_MENU", {language: "EN"})

User sends: "1" (Book)
  ↓
state: MAIN_MENU
  ↓
PatientFlowHandler.handleMenu()
  ↓
updateSession(phone, "BOOK_DOCTOR")

User sends: "D001"
  ↓
state: BOOK_DOCTOR
  ↓
PatientFlowHandler.handleBookDoctor()
  ↓
updateSession(phone, "BOOK_DATE", {doctorId: "D001"})

...continues through BOOK_TIME → BOOK_NAME → BOOK_CONFIRM
```

### Example 2: Doctor Authentication

```
User sends: "start"
  ↓
session.role detected as DOCTOR (phone matches doctors table)
  ↓
isGreeting("start") = true
  ↓
handleGreeting() → state: DOCTOR_LOGIN

User sends: "1234"
  ↓
state: DOCTOR_LOGIN
  ↓
handleDoctorMessage() → DoctorFlowHandler
  ↓
DoctorFlowHandler.handleLogin()
  ↓
Verify PIN "1234" == DOCTOR_PORTAL_PIN ✓
Fetch doctor from sheets
  ↓
updateSession(phone, "DOCTOR_MENU", {doctorId: "D001", authenticated: true})

User sends: "1" (Availability)
  ↓
state: DOCTOR_MENU
  ↓
DoctorFlowHandler.handleMenu()
  ↓
updateSession(phone, "DOCTOR_AVAILABILITY")
```

---

## Error Handling

### Error in Handler

```
try {
    handler.handle(session, message)
} catch (error) {
    // Log error
    debug("handleXxxMessage", "Error in flow", {
        error: error.message
    })
    
    // Send user-friendly message
    sendTextMessage(phone, "Sorry, an error occurred. Please try again later.")
    
    // Session state preserved (no rollback)
}
```

### Database Failures

```
updateSession(phone, newState)
  ↓
Database error
  ↓
catch { console.error() }  // Logged but not thrown
  ↓
User doesn't know error happened
  ↓
Next message retrieves old state from database
  ↓
Conversation continues with old state
```

**Note:** This is acceptable for this use case because:
- Sessions stored in database (not memory)
- Retry on next message will fix state
- No data loss occurs

---

## Deployment Considerations

### Environment Variables
- `DOCTOR_PORTAL_PIN` - Pin for doctor authentication
- `GOOGLE_SHEETS_SPREADSHEET_ID` - Sheet ID
- `GOOGLE_SERVICE_ACCOUNT_EMAIL` - Service account
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` - Service account key
- `WHATSAPP_WEBHOOK_POST_TOKEN` - Webhook token
- `WHATSAPP_VERIFY_TOKEN` - Verification token
- `WHATSAPP_API_TOKEN` - WhatsApp API token
- `WHATSAPP_PHONE_NUMBER_ID` - Phone number ID

### Database Requirements
- Supabase project with `whatsapp_sessions` table
- RLS policies configured (service_role access)
- Indexes on phone, expires_at
- TTL cleanup enabled

### Scaling Considerations
- **Stateless:** Each message processed independently
- **Database-backed state:** No in-memory state
- **Concurrent limits:** Supabase connection pooling
- **Rate limiting:** TODO - Not yet implemented

---

## Testing

### Unit Tests
```typescript
// Test greeting detection
test("Greeting detection", () => {
    expect(isGreeting("hi")).toBe(true)
    expect(isGreeting("hello")).toBe(true)
    expect(isGreeting("book")).toBe(false)
})

// Test role routing
test("Patient routing", async () => {
    const session = { role: "PATIENT", state: "LANGUAGE_SELECT" }
    await handlePatientMessage(..., session)
    // Verify PatientFlowHandler called
})
```

### Integration Tests
```typescript
// Test full booking flow
test("Patient booking flow", async () => {
    // Send greeting
    await processMessage(..., "hi")
    // Verify: state = LANGUAGE_SELECT
    
    // Select language
    await processMessage(..., "1")
    // Verify: state = MAIN_MENU
    
    // Select booking
    await processMessage(..., "1")
    // Verify: state = BOOK_DOCTOR
    
    // ...continue through flow
})
```

---

## Monitoring & Debugging

### Log Fields
Each message logs:
- `direction`: INBOUND/OUTBOUND
- `phone`: User's WhatsApp phone
- `name`: User's name (if known)
- `status`: Message type (TEXT, BUTTON, etc.)
- `message`: Full text content
- `message_id`: WhatsApp's message ID
- `created_at`: Timestamp

### Debug Output
```
[DEBUG] processMessage Processing message from 919876543210
[DEBUG] processMessage Session loaded
  state: LANGUAGE_SELECT
  role: PATIENT
[DEBUG] handlePatientMessage Patient message from 919876543210
  state: LANGUAGE_SELECT
[DEBUG] patientFlow Processing state: LANGUAGE_SELECT
```

### Querying Sessions
```sql
-- Get latest session for phone
SELECT * FROM whatsapp_sessions 
WHERE phone='919876543210'
ORDER BY updated_at DESC
LIMIT 1

-- Get all active sessions
SELECT * FROM whatsapp_sessions 
WHERE expires_at > now()
ORDER BY updated_at DESC

-- Count sessions by state
SELECT state, COUNT(*) as count 
FROM whatsapp_sessions 
GROUP BY state
```

---

## Future Enhancements

1. **Rate Limiting**
   - Max bookings per day (prevents spam)
   - Max requests per hour
   - Cooldown between similar requests

2. **Conversation Analytics**
   - Track state transitions
   - Identify drop-off points
   - Measure completion rates

3. **A/B Testing**
   - Test different message formats
   - Compare button vs. text options
   - Measure user preferences

4. **Advanced Routing**
   - Load balancing across multiple handlers
   - Feature flags for gradual rollouts
   - Fallback handlers for failures

5. **Integration Extensions**
   - SMS notifications
   - Email confirmations
   - Calendar synchronization
   - CRM integration

---

## Summary

The Message Processor is the critical routing layer that:
- ✅ Manages conversation sessions
- ✅ Routes messages to correct handler by role
- ✅ Handles common scenarios (greetings, errors)
- ✅ Maintains session state across messages
- ✅ Integrates with all three business logic handlers

It's the "nervous system" connecting the WhatsApp webhook to the three conversation handlers (Patient, Doctor, Home Collection) and ensuring every message reaches the right destination with proper context.
