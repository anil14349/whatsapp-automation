# Admin User Management

Complete guide to managing admin users, resetting passwords, and configuring admin access.

**Table of Contents:**
- [Quick Start](#quick-start)
- [Dashboard UI](#dashboard-ui)
- [Password Reset](#password-reset)
- [User Roles](#user-roles)
- [Admin Limits](#admin-limits)
- [Troubleshooting](#troubleshooting)

---

## Quick Start

### For Admins (Normal Usage)
1. Dashboard → **Admin Users** (only visible to ADMIN role)
2. Click **Reset Password** on any user
3. Enter new password, confirm
4. Done! User can log in with new password

### For DevOps (Emergency Reset)
If locked out completely, use the reset script:
```bash
node scripts/reset-admin-password.mjs
```

---

## Dashboard UI

**Location:** Dashboard → Admin Users (ADMIN role only)

### Features

#### 1. Create New Admin User

```
Full Name:       [text field]
Email:           [email field]
Password:        [password field - min 8 chars]
Confirm:         [password field]
Role:            [dropdown: Receptionist or Admin]
                 [Create Admin User button]
```

- ✅ Duplicate email prevention
- ✅ Password validation (min 8 characters)
- ✅ Admin limit enforced (default: 10 admins)
- ✅ Automatic password hashing (scrypt)

#### 2. List Active Admins

Shows all active admin users in a table:

| Name | Email | Role | Created | Actions |
|------|-------|------|---------|---------|
| John Doe | john@clinic.com | ADMIN | 2026-01-15 | [Reset Password] [Change Role] [Deactivate] |
| Jane Smith | jane@clinic.com | RECEPTIONIST | 2026-02-01 | [Reset Password] [Change Role] [Deactivate] |

#### 3. Reset Password

Click "Reset Password" on any admin:
```
├─ Modal opens
├─ New Password: [password field]
├─ Confirm:      [password field]
└─ [Reset Password] [Cancel]
```

After reset, user can log in with new password immediately.

#### 4. Change Role

Click "Change Role" on any admin (except your own account):
```
├─ Modal opens
├─ New Role: [Receptionist or Admin dropdown]
└─ [Update Role] [Cancel]
```

Changes take effect immediately.

#### 5. Deactivate Admin

Click "Deactivate" to remove a user:
```
├─ Confirmation modal opens
├─ Warning: User will no longer be able to log in
└─ [Yes, Deactivate] [Cancel]
```

**Restrictions:**
- ❌ Cannot deactivate yourself (logged-in user)
- ❌ Cannot deactivate the last active admin
- ✅ User data is preserved (soft delete)

---

## Password Reset

### Option 1: Dashboard UI (Recommended)

**Best for:** One-time resets, normal operations

1. Go to Dashboard → Admin Users
2. Find the user
3. Click "Reset Password"
4. Enter new password
5. Confirm password
6. Click "Reset Password"

**Pros:** Easy, no terminal, secure  
**Cons:** Requires admin access to dashboard

### Option 2: Reset Script

**Best for:** Emergency, no dashboard access, automation

Location: `scripts/reset-admin-password.mjs`

#### Setup

Make script executable:
```bash
chmod +x scripts/reset-admin-password.mjs
```

#### Usage

```bash
node scripts/reset-admin-password.mjs
```

#### Prompts

```
🔐 Admin Password Reset

Admin email: admin@clinic.com
New password (min 8 chars): ••••••••••
Confirm password: ••••••••••

⏳ Hashing password...
⏳ Connecting to Supabase...
⏳ Resetting password for John Doe (admin@clinic.com)...

✅ Password reset successfully!

   Admin: John Doe
   Email: admin@clinic.com

   They can now log in with their new password.
```

#### Requirements

**Environment Variables** (must be set):
```bash
export NEXT_PUBLIC_SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key-here"
```

**How to find these:**
1. Go to Supabase Dashboard
2. Project → Settings → API
3. Copy URL and Service Role Key

#### Security

- ✅ Uses scrypt hashing (Node.js built-in)
- ✅ Service role key required (admin-only)
- ✅ No plaintext passwords logged
- ✅ Password never stored unencrypted

### Option 3: Manual Database Reset

**Best for:** Database-level emergency access only

**WARNING:** Only use if you have direct Supabase access and cannot use other methods.

#### Step 1: Generate Hash

Use Node.js to hash the password:

```bash
node -e "
const crypto = require('crypto');
const { promisify } = require('util');
const scryptAsync = promisify(crypto.scrypt);

(async () => {
  const password = 'YourNewPassword123';  // Change this
  const salt = crypto.randomBytes(16);
  const hash = await scryptAsync(password, salt, 64);
  const passwordHash = 'scrypt:' + salt.toString('hex') + ':' + hash.toString('hex');
  console.log('Hashed password:');
  console.log(passwordHash);
})();
"
```

#### Step 2: Update Database

1. Open Supabase Dashboard
2. Go to SQL Editor
3. Run this query:

```sql
UPDATE admin_users 
SET password_hash = 'scrypt:PASTE_HASH_HERE'
WHERE email = 'admin@clinic.com';
```

Replace:
- `scrypt:...` with the hash from Step 1
- `admin@clinic.com` with the admin's email

#### Step 3: Verify

```sql
SELECT id, email, full_name, role, active, created_at 
FROM admin_users 
WHERE email = 'admin@clinic.com';
```

---

## User Roles

### RECEPTIONIST

**Permissions:**
- ✅ View appointments
- ✅ Create/edit appointments
- ✅ View patient list
- ✅ View analytics
- ✅ Manage home collection requests
- ❌ Manage doctors
- ❌ Manage triggers/settings
- ❌ Manage admin users

**Use Case:** Front desk, appointment booking staff

### ADMIN

**Permissions:**
- ✅ All receptionist permissions
- ✅ Manage doctors (schedule, availability, leaves)
- ✅ Configure triggers (menus, templates, cron jobs)
- ✅ Clinic settings
- ✅ Manage admin users (create, reset, change roles)

**Use Case:** Clinic manager, system administrator

---

## Admin Limits

### Current Limit

**Maximum admins per clinic:** 10 (configurable)

Located in: `app/admin/(dashboard)/admin-users/actions.ts`

```typescript
const MAX_ADMINS = 10; // Configurable limit
```

### Change Limit

To change the limit:

1. Open `app/admin/(dashboard)/admin-users/actions.ts`
2. Find: `const MAX_ADMINS = 10;`
3. Change to desired number
4. Deploy

### Why a Limit?

- ✅ Prevents accidental admin account proliferation
- ✅ Improves security (fewer accounts = smaller attack surface)
- ✅ Encourages account cleanup
- ✅ Database efficiency

### Enforcement

- UI shows: "X / 10" active admins
- Create button disabled when limit reached
- Error message if trying to exceed limit

---

## Database Schema

**Table:** `admin_users`

```sql
CREATE TABLE admin_users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text NOT NULL UNIQUE,
  password_hash   text NOT NULL,
  full_name       text NOT NULL DEFAULT '',
  role            admin_role NOT NULL DEFAULT 'RECEPTIONIST',
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);
```

### Fields

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | Unique identifier |
| `email` | text | Login email, must be unique |
| `password_hash` | text | Format: `scrypt:SALT_HEX:HASH_HEX` |
| `full_name` | text | Display name |
| `role` | enum | `ADMIN` or `RECEPTIONIST` |
| `active` | boolean | `false` = deactivated (soft delete) |
| `created_at` | timestamp | Account creation time |

### Password Format

Passwords are stored as:
```
scrypt:SALT_HEX:HASH_HEX

Example:
scrypt:a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6:f1e2d3c4b5a6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6
```

- `scrypt` = algorithm identifier (future-proof for algorithm changes)
- `SALT_HEX` = 16 random bytes in hex (32 characters)
- `HASH_HEX` = 64-byte key in hex (128 characters)

---

## Security Considerations

### ✅ What's Secure

- Passwords hashed with scrypt (not plaintext, not bcrypt)
- Service role key required for script
- ADMIN role isolation (receptionists can't manage admins)
- Soft delete (data preserved, just marked inactive)
- No password recovery email (by design - no email system)

### ⚠️ What to Monitor

- Limit admin user count to necessary staff only
- Regularly deactivate unused accounts
- Change passwords periodically
- Audit admin login logs (if available)

### 🔐 Best Practices

1. **Strong passwords:** Enforce 12+ character passwords
2. **Limited admins:** Keep admin count at minimum
3. **Role separation:** Use RECEPTIONIST role when possible
4. **Regular audits:** Review active admins monthly
5. **Session management:** Sessions last up to 12 hours

---

## Troubleshooting

### "Maximum admins reached"

**Problem:** Cannot create new admin

**Solutions:**
1. Deactivate old/unused admins
2. Contact DevOps to increase limit
3. Check `MAX_ADMINS` in actions.ts

### "Cannot deactivate the last admin"

**Problem:** Trying to deactivate only active admin

**Solutions:**
1. Create a new admin first
2. Then deactivate the old one
3. Always maintain at least 1 active admin

### "Email already in use"

**Problem:** Email already exists in database

**Solutions:**
1. Use different email
2. Check if user is deactivated (can reactivate manually)
3. Verify email spelling

### "Invalid email address"

**Problem:** Email format incorrect

**Solutions:**
1. Use valid email format: `name@domain.com`
2. No spaces
3. No special characters except @ and .

### Password reset not working

**Problem:** "Reset Password" button not responding

**Solutions:**
1. Check browser console for errors
2. Verify user has ADMIN role
3. Refresh page and try again
4. Use script as alternative: `node scripts/reset-admin-password.mjs`

### Script fails with "Missing environment variables"

**Problem:** Reset script can't find Supabase credentials

**Solutions:**
```bash
# Set environment variables
export NEXT_PUBLIC_SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="your-key-here"

# Verify they're set
echo $NEXT_PUBLIC_SUPABASE_URL
echo $SUPABASE_SERVICE_ROLE_KEY

# Try script again
node scripts/reset-admin-password.mjs
```

---

## Workflow Examples

### Scenario 1: Employee Quits, Need to Remove Access

1. Dashboard → Admin Users
2. Find employee's account
3. Click "Deactivate"
4. Confirm
5. Account is deactivated (they can't log in)
6. Data is preserved (if needed for audit)

### Scenario 2: Admin Forgot Password

**Option A (Preferred):**
1. Dashboard → Admin Users
2. Click "Reset Password" on their account
3. Set temporary password
4. Give password to admin
5. They can change it after login

**Option B (If locked out of dashboard):**
1. Run: `node scripts/reset-admin-password.mjs`
2. Enter their email
3. Set new password
4. Tell them the password
5. Done

### Scenario 3: Promote Receptionist to Admin

1. Dashboard → Admin Users
2. Find receptionist account
3. Click "Change Role"
4. Select "Admin"
5. Confirm
6. They now have full access

### Scenario 4: Need Multiple Admins for Same Clinic

Clinic has 3 staff who need admin access:

1. Create Admin User #1 (Manager)
2. Create Admin User #2 (Assistant Manager)
3. Create Admin User #3 (Lead Receptionist as Receptionist role)

Each can reset the other's password if needed.

---

## API Reference

### Backend Actions

#### `createAdminUserAction(formData)`
- **Parameters:** Email, full_name, password, role
- **Returns:** `{success: true}` or `{error: string}`
- **Requires:** ADMIN role

#### `listAdminUsers()`
- **Returns:** Array of admin users
- **Requires:** ADMIN role

#### `resetAdminPasswordAction(adminId, formData)`
- **Parameters:** adminId, password, confirmPassword
- **Returns:** `{success: true}` or `{error: string}`
- **Requires:** ADMIN role

#### `changeAdminRoleAction(adminId, newRole)`
- **Parameters:** adminId, role (ADMIN or RECEPTIONIST)
- **Returns:** `{success: true}` or `{error: string}`
- **Requires:** ADMIN role

#### `deactivateAdminAction(adminId)`
- **Parameters:** adminId
- **Returns:** `{success: true}` or `{error: string}`
- **Requires:** ADMIN role

#### `getAdminCount()`
- **Returns:** Number of active admins
- **Requires:** ADMIN role

#### `getAdminLimit()`
- **Returns:** MAX_ADMINS constant
- **Requires:** None

---

## Support

For issues or questions:
1. Check [Troubleshooting](#troubleshooting) section above
2. Review script output for specific errors
3. Check Supabase dashboard logs
4. Contact your DevOps team

---

**Last Updated:** September 10, 2026  
**Status:** Complete and production-ready
