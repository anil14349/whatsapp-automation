/**
 * Appointment Reminder Scheduler
 * Runs every minute to send pending appointment reminders via WhatsApp
 * 
 * Usage: Deploy as Cloud Function with Cloud Scheduler trigger (every minute)
 * or call from webhook handler
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { WhatsAppClient } from "./whatsapp-client.ts";
import * as types from "./multi-clinic-types.ts";
import {
    getPendingReminders,
    markReminderAsSent,
    markReminderAsFailed,
    getAppointmentDetailsForReminder,
    formatReminderMessage
} from "./appointment-reminders.ts";
import { debug, recordAuditEvent } from "./logger.ts";

interface SchedulerConfig {
    clinicIds: string[];
    batchSize?: number;
    maxConcurrent?: number;
}

interface ReminderSendResult {
    reminderId: string;
    appointmentId: string;
    status: "sent" | "failed" | "skipped";
    messageId?: string;
    error?: string;
    retryable: boolean;
}

/**
 * Send a single reminder
 */
async function sendReminder(
    supabase: SupabaseClient,
    whatsappClient: WhatsAppClient,
    reminder: types.AppointmentReminder,
    clinicId: string
): Promise<ReminderSendResult> {
    try {
        // Fetch appointment details
        const details = await getAppointmentDetailsForReminder(
            supabase,
            reminder.appointment_id
        );

        if (details.error) {
            debug("reminderScheduler", "Failed to fetch appointment details", {
                reminderId: reminder.id,
                appointmentId: reminder.appointment_id,
                error: details.error
            });

            // Mark as failed if we can't fetch details (not retryable)
            await markReminderAsFailed(
                supabase,
                reminder.id,
                `Failed to fetch appointment: ${details.error}`
            );

            return {
                reminderId: reminder.id,
                appointmentId: reminder.appointment_id,
                status: "failed",
                error: details.error,
                retryable: false
            };
        }

        if (!details.patientPhone) {
            debug("reminderScheduler", "Missing patient phone", {
                reminderId: reminder.id,
                appointmentId: reminder.appointment_id
            });

            await markReminderAsFailed(
                supabase,
                reminder.id,
                "Missing patient phone number"
            );

            return {
                reminderId: reminder.id,
                appointmentId: reminder.appointment_id,
                status: "failed",
                error: "Missing patient phone",
                retryable: false
            };
        }

        // Format reminder message
        const message = formatReminderMessage({
            reminderType: reminder.reminder_type as "24_HOUR" | "1_HOUR",
            patientName: details.patientName || "Patient",
            doctorName: details.doctorName || "Doctor",
            appointmentDate: details.appointmentDate || "",
            appointmentTime: details.appointmentTime || "",
            language: (details.preferredLanguage || "EN") as "EN" | "HI"
        });

        // Send via WhatsApp
        const sendResult = await whatsappClient.sendTextMessage(
            details.patientPhone,
            message
        );

        if (!sendResult.success) {
            debug("reminderScheduler", "Failed to send reminder", {
                reminderId: reminder.id,
                phone: details.patientPhone,
                error: sendResult.error
            });

            await markReminderAsFailed(
                supabase,
                reminder.id,
                sendResult.error || "Unknown error"
            );

            return {
                reminderId: reminder.id,
                appointmentId: reminder.appointment_id,
                status: "failed",
                error: sendResult.error,
                retryable: true
            };
        }

        // Mark as sent
        await markReminderAsSent(
            supabase,
            reminder.id,
            sendResult.message_id || ""
        );

        debug("reminderScheduler", "Reminder sent successfully", {
            reminderId: reminder.id,
            appointmentId: reminder.appointment_id,
            messageId: sendResult.message_id,
            phone: details.patientPhone,
            reminderType: reminder.reminder_type
        });

        // Record audit event
        await recordAuditEvent(
            supabase,
            "REMINDER_SENT",
            "SYSTEM",
            "appointment_reminders",
            reminder.id,
            { reminder_type: reminder.reminder_type },
            { status: "SENT", message_id: sendResult.message_id }
        );

        return {
            reminderId: reminder.id,
            appointmentId: reminder.appointment_id,
            status: "sent",
            messageId: sendResult.message_id,
            retryable: false
        };
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        debug("reminderScheduler", "Unexpected error sending reminder", {
            reminderId: reminder.id,
            error: errorMsg
        });

        await markReminderAsFailed(supabase, reminder.id, errorMsg);

        return {
            reminderId: reminder.id,
            appointmentId: reminder.appointment_id,
            status: "failed",
            error: errorMsg,
            retryable: true
        };
    }
}

/**
 * Process all pending reminders for a clinic
 */
