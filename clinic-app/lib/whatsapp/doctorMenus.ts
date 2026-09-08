import type { MenuReply, MenuRow } from "./send";
import type { Weekday } from "@/lib/supabase/database.types";
import type { DoctorAvailability, DoctorLeave } from "@/lib/doctors";
import type { Appointment } from "@/lib/appointments";
import { combineDateAndTime, formatTimeLabel } from "@/lib/scheduling/dates";
import {
  APPOINTMENT_LIST_PAGE_SIZE,
  buildInteractiveButtonSpec,
  buildInteractiveListSpec,
  paginateAppointmentList
} from "./menus";

/**
 * Menu builders for the WhatsApp Doctor Portal (lib/whatsapp/doctorFlow.ts)
 * — the doctor-facing counterpart to lib/whatsapp/menus.ts, kept in its
 * own file since none of these are ever shown to a patient. Reuses
 * paginateAppointmentList/buildInteractiveListSpec/buildInteractiveButtonSpec
 * from menus.ts rather than re-implementing pagination or WhatsApp's
 * list/button row-count limits a second time.
 */

export const WEEKDAYS: Weekday[] = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday"
];

export function getDoctorMainMenuSpec(): MenuReply {
  return {
    fallbackText:
      "1️⃣ Today's Schedule\n2️⃣ Manage Appointments\n3️⃣ Manage Availability\n4️⃣ Manage Leaves",
    interactive: buildInteractiveListSpec(
      [
        { id: "today_schedule", title: "Today's Schedule" },
        { id: "manage_appointments", title: "Manage Appointments" },
        { id: "manage_availability", title: "Manage Availability" },
        { id: "manage_leaves", title: "Manage Leaves" }
      ],
      "Select option"
    )
  };
}

export interface DoctorAppointmentListItem {
  appointmentId: string;
  patientName: string;
  date: string;
  time: string;
}

/** Paginated picker over the doctor's own confirmed appointments, patient-name-first (mirrors getAppointmentListMenuSpec in menus.ts, doctor-facing field names). */
export function getDoctorAppointmentListMenuSpec(
  appointments: DoctorAppointmentListItem[],
  page: number
): MenuReply {
  const { pageItems, hasPrev, hasNext } = paginateAppointmentList(appointments, page);
  const offset = page * APPOINTMENT_LIST_PAGE_SIZE;

  const rows: MenuRow[] = pageItems.map((item, i) => ({
    id: `appt_${offset + i}`,
    title: item.patientName || "Patient",
    description: `${item.date} at ${item.time}`
  }));

  if (hasPrev) {
    rows.push({ id: "appt_prev", title: "⬅️ Previous" });
  }

  if (hasNext) {
    rows.push({ id: "appt_next", title: "➡️ Next" });
  }

  rows.push({ id: "nav_main_menu", title: "Main Menu" });

  const fallbackLines = pageItems.map(
    (item, i) => `${offset + i + 1}. ${item.patientName} — ${item.date} at ${item.time}`
  );

  return {
    fallbackText:
      fallbackLines.join("\n") +
      "\n\nReply with the appointment number" +
      (hasPrev ? ", 'prev'" : "") +
      (hasNext ? ", 'next'" : "") +
      ", or 0 for the main menu.",
    interactive: buildInteractiveListSpec(rows, "Select")
  };
}

export function buildDoctorAppointmentDetailMessage(item: DoctorAppointmentListItem): string {
  return `👤 ${item.patientName}\n📅 ${item.date}\n🕐 ${item.time}`;
}

export function getDoctorAppointmentActionSpec(): MenuReply {
  return {
    fallbackText: "1️⃣ Mark Completed\n2️⃣ Mark No-Show\n3️⃣ Cancel\n4️⃣ Reschedule\n0️⃣ Main Menu",
    interactive: buildInteractiveListSpec(
      [
        { id: "mark_completed", title: "Mark Completed" },
        { id: "mark_no_show", title: "Mark No-Show" },
        { id: "cancel_appointment", title: "Cancel Appointment" },
        { id: "reschedule_appointment", title: "Reschedule" },
        { id: "nav_main_menu", title: "Main Menu" }
      ],
      "Select action"
    )
  };
}

export function getDoctorAvailabilityMenuSpec(availability: DoctorAvailability[]): MenuReply {
  const summary =
    availability.length === 0
      ? "No weekly availability sessions set yet."
      : WEEKDAYS.filter((day) => availability.some((row) => row.day_of_week === day))
          .map((day) => {
            const sessions = availability
              .filter((row) => row.day_of_week === day)
              .map((row) => `${row.start_time}–${row.end_time}`)
              .join(", ");
            return `${day}: ${sessions}`;
          })
          .join("\n");

  return {
    fallbackText: `${summary}\n\n1️⃣ Add Session\n2️⃣ Remove Session\n0️⃣ Main Menu`,
    interactive: buildInteractiveButtonSpec([
      { id: "add_session", title: "Add Session" },
      { id: "remove_session", title: "Remove Session" },
      { id: "nav_main_menu", title: "Main Menu" }
    ])
  };
}

