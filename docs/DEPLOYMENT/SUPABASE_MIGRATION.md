# WhatsApp Automation: Google Apps Script → Supabase Edge Functions

## Overview

This document describes the migration of the ABC Clinic WhatsApp automation system from Google Apps Script to Supabase Edge Functions.

### Key Changes

| Component | Google Apps Script | Supabase |
|-----------|-------------------|----------|
| **Webhook Handler** | `doPost()` / `doGet()` | Edge Function `/webhook` |
| **Session Storage** | Google Sheets (WhatsApp_Sessions) | Supabase PostgreSQL |
| **Appointment Data** | Google Sheets + Calendar | Google Sheets API + Calendar API |
| **Logging** | Google Sheets | Supabase PostgreSQL tables + Files |
| **Execution Context** | Apps Script Cache | Redis / Supabase sessions |
| **Deployment** | Bound Google Sheet | Supabase CLI + GitHub Actions |

---

## Architecture

### High-Level Flow

```
WhatsApp Cloud API
     ↓ (webhook POST)
Supabase Edge Function (/webhook)
     ↓
     ├→ Verify token
     ├→ Check idempotency (Supabase DB)
     ├→ Log inbound message
     ├→ Fetch/update session (Supabase DB)
     ├→ Route to conversation handler
     └→ Send WhatsApp reply (via WhatsApp Cloud API)
                    ↓
            Google Sheets (read/write appointments)
            Google Calendar (read/write events)
```

### Database Schema

New Supabase tables:

1. **`whatsapp_sessions`** - Conversation state (replaces Google Sheets WhatsApp_Sessions)
   ```sql
   id, phone, role, state, data, created_at, updated_at, expires_at
   ```

2. **`whatsapp_log`** - Message log (replaces Google Sheets log)
   ```sql
   id, direction, phone, name, status, message, created_at
   ```

3. **`message_dedup`** - Idempotency (replaces sheet-based dedup)
   ```sql
   id, message_id, phone, created_at, expires_at
   ```

4. **`session_cache`** - Execution-scoped caches
   ```sql
   key, value, expires_at
   ```

---

## Migration Steps

### Phase 1: Setup & Infrastructure

1. **Create Supabase Project**
   - Create database tables (see schema below)
   - Set up authentication
   - Generate API keys and tokens

2. **Create Edge Functions**
   - `functions/webhook/index.ts` - Main webhook handler
   - `functions/api/appointments.ts` - Appointment operations
   - `functions/api/doctors.ts` - Doctor operations
   - `functions/api/slots.ts` - Slot availability

3. **Environment Configuration**
   - Store secrets in Supabase project settings
   - Create `.env.local` for development
   - Document required config variables

### Phase 2: Convert Core Functions

1. **Session Management**
   - Replace `getWhatsAppSessionWithCache()` with Supabase query
   - Replace `setWhatsAppSessionWithCache()` with Supabase update
   - Implement TTL-based session expiry

2. **Logging**
   - Replace sheet writes with Supabase inserts
   - Implement log retention cleanup (scheduled job)

3. **Idempotency**
   - Replace cache-based checks with DB queries
   - Implement automatic expiry cleanup

### Phase 3: Business Logic Migration

1. Migrate conversation handlers (`handleWhatsAppPatientMessage`, etc.)
2. Migrate appointment operations (`bookAppointment`, `cancelAppointment`, etc.)
3. Migrate doctor operations (`getDoctorSchedule`, etc.)
4. Migrate slot availability engine (`getAvailableSlots`, etc.)

### Phase 4: Google Sheets/Calendar Integration

1. Create `GoogleSheetsClient` wrapper
   - Authenticate with service account
   - Read/write appointments
   - Handle concurrent access

2. Create `GoogleCalendarClient` wrapper
   - Query availability
   - Create/update/delete events
   - Handle conflicts

### Phase 5: Testing & Deployment

1. Unit tests for core functions
2. Integration tests with test Supabase project
3. Staging deployment
4. Production migration

---

## Configuration Variables

### Required

```
SB_URL=https://xxx.supabase.co
SB_ANON_KEY=xxx
WHATSAPP_ACCESS_TOKEN=xxx
WHATSAPP_PHONE_NUMBER_ID=xxx
WHATSAPP_VERIFY_TOKEN=xxx
WHATSAPP_WEBHOOK_POST_TOKEN=xxx
GOOGLE_SHEETS_ID=xxx
GOOGLE_SHEETS_PRIVATE_KEY=xxx
GOOGLE_SHEETS_CLIENT_EMAIL=xxx
TIMEZONE=Asia/Kolkata
```

### Optional

```
DEBUG_MODE=false
LOG_RETENTION_DAYS=30
SESSION_TTL_SECONDS=86400
ENABLE_APPOINTMENT_REMINDERS=true
REMINDER_HOURS_BEFORE=24
```

---

## File Structure

```
supabase/
├── functions/
│   ├── webhook/
│   │   └── index.ts              # Main entry point
│   ├── api/
│   │   ├── appointments.ts
│   │   ├── doctors.ts
│   │   ├── slots.ts
│   │   └── sessions.ts
│   ├── shared/
│   │   ├── google-sheets.ts
│   │   ├── google-calendar.ts
│   │   ├── whatsapp-client.ts
│   │   └── types.ts
│   └── utils/
│       ├── logger.ts
│       ├── cache.ts
│       └── validators.ts
├── migrations/
│   ├── 001_create_tables.sql
│   └── 002_add_indexes.sql
└── seed/
    └── dev_data.sql
```

---

## Key Differences to Handle

### 1. Global Execution Scope

**Apps Script:**
```javascript
let __doctorRecordCache = {};
let __patientPhoneCache = {};
// Available throughout execution
```

**Supabase Edge Functions:**
- Each invocation is independent
- No global state between requests
- Use Supabase cache or Redis for shared state
- Or store in request context

### 2. Spreadsheet API

**Apps Script:**
```javascript
const ss = SpreadsheetApp.getActiveSpreadsheet();
const sheet = getRequiredSheet(ss, "Appointments");
```

**Supabase:**
```typescript
import { GoogleSheetsClient } from './google-sheets';
const sheets = new GoogleSheetsClient();
const appointments = await sheets.read("Appointments");
```

### 3. Error Handling

**Apps Script:**
- Built-in logging
- Retry mechanisms in Apps Script runtime
- Exception handling with Logger

**Supabase:**
- Use console.log / structured logging
- Implement retry logic explicitly
- Handle network timeouts
- Log to Supabase tables

### 4. Authentication

**Apps Script:**
- Automatic via bound Sheet
- Service account via private key

**Supabase:**
- Use Supabase auth tokens
- Service account for Google APIs
- Per-function authorization rules

---

## Next Steps

1. Set up Supabase project (see [SETUP.md](./SETUP.md))
2. Create database schema (see [SQL migrations](./migrations/))
3. Scaffold Edge Functions (see [functions/](./functions/))
4. Implement webhook handler
5. Migrate business logic step by step
6. Test with real WhatsApp messages
7. Deploy to production

---

## Rollback Plan

If issues arise:
1. Keep Google Apps Script deployed as backup
2. Update WhatsApp webhook URL back to Apps Script
3. Investigate issues in Supabase logs
4. Fix and redeploy Edge Functions
