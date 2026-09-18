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

    assertStringIncludes(said, "🩺 Dr. Akilesh");
    assert(!/Dr\.\s*Dr\./.test(said), said);
});

Deno.test("a service is not labelled as a doctor, or as anything else", () => {
    // No one label fits both: an appointment is "with" a doctor but "for" a
    // sample collection, and "Doctor: Sample Collection" is "Dr. Dr." again.
    const said = formatReminderMessage({ ...BASE, serviceName: "Sample Collection" });

    assertStringIncludes(said, "🩺 Sample Collection");
    assert(!/Doctor:/i.test(said), said);
    assert(!/\bWith:/i.test(said), said);
    assert(!/\bFor:/i.test(said), said);
    assert(!/Dr\./.test(said), said);
    assert(!/undefined/i.test(said), said);
});

Deno.test("the date and time are shown as a patient reads them", () => {
    // The scheduler used to pass the raw column values, so a reminder said
    // "2026-09-19" and "10:00" where the confirmation said "Saturday, 19
    // September" and "10:00 am" for the same booking.
    const said = formatReminderMessage({ ...BASE, doctorName: "Akilesh" });

    assertStringIncludes(said, "10:00 am");
    assertStringIncludes(said, "September");
    assert(!said.includes("2026-09-19"), said);
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

    assertStringIncludes(withDoctor, "🩺 Dr. Akilesh");
    assertStringIncludes(without, "🩺 Sample Collection");
    assert(!/Dr\./.test(without), without);
});

Deno.test("neither a doctor nor a service still reads as a sentence", () => {
    const said = formatReminderMessage(BASE);

    assertStringIncludes(said, "🩺 Appointment");
    assert(!/undefined|null/i.test(said), said);
});

Deno.test("Hindi titles the doctor in Hindi", () => {
    const said = formatReminderMessage({ ...BASE, doctorName: "Akilesh", language: "HI" });

    assertStringIncludes(said, "डॉ. Akilesh");
    assert(!/Dr\./.test(said), said);
});

Deno.test("the template parameter is the same name the message shows", () => {
    // The template puts {{2}} on its own line, so the parameter is the plain
    // name. These two drifted once already.
    assertEquals(reminderSubject("Akilesh", "Consultation", "EN"), "Dr. Akilesh");
    assertEquals(reminderSubject(undefined, "Sample Collection", "EN"), "Sample Collection");
    assertEquals(reminderSubject(undefined, undefined, "EN"), "Appointment");

    const said = formatReminderMessage({ ...BASE, serviceName: "Sample Collection" });
    assertStringIncludes(said, reminderSubject(undefined, "Sample Collection", "EN"));
});

Deno.test("the hour-before label stays short, since it is not in a sentence", () => {
    assertEquals(reminderSubject("Akilesh", undefined, "EN"), "Dr. Akilesh");
    assertEquals(reminderSubject(undefined, "Sample Collection", "EN"), "Sample Collection");
});
