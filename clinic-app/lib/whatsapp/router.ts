import type { FlowContext, InboundLocation } from "./context";
import { reply, replyMenu } from "./context";
import { getSession, saveSession } from "@/lib/sessions";
import { findPatientByPhone } from "@/lib/patients";
import { findDoctorByWhatsAppPhone } from "@/lib/doctors";
import { getLanguageMenuSpec, getMainMenuSpec } from "./menus";
import { handlePatientMessage } from "./patientFlow";
import { handleDoctorMessage, sendDoctorMainMenu } from "./doctorFlow";

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
 * Top-level message dispatch. Ports src/Controller_Router.gs's
 * handleWhatsAppGreeting + processWhatsAppTextMessage, including doctor
 * routing (findDoctorByWhatsAppPhone -> lib/whatsapp/doctorFlow.ts
 * instead of the patient flow). A session's `role` column, once set to
 * "DOCTOR" by a successful lookup, is what fast-paths every later
 * message to the doctor flow without re-querying the doctors table on
 * every single inbound message — only the greeting and role-DOCTOR
 * paths do that lookup.
 */
export async function processInboundMessage(
  ctx: FlowContext,
  messageText: string,
  location?: InboundLocation
): Promise<void> {
  const normalizedMessage = messageText.toLowerCase().trim();

  // Doctor identity is checked on every message, not just the greeting,
  // by way of the session's saved role — a doctor's session is only ever
  // created with role "DOCTOR" (see handleGreeting below and
  // sendDoctorMainMenu), so this doesn't cost a doctors-table lookup per
  // message the way re-checking findDoctorByWhatsAppPhone every time
  // would.
  const session = await getSession(ctx.supabase, ctx.phone);

  if (session?.role === "DOCTOR" && session.doctor_id) {
    const doctor = await findDoctorByWhatsAppPhone(ctx.supabase, ctx.phone);

    if (doctor) {
      if (GREETING_WORDS.has(normalizedMessage)) {
        await sendDoctorMainMenu(ctx, doctor);
        return;
      }

      const handled = await handleDoctorMessage(ctx, doctor, messageText, normalizedMessage);

      if (!handled) {
        await reply(ctx, "Sorry, I didn't understand that.\n\nPlease send Hi to start again.");
      }

      return;
    }
  }

  if (GREETING_WORDS.has(normalizedMessage)) {
    await handleGreeting(ctx);
    return;
  }

  const handled = await handlePatientMessage(ctx, messageText, normalizedMessage, location);

  if (!handled) {
    await reply(ctx, "Sorry, I didn't understand that.\n\nPlease send Hi to start again.");
  }
}

async function handleGreeting(ctx: FlowContext): Promise<void> {
  const doctor = await findDoctorByWhatsAppPhone(ctx.supabase, ctx.phone);

  if (doctor) {
    await sendDoctorMainMenu(ctx, doctor);
    return;
  }

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
