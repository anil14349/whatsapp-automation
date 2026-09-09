import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { CalendarPort } from "@/lib/calendar/types";
import { getDoctorById, listDoctors } from "@/lib/doctors";
import { getAvailableSlotsForDoctor } from "@/lib/scheduling/slots";
import { bookAppointment } from "@/lib/appointments";
import { isValidPatientName } from "@/lib/patients";
import { formatDateKey, formatTimeLabel, isValidISODate } from "@/lib/scheduling/dates";
import { getSession, saveSession } from "@/lib/sessions";

/**
 * Screen-by-screen logic for the "Book Appointment" WhatsApp Flow —
 * the Flow-endpoint equivalent of lib/whatsapp/patientFlow.ts's
 * BOOK_DOCTOR -> BOOK_DATE -> BOOK_TIME -> BOOK_NAME -> BOOK_CONFIRM
 * states, driven by native form screens instead of list/button taps.
 *
 * Reuses the same `whatsapp_sessions` row (keyed by phone, via
 * lib/sessions.ts) as scratch storage between screens rather than
 * threading state through the Flow's own `data` payloads — the Flow
 * JSON only needs to carry what each individual screen collects, and
 * this endpoint already has the exact same doctor_id/session_date/
 * session_time columns the button-based flow uses. See
 * clinic-app/whatsapp-flows/booking-flow.json for the screen definitions
 * these functions correspond to.
 */

export interface FlowRequestContext {
  supabase: SupabaseClient<Database>;
  calendar: CalendarPort;
  timezone: string;
  /** Set when triggering the flow: the patient's normalized WhatsApp number. */
  phone: string;
}

export type FlowScreenResponse =
  | { screen: string; data: Record<string, unknown> }
  | { terminal: true; data: Record<string, unknown> };

const SCREEN_SELECT_DOCTOR = "SELECT_DOCTOR";
const SCREEN_SELECT_DATE = "SELECT_DATE";
const SCREEN_SELECT_TIME = "SELECT_TIME";
const SCREEN_CONFIRM = "CONFIRM";

/** Handles the Flow's "INIT" action — always starts at the doctor list. */
export async function handleFlowInit(ctx: FlowRequestContext): Promise<FlowScreenResponse> {
  await saveSession(ctx.supabase, ctx.phone, {
    role: "PATIENT",
    state: "BOOK_VIA_FLOW",
    doctor_id: null,
    session_date: "",
    session_time: ""
  });

  return selectDoctorScreen(ctx);
}

/** Dispatches a "data_exchange" action by which screen the user just submitted. */
export async function handleFlowDataExchange(
  ctx: FlowRequestContext,
  screen: string,
  data: Record<string, unknown>
): Promise<FlowScreenResponse> {
  switch (screen) {
    case SCREEN_SELECT_DOCTOR:
      return handleSelectDoctor(ctx, data);
    case SCREEN_SELECT_DATE:
      return handleSelectDate(ctx, data);
    case SCREEN_SELECT_TIME:
      return handleSelectTime(ctx, data);
    case SCREEN_CONFIRM:
      return handleConfirm(ctx, data);
    default:
      throw new Error(`Unknown flow screen: ${screen}`);
  }
}

async function selectDoctorScreen(ctx: FlowRequestContext): Promise<FlowScreenResponse> {
  const doctors = await listDoctors(ctx.supabase, { activeOnly: true });

  return {
    screen: SCREEN_SELECT_DOCTOR,
    data: {
      doctors: doctors.map((doctor) => ({
        id: doctor.id,
        title: doctor.name,
        description: doctor.specialization || doctor.clinic_name || ""
      }))
    }
  };
}

async function handleSelectDoctor(
  ctx: FlowRequestContext,
  data: Record<string, unknown>
): Promise<FlowScreenResponse> {
  const doctorId = String(data.doctor_id ?? "");
  const doctor = doctorId ? await getDoctorById(ctx.supabase, doctorId) : null;

  if (!doctor) {
    const retry = await selectDoctorScreen(ctx);
    return { ...retry, data: { ...retry.data, error_message: "Please select a doctor." } };
  }

  await saveSession(ctx.supabase, ctx.phone, { doctor_id: doctor.id, state: "BOOK_VIA_FLOW" });

  const today = formatDateKey(new Date(), ctx.timezone);

  return {
    screen: SCREEN_SELECT_DATE,
    data: { doctor_name: doctor.name, minimum_date: today }
  };
}

