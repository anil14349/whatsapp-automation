/**
 * What a reminder calls the appointment.
 *
 * A sample collection has no doctor, and the missing name was defaulted to the
 * literal string "Dr." before the template prefixed it again. A real handset
 * received "an appointment with Dr. Dr. tomorrow at 10:00".
 *
 * The free-form message and the template parameter are built from the same
 * helper here, because the registered template body reads "appointment with
 * {{2}}" and would otherwise drop the title the free-form version prints.
 */

import { assert, assertEquals, assertStringIncludes } from "std/testing/asserts.ts";
import { formatReminderMessage, reminderPhrase, reminderSubject } from "../shared/appointment-reminders.ts";

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");

const BASE = {
    reminderType: "24_HOUR" as const,
    patientName: "Anil",
    appointmentDate: "2026-09-19",
    appointmentTime: "10:00",
    language: "EN"
};

Deno.test("a doctor is titled once, not twice", () => {
    const said = formatReminderMessage({ ...BASE, doctorName: "Akilesh" });

    assertStringIncludes(said, "an appointment with Dr. Akilesh tomorrow");
    assert(!/Dr\.\s*Dr\./.test(said), said);
});

Deno.test("a service takes the adjective position, not 'with'", () => {
    // "an appointment with Sample Collection" is not English.
    const said = formatReminderMessage({ ...BASE, serviceName: "Sample Collection" });

    assertStringIncludes(said, "a Sample Collection appointment tomorrow");
    assert(!/with Sample Collection/i.test(said), said);
    assert(!/Dr\./.test(said), said);
    assert(!/undefined/i.test(said), said);
});

Deno.test("the reminder does not ask for typed words, the buttons carry that", () => {
    const said = formatReminderMessage({ ...BASE, serviceName: "Sample Collection" });

    assert(!/Reply CANCEL/i.test(said), said);
    assert(!/RESCHEDULE/i.test(said), said);
});

Deno.test("the hour-before reminder follows the same rule", () => {
    const withDoctor = formatReminderMessage({
        ...BASE,
        reminderType: "1_HOUR",
        doctorName: "Akilesh"
    });
    const without = formatReminderMessage({
        ...BASE,
        reminderType: "1_HOUR",
        serviceName: "Sample Collection"
    });

    assertStringIncludes(withDoctor, "Dr. Akilesh");
    assertStringIncludes(without, "Sample Collection");
    assert(!/Dr\./.test(without), without);
});

Deno.test("neither a doctor nor a service still reads as a sentence", () => {
    const said = formatReminderMessage(BASE);

    assertStringIncludes(said, "You have an appointment tomorrow");
    assert(!/undefined|null/i.test(said), said);
});

Deno.test("Hindi titles the doctor in Hindi", () => {
    const said = formatReminderMessage({ ...BASE, doctorName: "Akilesh", language: "HI" });

    assertStringIncludes(said, "डॉ. Akilesh");
    assert(!/Dr\./.test(said), said);
});

Deno.test("the template parameter carries the same phrase as the message", () => {
    // The template body reads "you have {{2}}", so the parameter must be the
    // whole phrase. These two drifted once already.
    assertEquals(reminderPhrase("Akilesh", "Consultation", "EN"), "an appointment with Dr. Akilesh");
    assertEquals(reminderPhrase(undefined, "Sample Collection", "EN"), "a Sample Collection appointment");
    assertEquals(reminderPhrase(undefined, undefined, "EN"), "an appointment");

    const said = formatReminderMessage({ ...BASE, serviceName: "Sample Collection" });
    assertStringIncludes(said, reminderPhrase(undefined, "Sample Collection", "EN"));
});

Deno.test("the hour-before label stays short, since it is not in a sentence", () => {
    assertEquals(reminderSubject("Akilesh", undefined, "EN"), "Dr. Akilesh");
    assertEquals(reminderSubject(undefined, "Sample Collection", "EN"), "Sample Collection");
});
