/**
 * Home Collection Reminder Scheduler
 * 
 * Processes and sends pending home collection reminders every minute.
 * Part of the Cloud Scheduler workflow that sends all reminders.
 * 
 * Pattern:
 * 1. Cloud Scheduler triggers scheduled-reminders function every minute
 * 2. Function initializes Supabase and WhatsApp clients
 * 3. Function calls runHomeCollectionReminderScheduler()
 * 4. Scheduler processes all clinics' pending reminders in parallel
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { debug } from "./logger.ts";
import { 
    getPendingHomeCollectionReminders,
    getHomeCollectionDetailsForReminder,
    formatHomeCollectionReminderMessage,
    markHomeCollectionReminderAsSent,
    markHomeCollectionReminderAsFailed
} from "./home-collection-reminders.ts";
import { sendProactive } from "./proactive.ts";

export interface HomeCollectionSchedulerConfig {
    clinicIds: string[];
    maxConcurrent?: number;
}

export interface HomeCollectionSchedulerResult {
    success: boolean;
    clinics_processed: number;
    reminders_sent: number;
    reminders_failed: number;
    errors: string[];
}

/**
 * Send single home collection reminder
 */
async function sendHomeCollectionReminder(
    supabase: SupabaseClient,
    whatsappClient: any,
    reminder: any,
    clinicId: string
): Promise<{ success: boolean; error?: string }> {
    try {
        debug("homeCollectionScheduler", "Sending reminder", { reminderId: reminder.id });

        // Fetch request and clinic details
        const details = await getHomeCollectionDetailsForReminder(supabase, reminder.request_id);

        if (!details) {
            debug("homeCollectionScheduler", "Request details not found, marking as non-retryable", {
                requestId: reminder.request_id,
                reminderId: reminder.id
            });

            // Mark as FAILED with non-retryable error
            await markHomeCollectionReminderAsFailed(
                supabase,
                reminder.id,
                "Request details not found"
            );

            return { success: false, error: "Request details not found" };
        }

        // Format reminder message
        const messageContent = {
            requestId: details.requestId,
            clinicName: details.clinicName,
            collectionDate: details.collectionDate,
            language: details.preferredLanguage
        };

        const message = formatHomeCollectionReminderMessage(messageContent);

        // sendTextMessage resolves to the message id and throws on failure; the
        // old `result.success` was always undefined, so every delivered
        // reminder was marked failed and retried. Same fault the appointment
        // scheduler already had fixed.
        const outcome = await sendProactive(
            whatsappClient,
            details.patientPhone,
            message,
            {
                key: "home_collection_reminder",
                language: details.preferredLanguage,
                parameters: [
                    details.patientName,
                    details.collectionDate,
                    details.timeWindow
                ]
            }
        );

        if (outcome.delivered) {
            await markHomeCollectionReminderAsSent(supabase, reminder.id, outcome.messageId || "");

            debug("homeCollectionScheduler", "Reminder sent successfully", {
                reminderId: reminder.id,
                messageId: outcome.messageId,
                via: outcome.via,
                requestId: details.requestId
            });

            return { success: true };
        } else {
            const reason = outcome.error ?? outcome.reason ?? "Unknown error";

            const { shouldRetry } = await markHomeCollectionReminderAsFailed(
                supabase,
                reminder.id,
                reason,
                !outcome.retryable
            );

            debug("homeCollectionScheduler", "Failed to send reminder", {
                reminderId: reminder.id,
                reason: outcome.reason,
                error: reason,
                shouldRetry
            });

            return {
                success: false,
                error: `${reason} (will retry: ${shouldRetry})`
            };
        }
    } catch (error) {
        debug("homeCollectionScheduler", "Error sending reminder", {
            reminderId: reminder.id,
            error: error instanceof Error ? error.message : String(error)
        });

        // Try to mark as failed (may fail if DB error)
        try {
            await markHomeCollectionReminderAsFailed(
                supabase,
                reminder.id,
                error instanceof Error ? error.message : String(error)
            );
        } catch (markError) {
            debug("homeCollectionScheduler", "Could not mark reminder as failed", {
                markError: markError instanceof Error ? markError.message : String(markError)
            });
        }

        return {
            success: false,
            error: error instanceof Error ? error.message : String(error)
        };
    }
}

/**
 * Process all pending reminders for a single clinic
 */
async function processClinicReminders(
    supabase: SupabaseClient,
    whatsappClient: any,
    clinicId: string,
    maxConcurrent: number = 5
): Promise<{ sent: number; failed: number }> {
    try {
        debug("homeCollectionScheduler", "Processing clinic reminders", { clinicId });

        // Get all pending reminders for clinic
        const reminders = await getPendingHomeCollectionReminders(supabase, clinicId);

        if (reminders.length === 0) {
            debug("homeCollectionScheduler", "No pending reminders for clinic", { clinicId });
            return { sent: 0, failed: 0 };
        }

        debug("homeCollectionScheduler", "Found pending reminders", {
            clinicId,
            count: reminders.length
        });

        // Process with concurrency control
        let sent = 0;
        let failed = 0;

        for (let i = 0; i < reminders.length; i += maxConcurrent) {
            const batch = reminders.slice(i, i + maxConcurrent);

            const results = await Promise.all(
                batch.map(reminder =>
                    sendHomeCollectionReminder(supabase, whatsappClient, reminder, clinicId)
                )
            );

            results.forEach(result => {
                if (result.success) {
                    sent++;
                } else {
                    failed++;
                }
            });
        }

        debug("homeCollectionScheduler", "Clinic reminders processed", {
            clinicId,
            sent,
            failed,
            total: reminders.length
        });

        return { sent, failed };
    } catch (error) {
        debug("homeCollectionScheduler", "Error processing clinic reminders", {
            clinicId,
            error: error instanceof Error ? error.message : String(error)
        });

        return { sent: 0, failed: 0 };
    }
}

/**
 * Main scheduler entry point
 * 
 * Processes all configured clinics' home collection reminders.
 * Called by Cloud Scheduler every minute.
 */
export async function runHomeCollectionReminderScheduler(
    supabase: SupabaseClient,
    whatsappClient: any,
    config: HomeCollectionSchedulerConfig
): Promise<HomeCollectionSchedulerResult> {
    try {
        debug("homeCollectionScheduler", "Starting scheduler run");

        const errors: string[] = [];
        let clinics_processed = 0;
        let reminders_sent = 0;
        let reminders_failed = 0;

        // Process each clinic
        for (const clinicId of config.clinicIds) {
            try {
                const result = await processClinicReminders(
                    supabase,
                    whatsappClient,
                    clinicId,
                    config.maxConcurrent || 5
                );

                clinics_processed++;
                reminders_sent += result.sent;
                reminders_failed += result.failed;
            } catch (clinicError) {
                const errorMsg = clinicError instanceof Error 
                    ? clinicError.message 
                    : String(clinicError);
                
                errors.push(`Clinic ${clinicId}: ${errorMsg}`);
                debug("homeCollectionScheduler", "Error processing clinic", {
                    clinicId,
                    error: errorMsg
                });
            }
        }

        debug("homeCollectionScheduler", "Scheduler run complete", {
            clinics_processed,
            reminders_sent,
            reminders_failed,
            errors: errors.length
        });

        return {
            success: reminders_failed === 0,
            clinics_processed,
            reminders_sent,
            reminders_failed,
            errors
        };
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        debug("homeCollectionScheduler", "Scheduler error", { error: errorMsg });

        return {
            success: false,
            clinics_processed: 0,
            reminders_sent: 0,
            reminders_failed: 0,
            errors: [errorMsg]
        };
    }
}
