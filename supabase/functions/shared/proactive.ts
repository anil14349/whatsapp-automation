/**
 * Messages the clinic starts.
 *
 * Meta only accepts a free-form message within 24 hours of the recipient's own
 * last message. Everything the clinic initiates — reminders, a delay notice, a
 * staff credential — is sent long after that window has closed for most people,
 * and was being sent as free-form anyway. Meta rejected it with 131047, the
 * reminder was marked failed, retried twice more against the same closed
 * window, and the patient heard nothing. Nothing surfaced it, because a failed
 * reminder is a row in a table.
 *
 * Outside the window only an approved template may be sent. Rather than track
 * the window ourselves and drift out of step with Meta's view of it, this tries
 * the free-form message and falls back to the template on the one error that
 * means "too late for that". The window boundary stays Meta's to decide.
 *
 * ── Templates to register, under Meta Business Manager → Message templates ──
 *
 * Category UTILITY for all of them (they follow a user action, so they are not
 * marketing), in English and Hindi under the same name.
 *
 * Meta refuses a body that starts or ends with a variable, so each of these
 * closes on words. That is why two of them carry a closing sentence that adds
 * little - it is there to satisfy the validator.
 *
 *   appointment_reminder_24h   {{1}} patient  {{2}} doctor or service  {{3}} date  {{4}} time
 *     "Hi {{1}}, a reminder for your visit tomorrow:
 *
 *      🩺 {{2}}
 *      📅 {{3}}
 *      🕐 {{4}}
 *
 *      Use the buttons below if you need to change anything."
 *     Two QUICK REPLY buttons: "Cancel" and "Reschedule".
 *
 *     A quick reply arrives as message type "button" carrying the button's
 *     TEXT, not as an interactive reply, so the labels must match the words
 *     menuIdForKeyword() knows. The free-form version of this reminder sends
 *     the same two as reply buttons, so a tap lands in the same place whether
 *     the window was open or not.
 *
 *   appointment_reminder_1h    {{1}} patient  {{2}} doctor or service  {{3}} time
 *     "Hi {{1}}, your visit is in about an hour:
 *
 *      🩺 {{2}}
 *      🕐 {{3}}
 *
 *      Please arrive on time."
 *     Two QUICK REPLY buttons: "Cancel" and "Reschedule".
 *
 *   {{2}} is "Dr. Akilesh" or "Sample Collection", from reminderSubject(), on
 *   a line with no label. No one label fits both: an appointment is "with" a
 *   doctor but "for" a sample collection, and "Doctor: Sample Collection" is
 *   the same fault that produced "Dr. Dr." on a real handset.
 *
 *   home_collection_reminder   {{1}} patient  {{2}} date  {{3}} time window
 *     "Hi {{1}}, our technician will visit for your sample collection on
 *      {{2}} during {{3}}. Please keep your phone nearby."
 *
 *     NOTHING SENDS THIS TODAY. Its only writer is the home collection handler,
 *     which patients no longer reach: a home sample collection is booked as an
 *     ordinary appointment and gets appointment_reminder_24h instead. Register
 *     it only if the collector flow is revived.
 *
 *   appointment_delay          {{1}} patient  {{2}} doctor  {{3}} minutes  {{4}} new time
 *     "Hi {{1}}, {{2}} is running about {{3}} minutes late. Your appointment
 *      is now expected around {{4}}. Sorry for the wait."
 *     Two QUICK REPLY buttons: "Reschedule" and "Cancel".
 *
 *   staff_credential           {{1}} name  {{2}} clinic  {{3}} PIN or password
 *     "Hello {{1}}, a new sign-in code for {{2}} has been issued for you:
 *      {{3}}. Please sign in and change it straight away."
 *
 *     CONSIDER NOT REGISTERING THIS ONE. Meta classes a message carrying a
 *     sign-in code as AUTHENTICATION, whose templates take fixed body text and
 *     a copy-code button rather than wording of our own. More to the point, a
 *     template parameter is a password handed to Meta to keep: sendProactive
 *     logs this one as a note precisely so it does not sit in whatsapp_log,
 *     and a template undoes that outside our own database. Unregistered, the
 *     send falls back to email and then to showing the credential to the admin
 *     who created the account, which is where it came from anyway.
 *
 *   waitlist_slot_available    {{1}} date  {{2}} time
 *     "The slot you were waiting for on {{1}} at {{2}} is now free. Tap below
 *      to book it."
 *     One QUICK REPLY button: "Book".
 *
 *     Meta first read "Good news - a slot you were waiting for has become
 *     free" as MARKETING. "You were waiting for" is what keeps it utility: it
 *     ties the message to something the patient asked for. Announcing that a
 *     slot is available, with no such reference, is an advert by Meta's
 *     definition - which costs more and which a patient can opt out of, and
 *     the one message they must not miss is this one.
 *
 *   staff_new_booking          {{1}} patient  {{2}} date  {{3}} time
 *     "New booking for {{1}} on {{2}} at {{3}} has been received."
 *
 *     Passive so the sentence ends on words. The active form, opening with
 *     "Booking received for", puts the time last, and Meta refuses a body
 *     that ends on a variable.
 *
 *   patient_document           header: DOCUMENT   {{1}} patient  {{2}} what it is
 *     Header set to a document, body:
 *     "Hi {{1}}, your {{2}} from the clinic is attached. Please call the
 *      clinic if you have any questions."
 *
 *     It used to invite a reply. A reply reaches the booking menu, and the
 *     portal has no inbox for anyone to read one in, so a patient asking about
 *     their own test result would have been answered with an offer to book an
 *     appointment. The phone is the only channel that reaches a person.
 *
 *   A quick reply's label is what arrives, so every label above is a word
 *   menuIdForKeyword() maps to a menu id: Cancel, Reschedule, Book. Adding a
 *   button with any other wording gives the patient something that does
 *   nothing when tapped.
 *
 * Until a template is approved the fallback cannot fire, and a send outside the
 * window returns template_unavailable rather than being retried. That is
 * deliberate: retrying a template Meta has never heard of is noise.
 */

