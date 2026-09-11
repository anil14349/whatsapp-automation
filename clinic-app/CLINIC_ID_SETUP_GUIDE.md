# CLINIC_ID Setup Guide

**Version:** 1.0  
**Date:** September 11, 2026  
**Purpose:** Get your CLINIC_ID for Vercel deployment

---

## 🆔 What is CLINIC_ID?

### Definition
```
CLINIC_ID = Unique identifier (UUID) for your clinic in the database
```

### Why You Need It
- ✅ Identifies which clinic's data to access
- ✅ Isolates data between multiple clinics
- ✅ Required for WhatsApp webhook processing
- ✅ Links all appointments, patients, messages to your clinic
- ✅ Enables row-level security (RLS) policies

### Format
```
UUID Format: 550e8400-e29b-41d4-a716-446655440000
Length: 36 characters (including hyphens)
```

---

## 📋 Data Flow with CLINIC_ID

```
WhatsApp Message Received
        ↓
Webhook identifies clinic from CLINIC_ID
        ↓
Processes message for that clinic only
        ↓
Stores in database with clinic_id
        ↓
Admin user sees only their clinic's data (via RLS)
```

**Example:**
```
Patient sends message to: +919876543210 (Clinic A's WhatsApp)
        ↓
App processes with: CLINIC_ID=clinic-a-uuid
        ↓
Creates appointment record with clinic_id=clinic-a-uuid
        ↓
Clinic A admin sees it
        ↓
Clinic B admin does NOT see it (RLS prevents access)
```

---

## 🔍 How to Get Your CLINIC_ID

### Method 1: Find Existing Clinic (Recommended)

**Step 1: Open Supabase SQL Editor**

