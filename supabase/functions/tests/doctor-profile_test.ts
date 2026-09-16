/**
 * What a patient is told about a doctor before choosing one.
 *
 * The list showed a name, a specialisation and whether they were free. A
 * patient picking someone to see about their child weighs up the qualification
 * too, and it was not there — nor anywhere in the schema. `license_number` and
 * `years_experience` have existed all along and nothing reads either; neither
 * is what a patient wants.
 */

import { assert, assertEquals } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { FakeWhatsAppClient } from "./helpers/fake-whatsapp.ts";
import { seed, session, tap, CLINIC_A, DOCTOR_A, PATIENT_PHONE } from "./helpers/fixtures.ts";
import { BUTTON_IDS } from "../shared/button-ids.ts";

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");

const { PatientFlowHandler } = await import("../shared/handlers/patient-handler.ts");

function build(doctorOverrides: Record<string, unknown>) {
    const supabase = fakeSupabase(seed());
    Object.assign(supabase.store.doctors[0], doctorOverrides);

    const wa = new FakeWhatsAppClient();
    const handler = new PatientFlowHandler(supabase, wa);

    (handler as any).supabaseClient.supabase = supabase;

    const show = async () => {
        supabase.store.whatsapp_sessions = [
            {
                phone: PATIENT_PHONE,
                clinic_id: CLINIC_A,
                state: "BOOK_DOCTOR",
                data: { language: "EN" },
                role: "PATIENT"
            }
        ];

        await handler.handle(
            session("MAIN_MENU", { language: "EN" }, CLINIC_A, PATIENT_PHONE, "PATIENT"),
            tap(BUTTON_IDS.PATIENT_MENU.BOOK)
        );
    };

    /** Every row description across the list messages sent. */
    const descriptions = () =>
        wa.sent
            .filter((m) => m.type === "list")
            .flatMap((m) => m.sections ?? [])
            .flatMap((s) => s.rows)
            .map((r) => r.description ?? "");

    return { supabase, wa, show, descriptions };
}

Deno.test("the qualification is offered alongside the specialisation", async () => {
    const { show, descriptions } = build({
        specialization: "General Physician",
        qualifications: "MBBS, MD (General Medicine)",
        availability_status: "AVAILABLE"
    });

    await show();

    const shown = descriptions().join("\n");

    assert(/MBBS, MD \(General Medicine\)/.test(shown), `qualification missing: ${shown}`);
    assert(/General Physician/.test(shown), shown);
    assert(/Available/.test(shown), "availability must survive the addition");
});

Deno.test("a doctor with no qualification recorded reads normally", async () => {
    const { show, descriptions } = build({
        specialization: "General Physician",
        qualifications: null,
        availability_status: "AVAILABLE"
    });

    await show();

    const shown = descriptions()[0] ?? "";

    // No stray separator where the missing part would have been.
    assertEquals(shown, "General Physician · Available");
});

Deno.test("a doctor with neither still shows their availability", async () => {
    const { show, descriptions } = build({
        specialization: null,
        qualifications: null,
        availability_status: "ON_BREAK"
    });

    await show();

    assertEquals(descriptions()[0], "On break");
});

Deno.test("a long qualification cannot break WhatsApp's row limit", async () => {
    const { show, descriptions } = build({
        specialization: "Consultant Obstetrician and Gynaecologist",
        qualifications: "MBBS, MS (Obstetrics and Gynaecology), DNB, Fellowship in Reproductive Medicine",
        availability_status: "AVAILABLE"
    });

    await show();

    for (const text of descriptions()) {
        assert(text.length <= 72, `a row description of ${text.length} characters would be refused`);
    }
});
