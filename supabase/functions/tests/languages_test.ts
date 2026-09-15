/**
 * Language handling.
 *
 * button-ids declares six languages but only two are translated. Accepting an
 * undeclared-but-untranslated language used to silently serve Hindi, so a
 * Telugu speaker got Hindi with no indication anything had gone wrong.
 */

import { assertEquals } from "std/testing/asserts.ts";
import {
    SUPPORTED_LANGUAGES,
    DEFAULT_LANGUAGE,
    isSupportedLanguageButton,
    isSupportedLanguageCode,
    resolveLanguageCode,
    sendLanguagePrompt
} from "../shared/languages.ts";
import { BUTTON_IDS } from "../shared/button-ids.ts";
import { FakeWhatsAppClient } from "./helpers/fake-whatsapp.ts";

Deno.test("only translated languages are offered", () => {
    assertEquals(SUPPORTED_LANGUAGES.map((l) => l.code), ["EN", "HI"]);
});

Deno.test("declared but untranslated languages are not accepted", () => {
    assertEquals(isSupportedLanguageButton(BUTTON_IDS.LANGUAGE.TE), false);
    assertEquals(isSupportedLanguageButton(BUTTON_IDS.LANGUAGE.KN), false);
    assertEquals(isSupportedLanguageButton(BUTTON_IDS.LANGUAGE.TA), false);
    assertEquals(isSupportedLanguageButton(BUTTON_IDS.LANGUAGE.ML), false);
});

Deno.test("translated languages are accepted", () => {
    assertEquals(isSupportedLanguageButton(BUTTON_IDS.LANGUAGE.EN), true);
    assertEquals(isSupportedLanguageButton(BUTTON_IDS.LANGUAGE.HI), true);
});

Deno.test("button ids resolve to the right language code", () => {
    assertEquals(resolveLanguageCode(BUTTON_IDS.LANGUAGE.EN), "EN");
    assertEquals(resolveLanguageCode(BUTTON_IDS.LANGUAGE.HI), "HI");
});

Deno.test("an unknown button id falls back to the default language", () => {
    assertEquals(resolveLanguageCode("lang_klingon"), DEFAULT_LANGUAGE);
    assertEquals(resolveLanguageCode(""), DEFAULT_LANGUAGE);
});

Deno.test("surrounding whitespace does not break resolution", () => {
    assertEquals(resolveLanguageCode("  lang_hi  "), "HI");
    assertEquals(isSupportedLanguageButton(" lang_en "), true);
});

Deno.test("language codes are validated", () => {
    assertEquals(isSupportedLanguageCode("EN"), true);
    assertEquals(isSupportedLanguageCode("HI"), true);
    assertEquals(isSupportedLanguageCode("TE"), false);
});

Deno.test("the prompt is tappable, never plain text", async () => {
    const wa = new FakeWhatsAppClient();

    await sendLanguagePrompt(wa, "919", "Choose a language");

    const message = wa.lastMessage();

    assertEquals(message?.type, "buttons", "language prompt must be tappable");
    assertEquals(message?.buttons?.map((b) => b.id), ["lang_en", "lang_hi"]);
});

Deno.test("every offered option is one the handler will accept", async () => {
    const wa = new FakeWhatsAppClient();

    await sendLanguagePrompt(wa, "919", "Choose a language");

    const offered = [...(wa.lastMessage()?.buttons ?? []).map((b) => b.id), ...wa.offeredRowIds()];

    for (const id of offered) {
        assertEquals(isSupportedLanguageButton(id), true, `offered ${id} but would reject it`);
    }
});
