import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { CalendarPort } from "@/lib/calendar/types";
import type { MenuReply } from "./send";
import { sendMenuReply, sendWhatsAppText } from "./send";
import { localizeWhatsAppReply } from "./localize";
import { logMessage } from "./log";

/** A WhatsApp "Share Location" attachment, normalized. */
export interface InboundLocation {
  latitude: number;
  longitude: number;
}

/** Everything a conversation-flow handler needs, gathered once per inbound message. */
export interface FlowContext {
  supabase: SupabaseClient<Database>;
  calendar: CalendarPort;
  phone: string;
  senderName: string;
  clinicName: string;
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

/** Sends an interactive menu reply (or its text fallback), localized. */
export async function replyMenu(
  ctx: FlowContext,
  text: string,
  menu: MenuReply
): Promise<void> {
  const localized = localizeWhatsAppReply(ctx.language, text, ctx.clinicName);
  await sendMenuReply(ctx.phone, localized, menu, ctx.interactiveMenusEnabled);
  await logOutbound(ctx, `${localized}\n[menu: ${menu.fallbackText}]`);
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
