import { NextRequest, NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { GoogleCalendar } from "@/lib/calendar/google";
import { getSetting, getBooleanSetting } from "@/lib/settings";
import { getSession } from "@/lib/sessions";
import { extractInboundWhatsAppMessage } from "@/lib/whatsapp/inbound";
import { tryBeginMessageProcessing } from "@/lib/whatsapp/dedup";
import { logMessage } from "@/lib/whatsapp/log";
import { processInboundMessage } from "@/lib/whatsapp/router";
import type { FlowContext } from "@/lib/whatsapp/context";
import { sendWhatsAppText } from "@/lib/whatsapp/send";

/**
 * Ports doGet/doPost from src/Webhook.gs.
 *
 * Verification and the POST token check are both fail-closed the same
 * way the Apps Script version was hardened to be (see that file's
 * comments) — an unconfigured token is never treated as "verification
 * disabled".
 */

/**
 * The Doctor Portal's broadcast confirmation (lib/whatsapp/doctorFlow.ts's
 * DOCTOR_BROADCAST_CONFIRM state) defers its actual send loop into an
 * after() callback so the reply below returns fast — but that callback
 * still runs inside this same invocation and is still bounded by
 * whatever maxDuration this route gets. The platform default without
 * this export is far too short for a doctor with more than a handful of
 * confirmed appointments that day. Raise this further (see
 * CONFIGURATION.md's "Doctor broadcast timeouts" section) if a clinic's
 * patient volume still isn't finishing broadcasts in time — bounded by
 * whatever your hosting plan actually allows.
 */
export const maxDuration = 60;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  const env = getServerEnv();

  if (mode === "subscribe" && token === env.WHATSAPP_VERIFY_TOKEN) {
    return new NextResponse(challenge ?? "", { status: 200 });
  }

  return new NextResponse("Verification failed", { status: 403 });
}

interface WhatsAppWebhookBody {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: Array<{
          id?: string;
          from?: string;
          type?: string;
          text?: { body?: string };
          interactive?: {
            type?: string;
            button_reply?: { id?: string };
            list_reply?: { id?: string };
            nfm_reply?: { response_json?: string };
          };
          location?: { latitude?: number; longitude?: number };
        }>;
        contacts?: Array<{ profile?: { name?: string } }>;
        metadata?: { phone_number_id?: string };
      };
    }>;
  }>;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const env = getServerEnv();
  const token = request.nextUrl.searchParams.get("token") ?? "";

  // Fail closed: WHATSAPP_WEBHOOK_POST_TOKEN is required by lib/env.ts's
  // schema (throws if unset), so there's no "unconfigured -> accept
  // anything" path here at all — a stricter guarantee than the Apps
  // Script version could make, since that ran even with missing script
  // properties.
  if (token !== env.WHATSAPP_WEBHOOK_POST_TOKEN) {
    return okResponse();
  }

  let messageId = "";

  try {
    const body = (await request.json()) as WhatsAppWebhookBody;

    const value = body.entry?.[0]?.changes?.[0]?.value;
    const message = value?.messages?.[0];

    if (!message) {
      return okResponse();
    }

    messageId = String(message.id ?? "");

    const supabase = getSupabaseServerClient();

    if (messageId && !(await tryBeginMessageProcessing(supabase, messageId))) {
      // Genuine duplicate delivery from Meta's retry behavior — already
      // processed, reply 200 OK without doing anything twice.
      return okResponse();
    }

    const senderPhone = String(message.from ?? "");
    const senderName = value?.contacts?.[0]?.profile?.name ?? "";
    const phoneNumberId = value?.metadata?.phone_number_id ?? "";

    const inbound = extractInboundWhatsAppMessage(message);

    let logText = "";

    if ("latitude" in inbound && "longitude" in inbound) {
      logText = `[location shared: ${inbound.latitude},${inbound.longitude}]`;
    } else if (inbound.type === "flow_reply" && "flowResponse" in inbound) {
      logText = `[flow completed: ${JSON.stringify(inbound.flowResponse)}]`;
    } else {
      logText = inbound.text;
    }

    await logMessage(supabase, {
      direction: "IN",
      phone: senderPhone,
      patientName: senderName,
      status: inbound.type,
      message: logText,
      phoneNumberId
    });

    if (inbound.type === "text" || inbound.type === "interactive" || inbound.type === "location") {
      const [clinicName, interactiveMenusEnabled, session] = await Promise.all([
        getSetting(supabase, "CLINIC_NAME", "ABC Clinic"),
        getBooleanSetting(supabase, "ENABLE_INTERACTIVE_MENUS", true),
        getSession(supabase, senderPhone)
      ]);

      const ctx: FlowContext = {
        supabase,
        calendar: new GoogleCalendar(),
        phone: senderPhone,
        senderName,
        clinicName,
        interactiveMenusEnabled,
        timezone: env.CLINIC_TIMEZONE,
        language: session?.language || "EN"
      };

      const location =
        "latitude" in inbound && "longitude" in inbound
          ? { latitude: inbound.latitude, longitude: inbound.longitude }
          : undefined;

      await processInboundMessage(ctx, inbound.text, location);
    } else if (inbound.type === "flow_reply" && "flowResponse" in inbound) {
      // The Flow endpoint (app/api/whatsapp/flow/route.ts) already
      // created the appointment server-side during the final screen's
      // data_exchange, before WhatsApp ever sends this completion
      // message here — so this is purely an acknowledgement, not a
      // second booking attempt. Not yet verified against a live Flow
      // (see README): if Meta's nfm_reply contract turns out to carry
      // useful data worth surfacing, this is the place to read it from
      // inbound.flowResponse.
      await sendWhatsAppText(
        senderPhone,
        "Thanks! Your appointment request has been received."
      );
    }

    return okResponse();
  } catch (error) {
    console.error("WhatsApp webhook error:", error);

    try {
      await logMessage(getSupabaseServerClient(), {
        direction: "ERROR",
        status: "ERROR",
        message: error instanceof Error ? `${error.message}\n${error.stack}` : String(error)
      });
    } catch (logError) {
      console.error("Could not write error to message_log:", logError);
    }

    // WhatsApp webhooks always get a 200 back regardless of internal
    // failure — there's no useful non-2xx status to make Meta retry
    // with here, and a failed delivery with no reply is strictly worse
    // than a silent failure the clinic can find in message_log.
    return okResponse();
  }
}

function okResponse(): NextResponse {
  return new NextResponse("EVENT_RECEIVED", { status: 200 });
}
