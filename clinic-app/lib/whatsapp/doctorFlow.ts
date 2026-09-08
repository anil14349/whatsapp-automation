import type { FlowContext } from "./context";
import { reply, replyMenu } from "./context";
import { getSession, saveSession } from "@/lib/sessions";
import type { Doctor, DoctorAvailability } from "@/lib/doctors";
import {
  addDoctorAvailabilitySession,
  addDoctorLeave,
  addDoctorLeaveRange,
  deactivateDoctorLeave,
  getDoctorAvailability,
  getDoctorUpcomingLeaves,
  removeDoctorAvailabilitySession
} from "@/lib/doctors";
import {
  cancelAppointment,
  getDoctorConfirmedAppointments,
  markAppointmentStatus,
  normalizeTimeInput,
  rescheduleAppointment
} from "@/lib/appointments";
import { getAvailableSlotsForDoctor } from "@/lib/scheduling/slots";
import { formatDateKey, formatTimeLabel, isValidISODate } from "@/lib/scheduling/dates";
import { sendWhatsAppText } from "./send";
import { localizeWhatsAppReply } from "./localize";
import {
  buildDoctorAppointmentDetailMessage,
  getAvailabilitySessionRemovalMenuSpec,
  getDoctorAppointmentActionSpec,
  getDoctorAppointmentListMenuSpec,
  getDoctorAvailabilityMenuSpec,
  getDoctorLeaveMenuSpec,
  getDoctorMainMenuSpec,
  getLeaveCancelMenuSpec,
  getWeekdaySelectionMenuSpec,
  parseAvailabilitySessionSelection,
  parseLeaveSelection,
  parseWeekdaySelection,
  formatAppointmentTime,
  type DoctorAppointmentListItem
} from "./doctorMenus";
import {
  classifyAppointmentListChoice,
  getDateMenuSpec,
  getSlotSelectionMenuSpec,
  getYesNoConfirmSpec,
  parseSlotSelectionId,
  resolveTypedSlotSelection
} from "./menus";

/**
 * Doctor Portal conversation state machine. Ports src/Controller_DoctorFlow.gs
 * — condensed from that file's ~26 states to ~20 by using list menus (no
 * row-count pressure vs. WhatsApp's 3-button cap) instead of a tiered
 * "More" sub-menu. Single-date and date-range leave both work (Add Leave
 * (Single Day) / Add Leave (Date Range) in the leave menu). Same
 * underlying business logic throughout: cancelAppointment/
 * rescheduleAppointment/markAppointmentStatus with authorizedDoctorId,
 * exactly like the admin UI's appointment actions.
 */
