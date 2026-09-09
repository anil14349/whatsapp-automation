import type { FlowContext, InboundLocation } from "./context";
import { reply, replyImage, replyMenu } from "./context";
import { getSession, saveSession } from "@/lib/sessions";
import { findPatientByPhone } from "@/lib/patients";
import { findDoctorByWhatsAppPhone } from "@/lib/doctors";
import { buildAfterHoursMessage, getAfterHoursSettings, shouldBlockPatientForAfterHours } from "@/lib/afterHours";
import { getClinicWelcomeImageUrl } from "@/lib/settings";
import { getLanguageMenuSpec, getMainMenuSpec } from "./menus";
import { handlePatientMessage } from "./patientFlow";
import { handleDoctorMessage, sendDoctorMainMenu } from "./doctorFlow";
import { isRenderableLogoUrl } from "./receipt";

const WELCOME_IMAGE_CAPTION = "👋 Welcome to {{CLINIC_NAME}}!";

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
 * Doctor-flow states (lib/whatsapp/doctorFlow.ts) that treat the next
 * inbound message as free-form text rather than a menu choice. The
 * greeting-word shortcut below must not fire while a doctor is in one
 * of these states — otherwise typing a leave reason, a start/end time,
 * a custom reschedule/broadcast date, or a broadcast message that
 * happens to equal or contain a greeting word (e.g. "hi") gets silently
 * swallowed and the session reset to DOCTOR_MENU instead of being
 * handled as the input that state expects. Includes
 * DOCTOR_BROADCAST_DATE_CUSTOM/DOCTOR_BROADCAST_MESSAGE for the same
 * reason — those states didn't exist when this guard was first written.
 */
const DOCTOR_FREE_TEXT_STATES = new Set([
  "DOCTOR_AVAIL_START",
  "DOCTOR_AVAIL_END",
  "DOCTOR_LEAVE_DATE",
  "DOCTOR_LEAVE_REASON",
  "DOCTOR_LEAVE_RANGE_START",
  "DOCTOR_LEAVE_RANGE_END",
  "DOCTOR_LEAVE_RANGE_REASON",
  "DOCTOR_RESCHEDULE_DATE_CUSTOM",
  "DOCTOR_BROADCAST_DATE_CUSTOM",
  "DOCTOR_BROADCAST_MESSAGE"
]);

export function isDoctorFreeTextEntryState(state: string | null | undefined): boolean {
  return Boolean(state && DOCTOR_FREE_TEXT_STATES.has(state));
}

/**
 * Top-level message dispatch. Ports src/Controller_Router.gs's
 * handleWhatsAppGreeting + processWhatsAppTextMessage, including doctor
 * routing (findDoctorByWhatsAppPhone -> lib/whatsapp/doctorFlow.ts
 * instead of the patient flow) and the after-hours gate (checked before
 * greeting/patient dispatch, same order the Apps Script version used —
 * a patient's "Hi" during closed hours gets the after-hours reply
 * instead of the normal welcome menu).
 */
export async function processInboundMessage(
  ctx: FlowContext,
  messageText: string,
  location?: InboundLocation
): Promise<void> {
  const normalizedMessage = messageText.toLowerCase().trim();
  const session = await getSession(ctx.supabase, ctx.phone);
  const doctor = await findDoctorByWhatsAppPhone(ctx.supabase, ctx.phone);

  if (doctor) {
    if (GREETING_WORDS.has(normalizedMessage) && !isDoctorFreeTextEntryState(session?.state)) {
      await sendDoctorMainMenu(ctx, doctor);
      return;
    }

    const handled = await handleDoctorMessage(ctx, doctor, messageText, normalizedMessage);

    if (!handled) {
      await reply(ctx, "Sorry, I didn't understand that.\n\nPlease send Hi to start again.");
    }

    return;
  }

  const blocked = await shouldBlockPatientForAfterHours(ctx.supabase, {
    session,
    isDoctor: false,
    timezone: ctx.timezone
  });

  if (blocked) {
    const settings = await getAfterHoursSettings(ctx.supabase);
    const language = await resolveAfterHoursLanguage(ctx, session);
    await reply(ctx, buildAfterHoursMessage(language, ctx.clinicName, settings));
    return;
  }

  if (GREETING_WORDS.has(normalizedMessage)) {
    await handleGreeting(ctx, session);
    return;
  }

  const handled = await handlePatientMessage(ctx, messageText, normalizedMessage, location);

  if (!handled) {
    await reply(ctx, "Sorry, I didn't understand that.\n\nPlease send Hi to start again.");
  }
}

