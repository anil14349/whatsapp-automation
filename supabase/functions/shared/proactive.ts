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
 *   appointment_reminder_24h   {{1}} patient  {{2}} phrase  {{3}} date  {{4}} time
 *     "Hi {{1}}, a reminder that you have {{2}} tomorrow, {{3}} at {{4}}.
 *      Reply CANCEL to cancel, or RESCHEDULE to change the time."
 *
 *   appointment_reminder_1h    {{1}} patient  {{2}} phrase  {{3}} time
 *     "Hi {{1}}, you have {{2}} at {{3}}, about an hour from now. Reply to
 *      this message if you are running late."
 *
 *   {{2}} is a whole phrase - "an appointment with Dr. Akilesh" or "a Sample
 *   Collection appointment" - because a service does not read correctly after
 *   "with". Build it with reminderPhrase() so the template and the free-form
 *   message cannot drift apart.
 *
 *   home_collection_reminder   {{1}} patient  {{2}} date  {{3}} time window
 *     "Hi {{1}}, our technician will visit for your sample collection on
 *      {{2}} during {{3}}. Reply to this message to change the time."
 *
 *   appointment_delay          {{1}} patient  {{2}} doctor  {{3}} minutes  {{4}} new time
 *     "Hi {{1}}, {{2}} is running about {{3}} minutes late. Your appointment
 *      is now expected around {{4}}. Sorry for the wait."
 *
 *   staff_credential           {{1}} name  {{2}} clinic  {{3}} PIN or password
 *     "Hello {{1}}, a new sign-in code for {{2}} has been issued for you:
 *      {{3}}. Please sign in and change it straight away."
 *
 *   waitlist_slot_available    {{1}} date  {{2}} time
 *     "Good news — a slot you were waiting for on {{1}} at {{2}} has become
 *      free. Reply to this message to book it."
 *
 *   staff_new_booking          {{1}} patient  {{2}} date  {{3}} time
 *     "New booking: {{1}} on {{2}} at {{3}}."
 *
 *   patient_document           header: DOCUMENT   {{1}} patient  {{2}} what it is
 *     Header set to a document, body:
 *     "Hi {{1}}, your {{2}} from the clinic is attached. Reply to this message
 *      if you have any questions."
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
         * Recorded in `whatsapp_log` in place of the body. A staff credential
         * would otherwise sit there in plain text for as long as the row does.
         */
        logAs?: string;
    } = {}
): Promise<ProactiveResult> {
    try {
        const messageId = options.document
            ? await client.sendDocumentMessage(
                phone,
                options.document.link,
                options.document.filename,
                freeform
            )
            : await client.sendTextMessage(phone, freeform, undefined, options.logAs);

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
