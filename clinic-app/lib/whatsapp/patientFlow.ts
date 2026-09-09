import type { FlowContext, InboundLocation } from "./context";
import { reply, replyMenu } from "./context";
import type { WhatsAppSession } from "@/lib/sessions";
import { getSession, saveSession } from "@/lib/sessions";
import type { Doctor } from "@/lib/doctors";
import { getDoctorById, listDoctors } from "@/lib/doctors";
import { getAvailableSlotsForDoctor } from "@/lib/scheduling/slots";
import type { Appointment } from "@/lib/appointments";
import { bookAppointment, cancelAppointment, getConfirmedAppointmentsForPhone, rescheduleAppointment } from "@/lib/appointments";
import {
  findPatientByPhone,
  isValidPatientName,
  patientNeedsNameCapture,
  registerPatientForBooking
} from "@/lib/patients";
import {
  combineDateAndTime,
  formatDateKey,
  formatTimeLabel,
  isValidISODate
} from "@/lib/scheduling/dates";
import {
  getBooleanSetting,
  getClinicWelcomeImageUrl,
  getHomeCollectionRadiusKm,
  getHospitalLocation,
  getSetting
} from "@/lib/settings";
import { getServerEnv } from "@/lib/env";
import { haversineDistanceKm } from "@/lib/scheduling/geo";
import { createHomeCollectionRequest } from "@/lib/homeCollection";
import { sendWhatsAppFlow, sendWhatsAppImage, uploadWhatsAppMedia } from "./send";
import { generateAppointmentReceiptImageBuffer, isRenderableLogoUrl, type AppointmentReceiptDetails } from "./receipt";
import type { AppointmentListItem } from "./menus";
import {
  buildAppointmentDetailMessage,
  classifyAppointmentListChoice,
  getAppointmentListMenuSpec,
  getDateMenuSpec,
  getDoctorSelectionMenuSpec,
  getHomeCollectionTimeWindowSpec,
  getLanguageMenuSpec,
  getMainMenuSpec,
  getMyAppointmentActionSpec,
  getPatientMoreMenuSpec,
  getSlotSelectionMenuSpec,
  getYesNoConfirmSpec,
  HOME_COLLECTION_TIME_WINDOWS,
  parseSlotSelectionId,
  resolveTypedSlotSelection
} from "./menus";

/**
 * Patient conversation state machine. Ports src/Controller_PatientFlow.gs
 * (+ the appointment-list helpers in src/Controller_Shared.gs) — booking,
 * My Appointments, cancel, and reschedule. Doctor-selection pagination
 * (doctor_prev/doctor_next, BOOK_DOCTOR below) and the shareable
 * appointment receipt card (sendAppointmentReceiptCard) are both
 * implemented here too — see clinic-app/README.md for what's covered.
 */

const LANGUAGE_BY_CHOICE: Record<string, string> = {
  "1": "EN",
  "2": "TE",
  "3": "HI",
  "4": "KA",
  "5": "TA",
  "6": "ML"
};

