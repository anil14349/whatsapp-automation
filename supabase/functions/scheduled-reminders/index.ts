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
        const businessAccountId = Deno.env.get("WHATSAPP_BUSINESS_ACCOUNT_ID");
        const accessToken = Deno.env.get("WHATSAPP_API_ACCESS_TOKEN");

        if (!businessAccountId || !accessToken) {
            debug("scheduledReminders", "Missing WhatsApp configuration");

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

        // Combine results
        const combinedResult = {
            success: appointmentResult.success && homeCollectionResult.success,
            appointment_reminders: appointmentResult,
            home_collection_reminders: homeCollectionResult,
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
