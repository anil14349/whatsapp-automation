/**
 * Messages the clinic starts, and the 24 hour window they run into.
 *
 * The bug being covered: every reminder was sent as a free-form message, which
 * Meta only accepts within 24 hours of the patient's own last message. A
 * reminder is by definition sent later than that, so Meta rejected it with
 * 131047, the row was marked failed, retried twice more against the same closed
 * window, and the patient was never told.
 */

import { assert, assertEquals } from "std/testing/asserts.ts";
import { FakeWhatsAppClient } from "./helpers/fake-whatsapp.ts";
import { sendProactive, templateLanguage, templateName } from "../shared/proactive.ts";
import { WhatsAppApiError } from "../shared/whatsapp-client.ts";

const PHONE = "919000000001";

const REMINDER = {
    key: "appointment_reminder_24h" as const,
    parameters: ["Asha", "Dr Kumar", "2026-09-17", "10:30"]
};

function outsideWindow(): WhatsAppApiError {
    return new WhatsAppApiError(
        "WhatsApp API error: Message failed to send because more than 24 hours have passed",
        131047
    );
}

Deno.test("inside the window it stays a normal message and costs no template", async () => {
    const wa = new FakeWhatsAppClient();

    const result = await sendProactive(wa, PHONE, "Reminder: 10:30 tomorrow", REMINDER);

    assertEquals(result.delivered, true);
    assertEquals(result.via, "text");
    assertEquals(wa.sent.length, 1);
    assertEquals(wa.sent[0].type, "text");
});

Deno.test("outside the window it falls back to the template", async () => {
    const wa = new FakeWhatsAppClient();
    wa.textError = outsideWindow();

    const result = await sendProactive(wa, PHONE, "Reminder: 10:30 tomorrow", REMINDER);

    assertEquals(result.delivered, true);
    assertEquals(result.via, "template");

    const sent = wa.sent.find((m) => m.type === "template");

    assert(sent, "a template should have been sent");
    assertEquals(sent?.body, "appointment_reminder_24h");
    assertEquals(sent?.parameters, ["Asha", "Dr Kumar", "2026-09-17", "10:30"]);
});

Deno.test("a Hindi speaker gets the Hindi template", async () => {
    const wa = new FakeWhatsAppClient();
    wa.textError = outsideWindow();

    await sendProactive(wa, PHONE, "…", { ...REMINDER, language: "HI" });

    assertEquals(wa.sent.find((m) => m.type === "template")?.templateLanguage, "hi");
});

Deno.test("an unknown language falls back to English rather than failing", () => {
    assertEquals(templateLanguage("TA"), "en");
    assertEquals(templateLanguage(undefined), "en");
    assertEquals(templateLanguage("hi"), "hi");
});

Deno.test("a template that Meta has never heard of is not retried", async () => {
    const wa = new FakeWhatsAppClient();
    wa.textError = outsideWindow();
    wa.templateError = new WhatsAppApiError("Template name does not exist", 132001);

    const result = await sendProactive(wa, PHONE, "…", REMINDER);

    assertEquals(result.delivered, false);
    assertEquals(result.reason, "template_unavailable");
    assertEquals(result.retryable, false, "retrying a template Meta lacks is pointless");
});

Deno.test("outside the window with no template to fall back to is not retried", async () => {
    const wa = new FakeWhatsAppClient();
    wa.textError = outsideWindow();

    const result = await sendProactive(wa, PHONE, "…", null);

    assertEquals(result.delivered, false);
    assertEquals(result.reason, "outside_window");
    assertEquals(result.retryable, false);
});

Deno.test("an ordinary failure stays retryable", async () => {
    const wa = new FakeWhatsAppClient();
    wa.textError = new WhatsAppApiError("Service temporarily unavailable", 500);

    const result = await sendProactive(wa, PHONE, "…", REMINDER);

    assertEquals(result.delivered, false);
    assertEquals(result.reason, "send_failed");
    assertEquals(result.retryable, true);
    assertEquals(
        wa.sent.filter((m) => m.type === "template").length,
        0,
        "a transient error is not a closed window, so the template must not be spent"
    );
});

Deno.test("a template failing for a transient reason stays retryable", async () => {
    const wa = new FakeWhatsAppClient();
    wa.textError = outsideWindow();
    wa.templateError = new WhatsAppApiError("Service temporarily unavailable", 500);

    const result = await sendProactive(wa, PHONE, "…", REMINDER);

    assertEquals(result.delivered, false);
    assertEquals(result.reason, "send_failed");
    assertEquals(result.retryable, true);
});

Deno.test("a rejection that lost its code is still recognised by its wording", async () => {
    const wa = new FakeWhatsAppClient();
    // Older throw sites flattened the code into the message.
    wa.textError = new WhatsAppApiError(
        "WhatsApp API error: Message failed to send because more than 24 hours have passed",
        null
    );

    const result = await sendProactive(wa, PHONE, "…", REMINDER);

    assertEquals(result.delivered, true);
    assertEquals(result.via, "template");
});

Deno.test("a clinic can point a template at its own registered name", () => {
    assertEquals(templateName("appointment_reminder_24h"), "appointment_reminder_24h");

    Deno.env.set("TEMPLATE_APPOINTMENT_REMINDER_24H", "wellsun_reminder_v2");

    try {
        assertEquals(templateName("appointment_reminder_24h"), "wellsun_reminder_v2");
    } finally {
        Deno.env.delete("TEMPLATE_APPOINTMENT_REMINDER_24H");
    }
});
