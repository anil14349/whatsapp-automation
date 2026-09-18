import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractInboundMessage } from "../shared/validators.ts";
import { logWhatsAppMessage } from "../shared/logger.ts";
import { processMessage } from "../shared/message-processor.ts";
import { WhatsAppClient } from "../shared/whatsapp-client.ts";
import {
    getClinicByPhoneNumberId,
    isValidVerifyToken,
    getClinicIdByWebhookToken,
    getClinicAppSecret
} from "../shared/clinic-routing.ts";
import { isSignatureValid, signatureHeaderName } from "../shared/webhook-signature.ts";
import { redactCredentials } from "../shared/inbound-redaction.ts";
import { recordReminderDelivery } from "../shared/delivery-status.ts";

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
                message: error instanceof Error ? error.message : String(error),
                metadata: { stack: error instanceof Error ? error.stack : undefined }
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
 * Is this delivery actually from Meta?
 *
 * Enforcement follows the data rather than a flag day. A clinic that has an app
 * secret must send a valid signature; one that has not been configured yet
 * keeps working on the query token, because switching this on everywhere at
 * once would silently drop real patients' messages. Set
 * WHATSAPP_REQUIRE_SIGNATURE=true once every clinic has a secret.
 */
async function isRequestSigned(
    rawBody: string,
    req: Request,
    clinicId: string
): Promise<boolean> {
    const appSecret = await getClinicAppSecret(supabase, clinicId);
    const header = req.headers.get(signatureHeaderName());
    const required = Deno.env.get("WHATSAPP_REQUIRE_SIGNATURE") === "true";

    if (!appSecret) {
        if (required) {
            console.error("No app secret configured and signatures are required", {
                clinicId
            });
            return false;
        }

        console.warn(
            "Webhook accepted on the query token alone: no app secret is set for this clinic",
            { clinicId }
        );
        return true;
    }

    if (await isSignatureValid(rawBody, header, appSecret)) {
        return true;
    }

    console.error("Webhook signature did not verify", {
        clinicId,
        hadHeader: Boolean(header)
    });
    return false;
}

/**
 * Record what Meta says happened to a message we sent.
 *
 * `failed` is the one that matters: a number outside the app's tester list, or
 * not on WhatsApp at all, is accepted at send time and only reported here.
 */
async function recordDeliveryStatuses(
    statuses: any[] | undefined,
    clinicId: string
): Promise<void> {
    if (!Array.isArray(statuses) || statuses.length === 0) {
        return;
    }

    for (const status of statuses) {
        const id = String(status?.id || "");

        if (!id) {
            continue;
        }

        const errors = Array.isArray(status.errors)
            ? status.errors.map((e: any) => ({
                code: e?.code,
                title: e?.title,
                detail: e?.error_data?.details ?? e?.message
            }))
            : undefined;

        if (errors) {
            console.error("WhatsApp reported a delivery failure", { id, errors });
        }

        const { error } = await supabase
            .from("whatsapp_log")
            .update({
                metadata: {
                    delivery: status.status,
                    at: status.timestamp,
                    ...(errors ? { errors } : {})
                }
            })
            .eq("message_id", id);

        if (error) {
            console.error("Could not record delivery status", { id, error: error.message });
        }

        await recordDocumentDelivery(id, String(status.status || ""), errors);

        const reminder = await recordReminderDelivery(
            supabase,
            clinicId,
            id,
            String(status.status || ""),
            errors
        );

        if (reminder.found) {
            console.error("A reminder was not delivered", {
                id,
                retryAsTemplate: reminder.retrying
            });
        }
    }
}

/**
 * Carry the same verdict onto a document, if this message was one.
 *
 * A report was marked SENT the moment Meta accepted it, so the desk was told
 * the patient had it. Meta reports the real outcome only here.
 */
async function recordDocumentDelivery(
    messageId: string,
    deliveryStatus: string,
    errors: Array<{ code?: number; title?: string; detail?: string }> | undefined
): Promise<void> {
    if (deliveryStatus !== "failed" && deliveryStatus !== "delivered" && deliveryStatus !== "read") {
        return;
    }

    const failed = deliveryStatus === "failed";

    const { error } = await supabase
        .from("patient_documents")
        .update({
            status: failed ? "FAILED" : "DELIVERED",
            error_message: failed
                ? errors?.map((e) => e.detail ?? e.title).filter(Boolean).join("; ") ||
                  "WhatsApp could not deliver it"
                : null,
            updated_at: new Date().toISOString()
        })
        .eq("message_id", messageId)
        // `read` can arrive after `delivered`; neither should reopen a failure
        // the desk has already been shown.
        .in("status", failed ? ["PENDING", "SENT", "DELIVERED"] : ["PENDING", "SENT"]);

    if (error) {
        console.error("Could not update document delivery", { messageId, error: error.message });
    }
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
    const tokenClinicId = await getClinicIdByWebhookToken(supabase, webhookToken);

    if (!tokenClinicId) {
        console.error("Invalid webhook token");
        return new Response("Unauthorized", { status: 401 });
    }

    // The signature covers the bytes Meta sent, so the body is read as text and
    // parsed from that same string. Re-serialising would change it.
    const rawBody = await req.text();

    if (!(await isRequestSigned(rawBody, req, tokenClinicId))) {
        return new Response("Unauthorized", { status: 401 });
    }

    let body: any;

    try {
        body = JSON.parse(rawBody);
    } catch {
        console.error("Webhook body was not JSON");
        return new Response("Bad Request", { status: 400 });
    }

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

    if (!message) {
        // Delivery reports arrive here. They were discarded, which is why a
        // message id from Meta looked like proof of delivery: an undelivered
        // message and a read one were indistinguishable afterwards.
        await recordDeliveryStatuses(value.statuses, tokenClinicId);
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

    // A clinic's token must not be usable to write into another clinic's tenant.
    if (clinic.clinicId !== tokenClinicId) {
        console.error("Webhook token does not match the clinic for this number", {
            phoneNumberId,
            tokenClinicId,
            routedClinicId: clinic.clinicId
        });
        return new Response("Unauthorized", { status: 401 });
    }

    // Replies must come from the clinic's own number, using its own token.
    const whatsappClient = new WhatsAppClient(
        clinic.accessToken,
        clinic.phoneNumberId,
        supabase,
        clinic.clinicId
    );

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
            message: messageText
                ? await redactCredentials(
                    supabase,
                    clinic.clinicId,
                    senderPhone,
                    messageType,
                    messageText
                )
                : (inbound.latitude
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

        const reason = error instanceof Error ? error.message : String(error);

        // Log error
        await logWhatsAppMessage(supabase, {
            direction: "WEBHOOK",
            phone: senderPhone,
            status: "ERROR",
            message: reason
        });

        // Mark as failed
        if (messageId) {
            await supabase
                .from("message_dedup")
                .update({
                    status: "failed",
                    result: { error: reason }
                })
                .eq("message_id", messageId);
        }

        // Return OK anyway (WhatsApp expects 200, we log the error)
        return new Response("EVENT_RECEIVED", { status: 200 });
    }
}
