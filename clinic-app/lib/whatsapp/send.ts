import { getServerEnv } from "@/lib/env";

/**
 * Low-level WhatsApp Cloud API senders. Ports the core of
 * src/WhatsApp_Send.gs (sendWhatsAppGraphPayload / sendWhatsAppText /
 * sendWhatsAppInteractiveMessage) — not every one of that file's ~30
 * convenience wrappers (sendPatientMainMenuReply, etc.); those are
 * presentation-layer sugar built on top of the same two primitives here,
 * added as each flow needs them rather than speculatively up front.
 */

export interface MenuRow {
  id: string;
  title: string;
  description?: string;
}

export interface ListMenuSpec {
  type: "list";
  buttonLabel: string;
  sections: Array<{ title: string; rows: MenuRow[] }>;
}

export interface ButtonMenuSpec {
  type: "button";
  buttons: Array<{ id: string; title: string }>;
}

export type InteractiveMenuSpec = ListMenuSpec | ButtonMenuSpec;

async function sendWhatsAppGraphPayload(
  to: string,
  payload: Record<string, unknown>
): Promise<unknown> {
  const env = getServerEnv();

  const url = `https://graph.facebook.com/v26.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`
    },
    body: JSON.stringify(payload)
  });

  const responseBody = await response.text();

  if (!response.ok) {
    throw new Error(`WhatsApp API error (${response.status}): ${responseBody}`);
  }

  return responseBody ? JSON.parse(responseBody) : null;
}

export async function sendWhatsAppText(to: string, messageText: string): Promise<void> {
  await sendWhatsAppGraphPayload(to, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { preview_url: false, body: messageText }
  });
}

export async function sendWhatsAppInteractive(
  to: string,
  bodyText: string,
  spec: InteractiveMenuSpec
): Promise<void> {
  const interactive =
    spec.type === "list"
      ? {
          type: "list",
          body: { text: bodyText },
          action: { button: spec.buttonLabel, sections: spec.sections }
        }
      : {
          type: "button",
          body: { text: bodyText },
          action: {
            buttons: spec.buttons.map((button) => ({
              type: "reply",
              reply: { id: button.id, title: button.title }
            }))
          }
        };

  await sendWhatsAppGraphPayload(to, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive
  });
}

/**
 * Sends the interactive "flow" message type that opens a native WhatsApp
 * Flow form in the patient's chat (see lib/whatsapp/flowBooking.ts +
 * app/api/whatsapp/flow/route.ts). `flowToken` round-trips back to our
 * Flow endpoint as `flow_token` on every screen request — we set it to
 * the patient's phone number so the endpoint can look up the same
 * whatsapp_sessions row the button-based booking flow uses, with no
 * extra token-to-phone mapping table needed.
 */
export async function sendWhatsAppFlow(
  to: string,
  bodyText: string,
  params: { flowId: string; flowToken: string; ctaLabel: string }
): Promise<void> {
  await sendWhatsAppGraphPayload(to, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "flow",
      body: { text: bodyText },
      action: {
        name: "flow",
        parameters: {
          flow_message_version: "3",
          flow_id: params.flowId,
          flow_token: params.flowToken,
          flow_cta: params.ctaLabel,
          flow_action: "navigate",
          flow_action_payload: { screen: "SELECT_DOCTOR" }
        }
      }
    }
  });
}

export interface MenuReply {
  fallbackText: string;
  interactive: InteractiveMenuSpec | null;
}

/**
 * Sends the interactive version if one was built (list/button — see
 * lib/whatsapp/menus.ts) and interactive menus are enabled; otherwise
 * falls back to a plain numbered-text message. Was sendWhatsAppMenuReply.
 */
export async function sendMenuReply(
  to: string,
  bodyText: string,
  menu: MenuReply,
  interactiveMenusEnabled: boolean
): Promise<void> {
  if (interactiveMenusEnabled && menu.interactive) {
    try {
      await sendWhatsAppInteractive(to, bodyText, menu.interactive);
      return;
    } catch (error) {
      console.error(
        "Interactive menu send failed, falling back to plain text.",
        error
      );
    }
  }

  await sendWhatsAppText(to, `${bodyText}\n\n${menu.fallbackText}`);
}