export async function handlePatientMessage(
  ctx: FlowContext,
  messageText: string,
  normalizedMessage: string,
  location?: InboundLocation
): Promise<boolean> {
  const session = await getSession(ctx.supabase, ctx.phone);

  if (!session) {
    return false;
  }

  switch (session.state) {
    case "LANGUAGE_SELECT": {
      const language = LANGUAGE_BY_CHOICE[normalizedMessage];

      if (!language) {
        await replyMenu(ctx, "Invalid option.", getLanguageMenuSpec());
        return true;
      }

      await saveSession(ctx.supabase, ctx.phone, {
        role: "PATIENT",
        language,
        state: "MAIN_MENU"
      });

      await registerPatientForBooking(ctx.supabase, ctx.phone, ctx.senderName, language);

      // The welcome image (if CLINIC_WELCOME_IMAGE_URL is set) was
      // already sent once with this same greeting as its caption, right
      // before the language menu that led here (see
      // lib/whatsapp/router.ts's handleGreeting) — don't resend it, and
      // drop the redundant "Welcome" text so it isn't shown a third time
      // in the same conversation (image caption, then here).
      const welcomeImageConfigured = isRenderableLogoUrl(await getClinicWelcomeImageUrl(ctx.supabase));

      await replyMenu(
        { ...ctx, language },
        welcomeImageConfigured
          ? "How can we help you today?"
          : "Welcome to {{CLINIC_NAME}}!\nPlease choose an option:",
        getMainMenuSpec()
      );

      return true;
    }

    case "MAIN_MENU": {
      if (normalizedMessage === "1") {
        return startBooking(ctx);
      }

      if (normalizedMessage === "2") {
        return startAppointmentListFlow(
          ctx,
          "MY_APPOINTMENTS",
          "Your appointments:\nSelect one to view options.",
          "You have no active appointments to show."
        );
      }

      if (
        normalizedMessage === "menu_more" ||
        normalizedMessage === "more" ||
        normalizedMessage === "3"
      ) {
        await saveSession(ctx.supabase, ctx.phone, { state: "PATIENT_MAIN_MORE" });
        await sendMoreMenu(ctx, "More options:");
        return true;
      }

      await replyMenu(ctx, "Invalid option.", getMainMenuSpec());
      return true;
    }

    case "PATIENT_MAIN_MORE": {
      if (normalizedMessage === "cancel_appointment" || normalizedMessage === "1") {
        return startAppointmentListFlow(
          ctx,
          "CANCEL_SELECT",
          "Select the appointment to cancel:",
          "You have no active appointments to cancel."
        );
      }

      if (normalizedMessage === "reschedule_appointment" || normalizedMessage === "2") {
        return startAppointmentListFlow(
          ctx,
          "RESCHEDULE_SELECT",
          "Select the appointment to reschedule:",
          "You have no active appointments to reschedule."
        );
      }

      if (normalizedMessage === "change_language" || normalizedMessage === "3") {
        await saveSession(ctx.supabase, ctx.phone, { state: "LANGUAGE_SELECT" });
        await replyMenu(ctx, "Select your language:", getLanguageMenuSpec());
        return true;
      }

      if (normalizedMessage === "home_collection" || normalizedMessage === "4") {
        const homeCollectionEnabled = await getBooleanSetting(
          ctx.supabase,
          "ENABLE_HOME_COLLECTION",
          true
        );

        if (homeCollectionEnabled) {
          return startHomeCollectionFlow(ctx);
        }

        // Falls through to "Invalid option" below — same as any other
        // unrecognized input, since this option isn't offered at all
        // when disabled (see sendMoreMenu).
      }

      if (normalizedMessage === "nav_main_menu" || normalizedMessage === "0") {
        return returnToMainMenu(ctx);
      }

      await sendMoreMenu(ctx, "Invalid option.");
      return true;
    }

    case "HOME_COLLECTION_LOCATION": {
      if (!location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) {
        await reply(
          ctx,
          "📍 Please use WhatsApp's Location attachment to share where the sample should be collected — typed text can't be used for this."
        );
        return true;
      }

      const hospital = await getHospitalLocation(ctx.supabase);

      if (!hospital) {
        return returnToMainMenuWithMessage(
          ctx,
          "Home sample collection isn't set up yet. Please call the clinic directly."
        );
      }

      const radiusKm = await getHomeCollectionRadiusKm(ctx.supabase);
      const distanceKm = haversineDistanceKm(location.latitude, location.longitude, hospital.lat, hospital.lng);

      if (distanceKm > radiusKm) {
        return returnToMainMenuWithMessage(
          ctx,
          `Sorry, home sample collection is only available within ${radiusKm} km of {{CLINIC_NAME}}.\n\nYour shared location is about ${distanceKm.toFixed(1)} km away.`
        );
      }

      await saveSession(ctx.supabase, ctx.phone, {
        state: "HOME_COLLECTION_DATE",
        location: `${location.latitude},${location.longitude}`
      });

      await replyMenu(
        ctx,
        `You're within ${radiusKm} km — home sample collection is available!\n\nChoose a preferred date:`,
        getDateMenuSpec()
      );
      return true;
    }

    case "HOME_COLLECTION_DATE": {
      const quickDate = resolveQuickDateChoice(normalizedMessage, ctx.timezone);

      if (quickDate) {
        await saveSession(ctx.supabase, ctx.phone, { state: "HOME_COLLECTION_TIME", session_date: quickDate });
        await replyMenu(ctx, "Choose a preferred time window:", getHomeCollectionTimeWindowSpec());
        return true;
      }

      if (normalizedMessage === "3") {
        await saveSession(ctx.supabase, ctx.phone, { state: "HOME_COLLECTION_DATE_CUSTOM" });
        await reply(ctx, "Please enter the preferred date in YYYY-MM-DD format.");
        return true;
      }

      await replyMenu(ctx, "Invalid option.\n\nChoose a preferred date:", getDateMenuSpec());
      return true;
    }

    case "HOME_COLLECTION_DATE_CUSTOM": {
      const typed = messageText.trim();

      if (!isValidISODate(typed) || typed < formatDateKey(new Date(), ctx.timezone)) {
        await reply(
          ctx,
          "That doesn't look like a valid future date.\n\nPlease enter the preferred date in YYYY-MM-DD format."
        );
        return true;
      }

      await saveSession(ctx.supabase, ctx.phone, { state: "HOME_COLLECTION_TIME", session_date: typed });
      await replyMenu(ctx, "Choose a preferred time window:", getHomeCollectionTimeWindowSpec());
      return true;
    }

    case "HOME_COLLECTION_TIME": {
      const timeWindow = HOME_COLLECTION_TIME_WINDOWS[normalizedMessage];

      if (!timeWindow) {
        await replyMenu(
          ctx,
          "Invalid option.\n\nChoose a preferred time window:",
          getHomeCollectionTimeWindowSpec()
        );
        return true;
      }

      if (!session.session_date) {
        return expireFlow(ctx);
      }

      const [latText, lngText] = (session.location || "").split(",");
      const latitude = Number(latText);
      const longitude = Number(lngText);
      const hospital = await getHospitalLocation(ctx.supabase);

      const distanceKm =
        hospital && Number.isFinite(latitude) && Number.isFinite(longitude)
          ? haversineDistanceKm(latitude, longitude, hospital.lat, hospital.lng)
          : 0;

      const knownPatient = await findPatientByPhone(ctx.supabase, ctx.phone);
      const patientName = knownPatient?.name || ctx.senderName || "Patient";

      await createHomeCollectionRequest(ctx.supabase, {
        phone: ctx.phone,
        patientName,
        latitude: Number.isFinite(latitude) ? latitude : 0,
        longitude: Number.isFinite(longitude) ? longitude : 0,
        distanceKm,
        preferredDate: session.session_date,
        timeWindow
      });

      const requestedDate = session.session_date;

      await saveSession(ctx.supabase, ctx.phone, {
        role: "PATIENT",
        state: "MAIN_MENU",
        doctor_id: null,
        session_date: "",
        session_time: "",
        appointment_id: null,
        location: ""
      });

      await replyMenu(
        ctx,
        `Home sample collection requested for ${requestedDate} (${timeWindow}).\n\nOur team will call you shortly to confirm the exact time.`,
        getMainMenuSpec()
      );
      return true;
    }

    case "MY_APPOINTMENTS": {
      return handleAppointmentListChoice(
        ctx,
        session,
        normalizedMessage,
        "Your appointments:\nSelect one to view options.",
        async (item, appointment) => {
          await saveSession(ctx.supabase, ctx.phone, {
            state: "MY_APPOINTMENT_ACTION",
            doctor_id: appointment.doctor_id,
            session_date: appointment.appointment_date,
            session_time: appointment.appointment_time,
            appointment_id: appointment.id
          });

          await replyMenu(ctx, buildAppointmentDetailMessage(item), getMyAppointmentActionSpec());
          return true;
        }
      );
    }

    case "MY_APPOINTMENT_ACTION": {
      if (!session.appointment_id) {
        return expireFlow(ctx);
      }

      if (normalizedMessage === "appointment_action_cancel" || normalizedMessage === "1") {
        await saveSession(ctx.supabase, ctx.phone, { state: "CANCEL_CONFIRM" });
        await replyMenu(ctx, "Cancel this appointment?", getYesNoConfirmSpec());
        return true;
      }

      if (normalizedMessage === "appointment_action_reschedule" || normalizedMessage === "2") {
        if (!session.doctor_id) {
          return expireFlow(ctx);
        }

        await saveSession(ctx.supabase, ctx.phone, { state: "RESCHEDULE_DATE" });
        await replyMenu(ctx, "Choose a new date:", getDateMenuSpec());
        return true;
      }

      if (normalizedMessage === "nav_main_menu" || normalizedMessage === "0") {
        return returnToMainMenu(ctx);
      }

      await replyMenu(ctx, "Invalid option.", getMyAppointmentActionSpec());
      return true;
    }

    case "CANCEL_SELECT": {
      return handleAppointmentListChoice(
        ctx,
        session,
        normalizedMessage,
        "Select the appointment to cancel:",
        async (item, appointment) => {
          await saveSession(ctx.supabase, ctx.phone, {
            state: "CANCEL_CONFIRM",
            appointment_id: appointment.id
          });

          await replyMenu(
            ctx,
            `${buildAppointmentDetailMessage(item)}\n\nCancel this appointment?`,
            getYesNoConfirmSpec()
          );
          return true;
        }
      );
    }

    case "CANCEL_CONFIRM": {
      if (!session.appointment_id) {
        return expireFlow(ctx);
      }

      if (normalizedMessage === "1" || normalizedMessage === "confirm_yes") {
        const result = await cancelAppointment(ctx.supabase, ctx.calendar, session.appointment_id, {
          patientPhone: ctx.phone
        });

        await saveSession(ctx.supabase, ctx.phone, { state: "MAIN_MENU", appointment_id: null });

        await replyMenu(
          ctx,
          // result.message on success is already a complete sentence
          // ("Appointment cancelled successfully.") — prefixing it with
          // another "Appointment cancelled." said the same thing twice.
          result.success ? result.message : `Unable to cancel: ${result.message}`,
          getMainMenuSpec()
        );
        return true;
      }

      if (normalizedMessage === "2" || normalizedMessage === "confirm_no") {
        await saveSession(ctx.supabase, ctx.phone, { state: "MAIN_MENU" });
        await replyMenu(ctx, "Okay, appointment was not cancelled.", getMainMenuSpec());
        return true;
      }

      await replyMenu(ctx, "Invalid option.", getYesNoConfirmSpec());
      return true;
    }

    case "RESCHEDULE_SELECT": {
      return handleAppointmentListChoice(
        ctx,
        session,
        normalizedMessage,
        "Select the appointment to reschedule:",
        async (item, appointment) => {
          await saveSession(ctx.supabase, ctx.phone, {
            state: "RESCHEDULE_DATE",
            doctor_id: appointment.doctor_id,
            appointment_id: appointment.id
          });

          await replyMenu(ctx, `${item.doctorName}\n\nChoose a new date:`, getDateMenuSpec());
          return true;
        }
      );
    }

    case "RESCHEDULE_DATE": {
      if (!session.doctor_id || !session.appointment_id) {
        return expireFlow(ctx);
      }

      const quickDate = resolveQuickDateChoice(normalizedMessage, ctx.timezone);

      if (quickDate) {
        return offerRescheduleSlotsForDate(ctx, session.doctor_id, quickDate);
      }

      if (normalizedMessage === "3") {
        await saveSession(ctx.supabase, ctx.phone, { state: "RESCHEDULE_DATE_CUSTOM" });
        await reply(ctx, "Please enter the date in YYYY-MM-DD format.");
        return true;
      }

      await replyMenu(ctx, "Invalid option.", getDateMenuSpec());
      return true;
    }

    case "RESCHEDULE_DATE_CUSTOM": {
      if (!session.doctor_id || !session.appointment_id) {
        return expireFlow(ctx);
      }

      const typed = messageText.trim();

      if (!isValidISODate(typed) || typed < formatDateKey(new Date(), ctx.timezone)) {
        await reply(
          ctx,
          "That doesn't look like a valid future date.\n\nPlease enter the date in YYYY-MM-DD format."
        );
        return true;
      }

      return offerRescheduleSlotsForDate(ctx, session.doctor_id, typed);
    }

    case "RESCHEDULE_TIME": {
      if (!session.doctor_id || !session.session_date || !session.appointment_id) {
        return expireFlow(ctx);
      }

      const doctor = await getDoctorById(ctx.supabase, session.doctor_id);

      if (!doctor) {
        return expireFlow(ctx);
      }

      const slots = await getAvailableSlotsForDoctor(ctx.supabase, ctx.calendar, {
        doctor,
        dateString: session.session_date,
        timezone: ctx.timezone
      });

      const selected =
        parseSlotSelectionId(normalizedMessage) ??
        resolveTypedSlotSelection(normalizedMessage, slots);

      const isOffered = selected && slots.some((s) => s.getTime() === selected.getTime());

      if (!isOffered || !selected) {
        await replyMenu(
          ctx,
          "Please choose one of the available slots:",
          getSlotSelectionMenuSpec(slots, ctx.timezone)
        );
        return true;
      }

      await saveSession(ctx.supabase, ctx.phone, {
        session_time: formatTimeLabel(selected, ctx.timezone),
        state: "RESCHEDULE_CONFIRM"
      });

      await replyMenu(
        ctx,
        `New date: ${session.session_date}\nNew time: ${formatTimeLabel(selected, ctx.timezone)}\n\nConfirm reschedule?`,
        getYesNoConfirmSpec()
      );
      return true;
    }

    case "RESCHEDULE_CONFIRM": {
      if (!session.appointment_id || !session.session_date || !session.session_time) {
        return expireFlow(ctx);
      }

      if (normalizedMessage === "1" || normalizedMessage === "confirm_yes") {
        const result = await rescheduleAppointment(ctx.supabase, ctx.calendar, {
          appointmentId: session.appointment_id,
          newDateString: session.session_date,
          newTimeString: session.session_time,
          timezone: ctx.timezone,
          patientPhone: ctx.phone
        });

        if (!result.success || !result.appointment) {
          await reply(
            ctx,
            `${result.message}\n\nPlease choose another time or send Hi to start again.`
          );
          return true;
        }

        const doctor = await getDoctorById(ctx.supabase, result.appointment.doctor_id);

        await saveSession(ctx.supabase, ctx.phone, {
          state: "MAIN_MENU",
          doctor_id: null,
          session_date: "",
          session_time: ""
        });

        await reply(
          ctx,
          "Appointment rescheduled!\n\n" +
            `Doctor: ${doctor?.name ?? ""}\n` +
            `Date: ${result.appointment.appointment_date}\n` +
            `Time: ${session.session_time}\n\n` +
            "Thank you for choosing {{CLINIC_NAME}}."
        );
        return true;
      }

      if (normalizedMessage === "2" || normalizedMessage === "confirm_no") {
        await saveSession(ctx.supabase, ctx.phone, { state: "MAIN_MENU" });
        await replyMenu(ctx, "Okay, appointment was not changed.", getMainMenuSpec());
        return true;
      }

      await replyMenu(ctx, "Invalid option.", getYesNoConfirmSpec());
      return true;
    }

    case "BOOK_DOCTOR": {
      const doctors = await listDoctors(ctx.supabase, { activeOnly: true });
      const currentPage = session.list_page ?? 0;

      if (normalizedMessage === "doctor_prev" || normalizedMessage === "doctor_next") {
        const nextPage =
          normalizedMessage === "doctor_prev" ? Math.max(currentPage - 1, 0) : currentPage + 1;

        await saveSession(ctx.supabase, ctx.phone, { list_page: nextPage });
        await replyMenu(ctx, "Select a doctor:", getDoctorSelectionMenuSpec(doctors, nextPage));
        return true;
      }

      let selectedDoctorCode: string | null = null;

      if (normalizedMessage.startsWith("doctor_select_")) {
        selectedDoctorCode = normalizedMessage.slice("doctor_select_".length);
      } else {
        const index = Number(normalizedMessage);
        if (Number.isInteger(index) && index >= 1 && index <= doctors.length) {
          selectedDoctorCode = doctors[index - 1]!.doctor_code;
        }
      }

      const doctor = selectedDoctorCode
        ? doctors.find((d) => d.doctor_code === selectedDoctorCode) ?? null
        : null;

      if (!doctor) {
        await replyMenu(
          ctx,
          "Please choose a valid doctor.",
          getDoctorSelectionMenuSpec(doctors, currentPage)
        );
        return true;
      }

      await saveSession(ctx.supabase, ctx.phone, {
        state: "BOOK_DATE",
        doctor_id: doctor.id,
        list_page: 0
      });

      await replyMenu(
        ctx,
        `${doctor.name}\n\nPlease choose a date:`,
        getDateMenuSpec()
      );

      return true;
    }

    case "BOOK_DATE": {
      if (!session.doctor_id) {
        return expireBooking(ctx);
      }

      const quickDate = resolveQuickDateChoice(normalizedMessage, ctx.timezone);

      if (quickDate) {
        return offerSlotsForDate(ctx, session.doctor_id, quickDate);
      }

      if (normalizedMessage === "3") {
        await saveSession(ctx.supabase, ctx.phone, { state: "BOOK_DATE_CUSTOM" });
        await reply(ctx, "Please enter the date in YYYY-MM-DD format.");
        return true;
      }

      await replyMenu(ctx, "Invalid option.", getDateMenuSpec());
      return true;
    }

    case "BOOK_DATE_CUSTOM": {
      if (!session.doctor_id) {
        return expireBooking(ctx);
      }

      const typed = messageText.trim();

      if (!isValidISODate(typed) || typed < formatDateKey(new Date(), ctx.timezone)) {
        await reply(
          ctx,
          "That doesn't look like a valid future date.\n\nPlease enter the date in YYYY-MM-DD format."
        );
        return true;
      }

      return offerSlotsForDate(ctx, session.doctor_id, typed);
    }

    case "BOOK_TIME": {
      if (!session.doctor_id || !session.session_date) {
        return expireBooking(ctx);
      }

      const doctor = await getDoctorById(ctx.supabase, session.doctor_id);

      if (!doctor) {
        return expireBooking(ctx);
      }

      const slots = await getAvailableSlotsForDoctor(ctx.supabase, ctx.calendar, {
        doctor,
        dateString: session.session_date,
        timezone: ctx.timezone
      });

      const selected =
        parseSlotSelectionId(normalizedMessage) ??
        resolveTypedSlotSelection(normalizedMessage, slots);

      const isOffered = selected && slots.some((s) => s.getTime() === selected.getTime());

      if (!isOffered || !selected) {
        await replyMenu(
          ctx,
          "Please choose one of the available slots:",
          getSlotSelectionMenuSpec(slots, ctx.timezone)
        );
        return true;
      }

      await saveSession(ctx.supabase, ctx.phone, {
        session_time: formatTimeLabel(selected, ctx.timezone)
      });

      const needsName = await patientNeedsNameCapture(ctx.supabase, ctx.phone);

      if (needsName) {
        await saveSession(ctx.supabase, ctx.phone, { state: "BOOK_NAME" });
        await reply(ctx, "Please enter your full name to complete the booking.");
        return true;
      }

      await saveSession(ctx.supabase, ctx.phone, { state: "BOOK_CONFIRM" });
      await replyMenu(ctx, "Please confirm your appointment:", getYesNoConfirmSpec());
      return true;
    }

    case "BOOK_NAME": {
      if (!session.doctor_id || !session.session_date || !session.session_time) {
        return expireBooking(ctx);
      }

      const enteredName = messageText.trim();

      if (!isValidPatientName(enteredName)) {
        await reply(ctx, "Please enter a valid full name (at least 2 characters).");
        return true;
      }

      await registerPatientForBooking(ctx.supabase, ctx.phone, enteredName, ctx.language);

      await saveSession(ctx.supabase, ctx.phone, {
        state: "BOOK_CONFIRM",
        patient_name: enteredName
      });

      await replyMenu(ctx, "Please confirm your appointment:", getYesNoConfirmSpec());
      return true;
    }

    case "BOOK_CONFIRM": {
      if (normalizedMessage !== "1" && normalizedMessage !== "confirm_yes") {
        if (normalizedMessage === "2" || normalizedMessage === "confirm_no") {
          await saveSession(ctx.supabase, ctx.phone, { state: "MAIN_MENU" });
          await replyMenu(ctx, "Appointment booking cancelled.", getMainMenuSpec());
          return true;
        }

        await replyMenu(ctx, "Invalid option.", getYesNoConfirmSpec());
        return true;
      }

      if (!session.doctor_id || !session.session_date || !session.session_time) {
        return expireBooking(ctx);
      }

      const patientName = session.patient_name || ctx.senderName || "Patient";

      const result = await bookAppointment(ctx.supabase, ctx.calendar, {
        doctorId: session.doctor_id,
        dateString: session.session_date,
        timeString: session.session_time,
        patientName,
        patientPhone: ctx.phone,
        patientLanguage: ctx.language,
        timezone: ctx.timezone
      });

      if (!result.success || !result.appointment) {
        await reply(
          ctx,
          `${result.message}\n\nPlease choose another time or send Hi to start again.`
        );
        return true;
      }

      await saveSession(ctx.supabase, ctx.phone, {
        state: "MAIN_MENU",
        doctor_id: null,
        session_date: "",
        session_time: "",
        appointment_id: result.appointment.id
      });

      const doctor = await getDoctorById(ctx.supabase, result.appointment.doctor_id);
      const appointmentDateTime = combineDateAndTime(
        result.appointment.appointment_date,
        result.appointment.appointment_time,
        ctx.timezone
      );
      const timeLabel = formatTimeLabel(appointmentDateTime, ctx.timezone);

      await reply(
        ctx,
        "Appointment confirmed!\n\n" +
          `Doctor: ${doctor?.name ?? ""}\n` +
          `Date: ${result.appointment.appointment_date}\n` +
          `Time: ${timeLabel}\n\n` +
          "Thank you for choosing {{CLINIC_NAME}}."
      );

      await sendAppointmentReceiptCard(ctx, {
        clinicName: ctx.clinicName,
        patientName: result.appointment.patient_name,
        doctorName: doctor?.name ?? "Doctor",
        specialization: doctor?.specialization ?? "",
        date: result.appointment.appointment_date,
        time: timeLabel,
        appointmentCode: result.appointment.appointment_code
      });

      return true;
    }

    default:
      return false;
  }
}

