# Trigger Configuration System

Complete guide to managing WhatsApp triggers, menus, templates, and settings through the database without code deployment.

---

## Overview

The Trigger Configuration System allows you to:
- ✅ Store menu options in database
- ✅ Store message templates with variables
- ✅ Store clinic-specific settings
- ✅ Manage cron job schedules
- ✅ Support multi-clinic deployments
- ✅ Hot reload configuration (1-hour cache)
- ✅ Non-technical staff can manage everything

---

## Architecture

```
┌─────────────────────────────────────┐
│  WhatsApp Message Arrives           │
└────────────┬────────────────────────┘
             ↓
┌─────────────────────────────────────┐
│  Router (lib/whatsapp/router.ts)    │
│  ✓ Route to patient/doctor          │
└────────────┬────────────────────────┘
             ↓
┌─────────────────────────────────────┐
│  Cache Layer                        │
│  (lib/triggers/cache.ts)            │
│  ✓ Try memory cache (1 hour TTL)    │
│  ✓ If miss: query database          │
│  ✓ Store in memory cache            │
└────────────┬────────────────────────┘
             ↓
┌─────────────────────────────────────┐
│  Database Configuration             │
│  (supabase PostgreSQL)              │
│  ├─ trigger_menus                   │
│  ├─ trigger_templates               │
│  ├─ trigger_settings                │
│  └─ trigger_cron_jobs               │
└─────────────────────────────────────┘
             ↑
┌─────────────────────────────────────┐
│  Admin UI                           │
│  (app/admin/triggers/)              │
│  ├─ Menus Manager                   │
│  ├─ Templates Manager               │
│  ├─ Settings Manager                │
│  └─ Cron Jobs Manager               │
└─────────────────────────────────────┘
```

---

## Database Schema

### trigger_menus
Stores menu options shown to patients/doctors

```sql
CREATE TABLE trigger_menus (
  id UUID PRIMARY KEY,
  clinic_id UUID,                    -- Which clinic
  trigger_key TEXT,                  -- "MAIN_MENU", "BOOK_DOCTOR", etc
  language TEXT,                     -- "EN", "TE", "HI", "KA", "TA", "ML"
  title TEXT,                        -- "Welcome to ABC Clinic"
  description TEXT,                  -- Optional description
  options JSONB,                     -- [{id, label, description}, ...]
  footer TEXT,                       -- "Reply with number"
  enabled BOOLEAN,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  updated_by UUID
);

-- Example row:
{
  trigger_key: "MAIN_MENU",
  language: "EN",
  title: "Welcome to ABC Clinic",
  options: [
    {id: "1", label: "📅 Book Appointment", description: "Schedule new appointment"},
    {id: "2", label: "📋 My Appointments", description: "View your appointments"},
    {id: "*", label: "📌 More Options", description: "Additional features"}
  ]
}
```

### trigger_templates
Stores message templates with {{variable}} placeholders

```sql
CREATE TABLE trigger_templates (
  id UUID PRIMARY KEY,
  clinic_id UUID,
  template_key TEXT,                 -- "APPOINTMENT_REMINDER", etc
  language TEXT,
  subject TEXT,                      -- Optional (for SMS/email)
  body TEXT,                         -- Message with {{placeholders}}
  enabled BOOLEAN,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

-- Example row:
{
  template_key: "APPOINTMENT_REMINDER",
  language: "EN",
  body: "👋 Hi {{patient_name}}!
  
Your appointment with {{doctor_name}} is tomorrow at {{appointment_time}}.

Code: {{appointment_code}}

Reply with:
1. Confirm
2. Reschedule
3. Cancel"
}
```

### trigger_settings
Stores clinic-specific configuration

```sql
CREATE TABLE trigger_settings (
  id UUID PRIMARY KEY,
  clinic_id UUID,
  setting_key TEXT,                  -- "home_collection_radius", etc
  setting_value TEXT,                -- Value (can be JSON)
  value_type TEXT,                   -- "string", "number", "boolean", "json"
  description TEXT,
  is_secret BOOLEAN                  -- Hide in UI if true
);

-- Example rows:
{setting_key: "home_collection_radius", setting_value: "5", value_type: "number"},
{setting_key: "max_booking_days", setting_value: "30", value_type: "number"},
{setting_key: "enable_doctor_portal", setting_value: "true", value_type: "boolean"},
{setting_key: "appointment_reminder_hours", setting_value: "24", value_type: "number"}
```

### trigger_cron_jobs
Stores cron job configuration

```sql
CREATE TABLE trigger_cron_jobs (
  id UUID PRIMARY KEY,
  clinic_id UUID,
  job_name TEXT,                     -- "appointment_reminders", etc
  schedule_expression TEXT,          -- "*/30 * * * *" (cron format)
  endpoint TEXT,                     -- "/api/cron/reminders"
  enabled BOOLEAN,
  last_run_at TIMESTAMP,
  next_run_at TIMESTAMP
);

-- Example rows:
{job_name: "appointment_reminders", schedule_expression: "*/30 * * * *"},
{job_name: "auto_complete", schedule_expression: "0 * * * *"},
{job_name: "log_cleanup", schedule_expression: "0 1 * * *"}
```

