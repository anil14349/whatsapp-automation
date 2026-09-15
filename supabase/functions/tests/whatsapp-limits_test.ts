/**
 * Meta interactive-message limits.
 *
 * Exceeding these makes Meta reject the whole message (error 131009), which in
 * production looked like a menu that silently never arrived. The client throws
 * instead so the failure is loud.
 */

import { assertEquals, assertThrows } from "std/testing/asserts.ts";
import { FakeWhatsAppClient } from "./helpers/fake-whatsapp.ts";

function buttons(count: number, title = "Option") {
    return Array.from({ length: count }, (_, i) => ({ id: `b${i}`, title: `${title} ${i}` }));
}

function rows(count: number, title = "Row") {
    return Array.from({ length: count }, (_, i) => ({ id: `r${i}`, title: `${title} ${i}` }));
}

async function expectRejects(fn: () => Promise<unknown>, contains: string) {
    let message = "";

    try {
        await fn();
    } catch (error) {
        message = error instanceof Error ? error.message : String(error);
    }

    assertEquals(
        message.includes(contains),
        true,
        `expected error containing "${contains}", got "${message}"`
    );
}

Deno.test("three buttons are accepted", async () => {
    const wa = new FakeWhatsAppClient();

    await wa.sendInteractiveButtonMessage("919", "Pick", buttons(3));

    assertEquals(wa.sent.length, 1);
});

Deno.test("a fourth button is refused", async () => {
    const wa = new FakeWhatsAppClient();

    await expectRejects(
        () => wa.sendInteractiveButtonMessage("919", "Pick", buttons(4)),
        "max 3 buttons"
    );
});

Deno.test("a button title over 20 characters is refused", async () => {
    const wa = new FakeWhatsAppClient();

    // "Choose Different Time" is 21 characters and was silently rejected by
    // Meta, so the waitlist offer never reached patients.
    await expectRejects(
        () =>
            wa.sendInteractiveButtonMessage("919", "Pick", [
                { id: "a", title: "Choose Different Time" }
            ]),
        "max 20 characters"
    );
});

Deno.test("a 20 character button title is allowed", async () => {
    const wa = new FakeWhatsAppClient();

    await wa.sendInteractiveButtonMessage("919", "Pick", [
        { id: "a", title: "12345678901234567890" }
    ]);

    assertEquals(wa.sent.length, 1);
});

Deno.test("ten list rows are accepted but eleven are refused", async () => {
    const wa = new FakeWhatsAppClient();

    await wa.sendInteractiveListMessage("919", "Pick", "Menu", [
        { title: "S", rows: rows(10) }
    ]);

    assertEquals(wa.sent.length, 1);

    await expectRejects(
        () =>
            wa.sendInteractiveListMessage("919", "Pick", "Menu", [
                { title: "S", rows: rows(11) }
            ]),
        "max 10 rows"
    );
});

Deno.test("rows are counted across sections, not per section", async () => {
    const wa = new FakeWhatsAppClient();

    await expectRejects(
        () =>
            wa.sendInteractiveListMessage("919", "Pick", "Menu", [
                { title: "S1", rows: rows(6) },
                { title: "S2", rows: rows(6) }
            ]),
        "max 10 rows"
    );
});

Deno.test("an empty list is refused", async () => {
    const wa = new FakeWhatsAppClient();

    await expectRejects(
        () => wa.sendInteractiveListMessage("919", "Pick", "Menu", []),
        "at least one row"
    );
});

Deno.test("a row title over 24 characters is refused", async () => {
    const wa = new FakeWhatsAppClient();

    await expectRejects(
        () =>
            wa.sendInteractiveListMessage("919", "Pick", "Menu", [
                { title: "S", rows: [{ id: "r", title: "a".repeat(25) }] }
            ]),
        "max 24 characters"
    );
});

Deno.test("a list button title over 20 characters is refused", async () => {
    const wa = new FakeWhatsAppClient();

    await expectRejects(
        () =>
            wa.sendInteractiveListMessage("919", "Pick", "a".repeat(21), [
                { title: "S", rows: rows(1) }
            ]),
        "max 20 characters"
    );
});

Deno.test("emoji count as single characters, not byte pairs", async () => {
    const wa = new FakeWhatsAppClient();

    // Naive .length would see 22 here and reject a title Meta accepts.
    await wa.sendInteractiveButtonMessage("919", "Pick", [
        { id: "a", title: "🩺 Book Appointment" }
    ]);

    assertEquals(wa.sent.length, 1);
});
