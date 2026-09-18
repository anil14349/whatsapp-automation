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
    formatReminderMessage,
    reminderSubject
} from "./appointment-reminders.ts";
import { sendProactive } from "./proactive.ts";
import { BUTTON_IDS } from "./button-ids.ts";
import { formatClockTime, formatLongDate } from "./appointment-format.ts";
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
            doctorName: details.doctorName,
            serviceName: details.serviceName,
            appointmentDate: details.appointmentDate || "",
            appointmentTime: details.appointmentTime || "",
            language: (details.preferredLanguage || "EN") as "EN" | "HI"
        });

        // The template shows these under their own labels, so the parameter is
        // the plain name and must read correctly with no doctor.
        const subject = reminderSubject(
            details.doctorName,
            details.serviceName,
            details.preferredLanguage || "EN"
        );

        // The same ids the template's quick replies carry, so a tap lands in
        // the same place whichever path delivered the reminder. An hour before
        // is when a patient realises they cannot make it, so it is offered
        // there too rather than leaving them to simply not turn up.
        const language = details.preferredLanguage === "HI" ? "HI" : "EN";

        const actions = [
            {
                id: BUTTON_IDS.PATIENT_MENU.CANCEL,
                title: language === "HI" ? "रद्द करें" : "Cancel"
            },
            {
                id: BUTTON_IDS.PATIENT_MENU.RESCHEDULE,
                title: language === "HI" ? "समय बदलें" : "Reschedule"
            }
        ];

        // A reminder is by definition sent long after the patient last wrote,
        // so free-form alone was rejected outside the 24 hour window and the
        // patient heard nothing. The template carries it when that happens.
        const outcome = await sendProactive(
            whatsappClient,
            details.patientPhone,
            message,
            {
                key: reminder.reminder_type === "1_HOUR"
                    ? "appointment_reminder_1h"
                    : "appointment_reminder_24h",
                language: details.preferredLanguage || "EN",
                parameters: reminder.reminder_type === "1_HOUR"
                    ? [
                        details.patientName || "Patient",
                        subject,
                        formatClockTime(details.appointmentTime || "")
                    ]
                    : [
                        details.patientName || "Patient",
                        subject,
                        formatLongDate(details.appointmentDate || "", details.preferredLanguage || "EN"),
                        formatClockTime(details.appointmentTime || "")
                    ]
            },
            { buttons: actions }
        );

        if (!outcome.delivered) {
            const reason = outcome.error ?? outcome.reason ?? "send failed";

            debug("reminderScheduler", "Failed to send reminder", {
                reminderId: reminder.id,
                phone: details.patientPhone,
                reason: outcome.reason,
                error: reason
            });

            await markReminderAsFailed(supabase, reminder.id, reason, !outcome.retryable);

            return {
                reminderId: reminder.id,
                appointmentId: reminder.appointment_id,
                status: "failed",
                error: reason,
                retryable: outcome.retryable
            };
        }

        const messageId = outcome.messageId ?? "";

        // Mark as sent
        await markReminderAsSent(
            supabase,
            reminder.id,
            messageId
        );

        debug("reminderScheduler", "Reminder sent successfully", {
            reminderId: reminder.id,
            appointmentId: reminder.appointment_id,
            messageId,
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
            { status: "SENT", message_id: messageId }
        );

        return {
            reminderId: reminder.id,
            appointmentId: reminder.appointment_id,
            status: "sent",
            messageId,
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
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY (with admin privileges)
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
        const supabaseUrl = Deno.env.get("SUPABASE_URL");
        const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

        if (!supabaseUrl || !supabaseServiceKey) {
            return new Response(
                JSON.stringify({ error: "Missing Supabase config" }),
                { status: 500, headers: { "Content-Type": "application/json" } }
            );
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        // Initialize WhatsApp client
        const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
        const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");

        if (!accessToken || !phoneNumberId) {
            return new Response(
                JSON.stringify({ error: "Missing WhatsApp config" }),
                { status: 500, headers: { "Content-Type": "application/json" } }
            );
        }

        const whatsappClient = new WhatsAppClient(accessToken, phoneNumberId, supabase);

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
