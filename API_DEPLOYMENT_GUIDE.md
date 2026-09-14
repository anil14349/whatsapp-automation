# API Deployment Guide - ABC Clinic WhatsApp Automation

## Prerequisites

- Supabase CLI installed (`npm install -g supabase`)
- Deno installed (Edge Functions run on Deno)
- Git configured
- Access to Supabase project
- Environment variables configured

## Deployment Steps

### Step 1: Configure Environment Variables

**In Supabase Dashboard** (`Settings → Functions → Environment Variables`):

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
JWT_SECRET=your-random-secret-key-min-32-chars
```

**Generate secure JWT_SECRET**:
```bash
openssl rand -base64 32
```

Or use this command:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### Step 2: Deploy API Functions

**Deploy all functions at once**:
```bash
cd supabase
supabase functions deploy doctors-auth-login
supabase functions deploy doctors-auth-me
supabase functions deploy doctors-appointments
supabase functions deploy doctors-appointments-update-status
supabase functions deploy receptionists-auth-login
supabase functions deploy receptionists-appointments
```

**Or deploy all at once**:
```bash
supabase functions deploy
```

**Verify deployment**:
```bash
supabase functions list
```

Output should show:
```
✓ doctors-auth-login
✓ doctors-auth-me
✓ doctors-appointments
✓ doctors-appointments-update-status
✓ receptionists-auth-login
✓ receptionists-appointments
```

### Step 3: Test Endpoints (Post-Deployment)

**Get your base URL** from Supabase Dashboard:
- Settings → API
- Copy the `URL` field
- Append `/functions/v1/api/`

**Test doctor login**:
```bash
curl -X POST https://your-project.supabase.co/functions/v1/api/doctors/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "doctor@example.com",
    "pin": "1234",
    "clinicId": "clinic-uuid"
  }'
```

**Expected response**:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": "24h",
  "doctor": { ... }
}
```

### Step 4: Set Up Frontend Environment

**Create `.env.local` in frontend project**:

```bash
NEXT_PUBLIC_API_BASE_URL=https://your-project.supabase.co/functions/v1/api
```

Or for Vite:
```bash
VITE_API_BASE_URL=https://your-project.supabase.co/functions/v1/api
```

### Step 5: Monitor Deployment

**View function logs**:
```bash
# Real-time logs
supabase functions logs doctors-auth-login --follow

# View recent logs
supabase functions logs doctors-auth-login
```

**Check for errors**:
```bash
supabase functions logs --all --follow
```

### Step 6: Create API Documentation URL

Serve the API documentation:
- Host `API_DOCUMENTATION.md` on your docs site
- Or use: https://readme.com, https://swagger.io, https://postman.com

---

## Database Schema Validation

Before deploying APIs, ensure these tables exist:

```sql
-- Verify tables exist
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public';

-- Should include:
-- - clinics
-- - doctors
-- - receptionists
-- - appointments
-- - patients (if applicable)
```

### Run Migrations

If tables don't exist, run migrations:

```bash
supabase migration up
```

Or manually create tables:

```sql
-- See supabase/migrations/ directory for full schemas
```

---

## Testing APIs Locally

### Start Supabase Locally

```bash
supabase start
```

Functions will be at: `http://localhost:54321/functions/v1/api`

### Test Locally

```bash
curl -X POST http://localhost:54321/functions/v1/api/doctors/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "doctor@example.com",
    "pin": "1234",
    "clinicId": "clinic-123"
  }'
```

### View Local Logs

```bash
# In another terminal
supabase functions logs --follow
```

---

## Staging Deployment

### 1. Create Staging Supabase Project

```bash
# Create new project in Supabase Console
# Or use Supabase CLI to link existing project
supabase link
```

### 2. Deploy to Staging

```bash
# Option 1: Deploy to linked project
supabase functions deploy --linked

# Option 2: Deploy to specific project
supabase functions deploy --project-id <project-id>
```

### 3. Test in Staging

```bash
# Use staging URL
STAGING_URL=https://staging-project.supabase.co/functions/v1/api

curl -X POST $STAGING_URL/doctors/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "pin": "1234", "clinicId": "test"}'
```

### 4. Run Integration Tests

```bash
# Test with realistic data
npm run test:integration -- --env=staging
```

---

## Production Deployment

### Pre-Deployment Checklist

- [ ] All tests passing
- [ ] Code reviewed
- [ ] Staging deployment successful
- [ ] Load testing completed
- [ ] Error handling tested
- [ ] JWT_SECRET rotated (if changed)
- [ ] Backups created
- [ ] Rollback plan documented
- [ ] Team notified

### 1. Backup Current Production

```bash
# Backup Supabase database
supabase db dump --local > backup_$(date +%Y%m%d_%H%M%S).sql

# Or use Supabase dashboard:
# Settings → Backups → Request Backup
```

### 2. Deploy to Production

```bash
# Verify you're deploying to production project
supabase projects list

# Deploy functions
supabase functions deploy
```

### 3. Verify Production Deployment

