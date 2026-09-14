import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { WhatsAppLogEntry } from "./types.ts";

/**
 * Log a WhatsApp message to the audit log
 */
export async function logWhatsAppMessage(
    supabase: SupabaseClient,
    entry: WhatsAppLogEntry
): Promise<void> {
    try {
        await supabase.from("whatsapp_log").insert({
            direction: entry.direction,
            phone: entry.phone,
            name: entry.name,
            status: entry.status,
            message: truncateText(entry.message, 500),
            message_id: entry.message_id,
            phone_number_id: entry.phone_number_id,
            metadata: entry.metadata
        });
    } catch (error) {
        console.error("Could not log message:", error);
        // Don't throw - logging failures shouldn't break the webhook
    }
}

/**
 * Truncate text to maximum length
 */
export function truncateText(text: string | undefined, maxLength: number): string {
    if (!text) return "";
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + "...";
}

/**
 * Log an error event
 */
export async function logError(
    supabase: SupabaseClient,
    context: string,
    error: Error | string,
    metadata?: Record<string, any>
): Promise<void> {
    try {
        const message = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : undefined;

        await supabase.from("whatsapp_log").insert({
            direction: "WEBHOOK",
            status: "ERROR",
            message: `${context}: ${message}`,
            metadata: {
                ...metadata,
                stack
            }
        });
    } catch (logError) {
        console.error("Could not log error:", logError);
    }
}

/**
 * Record an audit event
 */
export async function recordAuditEvent(
    supabase: SupabaseClient,
    action: string,
    actor: string | undefined,
    entityType: string | undefined,
    entityId: string | undefined,
    beforeState?: Record<string, any>,
    afterState?: Record<string, any>
): Promise<void> {
    try {
        await supabase.from("audit_log").insert({
            action,
            actor,
            entity_type: entityType,
            entity_id: entityId,
            before_state: beforeState,
            after_state: afterState
        });
    } catch (error) {
        console.error("Could not record audit event:", error);
    }
}

/**
 * Track analytics event
 */
export async function trackEvent(
    supabase: SupabaseClient,
    eventType: string,
    phone?: string,
    doctorId?: string,
    metadata?: Record<string, any>
): Promise<void> {
    try {
        await supabase.from("analytics_events").insert({
            event_type: eventType,
            phone,
            doctor_id: doctorId,
            metadata
        });
    } catch (error) {
        console.error("Could not track event:", error);
    }
}

/**
 * Debug log with context
 */
export function debug(context: string, message: string, data?: any): void {
    if (Deno.env.get("DEBUG_MODE") === "true") {
        console.log(`[${context}] ${message}`, data ?? "");
    }
}

/**
 * Info log
 */
export function info(context: string, message: string, data?: any): void {
    console.log(`[${context}] ${message}`, data ?? "");
}

/**
 * Warning log
 */
export function warn(context: string, message: string, data?: any): void {
    console.warn(`[${context}] ${message}`, data ?? "");
}

/**
 * Error log
 */
export function error(context: string, message: string, data?: any): void {
    console.error(`[${context}] ${message}`, data ?? "");
}