async function handleSelectDate(
  ctx: FlowRequestContext,
  data: Record<string, unknown>
): Promise<FlowScreenResponse> {
  const session = await getSession(ctx.supabase, ctx.phone);
  const dateString = String(data.appointment_date ?? "").trim();

  if (!session?.doctor_id) {
    return expiredScreen(ctx);
  }

  const today = formatDateKey(new Date(), ctx.timezone);

  if (!isValidISODate(dateString) || dateString < today) {
    return {
      screen: SCREEN_SELECT_DATE,
      data: {
        minimum_date: today,
        error_message: "Please choose a valid, future date."
      }
    };
  }

  const doctor = await getDoctorById(ctx.supabase, session.doctor_id);

  if (!doctor) {
    return expiredScreen(ctx);
  }

  const slots = await getAvailableSlotsForDoctor(ctx.supabase, ctx.calendar, {
    doctor,
    dateString,
    timezone: ctx.timezone
  });

  await saveSession(ctx.supabase, ctx.phone, { session_date: dateString });

  if (slots.length === 0) {
    return {
      screen: SCREEN_SELECT_DATE,
      data: {
        minimum_date: today,
        error_message: `No slots available on ${dateString} — please choose another date.`
      }
    };
  }

  return {
    screen: SCREEN_SELECT_TIME,
    data: {
      slots: slots.map((slot) => ({
        id: slot.toISOString(),
        title: formatTimeLabel(slot, ctx.timezone)
      }))
    }
  };
}

async function handleSelectTime(
  ctx: FlowRequestContext,
  data: Record<string, unknown>
): Promise<FlowScreenResponse> {
  const session = await getSession(ctx.supabase, ctx.phone);

  if (!session?.doctor_id || !session.session_date) {
    return expiredScreen(ctx);
  }

  const doctor = await getDoctorById(ctx.supabase, session.doctor_id);

  if (!doctor) {
    return expiredScreen(ctx);
  }

  const slots = await getAvailableSlotsForDoctor(ctx.supabase, ctx.calendar, {
    doctor,
    dateString: session.session_date,
    timezone: ctx.timezone
  });

  const selectedIso = String(data.time_slot ?? "");
  const selected = slots.find((slot) => slot.toISOString() === selectedIso);

  if (!selected) {
    return {
      screen: SCREEN_SELECT_TIME,
      data: {
        slots: slots.map((slot) => ({ id: slot.toISOString(), title: formatTimeLabel(slot, ctx.timezone) })),
        error_message: "Please choose one of the available times."
      }
    };
  }

  await saveSession(ctx.supabase, ctx.phone, {
    session_time: formatTimeLabel(selected, ctx.timezone)
  });

  return {
    screen: SCREEN_CONFIRM,
    data: {
      doctor_name: doctor.name,
      appointment_date: session.session_date,
      appointment_time: formatTimeLabel(selected, ctx.timezone)
    }
  };
}

async function handleConfirm(
  ctx: FlowRequestContext,
  data: Record<string, unknown>
): Promise<FlowScreenResponse> {
  const session = await getSession(ctx.supabase, ctx.phone);

  if (!session?.doctor_id || !session.session_date || !session.session_time) {
    return expiredScreen(ctx);
  }

  const patientName = String(data.patient_name ?? "").trim();

  if (!isValidPatientName(patientName)) {
    return {
      screen: SCREEN_CONFIRM,
      data: { error_message: "Please enter a valid full name (at least 2 characters)." }
    };
  }

  const result = await bookAppointment(ctx.supabase, ctx.calendar, {
    doctorId: session.doctor_id,
    dateString: session.session_date,
    timeString: session.session_time,
    patientName,
    patientPhone: ctx.phone,
    patientLanguage: session.language || "EN",
    timezone: ctx.timezone
  });

  if (!result.success || !result.appointment) {
    return {
      screen: SCREEN_CONFIRM,
      data: { error_message: result.message }
    };
  }

  await saveSession(ctx.supabase, ctx.phone, {
    state: "MAIN_MENU",
    doctor_id: null,
    session_date: "",
    session_time: "",
    appointment_id: result.appointment.id
  });

  return {
    terminal: true,
    data: {
      appointment_code: result.appointment.appointment_code,
      appointment_date: result.appointment.appointment_date,
      appointment_time: session.session_time
    }
  };
}

async function expiredScreen(ctx: FlowRequestContext): Promise<FlowScreenResponse> {
  const retry = await selectDoctorScreen(ctx);
  return {
    ...retry,
    data: { ...retry.data, error_message: "Your booking session expired — let's start again." }
  };
}
