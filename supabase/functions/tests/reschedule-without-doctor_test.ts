/**
 * Moving an appointment that has no doctor.
 *
 * rescheduleAppointment asked the doctor-slot check whether the new time was
 * free. For a sample collection or most diagnostics there is no doctor, so the
 * check answered "Doctor not found: null" and the patient was told the slot was
 * unavailable -- every doctor-free appointment was stuck where it was booked.
 * Their capacity comes from the clinic's own service hours instead.
 */

import { assertEquals } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { seed, CLINIC_A, DOCTOR_A } from "./helpers/fixtures.ts";
import { rescheduleAppointment } from "../shared/appointments.ts";

const { clearClinicServiceCache } = await import("../shared/clinic-services.ts");

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");

const SAMPLE = "svc-sample-id";
const APPOINTMENT = "APT_NO_DOCTOR";

const TYPES = [
    {
        id: SAMPLE,
        code: "SAMPLE_COLLECTION",
        name: "Sample Collection",
        category: "DIAGNOSTIC",
        default_clinic_price: 100,
        default_home_price: 150,
        default_duration_minutes: 30,
        is_active: true
    }
];

function build(doctorId: string | null = null) {
    const supabase = fakeSupabase(seed());

    Object.assign(supabase.store.clinics[0], {
        timezone: "Asia/Kolkata",
        open_time: "09:00",
        close_time: "18:00",
        // Day names, as the live column holds - not the numbers the shared
        // fixture uses.
        working_days: "Mon,Tue,Wed,Thu,Fri,Sat,Sun",
        enable_diagnostic_center: true,
        enable_home_collection: true
    });

    supabase.store.service_types = TYPES;
    supabase.store.clinic_services = [
        {
            clinic_id: CLINIC_A,
            service_type_id: SAMPLE,
            is_enabled: true,
            offered_at_clinic: true,
            offered_at_home: true,
            requires_doctor: false,
            clinic_price: null,
            home_price: null,
            duration_minutes: 30,
            concurrent_capacity: 1,
            display_order: 0,
            service_type: TYPES[0]
        }
    ];

    supabase.store.appointments = [
        {
            id: APPOINTMENT,
            clinic_id: CLINIC_A,
            doctor_id: doctorId,
            service_type_id: SAMPLE,
            patient_phone: "919000000001",
            patient_name: "Anil",
            appointment_date: "2099-09-18",
            appointment_time: "10:00",
            status: "CONFIRMED"
        }
    ];
    supabase.store.appointment_reminders = [];

    clearClinicServiceCache();

    return supabase;
}

function appointment(supabase: any) {
    return supabase.rows("appointments").find((a: any) => a.id === APPOINTMENT);
}

Deno.test("a sample collection can be moved even though it has no doctor", async () => {
    const supabase = build();

    const result = await rescheduleAppointment(
        supabase as any,
        APPOINTMENT,
        CLINIC_A,
        "2099-09-20",
        "11:00"
    );

    assertEquals(result.success, true, `${result.message} / ${result.error}`);
    assertEquals(appointment(supabase)?.appointment_date, "2099-09-20");
    assertEquals(appointment(supabase)?.appointment_time, "11:00");
});

Deno.test("a time outside the clinic's hours is still refused", async () => {
    const supabase = build();

    const result = await rescheduleAppointment(
        supabase as any,
        APPOINTMENT,
        CLINIC_A,
        "2099-09-20",
        "22:00"
    );

    assertEquals(result.success, false);
    assertEquals(appointment(supabase)?.appointment_time, "10:00");
});

Deno.test("a slot already at capacity is refused", async () => {
    const supabase = build();
    supabase.store.appointments.push({
        id: "APT_TAKEN",
        clinic_id: CLINIC_A,
        doctor_id: null,
        service_type_id: SAMPLE,
        patient_phone: "919111111111",
        patient_name: "Someone Else",
        appointment_date: "2099-09-20",
        appointment_time: "11:00",
        status: "CONFIRMED"
    });

    const result = await rescheduleAppointment(
        supabase as any,
        APPOINTMENT,
        CLINIC_A,
        "2099-09-20",
        "11:00"
    );

    assertEquals(result.success, false);
    assertEquals(appointment(supabase)?.appointment_time, "10:00");
});

Deno.test("a service disabled since booking does not strand the appointment", async () => {
    const supabase = build();
    supabase.store.clinic_services[0].is_enabled = false;
    clearClinicServiceCache();

    const result = await rescheduleAppointment(
        supabase as any,
        APPOINTMENT,
        CLINIC_A,
        "2099-09-20",
        "11:00"
    );

    // Nothing left to measure capacity against, and refusing would leave the
    // patient on a slot they cannot leave.
    assertEquals(result.success, true, `${result.message} / ${result.error}`);
});

Deno.test("an appointment with a doctor still goes through the doctor's diary", async () => {
    const supabase = build(DOCTOR_A);
    supabase.store.doctor_availability = [];

    const result = await rescheduleAppointment(
        supabase as any,
        APPOINTMENT,
        CLINIC_A,
        "2099-09-20",
        "11:00"
    );

    // No availability for that doctor, so the clinic-hours path must not be
    // silently standing in for it.
    assertEquals(result.success, false);
});
