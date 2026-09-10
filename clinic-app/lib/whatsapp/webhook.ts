/**
 * WhatsApp Webhook Utilities
 * Handles signature verification, event parsing, and processing
 */

import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

/**
 * Verify WhatsApp webhook signature
 * WhatsApp signs requests with HMAC SHA256
 */
export function verifyWhatsAppSignature(
  body: string,
  signature: string | null | undefined,
  verifyToken: string
): boolean {
  if (!signature || !verifyToken) {
    console.error("Missing signature or verify token");
    return false;
  }

  // WhatsApp uses this format: "sha256=<hash>"
  const [algorithm, hash] = signature.split("=");

  if (algorithm !== "sha256") {
    console.error(`Unknown algorithm: ${algorithm}`);
    return false;
  }

  // Compute HMAC SHA256
  const computedHash = crypto
    .createHmac("sha256", verifyToken)
    .update(body)
    .digest("hex");

  // Constant-time comparison to prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(hash),
    Buffer.from(computedHash)
  );
}

/**
 * WhatsApp webhook message type
 */
export interface WhatsAppWebhookPayload {
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        messaging_product: string;
        metadata: {
          display_phone_number: string;
          phone_number_id: string;
        };
        contacts?: Array<{
          profile: {
            name: string;
          };
          wa_id: string;
        }>;
        messages?: Array<WhatsAppMessage>;
        statuses?: Array<WhatsAppStatus>;
      };
      field: string;
    }>;
  }>;
}

export interface WhatsAppMessage {
  from: string;
  id: string;
  timestamp: string;
  type: "text" | "audio" | "image" | "video" | "document" | "location" | "button" | "interactive";
  text?: {
    body: string;
  };
  button?: {
    text: string;
    payload: string;
  };
  interactive?: {
    type: string;
    button_reply?: {
      id: string;
      title: string;
    };
  };
  media?: {
    id: string;
    mime_type: string;
  };
  location?: {
    latitude: number;
    longitude: number;
  };
}

export interface WhatsAppStatus {
  id: string;
  status: "sent" | "delivered" | "read" | "failed";
  timestamp: string;
  recipient_id: string;
  errors?: Array<{
    code: number;
    title: string;
    message: string;
  }>;
}

/**
 * Extract messages from WhatsApp webhook payload
 */
export function extractMessages(
  payload: WhatsAppWebhookPayload
): Array<WhatsAppMessage & { clinicPhone: string }> {
  const messages: Array<WhatsAppMessage & { clinicPhone: string }> = [];

  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      const clinicPhone = change.value.metadata.display_phone_number;

      if (change.value.messages) {
        for (const message of change.value.messages) {
          messages.push({
            ...message,
            clinicPhone
          });
        }
      }
    }
  }

  return messages;
}

/**
 * Extract statuses from WhatsApp webhook payload
 */
export function extractStatuses(
  payload: WhatsAppWebhookPayload
): Array<WhatsAppStatus> {
  const statuses: WhatsAppStatus[] = [];

  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      if (change.value.statuses) {
        statuses.push(...change.value.statuses);
      }
    }
  }

  return statuses;
}

/**
 * Log webhook event to database
 */
export async function logWebhookEvent(
  supabase: ReturnType<typeof createClient>,
  clinicId: string,
  eventType: string,
  payload: any,
  status: "pending" | "processed" | "failed" = "pending",
  errorMessage?: string
) {
  const { error } = await supabase.from("webhook_events").insert({
    clinic_id: clinicId,
    source: "whatsapp",
    event_type: eventType,
    payload,
    status,
    error_message: errorMessage,
    processed_at: status !== "pending" ? new Date().toISOString() : null
  });

  if (error) {
    console.error("Failed to log webhook event:", error);
  }
}

/**
 * Get WhatsApp webhook settings for clinic
 */
export async function getWebhookSettings(
  supabase: ReturnType<typeof createClient>,
  clinicId: string
) {
  const { data, error } = await supabase
    .from("webhook_settings")
    .select("*")
    .eq("clinic_id", clinicId)
    .single();

  if (error && error.code !== "PGRST116") {
    // PGRST116 = not found
    console.error("Failed to fetch webhook settings:", error);
  }

  return data;
}

/**
 * Create webhook settings if they don't exist
 */
export async function ensureWebhookSettings(
  supabase: ReturnType<typeof createClient>,
  clinicId: string,
  verifyToken: string
) {
  const existing = await getWebhookSettings(supabase, clinicId);

  if (existing) {
    return existing;
  }

  const { data, error } = await supabase
    .from("webhook_settings")
    .insert({
      clinic_id: clinicId,
      whatsapp_verify_token: verifyToken,
      whatsapp_webhook_enabled: true
    })
    .select()
    .single();

  if (error) {
    console.error("Failed to create webhook settings:", error);
  }

  return data;
}

/**
 * Update webhook event status
 */
export async function updateWebhookEventStatus(
  supabase: ReturnType<typeof createClient>,
  eventId: string,
  status: "processed" | "failed" | "retrying",
  errorMessage?: string
) {
  const { error } = await supabase
    .from("webhook_events")
    .update({
      status,
      error_message: errorMessage,
      processed_at: new Date().toISOString()
    })
    .eq("id", eventId);

  if (error) {
    console.error("Failed to update webhook event status:", error);
  }
}

/**
 * Increment retry count for webhook event
 */
export async function incrementWebhookRetry(
  supabase: ReturnType<typeof createClient>,
  eventId: string
) {
  const { error } = await supabase
    .from("webhook_events")
    .update({
      retry_count: supabase.rpc("increment_retry_count", { event_id: eventId }),
      status: "retrying"
    })
    .eq("id", eventId);

  if (error) {
    console.error("Failed to increment webhook retry:", error);
  }
}

/**
 * Extract text from message
 */
export function getMessageText(message: WhatsAppMessage): string | null {
  if (message.type === "text" && message.text?.body) {
    return message.text.body;
  }

  if (message.type === "button" && message.button?.text) {
    return message.button.text;
  }

  if (message.type === "interactive" && message.interactive?.button_reply?.title) {
    return message.interactive.button_reply.title;
  }

  return null;
}

/**
 * Get phone number with country code from WhatsApp message
 */
export function normalizePhoneNumber(phoneNumber: string): string {
  // Remove any non-digit characters
  const digits = phoneNumber.replace(/\D/g, "");

  // Ensure it has country code (India = 91)
  if (!digits.startsWith("91") && digits.length === 10) {
    return "91" + digits;
  }

  return digits;
}