export async function handleDoctorMessage(
  ctx: FlowContext,
  doctor: Doctor,
  messageText: string,
  normalizedMessage: string
): Promise<boolean> {
  const session = await getSession(ctx.supabase, ctx.phone);

  if (!session) {
    return false;
  }

  switch (session.state) {
    case "DOCTOR_MENU": {
      if (normalizedMessage === "today_schedule" || normalizedMessage === "1") {
        const today = formatDateKey(new Date(), ctx.timezone);
        const appointments = await getDoctorConfirmedAppointments(ctx.supabase, doctor.id, {
          fromDate: today,
          toDate: today
        });

        const summary =
          appointments.length === 0
            ? "No confirmed appointments today."
            : appointments
                .map((a) => `${formatAppointmentTime(a, ctx.timezone)} — ${a.patient_name}`)
                .join("\n");

        await replyMenu(ctx, `Today's schedule:\n\n${summary}`, getDoctorMainMenuSpec());
        return true;
      }

      if (normalizedMessage === "manage_appointments" || normalizedMessage === "2") {
        return startDoctorAppointmentList(ctx, doctor);
      }

      if (normalizedMessage === "manage_availability" || normalizedMessage === "3") {
        await saveSession(ctx.supabase, ctx.phone, { state: "DOCTOR_AVAIL_MENU" });
        const availability = await getDoctorAvailability(ctx.supabase, doctor.id);
        await replyMenu(ctx, "Weekly availability:", getDoctorAvailabilityMenuSpec(availability));
        return true;
      }

      if (normalizedMessage === "manage_leaves" || normalizedMessage === "4") {
        await saveSession(ctx.supabase, ctx.phone, { state: "DOCTOR_LEAVE_MENU" });
        const today = formatDateKey(new Date(), ctx.timezone);
        const leaves = await getDoctorUpcomingLeaves(ctx.supabase, doctor.id, today);
        await replyMenu(ctx, "Upcoming leave:", getDoctorLeaveMenuSpec(leaves));
        return true;
      }

      await replyMenu(ctx, "Invalid option.", getDoctorMainMenuSpec());
      return true;
    }

    // --------------------------------------------------------------
    // Manage Appointments: list -> action -> cancel/reschedule/status
    // --------------------------------------------------------------

    case "DOCTOR_APPT_LIST": {
      const appointments = await getDoctorConfirmedAppointments(ctx.supabase, doctor.id);

      if (appointments.length === 0) {
        return returnDoctorToMenu(ctx, "You have no confirmed appointments.");
      }

      const items = toDoctorAppointmentListItems(appointments, ctx.timezone);
      const page = Number(session.appointment_page) || 0;
      const choice = classifyAppointmentListChoice(normalizedMessage, items.length);

      if (choice.type === "main_menu") {
        return returnDoctorToMenu(ctx);
      }

      if (choice.type === "prev" || choice.type === "next") {
        const nextPage = choice.type === "prev" ? Math.max(page - 1, 0) : page + 1;
        await saveSession(ctx.supabase, ctx.phone, { appointment_page: nextPage });
        await replyMenu(ctx, "Manage appointments:", getDoctorAppointmentListMenuSpec(items, nextPage));
        return true;
      }

      if (choice.type === "select") {
        const chosenItem = items[choice.index]!;
        const chosenAppointment = appointments[choice.index]!;

        await saveSession(ctx.supabase, ctx.phone, {
          state: "DOCTOR_APPT_ACTION",
          appointment_page: 0,
          session_date: chosenAppointment.appointment_date,
          session_time: chosenAppointment.appointment_time,
          appointment_id: chosenAppointment.id
        });

        await replyMenu(
          ctx,
          buildDoctorAppointmentDetailMessage(chosenItem),
          getDoctorAppointmentActionSpec()
        );
        return true;
      }

      await replyMenu(ctx, "Invalid option.", getDoctorAppointmentListMenuSpec(items, page));
      return true;
    }

    case "DOCTOR_APPT_ACTION": {
      if (!session.appointment_id) {
        return returnDoctorToMenu(ctx);
      }

      if (normalizedMessage === "mark_completed" || normalizedMessage === "1") {
        return finishStatusUpdate(ctx, doctor, session.appointment_id, "Completed");
      }

      if (normalizedMessage === "mark_no_show" || normalizedMessage === "2") {
        return finishStatusUpdate(ctx, doctor, session.appointment_id, "No-Show");
      }

      if (normalizedMessage === "cancel_appointment" || normalizedMessage === "3") {
        await saveSession(ctx.supabase, ctx.phone, { state: "DOCTOR_CANCEL_CONFIRM" });
        await replyMenu(ctx, "Cancel this patient's appointment?", getYesNoConfirmSpec());
        return true;
      }

      if (normalizedMessage === "reschedule_appointment" || normalizedMessage === "4") {
        await saveSession(ctx.supabase, ctx.phone, { state: "DOCTOR_RESCHEDULE_DATE" });
        await replyMenu(ctx, "Choose a new date:", getDateMenuSpec());
        return true;
      }

      if (normalizedMessage === "nav_main_menu" || normalizedMessage === "0") {
        return returnDoctorToMenu(ctx);
      }

      await replyMenu(ctx, "Invalid option.", getDoctorAppointmentActionSpec());
      return true;
    }

    case "DOCTOR_CANCEL_CONFIRM": {
      if (!session.appointment_id) {
        return returnDoctorToMenu(ctx);
      }

      if (normalizedMessage === "1" || normalizedMessage === "confirm_yes") {
        const result = await cancelAppointment(ctx.supabase, ctx.calendar, session.appointment_id, {
          authorizedDoctorId: doctor.id
        });

        if (result.success && result.appointment) {
          await notifyPatient(
            ctx,
            result.appointment.patient_phone,
            `${ctx.clinicName}: Your appointment on ${result.appointment.appointment_date} at ${session.session_time} has been cancelled by the clinic.\n\nReply Hi to book again.`
          );
        }

        return returnDoctorToMenu(
          ctx,
          result.success ? `Appointment cancelled.\n\n${result.message}` : `Unable to cancel: ${result.message}`
        );
      }

      if (normalizedMessage === "2" || normalizedMessage === "confirm_no") {
        return returnDoctorToMenu(ctx, "Okay, appointment was not cancelled.");
      }

      await replyMenu(ctx, "Invalid option.", getYesNoConfirmSpec());
      return true;
    }

    case "DOCTOR_RESCHEDULE_DATE": {
      if (!session.appointment_id) {
        return returnDoctorToMenu(ctx);
      }

      const quickDate = resolveQuickDateChoice(normalizedMessage, ctx.timezone);

      if (quickDate) {
        return offerDoctorRescheduleSlots(ctx, doctor, quickDate);
      }

      if (normalizedMessage === "3") {
        await saveSession(ctx.supabase, ctx.phone, { state: "DOCTOR_RESCHEDULE_DATE_CUSTOM" });
        await reply(ctx, "Please enter the date in YYYY-MM-DD format.");
        return true;
      }

      await replyMenu(ctx, "Invalid option.", getDateMenuSpec());
      return true;
    }

    case "DOCTOR_RESCHEDULE_DATE_CUSTOM": {
      if (!session.appointment_id) {
        return returnDoctorToMenu(ctx);
      }

      const typed = messageText.trim();

      if (!isValidISODate(typed) || typed < formatDateKey(new Date(), ctx.timezone)) {
        await reply(
          ctx,
          "That doesn't look like a valid future date.\n\nPlease enter the date in YYYY-MM-DD format."
        );
        return true;
      }

      return offerDoctorRescheduleSlots(ctx, doctor, typed);
    }

    case "DOCTOR_RESCHEDULE_TIME": {
      if (!session.appointment_id || !session.session_date) {
        return returnDoctorToMenu(ctx);
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
        state: "DOCTOR_RESCHEDULE_CONFIRM"
      });

      await replyMenu(
        ctx,
        `New date: ${session.session_date}\nNew time: ${formatTimeLabel(selected, ctx.timezone)}\n\nConfirm reschedule?`,
        getYesNoConfirmSpec()
      );
      return true;
    }

    case "DOCTOR_RESCHEDULE_CONFIRM": {
      if (!session.appointment_id || !session.session_date || !session.session_time) {
        return returnDoctorToMenu(ctx);
      }

      if (normalizedMessage === "1" || normalizedMessage === "confirm_yes") {
        const result = await rescheduleAppointment(ctx.supabase, ctx.calendar, {
          appointmentId: session.appointment_id,
          newDateString: session.session_date,
          newTimeString: session.session_time,
          timezone: ctx.timezone,
          authorizedDoctorId: doctor.id
        });

        if (!result.success || !result.appointment) {
          await reply(ctx, `${result.message}\n\nPlease choose another time or send Hi to start again.`);
          return true;
        }

        await notifyPatient(
          ctx,
          result.appointment.patient_phone,
          `${ctx.clinicName}: Your appointment has been rescheduled by the clinic.\n\nDate: ${result.appointment.appointment_date}\nTime: ${session.session_time}\n\nReply Hi if you need to make changes.`
        );

        return returnDoctorToMenu(ctx, "Appointment rescheduled.");
      }

      if (normalizedMessage === "2" || normalizedMessage === "confirm_no") {
        return returnDoctorToMenu(ctx, "Okay, appointment was not changed.");
      }

      await replyMenu(ctx, "Invalid option.", getYesNoConfirmSpec());
      return true;
    }

    // --------------------------------------------------------------
    // Manage Availability
    // --------------------------------------------------------------

    case "DOCTOR_AVAIL_MENU": {
      if (normalizedMessage === "add_session" || normalizedMessage === "1") {
        await saveSession(ctx.supabase, ctx.phone, { state: "DOCTOR_AVAIL_DAY" });
        await replyMenu(ctx, "Which day?", getWeekdaySelectionMenuSpec());
        return true;
      }

      if (normalizedMessage === "remove_session" || normalizedMessage === "2") {
        const availability = await getDoctorAvailability(ctx.supabase, doctor.id);

        if (availability.length === 0) {
          return returnDoctorToMenu(ctx, "No sessions to remove.");
        }

        await saveSession(ctx.supabase, ctx.phone, { state: "DOCTOR_AVAIL_REMOVE" });
        await replyMenu(ctx, "Select a session to remove:", getAvailabilitySessionRemovalMenuSpec(availability));
        return true;
      }

      if (normalizedMessage === "nav_main_menu" || normalizedMessage === "0") {
        return returnDoctorToMenu(ctx);
      }

      const availability = await getDoctorAvailability(ctx.supabase, doctor.id);
      await replyMenu(ctx, "Invalid option.", getDoctorAvailabilityMenuSpec(availability));
      return true;
    }

    case "DOCTOR_AVAIL_DAY": {
      const day = parseWeekdaySelection(normalizedMessage);

      if (!day) {
        await replyMenu(ctx, "Invalid option.", getWeekdaySelectionMenuSpec());
        return true;
      }

      await saveSession(ctx.supabase, ctx.phone, { state: "DOCTOR_AVAIL_START", session_date: day });
      await reply(ctx, `${day} — please enter the start time (e.g. 09:00 or 9:00 AM).`);
      return true;
    }

    case "DOCTOR_AVAIL_START": {
      const startTime = normalizeTimeInput(messageText);

      if (!startTime) {
        await reply(ctx, "That doesn't look like a valid time. Please enter e.g. 09:00 or 9:00 AM.");
        return true;
      }

      await saveSession(ctx.supabase, ctx.phone, { state: "DOCTOR_AVAIL_END", session_time: startTime });
      await reply(ctx, "Please enter the end time (e.g. 13:00 or 1:00 PM).");
      return true;
    }

    case "DOCTOR_AVAIL_END": {
      if (!session.session_date || !session.session_time) {
        return returnDoctorToMenu(ctx);
      }

      const endTime = normalizeTimeInput(messageText);

      if (!endTime || endTime <= session.session_time) {
        await reply(
          ctx,
          "That doesn't look like a valid end time (must be after the start time). Please enter e.g. 13:00 or 1:00 PM."
        );
        return true;
      }

      try {
        await addDoctorAvailabilitySession(
          ctx.supabase,
          doctor.id,
          session.session_date as DoctorAvailability["day_of_week"],
          session.session_time,
          endTime
        );

        return returnDoctorToMenu(ctx, `Added ${session.session_date} ${session.session_time}–${endTime}.`);
      } catch (error) {
        return returnDoctorToMenu(
          ctx,
          `Could not add session: ${error instanceof Error ? error.message : "unknown error"}`
        );
      }
    }

    case "DOCTOR_AVAIL_REMOVE": {
      const availability = await getDoctorAvailability(ctx.supabase, doctor.id);

      if (normalizedMessage === "nav_main_menu" || normalizedMessage === "0") {
        return returnDoctorToMenu(ctx);
      }

      const selected = parseAvailabilitySessionSelection(normalizedMessage, availability);

      if (!selected) {
        await replyMenu(ctx, "Invalid option.", getAvailabilitySessionRemovalMenuSpec(availability));
        return true;
      }

      await removeDoctorAvailabilitySession(ctx.supabase, selected.id);
      return returnDoctorToMenu(ctx, `Removed ${selected.day_of_week} ${selected.start_time}–${selected.end_time}.`);
    }

    // --------------------------------------------------------------
    // Manage Leaves (single-date only — see file doc comment)
    // --------------------------------------------------------------

    case "DOCTOR_LEAVE_MENU": {
      if (normalizedMessage === "add_leave_single" || normalizedMessage === "1") {
        await saveSession(ctx.supabase, ctx.phone, { state: "DOCTOR_LEAVE_DATE" });
        await reply(ctx, "Please enter the leave date in YYYY-MM-DD format.");
        return true;
      }

      if (normalizedMessage === "add_leave_range" || normalizedMessage === "2") {
        await saveSession(ctx.supabase, ctx.phone, { state: "DOCTOR_LEAVE_RANGE_START" });
        await reply(ctx, "Please enter the first day of leave in YYYY-MM-DD format.");
        return true;
      }

      if (normalizedMessage === "cancel_leave" || normalizedMessage === "3") {
        const today = formatDateKey(new Date(), ctx.timezone);
        const leaves = await getDoctorUpcomingLeaves(ctx.supabase, doctor.id, today);

        if (leaves.length === 0) {
          return returnDoctorToMenu(ctx, "No upcoming leave to cancel.");
        }

        await saveSession(ctx.supabase, ctx.phone, { state: "DOCTOR_LEAVE_CANCEL_PICK" });
        await replyMenu(ctx, "Select a leave date to cancel:", getLeaveCancelMenuSpec(leaves));
        return true;
      }

      if (normalizedMessage === "nav_main_menu" || normalizedMessage === "0") {
        return returnDoctorToMenu(ctx);
      }

      const today = formatDateKey(new Date(), ctx.timezone);
      const leaves = await getDoctorUpcomingLeaves(ctx.supabase, doctor.id, today);
      await replyMenu(ctx, "Invalid option.", getDoctorLeaveMenuSpec(leaves));
      return true;
    }

    case "DOCTOR_LEAVE_DATE": {
      const typed = messageText.trim();
      const today = formatDateKey(new Date(), ctx.timezone);

      if (!isValidISODate(typed) || typed < today) {
        await reply(ctx, "That doesn't look like a valid future date. Please enter YYYY-MM-DD.");
        return true;
      }

      await saveSession(ctx.supabase, ctx.phone, { state: "DOCTOR_LEAVE_REASON", session_date: typed });
      await reply(ctx, "Reason (optional) — reply with a reason, or send 'skip'.");
      return true;
    }

    case "DOCTOR_LEAVE_REASON": {
      if (!session.session_date) {
        return returnDoctorToMenu(ctx);
      }

      const reason = normalizedMessage === "skip" ? "" : messageText.trim();
      await addDoctorLeave(ctx.supabase, doctor.id, session.session_date, reason);
      return returnDoctorToMenu(ctx, `Leave added for ${session.session_date}.`);
    }

    // Date-range leave — start/end/reason use the same session_date/
    // session_time repurposing the availability states above already
    // do (scratch fields, not literally "a date" and "a time" here).
    case "DOCTOR_LEAVE_RANGE_START": {
      const typed = messageText.trim();
      const today = formatDateKey(new Date(), ctx.timezone);

      if (!isValidISODate(typed) || typed < today) {
        await reply(ctx, "That doesn't look like a valid future date. Please enter YYYY-MM-DD.");
        return true;
      }

      await saveSession(ctx.supabase, ctx.phone, { state: "DOCTOR_LEAVE_RANGE_END", session_date: typed });
      await reply(ctx, "Please enter the last day of leave in YYYY-MM-DD format.");
      return true;
    }

    case "DOCTOR_LEAVE_RANGE_END": {
      if (!session.session_date) {
        return returnDoctorToMenu(ctx);
      }

      const typed = messageText.trim();

      if (!isValidISODate(typed) || typed < session.session_date) {
        await reply(
          ctx,
          "That doesn't look like a valid date (must be on or after the first day). Please enter YYYY-MM-DD."
        );
        return true;
      }

      await saveSession(ctx.supabase, ctx.phone, {
        state: "DOCTOR_LEAVE_RANGE_REASON",
        session_time: typed
      });
      await reply(ctx, "Reason (optional) — reply with a reason, or send 'skip'.");
      return true;
    }

    case "DOCTOR_LEAVE_RANGE_REASON": {
      if (!session.session_date || !session.session_time) {
        return returnDoctorToMenu(ctx);
      }

      const reason = normalizedMessage === "skip" ? "" : messageText.trim();

      try {
        const result = await addDoctorLeaveRange(
          ctx.supabase,
          doctor.id,
          session.session_date,
          session.session_time,
          reason
        );

        return returnDoctorToMenu(
          ctx,
          `Leave added for ${session.session_date} through ${session.session_time} (${result.added} day${result.added === 1 ? "" : "s"}).`
        );
      } catch (error) {
        return returnDoctorToMenu(
          ctx,
          `Could not add leave range: ${error instanceof Error ? error.message : "unknown error"}`
        );
      }
    }

    case "DOCTOR_LEAVE_CANCEL_PICK": {
      const today = formatDateKey(new Date(), ctx.timezone);
      const leaves = await getDoctorUpcomingLeaves(ctx.supabase, doctor.id, today);

      if (normalizedMessage === "nav_main_menu" || normalizedMessage === "0") {
        return returnDoctorToMenu(ctx);
      }

      const selected = parseLeaveSelection(normalizedMessage, leaves);

      if (!selected) {
        await replyMenu(ctx, "Invalid option.", getLeaveCancelMenuSpec(leaves));
        return true;
      }

      await deactivateDoctorLeave(ctx.supabase, doctor.id, selected.leave_date);
      return returnDoctorToMenu(ctx, `Leave on ${selected.leave_date} cancelled.`);
    }

    default:
      return false;
  }
}

