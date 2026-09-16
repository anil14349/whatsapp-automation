# Module 3 — WhatsApp

The Meta app, the business number, and the message templates. This is
configuration in Meta's dashboard rather than code, but the system does not
work without it.

## Configuration required

Per clinic, in the `clinics` row — or as an environment fallback for a
single-clinic deployment:

| Column | Secret fallback | Purpose |
|---|---|---|
| `whatsapp_phone_number_id` | `WHATSAPP_PHONE_NUMBER_ID` | Which number sends |
| `whatsapp_access_token` | `WHATSAPP_ACCESS_TOKEN` | Permanent token |
| `whatsapp_verify_token` | `WHATSAPP_VERIFY_TOKEN` | Webhook handshake |
| `whatsapp_webhook_token` | `WHATSAPP_WEBHOOK_POST_TOKEN` | Inbound query token |
| `whatsapp_app_secret` | `WHATSAPP_APP_SECRET` | Proves an inbound webhook is from Meta |

Per-clinic values win. Routing distinguishes "no clinic owns this number"
(falls back to the default clinic) from "the owning clinic is switched off"
(refuses), so deactivating a clinic does not silently serve its patients under
another tenant.

## The webhook

In Meta → your app → WhatsApp → Configuration:

- **Callback URL**: `https://<ref>.supabase.co/functions/v1/webhook?token=<WHATSAPP_WEBHOOK_POST_TOKEN>`
- **Verify token**: the value of `WHATSAPP_VERIFY_TOKEN`
- **Subscribe to**: `messages`

The token travels in the query string because Meta cannot send a custom header.
It is checked before anything else runs.

### Proving the request came from Meta

The query token says **which clinic** is being addressed. It does not say **who
is calling**, and because it rides in the URL it is written into proxy logs and
anywhere else request lines are kept. On its own it means anyone who learns it
can post a message as any phone number into that clinic.

Meta signs every delivery with HMAC-SHA256 of the raw body using the **app
secret**, sent as `X-Hub-Signature-256: sha256=<hex>`. The secret never travels
with the request, so this is the check that actually establishes the sender.

To turn it on for a clinic:

1. Meta → your app → **Settings → Basic** → **App secret** → Show.
2. Store it against the clinic:

   ```sql
   UPDATE clinics SET whatsapp_app_secret = '<app secret>' WHERE id = '<clinic-uuid>';
   ```

   Or, for a single-clinic deployment, as the secret `WHATSAPP_APP_SECRET`.

**Enforcement follows the data.** A clinic with a secret set must send a valid
signature or the request is refused; a clinic without one keeps working on the
token alone and logs a warning on every message. That is deliberate — switching
this on everywhere at once would silently drop real patients' messages from any
clinic not yet configured.

Once every clinic has a secret, set `WHATSAPP_REQUIRE_SIGNATURE=true` to refuse
anything unsigned. Until you do, an unconfigured clinic is still only protected
by the query token.

Rotating the app secret in Meta invalidates the stored one immediately, so
update the column in the same sitting or inbound messages stop.

## Message templates

**This is the part that decides whether the product works.**

A step-by-step walkthrough of creating them, with the exact wording and
parameter order for each, is in
[**Registering the WhatsApp message templates**](WHATSAPP_TEMPLATES.md). The
summary below is what they are and why they are needed.

Meta accepts a free-form message only within **24 hours of the recipient's own
last message**. Everything the clinic starts — every reminder, every delay
notice, a staff credential, a report — is sent long after that window has
closed for most people. Outside it, only an approved template may be sent.

The code tries the free-form message and falls back to the template on the one
error that means the window has shut (`131047`). Until the templates are
approved that fallback has nothing to fall back to, and those messages simply
do not arrive. They fail visibly and once, rather than retrying, but they still
fail.

Create each of these in **Meta Business Manager → Message templates**,
category **UTILITY**, in English and Hindi under the same name:

| Name | Header | Body parameters |
|---|---|---|
| `appointment_reminder_24h` | — | patient, doctor, date, time |
| `appointment_reminder_1h` | — | patient, doctor, time |
| `home_collection_reminder` | — | patient, date, time window |
| `appointment_delay` | — | patient, doctor, minutes, new time |
| `staff_credential` | — | name, clinic, PIN or password |
| `waitlist_slot_available` | — | date, time |
| `staff_new_booking` | — | patient, date, time |
| `patient_document` | **DOCUMENT** | patient, what it is |

The exact wording each was written against is at the top of
[`supabase/functions/shared/proactive.ts`](../../supabase/functions/shared/proactive.ts).
That file is the source of truth — register them to match, because the
parameters are positional and a template with its placeholders in a different
order will send the doctor's name where the date should be.

`patient_document` must be created with its **header type set to Document**, or
reports cannot be delivered outside the window.

If your WhatsApp Business Account already uses different names, point at them
with secrets instead of changing code:

```powershell
npx supabase secrets set TEMPLATE_APPOINTMENT_REMINDER_24H=<your name> --project-ref <ref>
```

## Development mode

A Meta app in development mode delivers only to numbers registered as testers.
**A successful send does not mean a delivered message**: the API accepts it and
returns a message id either way. Until the app is live, treat "sent" as "Meta
accepted it".

## Verifying

Simulating an inbound message exercises the whole flow without a handset:

```powershell
$body = @{
    object = "whatsapp_business_account"
    entry = @(@{ changes = @(@{ value = @{
        messaging_product = "whatsapp"
        metadata = @{ phone_number_id = "<phone number id>" }
        contacts = @(@{ profile = @{ name = "Test" } })
        messages = @(@{ from = "<number>"; id = "wamid.test1"; timestamp = "1694000000";
                        text = @{ body = "Hi" }; type = "text" })
    } }) })
} | ConvertTo-Json -Depth 12 -Compress

[IO.File]::WriteAllText("$env:TEMP\wa.json", $body)
curl.exe -s -X POST -H "Content-Type: application/json" --data "@$env:TEMP\wa.json" `
    "https://<ref>.supabase.co/functions/v1/webhook?token=<post token>"
```

Then read `whatsapp_sessions` for that number to see the state it reached, and
`whatsapp_log` for what was sent back.

## Limits worth knowing

- More than **3 buttons** throws. Use a list above that.
- A list allows **10 rows in total** across all sections, row titles ≤ 24
  characters, button text ≤ 20.
- A menu built from clinic data must be capped, or a clinic enabling one more
  service takes the bot down. `npm run verify:supabase-menus` enforces this.