export function getWeekdaySelectionMenuSpec(): MenuReply {
  return {
    fallbackText: WEEKDAYS.map((day, i) => `${i + 1}. ${day}`).join("\n"),
    interactive: buildInteractiveListSpec(
      WEEKDAYS.map((day) => ({ id: `day_${day}`, title: day })),
      "Select day"
    )
  };
}

export function parseWeekdaySelection(input: string): Weekday | null {
  const normalized = input.trim();

  if (normalized.startsWith("day_")) {
    const day = normalized.slice("day_".length) as Weekday;
    return WEEKDAYS.includes(day) ? day : null;
  }

  const index = Number(normalized);
  if (Number.isInteger(index) && index >= 1 && index <= WEEKDAYS.length) {
    return WEEKDAYS[index - 1]!;
  }

  return null;
}

/** One row per existing availability session, for the "Remove Session" picker — ids carry the session's own DB id directly (no pagination-index indirection needed, since removal targets the row id anyway). */
export function getAvailabilitySessionRemovalMenuSpec(
  availability: DoctorAvailability[]
): MenuReply {
  const rows: MenuRow[] = availability.map((row) => ({
    id: `session_${row.id}`,
    title: row.day_of_week,
    description: `${row.start_time}–${row.end_time}`
  }));

  rows.push({ id: "nav_main_menu", title: "Main Menu" });

  return {
    fallbackText:
      availability
        .map((row, i) => `${i + 1}. ${row.day_of_week}: ${row.start_time}–${row.end_time}`)
        .join("\n") + "\n\nReply with the number, or 0 for the main menu.",
    interactive: buildInteractiveListSpec(rows, "Select")
  };
}

export function parseAvailabilitySessionSelection(
  input: string,
  availability: DoctorAvailability[]
): DoctorAvailability | null {
  const normalized = input.trim();

  if (normalized.startsWith("session_")) {
    const id = normalized.slice("session_".length);
    return availability.find((row) => row.id === id) ?? null;
  }

  const index = Number(normalized);
  if (Number.isInteger(index) && index >= 1 && index <= availability.length) {
    return availability[index - 1]!;
  }

  return null;
}

/** 4 options doesn't fit the 3-button cap, so this is a list, unlike getDoctorAvailabilityMenuSpec's equivalent. */
export function getDoctorLeaveMenuSpec(upcomingLeaves: DoctorLeave[]): MenuReply {
  const summary =
    upcomingLeaves.length === 0
      ? "No upcoming leave dates."
      : upcomingLeaves.map((leave) => `${leave.leave_date}${leave.reason ? ` (${leave.reason})` : ""}`).join("\n");

  return {
    fallbackText: `${summary}\n\n1️⃣ Add Leave (single day)\n2️⃣ Add Leave (date range)\n3️⃣ Cancel a Leave\n0️⃣ Main Menu`,
    interactive: buildInteractiveListSpec(
      [
        { id: "add_leave_single", title: "Add Leave (Single Day)" },
        { id: "add_leave_range", title: "Add Leave (Date Range)" },
        { id: "cancel_leave", title: "Cancel a Leave" },
        { id: "nav_main_menu", title: "Main Menu" }
      ],
      "Select option"
    )
  };
}

export function getLeaveCancelMenuSpec(upcomingLeaves: DoctorLeave[]): MenuReply {
  const rows: MenuRow[] = upcomingLeaves.map((leave) => ({
    id: `leave_${leave.id}`,
    title: leave.leave_date,
    description: leave.reason || undefined
  }));

  rows.push({ id: "nav_main_menu", title: "Main Menu" });

  return {
    fallbackText:
      upcomingLeaves.map((leave, i) => `${i + 1}. ${leave.leave_date}`).join("\n") +
      "\n\nReply with the number, or 0 for the main menu.",
    interactive: buildInteractiveListSpec(rows, "Select")
  };
}

export function parseLeaveSelection(input: string, upcomingLeaves: DoctorLeave[]): DoctorLeave | null {
  const normalized = input.trim();

  if (normalized.startsWith("leave_")) {
    const id = normalized.slice("leave_".length);
    return upcomingLeaves.find((leave) => leave.id === id) ?? null;
  }

  const index = Number(normalized);
  if (Number.isInteger(index) && index >= 1 && index <= upcomingLeaves.length) {
    return upcomingLeaves[index - 1]!;
  }

  return null;
}

export function formatAppointmentTime(appointment: Appointment, timezone: string): string {
  const dateTime = combineDateAndTime(appointment.appointment_date, appointment.appointment_time, timezone);
  return formatTimeLabel(dateTime, timezone);
}
