# Developer Onboarding Guide

**Version:** 1.0  
**Date:** September 11, 2026  
**Purpose:** Onboard new developers  
**Time:** 4 hours

---

## 🎯 Goals

By end of onboarding, you'll understand:
- ✅ System architecture
- ✅ How webhook works
- ✅ Message handler pattern
- ✅ Database schema
- ✅ How to modify code
- ✅ How to test changes
- ✅ How to deploy

---

## 📚 Prerequisites

**Required Knowledge:**
- TypeScript basics
- React basics
- SQL basics
- Git basics

**Required Tools:**
- Node.js 18+
- Git
- VS Code (recommended)
- PostgreSQL client
- Postman (for API testing)

---

## 🏗️ Architecture Overview

### System Flow

```
WhatsApp Cloud API
        ↓
    [Webhook]
        ↓
/api/webhooks/whatsapp
        ↓
Verify Signature (HMAC-SHA256)
        ↓
Extract Message
        ↓
Find/Create Patient
        ↓
Route to Handler
        ↓
Save to Database
        ↓
Send Response
        ↓
Return 200 OK
```

### Key Components

**1. Webhook Route** (`app/api/webhooks/whatsapp/route.ts`)
- Receives WhatsApp messages
- Verifies signatures
- Orchestrates processing

**2. Message Processor** (`lib/whatsapp/messageProcessor.ts`)
- Routes to handlers
- Manages flow
- Error handling

**3. Message Handlers** (`lib/whatsapp/advancedMessageHandlers.ts`)
- Process specific intents
- Create patient requests
- Send responses

**4. Database** (Supabase PostgreSQL)
- Stores all data
- RLS for security
- Audit trail

### Data Flow

```
Message arrives
    ↓
Extract: phone, text, timestamp
    ↓
Find Patient: SELECT FROM patients WHERE phone = ?
    ↓
Route: Match keywords to handler
    ↓
Handler: Create request, send response
    ↓
Persist: INSERT INTO messages, patient_requests
    ↓
Return: 200 OK to WhatsApp
```

---

## 📖 Database Schema

### Key Tables

**1. patients**
```sql
id, clinic_id, phone, name, email, created_at
-- Patient directory
```

**2. messages**
```sql
id, clinic_id, patient_phone, content, status, 
sent_at, delivered_at, read_at, failed_at
-- All WhatsApp messages
```

**3. patient_requests**
```sql
id, clinic_id, patient_id, request_type, 
request_text, status, assigned_to, notes
-- Categorized patient requests
```

**4. appointments**
```sql
id, clinic_id, patient_id, doctor_id, 
appointment_date, appointment_time, status
-- Appointment bookings
```

### Security: RLS Policies

Every table has RLS to isolate clinics:

```sql
-- Example: messages table
CREATE POLICY "Users can view their clinic's messages"
  ON messages FOR SELECT
  USING (clinic_id IN (
    SELECT clinic_id FROM admin_users WHERE user_id = auth.uid()
  ));
```

---

## 🔧 Adding a New Message Handler

### Step 1: Understand Pattern

All handlers follow this pattern:

```typescript
export async function handleMyRequest(
  supabase,
  clinicId,
  message,
  patient,
  text
): Promise<MessageProcessingResult> {
  try {
    // 1. Process logic
    // 2. Save to database
    // 3. Send response
    // 4. Return success
    return {
      success: true,
      action: "my_action",
      message: "Description"
    };
  } catch (error) {
    return {
      success: false,
      action: "my_action_failed",
      error: error.message
    };
  }
}
```

### Step 2: Create Handler

File: `lib/whatsapp/advancedMessageHandlers.ts`

```typescript
export async function handleMyRequest(
  supabase,
  clinicId,
  message,
  patient,
  text
): Promise<MessageProcessingResult> {
  try {
    // Create request
    const { error } = await supabase
      .from("patient_requests")
      .insert({
        clinic_id: clinicId,
        patient_id: patient.id,
        request_type: "my_type",
        request_text: text,
        status: "pending"
      });

    if (error) throw error;

    // Send response
    await sendWhatsAppMessage(
      supabase,
      clinicId,
      message.from,
      "Response message"
    );

    return {
      success: true,
      action: "my_action",
      message: "Handled successfully"
    };
  } catch (error) {
    return {
      success: false,
      action: "my_action_failed",
      error: error.message
    };
  }
}
```

### Step 3: Add to Router

In `routeAdvancedMessage()`:

```typescript
if (lowerText.match(/my_keyword/i)) {
  return await handleMyRequest(supabase, clinicId, message, patient, text);
}
```

### Step 4: Test

```bash
# Send test message
# Message: "my keyword"

# Verify in admin
# Check: Patient Requests dashboard
```

---

## 🧪 Testing Workflow

### Unit Test Pattern