---

## Cache Layer

### How Caching Works

```typescript
// First request: Miss → Query DB → Cache (1 hour TTL)
const menu = await getMenu(supabase, clinicId, "MAIN_MENU", "EN");
// Takes ~50ms (DB query + network)

// Second request (same data): Hit → Return from memory
const menu = await getMenu(supabase, clinicId, "MAIN_MENU", "EN");
// Takes ~1ms (memory only)

// After 1 hour: TTL expires → Next request hits DB again
```

### Performance Impact

```
Messages per hour: 1000
Cache TTL: 1 hour

Without cache:
  1000 messages × 50ms = 50 seconds of DB time
  Database load: Heavy

With cache:
  1000 messages × 1ms = 1 second of DB time (first request only)
  Remaining 999 messages: Memory cache (~1-2ms each)
  Database load: Minimal
```

### Invalidating Cache

```typescript
// When you update a menu/template/setting:
import { invalidateCache } from "@/lib/triggers/cache";

// Option 1: Clear cache for specific clinic
invalidateCache("clinic-123");

// Option 2: Clear all caches globally
invalidateCache();

// Changes visible immediately (no 1-hour wait)
```

---

## Usage Examples

### Example 1: Show Database-Driven Menu

```typescript
// OLD (hardcoded):
const message = `Welcome!\n1. Book\n2. My Appointments`;

// NEW (database):
import { getMenu } from "@/lib/triggers/cache";

const menu = await getMenu(supabase, clinicId, "MAIN_MENU", language);
const menuText = menu.options
  .map(o => `${o.id}. ${o.label}`)
  .join("\n");
const message = `${menu.title}\n\n${menuText}`;
```

### Example 2: Send Template with Variables

```typescript
import { getTemplate, interpolateTemplate } from "@/lib/triggers/cache";

const template = await getTemplate(
  supabase,
  clinicId,
  "APPOINTMENT_REMINDER",
  language
);

const message = interpolateTemplate(template.body, {
  patient_name: "John Smith",
  doctor_name: "Dr. Sharma",
  appointment_time: "2:00 PM",
  appointment_code: "A12A3BC4"
});

await sendMessage(clinicPhone, message);
```

### Example 3: Get Clinic Setting

```typescript
import { getSetting, getSettingNumber } from "@/lib/triggers/cache";

// Get string setting
const clinicName = await getSetting(supabase, clinicId, "clinic_name", "Clinic");

// Get number setting
const radiusKm = await getSettingNumber(supabase, clinicId, "home_collection_radius", 5);

// Get boolean setting
const enableDoctorPortal = await getSettingBoolean(supabase, clinicId, "enable_doctor_portal", false);
```

### Example 4: Integrate with State Machine

```typescript
// Logic stays in code (type-safe)
switch (session.state) {
  case "MAIN_MENU": {
    // Config comes from database
    const menu = await getMenu(supabase, clinicId, "MAIN_MENU", language);
    
    // Validation logic stays in code
    const option = menu.options.find(o => o.id === input);
    if (!option) {
      await reply("Invalid option");
      return;
    }
    
    // Business logic stays in code
    if (input === "1") {
      await handleBooking();
    }
  }
}
```

---

## Admin UI

### Access Trigger Configuration

1. Go to Admin Dashboard
2. Navigate to "⚙️ Triggers" tab
3. Choose:
   - **📋 Menus** - Edit menu options
   - **💬 Templates** - Edit message templates
   - **⚙️ Settings** - Edit clinic settings
   - **⏰ Cron Jobs** - Edit job schedules

### Edit Menu Options

1. Click "Menus" tab
2. Find your menu (e.g., "MAIN_MENU")
3. Click "Edit"
4. Update JSON options:
   ```json
   [
     {
       "id": "1",
       "label": "Book Appointment",
       "description": "Schedule an appointment"
     },
     {
       "id": "2",
       "label": "My Appointments",
       "description": "View your appointments"
     }
   ]
   ```
5. Click "Save"
6. Changes visible within 1 hour (or manually clear cache)

### Edit Message Templates

1. Click "Templates" tab
2. Find your template (e.g., "APPOINTMENT_REMINDER")
3. Click "Edit"
4. Update message body with {{placeholders}}:
   ```
   Hi {{patient_name}}!
   
   Your appointment with {{doctor_name}} is {{appointment_time}}.
   
   Code: {{appointment_code}}
   ```
5. Available placeholders depend on context
6. Click "Save"

### Manage Settings

1. Click "Settings" tab
2. Edit per-clinic configuration:
   - `home_collection_radius`: 5 km
   - `max_booking_days`: 30
   - `enable_doctor_portal`: true
   - `appointment_reminder_hours`: 24
3. Click "Save"

### Manage Cron Jobs

1. Click "Cron Jobs" tab
2. Edit job schedules:
   - `appointment_reminders`: `*/30 * * * *` (every 30 min)
   - `auto_complete`: `0 * * * *` (every hour)
   - `log_cleanup`: `0 1 * * *` (daily at 1 AM)
3. Enable/disable jobs without code
4. Click "Save"

