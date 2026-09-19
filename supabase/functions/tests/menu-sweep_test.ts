/**
 * Every button, in every state, for all three flows.
 *
 * Enumerating edge cases by hand only ever covers the ones somebody thought
 * of, and the ones that reach production are by definition the ones nobody
 * did. WhatsApp leaves every button tappable forever, so the real input space
 * is every id the system has ever sent crossed with every state it can be in,
 * and that is small enough to just run.
 *
 * The properties are deliberately weak, because anything stronger would be
 * asserting what each combination *should* do, which is the enumeration
 * problem again. These say only: do not crash, do not go silent, do not land
 * in a state nothing handles, and never read a raw button id back to the
 * person. The last one is the bug this suite exists for — `Address:
 * "menu_more"` reached a real handset.
 */

import { assert } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { FakeWhatsAppClient } from "./helpers/fake-whatsapp.ts";
import { seed, today, CLINIC_A, DOCTOR_A, PATIENT_PHONE } from "./helpers/fixtures.ts";
import { processMessage } from "../shared/message-processor.ts";
import { BUTTON_IDS } from "../shared/button-ids.ts";

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");
Deno.env.set("DEFAULT_CLINIC_ID", CLINIC_A);

/** Every id the system can put in front of somebody, flattened. */
const EVERY_BUTTON: string[] = Object.values(BUTTON_IDS).flatMap((group) =>
    Object.values(group as Record<string, string>)
);

/** What people send that is not a button. */
const JUNK = [
    "",
    " ",
    "0",
    "-1",
    "99",
    "9999999999",
    "hello",
    "🙏",
    "select * from appointments",
    "<script>alert(1)</script>",
    "a".repeat(2000)
];

const PATIENT_STATES = [
    "LANGUAGE_SELECT",
    "MAIN_MENU",
    "SERVICE_SELECT",
    "BOOK_LOCATION",
    "BOOK_ADDRESS",
    "BOOK_ADDRESS_DETAIL",
    "BOOK_DOCTOR",
    "BOOK_DATE",
    "BOOK_DATE_CUSTOM",
    "BOOK_TIME",
    "BOOK_NAME",
    "BOOK_CONFIRM",
    "MY_APPOINTMENTS",
    "CANCEL_SELECT",
    "CANCEL_CONFIRM",
    "RESCHEDULE_SELECT",
    "RESCHEDULE_DATE",
    "RESCHEDULE_TIME",
    "RESCHEDULE_CONFIRM",
    "WAITLIST_CONFIRM",
    "FEEDBACK_RATING",
    "FEEDBACK_COMMENTS"
];

const KNOWN_PATIENT_STATES = new Set([...PATIENT_STATES, "APPOINTMENT_HISTORY"]);

function patientSetup(state: string) {
    const supabase = fakeSupabase(seed());

    supabase.store.appointments = [
        {
            id: "APT_EXISTING",
            clinic_id: CLINIC_A,
            doctor_id: DOCTOR_A,
            patient_phone: PATIENT_PHONE,
            patient_name: "Anil",
            appointment_date: today(),
            appointment_time: "10:00",
            status: "CONFIRMED",
            location_type: "CLINIC"
        }
    ];

    supabase.store.whatsapp_sessions = [
        {
            phone: PATIENT_PHONE,
            clinic_id: CLINIC_A,
            state,
            data: {
                language: "EN",
                selectedDoctorId: DOCTOR_A,
                selectedDoctorName: "Dr A Sharma",
                selectedDate: today(),
                selectedTime: "10:00",
                patientName: "Anil",
                selectedAppointmentId: "APT_EXISTING",
                locationType: "CLINIC"
            },
            role: "PATIENT"
        }
    ];

    const wa = new FakeWhatsAppClient();

    return { supabase, wa };
}

interface Complaint {
    state: string;
    input: string;
    problem: string;
}

/** Printed as it happens: the sweep is slow enough to be worth watching. */
function note(list: Complaint[], c: Complaint): void {
    console.log(`  PROBLEM ${c.state} + "${c.input.slice(0, 30)}" -> ${c.problem}`);
    list.push(c);
}