async function processClinicReminders(
    supabase: SupabaseClient,
    whatsappClient: WhatsAppClient,
    clinicId: string,
    maxConcurrent: number = 5
): Promise<ReminderSendResult[]> {
    try {
        // Get all pending reminders
        const pending = await getPendingReminders(supabase, clinicId);

        if (pending.length === 0) {
            debug("reminderScheduler", "No pending reminders", { clinicId });
            return [];
        }

        debug("reminderScheduler", "Processing pending reminders", {
            clinicId,
            count: pending.length
        });

        // Process reminders with concurrency control
        const results: ReminderSendResult[] = [];
        for (let i = 0; i < pending.length; i += maxConcurrent) {
            const batch = pending.slice(i, i + maxConcurrent);
            const batchResults = await Promise.all(
                batch.map(reminder =>
                    sendReminder(supabase, whatsappClient, reminder, clinicId)
                )
            );
            results.push(...batchResults);
        }

        // Summary
        const sent = results.filter(r => r.status === "sent").length;
        const failed = results.filter(r => r.status === "failed").length;

        debug("reminderScheduler", "Batch processing complete", {
            clinicId,
            total: results.length,
            sent,
            failed
        });

        return results;
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        debug("reminderScheduler", "Error processing clinic reminders", {
            clinicId,
            error: errorMsg
        });

        return [];
    }
}

/**
 * Main scheduler function - called every minute
 */
export async function runReminderScheduler(
    supabase: SupabaseClient,
    whatsappClient: WhatsAppClient,
    config: SchedulerConfig
): Promise<{
    success: boolean;
    clinics_processed: number;
    reminders_sent: number;
    reminders_failed: number;
    errors?: string[];
}> {
    try {
        const allResults: ReminderSendResult[] = [];
        const errors: string[] = [];

        debug("reminderScheduler", "Starting scheduler run", {
            clinics: config.clinicIds.length
        });

        // Process each clinic
        for (const clinicId of config.clinicIds) {
            try {
                const results = await processClinicReminders(
                    supabase,
                    whatsappClient,
                    clinicId,
                    config.maxConcurrent || 5
                );

                allResults.push(...results);
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                errors.push(`Clinic ${clinicId}: ${errorMsg}`);
                debug("reminderScheduler", "Error processing clinic", {
                    clinicId,
                    error: errorMsg
                });
            }
        }

        const sent = allResults.filter(r => r.status === "sent").length;
        const failed = allResults.filter(r => r.status === "failed").length;

        debug("reminderScheduler", "Scheduler run complete", {
            clinics_processed: config.clinicIds.length,
            reminders_sent: sent,
            reminders_failed: failed,
            total_processed: allResults.length
        });

        return {
            success: true,
            clinics_processed: config.clinicIds.length,
            reminders_sent: sent,
            reminders_failed: failed,
            errors: errors.length > 0 ? errors : undefined
        };
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        debug("reminderScheduler", "Fatal error in scheduler", { error: errorMsg });

        return {
            success: false,
            clinics_processed: 0,
            reminders_sent: 0,
            reminders_failed: 0,
            errors: [errorMsg]
        };
    }
}

/**
 * Cloud Function handler - triggered by Cloud Scheduler (every minute)
 * 
 * Environment Variables Required:
 * - SB_URL
 * - SUPABASE_SERVICE_KEY (with admin privileges)
 * - WHATSAPP_BUSINESS_ACCOUNT_ID
 * - WHATSAPP_API_ACCESS_TOKEN
 * - CLINIC_IDS (comma-separated list of clinic UUIDs to process)
 */
export async function handleScheduledReminders(req: Request): Promise<Response> {
    try {
        // Verify scheduler auth token (optional but recommended)
        const authHeader = req.headers.get("Authorization");
        const expectedToken = Deno.env.get("SCHEDULER_AUTH_TOKEN");

        if (expectedToken && authHeader !== `Bearer ${expectedToken}`) {
            return new Response(
                JSON.stringify({ error: "Unauthorized" }),
                { status: 401, headers: { "Content-Type": "application/json" } }
            );
        }

        // Initialize Supabase client
        const supabaseUrl = Deno.env.get("SB_URL");
        const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_KEY");

        if (!supabaseUrl || !supabaseServiceKey) {
            return new Response(
                JSON.stringify({ error: "Missing Supabase config" }),
                { status: 500, headers: { "Content-Type": "application/json" } }
            );
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        // Initialize WhatsApp client
        const businessAccountId = Deno.env.get("WHATSAPP_BUSINESS_ACCOUNT_ID");
        const accessToken = Deno.env.get("WHATSAPP_API_ACCESS_TOKEN");

        if (!businessAccountId || !accessToken) {
            return new Response(
                JSON.stringify({ error: "Missing WhatsApp config" }),
                { status: 500, headers: { "Content-Type": "application/json" } }
            );
        }

        const whatsappClient = new WhatsAppClient(businessAccountId, accessToken);

        // Get clinic IDs to process
        const clinicIdsStr = Deno.env.get("CLINIC_IDS") || "";
        const clinicIds = clinicIdsStr
            .split(",")
            .map(id => id.trim())
            .filter(id => id.length > 0);

        if (clinicIds.length === 0) {
            return new Response(
                JSON.stringify({ error: "No clinics configured" }),
                { status: 400, headers: { "Content-Type": "application/json" } }
            );
        }

        // Run scheduler
        const result = await runReminderScheduler(supabase, whatsappClient, {
            clinicIds,
            maxConcurrent: 5
        });

        return new Response(JSON.stringify(result), {
            status: result.success ? 200 : 500,
            headers: { "Content-Type": "application/json" }
        });
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        return new Response(
            JSON.stringify({
                error: "Internal server error",
                message: errorMsg
            }),
            { status: 500, headers: { "Content-Type": "application/json" } }
        );
    }
}
