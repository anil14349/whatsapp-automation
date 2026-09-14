# Implementation Guide: Google Apps Script → Supabase Edge Functions

This guide provides step-by-step instructions for migrating the ABC Clinic WhatsApp automation from Google Apps Script to Supabase Edge Functions.

## Phase 1: Setup & Infrastructure (Week 1)

### 1.1 Create Supabase Project

Follow [SUPABASE_SETUP.md](../SUPABASE_SETUP.md) to:
- ✅ Create Supabase project
- ✅ Set up database schema
- ✅ Configure Google service account
- ✅ Add secrets and environment variables

**Estimated time:** 1-2 hours

### 1.2 Initialize Edge Functions Project

```bash
# Clone repository
git clone <your-repo>
cd whatsapp-automation

# Link to Supabase project
supabase login
supabase link --project-ref your-project-id

# Install dependencies
npm install

# Verify setup
supabase status
```

**Estimated time:** 30 minutes

### 1.3 Test Webhook Connectivity

```bash
# Start local development environment
supabase start

# In another terminal, serve functions
supabase functions serve

# Test webhook verification (from a third terminal)
curl "http://localhost:54321/functions/v1/webhook?hub.mode=subscribe&hub.verify_token=test&hub.challenge=TEST123"
# Should return: TEST123
```

**Estimated time:** 30 minutes

---

## Phase 2: Migrate Core Functions (Week 1-2)

### 2.1 Session Management

**Current (Apps Script):**
```javascript
// Global cache in execution scope
let __whatsAppSessionCache = {};

function getWhatsAppSessionWithCache(phone) {
    if (__whatsAppSessionCache[phone]) {
        return __whatsAppSessionCache[phone];
    }
    // Fetch from Sheets
    const session = getWhatsAppSession(phone);
    __whatsAppSessionCache[phone] = session;
    return session;
}
```

**New (Supabase Edge Function):**
```typescript
// Database query (no execution-scoped cache needed)
async function getSession(phone: string): Promise<WhatsAppSession> {
    const { data } = await supabase
        .from("whatsapp_sessions")
        .select("*")
        .eq("phone", phone)
        .maybeSingle();
    return data;
}
```

**Migration checklist:**
- [ ] Replace all `getWhatsAppSessionWithCache()` calls with `getSession()`
- [ ] Replace `setWhatsAppSessionWithCache()` with `updateSession()`
- [ ] Remove execution-scoped cache variables
- [ ] Test session persistence across multiple requests

**Estimated time:** 2-3 hours

### 2.2 Logging

**Current (Apps Script):**
```javascript
appendWhatsAppLogEntry(ss, {
    direction: "INBOUND",
    phone: senderPhone,
    name: senderName,
    status: messageType,
    message: messageText
});
```

**New (Supabase):**
```typescript
await logWhatsAppMessage(supabase, {
    direction: "INBOUND",
    phone: senderPhone,
    name: senderName,
    status: messageType,
    message: messageText
});
```

**Migration checklist:**
- [ ] Replace all `appendWhatsAppLogEntry()` calls
- [ ] Update log cleanup trigger (use Edge Function instead of Apps Script trigger)
- [ ] Implement log retention policy via scheduled job
- [ ] Test log queries and filtering

**Estimated time:** 1-2 hours

### 2.3 Appointment Operations

**Key functions to migrate:**
- `bookAppointment()` → `POST /api/appointments`
- `cancelAppointment()` → `DELETE /api/appointments/{id}`
- `rescheduleAppointment()` → `PUT /api/appointments/{id}`
- `getAvailableSlots()` → `GET /api/slots?doctorId=...&date=...`

**Implementation approach:**
1. Create new Edge Functions for each operation
2. Fetch appointment data from Google Sheets (via Google Sheets API)
3. Create calendar events in Google Calendar
4. Store state in Supabase database
5. Return results to WhatsApp client