/**
 * Best-effort: generates and sends the shareable appointment receipt
 * card after a successful booking (ports the try/catch around
 * sendAppointmentReceiptCard in src/Controller_PatientFlow.gs) — a
 * failure here must never undo or fail the booking that already
 * succeeded, so every error is swallowed after logging.
 */
async function sendAppointmentReceiptCard(
  ctx: FlowContext,
  details: Omit<AppointmentReceiptDetails, "logoUrl">
): Promise<void> {
  try {
    const logoUrl = await getSetting(ctx.supabase, "CLINIC_LOGO_URL", "");
    const imageBuffer = await generateAppointmentReceiptImageBuffer({ ...details, logoUrl });
    const mediaId = await uploadWhatsAppMedia(imageBuffer, "image/png");
    await sendWhatsAppImage(
      ctx.phone,
      mediaId,
      "Appointment confirmation — please forward this card to the patient if you booked on their behalf."
    );
  } catch (error) {
    console.error("Appointment receipt card failed; booking remains successful.", error);
  }
}

async function sendDoctorSelection(ctx: FlowContext): Promise<boolean> {
  const doctors = await listDoctors(ctx.supabase, { activeOnly: true });
  await replyMenu(ctx, "Select a doctor:", getDoctorSelectionMenuSpec(doctors));
  return true;
}

