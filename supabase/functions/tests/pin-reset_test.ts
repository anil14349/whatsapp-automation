/**
 * Self-service PIN reset over WhatsApp.
 *
 * This deliberately trades a factor for convenience, so the guards around it
 * carry the weight: it must not bypass the lockout, must not work for a
 * stranger's number, and must be switchable off.
 */

import { assert, assertEquals } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { FakeWhatsAppClient } from "./helpers/fake-whatsapp.ts";
import { seed, session, textMessage, tap, CLINIC_A, DOCTOR_A } from "./helpers/fixtures.ts";
import { BUTTON_IDS } from "../shared/button-ids.ts";
import { verifyPassword, hashPassword } from "../shared/bcrypt-password.ts";

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");
Deno.env.set("DOCTOR_PORTAL_PIN", "123456");
Deno.env.set("DEFAULT_CLINIC_ID", CLINIC_A);
Deno.env.delete("ALLOW_SELF_SERVICE_PIN_RESET");

const { DoctorFlowHandler } = await import("../shared/handlers/doctor-handler.ts");
const { clearAuthCache, verifyDoctorPin } = await import("../shared/doctor-auth.ts");

let counter = 0;

function build() {
    clearAuthCache();
    counter += 1;
    const phone = `9196000${String(counter).padStart(5, "0")}`;

    const supabase = fakeSupabase(seed());
    supabase.store.doctors[0].phone = phone;

    const wa = new FakeWhatsAppClient();
    const handler = new DoctorFlowHandler(supabase, wa);
    (handler as any).supabaseClient.supabase = supabase;

    const send = async (state: string, data: Record<string, unknown>, message: any) => {
        supabase.store.whatsapp_sessions = [
            { phone, clinic_id: CLINIC_A, state, data, role: "DOCTOR" }
        ];
        await handler.handle(session(state, data, CLINIC_A, phone, "DOCTOR"), message);
    };

    return { supabase, wa, handler, phone, send };
}

function currentSession(supabase: any, phone: string) {
    return supabase.rows("whatsapp_sessions").find((s: any) => s.phone === phone);
}

Deno.test("the login prompt offers a way out for a forgotten PIN", async () => {
    const { wa, phone, send } = build();

    await send("DOCTOR_LOGIN", {}, textMessage("", phone));

    assertEquals(
        wa.offeredButtonIds().includes(BUTTON_IDS.DOCTOR_LOGIN_HELP.FORGOT_PIN),
        true,
        "expected a Forgot PIN button"
    );
});

Deno.test("tapping forgot PIN asks for a new one", async () => {
    const { supabase, phone, send } = build();

    await send("DOCTOR_LOGIN", {}, tap(BUTTON_IDS.DOCTOR_LOGIN_HELP.FORGOT_PIN, phone));

    const updated = currentSession(supabase, phone);

    assertEquals(updated?.state, "DOCTOR_RESET_PIN");
    assertEquals(updated?.data?.resetDoctorId, DOCTOR_A);
});

Deno.test("the new PIN is stored hashed and works for login", async () => {
    const { supabase, phone, send } = build();

    await send("DOCTOR_RESET_PIN", { resetDoctorId: DOCTOR_A }, textMessage("419628", phone));

    const stored = supabase.rows("doctors")[0].pin_hash;

    assert(stored, "expected a hash to be written");
    assertEquals(stored === "419628", false, "PIN stored in plain text");
    assertEquals(await verifyPassword("419628", stored), true);
    assertEquals((await verifyDoctorPin(supabase, phone, CLINIC_A, "419628")).success, true);
});

Deno.test("the doctor must sign in again with the new PIN", async () => {
    const { supabase, phone, send } = build();

    await send("DOCTOR_RESET_PIN", { resetDoctorId: DOCTOR_A }, textMessage("419628", phone));

    // Resetting must not itself grant access.
    const updated = currentSession(supabase, phone);
    assertEquals(updated?.state, "DOCTOR_LOGIN");
    assertEquals(updated?.data?.authenticated ?? false, false);
});