/** Entry point once a doctor is identified (see lib/whatsapp/router.ts) — greeting or an unrecognized state resets to the main menu. */
export async function sendDoctorMainMenu(ctx: FlowContext, doctor: Doctor): Promise<void> {
  await saveSession(ctx.supabase, ctx.phone, {
    role: "DOCTOR",
    state: "DOCTOR_MENU",
    doctor_id: doctor.id,
    appointment_id: null,
    session_date: "",
    session_time: "",
    appointment_page: 0
  });

  await replyMenu(ctx, `Welcome, ${doctor.name}.`, getDoctorMainMenuSpec());
}

async function returnDoctorToMenu(ctx: FlowContext, message?: string): Promise<boolean> {
  await saveSession(ctx.supabase, ctx.phone, {
    state: "DOCTOR_MENU",
    appointment_id: null,
    session_date: "",
    session_time: "",
    appointment_page: 0
  });

  await replyMenu(ctx, message ?? "Main menu:", getDoctorMainMenuSpec());
  return true;
}

async function startDoctorAppointmentList(ctx: FlowContext, doctor: Doctor): Promise<boolean> {
  const appointments = await getDoctorConfirmedAppointments(ctx.supabase, doctor.id);

  if (appointments.length === 0) {
    return returnDoctorToMenu(ctx, "You have no confirmed appointments.");
  }

  await saveSession(ctx.supabase, ctx.phone, { state: "DOCTOR_APPT_LIST", appointment_page: 0 });
  const items = toDoctorAppointmentListItems(appointments, ctx.timezone);
  await replyMenu(ctx, "Manage appointments:", getDoctorAppointmentListMenuSpec(items, 0));
  return true;
}