Deno.test("no button in any patient state crashes, goes silent, or echoes its own id", async () => {
    const complaints: Complaint[] = [];

    for (const state of PATIENT_STATES) {
        for (const input of [...EVERY_BUTTON, ...JUNK]) {
            const { supabase, wa } = patientSetup(state);

            try {
                await processMessage(supabase as any, wa as any, {
                    messageId: crypto.randomUUID(),
                    senderPhone: PATIENT_PHONE,
                    senderName: "Sim",
                    messageText: input,
                    messageType: input.startsWith("menu_") || input.includes("_") ? "interactive" : "text",
                    clinicId: CLINIC_A
                });
            } catch (error) {
                note(complaints, {
                    state,
                    input,
                    problem: `threw: ${error instanceof Error ? error.message : String(error)}`
                });
                continue;
            }

            const body = wa.sent.map((m) => m.body).join("\n");

            if (wa.sent.length === 0) {
                note(complaints, { state, input, problem: "said nothing at all" });
            }

            // The id is an internal token. Seeing it means it was treated as
            // content — a name, an address, a comment.
            if (input.length > 0 && EVERY_BUTTON.includes(input) && body.includes(input)) {
                note(complaints, { state, input, problem: "read the button id back" });
            }

            const after = supabase
                .rows("whatsapp_sessions")
                .find((s: any) => s.phone === PATIENT_PHONE);

            if (after && !KNOWN_PATIENT_STATES.has(after.state)) {
                note(complaints, {
                    state,
                    input,
                    problem: `left the session in ${after.state}, which nothing handles`
                });
            }
        }
    }

    assert(
        complaints.length === 0,
        `${complaints.length} problem(s):\n` +
            complaints
                .slice(0, 40)
                .map((c) => `  ${c.state} + "${c.input.slice(0, 30)}" → ${c.problem}`)
                .join("\n")
    );
});

// ── Doctor ───────────────────────────────────────────────────────────────────

/**
 * Every state that reads a menu. The PIN states are left out on purpose:
 * each input there costs a bcrypt round, which took the sweep from under a
 * second to minutes, and a gate that slow stops being run. Wrong input at a
 * PIN prompt is covered by doctor-auth_test, collector-auth_test and
 * pin-rules_test, which is the cheaper place to ask.
 */
const DOCTOR_STATES = [
    "DOCTOR_MENU",
    "DOCTOR_AVAILABILITY",
    "DOCTOR_AVAILABILITY_CONFIRM",
    "DOCTOR_LEAVE",
    "DOCTOR_LEAVE_CONFIRM",
    "DOCTOR_SET_STATUS",
    "DOCTOR_MARK_STATUS",
    "DOCTOR_MARK_STATUS_CONFIRM"
];

const DOCTOR_PHONE_SWEEP = "919711100001";

function doctorSetup(state: string) {
    const supabase = fakeSupabase(seed());

    supabase.store.doctors[0].phone = DOCTOR_PHONE_SWEEP;

    supabase.store.appointments = [
        {
            id: "APT_EXISTING",
            clinic_id: CLINIC_A,
            doctor_id: DOCTOR_A,
            patient_phone: PATIENT_PHONE,
            patient_name: "Anil",
            appointment_date: today(),
            appointment_time: "10:00",
            status: "CONFIRMED"
        }
    ];

    supabase.store.whatsapp_sessions = [
        {
            phone: DOCTOR_PHONE_SWEEP,
            clinic_id: CLINIC_A,
            state,
            data: {
                authenticated: true,
                doctorId: DOCTOR_A,
                doctorName: "Dr A Sharma",
                clinicId: CLINIC_A,
                selectedDay: 1,
                selectedAppointmentId: "APT_EXISTING",
                selectedPatientName: "Anil"
            },
            role: "DOCTOR"
        }
    ];

    return { supabase, wa: new FakeWhatsAppClient() };
}