---

## Cron Format Reference

```
*    *    *    *    *
┬    ┬    ┬    ┬    ┬
│    │    │    │    │
│    │    │    │    └─ Day of week (0-6, 0 = Sunday)
│    │    │    └────── Month (1-12)
│    │    └─────────── Day of month (1-31)
│    └──────────────── Hour (0-23)
└───────────────────── Minute (0-59)
```

**Examples:**
- `*/30 * * * *` - Every 30 minutes
- `0 * * * *` - Every hour at :00
- `0 1 * * *` - Daily at 1:00 AM
- `0 9 * * 1-5` - Weekdays at 9:00 AM
- `0 0 1 * *` - First of month at midnight

---

## API Reference

### Cache Functions

```typescript
// Get menu
const menu = await getMenu(supabase, clinicId, triggerKey, language);

// Get template
const template = await getTemplate(supabase, clinicId, templateKey, language);

// Get all settings
const settings = await getSettings(supabase, clinicId);

// Get specific setting
const value = await getSetting(supabase, clinicId, key, defaultValue);

// Get as number
const num = await getSettingNumber(supabase, clinicId, key, defaultValue);

// Get as boolean
const bool = await getSettingBoolean(supabase, clinicId, key, defaultValue);

// Interpolate template
const message = interpolateTemplate(template.body, variables);

// Invalidate cache
invalidateCache(clinicId); // Clear one clinic
invalidateCache(); // Clear all
```

### Update Functions

```typescript
// Update menu
await updateMenu(supabase, clinicId, triggerKey, language, updates);

// Update template
await updateTemplate(supabase, clinicId, templateKey, language, updates);

// Update setting
await updateSetting(supabase, clinicId, key, value);

// Cache is automatically invalidated on update
```

---

## Migration Checklist

### Phase 1: Database Setup
- [ ] Run migration: `0010_trigger_configuration.sql`
- [ ] Verify tables created
- [ ] Load default menus and templates

### Phase 2: Cache Layer
- [ ] Copy `lib/triggers/cache.ts` to project
- [ ] Test cache hit/miss
- [ ] Verify TTL works

### Phase 3: Admin UI
- [ ] Copy `app/admin/triggers/` components
- [ ] Wire up to admin dashboard
- [ ] Test menu editing
- [ ] Test template editing
- [ ] Test settings management

### Phase 4: Refactoring (Per Module)
- [ ] Refactor patient flow to use database menus
- [ ] Refactor patient flow to use database templates
- [ ] Refactor doctor flow similarly
- [ ] Add cache invalidation hooks

### Phase 5: Testing
- [ ] Test multi-clinic isolation
- [ ] Test cache behavior
- [ ] Test admin UI changes propagate
- [ ] Test cron job scheduling

---

## Troubleshooting

### Issue: Changes not visible
**Cause:** Cache TTL (1 hour)  
**Solution:** Manually invalidate cache via settings or wait 1 hour

### Issue: Wrong language showing
**Cause:** Template/menu missing for language  
**Solution:** Create entry in database for that language

### Issue: Placeholder not replaced
**Cause:** Variable name mismatch or typo  
**Solution:** Check {{variable}} names match your code exactly

### Issue: Database error
**Cause:** Missing migration or table  
**Solution:** Run `0010_trigger_configuration.sql`

---

## Performance Metrics

| Operation | Time | Notes |
|-----------|------|-------|
| Cache hit (menu) | 1-2ms | Memory lookup |
| Cache miss (DB) | 40-60ms | DB query + network |
| Template interpolation | 2-5ms | String replacement |
| Settings lookup | 1-3ms | Map lookup (all cached) |
| Invalidate cache | <1ms | Clear memory |

**Expected message latency: 200-300ms** (same as before, configuration load is negligible)

---

## Best Practices

1. **Use defaults wisely**
   ```typescript
   // Good: Clear default if setting missing
   const radius = await getSettingNumber(supabase, clinicId, "radius", 5);
   
   // Risky: No default, null handling
   const radius = await getSettingNumber(supabase, clinicId, "radius");
   ```

2. **Cache invalidation**
   ```typescript
   // After updating via admin UI
   invalidateCache(clinicId);
   
   // After updating via API
   await updateMenu(...);
   // Already invalidated automatically
   ```

3. **Multi-language support**
   ```typescript
   // Always pass language
   const menu = await getMenu(supabase, clinicId, "MAIN_MENU", userLanguage);
   
   // Falls back to EN if language missing
   ```

4. **Template variables**
   ```typescript
   // Use consistent names across codebase
   interpolateTemplate(template.body, {
     patient_name: patient.name,      // {{patient_name}}
     doctor_name: doctor.name,        // {{doctor_name}}
     appointment_time: apptTime       // {{appointment_time}}
   });
   ```

---

## Future Enhancements

- [ ] A/B testing (multiple templates per key)
- [ ] Template versioning
- [ ] Automatic cache warming on startup
- [ ] Cache statistics dashboard
- [ ] SMS/Email template support
- [ ] Internationalization (i18n) integration
- [ ] Cron job execution history
- [ ] Failed job retry logic

