/**
 * Doctor portal state machine, driven through the real handler.
 *
 * MultiClinicSupabaseClient builds its own client from the environment, so the
 * fake is injected over the private field. Everything else is production code.
 */

import { assert, assertEquals } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { FakeWhatsAppClient } from "./helpers/fake-whatsapp.ts";
import { seed, session, tap, textMessage, CLINIC_A, DOCTOR_A, DOCTOR_PHONE } from "./helpers/fixtures.ts";
import { BUTTON_IDS } from "../shared/button-ids.ts";
import { hashPassword } from "../shared/bcrypt-password.ts";

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");
Deno.env.set("DOCTOR_PORTAL_PIN", "123456");
Deno.env.set("DEFAULT_CLINIC_ID", CLINIC_A);
// Test files share one process, so every env dependency must be set here
// rather than inherited from whichever file happened to run first.
Deno.env.set("ALLOW_SHARED_DOCTOR_PIN", "true");

const { DoctorFlowHandler } = await import("../shared/handlers/doctor-handler.ts");
const { clearAuthCache } = await import("../shared/doctor-auth.ts");

let phoneCounter = 0;

function build(overrides: Record<string, unknown> = {}) {
    clearAuthCache();
    phoneCounter += 1;
    const phone = `9197000${String(phoneCounter).padStart(5, "0")}`;

    const supabase = fakeSupabase(seed());
    supabase.store.doctors[0].phone = phone;
    Object.assign(supabase.store.doctors[0], overrides);

    const wa = new FakeWhatsAppClient();
    const handler = new DoctorFlowHandler(supabase, wa);

    // The handler's internal data-access client must hit the fake store too.
    (handler as any).supabaseClient.supabase = supabase;

    // The processor creates the session row before any handler runs, so the
    // row has to exist for updateSession to have something to write to.
    const send = async (state: string, data: Record<string, unknown>, message: any) => {
        const sess = session(state, data, CLINIC_A, phone, "DOCTOR");

        supabase.store.whatsapp_sessions = [
            { phone, clinic_id: CLINIC_A, state, data, role: "DOCTOR" }
        ];

        await handler.handle(sess, message);
    };

    return { supabase, wa, handler, phone, send };
}

function currentSession(supabase: any, phone: string) {
    return supabase.rows("whatsapp_sessions").find((s: any) => s.phone === phone);
}

Deno.test("a correct PIN opens the portal menu", async () => {
    const { supabase, wa, handler, phone, send } = build();

    await send("DOCTOR_LOGIN", {}, textMessage("123456", phone));

    const updated = currentSession(supabase, phone);

    assertEquals(updated?.state, "DOCTOR_MENU");
    assertEquals(updated?.data?.authenticated, true);
    assertEquals(updated?.data?.doctorId, DOCTOR_A);
});

Deno.test("a wrong PIN leaves the doctor logged out", async () => {
    const { supabase, phone, send } = build();

    await send("DOCTOR_LOGIN", {}, textMessage("000000", phone));

    assertEquals(currentSession(supabase, phone)?.state, "DOCTOR_LOGIN");
});

Deno.test("the portal menu is tappable and within Meta's limits", async () => {
    const { wa, phone, send } = build();

    await send("DOCTOR_LOGIN", {}, textMessage("123456", phone));

    const menu = wa.sent.find((m) => m.type === "list" || m.type === "buttons");

    assert(menu, "expected a tappable menu");

    if (menu.type === "buttons") {
        assert((menu.buttons ?? []).length <= 3);
    } else {
        const rows = (menu.sections ?? []).flatMap((s) => s.rows);
        assert(rows.length <= 10, `menu offered ${rows.length} rows`);
    }
});

Deno.test("every menu option the doctor is offered is one the handler accepts", async () => {
    const { wa, phone, send } = build();

    await send("DOCTOR_LOGIN", {}, textMessage("123456", phone));

    const offered = [...wa.offeredRowIds(), ...wa.offeredButtonIds()];
    const known = Object.values(BUTTON_IDS.DOCTOR_MENU) as string[];

    assert(offered.length > 0, "no options were offered");

    for (const id of offered) {
        assertEquals(known.includes(id), true, `menu offers "${id}" which is not a known action`);
    }
});

Deno.test("changing the PIN stores a hash, not the PIN itself", async () => {
    const { supabase, phone, send } = build();

    await send("DOCTOR_CHANGE_PIN", { doctorId: DOCTOR_A, authenticated: true }, textMessage("4827", phone));

    const stored = supabase.rows("doctors")[0].pin_hash;

    assert(stored, "expected a PIN hash to be written");
    assertEquals(stored === "4827", false, "PIN was stored in plain text");
    assert(/^\$2[aby]\$/.test(stored), `expected a bcrypt hash, got ${stored}`);
});

Deno.test("a weak PIN is refused and nothing is written", async () => {
    for (const weak of ["1111", "123456", "12", "abcd"]) {
        const { supabase, phone, send } = build();

        await send("DOCTOR_CHANGE_PIN", { doctorId: DOCTOR_A, authenticated: true }, textMessage(weak, phone));

        assertEquals(
            supabase.rows("doctors")[0].pin_hash,
            null,
            `weak PIN "${weak}" was accepted`
        );
        assertEquals(currentSession(supabase, phone)?.state, "DOCTOR_CHANGE_PIN");
    }
});

Deno.test("a new PIN replaces the shared one for that doctor only", async () => {
    const { supabase, phone, send } = build();

    await send("DOCTOR_CHANGE_PIN", { doctorId: DOCTOR_A, authenticated: true }, textMessage("4827", phone));

    // The other clinic's doctor is untouched.
    assertEquals(supabase.rows("doctors")[1].pin_hash, null);
});

Deno.test("logout clears the authenticated session", async () => {
    const { supabase, phone, send } = build();

    await send("DOCTOR_MENU", { doctorId: DOCTOR_A, authenticated: true }, tap(BUTTON_IDS.DOCTOR_MENU.LOGOUT, phone));

    const updated = currentSession(supabase, phone);

    assertEquals(updated?.data?.authenticated ?? false, false);
});

Deno.test("a menu button works from inside a sub-flow", async () => {
    const { supabase, phone, send } = build();

    // Doctors used to get stuck here because sub-states ignored menu ids.
    await send("DOCTOR_AVAILABILITY", { doctorId: DOCTOR_A, authenticated: true }, tap(BUTTON_IDS.DOCTOR_MENU.LOGOUT, phone));

    assertEquals(currentSession(supabase, phone)?.data?.authenticated ?? false, false);
});

Deno.test("setting presence to ON_BREAK is persisted", async () => {
    const { supabase, phone, send } = build();

    await send("DOCTOR_SET_STATUS", { doctorId: DOCTOR_A, authenticated: true }, tap(BUTTON_IDS.DOCTOR_STATUS.ON_BREAK, phone));

    assertEquals(supabase.rows("doctors")[0].availability_status, "ON_BREAK");
});

Deno.test("a doctor who already set a PIN cannot use the shared one", async () => {
    const hash = await hashPassword("4827");
    const { supabase, phone, send } = build({ pin_hash: hash });

    await send("DOCTOR_LOGIN", {}, textMessage("123456", phone));

    assertEquals(currentSession(supabase, phone)?.state, "DOCTOR_LOGIN");

    await send("DOCTOR_LOGIN", {}, textMessage("4827", phone));

    assertEquals(currentSession(supabase, phone)?.state, "DOCTOR_MENU");
});
