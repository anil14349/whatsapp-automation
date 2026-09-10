# Architecture Analysis: Moving Triggers to PostgreSQL

Should WhatsApp trigger logic be moved from TypeScript code to PostgreSQL configuration? This document analyzes the trade-offs.

---

## Current Architecture

### TypeScript State Machines (Today)
```
WhatsApp Message
    ↓
lib/whatsapp/router.ts (route to patient/doctor)
    ↓
lib/whatsapp/patientFlow.ts or doctorFlow.ts (state machine in code)
    ↓
Checks: switch(session.state) { case "MAIN_MENU": ... }
    ↓
Database update + Response
```

**Flow Logic:** Hardcoded in TypeScript  
**Configuration:** In .env files  
**State Transitions:** In switch statements  

### Example Current Flow
```typescript
// lib/whatsapp/patientFlow.ts
switch (session.state) {
  case "MAIN_MENU": {
    if (normalizedMessage === "1") {
      // Start booking flow
      await saveSession(ctx.supabase, ctx.phone, { state: "BOOK_DOCTOR" });
      return showDoctorMenu();
    }
    if (normalizedMessage === "2") {
      // Show appointments
      return showAppointmentList();
    }
    // ... etc
  }
  case "BOOK_DOCTOR": {
    // Handle doctor selection
  }
  // ... more states
}
```

---

## Analysis: What COULD Move to DB

### 1. Menu Definitions ⭐ (Best Candidate)

**Current (TypeScript):**
```typescript
const menuSpec = {
  body: "Select Doctor:",
  footer: "Tap a doctor to book",
  action: {
    sections: [
      {
        rows: doctors.map(d => ({
          id: d.id,
          title: d.name,
          description: d.specialization
        }))
      }
    ]
  }
};
```

**In Database:**
```sql
CREATE TABLE trigger_menus (
  id UUID PRIMARY KEY,
  clinic_id UUID,
  trigger_key TEXT, -- "MAIN_MENU", "BOOK_DOCTOR", etc
  title TEXT,
  description TEXT,
  options JSON, -- Array of {id, label, description}
  footer TEXT,
  language TEXT,
  created_at TIMESTAMP,
  UNIQUE(clinic_id, trigger_key, language)
);

-- Example row:
INSERT INTO trigger_menus VALUES (
  '...', 
  'clinic-1',
  'MAIN_MENU',
  'Welcome to ABC Clinic',
  'What would you like to do?',
  '[{"id":"1","label":"Book Appointment"},{"id":"2","label":"My Appointments"}]',
  'Reply with number',
  'EN',
  NOW()
);
```

**Pros:**
- ✅ Multi-clinic support (different menus per clinic)
- ✅ Change menus without redeploying
- ✅ Admin UI to manage menus
- ✅ Multi-language support (store all languages)
- ✅ Easy A/B testing (show different menus)

**Cons:**
- ❌ Database query on every message
- ❌ Cache invalidation complexity
- ❌ Can't version control easily
- ❌ Type safety lost (JSON in DB)

**Recommendation:** ✅ **GOOD IDEA** - Move to DB

---

### 2. Message Templates ⭐ (Good Candidate)

**Current (TypeScript):**
```typescript
const message = `👋 Hi ${patientName}!

Your appointment with ${doctorName} is tomorrow at ${time}.

Reply with:
1. Confirm
2. Reschedule
3. Cancel`;
```

**In Database:**
```sql
CREATE TABLE trigger_message_templates (
  id UUID PRIMARY KEY,
  clinic_id UUID,
  template_key TEXT, -- "APPOINTMENT_REMINDER", "BOOKING_CONFIRMED", etc
  subject TEXT,
  body TEXT, -- Can include {{variable}} placeholders
  language TEXT,
  created_at TIMESTAMP
);

-- Example:
INSERT INTO trigger_message_templates VALUES (
  '...',
  'clinic-1',
  'APPOINTMENT_REMINDER',
  'Reminder: Your appointment tomorrow',
  '👋 Hi {{patient_name}}!
  
Your appointment with {{doctor_name}} is tomorrow at {{appointment_time}}.

Reply with:
1. Confirm
2. Reschedule
3. Cancel',
  'EN',
  NOW()
);
```

**Pros:**
- ✅ Change messages without code deploy
- ✅ Template variables ({{patient_name}}, {{doctor_name}})
- ✅ Multi-language support
- ✅ Audit trail of message changes
- ✅ A/B test different messages

**Cons:**
- ❌ Database query per message
- ❌ Variable interpolation overhead
- ❌ Can't use complex logic in templates

**Recommendation:** ✅ **GOOD IDEA** - Move to DB

---

### 3. State Transitions ⚠️ (Risky)