```bash
PROD_URL=https://your-project.supabase.co/functions/v1/api

# Test doctor login
curl -X POST $PROD_URL/doctors/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "doctor@example.com",
    "pin": "1234",
    "clinicId": "clinic-uuid"
  }'

# Test receptionist login
curl -X POST $PROD_URL/receptionists/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "receptionist@example.com",
    "password": "password",
    "clinicId": "clinic-uuid"
  }'

# Test list appointments
TOKEN="<paste-token-from-login-response>"
curl -X GET $PROD_URL/doctors/appointments \
  -H "Authorization: Bearer $TOKEN"
```

### 4. Monitor Production

```bash
# Watch logs for errors
supabase functions logs --follow

# Set up alerts in Supabase dashboard
```

---

## Rollback Plan

If production deployment fails:

### Quick Rollback

```bash
# Redeploy previous version
git checkout <previous-commit>
supabase functions deploy

# Or deploy specific old version
supabase functions deploy doctors-auth-login --version <version-id>
```

### Database Rollback

```bash
# Restore from backup
supabase db restore --backup-id <backup-id>
```

---

## Performance Optimization

### 1. Enable Response Caching

Add to function responses:

```typescript
const response = new Response(
  JSON.stringify(data),
  {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300" // 5 minutes
    }
  }
);
```

### 2. Database Query Optimization

Ensure indexes exist:

```sql
-- Doctor queries
CREATE INDEX idx_doctors_email_clinic ON doctors(email, clinic_id);
CREATE INDEX idx_doctors_clinic_id ON doctors(clinic_id);

-- Receptionist queries
CREATE INDEX idx_receptionists_email_clinic ON receptionists(email, clinic_id);

-- Appointment queries
CREATE INDEX idx_appointments_clinic_date ON appointments(clinic_id, appointment_date);
CREATE INDEX idx_appointments_doctor_date ON appointments(doctor_id, appointment_date);
CREATE INDEX idx_appointments_status ON appointments(status);
```

### 3. Connection Pooling

Supabase automatically uses connection pooling for Edge Functions. No configuration needed.

---

## Monitoring & Alerting

### 1. Set Up Error Logging

Logs are available at:
- Supabase Dashboard → Functions → Logs
- Or via CLI: `supabase functions logs --follow`

### 2. Create Custom Alerts

In Supabase dashboard:
1. Go to Settings → Functions → Alerts
2. Configure thresholds for:
   - Error rate > 5%
   - Response time > 2s
   - Concurrent invocations > limit

### 3. Monitor Key Metrics

Track in your observability tool:
- Login success/failure rate
- API response times
- Error rates by endpoint
- JWT token expiration events

---

## Security Checklist

- [ ] JWT_SECRET is strong and rotated regularly
- [ ] Service role key is kept secret (never exposed to client)
- [ ] CORS configured appropriately
- [ ] Rate limiting implemented
- [ ] Request validation on all endpoints
- [ ] SQL injection prevention (use parameterized queries)
- [ ] XSS prevention (sanitize output)
- [ ] CSRF tokens implemented (if needed)
- [ ] Password hashing using bcrypt
- [ ] PIN hashing using bcrypt
- [ ] HTTPS enforced
- [ ] API logs don't contain sensitive data

---

## Troubleshooting

### API Functions Not Deploying

```bash
# Check for syntax errors
deno check functions/api/doctors-auth-login.ts

# View detailed error
supabase functions deploy doctors-auth-login --verbose
```

### 401 Unauthorized Errors

```bash
# Verify JWT_SECRET environment variable
supabase env list

# Check token is being sent correctly
# Should be: Authorization: Bearer <token>
# NOT: Authorization: <token>
```

### Database Connection Errors

```bash
# Verify SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
supabase env list

# Test connection
curl -X GET "https://your-project.supabase.co/rest/v1/" \
  -H "apikey: your-anon-key" \
  -H "Authorization: Bearer your-service-role-key"
```

### High Response Times

```bash
# Check database query performance
EXPLAIN ANALYZE SELECT * FROM appointments WHERE clinic_id = 'xxx';

# Add indexes if needed
CREATE INDEX idx_appointments_clinic_date ON appointments(clinic_id, appointment_date);
```

### Rate Limiting Issues

Currently no rate limiting implemented. Add in next iteration:
- Store failed login attempts in Redis
- Lock account after 3 failed attempts for 15 minutes
- Implement API call throttling (100 req/min per user)

---

## Updating APIs

### Deploy Single Function Update

```bash
# Make changes to function
vim functions/api/doctors-auth-login.ts

# Deploy only that function
supabase functions deploy doctors-auth-login

# Verify deployment
curl -X POST https://your-project.supabase.co/functions/v1/api/doctors/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "pin": "1234", "clinicId": "test"}'
```

### Deploy All Functions

```bash
# Deploy all updated functions
supabase functions deploy

# Verify all deployed
supabase functions list
```

---

## Next Steps

- [ ] Implement rate limiting middleware
- [ ] Add API request/response logging
- [ ] Set up API analytics
- [ ] Create API monitoring dashboard
- [ ] Implement automatic token refresh
- [ ] Add request validation middleware
- [ ] Set up CI/CD pipeline for auto-deploy on commits
- [ ] Create Postman collection for testing
- [ ] Document API versioning strategy
- [ ] Plan for future API versioning (v2, v3, etc.)
