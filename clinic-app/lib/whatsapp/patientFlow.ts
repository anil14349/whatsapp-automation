import type { FlowContext } from "./context";
import { reply, replyMenu } from "./context";
import { getSession, saveSession } from "@/lib/sessions";
import { getDoctorById, listDoctors } from "@/lib/doctors";
import { getAvailableSlotsForDoctor } from "@/lib/scheduling/slots";
import { bookAppointment } from "@/lib/appointments";
import {
  isValidPatientName,
  patientNeedsNameCapture,
  registerPatientForBooking
} from "@/lib/patients";
import { formatDateKey, formatTimeLabel, isValidISODate } from "@/lib/scheduling/dates";
import {
  getDateMenuSpec,
  getDoctorSelectionMenuSpec,
  getLanguageMenuSpec,
  getMainMenuSpec,
  getSlotSelectionMenuSpec,
  getYesNoConfirmSpec,
  parseSlotSelectionId,
  resolveTypedSlotSelection
} from "./menus";

/**
 * Patient conversation state machine. Ports the booking path of
 * src/Controller_PatientFlow.gs (LANGUAGE_SELECT through BOOK_CONFIRM).
 *
 * NOT yet ported in this stage: My Appointments / cancel / reschedule
 * sub-flows, the "More" menu, doctor selection pagination (doctor_prev/
 * doctor_next — this version lists all doctors in one screen, capped at
 * WhatsApp's 10-row list limit), and the shareable appointment receipt
 * card. Each follows the same pattern established here; see
 * clinic-app/README.md for what's tracked as remaining.
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
  normalizedMessage: string
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

      await replyMenu(
        { ...ctx, language },
        "Welcome to {{CLINIC_NAME}}!\nPlease choose an option:",
        getMainMenuSpec()
      );

      return true;
    }

    case "MAIN_MENU": {
      if (normalizedMessage === "1") {
        await saveSession(ctx.supabase, ctx.phone, { state: "BOOK_DOCTOR" });
        return sendDoctorSelection(ctx);
      }

      if (normalizedMessage === "2") {
        await reply(
          ctx,
          "My Appointments isn't available in this build yet — check back soon."
        );
        return true;
      }

      await replyMenu(ctx, "Invalid option.", getMainMenuSpec());
      return true;
    }

    case "BOOK_DOCTOR": {
      const doctors = await listDoctors(ctx.supabase, { activeOnly: true });
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
        await replyMenu(ctx, "Please choose a valid doctor.", getDoctorSelectionMenuSpec(doctors));
        return true;
      }

      await saveSession(ctx.supabase, ctx.phone, {
        state: "BOOK_DATE",
        doctor_id: doctor.id
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

      let dateString: string | null = null;

      if (normalizedMessage === "1") {
        dateString = formatDateKey(new Date(), ctx.timezone);
      } else if (normalizedMessage === "2") {
        const tomorrow = new Date();
        tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
        dateString = formatDateKey(tomorrow, ctx.timezone);
      } else if (normalizedMessage === "3") {
        await saveSession(ctx.supabase, ctx.phone, { state: "BOOK_DATE_CUSTOM" });
        await reply(ctx, "Please enter the date in YYYY-MM-DD format.");
        return true;
      } else {
        await replyMenu(ctx, "Invalid option.", getDateMenuSpec());
        return true;
      }

      return offerSlotsForDate(ctx, session.doctor_id, dateString);
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
      const appointmentDateTime = new Date(
        `${result.appointment.appointment_date}T${result.appointment.appointment_time}`
      );

      await reply(
        ctx,
        "Appointment confirmed!\n\n" +
          `Doctor: ${doctor?.name ?? ""}\n` +
          `Date: ${result.appointment.appointment_date}\n` +
          `Time: ${formatTimeLabel(appointmentDateTime, ctx.timezone)}\n\n` +
          "Thank you for choosing {{CLINIC_NAME}}."
      );

      return true;
    }

    default:
      return false;
  }
}

async function sendDoctorSelection(ctx: FlowContext): Promise<boolean> {
  const doctors = await listDoctors(ctx.supabase, { activeOnly: true });
  await replyMenu(ctx, "Select a doctor:", getDoctorSelectionMenuSpec(doctors));
  return true;
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

  await saveSession(ctx.supabase, ctx.phone, {
    state: "BOOK_TIME",
    session_date: dateString
  });

  if (slots.length === 0) {
    await reply(
      ctx,
      `Sorry, there are no available slots on ${dateString}.\n\nPlease choose another date.`
    );
    return true;
  }

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