**Current (TypeScript):**
```typescript
switch (session.state) {
  case "MAIN_MENU":
    if (input === "1") {
      nextState = "BOOK_DOCTOR";  // Hard-coded transition
    }
    break;
  case "BOOK_DOCTOR":
    if (isDoctorValid(input)) {
      nextState = "BOOK_DATE";    // Hard-coded transition
    }
    break;
  // ... dozens of transitions
}
```

**In Database (Theoretically):**
```sql
CREATE TABLE trigger_state_transitions (
  id UUID PRIMARY KEY,
  clinic_id UUID,
  from_state TEXT,
  input_pattern TEXT, -- "1-9", "custom_text", "location", etc
  to_state TEXT,
  validation_rule TEXT, -- JSON with validation logic
  UNIQUE(clinic_id, from_state, input_pattern)
);

-- Example rows:
INSERT INTO trigger_state_transitions VALUES
  ('...', 'clinic-1', 'MAIN_MENU', '1', 'BOOK_DOCTOR', NULL),
  ('...', 'clinic-1', 'MAIN_MENU', '2', 'APPOINTMENT_LIST', NULL),
  ('...', 'clinic-1', 'BOOK_DOCTOR', '1-9', 'BOOK_DATE', '{"type":"range","min":1,"max":9}'),
  ('...', 'clinic-1', 'BOOK_DATE', 'YYYY-MM-DD', 'BOOK_TIME', '{"type":"date","min_future_days":1}');
```

**Pros:**
- ✅ Dynamic state machine changes
- ✅ Multi-clinic different flows
- ✅ Feature flags per clinic
- ✅ Hot reload workflows

**Cons:**
- ❌ ❌ ❌ Complex to query reliably
- ❌ ❌ ❌ Performance hit (queries per message)
- ❌ ❌ ❌ Logic hard to debug (in DB vs code)
- ❌ ❌ ❌ Type safety completely lost
- ❌ ❌ ❌ Validation logic scattered
- ❌ ❌ ❌ Hard to test
- ❌ ❌ ❌ Cache invalidation nightmare

**Recommendation:** ❌ **BAD IDEA** - Keep in TypeScript

---

### 4. Validation Rules ⚠️ (Risky)

**Current (TypeScript):**
```typescript
function validateDateInput(input: string, timezone: string): boolean {
  const date = parseISO(input);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date >= today && date <= today + 30 days;
}
```

**In Database (Theoretically):**
```sql
CREATE TABLE trigger_validations (
  id UUID PRIMARY KEY,
  clinic_id UUID,
  state TEXT, -- "BOOK_DATE", "BOOK_TIME", etc
  rule TEXT, -- JSON: {"type":"date","min_future_days":0,"max_future_days":30}
  error_message TEXT,
  created_at TIMESTAMP
);
```

**Pros:**
- ✅ Change validation without deploy
- ✅ Different rules per clinic

**Cons:**
- ❌ ❌ ❌ Can't express complex logic (haversine distance, business hours, etc)
- ❌ ❌ ❌ Need to parse JSON and execute in application anyway
- ❌ ❌ ❌ Slow (DB query + parsing + validation)
- ❌ ❌ ❌ Hard to test edge cases

**Recommendation:** ❌ **BAD IDEA** - Keep in TypeScript

---

### 5. Cron Job Schedules ⭐ (Good Candidate)

**Current:**
```
hardcoded in Cloud Scheduler / EventBridge
- 30 minutes: appointment reminders
- 1 hour: auto-complete
- 1 AM: log cleanup
```

**In Database:**
```sql
CREATE TABLE trigger_cron_jobs (
  id UUID PRIMARY KEY,
  clinic_id UUID,
  job_name TEXT, -- "appointment_reminders", "auto_complete"
  schedule_expression TEXT, -- "*/30 * * * *" (cron format)
  endpoint TEXT, -- "/api/cron/reminders"
  enabled BOOLEAN,
  last_run_at TIMESTAMP,
  next_run_at TIMESTAMP,
  created_at TIMESTAMP
);

-- Example:
INSERT INTO trigger_cron_jobs VALUES
  ('...', 'clinic-1', 'appointment_reminders', '*/30 * * * *', '/api/cron/reminders', true, ...),
  ('...', 'clinic-1', 'auto_complete', '0 * * * *', '/api/cron/auto-complete', true, ...);
```

**Pros:**
- ✅ Different schedules per clinic
- ✅ Enable/disable jobs without deploy
- ✅ Admin UI for job management
- ✅ Change frequency without code

**Cons:**
- ❌ Need separate scheduler service
- ❌ Complex to manage across multiple environments

**Recommendation:** ✅ **CONDITIONAL** - Good for multi-clinic, but add service layer

---

