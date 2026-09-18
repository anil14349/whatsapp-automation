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
import { formatReminderMessage, reminderSubject } from "../shared/appointment-reminders.ts";

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

    assertStringIncludes(said, "with Dr. Akilesh tomorrow");
    assert(!/Dr\.\s*Dr\./.test(said), said);
});

Deno.test("a service with no doctor is named instead", () => {
    const said = formatReminderMessage({ ...BASE, serviceName: "Sample Collection" });

    assertStringIncludes(said, "with Sample Collection tomorrow");
    assert(!/Dr\./.test(said), said);
    assert(!/undefined/i.test(said), said);
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

    assertStringIncludes(said, "with your appointment tomorrow");
    assert(!/undefined|null/i.test(said), said);
});

Deno.test("Hindi titles the doctor in Hindi", () => {
    const said = formatReminderMessage({ ...BASE, doctorName: "Akilesh", language: "HI" });

    assertStringIncludes(said, "डॉ. Akilesh");
    assert(!/Dr\./.test(said), said);
});

Deno.test("the template parameter carries the same title as the message", () => {
    // The template body has no "Dr." of its own, so the parameter must.
    assertEquals(reminderSubject("Akilesh", "Consultation", "EN"), "Dr. Akilesh");
    assertEquals(reminderSubject(undefined, "Sample Collection", "EN"), "Sample Collection");
    assertEquals(reminderSubject(undefined, undefined, "EN"), "your appointment");
});
