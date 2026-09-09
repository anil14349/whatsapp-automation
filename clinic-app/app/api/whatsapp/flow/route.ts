import { NextRequest, NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { GoogleCalendar } from "@/lib/calendar/google";
import {
  decryptFlowRequest,
  encryptFlowResponse,
  FlowDecryptionError,
  type EncryptedFlowRequestBody
} from "@/lib/whatsapp/flowCrypto";
import {
  handleFlowDataExchange,
  handleFlowInit,
  type FlowRequestContext
} from "@/lib/whatsapp/flowBooking";

/**
 * The WhatsApp Flow "Data Exchange" endpoint for the Book Appointment
 * flow (see clinic-app/whatsapp-flows/booking-flow.json,
 * lib/whatsapp/flowBooking.ts, lib/whatsapp/flowCrypto.ts).
 *
 * Every request/response here is encrypted per Meta's spec — see
 * flowCrypto.ts for the algorithm details. This route's own job is just
 * the HTTP/wire-format contract: decrypt, dispatch to flowBooking by
 * action, encrypt the response, and get the handful of special
 * status codes right (421 on decryption failure so Meta refreshes the
 * public key it has on file for this endpoint; the "ping" health check
 * Meta polls periodically).
 *
 * Uses the same WHATSAPP_WEBHOOK_POST_TOKEN query-param + fail-closed
 * pattern as app/api/whatsapp/webhook/route.ts, rather than introducing
 * a second secret — an unrecognized token gets a plain 200 with no
 * processing, same reasoning as that route's comment.
 *
 * NOT exercised against a live WhatsApp Flow from this environment (no
 * reachable Meta test number/Flow) — see clinic-app/README.md's
 * WhatsApp Flows section for what's been verified vs. not.
 */

export async function POST(request: NextRequest): Promise<NextResponse> {
  const env = getServerEnv();
  const token = request.nextUrl.searchParams.get("token") ?? "";

  if (token !== env.WHATSAPP_WEBHOOK_POST_TOKEN) {
    return new NextResponse("", { status: 200 });
  }

  if (!env.WHATSAPP_FLOW_PRIVATE_KEY) {
    console.error("WhatsApp Flow endpoint called but WHATSAPP_FLOW_PRIVATE_KEY is not configured.");
    return new NextResponse("Flow endpoint not configured", { status: 421 });
  }

  const body = (await request.json()) as EncryptedFlowRequestBody;

  let decrypted;

  try {
    decrypted = decryptFlowRequest(
      body,
      env.WHATSAPP_FLOW_PRIVATE_KEY.replace(/\\n/g, "\n"),
      env.WHATSAPP_FLOW_PRIVATE_KEY_PASSPHRASE ?? ""
    );
  } catch (error) {
    if (error instanceof FlowDecryptionError) {
      // Per Meta's spec, 421 tells WhatsApp the public key it has on
      // file for this endpoint may be stale, prompting a re-fetch —
      // returning a generic 400/500 here instead would just cause silent
      // repeated failures with no path to recovery.
      console.error("WhatsApp Flow decryption failed:", error.message);
      return new NextResponse("", { status: 421 });
    }

    throw error;
  }

  const { payload, aesKey, initialVector } = decrypted;
  const action = String(payload.action ?? "");

  // Meta's periodic endpoint health check — must be answered in the same
  // encrypted envelope as everything else, not a plain 200.
  if (action === "ping") {
    const encrypted = encryptFlowResponse({ data: { status: "active" } }, aesKey, initialVector);
    return new NextResponse(encrypted, { status: 200, headers: { "Content-Type": "text/plain" } });
  }

  const flowToken = String(payload.flow_token ?? "");

  if (!flowToken) {
    const encrypted = encryptFlowResponse(
      { error_msg: "Missing flow_token." },
      aesKey,
      initialVector
    );
    return new NextResponse(encrypted, { status: 200, headers: { "Content-Type": "text/plain" } });
  }

  const ctx: FlowRequestContext = {
    supabase: getSupabaseServerClient(),
    calendar: new GoogleCalendar(),
    timezone: env.CLINIC_TIMEZONE,
    phone: flowToken
  };

  try {
    const screenResponse =
      action === "INIT"
        ? await handleFlowInit(ctx)
        : await handleFlowDataExchange(
            ctx,
            String(payload.screen ?? ""),
            (payload.data as Record<string, unknown>) ?? {}
          );

    const responseBody =
      "terminal" in screenResponse
        ? {
            version: "3.0",
            screen: "SUCCESS",
            data: {
              extension_message_response: {
                params: { flow_token: flowToken, ...screenResponse.data }
              }
            }
          }
        : { version: "3.0", screen: screenResponse.screen, data: screenResponse.data };

    const encrypted = encryptFlowResponse(responseBody, aesKey, initialVector);
    return new NextResponse(encrypted, { status: 200, headers: { "Content-Type": "text/plain" } });
  } catch (error) {
    console.error("WhatsApp Flow data_exchange error:", error);

    const encrypted = encryptFlowResponse(
      { error_msg: "Something went wrong. Please send Hi to start again in chat." },
      aesKey,
      initialVector
    );
    return new NextResponse(encrypted, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
}
