import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractInboundMessage } from "../shared/validators.ts";
import { logWhatsAppMessage } from "../shared/logger.ts";
import { processMessage } from "../shared/message-processor.ts";
import { WhatsAppClient } from "../shared/whatsapp-client.ts";
import {
    getClinicByPhoneNumberId,
    isValidVerifyToken,
    isValidWebhookToken
} from "../shared/clinic-routing.ts";

// Initialize Supabase client
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Main webhook handler for WhatsApp messages
 * Handles both GET (verification) and POST (inbound messages)
 */
Deno.serve(async (req) => {
    const method = req.method;

    try {
        // ============================================================
        // GET: WhatsApp Webhook Verification
        // ============================================================
        if (method === "GET") {
            return await handleWebhookVerification(req);
        }

        // ============================================================
        // POST: Inbound Messages
        // ============================================================
        if (method === "POST") {
            return await handleInboundMessage(req);
        }

        return new Response(
            JSON.stringify({ error: "Method not allowed" }),
            { status: 405 }
        );
    } catch (error) {
        console.error("Webhook error:", error);

        // Log webhook error
        try {
            await supabase.from("whatsapp_log").insert({
                direction: "WEBHOOK",
                status: "ERROR",
                message: error.message,
                metadata: { stack: error.stack }
            });
        } catch (logError) {
            console.error("Could not log error:", logError);
        }

        return new Response(
            JSON.stringify({ error: "Webhook processing failed" }),
            { status: 500 }
        );
    }
});

/**
 * Handle WhatsApp webhook verification (GET request)
 * Meta sends this during webhook configuration
 */
async function handleWebhookVerification(req: Request) {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token") || "";
    const challenge = url.searchParams.get("hub.challenge");

    // Each clinic runs its own Meta app, so any clinic's verify token is valid.
    if (mode === "subscribe" && (await isValidVerifyToken(supabase, token))) {
        console.log("Webhook verified successfully");
        return new Response(challenge, { status: 200 });
    }

    console.warn("Invalid webhook verification attempt");
    return new Response("Verification failed", { status: 403 });
}

/**
 * Handle inbound WhatsApp messages (POST request)
 */
async function handleInboundMessage(req: Request) {
    // ============================================================
    // PARSE REQUEST
    // ============================================================

    const url = new URL(req.url);
    const webhookToken = url.searchParams.get("token");

    // Verify webhook token
    if (!(await isValidWebhookToken(supabase, webhookToken))) {
        console.error("Invalid webhook token");
        return new Response("Unauthorized", { status: 401 });
    }

    const body = await req.json();

    // ============================================================
    // EXTRACT MESSAGE
    // ============================================================

    const value =
        body?.entry?.[0]?.changes?.[0]?.value;

    if (!value) {
        // Not a message webhook, just return OK
        console.log("Received non-message webhook event");
        return new Response("EVENT_RECEIVED", { status: 200 });
    }

    const message = value.messages?.[0];

    // Ignore non-message events (status, read receipts, etc.)
    if (!message) {
        console.log("Received webhook without message payload");
        return new Response("EVENT_RECEIVED", { status: 200 });
    }

    const messageId = String(message.id || "");
    const senderPhone = String(message.from);
    const senderName =
        value.contacts?.[0]?.profile?.name || "";
    const phoneNumberId =
        value.metadata?.phone_number_id || "";

    console.log(`Processing message ${messageId} from ${senderPhone}`);

    // ============================================================
    // RESOLVE CLINIC
    // ============================================================

    const clinic = await getClinicByPhoneNumberId(supabase, phoneNumberId);

    if (!clinic) {
        console.error("No clinic owns this WhatsApp number", { phoneNumberId });
        // 200 so Meta does not retry a message we can never route.
        return new Response("EVENT_RECEIVED", { status: 200 });
    }

    // Replies must come from the clinic's own number, using its own token.
    const whatsappClient = new WhatsAppClient(clinic.accessToken, clinic.phoneNumberId);

    // ============================================================
    // IDEMPOTENCY CHECK
    // ============================================================

    if (messageId) {
        // Check if already processed
        const { data: existing } = await supabase
            .from("message_dedup")
            .select("*")
            .eq("message_id", messageId)
            .maybeSingle();

        if (existing?.status === "completed") {
            console.log(
                `Message ${messageId} already processed; ignoring duplicate`
            );
            return new Response("EVENT_RECEIVED", { status: 200 });
        }

        // Record as processing
        await supabase.from("message_dedup").upsert({
            message_id: messageId,
            phone: senderPhone,
            status: "processing"
        });
    }

    try {
        // ============================================================
        // EXTRACT MESSAGE CONTENT
        // ============================================================

        const inbound = extractInboundMessage(message);
        const messageType = inbound.type || String(message.type);
        const messageText = inbound.text || "";

        // ============================================================
        // LOG INBOUND MESSAGE
        // ============================================================

        await logWhatsAppMessage(supabase, {
            direction: "INBOUND",
            phone: senderPhone,
            name: senderName,
            status: messageType,
            message: messageText ||
                (inbound.latitude
                    ? `[location: ${inbound.latitude},${inbound.longitude}]`
                    : ""),
            message_id: messageId,
            phone_number_id: phoneNumberId
        });

        // ============================================================
        // PROCESS MESSAGE
        // ============================================================

        if (messageText || inbound.latitude) {
            await processMessage(
                supabase,
                whatsappClient,
                {
                    messageId,
                    senderPhone,
                    senderName,
                    messageText,
                    messageType,
                    latitude: inbound.latitude,
                    longitude: inbound.longitude,
                    clinicId: clinic.clinicId
                }
            );
        }

        // ============================================================
        // MARK AS COMPLETED
        // ============================================================

        if (messageId) {
            await supabase
                .from("message_dedup")
                .update({ status: "completed" })
                .eq("message_id", messageId);
        }

        return new Response("EVENT_RECEIVED", { status: 200 });
    } catch (error) {
        console.error("Message processing error:", error);

        // Log error
        await logWhatsAppMessage(supabase, {
            direction: "WEBHOOK",
            phone: senderPhone,
            status: "ERROR",
            message: error.message
        });

        // Mark as failed
        if (messageId) {
            await supabase
                .from("message_dedup")
                .update({
                    status: "failed",
                    result: { error: error.message }
                })
                .eq("message_id", messageId);
        }

        // Return OK anyway (WhatsApp expects 200, we log the error)
        return new Response("EVENT_RECEIVED", { status: 200 });
    }
}