**Example structure:**
```typescript
// functions/api/appointments.ts
export async function POST(req: Request) {
    const { doctorId, phone, date, time, patientName } = await req.json();
    
    // Validate input
    // Check availability
    // Create in Google Sheets
    // Create calendar event
    // Update Supabase session
    // Send WhatsApp confirmation
    
    return new Response(JSON.stringify({ success: true }));
}
```

**Estimated time:** 4-5 hours per operation

---

## Phase 3: Business Logic Migration (Week 2-3)

### 3.1 Patient Flow Handler

Migrate `handleWhatsAppPatientMessage()` state machine:

**States to implement:**
1. `LANGUAGE_SELECT` - Choose language
2. `MAIN_MENU` - Main menu options
3. `BOOK_DOCTOR` - Select doctor
4. `BOOK_DATE` - Select date
5. `BOOK_TIME` - Select time slot
6. `BOOK_NAME` - Enter patient name
7. `BOOK_CONFIRM` - Confirm booking
8. `MY_APPOINTMENTS` - View appointments
9. `CANCEL_SELECT` - Select appointment to cancel
10. `RESCHEDULE_SELECT` - Select appointment to reschedule

**Implementation pattern:**
```typescript
export async function handlePatientMessage(
    context: MessageContext
): Promise<void> {
    const session = await getSession(context.phone);
    
    switch (session.state) {
        case "LANGUAGE_SELECT":
            await handleLanguageSelect(context);
            break;
        case "MAIN_MENU":
            await handleMainMenu(context);
            break;
        // ... more states
    }
}
```

**Estimated time:** 6-8 hours

### 3.2 Doctor Flow Handler

Migrate `handleWhatsAppDoctorMessage()`:

**States to implement:**
1. `DOCTOR_MENU` - Main doctor menu
2. `DOCTOR_AVAIL_MENU` - Manage availability
3. `DOCTOR_LEAVE_MENU` - Manage leaves
4. `DOCTOR_CANCEL_SELECT` - Cancel patient appointment
5. `DOCTOR_RESCHEDULE_*` - Reschedule patient appointment
6. `DOCTOR_STATUS_*` - Mark visit status (Completed/No-Show)

**Estimated time:** 4-5 hours

### 3.3 Home Collection Flow (Optional)

Migrate `handleWhatsAppHomeCollectionPersonMessage()`:

**Estimated time:** 3-4 hours (if needed)

---

## Phase 4: Google Integration (Week 3)

### 4.1 Google Sheets Integration

Create `functions/shared/google-sheets.ts`:

```typescript
import { GoogleAuth } from "google-auth-library";

export class GoogleSheetsClient {
    private readonly sheets: any;
    private readonly spreadsheetId: string;

    constructor() {
        const privateKey = Deno.env.get("GOOGLE_SHEETS_PRIVATE_KEY")!;
        const clientEmail = Deno.env.get("GOOGLE_SHEETS_CLIENT_EMAIL")!;
        const spreadsheetId = Deno.env.get("GOOGLE_SHEETS_ID")!;

        const auth = new GoogleAuth({
            credentials: {
                type: "service_account",
                project_id: "abc-clinic",
                private_key: privateKey,
                client_email: clientEmail
            },
            scopes: ["https://www.googleapis.com/auth/spreadsheets"]
        });

        this.sheets = google.sheets({ version: "v4", auth });
        this.spreadsheetId = spreadsheetId;
    }

    async readRange(range: string): Promise<any[][]> {
        const response = await this.sheets.spreadsheets.values.get({
            spreadsheetId: this.spreadsheetId,
            range
        });
        return response.data.values || [];
    }

    async appendRow(sheetName: string, row: any[]): Promise<void> {
        await this.sheets.spreadsheets.values.append({
            spreadsheetId: this.spreadsheetId,
            range: `${sheetName}!A:Z`,
            valueInputOption: "USER_ENTERED",
            resource: { values: [row] }
        });
    }

    async updateCell(range: string, value: any): Promise<void> {
        await this.sheets.spreadsheets.values.update({
            spreadsheetId: this.spreadsheetId,
            range,
            valueInputOption: "USER_ENTERED",
            resource: { values: [[value]] }
        });
    }
}
```

