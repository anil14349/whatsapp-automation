/**
 * Supabase Edge Function: scheduled-reminders
 * 
 * Triggered by Cloud Scheduler every minute
 * Sends pending appointment reminders AND home collection reminders via WhatsApp
 * 
 * Deploy: supabase functions deploy scheduled-reminders
 * 
 * Cloud Scheduler Setup:
 * - Frequency: * * * * * (every minute)
 * - HTTP Target: POST https://<project>.supabase.co/functions/v1/scheduled-reminders
 * - Auth Header: Authorization: Bearer <SCHEDULER_AUTH_TOKEN>
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { WhatsAppClient } from "../shared/whatsapp-client.ts";
import { runReminderScheduler } from "../shared/appointment-reminder-scheduler.ts";
import { runHomeCollectionReminderScheduler } from "../shared/home-collection-reminder-scheduler.ts";
import { FeedbackHandler } from "../shared/handlers/feedback-handler.ts";
import { debug } from "../shared/logger.ts";

Deno.serve(async (req: Request) => {
    // Verify request method
    if (req.method !== "POST" && req.method !== "GET") {
        return new Response(
            JSON.stringify({ error: "Method not allowed" }),
            { status: 405, headers: { "Content-Type": "application/json" } }
        );
    }

    try {
        // Verify scheduler auth token (security measure)
        const authHeader = req.headers.get("Authorization");
        const expectedToken = Deno.env.get("SCHEDULER_AUTH_TOKEN");

        if (expectedToken && authHeader !== `Bearer ${expectedToken}`) {
            debug("scheduledReminders", "Unauthorized request", {
                auth_header: authHeader ? "provided" : "missing"
            });

            return new Response(
                JSON.stringify({ error: "Unauthorized" }),
                { status: 401, headers: { "Content-Type": "application/json" } }
            );
        }

        // Initialize Supabase client
        const supabaseUrl = Deno.env.get("SUPABASE_URL");
        const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

        if (!supabaseUrl || !supabaseServiceKey) {
            debug("scheduledReminders", "Missing Supabase configuration");

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
            debug("scheduledReminders", "Missing WhatsApp configuration");

            return new Response(
                JSON.stringify({ error: "Missing WhatsApp config" }),
                { status: 500, headers: { "Content-Type": "application/json" } }
            );
        }

        const whatsappClient = new WhatsAppClient(accessToken, phoneNumberId);

        // Get clinic IDs to process
        const clinicIdsStr = Deno.env.get("CLINIC_IDS") || "";
        const clinicIds = clinicIdsStr
            .split(",")
            .map(id => id.trim())
            .filter(id => id.length > 0);

        if (clinicIds.length === 0) {
            debug("scheduledReminders", "No clinics configured");

            return new Response(
                JSON.stringify({
                    warning: "No clinics configured for reminder processing"
                }),
                { status: 200, headers: { "Content-Type": "application/json" } }
            );
        }

        debug("scheduledReminders", "Starting scheduler run", {
            clinic_count: clinicIds.length
        });

        // Run both schedulers
        const appointmentResult = await runReminderScheduler(supabase, whatsappClient, {
            clinicIds,
            maxConcurrent: 5
        });

        const homeCollectionResult = await runHomeCollectionReminderScheduler(supabase, whatsappClient, {
            clinicIds,
            maxConcurrent: 5
        });

        // Appointments whose date has passed are closed off automatically.
        const today = new Date().toISOString().split("T")[0];
        const { data: completed, error: completeError } = await supabase
            .from("appointments")
            .update({
                status: "COMPLETED",
                completed_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .in("clinic_id", clinicIds)
            .eq("status", "CONFIRMED")
            .lt("appointment_date", today)
            .select("id, clinic_id, patient_phone, patient_name, doctor_id");

        if (completeError) {
            debug("scheduledReminders", "Failed to auto-complete appointments", {
                error: completeError.message
            });
        }

        // Ask for feedback once an appointment has been completed.
        let surveysSent = 0;

        if (completed && completed.length > 0) {
            const feedback = new FeedbackHandler(supabase, whatsappClient);

            for (const appointment of completed) {
                const { data: doctor } = await supabase
                    .from("doctors")
                    .select("name")
                    .eq("id", appointment.doctor_id)
                    .maybeSingle();

                const sent = await feedback.sendFeedbackSurvey(
                    appointment.clinic_id,
                    appointment.id,
                    appointment.patient_phone,
                    appointment.patient_name,
                    doctor?.name || "your doctor"
                );

                if (sent) {
                    surveysSent++;
                }
            }
        }

        // Combine results
        const combinedResult = {
            success: appointmentResult.success && homeCollectionResult.success,
            appointment_reminders: appointmentResult,
            home_collection_reminders: homeCollectionResult,
            appointments_auto_completed: completed?.length || 0,
            feedback_surveys_sent: surveysSent,
            total_reminders_sent: appointmentResult.reminders_sent + homeCollectionResult.reminders_sent,
            total_reminders_failed: appointmentResult.reminders_failed + homeCollectionResult.reminders_failed,
            total_errors: (appointmentResult.errors?.length || 0) + (homeCollectionResult.errors?.length || 0)
        };

        return new Response(JSON.stringify(combinedResult), {
            status: combinedResult.success ? 200 : 500,
            headers: {
                "Content-Type": "application/json",
                "Cache-Control": "no-cache, no-store, must-revalidate"
            }
        });
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        debug("scheduledReminders", "Fatal error", { error: errorMsg });

        return new Response(
            JSON.stringify({
                error: "Internal server error",
                message: errorMsg
            }),
            { status: 500, headers: { "Content-Type": "application/json" } }
        );
    }
});