/**
 * Entry point for "Book Appointment" — sends the native WhatsApp Flow
 * form (see lib/whatsapp/flowBooking.ts) when the clinic has one
 * configured and turned on, otherwise falls back to the existing
 * list/button conversation exactly as before. The session state is only
 * set to BOOK_DOCTOR in the fallback case; the Flow path sets its own
 * BOOK_VIA_FLOW state from inside the Flow endpoint's INIT handler once
 * WhatsApp actually opens the form (which may never happen if the
 * patient ignores the message), not here.
 */
async function startBooking(ctx: FlowContext): Promise<boolean> {
  const flowBookingEnabled = await getBooleanSetting(
    ctx.supabase,
    "ENABLE_WHATSAPP_FLOW_BOOKING",
    false
  );

  const env = getServerEnv();

  if (flowBookingEnabled && env.WHATSAPP_FLOW_ID) {
    try {
      await sendWhatsAppFlow(ctx.phone, "Let's book your appointment.", {
        flowId: env.WHATSAPP_FLOW_ID,
        flowToken: ctx.phone,
        ctaLabel: "Book Appointment"
      });
      return true;
    } catch (error) {
      console.error(
        "Failed to send WhatsApp Flow booking message, falling back to list menu.",
        error
      );
      // Falls through to the list/button flow below.
    }
  }

  await saveSession(ctx.supabase, ctx.phone, { state: "BOOK_DOCTOR", list_page: 0 });
  return sendDoctorSelection(ctx);
}

