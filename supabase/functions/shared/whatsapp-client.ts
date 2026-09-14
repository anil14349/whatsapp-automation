import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logWhatsAppMessage } from "./logger.ts";

/**
 * WhatsApp Cloud API Client
 * Handles sending messages via Meta's WhatsApp Business API
 */
export class WhatsAppClient {
    private readonly accessToken: string;
    private readonly phoneNumberId: string;
    private readonly apiVersion = "v18.0";
    private readonly baseUrl = "https://graph.instagram.com";

    constructor(accessToken: string, phoneNumberId: string) {
        this.accessToken = accessToken;
        this.phoneNumberId = phoneNumberId;
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
     * Send a template message
     */
    async sendTemplateMessage(
        recipientPhone: string,
        templateName: string,
        templateLanguage: string = "en",
        parameters?: string[],
        supabase?: SupabaseClient
    ): Promise<string> {
        const payload = {
            messaging_product: "whatsapp",
            to: recipientPhone,
            type: "template",
            template: {
                name: templateName,
                language: {
                    code: templateLanguage
                },
                ...(parameters && {
                    components: [
                        {
                            type: "body",
                            parameters: parameters.map((param) => ({
                                type: "text",
                                text: param
                            }))
                        }
                    ]
                })
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
                throw new Error(
                    `WhatsApp API error: ${data.error?.message || response.statusText}`
                );
            }

            const messageId = data.messages?.[0]?.id || "";

            // Log outbound message
            if (supabase) {
                await logWhatsAppMessage(supabase, {
                    direction: "OUTBOUND",
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
            if (supabase) {
                await logWhatsAppMessage(supabase, {
                    direction: "WEBHOOK",
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