**Key operations:**
- [ ] Read doctors from `Doctors` sheet
- [ ] Read appointments from `Appointments` sheet
- [ ] Write new appointments to `Appointments` sheet
- [ ] Update appointment status (Completed/No-Show/Cancelled)
- [ ] Read patient registry from `Patients` sheet
- [ ] Write new patients to `Patients` sheet
- [ ] Implement caching for performance

**Estimated time:** 3-4 hours

### 4.2 Google Calendar Integration

Create `functions/shared/google-calendar.ts`:

```typescript
export class GoogleCalendarClient {
    private readonly calendar: any;

    constructor() {
        const auth = this.setupAuth();
        this.calendar = google.calendar({ version: "v3", auth });
    }

    async createEvent(
        calendarId: string,
        event: CalendarEvent
    ): Promise<string> {
        const response = await this.calendar.events.insert({
            calendarId,
            resource: event
        });
        return response.data.id;
    }

    async updateEvent(
        calendarId: string,
        eventId: string,
        event: Partial<CalendarEvent>
    ): Promise<void> {
        await this.calendar.events.update({
            calendarId,
            eventId,
            resource: event
        });
    }

    async deleteEvent(calendarId: string, eventId: string): Promise<void> {
        await this.calendar.events.delete({
            calendarId,
            eventId
        });
    }

    async getAvailableSlots(
        calendarId: string,
        date: string,
        duration: number
    ): Promise<TimeSlot[]> {
        // Query calendar for busy times
        // Return available slots
    }
}
```

**Key operations:**
- [ ] Create appointment event in doctor's calendar
- [ ] Update appointment event when rescheduled
- [ ] Delete appointment event when cancelled
- [ ] Query calendar for availability
- [ ] Handle concurrent access (prevent double-booking)

**Estimated time:** 3-4 hours

---

## Phase 5: Testing & Validation (Week 3-4)

### 5.1 Unit Tests

Create tests for shared modules:

```bash
mkdir -p tests

# Test validators
deno test --allow-all tests/validators_test.ts

# Test Google Sheets client
deno test --allow-all tests/google_sheets_test.ts

# Test message processor
deno test --allow-all tests/message_processor_test.ts
```

**Tests to write:**
- [ ] Phone number normalization
- [ ] Date/time validation
- [ ] Appointment status transitions
- [ ] Google Sheets read/write operations
- [ ] Calendar event creation/update/delete

**Estimated time:** 3-4 hours

### 5.2 Integration Tests

Test with real Supabase project:

```bash
# Set environment variables for test project
export SUPABASE_URL=https://test-project.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=xxx

# Run integration tests
deno test --allow-all tests/integration_test.ts
```

**Tests to run:**
- [ ] Send test message via webhook
- [ ] Verify session created in database
- [ ] Verify message logged
- [ ] Test appointment booking flow (end-to-end)
- [ ] Test appointment cancellation
- [ ] Test appointment rescheduling
- [ ] Verify Google Sheets updated correctly
- [ ] Verify calendar events created

**Estimated time:** 4-6 hours

### 5.3 Staging Deployment

Deploy to staging Supabase project:

```bash
# Deploy functions to staging
supabase link --project-ref staging-project-id
supabase functions deploy

# Configure staging WhatsApp webhook
# Use staging phone number, pointing to staging Supabase URL
```

**Acceptance criteria:**
- [ ] All endpoints respond correctly
- [ ] Webhook verification works
- [ ] Inbound messages processed
- [ ] Session state persisted
- [ ] Appointments created in Google Sheets
- [ ] Calendar events created in Google Calendar
- [ ] Logs written to Supabase
- [ ] Error handling works

**Estimated time:** 2-3 hours

---

## Phase 6: Production Migration (Week 4)