async function offerSlotsForDate(
  ctx: FlowContext,
  doctorId: string,
  dateString: string
): Promise<boolean> {
  const doctor = await getDoctorById(ctx.supabase, doctorId);

  if (!doctor) {
    return expireBooking(ctx);
  }

  const slots = await getAvailableSlotsForDoctor(ctx.supabase, ctx.calendar, {
    doctor,
    dateString,
    timezone: ctx.timezone
  });

  if (slots.length === 0) {
    // Stay in BOOK_DATE, not BOOK_TIME — the message below asks the
    // patient to pick another date, but BOOK_TIME's handler expects a
    // slot number reply, not a date. Re-showing the date menu here (not
    // just a bare text prompt) also gives them a valid next input.
    await saveSession(ctx.supabase, ctx.phone, { state: "BOOK_DATE" });
    await replyMenu(
      ctx,
      `Sorry, there are no available slots on ${dateString}.\n\nPlease choose another date:`,
      getDateMenuSpec()
    );
    return true;
  }

  await saveSession(ctx.supabase, ctx.phone, {
    state: "BOOK_TIME",
    session_date: dateString
  });

  await replyMenu(
    ctx,
    "Available slots:\nPlease choose a time.",
    getSlotSelectionMenuSpec(slots, ctx.timezone)
  );

  return true;
}