Deno.test("a weak PIN is refused and nothing is written", async () => {
    const { supabase, phone, send } = build();

    await send("DOCTOR_RESET_PIN", { resetDoctorId: DOCTOR_A }, textMessage("1234", phone));

    assertEquals(supabase.rows("doctors")[0].pin_hash, null);
    assertEquals(currentSession(supabase, phone)?.state, "DOCTOR_RESET_PIN");
});

Deno.test("a locked out account cannot reset its way back in", async () => {
    const { supabase, phone, send } = build();
    supabase.store.doctors[0].pin_hash = await hashPassword("419628");

    for (let i = 0; i < 3; i++) {
        await verifyDoctorPin(supabase, phone, CLINIC_A, "000000");
    }

    await send("DOCTOR_LOGIN", {}, tap(BUTTON_IDS.DOCTOR_LOGIN_HELP.FORGOT_PIN, phone));

    // Still at login, and the original PIN is untouched.
    assertEquals(currentSession(supabase, phone)?.state, "DOCTOR_LOGIN");
    assertEquals((await verifyPassword("419628", supabase.rows("doctors")[0].pin_hash)), true);

    clearAuthCache();
});

Deno.test("a number that is not a doctor here cannot reset anything", async () => {
    const { supabase, handler, wa } = build();
    const stranger = "919555000111";

    supabase.store.whatsapp_sessions = [
        { phone: stranger, clinic_id: CLINIC_A, state: "DOCTOR_LOGIN", data: {}, role: "DOCTOR" }
    ];

    await handler.handle(
        session("DOCTOR_LOGIN", {}, CLINIC_A, stranger, "DOCTOR"),
        tap(BUTTON_IDS.DOCTOR_LOGIN_HELP.FORGOT_PIN, stranger)
    );

    const updated = supabase.rows("whatsapp_sessions").find((s: any) => s.phone === stranger);

    assertEquals(updated?.state, "DOCTOR_LOGIN");
    assertEquals(supabase.rows("doctors")[0].pin_hash, null, "another doctor's PIN was touched");
    assert(
        wa.sent.some((m) => m.body.includes("not registered")),
        "expected a not-registered reply"
    );
});

Deno.test("an inactive doctor cannot reset", async () => {
    const { supabase, phone, send } = build();
    supabase.store.doctors[0].is_active = false;

    await send("DOCTOR_LOGIN", {}, tap(BUTTON_IDS.DOCTOR_LOGIN_HELP.FORGOT_PIN, phone));

    assertEquals(currentSession(supabase, phone)?.state, "DOCTOR_LOGIN");
});

Deno.test("one doctor's reset cannot touch another clinic's doctor", async () => {
    const { supabase, phone, send } = build();

    await send("DOCTOR_RESET_PIN", { resetDoctorId: DOCTOR_A }, textMessage("419628", phone));

    assertEquals(supabase.rows("doctors")[1].pin_hash, null);
});

Deno.test("the reset is recorded in the audit log", async () => {
    const { supabase, phone, send } = build();

    await send("DOCTOR_RESET_PIN", { resetDoctorId: DOCTOR_A }, textMessage("419628", phone));

    const events = supabase.rows("audit_log");

    assertEquals(events.length, 1);
    assertEquals(events[0].action, "DOCTOR_PIN_SELF_RESET");
    assertEquals(events[0].entity_id, DOCTOR_A);
});

Deno.test("the feature can be switched off entirely", async () => {
    Deno.env.set("ALLOW_SELF_SERVICE_PIN_RESET", "false");

    const { supabase, wa, phone, send } = build();

    await send("DOCTOR_LOGIN", {}, textMessage("", phone));

    assertEquals(
        wa.offeredButtonIds().includes(BUTTON_IDS.DOCTOR_LOGIN_HELP.FORGOT_PIN),
        false,
        "button should not be offered when disabled"
    );

    await send("DOCTOR_LOGIN", {}, tap(BUTTON_IDS.DOCTOR_LOGIN_HELP.FORGOT_PIN, phone));

    assertEquals(currentSession(supabase, phone)?.state, "DOCTOR_LOGIN");
    assertEquals(supabase.rows("doctors")[0].pin_hash, null);

    Deno.env.delete("ALLOW_SELF_SERVICE_PIN_RESET");
});