### 6. Flow Definitions ⚠️ (Complex)

**In Database (Advanced):**
```sql
CREATE TABLE trigger_flows (
  id UUID PRIMARY KEY,
  clinic_id UUID,
  flow_name TEXT, -- "booking_flow", "home_collection_flow"
  definition JSONB, -- Complete flow definition
  created_at TIMESTAMP
);

-- Example structure:
{
  "name": "booking_flow",
  "start_state": "BOOK_DOCTOR",
  "states": [
    {
      "id": "BOOK_DOCTOR",
      "prompt": "Select a doctor",
      "actions": [
        {
          "input": "1-9",
          "next_state": "BOOK_DATE",
          "validation": {"type": "range", "min": 1, "max": 9}
        },
        {
          "input": "0",
          "next_state": "MAIN_MENU",
          "action": "go_back"
        }
      ]
    },
    {
      "id": "BOOK_DATE",
      "prompt": "Select a date",
      "actions": [...]
    }
  ]
}
```

**Pros:**
- ✅ ✅ Fully dynamic workflows
- ✅ ✅ Multi-clinic completely different flows
- ✅ ✅ No code deployments for new flows

**Cons:**
- ❌ ❌ ❌ Extremely complex to implement
- ❌ ❌ ❌ Need workflow execution engine
- ❌ ❌ ❌ Very hard to debug
- ❌ ❌ ❌ Type safety completely gone
- ❌ ❌ ❌ Testing nightmare
- ❌ ❌ ❌ Performance impact (parsing JSONB on every message)

**Recommendation:** ❌ **BAD IDEA** - This is over-engineering unless you have extreme multi-tenancy needs

---

## Recommended Hybrid Approach ✅

**GOOD DESIGN:** Move configuration to DB, keep logic in code

```
PostgreSQL (Configuration)          TypeScript Code (Logic)
├─ trigger_menus                    ├─ patientFlow.ts
│  ├─ Main menu options             │  ├─ State machine
│  ├─ Doctor selection              │  ├─ Validation
│  ├─ Multi-language                │  └─ Business logic
│  └─ Per-clinic variants           │
├─ trigger_message_templates        └─ doctorFlow.ts
│  ├─ Appointment reminders         
│  ├─ Confirmations                 
│  ├─ Variable interpolation        
│  └─ Multi-language                
├─ trigger_cron_jobs                
│  ├─ Schedule expressions          
│  ├─ Enable/disable               
│  └─ Per-clinic config            
└─ trigger_settings                 
   ├─ Home collection radius       
   ├─ Max booking days             
   ├─ Reminder timing              
   └─ Feature flags               
```

### Schema Design

```sql
-- Menu configuration
CREATE TABLE trigger_menus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id),
  trigger_key TEXT NOT NULL, -- "MAIN_MENU", "BOOK_DOCTOR", etc
  language TEXT DEFAULT 'EN',
  title TEXT NOT NULL,
  description TEXT,
  options JSONB, -- [{id, label, description}]
  footer TEXT,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(clinic_id, trigger_key, language)
);

-- Message templates
CREATE TABLE trigger_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id),
  template_key TEXT NOT NULL, -- "REMINDER", "CONFIRMATION", etc
  language TEXT DEFAULT 'EN',
  body TEXT NOT NULL, -- Can include {{placeholders}}
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(clinic_id, template_key, language)
);

-- Cron job configuration
CREATE TABLE trigger_cron_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id),
  job_name TEXT NOT NULL,
  schedule_expression TEXT NOT NULL, -- Cron format
  endpoint TEXT NOT NULL, -- /api/cron/reminders
  enabled BOOLEAN DEFAULT true,
  last_run_at TIMESTAMP,
  next_run_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(clinic_id, job_name)
);

-- Feature flags & settings
CREATE TABLE trigger_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id),
  setting_key TEXT NOT NULL,
  setting_value TEXT,
  value_type TEXT, -- "string", "number", "boolean", "json"
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(clinic_id, setting_key)
);
```

---

## Implementation Example

### Before (All in Code)
```typescript
// lib/whatsapp/patientFlow.ts
const MAIN_MENU_MESSAGE = "Welcome to ABC Clinic!\n\n1. Book Appointment\n2. My Appointments\n3. Change Language\n* More options";

async function handleMainMenu(ctx, input) {
  if (input === "1") {
    // Show hardcoded doctor list
    const doctors = await listDoctors(ctx.supabase);
    const message = doctors.map((d, i) => `${i+1}. ${d.name}`).join('\n');
    await sendMessage(ctx, message);
    await saveSession(ctx.supabase, ctx.phone, { state: "BOOK_DOCTOR" });
  }
  // ... etc
}
```

