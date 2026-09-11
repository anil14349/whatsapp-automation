/**
 * WhatsApp Webhook Handler
 * POST /api/webhooks/whatsapp
 *
 * Receives messages and status updates from WhatsApp Cloud API
 * Requires:
 * - WHATSAPP_VERIFY_TOKEN environment variable
 * - Proper clinic configuration
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  verifyWhatsAppSignature,
  extractMessages,
  extractStatuses,
  logWebhookEvent,
  getWebhookSettings,
  updateWebhookEventStatus,
  type WhatsAppWebhookPayload
} from "@/lib/whatsapp/webhook";
import { processIncomingMessage } from "@/lib/whatsapp/messageProcessor";
import { processStatusUpdates } from "@/lib/whatsapp/statusProcessor";
import { routeAdvancedMessage } from "@/lib/whatsapp/advancedMessageHandlers";

/**
 * GET /api/webhooks/whatsapp
 * Webhook verification endpoint
 * WhatsApp sends verification request during setup
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const mode = searchParams.get("hub.mode");
    const token = searchParams.get("hub.verify_token");
    const challenge = searchParams.get("hub.challenge");

    // Verify the token matches our configured verify token
    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

    if (!verifyToken) {
      console.error("WHATSAPP_VERIFY_TOKEN not configured");
      return NextResponse.json(
        { error: "Webhook not configured" },
        { status: 500 }
      );
    }

    if (mode === "subscribe" && token === verifyToken && challenge) {
      // Verification successful
      return new NextResponse(challenge, { status: 200 });
    }

    // Verification failed
    return NextResponse.json(
      { error: "Verification failed" },
      { status: 403 }
    );
  } catch (error) {
    console.error("GET /api/webhooks/whatsapp error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/webhooks/whatsapp
 * Receives messages and status updates from WhatsApp
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Get raw body for signature verification
    const rawBody = await request.text();
    const signature = request.headers.get("x-hub-signature-256");

    // Parse JSON
    let payload: WhatsAppWebhookPayload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      console.error("Invalid JSON payload");
      return NextResponse.json(
        { error: "Invalid payload" },
        { status: 400 }
      );
    }

    // Verify webhook signature
    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
    try {
      if (!verifyToken || !verifyWhatsAppSignature(rawBody, signature, verifyToken)) {
        console.error("Webhook signature verification failed");
        return NextResponse.json(
          { error: "Invalid signature" },
          { status: 403 }
        );
      }
    } catch (error) {
      console.error("Signature verification error:", error);
      return NextResponse.json(
        { error: "Invalid signature" },
        { status: 403 }
      );
    }

    // Initialize Supabase
    const supabase = getSupabaseServerClient();

    // Log the webhook event
    const { data: eventData, error: eventError } = await supabase
      .from("webhook_events")
      .insert({
        source: "whatsapp",
        event_type: "webhook_received",
        payload,
        status: "pending"
      })
      .select("id")
      .single();

    if (eventError) {
      console.error("Failed to log webhook event:", eventError);
      return NextResponse.json(
        { error: "Failed to log event" },
        { status: 500 }
      );
    }

    const webhookEventId = eventData?.id;

    // Validate clinic configuration FIRST
    const clinicId = process.env.CLINIC_ID;
    if (!clinicId) {
      console.error("CLINIC_ID environment variable not configured");
      return NextResponse.json(
        { error: "Webhook not properly configured for this instance" },
        { status: 500 }
      );
    }

    // Extract messages and statuses
    const messages = extractMessages(payload);
    const statuses = extractStatuses(payload);

    console.log(`Webhook received: ${messages.length} messages, ${statuses.length} statuses`);

    // Process messages
    const processingPromises: Promise<void>[] = [];

    for (const message of messages) {

      // Add message processing to queue
      processingPromises.push(
        (async () => {
          try {
            const result = await processIncomingMessage(
              supabase,
              clinicId,
              message
            );

            if (!result.success) {
              console.error(`Message processing failed: ${result.error}`);
              await updateWebhookEventStatus(
                supabase,
                webhookEventId,
                "failed",
                result.error
              );
            }
          } catch (error) {
            console.error("Error processing message:", error);
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            await updateWebhookEventStatus(
              supabase,
              webhookEventId,
              "failed",
              errorMessage
            );
          }
        })()
      );
    }

    // Process statuses using the enhanced status processor
    if (statuses.length > 0) {
      processingPromises.push(
        (async () => {
          try {
            const statusResults = await processStatusUpdates(
              supabase,
              clinicId,
              payload
            );

            // Log any failed status updates
            const failedStatuses = statusResults.filter(r => !r.success);
            if (failedStatuses.length > 0) {
              console.warn(`${failedStatuses.length} status updates failed:`, failedStatuses);
            }

            console.log(`Processed ${statusResults.length} status updates`);
          } catch (error) {
            console.error("Error processing status updates:", error);
          }
        })()
      );
    }

    // Wait for all processing to complete (with timeout) and track results
    const timeoutPromise = new Promise<PromiseSettledResult<void>[]>((resolve) => {
      setTimeout(() => {
        console.warn("Message processing timeout - responding to webhook anyway");
        resolve([]);
      }, 30000); // 30 second timeout
    });

    const results = await Promise.race([
      Promise.allSettled(processingPromises),
      timeoutPromise
    ]);

    // Determine final webhook status based on results
    const failedCount = results?.filter(r => r.status === 'rejected').length || 0;
    const successCount = results?.filter(r => r.status === 'fulfilled').length || 0;

    // Mark webhook with appropriate status
    if (webhookEventId) {
      await updateWebhookEventStatus(
        supabase,
        webhookEventId,
        failedCount > 0 ? "failed" : "processed",
        failedCount > 0 ? `${failedCount}/${results?.length || 0} messages failed` : undefined
      );
    }

    const processingTime = Date.now() - startTime;
    console.log(`Webhook processed successfully in ${processingTime}ms`);

    // Return success
    return NextResponse.json(
      { success: true, processingTime },
      { status: 200 }
    );
  } catch (error) {
    console.error("POST /api/webhooks/whatsapp error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    return NextResponse.json(
      { error: "Failed to process webhook", message: errorMessage },
      { status: 500 }
    );
  }
}

/**
 * Handle other methods
 */
export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
}
