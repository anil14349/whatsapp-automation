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