1. Go to [supabase.com](https://supabase.com)
2. Login to your account
3. Select your project
4. Left sidebar → **"SQL Editor"**
5. Click **"New Query"**

**Step 2: Run Query to List Clinics**

Copy and paste this query:

```sql
SELECT id, name, email, phone FROM clinics LIMIT 10;
```

Click the green **"Run"** button (or Ctrl+Enter)

**Step 3: Find Your Clinic**

You'll see results like:

```
id                                    | name              | email              | phone
──────────────────────────────────────┼──────────────────┼────────────────────┼───────────────
550e8400-e29b-41d4-a716-446655440000 | City Clinic       | clinic@city.com    | +919876543210
a3c5d2e1-f9b0-48c6-b5e2-9f3d7c1a6b2f | Metro Hospital    | metro@hospital.com | +919876543211
```

**Step 4: Copy the ID**

Right-click on the `id` value → Copy

**Example:**
```
Use: 550e8400-e29b-41d4-a716-446655440000
```

---

### Method 2: Create New Clinic (If Testing)

**Step 1: Open SQL Editor**

(Same as Method 1, Step 1)

**Step 2: Create New Clinic**

```sql
INSERT INTO clinics (name, email, phone, timezone)
VALUES (
  'Your Clinic Name',
  'your-email@clinic.com',
  '+919876543210',
  'Asia/Kolkata'
)
RETURNING id;
```

**Step 3: Replace Values**

```sql
-- Example with real values:
INSERT INTO clinics (name, email, phone, timezone)
VALUES (
  'Rajesh Medical Center',
  'rajesh@medicalcenter.com',
  '+919876543210',
  'Asia/Kolkata'
)
RETURNING id;
```

**Step 4: Click Run**

Result:
```
id
──────────────────────────────────────
550e8400-e29b-41d4-a716-446655440000
```

**Step 5: Copy the ID**

The `id` value is your CLINIC_ID

---

### Method 3: Find Clinic with Admin User

If you want to use an existing clinic that already has an admin account:

```sql
SELECT au.clinic_id, c.name, au.full_name, au.email
FROM admin_users au
JOIN clinics c ON c.id = au.clinic_id
LIMIT 5;
```

Results show:

```
clinic_id                             | name              | full_name      | email
──────────────────────────────────────┼──────────────────┼────────────────┼──────────────────
550e8400-e29b-41d4-a716-446655440000 | City Clinic       | Dr. Rajesh     | rajesh@clinic.com
a3c5d2e1-f9b0-48c6-b5e2-9f3d7c1a6b2f | Metro Hospital    | Dr. Priya      | priya@metro.com
```

Pick one and copy the `clinic_id` value

---

## 💾 Now You Have CLINIC_ID

You should now have:
```
✅ WHATSAPP_VERIFY_TOKEN = your_secure_token_here
✅ CLINIC_ID = 550e8400-e29b-41d4-a716-446655440000
```

---

## 🚀 Add to Vercel

### Step 1: Open Vercel Dashboard

1. Go to [vercel.com](https://vercel.com)
2. Login to your account
3. Select your staging project

### Step 2: Go to Settings

1. Click on your project
2. Top menu → **"Settings"**

### Step 3: Add Environment Variables

1. Left sidebar → **"Environment Variables"**
2. Click **"Add New"**

### Step 4: Add CLINIC_ID

```
Name:  CLINIC_ID
Value: 550e8400-e29b-41d4-a716-446655440000
```

Leave "Select Environments" as: Production, Preview, Development

Click **"Save"**

### Step 5: Add WHATSAPP_VERIFY_TOKEN (if not already set)

```
Name:  WHATSAPP_VERIFY_TOKEN
Value: your_secure_token_here
```

Click **"Save"**

### Step 6: Verify All Variables

You should see:
```
✅ WHATSAPP_VERIFY_TOKEN = ••••••••••
✅ CLINIC_ID = 550e8400-e29b-41d4-a716-446655440000
✅ SUPABASE_URL = https://your-project.supabase.co
✅ SUPABASE_ANON_KEY = ••••••••••
✅ SUPABASE_SERVICE_ROLE_KEY = ••••••••••
```

(Other keys might be hidden with dots)

---

## 🔄 Redeploy on Vercel

### Option A: Automatic (If connected to GitHub)

Environment variables update automatically. Just wait 5 minutes or trigger redeploy:

1. Go to project dashboard
2. **"Deployments"** tab
3. Find latest deployment
4. Click the 3 dots (**...**)
5. Click **"Redeploy"**

### Option B: Manual Deploy

```bash
# If you have Vercel CLI installed
vercel --prod

# Or push to GitHub (if connected)
git push origin main
```

Wait for deployment to complete (~2-3 minutes)

---

## ✅ Verify Deployment

### Step 1: Check Deployment Status

1. Vercel Dashboard → **"Deployments"**
2. Latest deployment should show: **✅ Ready**

### Step 2: Test Webhook Endpoint

Open terminal and run:

```bash
curl -X GET "https://your-staging.vercel.app/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=YOUR_VERIFY_TOKEN&hub.challenge=test123"
```

Replace:
- `your-staging.vercel.app` → Your actual Vercel URL
- `YOUR_VERIFY_TOKEN` → Your actual token

Expected response:
```
test123
```

If you get this, webhook is working! ✅

### Step 3: Check Admin Dashboard

Open in browser:
```
https://your-staging.vercel.app/admin
```

Should load admin login page ✅

---

## 📱 Configure WhatsApp

### Step 1: Go to WhatsApp Business Settings

1. [business.facebook.com](https://business.facebook.com)
2. Login
3. Select your WhatsApp Business Account
4. Go to **"Settings" → "Webhooks"**

### Step 2: Add Webhook URL

```
Webhook URL: https://your-staging.vercel.app/api/webhooks/whatsapp
Verify Token: your_verify_token_here
```

Click **"Verify and Save"**

### Step 3: Subscribe to Events

Make sure these are checked:
- ✅ `messages`
- ✅ `message_status`
- ✅ `message_template_status_update` (optional)

### Step 4: Save

Click **"Save"**

---

## 🧪 Test the System

### Send Test Message

1. Open WhatsApp on your phone
2. Message the business account with a test message:
   ```
   "book appointment"
   ```

### Check Admin Dashboard

1. Go to: `https://your-staging.vercel.app/admin`
2. Navigate to: **"Webhooks"**
3. Look for **"Recent Events"**
4. Should see your message logged ✅

### Check Patient Requests

1. Go to: **"Patient Requests"**
2. Should see a new booking request from your message ✅

### Check Message Tracking

1. Go to: **"Message Tracking"**
2. Should see the message with status ✅

---

## 🚨 Troubleshooting

### Problem: "Webhook verification failed"

**Cause:** CLINIC_ID or WHATSAPP_VERIFY_TOKEN is wrong

**Solution:**
1. Double-check both values in Vercel
2. Verify they match your database/WhatsApp settings
3. Redeploy
4. Try webhook verification again

### Problem: "No events showing in admin"

**Cause:** Message not reaching webhook or CLINIC_ID wrong

**Solution:**
1. Verify webhook URL is accessible:
   ```bash
   curl https://your-staging.vercel.app/api/webhooks/whatsapp
   # Should return error (not 404)
   ```
2. Check CLINIC_ID is correct in database
3. Check Vercel logs for errors

### Problem: "Admin dashboard shows no data"

**Cause:** CLINIC_ID doesn't match logged-in user's clinic

**Solution:**
1. Verify admin user has same clinic_id
2. Check RLS policies are enabled
3. Try logging in with different admin account

---

## 📋 Summary Checklist

- [ ] Found or created CLINIC_ID
- [ ] Added CLINIC_ID to Vercel environment
- [ ] Added WHATSAPP_VERIFY_TOKEN to Vercel environment
- [ ] Redeployed on Vercel
- [ ] Verified webhook endpoint (curl test)
- [ ] Configured WhatsApp webhook URL
- [ ] Subscribed to messages & message_status events
- [ ] Sent test WhatsApp message
- [ ] Saw message in admin dashboard
- [ ] Verified all 3 admin pages load (webhooks, patient-requests, message-tracking)

---

## ✨ Ready!

Once all checkboxes are done, your staging system is ready for testing! 🚀

**Next Steps:**
1. Send various test messages ("book", "lab", "results", "help")
2. Monitor admin dashboards
3. Check logs for any errors
4. Document any issues

---

## 📞 Quick Reference

### Your Values (Fill In)

```
CLINIC_ID: ____________________________________
WHATSAPP_VERIFY_TOKEN: ____________________________________
CLINIC_NAME: ____________________________________
VERCEL_URL: https://______________________________.vercel.app
SUPABASE_PROJECT: ____________________________________
```

### Useful URLs

```
Vercel Dashboard: https://vercel.com/dashboard
Supabase Dashboard: https://supabase.com/dashboard
WhatsApp Business: https://business.facebook.com
Admin Dashboard: https://your-url.vercel.app/admin
Webhooks Settings: https://your-url.vercel.app/admin/webhooks
```

### Useful Commands

```bash
# Test webhook
curl -X GET "https://your-url.vercel.app/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=TOKEN&hub.challenge=test123"

# Check if app is running
curl https://your-url.vercel.app/health

# View Vercel logs
vercel logs --follow
```

---

**Version:** 1.0  
**Last Updated:** September 11, 2026  
**Status:** Ready for Use

For more help, see:
- DEPLOYMENT_GUIDE.md - Full deployment instructions
- QUICKSTART_GUIDE.md - Feature overview
- WHATSAPP_WEBHOOK_GUIDE.md - Architecture details
