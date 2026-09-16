import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logWhatsAppMessage } from "./logger.ts";

/**
 * A rejection from Meta, with the code kept.
 *
 * Callers need to tell "outside the 24 hour window" apart from "that template
 * does not exist" and from a genuine failure, and the numeric code is the only
 * reliable way: the prose varies and is localised.
 */
export class WhatsAppApiError extends Error {
    constructor(
        message: string,
        readonly code: number | null,
        readonly details?: string
    ) {
        super(message);
        this.name = "WhatsAppApiError";
    }
}

/** Meta's code for "outside the 24 hour customer service window". */
export const OUTSIDE_WINDOW_CODE = 131047;

/** Meta's code for a template that is missing, unapproved or misnamed. */
export const TEMPLATE_UNAVAILABLE_CODES = [132000, 132001, 132005, 132007, 132012, 132015];

/**
 * WhatsApp Cloud API Client
 * Handles sending messages via Meta's WhatsApp Business API
 */
export class WhatsAppClient {
    private readonly accessToken: string;
    private readonly phoneNumberId: string;
    private readonly apiVersion = "v18.0";
    private readonly baseUrl = "https://graph.facebook.com";
    private readonly supabase?: SupabaseClient;
    private readonly clinicId?: string;

    // Logging used to depend on every caller remembering to pass a client, and
    // most did not: 118 of 187 sends were never recorded. Holding it here makes
    // the record a property of sending rather than of remembering.
    constructor(
        accessToken: string,
        phoneNumberId: string,
        supabase?: SupabaseClient,
        clinicId?: string
    ) {
        this.accessToken = accessToken;
        this.phoneNumberId = phoneNumberId;
        this.supabase = supabase;
        this.clinicId = clinicId;
    }

    /**
     * Send a text message
     */
    async sendTextMessage(
        recipientPhone: string,
        message: string,
        supabase?: SupabaseClient
    ): Promise<string> {
        const payload = {
            messaging_product: "whatsapp",
            to: recipientPhone,
            type: "text",
            text: {
                body: message
            }
        };

        return this.sendPayload(payload, recipientPhone, "text", message, supabase);
    }

    /**
     * Send an interactive message with buttons
     */
    async sendInteractiveButtonMessage(
        recipientPhone: string,
        bodyText: string,
        buttons: Array<{ id: string; title: string }>,
        supabase?: SupabaseClient
    ): Promise<string> {
        if (buttons.length > 3) {
            throw new Error("Interactive button messages support max 3 buttons");
        }

        // Meta rejects the whole message if any title exceeds 20 characters.
        const longTitle = buttons.find((btn) => [...btn.title].length > 20);

        if (longTitle) {
            throw new Error(
                `Interactive button titles support max 20 characters: "${longTitle.title}"`
            );
        }

        const payload = {
            messaging_product: "whatsapp",
            to: recipientPhone,
            type: "interactive",
            interactive: {
                type: "button",
                body: {
                    text: bodyText
                },
                action: {
                    buttons: buttons.map((btn) => ({
                        type: "reply",
                        reply: {
                            id: btn.id,
                            title: btn.title
                        }
                    }))
                }
            }
        };

        return this.sendPayload(
            payload,
            recipientPhone,
            "interactive",
            bodyText,
            supabase
        );
    }

    /**
     * Send an interactive message with list
     */
    async sendInteractiveListMessage(
        recipientPhone: string,
        bodyText: string,
        buttonTitle: string,
        sections: Array<{
            title: string;
            rows: Array<{ id: string; title: string; description?: string }>;
        }>,
        supabase?: SupabaseClient
    ): Promise<string> {
        // Limits per WhatsApp Cloud API interactive list spec.
        const totalRows = sections.reduce((count, section) => count + section.rows.length, 0);

        if (totalRows === 0) {
            throw new Error("Interactive list messages require at least one row");
        }

        if (sections.length > 10) {
            throw new Error("Interactive list messages support max 10 sections");
        }

        if (totalRows > 10) {
            throw new Error("Interactive list messages support max 10 rows across all sections");
        }

        if (buttonTitle.length > 20) {
            throw new Error("Interactive list button title supports max 20 characters");
        }

        // Meta rejects the whole message if any row title exceeds 24 characters.
        const longRow = sections
            .flatMap((section) => section.rows)
            .find((row) => [...row.title].length > 24);

        if (longRow) {
            throw new Error(
                `Interactive list row titles support max 24 characters: "${longRow.title}"`
            );
        }

        const payload = {
            messaging_product: "whatsapp",
            to: recipientPhone,
            type: "interactive",
            interactive: {
                type: "list",
                body: {
                    text: bodyText
                },
                action: {
                    button: buttonTitle,
                    sections
                }
            }
        };

        return this.sendPayload(
            payload,
            recipientPhone,
            "interactive",
            bodyText,
            supabase
        );
    }