/** Ports resolveLanguageForAfterHoursReply — the session's saved language if valid, else the patient registry's, else "EN". */
async function resolveAfterHoursLanguage(
  ctx: FlowContext,
  session: Awaited<ReturnType<typeof getSession>>
): Promise<string> {
  const sessionLanguage = session?.language?.toUpperCase() ?? "";

  if (SUPPORTED_LANGUAGE_CODES.has(sessionLanguage)) {
    return sessionLanguage;
  }

  const patient = await findPatientByPhone(ctx.supabase, ctx.phone);
  const patientLanguage = patient?.language?.toUpperCase() ?? "";

  return SUPPORTED_LANGUAGE_CODES.has(patientLanguage) ? patientLanguage : "EN";
}

async function handleGreeting(
  ctx: FlowContext,
  session: Awaited<ReturnType<typeof getSession>>
): Promise<void> {
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

    const greetingCtx = { ...ctx, language: savedLanguage };
    const imageSent = await maybeSendWelcomeImage(greetingCtx);

    // Skip the redundant "Welcome to {{CLINIC_NAME}}!" text when the
    // image (with the same greeting as its caption) was just shown —
    // showing it twice in a row reads as a glitch, not a warm welcome.
    await replyMenu(
      greetingCtx,
      imageSent ? "How can we help you today?" : "Welcome to {{CLINIC_NAME}}!",
      getMainMenuSpec()
    );

    return;
  }

  // First-time users (or a saved-language value that's somehow invalid)
  // choose their preferred language before anything else. The welcome
  // image, if configured, always precedes the language menu here (no
  // text-collapsing needed — the language menu's own body is unrelated
  // greeting/instruction text, not a repeated "Welcome").
  await saveSession(ctx.supabase, ctx.phone, {
    role: "PATIENT",
    state: "LANGUAGE_SELECT",
    language: "",
    doctor_id: null,
    session_date: "",
    session_time: "",
    appointment_id: null
  });

  await maybeSendWelcomeImage(ctx);
  await replyMenu(ctx, "Welcome to {{CLINIC_NAME}}!", getLanguageMenuSpec());
}

/**
 * Ported from sendClinicWelcomeImageReply/getClinicWelcomeImageUrl in
 * src/WhatsApp_Send.gs — sends the optional CLINIC_WELCOME_IMAGE_URL
 * image on a patient's first/returning "Hi" (see handleGreeting above).
 * Blank/invalid URL is silently treated as "no welcome image, don't
 * send anything" (same convention as the receipt card's CLINIC_LOGO_URL
 * — see isRenderableLogoUrl), and any send failure is swallowed rather
 * than propagated: a broken image URL should never stop a patient from
 * reaching the main menu. Returns whether an image was actually sent,
 * so the caller can decide whether to collapse a following "Welcome"
 * text (see the MAIN_MENU branch above).
 */
async function maybeSendWelcomeImage(ctx: FlowContext): Promise<boolean> {
  const imageUrl = await getClinicWelcomeImageUrl(ctx.supabase);

  if (!isRenderableLogoUrl(imageUrl)) {
    return false;
  }

  try {
    await replyImage(ctx, imageUrl, WELCOME_IMAGE_CAPTION);
    return true;
  } catch (error) {
    console.error("Welcome image failed; continuing without it.", error);
    return false;
  }
}
