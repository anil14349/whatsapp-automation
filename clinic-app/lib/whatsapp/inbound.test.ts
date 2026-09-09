import { describe, expect, it } from "vitest";
import { extractInboundWhatsAppMessage } from "./inbound";

describe("extractInboundWhatsAppMessage", () => {
  it("extracts free text", () => {
    expect(
      extractInboundWhatsAppMessage({ type: "text", text: { body: "  Hi  " } })
    ).toEqual({ type: "text", text: "Hi" });
  });

  it("extracts an interactive button reply id", () => {
    expect(
      extractInboundWhatsAppMessage({
        type: "interactive",
        interactive: { type: "button_reply", button_reply: { id: "confirm_yes" } }
      })
    ).toEqual({ type: "interactive", text: "confirm_yes" });
  });

  it("extracts an interactive list reply id", () => {
    expect(
      extractInboundWhatsAppMessage({
        type: "interactive",
        interactive: { type: "list_reply", list_reply: { id: "doctor_select_D001" } }
      })
    ).toEqual({ type: "interactive", text: "doctor_select_D001" });
  });

  it("extracts a shared location", () => {
    expect(
      extractInboundWhatsAppMessage({
        type: "location",
        location: { latitude: 17.385, longitude: 78.4867 }
      })
    ).toEqual({ type: "location", text: "", latitude: 17.385, longitude: 78.4867 });
  });

  it("extracts a WhatsApp Flow completion (nfm_reply) payload", () => {
    expect(
      extractInboundWhatsAppMessage({
        type: "interactive",
        interactive: {
          type: "nfm_reply",
          nfm_reply: { response_json: '{"appointment_code":"A1234ABCD"}' }
        }
      })
    ).toEqual({ type: "flow_reply", text: "", flowResponse: { appointment_code: "A1234ABCD" } });
  });

  it("falls back to an empty flowResponse if the nfm_reply JSON is malformed", () => {
    expect(
      extractInboundWhatsAppMessage({
        type: "interactive",
        interactive: { type: "nfm_reply", nfm_reply: { response_json: "not json" } }
      })
    ).toEqual({ type: "flow_reply", text: "", flowResponse: {} });
  });

  it("falls back to an empty-text entry for an unrecognized/unsupported type", () => {
    expect(extractInboundWhatsAppMessage({ type: "sticker" })).toEqual({
      type: "sticker",
      text: ""
    });
  });
});
