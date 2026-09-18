/**
 * A slot that comes free has to reach whoever is waiting for it.
 *
 * Found by joining the waitlist on the test handset and then cancelling a
 * matching appointment from the portal: the row stayed PENDING with
 * notified_at null and nothing was sent. The rule lived in the WhatsApp
 * handler, so only a patient cancelling on WhatsApp freed a slot anyone heard
 * about - the same shape as the reminders that were left behind on a portal
 * cancel, and as the receptionist email rule before that.
 *
 * It now lives in cancelAppointment, where every caller gets it.
 */

import { assertEquals } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { FakeWhatsAppClient } from "./helpers/fake-whatsapp.ts";
import { seed, CLINIC_A, DOCTOR_A } from "./helpers/fixtures.ts";
import { cancelAppointment } from "../shared/appointments.ts";

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");

const APPOINTMENT = "APT_WAITLIST_1";
const WAITING = "919000000055";

function build() {
    const supabase = fakeSupabase(seed());

    supabase.store.appointments = [
        {
            id: APPOINTMENT,
            clinic_id: CLINIC_A,
            doctor_id: DOCTOR_A,
            patient_phone: "919000000001",
            patient_name: "Anil",
            appointment_date: "2099-09-21",
            appointment_time: "11:00",
            status: "CONFIRMED"
        }
    ];

    supabase.store.waitlist = [
        {
            id: "wl-1",
            clinic_id: CLINIC_A,
            phone: WAITING,
            doctor_id: DOCTOR_A,
            date: "2099-09-21",
            time: "ANY",
            position: 1,
            status: "PENDING"
        }
    ];

    supabase.store.appointment_reminders = [];

    return supabase;
}

Deno.test("cancelling at the desk tells the person waiting", async () => {
    const supabase = build();
    const wa = new FakeWhatsAppClient();

    const result = await cancelAppointment(
        supabase,
        APPOINTMENT,
        CLINIC_A,
        "Cancelled by clinic staff",
        "receptionist:desk",
        wa as never
    );

    assertEquals(result.success, true);
    assertEquals(
        wa.sent.some((m) => m.to === WAITING),
        true
    );
});

Deno.test("the waitlist row is marked notified, so nobody is told twice", async () => {
    const supabase = build();
    const wa = new FakeWhatsAppClient();

    await cancelAppointment(
        supabase,
        APPOINTMENT,
        CLINIC_A,
        undefined,
        "receptionist:desk",
        wa as never
    );

    assertEquals(supabase.store.waitlist[0].status, "NOTIFIED");
});

Deno.test("a caller that cannot send still cancels", async () => {
    const supabase = build();

    const result = await cancelAppointment(supabase, APPOINTMENT, CLINIC_A);

    assertEquals(result.success, true);
    assertEquals(supabase.store.appointments[0].status, "CANCELLED");
    assertEquals(supabase.store.waitlist[0].status, "PENDING");
});

Deno.test("another clinic's waiting patient is left alone", async () => {
    const supabase = build();
    const wa = new FakeWhatsAppClient();

    supabase.store.waitlist[0].clinic_id = "clinic-somebody-else";

    await cancelAppointment(
        supabase,
        APPOINTMENT,
        CLINIC_A,
        undefined,
        "receptionist:desk",
        wa as never
    );

    assertEquals(
        wa.sent.some((m) => m.to === WAITING),
        false
    );
});
