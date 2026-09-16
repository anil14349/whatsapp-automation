# Registering the WhatsApp message templates

A walkthrough for creating the eight templates this system needs, and what each
field must contain.

**Why this matters more than it looks:** Meta accepts a free-form message only
within 24 hours of the patient's own last message. Every reminder, delay
notice, waitlist alert, staff credential and report is sent long after that.
Outside the window, only an approved template is delivered. Until these exist,
those messages fail — visibly and once, rather than silently, but they still
fail.

---

## Where to do it

Two different sites, which is the usual first confusion:

| Site | What lives there |
|---|---|
| **developers.facebook.com** | The App: API setup, phone number id, access tokens, webhook |
| **business.facebook.com** → WhatsApp Manager | **Message templates**, quality rating, number status |

Templates are created in **WhatsApp Manager**, not in the App dashboard. From
developers.facebook.com you can reach it via your app → **WhatsApp** → **API
Setup** → the WhatsApp Manager link, or go directly:

```
business.facebook.com  →  WhatsApp Manager  →  Message templates  →  Create template
```

You need a WhatsApp Business Account with the number already added and verified.

---

## What to enter, for every template

| Field | Value |
|---|---|
| **Category** | **Utility** |
| **Name** | exactly as listed below, lower case with underscores |
| **Languages** | English, and Hindi if you serve Hindi speakers |
| **Header** | None, except `patient_document` which is **Media → Document** |
| **Footer** | leave empty |
| **Buttons** | none |

**Category matters.** These follow something the patient did — they booked, or
the clinic is running late — so they are Utility, not Marketing. Utility is
cheaper and is not subject to marketing limits. Choosing Marketing will get
them approved and then cost you more per message for no benefit.

**The name is an identifier, not a label.** The code looks templates up by these
exact strings.

---

## The eight templates

`{{1}}`, `{{2}}` and so on are **positional**. The code fills them in the order
below. A template whose placeholders sit in a different order will send the
doctor's name where the date should be, and Meta will approve it happily
because it cannot know.

When Meta asks for sample values, give realistic ones — "Asha Rao", "Dr Kumar",
"2026-09-18", "10:30". Samples that look like placeholders are a common
rejection reason.

### 1. `appointment_reminder_24h`

> Hi {{1}}, a reminder of your appointment with {{2}} tomorrow, {{3}} at {{4}}. Reply to this message to reschedule or cancel.

| | |
|---|---|
| {{1}} | patient name |
| {{2}} | doctor |
| {{3}} | date |
| {{4}} | time |

### 2. `appointment_reminder_1h`

> Hi {{1}}, your appointment with {{2}} is at {{3}}, about an hour from now. Reply to this message if you are running late.

| | |
|---|---|
| {{1}} | patient name |
| {{2}} | doctor |
| {{3}} | time |

### 3. `home_collection_reminder`

> Hi {{1}}, our technician will visit for your sample collection on {{2}} during {{3}}. Reply to this message to change the time.

| | |
|---|---|
| {{1}} | patient name |
| {{2}} | date |
| {{3}} | time window |

### 4. `appointment_delay`

> Hi {{1}}, {{2}} is running about {{3}} minutes late. Your appointment is now expected around {{4}}. Sorry for the wait.

| | |
|---|---|
| {{1}} | patient name |
| {{2}} | doctor |
| {{3}} | minutes |
| {{4}} | new expected time |

### 5. `staff_credential`

> Hello {{1}}, a new sign-in code for {{2}} has been issued for you: {{3}}. Please sign in and change it straight away.

| | |
|---|---|
| {{1}} | staff member's name |
| {{2}} | clinic name |
| {{3}} | PIN or password |

Goes to staff, never to patients.

### 6. `waitlist_slot_available`

> Good news — a slot you were waiting for on {{1}} at {{2}} has become free. Reply to this message to book it.

| | |
|---|---|
| {{1}} | date |
| {{2}} | time, or "any time" |

### 7. `staff_new_booking`

> New booking: {{1}} on {{2}} at {{3}}.

| | |
|---|---|
| {{1}} | patient name |
| {{2}} | date |
| {{3}} | time |

Goes to the doctor.

### 8. `patient_document` — **has a header**

Set **Header → Media → Document**. This is the one template that carries a file,
and without a document header a report cannot be delivered outside the window.

> Hi {{1}}, your {{2}} from the clinic is attached. Reply to this message if you have any questions.

| | |
|---|---|
| header | the PDF or image itself |
| {{1}} | patient name |
| {{2}} | what it is — "report", "prescription", "invoice" |

---

## Hindi

Add Hindi as a second language **under the same template name**. Meta keys a
template by name and language together, and the code picks the language from
the patient's saved preference — `hi` when they chose Hindi, `en` otherwise.

Placeholders must stay in the same positions in the translation. If Hindi word
order wants them elsewhere, rewrite the sentence rather than renumber.

A patient whose language is anything other than Hindi gets English. There is no
third language wired up.

---

## Approval

Review usually takes minutes to a few hours; allow a day.

Common rejections:

- **Category wrong.** Something written as Marketing that reads as Utility, or the reverse.
- **Placeholder-looking samples.** Give real-looking values.
- **Starting or ending with a placeholder.** `{{1}}, your report is ready` can be refused. Lead with a word.
- **Two placeholders adjacent.** `{{1}} {{2}}` with nothing between them.
- **Promotional wording** in a Utility template — anything resembling an offer.

A rejected template can be edited and resubmitted. Watch the **quality rating**
afterwards: templates people block or report get throttled and eventually
paused, so keep them factual and expected.

---

## If your account already uses different names

Point the code at yours instead of renaming templates:

```powershell
npx supabase secrets set TEMPLATE_APPOINTMENT_REMINDER_24H=<your name> --project-ref <ref>
```

The pattern is `TEMPLATE_` followed by the key in upper case. The parameter
order still has to match.

---

## Checking they work

There is no need to wait for a real reminder. Send to a number that has **not**
messaged the clinic in over 24 hours — that forces the template path:

1. Portal → Staff → **Reset credential** for a doctor on such a number.
2. A `deliveredBy` of `whatsapp` in the response means the template was
   accepted.

Or watch a real one:

```sql
SELECT status, error_message, attempts
FROM appointment_reminders
ORDER BY updated_at DESC
LIMIT 5;
```

| What you see | Meaning |
|---|---|
| `SENT` | Delivered, by free-form or template |
| `FAILED` with a `132001`-family error | The template name does not exist at Meta |
| `FAILED` mentioning 24 hours | The window is shut and no template was available |

Note that in **development mode** Meta only delivers to registered test numbers.
A `SENT` row means Meta accepted the message, not that a handset received it.

---

The wording above is kept in
[`supabase/functions/shared/proactive.ts`](../../supabase/functions/shared/proactive.ts),
which is the source of truth. If you change a template at Meta, change it there
too, or the free-form message and the template version will say different
things to different patients.
