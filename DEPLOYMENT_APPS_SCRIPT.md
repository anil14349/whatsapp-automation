# Deployment Guide: Google Apps Script (Old System)

This guide covers deploying the original WhatsApp bot using Google Apps Script and Google Sheets.

## Prerequisites

- Google Account with access to Google Drive
- Google Apps Script enabled in your domain
- Meta/Facebook Business Account with WhatsApp Business API access
- WhatsApp Business Account Phone Number ID
- WhatsApp Cloud API Access Token
- Admin access to configure webhooks

---

## Step 1: Set Up Google Sheet Database

### 1.1 Create a New Google Sheet

1. Go to [Google Drive](https://drive.google.com)
2. Click **+ New** → **Google Sheets** → **Blank spreadsheet**
3. Name it: `ABC_Clinic_WhatsApp_Database`
4. Share with your clinic team (set permissions to "Editor")

### 1.2 Note the Sheet ID

- From the URL: `https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit`
- Copy the `SHEET_ID` (you'll need this later)

### 1.3 Initialize Sheet Tabs

The sheets will be auto-created by the script, but you can pre-create these tabs:
- `Doctors` — Doctor availability and info
- `Patients` — Patient records
- `Appointments` — Booked appointments
- `Sessions` — Active chat sessions
- `Home_Collection_Requests` — Home sample collection requests
- `Analytics` — Booking analytics
- `Settings` — Clinic configuration

---

## Step 2: Set Up Google Apps Script Project

### 2.1 Create Apps Script Project

1. Go to [script.google.com](https://script.google.com)
2. Click **New project**
3. Name it: `ABC_Clinic_WhatsApp_Bot`

### 2.2 Copy Source Files

1. Clone or download the repository:
   ```bash
   git clone https://github.com/your-org/whatsapp-automation.git
   cd whatsapp-automation
   ```

2. Copy all `.gs` files from `src/` directory into the Apps Script editor:
   - `Config.gs`
   - `Controller_*.gs` (Router, PatientFlow, DoctorFlow, HomeCollection, Shared)
   - `Model_*.gs` (Appointments, Patients, Doctors, HomeCollection, Session, etc.)
   - `View_*.gs` (Menus, Messages)
   - `Util_*.gs` (Common, Distance)
   - `WhatsApp_Send.gs`
   - `Webhook.gs`
   - `Setup.gs`
   - `Logging.gs`

3. In Apps Script editor, create files for each `.gs` file:
   - Click **+ Create new** → **Script**
   - Copy-paste content from each file
   - Name the file (e.g., `Config`, `Controller_Router`, etc.)

### 2.3 Link to Google Sheet

1. In Apps Script, go to **Project Settings** (⚙️)
2. Copy the **Script ID**
3. Click the **Sheet icon** to link to your Google Sheet
4. Select the `ABC_Clinic_WhatsApp_Database` sheet you created in Step 1

---

## Step 3: Configure Script Properties (Secrets)

### 3.1 Access Script Properties

1. In Apps Script, click **Project Settings** (⚙️)
2. Scroll to **Script Properties**
3. Add each of the following properties:

### 3.2 Required Properties

| Property | Value | Example |
|----------|-------|---------|
| `SHEET_ID` | Your Google Sheet ID | `1a2b3c4d5e6f...` |
| `WHATSAPP_PHONE_NUMBER_ID` | Your WhatsApp Business Phone Number ID | `1234567890123` |
| `WHATSAPP_ACCESS_TOKEN` | WhatsApp Cloud API token | `EAAxx...` |
| `WHATSAPP_WEBHOOK_POST_TOKEN` | Random token for webhook validation | `my_secure_token_123` |
| `CLINIC_NAME` | Your clinic name | `ABC Clinic` |
| `CLINIC_TIMEZONE` | Timezone (Asia/Kolkata, etc.) | `Asia/Kolkata` |
| `CLINIC_PHONE` | Clinic contact number | `+91-XXXX-XXXX` |

### 3.3 Optional Properties

| Property | Purpose | Default |
|----------|---------|---------|
| `HOSPITAL_LOCATION` | Lat,long for home collection radius (e.g., "17.3850,78.4867") | `` |
| `HOME_COLLECTION_RADIUS_KM` | Distance radius for home collection | `5` |
| `GOOGLE_CALENDAR_ID` | Google Calendar for doctor availability sync | `` |
| `APPOINTMENT_REMINDER_HOURS` | Hours before appointment to send reminder | `24` |
| `MAX_BOOKING_DAYS_AHEAD` | How many days ahead patients can book | `30` |
| `ADMIN_EMAIL` | Email for error notifications | `` |
| `DEBUG_MODE` | Log all messages to console | `false` |

### 3.4 Save Properties

Click **Save** for each property.

---

## Step 4: Initialize the Database

### 4.1 Run Setup Function

1. In Apps Script editor, go to the **Editor** tab
2. Select function `setupDatabase()` from the dropdown
3. Click **▶ Run** (play button)
4. Authorize access when prompted:
   - Click **Review permissions**
   - Select your Google Account
   - Click **Allow**

### 4.2 Verify Sheet Creation

1. Go back to your Google Sheet
2. Verify these tabs are created:
   - ✅ Doctors
   - ✅ Patients
   - ✅ Appointments
   - ✅ Sessions
   - ✅ Home_Collection_Requests
   - ✅ Settings

### 4.3 Add Clinic Data

**Doctors Sheet:**
- Column A: Doctor ID (auto-generate or use name)
- Column B: Doctor Name
- Column C: Specialization
- Column D: Available Days (e.g., "Mon,Tue,Wed,Thu,Fri")
- Column E: Start Time (e.g., "09:00")
- Column F: End Time (e.g., "17:00")
- Column G: Appointment Duration (minutes, e.g., 30)

**Settings Sheet:**
- Row 1: Setting Name | Setting Value
- Example rows:
  - `CLINIC_WELCOME_MESSAGE` | "Welcome to ABC Clinic!"
  - `APPOINTMENT_CONFIRMATION_TEMPLATE` | "Your appointment..."

---

## Step 5: Configure WhatsApp Webhook

### 5.1 Deploy Apps Script as Web App

1. In Apps Script, click **Deploy** (⬆️)
2. Click **New deployment** → **Select type** → **Web app**
3. Configure:
   - **Execute as**: Your Google Account
   - **Who has access**: Anyone
4. Click **Deploy**
5. Copy the **Deployment URL** (you'll use this for webhook)

### 5.2 Register Webhook with Meta

1. Go to [Meta App Dashboard](https://developers.facebook.com)
2. Select your WhatsApp app
3. Go to **Configuration** → **Webhooks**
4. Click **Edit subscription**
5. Enter:
   - **Callback URL**: `{DEPLOYMENT_URL}?post_token={WHATSAPP_WEBHOOK_POST_TOKEN}`
   - **Verify Token**: `{WHATSAPP_WEBHOOK_POST_TOKEN}` (same as Script Property)
6. Click **Verify and Save**

### 5.3 Subscribe to Events

1. In Webhooks section, click **Subscribe to this field** for each:
   - ✅ `messages` (receive incoming messages)
   - ✅ `message_template_status_update` (template status)
   - ✅ `message_status` (delivery receipts)

---

## Step 6: Add Doctor Availability

### 6.1 Manual Entry (Quick Setup)

1. Go to **Doctors** sheet
2. Add each doctor:

| Doctor ID | Name | Specialization | Days | Start | End | Duration |
|-----------|------|-----------------|------|-------|-----|----------|
| DOC001 | Dr. Sharma | General | Mon,Tue,Wed,Thu,Fri | 09:00 | 17:00 | 30 |
| DOC002 | Dr. Patel | Cardiology | Mon,Wed,Fri | 10:00 | 16:00 | 45 |

### 6.2 Google Calendar Sync (Optional)

If using Google Calendar:
1. Create a Google Calendar for each doctor
2. Set `GOOGLE_CALENDAR_ID` in Script Properties
3. The bot will sync availability from calendar

---

## Step 7: Deploy and Test

### 7.1 Test Webhook Verification

1. In Apps Script, run function `testWebhookVerification()`
2. Check logs for success message

### 7.2 Send Test Message

1. Go to your WhatsApp Business Account in Meta
2. Send a test message from your phone:
   ```
   Hi, please book appointment
   ```
3. Check logs in Apps Script (**View** → **Logs**)
4. You should see the message logged

### 7.3 Test Booking Flow

1. From WhatsApp, send: `1` (Book Appointment)
2. Follow the menu prompts
3. Book an appointment
4. Verify it appears in the **Appointments** sheet

### 7.4 Test Home Collection

1. From WhatsApp, send: `*` (More Menu)
2. Select: `6️⃣ Home Sample Collection`
3. Share your location
4. Verify request appears in **Home_Collection_Requests** sheet

---

## Step 8: Set Up Monitoring & Logging

### 8.1 Enable Logging

1. Set `DEBUG_MODE = true` in Script Properties (for testing)
2. View logs: **View** → **Logs**

### 8.2 Error Notifications (Optional)

1. Set `ADMIN_EMAIL` in Script Properties
2. Modify `Logging.gs` to send emails on errors

### 8.3 Analytics Dashboard

1. Go to **Analytics** sheet
2. Create formulas to track:
   - Total appointments booked
   - Cancellations
   - No-shows
   - Home collection requests

---

## Step 9: Production Rollout

### 9.1 Backup Sheet

1. Before going live, make a backup of your database
2. Right-click sheet → **Move to trash** (optional, just backup)
3. Or use **File** → **Make a copy**

### 9.2 Switch to Production

1. Update `WHATSAPP_ACCESS_TOKEN` to your production token (if using test token)
2. Set `DEBUG_MODE = false`
3. Deploy latest version of Apps Script

### 9.3 Monitor First 24 Hours

- Check logs hourly
- Test all booking flows
- Monitor appointment confirmations
- Verify SMS/message delivery

---

## Troubleshooting

### Issue: Webhook returns 403 (Forbidden)

**Solution:**
- Verify `WHATSAPP_WEBHOOK_POST_TOKEN` matches in Meta dashboard and Script Properties
- Check webhook URL doesn't have typos

### Issue: Messages not being received

**Solution:**
- Verify webhook is subscribed to `messages` event
- Check firewall doesn't block requests
- Test with `testWebhookVerification()`

### Issue: Appointments not saving

**Solution:**
- Verify `SHEET_ID` is correct in Script Properties
- Check Google Sheet has proper column headers
- View logs for errors

### Issue: Home Collection radius not working

**Solution:**
- Verify `HOSPITAL_LOCATION` is set (format: "lat,long")
- Check `HOME_COLLECTION_RADIUS_KM` value
- Test location sharing from WhatsApp

### Issue: Apps Script hits execution timeout

**Solution:**
- This is rare but can happen with large sheets
- Optimize by archiving old appointments
- Consider migration to clinic-app (Next.js version)

---

## Maintenance

### Regular Tasks

- **Weekly**: Review appointment logs, check for errors
- **Monthly**: Archive old appointments (>3 months)
- **Quarterly**: Review and optimize Scripts, update doctor availability
- **Annually**: Update API tokens (if needed)

### Updating Scripts

1. Clone latest from repository
2. Copy new `.gs` files into Apps Script
3. Test on staging sheet first
4. Deploy to production

---

## Next Steps

If you experience scaling issues or want more features (admin portal, analytics, doctor scheduling), consider migrating to the **clinic-app** (Next.js/Supabase version). See `DEPLOYMENT_CLINIC_APP.md`.

