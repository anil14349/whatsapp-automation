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
import { FeedbackHandler } from "../shared/handlers/feedback-handler.ts";
import { getActiveClinicRoutes } from "../shared/clinic-routing.ts";
import { debug } from "../shared/logger.ts";

interface ClinicRunResult {
    success: boolean;
    appointment_reminders: unknown;
    appointments_auto_completed: number;
    feedback_surveys_sent: number;
    feedback_surveys_deferred: number;
    reminders_sent: number;
    reminders_failed: number;
    error_count: number;
}

/**
 * Run every scheduled job for one clinic, sending from that clinic's number.
 */
async function processClinic(
    supabase: SupabaseClient,
    whatsappClient: WhatsAppClient,
    clinicIds: string[]
): Promise<ClinicRunResult> {
    const appointmentResult = await runReminderScheduler(supabase, whatsappClient, {
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

    // Ask for feedback once an appointment has been completed. A patient who
    // was mid-conversation last run is retried here until the window closes.
    const RETRY_WINDOW_DAYS = 7;
    const cutoff = new Date(Date.now() - RETRY_WINDOW_DAYS * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0];

    const { data: recentlyCompleted } = await supabase
        .from("appointments")
        .select("id, clinic_id, patient_phone, patient_name, doctor_id")
        .in("clinic_id", clinicIds)
        .eq("status", "COMPLETED")
        .gte("appointment_date", cutoff)
        .limit(200);

    const { data: alreadyAsked } = await supabase
        .from("feedback")
        .select("appointment_id")
        .in("clinic_id", clinicIds);

    const askedIds = new Set((alreadyAsked || []).map((row) => row.appointment_id));

    const pendingSurveys = (recentlyCompleted || []).filter(
        (appointment) => !askedIds.has(appointment.id)
    );

    let surveysSent = 0;
    let surveysDeferred = 0;

    if (pendingSurveys.length > 0) {
        const feedback = new FeedbackHandler(supabase, whatsappClient);
        const doctorNames = new Map<string, string>();

        for (const appointment of pendingSurveys) {
            if (!doctorNames.has(appointment.doctor_id)) {
                const { data: doctor } = await supabase
                    .from("doctors")
                    .select("name")
                    .eq("id", appointment.doctor_id)
                    .maybeSingle();

                doctorNames.set(appointment.doctor_id, doctor?.name || "your doctor");
            }

            const sent = await feedback.sendFeedbackSurvey(
                appointment.clinic_id,
                appointment.id,
                appointment.patient_phone,
                appointment.patient_name,
                doctorNames.get(appointment.doctor_id) as string
            );

            if (sent) {
                surveysSent++;
            } else {
                surveysDeferred++;
            }
        }
    }

    return {
        success: appointmentResult.success,
        appointment_reminders: appointmentResult,
        appointments_auto_completed: completed?.length || 0,
        feedback_surveys_sent: surveysSent,
        feedback_surveys_deferred: surveysDeferred,
        reminders_sent: appointmentResult.reminders_sent,
        reminders_failed: appointmentResult.reminders_failed,
        error_count: appointmentResult.errors?.length || 0
    };
}

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

        // Each clinic sends from its own WhatsApp number, so the run is scoped
        // per clinic rather than sharing one client. CLINIC_IDS, when set,
        // narrows the run to a subset.
        const allRoutes = await getActiveClinicRoutes(supabase);

        const clinicFilter = (Deno.env.get("CLINIC_IDS") || "")
            .split(",")
            .map(id => id.trim())
            .filter(id => id.length > 0);

        const routes = clinicFilter.length > 0
            ? allRoutes.filter(route => clinicFilter.includes(route.clinicId))
            : allRoutes;

        if (routes.length === 0) {
            debug("scheduledReminders", "No clinics with WhatsApp credentials");

            return new Response(
                JSON.stringify({
                    warning: "No clinics available for reminder processing"
                }),
                { status: 200, headers: { "Content-Type": "application/json" } }
            );
        }

        debug("scheduledReminders", "Starting scheduler run", {
            clinic_count: routes.length
        });

        const perClinic: Record<string, unknown>[] = [];
        let allSucceeded = true;
        let totalSent = 0;
        let totalFailed = 0;
        let totalErrors = 0;
        let totalAutoCompleted = 0;
        let totalSurveysSent = 0;
        let totalSurveysDeferred = 0;

        for (const route of routes) {
            const clinicIds = [route.clinicId];
            const whatsappClient = new WhatsAppClient(
                route.accessToken,
                route.phoneNumberId,
                supabase,
                route.clinicId
            );

            const clinicResult = await processClinic(supabase, whatsappClient, clinicIds);

            allSucceeded = allSucceeded && clinicResult.success;
            totalSent += clinicResult.reminders_sent;
            totalFailed += clinicResult.reminders_failed;
            totalErrors += clinicResult.error_count;
            totalAutoCompleted += clinicResult.appointments_auto_completed;
            totalSurveysSent += clinicResult.feedback_surveys_sent;
            totalSurveysDeferred += clinicResult.feedback_surveys_deferred;

            perClinic.push({ clinic_id: route.clinicId, ...clinicResult });
        }

        const combinedResult = {
            success: allSucceeded,
            clinics_processed: routes.length,
            clinics: perClinic,
            appointments_auto_completed: totalAutoCompleted,
            feedback_surveys_sent: totalSurveysSent,
            feedback_surveys_deferred: totalSurveysDeferred,
            total_reminders_sent: totalSent,
            total_reminders_failed: totalFailed,
            total_errors: totalErrors
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
