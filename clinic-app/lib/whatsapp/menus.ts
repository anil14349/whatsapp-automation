import type { InteractiveMenuSpec, MenuReply, MenuRow } from "./send";
import type { Doctor } from "@/lib/doctors";
import { formatTimeLabel } from "@/lib/scheduling/dates";

/**
 * Interactive menu spec builders. Ports the relevant subset of
 * src/View_Menus.gs for the booking flow — not all ~20 menu builders in
 * that file (doctor-portal menus, appointment-list pickers, etc. land
 * as later flows are ported).
 */

export function truncateInteractiveLabel(text: string, maxLength: number): string {
  const value = text.trim();

  if (value.length <= maxLength) {
    return value;
  }

  if (maxLength <= 1) {
    return value.slice(0, maxLength);
  }

  return value.slice(0, maxLength - 1) + "…";
}

export function buildInteractiveListSpec(
  rows: MenuRow[],
  buttonLabel: string
): ListMenuSpecOrNull {
  if (rows.length === 0 || rows.length > 10) {
    return null;
  }

  return {
    type: "list",
    buttonLabel: truncateInteractiveLabel(buttonLabel || "Choose", 20),
    sections: [
      {
        title: "Options",
        rows: rows.map((row) => ({
          id: String(row.id),
          title: truncateInteractiveLabel(row.title, 24),
          description: truncateInteractiveLabel(row.description ?? "", 72)
        }))
      }
    ]
  };
}

type ListMenuSpecOrNull = Extract<InteractiveMenuSpec, { type: "list" }> | null;
type ButtonMenuSpecOrNull = Extract<InteractiveMenuSpec, { type: "button" }> | null;

export function buildInteractiveButtonSpec(
  buttons: Array<{ id: string; title: string }>
): ButtonMenuSpecOrNull {
  if (buttons.length === 0 || buttons.length > 3) {
    return null;
  }

  return {
    type: "button",
    buttons: buttons.map((button) => ({
      id: button.id,
      title: truncateInteractiveLabel(button.title, 20)
    }))
  };
}

export function getLanguageMenuSpec(): MenuReply {
  return {
    fallbackText:
      "1️⃣ English\n2️⃣ తెలుగు\n3️⃣ हिन्दी\n4️⃣ ಕನ್ನಡ\n5️⃣ தமிழ்\n6️⃣ മലയാളം",
    interactive: buildInteractiveListSpec(
      [
        { id: "1", title: "English" },
        { id: "2", title: "Telugu", description: "తెలుగు" },
        { id: "3", title: "Hindi", description: "हिन्दी" },
        { id: "4", title: "Kannada", description: "ಕನ್ನಡ" },
        { id: "5", title: "Tamil", description: "தமிழ்" },
        { id: "6", title: "Malayalam", description: "മലയാളം" }
      ],
      "Select language"
    )
  };
}

export function getMainMenuSpec(): MenuReply {
  return {
    fallbackText: "1️⃣ Book Appointment\n2️⃣ My Appointments\n3️⃣ More",
    interactive: buildInteractiveButtonSpec([
      { id: "1", title: "Book Appointment" },
      { id: "2", title: "My Appointments" },
      { id: "menu_more", title: "More" }
    ])
  };
}

/** Simplified from getDateMenuSpec — Today / Tomorrow / Enter a date. */
export function getDateMenuSpec(): MenuReply {
  return {
    fallbackText: "1️⃣ Today\n2️⃣ Tomorrow\n3️⃣ Enter another date",
    interactive: buildInteractiveButtonSpec([
      { id: "1", title: "Today" },
      { id: "2", title: "Tomorrow" },
      { id: "3", title: "Other date" }
    ])
  };
}

export function getDoctorSelectionMenuSpec(doctors: Doctor[]): MenuReply {
  const fallbackLines = doctors.map(
    (doctor, index) =>
      `${index + 1}. ${doctor.name}${doctor.specialization ? ` — ${doctor.specialization}` : ""}`
  );

  return {
    fallbackText:
      fallbackLines.join("\n") + "\n\nReply with the doctor's number.",
    interactive: buildInteractiveListSpec(
      doctors.map((doctor, index) => ({
        id: `doctor_select_${doctor.doctor_code}`,
        title: doctor.name,
        description: doctor.specialization || doctor.clinic_name
      })),
      "Select doctor"
    )
  };
}

/**
 * The list-row id carries the slot's full ISO instant (`slot_<iso>`)
 * rather than a page-relative index, so resolving a tap back to an
 * actual Date doesn't depend on the slot list still being in the same
 * order/page it was when sent — see parseSlotSelectionId.
 */
export function getSlotSelectionMenuSpec(
  slots: Date[],
  timezone: string
): MenuReply {
  const labels = slots.map((slot) => formatTimeLabel(slot, timezone));

  return {
    fallbackText:
      labels.map((label, i) => `${i + 1}. ${label}`).join("\n") +
      "\n\nReply with the slot number.",
    interactive: buildInteractiveListSpec(
      slots.map((slot, index) => ({
        id: `slot_${slot.toISOString()}`,
        title: labels[index]!
      })),
      "Choose time"
    )
  };
}