function toDoctorAppointmentListItems(
  appointments: Awaited<ReturnType<typeof getDoctorConfirmedAppointments>>,
  timezone: string
): DoctorAppointmentListItem[] {
  return appointments.map((appointment) => ({
    appointmentId: appointment.id,
    patientName: appointment.patient_name,
    date: appointment.appointment_date,
    time: formatAppointmentTime(appointment, timezone)
  }));
}

async function finishStatusUpdate(
  ctx: FlowContext,
  doctor: Doctor,
  appointmentId: string,
  status: "Completed" | "No-Show"
): Promise<boolean> {
  const result = await markAppointmentStatus(ctx.supabase, appointmentId, doctor.id, status);
  return returnDoctorToMenu(ctx, result.success ? result.message : `Could not update: ${result.message}`);
}

async function offerDoctorRescheduleSlots(
  ctx: FlowContext,
  doctor: Doctor,
  dateString: string
): Promise<boolean> {
  const slots = await getAvailableSlotsForDoctor(ctx.supabase, ctx.calendar, {
    doctor,
    dateString,
    timezone: ctx.timezone
  });

  await saveSession(ctx.supabase, ctx.phone, { state: "DOCTOR_RESCHEDULE_TIME", session_date: dateString });

  if (slots.length === 0) {
    await reply(ctx, `No available slots on ${dateString}. Please choose another date.`);
    return true;
  }

  await replyMenu(ctx, "Available slots:\nPlease choose a new time.", getSlotSelectionMenuSpec(slots, ctx.timezone));
  return true;
}

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

/** Best-effort patient notification for a doctor-initiated cancel/reschedule — localized to the patient's own saved session language, not the doctor's. Failures are swallowed (same as the Apps Script version's notifyPatientOfDoctorCancellation/Reschedule) since a failed courtesy notification shouldn't fail the doctor's action. */
async function notifyPatient(ctx: FlowContext, patientPhone: string, message: string): Promise<void> {
  try {
    const patientSession = await getSession(ctx.supabase, patientPhone);
    const language = patientSession?.language || "EN";
    await sendWhatsAppText(patientPhone, localizeWhatsAppReply(language, message, ctx.clinicName));
  } catch (error) {
    console.error("Failed to notify patient of doctor-initiated change.", error);
  }
}
