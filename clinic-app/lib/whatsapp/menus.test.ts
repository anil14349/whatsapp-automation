import { describe, expect, it } from "vitest";
import {
  buildInteractiveButtonSpec,
  buildInteractiveListSpec,
  getSlotSelectionMenuSpec,
  parseSlotSelectionId,
  resolveTypedSlotSelection,
  truncateInteractiveLabel
} from "./menus";

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
