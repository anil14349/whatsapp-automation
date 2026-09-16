# Portal accounts and sign-in

Who can sign in, what each kind of account reaches, and how to create, reset
and remove them.

> **Credentials are deliberately not written down here.** This file is in git,
> and anything committed stays in the history after you change it. Keep actual
> passwords and PINs in a password manager. Everything below describes accounts
> without naming a secret.

---

## The three kinds of account

They are separate tables with separate endpoints. A doctor is not an admin with
fewer permissions; the systems do not overlap.

| Kind | Table | Signs in with | Reaches |
|---|---|---|---|
| **Platform admin** | `clinic_admins`, `clinic_id` NULL | Email + password | Every clinic, and switching clinics on and off |
| **Clinic owner** | `clinic_admins`, `clinic_id` set | Email + password | One clinic: Appointments, Summary, Staff, Services, Settings |
| **Receptionist** | `receptionists` | WhatsApp number **or** email, + password | Appointments only, for their clinic |
| **Doctor** | `doctors` | Portal: number **or** email + PIN. WhatsApp: PIN | Their own day, their own appointments |

In the portal the role tabs read "Admin", "Receptionist" and "Doctor" —
"Admin" covers both clinic owner and platform admin, because the tab chooses
the endpoint rather than the role.

A platform admin is exempt from the clinic-active check. Otherwise deactivating
the only clinic would lock away the means of switching it back on.

---

## Creating accounts

### The first admin

Staff are created through `/staff`, which needs an admin token, which needs an
admin. This breaks the circle, and is one of only two things done directly
against the database:

```powershell
deno run --allow-env --allow-read --allow-net scripts/create-admin.ts `
    --email owner@clinic.example --name "Clinic Owner" --clinic <clinic-uuid>
```

- Omit `--clinic` for a platform-wide admin.
- Omit `--password` and one is generated and printed. Take it then; it is not
  recoverable afterwards.

Use a real address. A `.example` or `.test` domain cannot receive a password
reset, so the account can only be recovered by running this script again.

### Everyone else

Portal → **Staff** → pick the tab → **Add**. Or `POST /staff` with an admin
token.

A generated credential is delivered over WhatsApp when possible. If the person
has not messaged the clinic in the last 24 hours, Meta refuses the free-form
message and it falls back to the `staff_credential` template — see
[Registering the WhatsApp message templates](WHATSAPP_TEMPLATES.md). If neither
works, the response returns the credential so the admin can pass it on.

A receptionist needs an email **or** a WhatsApp number, and whichever they have
is what they sign in with. Removing the last one is refused.

---

## What the credentials must look like

Passwords, enforced on creation and reset:

- at least 8 characters
- an uppercase letter, a lowercase letter, a digit
- one of `! @ # $ % ^ & *`

Doctor PINs:

- 4 to 6 digits
- no run, ascending or descending — `1234`, `4321` are refused
- not all the same digit

The same rules apply whether the PIN is set through the portal or by the doctor
from their WhatsApp menu.

---

## Resetting and removing

| Action | Where |
|---|---|
| Reset a doctor's PIN or a receptionist's password | Portal → Staff → **Reset credential** |
| Doctor resets their own PIN | WhatsApp → **Forgot PIN** on the login prompt |
| Deactivate someone | Portal → Staff → the toggle |
| Remove someone | Portal → Staff → **Remove**, refused if they have future appointments or assigned collections |
| Reset an admin password | No endpoint. Run `create-admin.ts` again, or update `clinic_admins` directly. |

"Forgot PIN" is possession-only: anyone holding the doctor's unlocked phone can
reset it. Disable with `ALLOW_SELF_SERVICE_PIN_RESET=false` if that trade is
not acceptable.

---

## Lockout

Three failed attempts locks the account for 15 minutes, counted in
`login_rate_limits`.

It is in the database rather than in memory on purpose. It used to be a
module-level counter, and because edge isolates are recycled between requests
the count reset constantly — the lockout never actually fired in production.
The symptom was "3 attempts remaining" over and over.

---

## Removing an account safely

Deleting a row leaves its rate-limit entry behind, so clear both:

```sql
DELETE FROM login_rate_limits WHERE user_id = '<id>';
DELETE FROM clinic_admins    WHERE id = '<id>';   -- or receptionists / doctors
```

Deactivating (`status`/`is_active`) is usually better than deleting: it blocks
sign-in immediately and keeps the audit trail intact. A deactivated doctor
messaging the bot falls back to the ordinary patient flow.

---

## Before going live

- [ ] A real clinic owner exists, on an address that receives mail
- [ ] Any account created for testing has been deleted, not just deactivated
- [ ] Credentials are in a password manager, not in a file or a chat log
- [ ] Any credential that has appeared in a terminal, a screenshot or a shared
      transcript has been rotated — treat it as public
- [ ] `JWT_SECRET` is high entropy. `supabase secrets list` shows a plain
      unsalted SHA-256 of every secret, so a weak one is recoverable from the
      listing itself.
