import type { FlowContext } from "./context";
import { reply, replyMenu } from "./context";
import { getSession, saveSession } from "@/lib/sessions";
import { findPatientByPhone } from "@/lib/patients";
import { getLanguageMenuSpec, getMainMenuSpec } from "./menus";
import { handlePatientMessage } from "./patientFlow";

const SUPPORTED_LANGUAGE_CODES = new Set(["EN", "TE", "HI", "KA", "TA", "ML"]);

const GREETING_WORDS = new Set([
  "hi",
  "hello",
  "hey",
  "హాయ్",
  "హలో",
  "नमस्ते",
  "हेलो"
]);

/**
 * Top-level message dispatch. Ports the greeting-handling portion of
 * src/Controller_Router.gs's handleWhatsAppGreeting +
 * processWhatsAppTextMessage. Doctor routing (findDoctorByWhatsAppPhone
 * -> doctor conversation flow) isn't ported yet — a doctor messaging in
 * this build gets a "not available yet" reply instead of the Doctor
 * Portal (see clinic-app/README.md).
 */
export async function processInboundMessage(
  ctx: FlowContext,
  messageText: string
): Promise<void> {
  const normalizedMessage = messageText.toLowerCase().trim();

  if (GREETING_WORDS.has(normalizedMessage)) {
    await handleGreeting(ctx);
    return;
  }

  const handled = await handlePatientMessage(ctx, messageText, normalizedMessage);

  if (!handled) {
    await reply(ctx, "Sorry, I didn't understand that.\n\nPlease send Hi to start again.");
  }
}

async function handleGreeting(ctx: FlowContext): Promise<void> {
  const session = await getSession(ctx.supabase, ctx.phone);

  let savedLanguage = String(session?.language ?? "").toUpperCase();

  if (!SUPPORTED_LANGUAGE_CODES.has(savedLanguage)) {
    const patient = await findPatientByPhone(ctx.supabase, ctx.phone);

    if (patient && SUPPORTED_LANGUAGE_CODES.has(patient.language.toUpperCase())) {
      savedLanguage = patient.language.toUpperCase();
    }
  }

  if (SUPPORTED_LANGUAGE_CODES.has(savedLanguage)) {
    await saveSession(ctx.supabase, ctx.phone, {
      role: "PATIENT",
      state: "MAIN_MENU",
      language: savedLanguage,
      doctor_id: null,
      session_date: "",
      session_time: "",
      appointment_id: null
    });

    await replyMenu(
      { ...ctx, language: savedLanguage },
      "Welcome to {{CLINIC_NAME}}!",
      getMainMenuSpec()
    );

    return;
  }

  // First-time users (or a saved-language value that's somehow invalid)
  // choose their preferred language before anything else.
  await saveSession(ctx.supabase, ctx.phone, {
    role: "PATIENT",
    state: "LANGUAGE_SELECT",
    language: "",
    doctor_id: null,
    session_date: "",
    session_time: "",
    appointment_id: null
  });

  await replyMenu(ctx, "Welcome to {{CLINIC_NAME}}!", getLanguageMenuSpec());
}
