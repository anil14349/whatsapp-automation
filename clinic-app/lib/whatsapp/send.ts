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
