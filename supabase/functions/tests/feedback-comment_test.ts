/**
 * The comment step of the feedback survey.
 *
 * It used to ask "Would you like to add a comment?" and offer one button:
 * No thanks. Saying yes means typing, which a button cannot do, so the only
 * answer on offer was the negative one. Seen on a real handset.
 */

import { assert, assertEquals } from "std/testing/asserts.ts";
import { fakeSupabase } from "./helpers/fake-supabase.ts";
import { FakeWhatsAppClient } from "./helpers/fake-whatsapp.ts";
import { seed, session, CLINIC_A, PATIENT_PHONE } from "./helpers/fixtures.ts";
import { FeedbackHandler, FEEDBACK_SKIP_ID } from "../shared/handlers/feedback-handler.ts";

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");

const APPOINTMENT = "APT_FEEDBACK_1";

function build(language = "EN") {
    const supabase = fakeSupabase(seed());

    supabase.store.feedback = [
        {
            id: "fb-1",
            clinic_id: CLINIC_A,
            appointment_id: APPOINTMENT,
            patient_phone: PATIENT_PHONE,
            rating: null,
            comments: null,
            status: "PENDING"
        }
    ];

    supabase.store.whatsapp_sessions = [
        {
            phone: PATIENT_PHONE,
            clinic_id: CLINIC_A,
            state: "FEEDBACK_RATING",
            data: { language, appointmentId: APPOINTMENT },
            role: "PATIENT"
        }
    ];

    const wa = new FakeWhatsAppClient();
    const handler = new FeedbackHandler(supabase, wa);

    const rate = (stars: string) =>
        handler.handleRating(
            PATIENT_PHONE,
            { type: "interactive", text: `feedback_rating_${stars}` } as any,
            session("FEEDBACK_RATING", { language, appointmentId: APPOINTMENT }, CLINIC_A, PATIENT_PHONE, "PATIENT")
        );

    const comment = (text: string) =>
        handler.handleComments(
            PATIENT_PHONE,
            { type: "text", text } as any,
            session("FEEDBACK_COMMENTS", { language, appointmentId: APPOINTMENT }, CLINIC_A, PATIENT_PHONE, "PATIENT")
        );

    const said = () => wa.sent.map((m) => m.body).join("\n");
    const row = () => supabase.rows("feedback").find((f: any) => f.appointment_id === APPOINTMENT);

    return { supabase, wa, rate, comment, said, row };
}

Deno.test("the comment prompt says how to answer it, not only how to decline", async () => {
    const { rate, said } = build();

    await rate("5");

    assert(/type it here/i.test(said()), `no way to say yes was offered:\n${said()}`);
    assert(/No thanks/i.test(said()), `the decline is missing:\n${said()}`);
});

Deno.test("the prompt does not ask a yes or no question it cannot take yes for", async () => {
    // A button message can only carry the buttons it has, so a question
    // phrased as yes-or-no with one negative button is unanswerable.
    const { rate, wa } = build();

    await rate("4");

    const prompt = wa.sent.find((m) => m.body.includes("4/5"));
    const titles = (prompt?.buttons ?? []).map((b: any) => b.title);

    assert(prompt, "no prompt was sent");
    assert(
        !/would you like to add a comment\?/i.test(prompt!.body),
        `still a yes/no question:\n${prompt!.body}`
    );
    assertEquals(titles, ["No thanks"]);
});

Deno.test("a typed comment is stored against the appointment", async () => {
    const { rate, comment, row } = build();

    await rate("5");
    await comment("The doctor explained everything clearly.");

    assertEquals(row()?.comments, "The doctor explained everything clearly.");
    assertEquals(row()?.status, "COMPLETE");
});

Deno.test("tapping No thanks leaves the rating without a comment", async () => {
    const { rate, comment, row } = build();

    await rate("5");
    await comment(FEEDBACK_SKIP_ID);

    assertEquals(row()?.rating, 5);
    assertEquals(row()?.comments, null);
});

Deno.test("Hindi is told how to comment too", async () => {
    const { rate, said } = build("HI");

    await rate("5");

    assert(/लिखें/.test(said()), `Hindi does not say to type anything:\n${said()}`);
});