Deno.test("no button in any doctor state crashes, goes silent, or echoes its own id", async () => {
    const complaints: Complaint[] = [];

    for (const state of DOCTOR_STATES) {
        for (const input of [...EVERY_BUTTON, ...JUNK]) {
            const { supabase, wa } = doctorSetup(state);

            try {
                await processMessage(supabase as any, wa as any, {
                    messageId: crypto.randomUUID(),
                    senderPhone: DOCTOR_PHONE_SWEEP,
                    senderName: "Dr A",
                    messageText: input,
                    messageType: "interactive",
                    clinicId: CLINIC_A
                });
            } catch (error) {
                note(complaints, {
                    state,
                    input,
                    problem: `threw: ${error instanceof Error ? error.message : String(error)}`
                });
                continue;
            }

            const body = wa.sent.map((m) => m.body).join("\n");

            if (wa.sent.length === 0) {
                note(complaints, { state, input, problem: "said nothing at all" });
            }

            if (input.length > 0 && EVERY_BUTTON.includes(input) && body.includes(input)) {
                note(complaints, { state, input, problem: "read the button id back" });
            }
        }
    }

    assert(
        complaints.length === 0,
        `${complaints.length} problem(s):\n` +
            complaints
                .slice(0, 40)
                .map((c) => `  ${c.state} + "${c.input.slice(0, 30)}" → ${c.problem}`)
                .join("\n")
    );
});

// ── Collector ────────────────────────────────────────────────────────────────

const COLLECTOR_STATES = ["COLLECTOR_MENU", "COLLECTOR_CONFIRM"];
const COLLECTOR_PHONE = "919000000066";

function collectorSetup(state: string) {
    const supabase = fakeSupabase(seed());

    supabase.store.sample_collectors = [
        {
            id: "col-1",
            clinic_id: CLINIC_A,
            name: "Ravi",
            phone: COLLECTOR_PHONE,
            is_active: true,
            pin_hash: null
        }
    ];

    supabase.store.appointments = [
        {
            id: "APT_HOME_1",
            clinic_id: CLINIC_A,
            patient_phone: PATIENT_PHONE,
            patient_name: "Anil",
            appointment_date: today(),
            appointment_time: "10:00",
            location_type: "HOME",
            status: "CONFIRMED",
            service_address: "Flat 3B",
            collector_id: "col-1"
        }
    ];

    supabase.store.whatsapp_sessions = [
        {
            phone: COLLECTOR_PHONE,
            clinic_id: CLINIC_A,
            state,
            data: state === "COLLECTOR_CONFIRM" ? { selectedVisitId: "APT_HOME_1" } : {},
            role: "HOME_COLLECTION_PERSON"
        }
    ];

    return { supabase, wa: new FakeWhatsAppClient() };
}

Deno.test("no button in any collector state crashes, goes silent, or closes a visit", async () => {
    const complaints: Complaint[] = [];

    for (const state of COLLECTOR_STATES) {
        for (const input of [...EVERY_BUTTON, ...JUNK]) {
            const { supabase, wa } = collectorSetup(state);

            try {
                await processMessage(supabase as any, wa as any, {
                    messageId: crypto.randomUUID(),
                    senderPhone: COLLECTOR_PHONE,
                    senderName: "Ravi",
                    messageText: input,
                    messageType: "interactive",
                    clinicId: CLINIC_A
                });
            } catch (error) {
                note(complaints, {
                    state,
                    input,
                    problem: `threw: ${error instanceof Error ? error.message : String(error)}`
                });
                continue;
            }

            if (wa.sent.length === 0) {
                note(complaints, { state, input, problem: "said nothing at all" });
            }

            // Only confirm_yes at the confirmation step may close a visit.
            const closed = supabase.rows("appointments")[0].status === "COMPLETED";
            const allowed = state === "COLLECTOR_CONFIRM" && input === BUTTON_IDS.CONFIRMATION.YES;

            if (closed && !allowed) {
                note(complaints, { state, input, problem: "closed a visit it should not have" });
            }
        }
    }

    assert(
        complaints.length === 0,
        `${complaints.length} problem(s):\n` +
            complaints
                .slice(0, 40)
                .map((c) => `  ${c.state} + "${c.input.slice(0, 30)}" → ${c.problem}`)
                .join("\n")
    );
});
