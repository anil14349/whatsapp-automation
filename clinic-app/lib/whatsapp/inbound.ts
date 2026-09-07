/**
 * Ported from extractInboundWhatsAppMessage in src/Webhook.gs. Pure
 * function — takes the raw "message" object from Meta's webhook payload
 * and normalizes it to one shape regardless of whether it came in as
 * free text, an interactive button/list tap, or a shared location.
 */

export type InboundMessage =
  | { type: "text"; text: string }
  | { type: "interactive"; text: string }
  | { type: "location"; text: ""; latitude: number; longitude: number }
  | { type: string; text: "" };

interface RawWhatsAppMessage {
  type?: string;
  text?: { body?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string };
    list_reply?: { id?: string };
  };
  location?: { latitude?: number; longitude?: number };
}

export function extractInboundWhatsAppMessage(
  message: RawWhatsAppMessage
): InboundMessage {
  const messageType = String(message.type ?? "");

  if (messageType === "text" && message.text?.body !== undefined) {
    return { type: "text", text: String(message.text.body).trim() };
  }

  if (messageType === "interactive" && message.interactive) {
    const interactive = message.interactive;

    if (interactive.type === "button_reply" && interactive.button_reply) {
      return {
        type: "interactive",
        text: String(interactive.button_reply.id ?? "").trim()
      };
    }

    if (interactive.type === "list_reply" && interactive.list_reply) {
      return {
        type: "interactive",
        text: String(interactive.list_reply.id ?? "").trim()
      };
    }
  }

  // WhatsApp's native "Share Location" attachment — used by the home
  // blood-sample-collection flow to check the patient is within the
  // configured radius of the clinic. Carries no text body, so downstream
  // code must key off latitude/longitude, not the message text.
  if (
    messageType === "location" &&
    message.location?.latitude !== undefined &&
    message.location?.longitude !== undefined
  ) {
    return {
      type: "location",
      text: "",
      latitude: Number(message.location.latitude),
      longitude: Number(message.location.longitude)
    };
  }

  return { type: messageType, text: "" };
}