    /**
     * Send a document, such as a lab report or a prescription.
     *
     * Meta fetches the link itself at send time and re-hosts the file in the
     * conversation, so the URL only has to be reachable for that moment and
     * the patient keeps the document afterwards.
     */
    async sendDocumentMessage(
        recipientPhone: string,
        link: string,
        filename: string,
        caption?: string,
        supabase?: SupabaseClient
    ): Promise<string> {
        const payload = {
            messaging_product: "whatsapp",
            to: recipientPhone,
            type: "document",
            document: {
                link,
                filename,
                ...(caption ? { caption } : {})
            }
        };

        return this.sendPayload(payload, recipientPhone, "document", caption || filename, supabase);
    }

    /**
     * Send a template message
     */
    async sendTemplateMessage(
        recipientPhone: string,
        templateName: string,
        templateLanguage: string = "en",
        parameters?: string[],
        /** For templates registered with a media header. */
        header?: { type: "document"; link: string; filename: string } | { type: "image"; link: string },
        supabase?: SupabaseClient
    ): Promise<string> {
        const components: unknown[] = [];

        if (header) {
            components.push({
                type: "header",
                parameters: [
                    header.type === "document"
                        ? { type: "document", document: { link: header.link, filename: header.filename } }
                        : { type: "image", image: { link: header.link } }
                ]
            });
        }

        if (parameters && parameters.length > 0) {
            components.push({
                type: "body",
                parameters: parameters.map((param) => ({ type: "text", text: param }))
            });
        }

        const payload = {
            messaging_product: "whatsapp",
            to: recipientPhone,
            type: "template",
            template: {
                name: templateName,
                language: {
                    code: templateLanguage
                },
                ...(components.length > 0 && { components })
            }
        };

        return this.sendPayload(
            payload,
            recipientPhone,
            "template",
            templateName,
            supabase
        );
    }

    /**
     * Send the actual payload to WhatsApp API
     */
    private async sendPayload(
        payload: any,
        recipientPhone: string,
        messageType: string,
        displayText: string,
        supabase?: SupabaseClient
    ): Promise<string> {
        const url = `${this.baseUrl}/${this.apiVersion}/${this.phoneNumberId}/messages`;
        const log = supabase ?? this.supabase;

        try {
            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${this.accessToken}`
                },
                body: JSON.stringify(payload)
            });

            const data = await response.json() as any;

            if (!response.ok) {
                throw new WhatsAppApiError(
                    `WhatsApp API error: ${data.error?.message || response.statusText}`,
                    typeof data.error?.code === "number" ? data.error.code : null,
                    data.error?.error_data?.details
                );
            }

            const messageId = data.messages?.[0]?.id || "";

            // Log outbound message
            if (log) {
                await logWhatsAppMessage(log, {
                    direction: "OUTBOUND",
                    clinic_id: this.clinicId,
                    phone: recipientPhone,
                    status: messageType,
                    message: displayText,
                    message_id: messageId
                });
            }

            return messageId;
        } catch (error) {
            console.error(
                `Failed to send ${messageType} to ${recipientPhone}:`,
                error
            );

            // Log error
            if (log) {
                await logWhatsAppMessage(log, {
                    direction: "WEBHOOK",
                    clinic_id: this.clinicId,
                    phone: recipientPhone,
                    status: "ERROR",
                    message: `Send ${messageType} failed: ${error instanceof Error ? error.message : String(error)}`
                });
            }

            throw error;
        }
    }

    /**
     * Mark message as read
     */
    async markAsRead(messageId: string): Promise<void> {
        const url = `${this.baseUrl}/${this.apiVersion}/${this.phoneNumberId}/messages`;

        try {
            await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${this.accessToken}`
                },
                body: JSON.stringify({
                    messaging_product: "whatsapp",
                    status: "read",
                    message_id: messageId
                })
            });
        } catch (error) {
            console.error(`Failed to mark message ${messageId} as read:`, error);
        }
    }
}

/**
 * Format phone number for WhatsApp API (without + sign)
 */
export function formatWhatsAppPhone(phone: string): string {
    let normalized = phone.replace(/[^\d+]/g, "");

    if (normalized.startsWith("+")) {
        normalized = normalized.substring(1);
    }

    return normalized;
}
