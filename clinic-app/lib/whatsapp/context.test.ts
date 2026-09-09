import { describe, expect, it } from "vitest";
import { localizeInteractiveMenu } from "./context";
import type { InteractiveMenuSpec } from "./send";

describe("localizeInteractiveMenu", () => {
  const buttonSpec: InteractiveMenuSpec = {
    type: "button",
    buttons: [
      { id: "1", title: "Book Appointment" },
      { id: "2", title: "My Appointments" },
      { id: "menu_more", title: "More" }
    ]
  };

  const listSpec: InteractiveMenuSpec = {
    type: "list",
    buttonLabel: "Select doctor",
    sections: [
      {
        title: "Options",
        rows: [
          { id: "doctor_select_D001", title: "Dr. Test", description: "Cardiology" }
        ]
      }
    ]
  };

  it("returns the spec unchanged for EN (source language, nothing to translate)", () => {
    expect(localizeInteractiveMenu("EN", "ABC Clinic", buttonSpec)).toEqual(buttonSpec);
    expect(localizeInteractiveMenu("EN", "ABC Clinic", listSpec)).toEqual(listSpec);
  });

  it("passes null through unchanged regardless of language", () => {
    expect(localizeInteractiveMenu("TE", "ABC Clinic", null)).toBeNull();
  });

  it("translates every button title using the real localization dictionary", () => {
    const localized = localizeInteractiveMenu("TE", "ABC Clinic", buttonSpec);

    expect(localized?.type).toBe("button");
    if (localized?.type !== "button") throw new Error("expected button spec");

    // ids are never translated — only WhatsApp-visible titles are.
    expect(localized.buttons.map((b) => b.id)).toEqual(["1", "2", "menu_more"]);
    expect(localized.buttons[1]!.title).toBe("నా అపాయింట్‌మెంట్‌లు"); // "My Appointments"
    expect(localized.buttons[2]!.title).toBe("మరిన్ని"); // "More"
  });

  it("re-truncates a translation that runs longer than the 20-char button cap", () => {
    const localized = localizeInteractiveMenu("TE", "ABC Clinic", buttonSpec);
    if (localized?.type !== "button") throw new Error("expected button spec");

    // "Book Appointment" -> "అపాయింట్‌మెంట్ బుక్ చేయండి" (> 20 chars) — must
    // come back truncated with an ellipsis, not the raw over-length translation.
    const title = localized.buttons[0]!.title;
    expect(title.length).toBeLessThanOrEqual(20);
    expect(title.endsWith("…")).toBe(true);
  });

  it("translates list buttonLabel, section title, and row title/description", () => {
    const localized = localizeInteractiveMenu("TE", "ABC Clinic", listSpec);

    expect(localized?.type).toBe("list");
    if (localized?.type !== "list") throw new Error("expected list spec");

    expect(localized.buttonLabel).not.toBe("Select doctor"); // translated to *something* else
    expect(localized.sections[0]!.title).toBe("ఎంపికలు"); // "Options"

    const row = localized.sections[0]!.rows[0]!;
    expect(row.id).toBe("doctor_select_D001"); // ids untouched
    // "Dr. Test"/"Cardiology" have no dictionary entry — localizeWhatsAppReply
    // leaves untranslated text as-is, so these should be unchanged.
    expect(row.title).toBe("Dr. Test");
    expect(row.description).toBe("Cardiology");
  });

  it("handles a missing row description without throwing", () => {
    const spec: InteractiveMenuSpec = {
      type: "list",
      buttonLabel: "Choose",
      sections: [{ title: "Options", rows: [{ id: "1", title: "Row" }] }]
    };

    const localized = localizeInteractiveMenu("TE", "ABC Clinic", spec);
    if (localized?.type !== "list") throw new Error("expected list spec");
    expect(localized.sections[0]!.rows[0]!.description).toBe("");
  });

  it("does not mutate the original spec object", () => {
    const original: InteractiveMenuSpec = {
      type: "button",
      buttons: [{ id: "1", title: "Book Appointment" }]
    };

    localizeInteractiveMenu("TE", "ABC Clinic", original);

    expect(original.type === "button" && original.buttons[0]!.title).toBe("Book Appointment");
  });
});