async function expireBooking(ctx: FlowContext): Promise<boolean> {
  await saveSession(ctx.supabase, ctx.phone, { state: "MAIN_MENU" });
  await reply(ctx, "Your booking session has expired.\n\nPlease send Hi to start again.");
  return true;
}

/** Same as expireBooking but for the My Appointments/cancel/reschedule sub-flows, which aren't "a booking" — wording only. */
async function expireFlow(ctx: FlowContext): Promise<boolean> {
  await saveSession(ctx.supabase, ctx.phone, { state: "MAIN_MENU" });
  await reply(ctx, "Your session has expired.\n\nPlease send Hi to start again.");
  return true;
}

async function returnToMainMenu(ctx: FlowContext): Promise<boolean> {
  await saveSession(ctx.supabase, ctx.phone, { state: "MAIN_MENU" });
  await replyMenu(ctx, "Main menu:", getMainMenuSpec());
  return true;
}

/** "1"/"2" -> today/tomorrow as an ISO date string; anything else (including "3", the custom-date option) -> null, left for the caller to handle. */
function resolveQuickDateChoice(normalizedMessage: string, timezone: string): string | null {
  if (normalizedMessage === "1") {
    return formatDateKey(new Date(), timezone);
  }

  if (normalizedMessage === "2") {
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    return formatDateKey(tomorrow, timezone);
  }

  return null;
}