```typescript
// File: lib/whatsapp/handlers.test.ts
describe("handleLabCollectionRequest", () => {
  it("should create patient request", async () => {
    const result = await handleLabCollectionRequest(
      mockSupabase,
      "clinic-id",
      mockMessage,
      mockPatient,
      "lab text"
    );
    
    expect(result.success).toBe(true);
    expect(result.action).toBe("lab_collection_requested");
  });
});
```

### Integration Test

```bash
# 1. Send message
curl -X POST https://localhost:3000/api/webhooks/whatsapp \
  -H "X-Hub-Signature-256: sha256=..." \
  -d '{...}'

# 2. Verify in database
SELECT * FROM patient_requests ORDER BY created_at DESC LIMIT 1;

# 3. Verify response sent
# Check WhatsApp for message
```

---

## 🚀 Development Workflow

### Setup Local Environment

```bash
# Clone repo
git clone https://github.com/your-org/clinic-app.git
cd clinic-app

# Install dependencies
npm install

# Setup environment
cp .env.example .env.local
# Fill in values

# Start dev server
npm run dev
```

### Make Changes

```bash
# Create feature branch
git checkout -b feature/my-feature

# Make changes to code

# Test locally
npm run dev

# Type check
npm run type-check

# Commit
git add .
git commit -m "Add my feature"

# Push
git push origin feature/my-feature

# Create PR
gh pr create --base main
```

### Review & Deploy

```bash
# Wait for CI/CD
# - Tests pass
- Type check passes
# - No linting errors

# PR approved

# Merge to main
gh pr merge

# Deploy
# Automatic via Vercel
```

---

## 📝 Code Standards

### TypeScript

```typescript
// Always type function parameters
function handleRequest(
  text: string,           // ✅ Good
  supabase: SupabaseClient
): Promise<Result> { }

// Avoid any
const data: any = {};    // ❌ Avoid
const data: Record<string, unknown> = {}; // ✅ Good
```

### Error Handling

```typescript
// Always handle errors
try {
  await doSomething();
} catch (error) {
  console.error("Failed to do something:", error);
  return {
    success: false,
    error: error instanceof Error ? error.message : "Unknown error"
  };
}
```

### Logging

```typescript
// Use console with context
console.log("Processing message", { messageId, patient });    // ✅ Good
console.log("msg ok");                                          // ❌ Avoid
```

### Comments

```typescript
// Explain WHY, not WHAT
// ❌ Avoid
// Set status to processed
status = 'processed';

// ✅ Good
// Mark event as processed so we don't retry infinitely
status = 'processed';
```

---

## 🔍 Debugging

### Debug Mode

```bash
# Start with debugging
DEBUG=* npm run dev
```

### Database Inspection

```sql
-- See recent messages
SELECT * FROM messages ORDER BY created_at DESC LIMIT 10;

-- See failed messages
SELECT * FROM messages WHERE status = 'failed';

-- Check patient requests
SELECT * FROM patient_requests WHERE created_at > NOW() - INTERVAL '1 hour';
```

### Vercel Logs

```bash
# Watch logs in real-time
vercel logs --follow

# Search logs
vercel logs | grep "error"
```

### Browser DevTools

- F12 → Console (JavaScript errors)
- F12 → Network (API calls)
- F12 → Application → LocalStorage (auth tokens)

---

## 📚 Key Files to Know

| File | Purpose |
|------|---------|
| `app/api/webhooks/whatsapp/route.ts` | Webhook entry point |
| `lib/whatsapp/webhook.ts` | Signature verification |
| `lib/whatsapp/messageProcessor.ts` | Main routing logic |
| `lib/whatsapp/advancedMessageHandlers.ts` | All handlers |
| `lib/whatsapp/statusProcessor.ts` | Delivery tracking |
| `supabase/migrations/*` | Database schema |
| `WHATSAPP_WEBHOOK_GUIDE.md` | Architecture docs |

---

## 🎓 Learning Resources

**Inside Project:**
- WHATSAPP_WEBHOOK_GUIDE.md - Architecture
- ADVANCED_MESSAGE_HANDLERS_GUIDE.md - Handler details
- Code comments - Implementation details

**External:**
- Supabase docs: supabase.com/docs
- WhatsApp API: developers.facebook.com/docs/whatsapp
- TypeScript handbook: typescriptlang.org/docs
- React docs: react.dev

---

## ✅ Onboarding Checklist

- [ ] Code cloned and running locally
- [ ] Environment variables configured
- [ ] Database connected
- [ ] Can run tests locally
- [ ] Understand architecture diagram
- [ ] Understand database schema
- [ ] Added simple test handler
- [ ] Tested handler locally
- [ ] Created PR (not merged)
- [ ] Reviewed code with senior dev
- [ ] Understand deployment process

---

**Status:** Developer Ready  
**Duration:** 4 hours  
**Next:** Make your first contribution!