import {
    OUTSIDE_WINDOW_CODE,
    TEMPLATE_UNAVAILABLE_CODES,
    WhatsAppApiError,
    WhatsAppClient
} from "./whatsapp-client.ts";
import { debug } from "./logger.ts";

export type TemplateKey =
    | "appointment_reminder_24h"
    | "appointment_reminder_1h"
    | "home_collection_reminder"
    | "appointment_delay"
    | "staff_credential"
    | "waitlist_slot_available"
    | "staff_new_booking"
    | "patient_document";

/**
 * Template names are per WhatsApp Business Account, so a clinic that already
 * has its own naming can point at it without a code change.
 */
export function templateName(key: TemplateKey): string {
    return Deno.env.get(`TEMPLATE_${key.toUpperCase()}`) ?? key;
}

/** Meta keys templates by language code, not by our EN/HI. */
export function templateLanguage(language?: string): string {
    return (language ?? "EN").toUpperCase() === "HI" ? "hi" : "en";
}

export interface ProactiveTemplate {
    key: TemplateKey;
    language?: string;
    /** In the order the registered template numbers them. */
    parameters: string[];
    /** For a template registered with a media header, such as a report. */
    header?: { type: "document"; link: string; filename: string } | { type: "image"; link: string };
}

export interface ProactiveResult {
    delivered: boolean;
    messageId?: string;
    via?: "text" | "template";
    reason?: "outside_window" | "template_unavailable" | "send_failed";
    error?: string;
    /** False when sending it again unchanged cannot possibly work. */
    retryable: boolean;
}

function codeOf(error: unknown): number | null {
    if (error instanceof WhatsAppApiError) {
        return error.code;
    }

    // Older throw sites lost the code into the message.
    const text = error instanceof Error ? error.message : String(error);
    const match = /\b(13\d{4})\b/.exec(text);

    return match ? Number(match[1]) : null;
}

function isOutsideWindow(error: unknown): boolean {
    if (codeOf(error) === OUTSIDE_WINDOW_CODE) {
        return true;
    }

    const text = error instanceof Error ? error.message : String(error);

    return /24 hours have passed|outside.*(24|window)/i.test(text);
}

/**
 * Send something the clinic initiated, falling back to its template.
 *
 * `freeform` is what a patient still inside the window receives, so it keeps
 * the wording and emoji the flow already uses. The template is the same message
 * in the fixed shape Meta approved.
 */
export async function sendProactive(
    client: WhatsAppClient,
    phone: string,
    freeform: string,
    template: ProactiveTemplate | null,
    options: {
        /** Sent instead of the plain text when the window is still open. */
        document?: { link: string; filename: string };
        /**
         * Reply buttons, to match the template's quick replies. Their ids must
         * be the same, so a tap lands identically whichever path delivered it.
         */
        buttons?: Array<{ id: string; title: string }>;
        /**
         * Recorded in `whatsapp_log` in place of the body. A staff credential
         * would otherwise sit there in plain text for as long as the row does.
         */
        logAs?: string;
    } = {}
): Promise<ProactiveResult> {
    try {
        let messageId: string;

        if (options.document) {
            messageId = await client.sendDocumentMessage(
                phone,
                options.document.link,
                options.document.filename,
                freeform
            );
        } else if (options.buttons && options.buttons.length > 0) {
            messageId = await client.sendInteractiveButtonMessage(
                phone,
                freeform,
                options.buttons.slice(0, 3)
            );
        } else {
            messageId = await client.sendTextMessage(phone, freeform, undefined, options.logAs);
        }

        return { delivered: true, messageId, via: "text", retryable: false };
    } catch (error) {
        if (!isOutsideWindow(error)) {
            const message = error instanceof Error ? error.message : String(error);

            debug("proactive", "Send failed", { phone, error: message });

            return { delivered: false, reason: "send_failed", error: message, retryable: true };
        }

        if (!template) {
            debug("proactive", "Outside the window with no template to fall back to", { phone });

            return { delivered: false, reason: "outside_window", retryable: false };
        }

        return await sendTemplate(client, phone, template);
    }
}

async function sendTemplate(
    client: WhatsAppClient,
    phone: string,
    template: ProactiveTemplate
): Promise<ProactiveResult> {
    const name = templateName(template.key);

    try {
        const messageId = await client.sendTemplateMessage(
            phone,
            name,
            templateLanguage(template.language),
            template.parameters,
            template.header
        );

        debug("proactive", "Delivered by template", { phone, template: name });

        return { delivered: true, messageId, via: "template", retryable: false };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const code = codeOf(error);

        if (code !== null && TEMPLATE_UNAVAILABLE_CODES.includes(code)) {
            debug("proactive", "Template is not available", { phone, template: name, code });

            return {
                delivered: false,
                reason: "template_unavailable",
                error: `${name}: ${message}`,
                retryable: false
            };
        }

        // A template should never be refused for the window. If it is, the
        // window is still the honest reason, and sending it again will not
        // change that.
        if (isOutsideWindow(error)) {
            debug("proactive", "Template refused for the window too", { phone, template: name });

            return { delivered: false, reason: "outside_window", error: message, retryable: false };
        }

        debug("proactive", "Template send failed", { phone, template: name, error: message });

        return { delivered: false, reason: "send_failed", error: message, retryable: true };
    }
}