async function offerRescheduleSlotsForDate(
  ctx: FlowContext,
  doctorId: string,
  dateString: string
): Promise<boolean> {
  const doctor = await getDoctorById(ctx.supabase, doctorId);

  if (!doctor) {
    return expireFlow(ctx);
  }

  const slots = await getAvailableSlotsForDoctor(ctx.supabase, ctx.calendar, {
    doctor,
    dateString,
    timezone: ctx.timezone
  });

  if (slots.length === 0) {
    // Stay in RESCHEDULE_DATE, not RESCHEDULE_TIME — same reasoning as
    // offerSlotsForDate above: the message asks for another date, but
    // RESCHEDULE_TIME's handler expects a slot number, not a date.
    await saveSession(ctx.supabase, ctx.phone, { state: "RESCHEDULE_DATE" });
    await replyMenu(
      ctx,
      `Sorry, there are no available slots on ${dateString}.\n\nPlease choose another date:`,
      getDateMenuSpec()
    );
    return true;
  }

  await saveSession(ctx.supabase, ctx.phone, {
    state: "RESCHEDULE_TIME",
    session_date: dateString
  });

  await replyMenu(
    ctx,
    "Available slots:\nPlease choose a new time.",
    getSlotSelectionMenuSpec(slots, ctx.timezone)
  );

  return true;
}

/** Resolves each appointment's doctor_id -> doctor name once per unique doctor, not once per appointment. */
async function toAppointmentListItems(
  ctx: FlowContext,
  appointments: Appointment[]
): Promise<AppointmentListItem[]> {
  const uniqueDoctorIds = [...new Set(appointments.map((a) => a.doctor_id))];
  const doctors = await Promise.all(uniqueDoctorIds.map((id) => getDoctorById(ctx.supabase, id)));

  const nameById = new Map<string, string>();
  for (const doctor of doctors) {
    if (doctor) {
      nameById.set(doctor.id, doctor.name);
    }
  }

  return appointments.map((appointment) => ({
    appointmentId: appointment.id,
    doctorName: nameById.get(appointment.doctor_id) ?? "Doctor",
    date: appointment.appointment_date,
    time: formatTimeLabel(
      combineDateAndTime(appointment.appointment_date, appointment.appointment_time, ctx.timezone),
      ctx.timezone
    )
  }));
}

/**
 * Entry point for My Appointments / Cancel / Reschedule from the main
 * menu or the More menu — fetches the patient's confirmed appointments,
 * bails to the main menu with a friendly message if there are none, or
 * saves the target state (with pagination reset to page 0) and sends
 * page 1 of the list.
 */
