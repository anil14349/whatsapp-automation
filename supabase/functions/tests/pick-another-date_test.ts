/**
 * What "Pick Another Date" offers.
 *
 * It used to set the state to BOOK_DATE and ask the patient to type
 * YYYY-MM-DD, which is the one format a phone keyboard makes hardest and the
 * flow rejects 22-09-2026, 22/09 and "next Monday" for. The booking flow
 * already lists the bookable days, so this offers the same list, minus the day
 * the patient was just turned away from.
 */

import { assert, assertEquals } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { FakeWhatsAppClient } from "./helpers/fake-whatsapp.ts";
import { seed, today, CLINIC_A, DOCTOR_A, PATIENT_PHONE } from "./helpers/fixtures.ts";
import { processMessage } from "../shared/message-processor.ts";
import { clearClinicServiceCache } from "../shared/clinic-services.ts";
import { clearClinicTimezoneCache } from "../shared/clinic-slots.ts";
import { BUTTON_IDS } from "../shared/button-ids.ts";

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");
Deno.env.set("DEFAULT_CLINIC_ID", CLINIC_A);

function addDays(date: string, days: number): string {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

function waiting(fullDate: string) {
    return {
        phone: PATIENT_PHONE,
        clinic_id: CLINIC_A,
        state: "WAITLIST_CONFIRM",
        data: {
            language: "EN",
            doctorId: DOCTOR_A,
            doctorName: "Dr A Sharma",
            date: fullDate,
            time: "ANY"
        },
        role: "PATIENT"
    };
}

function build(fullDate: string) {
    const supabase = fakeSupabase(seed());

    supabase.store.whatsapp_sessions = [waiting(fullDate)];

    clearClinicServiceCache();
    clearClinicTimezoneCache();

    const wa = new FakeWhatsAppClient();

    const tap = (text: string) =>
        processMessage(supabase as any, wa as any, {
            messageId: crypto.randomUUID(),
            senderPhone: PATIENT_PHONE,
            senderName: "Sim",
            messageText: text,
            messageType: "interactive",
            clinicId: CLINIC_A
        });

    const sent = () => wa.sent[wa.sent.length - 1];
    const rowIds = (): string[] =>
        (sent()?.sections ?? []).flatMap((s: any) => (s.rows ?? []).map((r: any) => r.id));
    const rowTitles = (): string[] =>
        (sent()?.sections ?? []).flatMap((s: any) => (s.rows ?? []).map((r: any) => r.title));
    const session = () =>
        supabase.rows("whatsapp_sessions").find((s: any) => s.phone === PATIENT_PHONE);

    return { supabase, wa, tap, sent, rowIds, rowTitles, session };
}

Deno.test("Pick Another Date offers days rather than asking for a typed one", async () => {
    const { tap, sent, rowIds } = build(today());

    await tap("waitlist_no");

    assert(
        !/YYYY-MM-DD/.test(sent()?.body ?? ""),
        `still asking the patient to type a date:\n${sent()?.body}`
    );
    assert(rowIds().length > 0, `no days were offered: ${JSON.stringify(sent())}`);
});

Deno.test("the day they were just refused is not offered again", async () => {
    const refused = today();
    const { tap, rowIds } = build(refused);

    await tap("waitlist_no");

    assertEquals(
        rowIds().includes(refused),
        false,
        `offered the same full day again: ${JSON.stringify(rowIds())}`
    );
});

Deno.test("a refused day in the middle still leaves the rest of the week", async () => {
    const refused = addDays(today(), 2);
    const { tap, rowIds } = build(refused);

    await tap("waitlist_no");

    assertEquals(rowIds().includes(refused), false, "the refused day survived");
    assert(rowIds().includes(today()), `today was dropped too: ${JSON.stringify(rowIds())}`);
    assert(rowIds().includes(addDays(today(), 1)), "tomorrow was dropped too");
});

Deno.test("dropping a day does not shorten the list", async () => {
    const { tap, rowIds } = build(today());

    await tap("waitlist_no");

    // The window is a week by default, so every day but the refused one fits.
    assert(
        rowIds().length >= 6,
        `the list lost days it could have offered: ${JSON.stringify(rowIds())}`
    );
});

Deno.test("the days are named, not printed as ISO dates", async () => {
    const { tap, rowTitles } = build(today());

    await tap("waitlist_no");

    assert(
        rowTitles().some((t) => /Tomorrow/.test(t)),
        `no readable day names: ${JSON.stringify(rowTitles())}`
    );
    assert(
        !rowTitles().some((t) => /^\d{4}-\d{2}-\d{2}$/.test(t)),
        `a raw date was shown: ${JSON.stringify(rowTitles())}`
    );
});

Deno.test("the ids are still dates, so the booking flow reads them unchanged", async () => {
    const { tap, rowIds } = build(today());

    await tap("waitlist_no");

    const dates = rowIds().filter((id) => id !== BUTTON_IDS.DATE_SELECT.OTHER);

    assert(dates.length > 0);
    assert(
        dates.every((id) => /^\d{4}-\d{2}-\d{2}$/.test(id)),
        `a row id is not a date: ${JSON.stringify(dates)}`
    );
});

Deno.test("the patient is left where a chosen day will be understood", async () => {
    const { tap, session } = build(today());

    await tap("waitlist_no");

    assertEquals(session()?.state, "BOOK_DATE");
});

Deno.test("joining the waitlist instead is untouched", async () => {
    const { tap, supabase } = build(today());

    await tap("waitlist_yes");

    assertEquals(
        supabase.rows("waitlist").length,
        1,
        "the date list swallowed the other button"
    );
});

Deno.test("the offer names the day rather than printing the date", async () => {
    const { wa, tap } = build(today());

    await tap("waitlist_no");

    const offer = wa.sent.map((m: any) => m.body ?? "").join("\n");

    assert(!/\d{4}-\d{2}-\d{2}/.test(offer), `a raw date reached the patient:\n${offer}`);
});

Deno.test("a day the clinic is shut is not offered", async () => {
    const shut = addDays(today(), 3);
    const { supabase, tap, rowIds } = build(today());

    supabase.store.clinic_holidays = [
        { id: "HOL_1", clinic_id: CLINIC_A, holiday_date: shut, holiday_name: "Founder's Day" }
    ];

    await tap("waitlist_no");

    assertEquals(
        rowIds().includes(shut),
        false,
        `offered a day the clinic is closed: ${JSON.stringify(rowIds())}`
    );
    assert(rowIds().includes(addDays(today(), 2)), "it took the open days with it");
});

Deno.test("a weekday the clinic never opens is not offered", async () => {
    const { supabase, tap, rowIds } = build(today());

    // Monday is 1 here, as it is in the database.
    supabase.store.clinic_operating_hours = [
        {
            clinic_id: CLINIC_A,
            day_of_week: 1,
            opening_time: "09:00",
            closing_time: "18:00",
            is_active: false
        }
    ];

    await tap("waitlist_no");

    const mondays = rowIds().filter((id) => new Date(`${id}T00:00:00Z`).getUTCDay() === 1);

    assertEquals(mondays.length, 0, `offered a Monday the clinic is shut: ${JSON.stringify(rowIds())}`);
});

Deno.test("a clinic shut for the whole window says so rather than sending an empty list", async () => {
    const { supabase, tap, sent, rowIds } = build(today());

    supabase.store.clinic_holidays = Array.from({ length: 9 }, (_, i) => ({
        id: `HOL_${i}`,
        clinic_id: CLINIC_A,
        holiday_date: addDays(today(), i),
        holiday_name: "Shut"
    }));

    await tap("waitlist_no");

    assertEquals(rowIds().length, 0, "Meta refuses a list with no rows");
    assert(/no open days/i.test(sent()?.body ?? ""), `no explanation given:\n${sent()?.body}`);
});