export function parseSlotSelectionId(id: string): Date | null {
  if (!id.startsWith("slot_")) {
    return null;
  }

  const date = new Date(id.slice("slot_".length));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Resolves a typed number ("1", "2", ...) against the slot list that was last sent, for users who type instead of tapping. */
export function resolveTypedSlotSelection(
  input: string,
  slots: Date[]
): Date | null {
  const index = Number(input.trim());

  if (!Number.isInteger(index) || index < 1 || index > slots.length) {
    return null;
  }

  return slots[index - 1] ?? null;
}

export function getYesNoConfirmSpec(): MenuReply {
  return {
    fallbackText: "1️⃣ Confirm\n2️⃣ Cancel",
    interactive: buildInteractiveButtonSpec([
      { id: "confirm_yes", title: "Confirm" },
      { id: "confirm_no", title: "Cancel" }
    ])
  };
}

/** "More" sub-menu — options that don't fit the 3-button main menu. */
export function getPatientMoreMenuSpec(): MenuReply {
  return {
    fallbackText:
      "1️⃣ Cancel Appointment\n2️⃣ Reschedule Appointment\n3️⃣ Change Language\n0️⃣ Main Menu",
    interactive: buildInteractiveListSpec(
      [
        { id: "cancel_appointment", title: "Cancel Appointment" },
        { id: "reschedule_appointment", title: "Reschedule Appointment" },
        { id: "change_language", title: "Change Language" },
        { id: "nav_main_menu", title: "Main Menu" }
      ],
      "Select option"
    )
  };
}

export interface AppointmentListItem {
  appointmentId: string;
  doctorName: string;
  date: string;
  time: string;
}

// Leaves room for up to 3 extra control rows (Previous + Next + Main
// Menu, all of which can appear together on a middle page) within
// WhatsApp's 10-row list cap — 7 + 3 = 10.
export const APPOINTMENT_LIST_PAGE_SIZE = 7;

export interface PaginatedListPage<T> {
  pageItems: T[];
  hasPrev: boolean;
  hasNext: boolean;
}

/**
 * Slices a full list into one page — generic so both the patient-facing
 * appointment list below and the doctor portal's own patient/session/leave
 * lists (lib/whatsapp/doctorFlow.ts) share one pagination implementation.
 * Page size leaves room for up to 3 control rows (Previous/Next/Main
 * Menu) within WhatsApp's 10-row list cap.
 */
export function paginateAppointmentList<T>(items: T[], page: number): PaginatedListPage<T> {
  const start = page * APPOINTMENT_LIST_PAGE_SIZE;
  return {
    pageItems: items.slice(start, start + APPOINTMENT_LIST_PAGE_SIZE),
    hasPrev: page > 0,
    hasNext: start + APPOINTMENT_LIST_PAGE_SIZE < items.length
  };
}

/**
 * Paginated appointment picker — used by My Appointments, Cancel, and
 * Reschedule (each just labels the list differently via `bodyText`,
 * built by the caller). Row ids are `appt_<index>` where index is
 * relative to the *full* list, not the page, so a selection resolves
 * correctly regardless of which page it was tapped from — see
 * parseAppointmentSelectionId.
 */
export function getAppointmentListMenuSpec(
  appointments: AppointmentListItem[],
  page: number
): MenuReply {
  const { pageItems, hasPrev, hasNext } = paginateAppointmentList(appointments, page);
  const offset = page * APPOINTMENT_LIST_PAGE_SIZE;

  const rows: MenuRow[] = pageItems.map((item, i) => ({
    id: `appt_${offset + i}`,
    title: item.doctorName || "Doctor",
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
    (item, i) => `${offset + i + 1}. ${item.doctorName} — ${item.date} at ${item.time}`
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

export type AppointmentListChoice =
  | { type: "select"; index: number }
  | { type: "prev" }
  | { type: "next" }
  | { type: "main_menu" }
  | { type: "invalid" };

/** Classifies a reply to getAppointmentListMenuSpec — id-based (list tap) or typed-number fallback. */
export function classifyAppointmentListChoice(
  input: string,
  appointmentsLength: number
): AppointmentListChoice {
  const normalized = input.trim().toLowerCase();

  if (normalized === "nav_main_menu" || normalized === "0") {
    return { type: "main_menu" };
  }

  if (normalized === "appt_prev" || normalized === "prev") {
    return { type: "prev" };
  }

  if (normalized === "appt_next" || normalized === "next") {
    return { type: "next" };
  }

  // Row-tap ids (`appt_9`) already carry a 0-based absolute index into
  // the full list (see getAppointmentListMenuSpec). A typed number, by
  // contrast, is the 1-based position shown in the fallback text
  // ("1. Dr X — ...") — these are two different conventions for the
  // same input, not interchangeable, so each needs its own offset.
  if (normalized.startsWith("appt_")) {
    const index = Number(normalized.slice("appt_".length));

    if (!Number.isInteger(index) || index < 0 || index >= appointmentsLength) {
      return { type: "invalid" };
    }

    return { type: "select", index };
  }

  const typedNumber = Number(normalized);

  if (!Number.isInteger(typedNumber) || typedNumber < 1 || typedNumber > appointmentsLength) {
    return { type: "invalid" };
  }

  return { type: "select", index: typedNumber - 1 };
}

export function getMyAppointmentActionSpec(): MenuReply {
  return {
    fallbackText: "1️⃣ Cancel\n2️⃣ Reschedule\n0️⃣ Main Menu",
    interactive: buildInteractiveButtonSpec([
      { id: "appointment_action_cancel", title: "Cancel" },
      { id: "appointment_action_reschedule", title: "Reschedule" },
      { id: "nav_main_menu", title: "Main Menu" }
    ])
  };
}

export function buildAppointmentDetailMessage(item: AppointmentListItem): string {
  return `👨‍⚕️ ${item.doctorName}\n📅 ${item.date}\n🕐 ${item.time}`;
}