async function startAppointmentListFlow(
  ctx: FlowContext,
  state: string,
  bodyText: string,
  emptyMessage: string
): Promise<boolean> {
  const appointments = await getConfirmedAppointmentsForPhone(ctx.supabase, ctx.phone);

  if (appointments.length === 0) {
    return returnToMainMenuWithMessage(ctx, emptyMessage);
  }

  await saveSession(ctx.supabase, ctx.phone, { state, appointment_page: 0 });

  const items = await toAppointmentListItems(ctx, appointments);
  await replyMenu(ctx, bodyText, getAppointmentListMenuSpec(items, 0));
  return true;
}

/**
 * Entry point for "Home Sample Collection" from the More menu — ports
 * beginWhatsAppHomeCollectionFlow in src/Controller_HomeCollection.gs.
 * Bails immediately (before asking for a location at all) if the
 * hospital doesn't offer it at all (ENABLE_HOME_COLLECTION) or hasn't
 * configured HOSPITAL_LATITUDE/LONGITUDE yet, same as the original.
 * The ENABLE_HOME_COLLECTION check here is defense in depth — the menu
 * shouldn't offer this option at all when disabled (see sendMoreMenu),
 * but a stale cached menu or a typed "4" could still reach this
 * function directly.
 */
async function startHomeCollectionFlow(ctx: FlowContext): Promise<boolean> {
  const homeCollectionEnabled = await getBooleanSetting(
    ctx.supabase,
    "ENABLE_HOME_COLLECTION",
    true
  );

  if (!homeCollectionEnabled) {
    return returnToMainMenuWithMessage(
      ctx,
      "Home sample collection isn't offered by this clinic."
    );
  }

  const hospital = await getHospitalLocation(ctx.supabase);

  if (!hospital) {
    return returnToMainMenuWithMessage(
      ctx,
      "Home sample collection isn't set up yet. Please call the clinic directly."
    );
  }

  const radiusKm = await getHomeCollectionRadiusKm(ctx.supabase);

  await saveSession(ctx.supabase, ctx.phone, {
    state: "HOME_COLLECTION_LOCATION",
    doctor_id: null,
    session_date: "",
    session_time: "",
    appointment_id: null,
    location: ""
  });

  await reply(
    ctx,
    `Home Sample Collection\n\nPlease share your location (tap the attachment icon -> Location in WhatsApp) so we can confirm you're within ${radiusKm} km of {{CLINIC_NAME}}.`
  );
  return true;
}

async function returnToMainMenuWithMessage(ctx: FlowContext, message: string): Promise<boolean> {
  await saveSession(ctx.supabase, ctx.phone, { state: "MAIN_MENU" });
  await replyMenu(ctx, message, getMainMenuSpec());
  return true;
}

/** Sends the "More" menu, with the Home Sample Collection option present or absent per ENABLE_HOME_COLLECTION — the single place that decides whether patients see it at all. */
async function sendMoreMenu(ctx: FlowContext, bodyText: string): Promise<void> {
  const homeCollectionEnabled = await getBooleanSetting(
    ctx.supabase,
    "ENABLE_HOME_COLLECTION",
    true
  );

  await replyMenu(ctx, bodyText, getPatientMoreMenuSpec(homeCollectionEnabled));
}

/**
 * Reacts to a tap/typed choice against an already-sent appointment list
 * (My Appointments / Cancel / Reschedule all share this — see
 * lib/whatsapp/menus.ts's getAppointmentListMenuSpec) — pagination,
 * "main menu", or a selection, which invokes `onChosen` with both the
 * display-ready item and the underlying appointment row.
 */
async function handleAppointmentListChoice(
  ctx: FlowContext,
  session: WhatsAppSession,
  normalizedMessage: string,
  bodyText: string,
  onChosen: (item: AppointmentListItem, appointment: Appointment) => Promise<boolean>
): Promise<boolean> {
  const appointments = await getConfirmedAppointmentsForPhone(ctx.supabase, ctx.phone);

  if (appointments.length === 0) {
    return returnToMainMenuWithMessage(ctx, "You have no active appointments.");
  }

  const items = await toAppointmentListItems(ctx, appointments);
  const page = Number(session.appointment_page) || 0;
  const choice = classifyAppointmentListChoice(normalizedMessage, items.length);

  if (choice.type === "main_menu") {
    return returnToMainMenu(ctx);
  }

  if (choice.type === "prev" || choice.type === "next") {
    const nextPage = choice.type === "prev" ? Math.max(page - 1, 0) : page + 1;
    await saveSession(ctx.supabase, ctx.phone, { appointment_page: nextPage });
    await replyMenu(ctx, bodyText, getAppointmentListMenuSpec(items, nextPage));
    return true;
  }

  if (choice.type === "select") {
    await saveSession(ctx.supabase, ctx.phone, { appointment_page: 0 });
    return onChosen(items[choice.index]!, appointments[choice.index]!);
  }

  await replyMenu(ctx, "Invalid option.", getAppointmentListMenuSpec(items, page));
  return true;
}
