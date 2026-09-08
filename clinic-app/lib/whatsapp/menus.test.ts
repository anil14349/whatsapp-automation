import { describe, expect, it } from "vitest";
import {
  buildInteractiveButtonSpec,
  buildInteractiveListSpec,
  classifyAppointmentListChoice,
  getAppointmentListMenuSpec,
  getDoctorSelectionMenuSpec,
  getSlotSelectionMenuSpec,
  paginateAppointmentList,
  parseSlotSelectionId,
  resolveTypedSlotSelection,
  truncateInteractiveLabel,
  type AppointmentListItem
} from "./menus";
import type { Doctor } from "@/lib/doctors";

describe("truncateInteractiveLabel", () => {
  it("passes short text through unchanged", () => {
    expect(truncateInteractiveLabel("Book Appointment", 24)).toBe("Book Appointment");
  });

  it("truncates with an ellipsis when too long", () => {
    const result = truncateInteractiveLabel("A very long doctor name indeed", 10);
    expect(result.length).toBe(10);
    expect(result.endsWith("…")).toBe(true);
  });
});

describe("buildInteractiveListSpec", () => {
  it("returns null for zero or more than 10 rows (WhatsApp's list limit)", () => {
    expect(buildInteractiveListSpec([], "Choose")).toBeNull();
    const tooMany = Array.from({ length: 11 }, (_, i) => ({ id: String(i), title: `Row ${i}` }));
    expect(buildInteractiveListSpec(tooMany, "Choose")).toBeNull();
  });

  it("builds a valid spec for 1-10 rows", () => {
    const spec = buildInteractiveListSpec([{ id: "1", title: "English" }], "Select language");
    expect(spec).not.toBeNull();
    expect(spec?.sections[0]?.rows).toHaveLength(1);
  });
});

describe("buildInteractiveButtonSpec", () => {
  it("returns null for zero or more than 3 buttons (WhatsApp's button limit)", () => {
    expect(buildInteractiveButtonSpec([])).toBeNull();
    expect(
      buildInteractiveButtonSpec([
        { id: "1", title: "A" },
        { id: "2", title: "B" },
        { id: "3", title: "C" },
        { id: "4", title: "D" }
      ])
    ).toBeNull();
  });

  it("builds a valid spec for 1-3 buttons", () => {
    expect(buildInteractiveButtonSpec([{ id: "1", title: "Confirm" }])).not.toBeNull();
  });
});

describe("slot selection id round-trip", () => {
  it("parseSlotSelectionId recovers the exact Date encoded by getSlotSelectionMenuSpec", () => {
    const slot = new Date("2026-09-10T09:00:00.000Z");
    const menu = getSlotSelectionMenuSpec([slot], "Asia/Kolkata");
    const rowId = menu.interactive && "sections" in menu.interactive
      ? menu.interactive.sections[0]?.rows[0]?.id
      : undefined;

    expect(rowId).toBeDefined();
    expect(parseSlotSelectionId(rowId!)).toEqual(slot);
  });

  it("parseSlotSelectionId rejects an unrelated id", () => {
    expect(parseSlotSelectionId("doctor_select_D001")).toBeNull();
  });
});

function makeAppointments(count: number): AppointmentListItem[] {
  return Array.from({ length: count }, (_, i) => ({
    appointmentId: `appt-${i}`,
    doctorName: `Dr. ${i}`,
    date: "2026-09-10",
    time: "9:00 AM"
  }));
}

describe("paginateAppointmentList", () => {
  it("fits everything on page 0 when under the page size", () => {
    const page = paginateAppointmentList(makeAppointments(3), 0);
    expect(page.pageItems).toHaveLength(3);
    expect(page.hasPrev).toBe(false);
    expect(page.hasNext).toBe(false);
  });

  it("paginates across pages of 7 with hasPrev/hasNext set correctly", () => {
    const appointments = makeAppointments(11);

    const page0 = paginateAppointmentList(appointments, 0);
    expect(page0.pageItems).toHaveLength(7);
    expect(page0.hasPrev).toBe(false);
    expect(page0.hasNext).toBe(true);

    const page1 = paginateAppointmentList(appointments, 1);
    expect(page1.pageItems).toHaveLength(4);
    expect(page1.hasPrev).toBe(true);
    expect(page1.hasNext).toBe(false);
  });
});

