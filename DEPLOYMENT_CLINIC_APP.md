# Deployment Guide: clinic-app (Modern Next.js + Supabase)

This guide covers deploying the modern WhatsApp booking system using Next.js, Supabase (PostgreSQL), and Vercel.

**Recommended for**: Production deployments, high traffic, need admin portal, advanced analytics.

---

## Prerequisites

- Meta/Facebook Business Account with WhatsApp Business API
- Supabase account (free tier available at [supabase.com](https://supabase.com))
- Vercel account (free tier available at [vercel.com](https://vercel.com))
- Node.js 20+ installed locally
- Git and GitHub account (recommended)
- WhatsApp Phone Number ID & Access Token
- Docker Desktop (optional, for local database testing)

---

## Step 1: Set Up Supabase Project

### 1.1 Create Supabase Project

1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Click **New project**
3. Configure:
   - **Project name**: `abc-clinic-whatsapp`
   - **Database password**: Generate strong password (copy it)
   - **Region**: Choose closest to your location
   - **Pricing Plan**: Free (or Pro if expecting high traffic)
4. Click **Create new project** (wait ~2 min)

### 1.2 Get Connection Strings

1. Go to **Project Settings** (⚙️) → **Database**
2. Copy and save these:
   - **Connection string (URI)**
   - **Direct URL** (for Next.js)
   - **Project URL** (API endpoint)
   - **anon key** (public key)
   - **service_role key** (secret key)

Example URLs:
```
# Database connection
postgresql://postgres:[PASSWORD]@db.example.supabase.co:5432/postgres

# API URL
https://example.supabase.co

# Keys
NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbG...
SUPABASE_SERVICE_ROLE_KEY=eyJhbG...
```

### 1.3 Initialize Database Schema

1. Clone the repository:
   ```bash
   git clone https://github.com/your-org/whatsapp-automation.git
   cd whatsapp-automation/clinic-app
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create `.env.local` file (see Step 2 for full details):
   ```bash
   cp .env.example .env.local
   ```

4. Add Supabase credentials to `.env.local`:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbG...
   SUPABASE_SERVICE_ROLE_KEY=eyJhbG...
   ```

5. Run migrations:
   ```bash
   npm run db:push
   ```
   This will:
   - Create all tables (appointments, patients, doctors, etc.)
   - Set up constraints and indexes
   - Initialize default settings

### 1.4 Verify Schema

1. Go to Supabase Dashboard → **SQL Editor**
2. Run query to verify tables:
   ```sql
   SELECT table_name 
   FROM information_schema.tables 
   WHERE table_schema = 'public'
   ORDER BY table_name;
   ```
3. You should see:
   - `appointments`
   - `patients`
   - `doctors`
   - `doctor_availability`
   - `doctor_leaves`
   - `whatsapp_sessions`
   - `home_collection_requests`
   - `message_log`
   - `auth.users` (automatically created)

---

## Step 2: Configure Environment Variables

### 2.1 Create .env.local File

In `clinic-app/` directory, create `.env.local`:

```bash
# Copy from example
cp .env.example .env.local

# Edit with your values
nano .env.local
```

### 2.2 Fill All Required Variables

```env
# ============ SUPABASE ============
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbG...
SUPABASE_SERVICE_ROLE_KEY=eyJhbG...

# ============ WHATSAPP ============
WHATSAPP_PHONE_NUMBER_ID=1234567890123
WHATSAPP_ACCESS_TOKEN=EAAxxxxxxxxx...
WHATSAPP_WEBHOOK_POST_TOKEN=my_secure_random_token_here

# ============ CLINIC CONFIG ============
CLINIC_TIMEZONE=Asia/Kolkata
CLINIC_NAME=ABC Clinic
CLINIC_PHONE=+91-XXXX-XXXX
CLINIC_EMAIL=clinic@example.com
CLINIC_WELCOME_MESSAGE=Welcome to ABC Clinic!

# ============ ADMIN PORTAL ============
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ADMIN_SESSION_SECRET=your_long_random_secret_here

# ============ OPTIONAL ============
# Home collection
HOSPITAL_LOCATION=17.3850,78.4867
HOME_COLLECTION_RADIUS_KM=5

# Google Calendar (if syncing doctor availability)
GOOGLE_CALENDAR_ID=your-calendar@gmail.com
GOOGLE_CALENDAR_API_KEY=AIza...

# WhatsApp Flow IDs (if using native flows)
WHATSAPP_FLOW_ID=flow_id_here
WHATSAPP_FLOW_VERSION=1

# Email notifications (optional)
SENDGRID_API_KEY=SG.xxxx...
ADMIN_EMAIL=admin@clinic.com

# Debug
DEBUG=false
```

### 2.3 Secure the .env.local File

```bash
# Add to .gitignore (IMPORTANT - never commit secrets)
echo ".env.local" >> .gitignore

# Verify it's not tracked
git status | grep .env.local  # Should be empty
```

---

## Step 3: Add Clinic Data to Database

### 3.1 Add Doctors

Option A: **Direct SQL** (fastest):

Go to Supabase → **SQL Editor** → Run:

```sql
INSERT INTO doctors (name, specialization, appointment_duration_minutes, created_at) VALUES
  ('Dr. Sharma', 'General', 30, NOW()),
  ('Dr. Patel', 'Cardiology', 45, NOW()),
  ('Dr. Singh', 'Pediatrics', 30, NOW());
```

Option B: **Admin Portal** (after deployment):
1. Log in to admin portal
2. Go to **Doctors** tab
3. Click **+ Add Doctor**
4. Fill form and save

### 3.2 Add Doctor Availability

Go to Supabase → **SQL Editor**:

```sql
-- Dr. Sharma: Mon-Fri, 9am-5pm
INSERT INTO doctor_availability (doctor_id, day_of_week, start_time, end_time) 
SELECT id, day, '09:00'::time, '17:00'::time 
FROM doctors, 
  (VALUES (1), (2), (3), (4), (5)) AS days(day)
WHERE doctors.name = 'Dr. Sharma';

-- Dr. Patel: Mon/Wed/Fri, 10am-4pm
INSERT INTO doctor_availability (doctor_id, day_of_week, start_time, end_time) 
SELECT id, day, '10:00'::time, '16:00'::time 
FROM doctors, 
  (VALUES (1), (3), (5)) AS days(day)
WHERE doctors.name = 'Dr. Patel';
```

### 3.3 Add Admin User

```bash
# Generate first admin user (replace with your email)
npm run create-admin -- --email admin@clinic.com

# You'll be prompted for password
# Output: Admin user created with credentials
```

---

## Step 4: Test Locally

### 4.1 Install Dependencies

```bash
cd clinic-app
npm install
```

### 4.2 Start Local Database (Optional)

If you want to test with local Supabase instance:

```bash
# Start Supabase local development
npm run db:start

# This requires Docker Desktop running
# Check logs: docker logs supabase_db
```

### 4.3 Run Development Server

```bash
npm run dev

# Open http://localhost:3000
```

### 4.4 Test Patient Flow

1. Open WhatsApp on your phone
2. Send message to clinic number: `Hi` or `1` (Book)
3. Follow booking flow
4. Check Supabase: **message_log** table for logged messages

### 4.5 Test Admin Portal

1. Go to `http://localhost:3000/admin`
2. Log in with admin credentials from Step 3.3
3. Verify:
   - ✅ Doctors listed
   - ✅ Appointments show (if any booked)
   - ✅ Settings page accessible

### 4.6 Test Webhook Locally (Optional)

Use ngrok to expose local server to Internet:

```bash
# Install ngrok: https://ngrok.com/download
ngrok http 3000

# Copy the generated HTTPS URL (e.g., https://xxxxx.ngrok.io)
# Use this for webhook configuration in Meta dashboard (Step 5.2)
```

---

## Step 5: Deploy to Vercel

### 5.1 Push Code to GitHub

```bash
cd whatsapp-automation

# Create branch for deployment
git checkout -b deploy/clinic-app

# Add clinic-app to staging (if not already)
git add clinic-app/
git commit -m "Add clinic-app for deployment"

# Push to GitHub
git push origin deploy/clinic-app
```

### 5.2 Connect to Vercel

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Click **Add New** → **Project**
3. Select your GitHub repository
4. Configure:
   - **Framework**: Next.js
   - **Root Directory**: `clinic-app`
   - **Build Command**: `npm run build`
   - **Output Directory**: `.next`

### 5.3 Add Environment Variables to Vercel

1. In Vercel project settings, go to **Settings** → **Environment Variables**
2. Add all variables from `.env.local`:
   - Copy each variable from your local `.env.local`
   - Paste into Vercel environment variables
   - **Select environments**: Production, Preview, Development

3. Important variables to add:
   ```
   NEXT_PUBLIC_SUPABASE_URL
   NEXT_PUBLIC_SUPABASE_ANON_KEY
   SUPABASE_SERVICE_ROLE_KEY
   WHATSAPP_PHONE_NUMBER_ID
   WHATSAPP_ACCESS_TOKEN
   WHATSAPP_WEBHOOK_POST_TOKEN
   ADMIN_SESSION_SECRET
   CLINIC_TIMEZONE
   CLINIC_NAME
   ```

### 5.4 Deploy

1. Click **Deploy**
2. Wait for build to complete (~3-5 minutes)
3. Once deployed, you'll get a URL like: `https://abc-clinic-xxxx.vercel.app`

### 5.5 Verify Deployment

```bash
# Test the deployment
curl https://abc-clinic-xxxx.vercel.app/api/health

# Should return: {"status":"ok"}
```

---

## Step 6: Configure WhatsApp Webhook

### 6.1 Get Your Deployment URL

From Vercel dashboard, copy your production URL:
```
https://abc-clinic-xxxx.vercel.app
```

### 6.2 Register Webhook with Meta

1. Go to [Meta App Dashboard](https://developers.facebook.com)
2. Select your WhatsApp app
3. Go to **Configuration** → **Webhooks**
4. Click **Edit subscription**
5. Enter:
   - **Callback URL**: `https://abc-clinic-xxxx.vercel.app/api/whatsapp/webhook`
   - **Verify Token**: Same as `WHATSAPP_WEBHOOK_POST_TOKEN` in env
6. Click **Verify and Save**

### 6.3 Subscribe to Events

In the **Webhooks** section, ensure these are selected:
- ✅ `messages`
- ✅ `message_status`
- ✅ `message_template_status_update`

---

## Step 7: Test Production Deployment

### 7.1 Send Test Message from WhatsApp

1. From your phone, send message to clinic WhatsApp number
2. Expected response: Welcome message with main menu
3. Test booking flow end-to-end

### 7.2 Check Message Logs

1. Go to admin portal: `https://abc-clinic-xxxx.vercel.app/admin`
2. Messages should appear in analytics/logs
3. Appointments should save to database

### 7.3 Monitor Errors

1. In Vercel dashboard, go to **Deployments** → **Logs**
2. Check for any errors
3. Use **Real-time Logs** tab to watch live requests

### 7.4 Test All Flows

- [ ] Send `1` - Book appointment
- [ ] Follow doctor selection
- [ ] Select date and time
- [ ] Confirm booking
- [ ] Check appointment in admin portal
- [ ] Send `*` - Test "More" menu
- [ ] Select home collection
- [ ] Share location
- [ ] Verify request saved

---

## Step 8: Set Up Admin Portal Access

### 8.1 Create Additional Admin Users

```bash
# Create admin from command line
npm run create-admin -- --email another@clinic.com
```

Or from admin portal:
1. Log in with first admin account
2. Go to **Settings** → **Manage Admins**
3. Click **+ Add Admin**
4. Enter email, send invite link

### 8.2 Configure Admin Settings

1. Go to admin portal
2. **Settings** page:
   - Set clinic timezone
   - Configure appointment duration
   - Set max booking days ahead
   - Enable/disable features

### 8.3 Share Access with Team

1. Send admin portal URL to team: `https://abc-clinic-xxxx.vercel.app/admin`
2. Each team member creates account with their email
3. Set their role (Admin/Doctor/Staff)

---

## Step 9: Production Monitoring

### 9.1 Set Up Alerts

Vercel can notify you of errors:
1. Go to **Settings** → **Notifications**
2. Enable:
   - ✅ Deployment errors
   - ✅ Build failures
   - ✅ Errors on production

### 9.2 Monitor Database

1. Supabase Dashboard → **Logs**
2. Watch for errors in database queries
3. Check slow query logs

### 9.3 Daily Checks

- [ ] Check morning deployment logs
- [ ] Verify no pending error notifications
- [ ] Sample 5 recent appointments for accuracy
- [ ] Check admin portal is accessible

---

## Step 10: Backup & Disaster Recovery

### 10.1 Set Up Database Backups

In Supabase Dashboard:
1. Go to **Settings** → **Backups**
2. Enable automatic backups (Pro tier feature)
3. Or manually backup:
   ```bash
   # Export database
   pg_dump "postgresql://postgres:PASSWORD@db.supabase.co:5432/postgres" > backup.sql
   ```

### 10.2 Backup Verification

Weekly:
1. Verify latest backup exists in Supabase
2. Test restore process (on staging environment)

---

## Step 11: Scaling & Optimization

### 11.1 Monitor Performance

In Vercel Analytics:
- View FCP (First Contentful Paint)
- Check API response times
- Monitor serverless function duration

### 11.2 Database Optimization

If you see slow queries:
1. Supabase Dashboard → **Database** → **Indexes**
2. Ensure indexes exist on:
   - `appointments.patient_phone`
   - `appointments.doctor_id`
   - `appointments.appointment_date`
   - `whatsapp_sessions.sender_phone`

### 11.3 Upgrade if Needed

- **Free tier**: ~1,000 messages/day, suitable for small clinics
- **Pro tier**: Unlimited (pay per usage), recommended for larger deployments

---

## Troubleshooting

### Issue: "Webhook verification failed"

**Solution:**
- Verify `WHATSAPP_WEBHOOK_POST_TOKEN` matches in Meta dashboard
- Check webhook URL is correct: `https://abc-clinic-xxxx.vercel.app/api/whatsapp/webhook`
- Wait 2-3 min for DNS propagation

### Issue: "Messages not appearing in chat"

**Solution:**
- Check Vercel logs for errors
- Verify `WHATSAPP_ACCESS_TOKEN` is correct and not expired
- Test webhook manually:
  ```bash
  curl -X POST https://abc-clinic-xxxx.vercel.app/api/whatsapp/webhook \
    -H "Content-Type: application/json" \
    -d '{"object":"whatsapp_business_account","entry":[{"changes":[{"value":{"messages":[{"from":"1234567890","text":{"body":"test"}}]}}]}]}'
  ```

### Issue: "Appointments not saving"

**Solution:**
- Check Supabase connection: verify `NEXT_PUBLIC_SUPABASE_URL` and keys
- View Supabase logs for database errors
- Check `message_log` table for error details

### Issue: "Admin portal won't load"

**Solution:**
- Clear browser cache
- Check you're using the correct URL
- Verify `ADMIN_SESSION_SECRET` is set
- Create new admin user if password issue

### Issue: "Out of memory" or "Database connection issues"

**Solution:**
- Upgrade Supabase plan (free tier has limits)
- Check for stale connections
- Implement connection pooling:
  ```env
  DATABASE_URL="...?schema=public&pgbouncer=true"
  ```

---

## Maintenance

### Daily
- Monitor error logs
- Check admin portal loads correctly

### Weekly
- Review appointment data for errors
- Backup database
- Check uptime

### Monthly
- Review analytics
- Update dependencies: `npm update`
- Check WhatsApp API token expiration

### Quarterly
- Performance review
- Security updates
- Archive old data (>1 year)

---

## Migration from Apps Script

If migrating from the old `.gs` system:

1. **Export data from Google Sheets**
   ```bash
   npm run migrate:from-sheets -- --sheet-id XXXXX
   ```

2. **Verify data integrity**
   - Check doctor count matches
   - Verify appointment history

3. **Run parallel**
   - Keep old system running for 1 week
   - Monitor clinic-app logs
   - Switch traffic completely only after confidence

---

## Next Steps

- Configure email notifications (SendGrid)
- Set up analytics dashboard
- Add booking confirmations via SMS
- Integrate with clinic's internal systems
- Custom branding/styling

For support, check logs in Vercel and Supabase dashboards.

