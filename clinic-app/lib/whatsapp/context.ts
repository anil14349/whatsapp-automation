import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { InteractiveMenuSpec, MenuReply } from "./send";
import { sendMenuReply, sendWhatsAppImageByUrl, sendWhatsAppText } from "./send";
import { localizeWhatsAppReply } from "./localize";
import { truncateInteractiveLabel } from "./menus";
import { logMessage } from "./log";

/** A WhatsApp "Share Location" attachment, normalized. */
export interface InboundLocation {
  latitude: number;
  longitude: number;
}

/** Everything a conversation-flow handler needs, gathered once per inbound message. */
export interface FlowContext {
  supabase: SupabaseClient<Database>;
  phone: string;
  senderName: string;
  clinicName: string;
  clinicId?: string; // Optional: used for database-driven configuration
  interactiveMenusEnabled: boolean;
  timezone: string;
  /** The patient's session language ("EN" if none set yet). */
  language: string;
}

/** Sends a plain text reply, localized to the session's language. */
export async function reply(ctx: FlowContext, text: string): Promise<void> {
  const localized = localizeWhatsAppReply(ctx.language, text, ctx.clinicName);
  await sendWhatsAppText(ctx.phone, localized);
  await logOutbound(ctx, localized);
}

/**
 * Sends an interactive menu reply (or its text fallback), localized —
 * both the body text AND the menu itself (button/row titles/
 * descriptions, list section titles, the fallback text). Ports
 * localizeInteractiveMenu from src/View_Messages.gs: without this, a
 * non-English patient's tappable buttons/rows (and the plain-numbered
 * fallback shown when interactive menus are off or the interactive send
 * fails) stayed in English even though the same translated strings
 * already exist in lib/whatsapp/localization.json for the body-text
 * case.
 */
export async function replyMenu(
  ctx: FlowContext,
  text: string,
  menu: MenuReply
): Promise<void> {
  const localized = localizeWhatsAppReply(ctx.language, text, ctx.clinicName);

  const localizedMenu: MenuReply = {
    fallbackText: localizeWhatsAppReply(ctx.language, menu.fallbackText, ctx.clinicName),
    interactive: localizeInteractiveMenu(ctx.language, ctx.clinicName, menu.interactive)
  };

  await sendMenuReply(ctx.phone, localized, localizedMenu, ctx.interactiveMenusEnabled);
  await logOutbound(ctx, `${localized}\n[menu: ${localizedMenu.fallbackText}]`);
}

/**
 * Localizes every tappable label on an interactive spec — button/list
 * row titles, list row descriptions, and list section titles/button
 * label — re-truncating after translating since a translation can run
 * longer than the English original and WhatsApp's per-field character
 * caps (20/24/72, see lib/whatsapp/menus.ts's truncateInteractiveLabel)
 * don't care what language the text is in. EN (or no spec at all) is
 * returned as-is — no translation work needed for the source language.
 */
export function localizeInteractiveMenu(
  language: string,
  clinicName: string,
  interactive: InteractiveMenuSpec | null
): InteractiveMenuSpec | null {
  if (!interactive || String(language ?? "EN").toUpperCase() === "EN") {
    return interactive;
  }

  const localize = (text: string) => localizeWhatsAppReply(language, text, clinicName);

  if (interactive.type === "button") {
    return {
      type: "button",
      buttons: interactive.buttons.map((button) => ({
        id: button.id,
        title: truncateInteractiveLabel(localize(button.title), 20)
      }))
    };
  }

  return {
    type: "list",
    buttonLabel: truncateInteractiveLabel(localize(interactive.buttonLabel), 20),
    sections: interactive.sections.map((section) => ({
      title: truncateInteractiveLabel(localize(section.title), 24),
      rows: section.rows.map((row) => ({
        id: row.id,
        title: truncateInteractiveLabel(localize(row.title), 24),
        description: truncateInteractiveLabel(localize(row.description ?? ""), 72)
      }))
    }))
  };
}

/**
 * Sends an image by public URL, localized caption, logged like reply()/
 * replyMenu(). Unlike those, does NOT swallow send failures itself —
 * callers sending an optional/best-effort image (e.g. the greeting's
 * welcome image, lib/whatsapp/router.ts) should wrap this in try/catch
 * so an unfetchable or misconfigured URL never blocks the rest of the
 * conversation flow.
 */
export async function replyImage(ctx: FlowContext, imageUrl: string, caption: string): Promise<void> {
  const localized = localizeWhatsAppReply(ctx.language, caption, ctx.clinicName);
  await sendWhatsAppImageByUrl(ctx.phone, imageUrl, localized);
  await logOutbound(ctx, `[image] ${localized}`);
}

/** ENABLE_DEBUG_LOG-gated, truncated to LOG_MESSAGE_MAX_CHARS — both checked inside logMessage itself (lib/whatsapp/log.ts). */
async function logOutbound(ctx: FlowContext, message: string): Promise<void> {
  await logMessage(ctx.supabase, {
    direction: "OUT",
    phone: ctx.phone,
    status: "SUCCESS",
    message
  });
}