describe("getAppointmentListMenuSpec", () => {
  it("encodes row ids relative to the full list, not the page", () => {
    const appointments = makeAppointments(11);
    const menu = getAppointmentListMenuSpec(appointments, 1);
    const rows = menu.interactive && "sections" in menu.interactive ? menu.interactive.sections[0]?.rows : [];

    // Page 1 starts at index 7 (page size 7) — row ids should reflect that, not restart at 0.
    expect(rows?.[0]?.id).toBe("appt_7");
  });

  it("always includes a Main Menu row alongside pagination controls", () => {
    const menu = getAppointmentListMenuSpec(makeAppointments(11), 0);
    const rows = menu.interactive && "sections" in menu.interactive ? menu.interactive.sections[0]?.rows : [];
    const ids = rows?.map((r) => r.id) ?? [];

    expect(ids).toContain("appt_next");
    expect(ids).not.toContain("appt_prev");
    expect(ids).toContain("nav_main_menu");
  });
});

describe("classifyAppointmentListChoice", () => {
  it("recognizes main menu, prev, and next by id or typed word", () => {
    expect(classifyAppointmentListChoice("nav_main_menu", 5)).toEqual({ type: "main_menu" });
    expect(classifyAppointmentListChoice("0", 5)).toEqual({ type: "main_menu" });
    expect(classifyAppointmentListChoice("appt_prev", 5)).toEqual({ type: "prev" });
    expect(classifyAppointmentListChoice("prev", 5)).toEqual({ type: "prev" });
    expect(classifyAppointmentListChoice("appt_next", 5)).toEqual({ type: "next" });
    expect(classifyAppointmentListChoice("next", 5)).toEqual({ type: "next" });
  });

  it("resolves a row-tap id to its absolute index", () => {
    expect(classifyAppointmentListChoice("appt_9", 11)).toEqual({ type: "select", index: 9 });
  });

  it("resolves a typed number to a 0-based index", () => {
    expect(classifyAppointmentListChoice("1", 5)).toEqual({ type: "select", index: 0 });
  });

  it("rejects an out-of-range or non-numeric choice", () => {
    expect(classifyAppointmentListChoice("99", 5)).toEqual({ type: "invalid" });
    expect(classifyAppointmentListChoice("abc", 5)).toEqual({ type: "invalid" });
  });
});

function makeDoctors(count: number): Doctor[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `doc-${i}`,
    doctor_code: `D${String(i).padStart(3, "0")}`,
    name: `Dr. ${i}`,
    specialization: "General Medicine"
  })) as Doctor[];
}

describe("getDoctorSelectionMenuSpec pagination", () => {
  it("fits everything on one page with no controls when under the page size", () => {
    const menu = getDoctorSelectionMenuSpec(makeDoctors(3), 0);
    const rows = menu.interactive && "sections" in menu.interactive ? menu.interactive.sections[0]?.rows : [];
    const ids = rows?.map((r) => r.id) ?? [];

    expect(ids).toHaveLength(3);
    expect(ids).not.toContain("doctor_prev");
    expect(ids).not.toContain("doctor_next");
  });

  it("adds doctor_prev/doctor_next controls once the list exceeds one page", () => {
    const doctors = makeDoctors(11);

    const page0 = getDoctorSelectionMenuSpec(doctors, 0);
    const rows0 =
      page0.interactive && "sections" in page0.interactive ? page0.interactive.sections[0]?.rows : [];
    const ids0 = rows0?.map((r) => r.id) ?? [];
    expect(ids0).toContain("doctor_next");
    expect(ids0).not.toContain("doctor_prev");

    const page1 = getDoctorSelectionMenuSpec(doctors, 1);
    const rows1 =
      page1.interactive && "sections" in page1.interactive ? page1.interactive.sections[0]?.rows : [];
    const ids1 = rows1?.map((r) => r.id) ?? [];
    expect(ids1).toContain("doctor_prev");
  });

  it("always lists every doctor in the plain-text fallback regardless of page", () => {
    const doctors = makeDoctors(11);
    const menu = getDoctorSelectionMenuSpec(doctors, 0);

    for (let i = 0; i < 11; i++) {
      expect(menu.fallbackText).toContain(`${i + 1}. Dr. ${i}`);
    }
  });
});

describe("resolveTypedSlotSelection", () => {
  const slots = [
    new Date("2026-09-10T09:00:00.000Z"),
    new Date("2026-09-10T09:30:00.000Z")
  ];

  it("resolves a valid 1-based index", () => {
    expect(resolveTypedSlotSelection("1", slots)).toEqual(slots[0]);
    expect(resolveTypedSlotSelection("2", slots)).toEqual(slots[1]);
  });

  it("rejects out-of-range or non-numeric input", () => {
    expect(resolveTypedSlotSelection("0", slots)).toBeNull();
    expect(resolveTypedSlotSelection("3", slots)).toBeNull();
    expect(resolveTypedSlotSelection("abc", slots)).toBeNull();
  });
});
