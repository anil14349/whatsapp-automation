import { BUTTON_IDS } from "./button-ids.ts";
import type { WhatsAppClient } from "./whatsapp-client.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Supported languages, single source of truth.
 *
 * Only add a language once handler copy is actually translated for it.
 * Listing an untranslated language silently serves the fallback language.
 */

export interface SupportedLanguage {
    code: string;
    buttonId: string;
    label: string; // Native name; WhatsApp list rows cap titles at 24 chars.
}

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
    { code: "EN", buttonId: BUTTON_IDS.LANGUAGE.EN, label: "🇬🇧 English" },
    { code: "HI", buttonId: BUTTON_IDS.LANGUAGE.HI, label: "🇮🇳 हिंदी" }
];

export const DEFAULT_LANGUAGE = "EN";

export function isSupportedLanguageButton(buttonId: string): boolean {
    return SUPPORTED_LANGUAGES.some((lang) => lang.buttonId === buttonId.trim());
}

export function resolveLanguageCode(buttonId: string): string {
    const match = SUPPORTED_LANGUAGES.find((lang) => lang.buttonId === buttonId.trim());
    return match ? match.code : DEFAULT_LANGUAGE;
}

export function isSupportedLanguageCode(code: string): boolean {
    return SUPPORTED_LANGUAGES.some((lang) => lang.code === code);
}

/**
 * Send the language selector.
 *
 * Every option is tappable: reply buttons up to WhatsApp's limit of 3,
 * then a list message (max 10 rows) as more languages are added.
 */
export async function sendLanguagePrompt(
    whatsappClient: WhatsAppClient,
    phone: string,
    bodyText: string,
    supabase?: SupabaseClient
): Promise<void> {
    const options = SUPPORTED_LANGUAGES.slice(0, 10);

    if (options.length <= 3) {
        await whatsappClient.sendInteractiveButtonMessage(
            phone,
            bodyText,
            options.map((lang) => ({ id: lang.buttonId, title: lang.label })),
            supabase
        );
        return;
    }

    await whatsappClient.sendInteractiveListMessage(
        phone,
        bodyText,
        "Select language",
        [
            {
                title: "Languages",
                rows: options.map((lang) => ({ id: lang.buttonId, title: lang.label }))
            }
        ],
        supabase
    );
}