### After (Hybrid Approach)
```typescript
// lib/whatsapp/patientFlow.ts
async function handleMainMenu(ctx, input) {
  // Load menu from DB
  const menu = await getMenu(ctx.supabase, ctx.clinicId, "MAIN_MENU", ctx.language);
  
  // Check if input is valid
  const option = menu.options.find(o => o.id === input);
  if (!option) {
    await sendMessage(ctx, "Invalid option");
    return;
  }
  
  // Route based on option
  switch (input) {
    case "1":
      // Logic stays in code
      const doctors = await listDoctors(ctx.supabase, ctx.clinicId);
      const doctorMenu = await getMenu(ctx.supabase, ctx.clinicId, "BOOK_DOCTOR", ctx.language);
      // ... render doctors using menu template
      break;
    case "2":
      // My appointments logic
      break;
    // ... etc
  }
}

// Helper functions
async function getMenu(supabase, clinicId, menuKey, language) {
  const { data } = await supabase
    .from('trigger_menus')
    .select('*')
    .eq('clinic_id', clinicId)
    .eq('trigger_key', menuKey)
    .eq('language', language)
    .single();
  
  return data;
}

async function getTemplate(supabase, clinicId, templateKey, language) {
  const { data } = await supabase
    .from('trigger_templates')
    .select('*')
    .eq('clinic_id', clinicId)
    .eq('template_key', templateKey)
    .eq('language', language)
    .single();
  
  return data;
}

async function interpolateTemplate(template, variables) {
  let message = template.body;
  Object.entries(variables).forEach(([key, value]) => {
    message = message.replace(`{{${key}}}`, value);
  });
  return message;
}
```

---

## Pros & Cons Summary

| Approach | Pros | Cons | Best For |
|----------|------|------|----------|
| **All Code** | Type safe, fast, simple, testable | Hard to change, single clinic | Single-clinic deployments |
| **All DB** | Dynamic, multi-clinic, no deploy | Slow, unsafe, hard to debug | Extremely complex needs |
| **Hybrid** (Recommended) | Balance of flexibility & safety | Slightly more complex | Most real-world scenarios |

---

## Performance Impact

### Database Queries Per Message

**Current (Code):** 3-5 DB queries
- Get session
- Look up doctor/appointment
- Update session
- Log message

**With Config in DB:** 5-10 DB queries
- Get session (1)
- Get menu (1) ← NEW
- Look up doctor/appointment (1)
- Get template (1) ← NEW
- Update session (1)
- Log message (1)

**Impact:** ~30-40% more queries, but:
- ✅ Adds <50ms latency
- ✅ Cacheable (Redis for menus)
- ✅ Worth it for multi-clinic

### Caching Strategy

```typescript
// Cache menus for 1 hour
const menuCache = new Map<string, Menu>();

async function getMenu(clinic, trigger, language) {
  const key = `menu:${clinic}:${trigger}:${language}`;
  
  if (menuCache.has(key)) {
    return menuCache.get(key);
  }
  
  const menu = await supabase
    .from('trigger_menus')
    .select('*')
    .match({ clinic_id: clinic, trigger_key: trigger, language })
    .single();
  
  menuCache.set(key, menu);
  setTimeout(() => menuCache.delete(key), 3600000); // 1 hour
  
  return menu;
}
```

---

## Migration Plan

### Phase 1: Menus (Immediate)
```
Move to DB:
✅ Main menu options
✅ Doctor selection menus
✅ Appointment lists
✅ Language selection
```

### Phase 2: Templates (Week 2)
```
Move to DB:
✅ Appointment reminders
✅ Confirmation messages
✅ Error messages
✅ Welcome messages
```

### Phase 3: Settings (Week 3)
```
Move to DB:
✅ Home collection radius
✅ Max booking days
✅ Reminder timing
✅ Feature flags
```

### Phase 4: Cron Jobs (Week 4)
```
Add service layer:
✅ Load schedules from DB
✅ Admin UI to manage
✅ Enable/disable without deploy
```

### Phase 5 (Never): State Transitions
```
Keep in Code:
❌ DON'T move state machine
❌ DON'T move validation logic
❌ Keep it simple and fast
```

---

## Recommendation

### ✅ DO Move to DB:
- Menu options & text
- Message templates
- Cron schedules
- Feature flags & settings
- Multi-language content

### ❌ DON'T Move to DB:
- State machine transitions
- Validation logic
- Business rules
- Error handling
- Complex conditionals

### Benefits of Hybrid Approach
- ✅ Multi-clinic support without code changes
- ✅ Change menus/messages without deploy
- ✅ Admin UI for non-technical staff
- ✅ A/B testing capabilities
- ✅ Still fast (logic in code, config in DB)
- ✅ Type-safe business logic
- ✅ Easier to debug & test