### 6.1 Pre-migration Checklist

Before going live:

- [ ] All tests passing
- [ ] Staging environment validated
- [ ] Database backups in place
- [ ] Monitoring configured
- [ ] Error alerts set up
- [ ] Rollback plan documented
- [ ] Team trained on new system
- [ ] Google Sheets data backed up
- [ ] Google Calendar backed up

### 6.2 Production Deployment

```bash
# Link to production Supabase project
supabase link --project-ref production-id

# Run database migrations
supabase db push

# Deploy functions
supabase functions deploy

# Verify all functions deployed
supabase functions list
```

### 6.3 Switch WhatsApp Webhook

1. In Meta Developers Dashboard:
   - Go to WhatsApp Configuration
   - Update Webhook URL to production Supabase endpoint
   - Test webhook verification
   - Save changes

2. Verify production webhook:
   ```bash
   curl "https://production.supabase.co/functions/v1/webhook?hub.mode=subscribe&hub.verify_token=YOUR_TOKEN&hub.challenge=TEST"
   ```

### 6.4 Monitor & Validate

Monitor for 24-48 hours:

- [ ] Check function logs for errors
- [ ] Verify messages are processed
- [ ] Check database for new sessions/logs
- [ ] Monitor response times
- [ ] Check error rates
- [ ] Verify appointments created correctly
- [ ] Test various user flows

**Estimated time:** 8+ hours (ongoing monitoring)

---

## Rollback Plan

If critical issues occur:

1. **Quick revert (< 1 minute):**
   - Point WhatsApp webhook back to Google Apps Script
   ```
   Old webhook: https://script.google.com/macros/d/xxx/usercontent
   ```

2. **Investigation:**
   - Check Supabase function logs
   - Check database logs
   - Check WhatsApp message webhook payload

3. **Fix & redeploy:**
   - Fix issue in code
   - Deploy to staging
   - Test thoroughly
   - Redeploy to production

---

## Performance Benchmarks

### Expected Performance

| Operation | Latency | Notes |
|-----------|---------|-------|
| Webhook verification | < 100ms | Should be instant |
| Simple text reply | 500ms - 2s | Includes WhatsApp send time |
| Appointment booking | 2-5s | Includes Google Sheets + Calendar |
| Appointment cancellation | 1-3s | Includes calendar update |
| Query available slots | 1-3s | Includes calendar query |

### Optimization Tips

1. **Cache doctor/patient data** - Reduce Google Sheets reads
2. **Use Supabase cache** - For frequently accessed data
3. **Batch operations** - Group multiple Google Sheets writes
4. **Async processing** - Send WhatsApp message, then update Sheets
5. **Index database tables** - Ensure queries are fast

---

## Estimated Timeline

| Phase | Duration | Notes |
|-------|----------|-------|
| Setup & Infrastructure | 1-2 days | Most time is waiting for approvals |
| Core Functions | 3-5 days | Parallel work possible |
| Business Logic | 5-7 days | Largest phase |
| Google Integration | 3-4 days | API complexity |
| Testing & Validation | 5-7 days | QA and staging |
| Production Migration | 1-2 days | Cutover window |
| **Total** | **4-5 weeks** | Can be compressed with team |

---

## Support & Resources

- Supabase Docs: https://supabase.com/docs
- Edge Functions Guide: https://supabase.com/docs/guides/functions
- WhatsApp API: https://www.whatsapp.com/business/apis/
- Google Sheets API: https://developers.google.com/sheets/api
- Google Calendar API: https://developers.google.com/calendar/api
- Deno Manual: https://deno.land/manual

---

## Next Steps

1. ✅ Review this implementation guide
2. → [Set up Supabase](../SUPABASE_SETUP.md)
3. → [Deploy webhook](./functions/webhook/)
4. → [Migrate business logic](./functions/shared/)
5. → [Run tests](./tests/)
6. → [Deploy to production](./DEPLOYMENT.md)
