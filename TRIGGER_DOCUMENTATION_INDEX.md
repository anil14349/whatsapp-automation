# Trigger System Documentation Index

Complete navigation guide for the WhatsApp clinic automation trigger configuration system.

---

## 🎯 Start Here

**New to the trigger system?** Start with one of these based on your role:

### For Product Managers / Non-Technical Staff
→ **[TRIGGER_SYSTEM.md](./TRIGGER_SYSTEM.md)** — *Overview & Admin UI guide (15 min read)*
- How to configure menus, templates, settings via dashboard
- Production checklist
- No coding required

### For Backend Engineers
→ **[TRIGGER_SYSTEM.md](./TRIGGER_SYSTEM.md)** — *Complete API reference (30 min read)*
- All functions and endpoints
- Code examples
- Integration patterns

### For DevOps / Operations
→ **[TRIGGER_SYSTEM.md](./TRIGGER_SYSTEM.md#setup-instructions)** — *Setup & schedulers (20 min read)*
- Environment configuration
- Cron scheduler setup (Vercel, AWS, GitHub Actions)
- Monitoring queries

### For System Administrators (Admin Management)
→ **[ADMIN_USER_MANAGEMENT.md](../../clinic-app/ADMIN_USER_MANAGEMENT.md)** — *User & password management (15 min read)*
- Create/manage admin users via dashboard
- Password reset (UI, script, or manual)
- User roles and permissions
- Admin limits and security

---

## 📚 Documentation Map

### Master Documentation
| Document | Purpose | Audience | Read Time |
|----------|---------|----------|-----------|
| **[TRIGGER_SYSTEM.md](./TRIGGER_SYSTEM.md)** | Complete reference for all 9 components (menus, templates, settings, cron, A/B testing, analytics, admin UI, endpoints, WhatsApp Flows), setup, API, examples, troubleshooting | Everyone | 50 min |

### Component Deep-Dives
| Document | Purpose | Focus | Best For |
|----------|---------|-------|----------|
| **[TRIGGER_FEATURES_COMPLETE.md](./TRIGGER_FEATURES_COMPLETE.md)** | Detailed breakdown of 5 core features (Templates, Settings, Cron, A/B Testing, Analytics) | Developers | Feature deep-dive |
| **[TRIGGER_CONFIGURATION_GUIDE.md](./TRIGGER_CONFIGURATION_GUIDE.md)** | Database configuration, menus, templates, admin UI | Admins, Devs | How to configure |
| **[CRON_SETUP_GUIDE.md](./CRON_SETUP_GUIDE.md)** | Cron job setup, schedulers, monitoring, troubleshooting | DevOps, Devs | Cron jobs & scheduling |
| **[WHATSAPP_TRIGGERS.md](./WHATSAPP_TRIGGERS.md)** | All trigger types and workflows | Developers | Trigger reference |
| **[ARCHITECTURE_TRIGGERS_IN_DB.md](./ARCHITECTURE_TRIGGERS_IN_DB.md)** | Design decisions, hybrid architecture rationale | Architects | Design & architecture |

---

## 🗺️ Navigation by Topic

### Configuration Management
- **How to add a menu?** → [TRIGGER_SYSTEM.md§Components:Database-DrivenMenus](./TRIGGER_SYSTEM.md#1-database-driven-menus)
- **How to create a template?** → [TRIGGER_SYSTEM.md§Components:MessageTemplates](./TRIGGER_SYSTEM.md#2-message-templates)
- **How to set clinic settings?** → [TRIGGER_SYSTEM.md§Components:ClinicSettings](./TRIGGER_SYSTEM.md#3-clinic-settings)
- **Full config guide** → [TRIGGER_CONFIGURATION_GUIDE.md](./TRIGGER_CONFIGURATION_GUIDE.md)

### Cron Jobs & Scheduling
- **How to set up cron jobs?** → [TRIGGER_SYSTEM.md§SetupInstructions:Step3ConfigureCronJobs](./TRIGGER_SYSTEM.md#step-3-configure-cron-jobs)
- **External scheduler options** → [TRIGGER_SYSTEM.md§SetupInstructions:Step4SetUpExternalScheduler](./TRIGGER_SYSTEM.md#step-4-set-up-external-scheduler)
- **Cron job monitoring** → [CRON_SETUP_GUIDE.md§Step6Monitoring](./CRON_SETUP_GUIDE.md#step-6-monitoring)
- **Complete cron guide** → [CRON_SETUP_GUIDE.md](./CRON_SETUP_GUIDE.md)

### Development & Integration
- **How to send a templated message?** → [TRIGGER_SYSTEM.md§Examples:Example1SendTemplatedReminder](./TRIGGER_SYSTEM.md#example-1-send-templated-reminder)
- **How to use A/B testing?** → [TRIGGER_SYSTEM.md§Components:ABTesting](./TRIGGER_SYSTEM.md#5-ab-testing)
- **How to track analytics?** → [TRIGGER_SYSTEM.md§Components:Analytics&Tracking](./TRIGGER_SYSTEM.md#6-analytics--tracking)
- **Complete feature guide** → [TRIGGER_FEATURES_COMPLETE.md](./TRIGGER_FEATURES_COMPLETE.md)

### WhatsApp Flows (Optional Native Forms)
- **How to set up WhatsApp Flows?** → [TRIGGER_SYSTEM.md§Components:WhatsAppFlows](./TRIGGER_SYSTEM.md#9-whatsapp-flows-integration-optional)
- **How to generate RSA keypair?** → [TRIGGER_SYSTEM.md§WhatsAppFlows:SetupSteps](./TRIGGER_SYSTEM.md#setup-steps)
- **Environment variables needed** → [TRIGGER_SYSTEM.md§WhatsAppFlows:EnvironmentVariables](./TRIGGER_SYSTEM.md#environment-variables)
- **Troubleshooting Flow issues** → [TRIGGER_SYSTEM.md§WhatsAppFlows:Troubleshooting](./TRIGGER_SYSTEM.md#troubleshooting-1)

### Architecture & Design
- **Why database-driven config?** → [ARCHITECTURE_TRIGGERS_IN_DB.md](./ARCHITECTURE_TRIGGERS_IN_DB.md)
- **System diagram** → [TRIGGER_SYSTEM.md§Architecture:SystemDiagram](./TRIGGER_SYSTEM.md#system-diagram)
- **Data flow** → [TRIGGER_SYSTEM.md§Architecture:DataFlow](./TRIGGER_SYSTEM.md#data-flow)

### Troubleshooting
- **Menus not showing?** → [TRIGGER_SYSTEM.md§Troubleshooting](./TRIGGER_SYSTEM.md#troubleshooting)
- **Cron jobs not running?** → [CRON_SETUP_GUIDE.md§Troubleshooting](./CRON_SETUP_GUIDE.md#troubleshooting)
- **Templates not interpolating?** → [TRIGGER_SYSTEM.md§Troubleshooting](./TRIGGER_SYSTEM.md#troubleshooting)

---

## 🔍 Quick Reference

### API Endpoints
| Endpoint | Purpose | Docs |
|----------|---------|------|
| `POST /api/cron/execute` | Run all scheduled cron jobs | [TRIGGER_SYSTEM.md§APIReference](./TRIGGER_SYSTEM.md#api-reference) |
| `POST /api/cron/appointment-reminders` | Send appointment reminders | [CRON_SETUP_GUIDE.md§Step3AvailableEndpoints](./CRON_SETUP_GUIDE.md#step-3-available-endpoints) |
| `POST /api/cron/auto-complete` | Auto-complete past appointments | [TRIGGER_SYSTEM.md](./TRIGGER_SYSTEM.md) |
| `POST /api/cron/log-cleanup` | Clean up old logs | [TRIGGER_SYSTEM.md](./TRIGGER_SYSTEM.md) |
| `POST /api/whatsapp/flow` | Native WhatsApp Flow form handler (RSA/AES encrypted) | [TRIGGER_SYSTEM.md§WhatsAppFlows](./TRIGGER_SYSTEM.md#9-whatsapp-flows-integration-optional) |

### Core Functions
| Function | Purpose | Docs |
|----------|---------|------|
| `getMainMenuFromDb()` | Load menu from database | [TRIGGER_SYSTEM.md§APIReference:MenuLoaders](./TRIGGER_SYSTEM.md#menu-loaders) |
| `getTemplateAndInterpolate()` | Load & interpolate template | [TRIGGER_SYSTEM.md§APIReference:TemplateFunctions](./TRIGGER_SYSTEM.md#template-functions) |
| `getClinicSetting()` | Load clinic setting | [TRIGGER_SYSTEM.md§APIReference:SettingsFunctions](./TRIGGER_SYSTEM.md#settings-functions) |
| `CronJobScheduler.executeJob()` | Execute cron job | [TRIGGER_SYSTEM.md§APIReference:CronFunctions](./TRIGGER_SYSTEM.md#cron-functions) |
| `trackMenuShown()` | Track menu analytics | [TRIGGER_SYSTEM.md§APIReference:AnalyticsFunctions](./TRIGGER_SYSTEM.md#analytics-functions) |

### Database Tables
| Table | Purpose | Docs |
|-------|---------|------|
| `trigger_menus` | Menu options | [TRIGGER_SYSTEM.md§Components:Menus](./TRIGGER_SYSTEM.md#1-database-driven-menus) |
| `trigger_templates` | Message templates | [TRIGGER_SYSTEM.md§Components:Templates](./TRIGGER_SYSTEM.md#2-message-templates) |
| `trigger_settings` | Clinic configuration | [TRIGGER_SYSTEM.md§Components:Settings](./TRIGGER_SYSTEM.md#3-clinic-settings) |
| `trigger_cron_jobs` | Scheduled jobs | [TRIGGER_SYSTEM.md§Components:CronJobs](./TRIGGER_SYSTEM.md#4-cron-job-execution) |
| `ab_tests` | A/B test configs | [TRIGGER_SYSTEM.md§Components:ABTesting](./TRIGGER_SYSTEM.md#5-ab-testing) |
| `menu_analytics` | Menu tracking | [TRIGGER_SYSTEM.md§Components:Analytics](./TRIGGER_SYSTEM.md#6-analytics--tracking) |
| `template_analytics` | Template tracking | [TRIGGER_SYSTEM.md§Components:Analytics](./TRIGGER_SYSTEM.md#6-analytics--tracking) |

---

## 🚀 Common Workflows

### Workflow 1: Add New Menu (Admin)
1. Dashboard → Triggers → Menus tab
2. Click "Add Menu" 
3. Enter menu key, title, options (JSON)
4. Click Save
→ **Docs:** [TRIGGER_SYSTEM.md§Components:Menus](./TRIGGER_SYSTEM.md#1-database-driven-menus)

### Workflow 2: Create Template (Admin)
1. Dashboard → Triggers → Templates tab
2. Click "Add Template"
3. Enter template key, language, body with {{placeholders}}
4. Click Save & Preview
→ **Docs:** [TRIGGER_SYSTEM.md§Components:Templates](./TRIGGER_SYSTEM.md#2-message-templates)

### Workflow 3: Send Templated Message (Developer)
1. Load template: `getTemplateAndInterpolate(supabase, clinicId, "KEY", "EN", variables)`
2. Send via WhatsApp: `sendWhatsAppText(phone, message)`
3. Track: `trackTemplateSent(supabase, clinicId, "KEY", "EN", phone)`
→ **Docs:** [TRIGGER_SYSTEM.md§Examples:Example1](./TRIGGER_SYSTEM.md#example-1-send-templated-reminder)

### Workflow 4: Set Up Cron Jobs (DevOps)
1. Add environment variable: `CRON_SECRET_TOKEN=...`
2. Add cron job to database (admin UI or SQL)
3. Set up external scheduler (Vercel, AWS, GitHub Actions)
4. Test: `curl -X POST .../api/cron/execute -H "X-Cron-Token: ..."`
→ **Docs:** [CRON_SETUP_GUIDE.md§Step1EnvironmentVariables](./CRON_SETUP_GUIDE.md#step-1-environment-variables)

### Workflow 5: A/B Test Templates (Product Manager)
1. Create 2 template variants: `APPOINTMENT_REMINDER`, `APPOINTMENT_REMINDER_ALT`
2. Add A/B test config to database
3. In code: select variant, send appropriate template
4. Monitor results in dashboard
→ **Docs:** [TRIGGER_SYSTEM.md§Components:ABTesting](./TRIGGER_SYSTEM.md#5-ab-testing)

---

## 📊 By File Size

| File | Lines | Purpose | Focus |
|------|-------|---------|-------|
| **TRIGGER_SYSTEM.md** | ~1000+ | Master guide | Complete reference (includes WhatsApp Flows) |
| **TRIGGER_FEATURES_COMPLETE.md** | ~500 | Feature deep-dive | All 5 features |
| **TRIGGER_CONFIGURATION_GUIDE.md** | ~400 | Admin configuration | How to configure |
| **CRON_SETUP_GUIDE.md** | ~520 | Scheduler setup | Cron jobs |
| **ARCHITECTURE_TRIGGERS_IN_DB.md** | ~250 | Design rationale | Why/how it works |
| **WHATSAPP_TRIGGERS.md** | ~300 | Trigger types | All triggers |

---

## 🎓 Learning Path

### Beginner (30 minutes)
1. Read: [TRIGGER_SYSTEM.md§Overview](./TRIGGER_SYSTEM.md#overview)
2. Read: [TRIGGER_SYSTEM.md§Architecture](./TRIGGER_SYSTEM.md#architecture)
3. Skim: [TRIGGER_SYSTEM.md§Components](./TRIGGER_SYSTEM.md#components)

### Intermediate (1 hour)
1. Complete: Beginner path
2. Read: [TRIGGER_SYSTEM.md§Examples](./TRIGGER_SYSTEM.md#examples)
3. Read: [TRIGGER_SYSTEM.md§APIReference](./TRIGGER_SYSTEM.md#api-reference)

### Advanced (2 hours)
1. Complete: Intermediate path
2. Deep-dive: [TRIGGER_FEATURES_COMPLETE.md](./TRIGGER_FEATURES_COMPLETE.md)
3. Deep-dive: [ARCHITECTURE_TRIGGERS_IN_DB.md](./ARCHITECTURE_TRIGGERS_IN_DB.md)
4. Deep-dive: [CRON_SETUP_GUIDE.md](./CRON_SETUP_GUIDE.md)

### Production Ready (Full review)
1. Complete: Advanced path
2. Go through: [TRIGGER_SYSTEM.md§ProductionChecklist](./TRIGGER_SYSTEM.md#production-checklist)
3. Set up: [CRON_SETUP_GUIDE.md§Step4ExternalSchedulerSetup](./CRON_SETUP_GUIDE.md#step-4-external-scheduler-setup)
4. Test: All health checks and manual tests

---

## 🔗 Cross-References

### TRIGGER_SYSTEM.md References:
- **Related Documentation:** See section at end of file
- **Support & Debugging:** See section for database queries
- **Performance Metrics:** See performance table
- **Production Checklist:** Ready-to-use checklist

### TRIGGER_CONFIGURATION_GUIDE.md References:
- **Admin UI Setup:** See TriggerMenusManager component
- **Database Schema:** See migration details
- **Default Configuration:** See seed data

### TRIGGER_FEATURES_COMPLETE.md References:
- **Integration Examples:** See lib/triggers/integration-complete.ts
- **Dashboard Queries:** SQL examples for analytics
- **Migration Checklist:** Step-by-step setup

### CRON_SETUP_GUIDE.md References:
- **Job Configuration:** See Step 2 database config
- **Troubleshooting:** Comprehensive troubleshooting section
- **New Jobs:** Creating custom cron jobs

### ARCHITECTURE_TRIGGERS_IN_DB.md References:
- **Design Decisions:** Rationale for hybrid approach
- **Performance Analysis:** Cache behavior analysis
- **Multi-Clinic Support:** RLS policy explanation

---

## 🛠️ For Specific Tasks

### I need to...

**...understand the system architecture**
→ Read: [ARCHITECTURE_TRIGGERS_IN_DB.md](./ARCHITECTURE_TRIGGERS_IN_DB.md)
→ Skim: [TRIGGER_SYSTEM.md§Architecture](./TRIGGER_SYSTEM.md#architecture)

**...configure menus/templates/settings**
→ Read: [TRIGGER_CONFIGURATION_GUIDE.md](./TRIGGER_CONFIGURATION_GUIDE.md)
→ Use: [TRIGGER_SYSTEM.md§Components](./TRIGGER_SYSTEM.md#components)

**...set up cron jobs**
→ Read: [CRON_SETUP_GUIDE.md](./CRON_SETUP_GUIDE.md)
→ Reference: [TRIGGER_SYSTEM.md§SetupInstructions:Step3-4](./TRIGGER_SYSTEM.md#step-3-configure-cron-jobs)

**...integrate templates in my code**
→ Read: [TRIGGER_FEATURES_COMPLETE.md§MessageTemplates](./TRIGGER_FEATURES_COMPLETE.md#1-message-templates)
→ Copy: [TRIGGER_SYSTEM.md§Examples:Example1](./TRIGGER_SYSTEM.md#example-1-send-templated-reminder)

**...use clinic settings**
→ Read: [TRIGGER_FEATURES_COMPLETE.md§ClinicSettings](./TRIGGER_FEATURES_COMPLETE.md#2-clinic-settings)
→ Reference: [TRIGGER_SYSTEM.md§APIReference:SettingsFunctions](./TRIGGER_SYSTEM.md#settings-functions)

**...set up A/B testing**
→ Read: [TRIGGER_FEATURES_COMPLETE.md§ABTesting](./TRIGGER_FEATURES_COMPLETE.md#4-ab-testing)
→ Example: [TRIGGER_SYSTEM.md§Examples:Example3](./TRIGGER_SYSTEM.md#example-3-ab-test-templates)

**...set up WhatsApp Flows (native forms)**
→ Read: [TRIGGER_SYSTEM.md§Components:WhatsAppFlows](./TRIGGER_SYSTEM.md#9-whatsapp-flows-integration-optional)
→ Follow: [TRIGGER_SYSTEM.md§WhatsAppFlows:SetupSteps](./TRIGGER_SYSTEM.md#setup-steps)
→ Generate keypair: `node scripts/generate-flow-keypair.mjs`

**...reset an admin password**
→ Read: [ADMIN_USER_MANAGEMENT.md§PasswordReset](../../clinic-app/ADMIN_USER_MANAGEMENT.md#password-reset)
→ Option 1 (UI): Dashboard → Admin Users → Reset Password
→ Option 2 (Script): `node scripts/reset-admin-password.mjs`

**...manage admin users**
→ Read: [ADMIN_USER_MANAGEMENT.md§DashboardUI](../../clinic-app/ADMIN_USER_MANAGEMENT.md#dashboard-ui)
→ Dashboard → Admin Users (ADMIN role only)
→ Create, reset password, change roles, deactivate

**...troubleshoot an issue**
→ Check: [TRIGGER_SYSTEM.md§Troubleshooting](./TRIGGER_SYSTEM.md#troubleshooting)
→ Check: [CRON_SETUP_GUIDE.md§Troubleshooting](./CRON_SETUP_GUIDE.md#troubleshooting)
→ Check: [ADMIN_USER_MANAGEMENT.md§Troubleshooting](../../clinic-app/ADMIN_USER_MANAGEMENT.md#troubleshooting)

**...deploy to production**
→ Follow: [TRIGGER_SYSTEM.md§ProductionChecklist](./TRIGGER_SYSTEM.md#production-checklist)
→ Follow: [CRON_SETUP_GUIDE.md§ProductionChecklist](./CRON_SETUP_GUIDE.md#production-checklist)

---

## 📞 Support Resources

### Built-in Help
- Database queries for debugging → [TRIGGER_SYSTEM.md§SupportDebugging](./TRIGGER_SYSTEM.md#support--debugging)
- Troubleshooting sections → Each document has one
- Performance metrics → [TRIGGER_SYSTEM.md§PerformanceMetrics](./TRIGGER_SYSTEM.md#performance-metrics)

### Code Examples
- Integration patterns → [TRIGGER_SYSTEM.md§Examples](./TRIGGER_SYSTEM.md#examples)
- Complete workflows → [TRIGGER_FEATURES_COMPLETE.md§IntegrationExample](./TRIGGER_FEATURES_COMPLETE.md#integration-example)
- Custom jobs → [CRON_SETUP_GUIDE.md§CreatingNewJobs](./CRON_SETUP_GUIDE.md#creating-new-jobs)

---

## ✅ Checklists

### Setup Checklist
See: [TRIGGER_SYSTEM.md§ProductionChecklist](./TRIGGER_SYSTEM.md#production-checklist)

### Migration Checklist
See: [TRIGGER_FEATURES_COMPLETE.md§MigrationChecklist](./TRIGGER_FEATURES_COMPLETE.md#migration-checklist)

### Cron Setup Checklist
See: [CRON_SETUP_GUIDE.md§ProductionChecklist](./CRON_SETUP_GUIDE.md#production-checklist)

---

## 📝 Summary

| Use Case | Start Here | Then Read |
|----------|-----------|-----------|
| **Understanding system** | TRIGGER_SYSTEM.md (Overview + Architecture) | ARCHITECTURE_TRIGGERS_IN_DB.md |
| **Admin configuration** | TRIGGER_SYSTEM.md (Components) | TRIGGER_CONFIGURATION_GUIDE.md |
| **Backend integration** | TRIGGER_SYSTEM.md (Examples + API) | TRIGGER_FEATURES_COMPLETE.md |
| **Cron job setup** | CRON_SETUP_GUIDE.md | TRIGGER_SYSTEM.md (Setup section) |
| **A/B testing** | TRIGGER_SYSTEM.md (A/B Testing) | TRIGGER_FEATURES_COMPLETE.md (A/B Testing) |
| **Analytics** | TRIGGER_SYSTEM.md (Analytics) | TRIGGER_FEATURES_COMPLETE.md (Analytics) |
| **WhatsApp Flows setup** | TRIGGER_SYSTEM.md (WhatsApp Flows) | README.md (clinic-app) |
| **Troubleshooting** | TRIGGER_SYSTEM.md (Troubleshooting) | Document-specific troubleshooting |
| **Production deploy** | TRIGGER_SYSTEM.md (Production Checklist) | CRON_SETUP_GUIDE.md (Production Checklist) |

---

## 🗂️ File Locations

All documentation is in: `/clinic-app/`

```
clinic-app/
├── TRIGGER_DOCUMENTATION_INDEX.md    ← You are here
├── TRIGGER_SYSTEM.md                 ← Master guide (START HERE)
├── TRIGGER_FEATURES_COMPLETE.md      ← Feature deep-dives
├── TRIGGER_CONFIGURATION_GUIDE.md    ← Admin guide
├── CRON_SETUP_GUIDE.md               ← Cron jobs & scheduling
├── WHATSAPP_TRIGGERS.md              ← Trigger types
└── ARCHITECTURE_TRIGGERS_IN_DB.md    ← Design decisions
```

---

**Last Updated:** September 10, 2026  
**Status:** All documentation current and complete  
**Questions?** Check [TRIGGER_SYSTEM.md§SupportDebugging](./TRIGGER_SYSTEM.md#support--debugging)
