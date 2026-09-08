import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { CalendarPort } from "@/lib/calendar/types";
import type { MenuReply } from "./send";
import { sendMenuReply, sendWhatsAppText } from "./send";
import { localizeWhatsAppReply } from "./localize";

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
  await sendWhatsAppText(
    ctx.phone,
    localizeWhatsAppReply(ctx.language, text, ctx.clinicName)
  );
}

/** Sends an interactive menu reply (or its text fallback), localized. */
export async function replyMenu(
  ctx: FlowContext,
  text: string,
  menu: MenuReply
): Promise<void> {
  await sendMenuReply(
    ctx.phone,
    localizeWhatsAppReply(ctx.language, text, ctx.clinicName),
    menu,
    ctx.interactiveMenusEnabled
  );
}
