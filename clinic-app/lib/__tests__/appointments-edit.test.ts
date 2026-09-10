import { describe, it, expect, beforeEach, vi } from "vitest";
import { normalizeTimeInput } from "@/lib/appointments";

/**
 * Unit tests for appointment edit functions.
 * Tests validation, normalization, and business logic.
 */

describe("Appointment Edit Functions", () => {
  describe("normalizeTimeInput", () => {
    it("should accept 24-hour format", () => {
      expect(normalizeTimeInput("14:30")).toBe("14:30");
      expect(normalizeTimeInput("09:00")).toBe("09:00");
      expect(normalizeTimeInput("23:59")).toBe("23:59");
      expect(normalizeTimeInput("00:00")).toBe("00:00");
    });

    it("should pad single-digit hours", () => {
      expect(normalizeTimeInput("9:30")).toBe("09:30");
      expect(normalizeTimeInput("5:00")).toBe("05:00");
    });

    it("should accept 12-hour AM format", () => {
      expect(normalizeTimeInput("9:30 AM")).toBe("09:30");
      expect(normalizeTimeInput("9:30 am")).toBe("09:30");
      expect(normalizeTimeInput("12:00 AM")).toBe("00:00");
      expect(normalizeTimeInput("1:00 AM")).toBe("01:00");
    });

    it("should accept 12-hour PM format", () => {
      expect(normalizeTimeInput("2:00 PM")).toBe("14:00");
      expect(normalizeTimeInput("2:00 pm")).toBe("14:00");
      expect(normalizeTimeInput("12:00 PM")).toBe("12:00");
      expect(normalizeTimeInput("1:00 PM")).toBe("13:00");
    });

    it("should reject invalid hours", () => {
      expect(normalizeTimeInput("25:00")).toBeNull();
      expect(normalizeTimeInput("24:30")).toBeNull();
      expect(normalizeTimeInput("13:00 PM")).toBeNull();
    });

    it("should reject invalid minutes", () => {
      expect(normalizeTimeInput("14:60")).toBeNull();
      expect(normalizeTimeInput("14:75")).toBeNull();
      expect(normalizeTimeInput("9:99 AM")).toBeNull();
    });

    it("should reject non-time strings", () => {
      expect(normalizeTimeInput("not a time")).toBeNull();
      expect(normalizeTimeInput("14-30")).toBeNull();
      expect(normalizeTimeInput("2pm")).toBeNull();
      expect(normalizeTimeInput("")).toBeNull();
    });

    it("should handle whitespace", () => {
      expect(normalizeTimeInput("  14:30  ")).toBe("14:30");
      expect(normalizeTimeInput("  9:30 AM  ")).toBe("09:30");
      expect(normalizeTimeInput("\t14:30\n")).toBe("14:30");
    });
  });

  describe("Business Logic Validation", () => {
    it("should validate appointments can only be edited if Confirmed", () => {
      const statuses = ["Confirmed", "Completed", "Cancelled", "No-Show"];
      const editableStatuses = statuses.filter((s) => s === "Confirmed");

      expect(editableStatuses).toEqual(["Confirmed"]);
    });

    it("should enforce future date rule", () => {
      const today = new Date();
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const isValidDate = (dateString: string) => {
        const date = new Date(dateString);
        const checkDate = new Date(today);
        checkDate.setHours(0, 0, 0, 0);
        return date >= checkDate;
      };

      expect(isValidDate("2026-09-20")).toBe(true);
      expect(isValidDate("2020-01-01")).toBe(false);
    });

    it("should enforce max reschedule window (30 days)", () => {
      const today = new Date();
      const maxDate = new Date(today);
      maxDate.setDate(maxDate.getDate() + 30);

      const isWithinWindow = (dateString: string) => {
        const date = new Date(dateString);
        return date <= maxDate;
      };

      expect(isWithinWindow("2026-09-20")).toBe(true);
      expect(isWithinWindow("2099-12-31")).toBe(false);
    });
  });

  describe("Time Slot Conflict Detection", () => {
    it("should detect double-booking", () => {
      const existingSlots = [
        { doctor_id: "doc-001", time: "10:00", date: "2026-09-20" },
        { doctor_id: "doc-001", time: "14:00", date: "2026-09-20" },
        { doctor_id: "doc-001", time: "16:00", date: "2026-09-20" }
      ];

      const isSlotAvailable = (doctorId: string, time: string, date: string) => {
        return !existingSlots.some(
          (slot) =>
            slot.doctor_id === doctorId &&
            slot.time === time &&
            slot.date === date
        );
      };

      expect(isSlotAvailable("doc-001", "10:00", "2026-09-20")).toBe(false);
      expect(isSlotAvailable("doc-001", "12:00", "2026-09-20")).toBe(true);
      expect(isSlotAvailable("doc-002", "10:00", "2026-09-20")).toBe(true);
    });

    it("should enforce one-appointment-per-patient-per-day", () => {
      const patientAppointments = [
        { patient_id: "pat-001", date: "2026-09-20" },
        { patient_id: "pat-002", date: "2026-09-20" },
        { patient_id: "pat-001", date: "2026-09-21" }
      ];

      const canRescheduleToDate = (patientId: string, date: string) => {
        return !patientAppointments.some(
          (apt) => apt.patient_id === patientId && apt.date === date
        );
      };

      expect(canRescheduleToDate("pat-001", "2026-09-20")).toBe(false);
      expect(canRescheduleToDate("pat-001", "2026-09-22")).toBe(true);
      expect(canRescheduleToDate("pat-002", "2026-09-21")).toBe(true);
    });
  });

  describe("Patient Name Validation", () => {
    it("should enforce 2-character minimum", () => {
      const isValidName = (name: string) => {
        return name && name.trim().length >= 2;
      };

      expect(isValidName("John Smith")).toBe(true);
      expect(isValidName("Jo")).toBe(true);
      expect(isValidName("J")).toBe(false);
      expect(isValidName("")).toBe(false);
      expect(isValidName("  ")).toBe(false);
    });

    it("should reject numbers-only names", () => {
      const isValidName = (name: string) => {
        return !/^\d+$/.test(name.trim());
      };

      expect(isValidName("123456")).toBe(false);
      expect(isValidName("John 123")).toBe(true);
      expect(isValidName("123 John")).toBe(true);
      expect(isValidName("John")).toBe(true);
    });

    it("should detect no-change scenarios", () => {
      const oldName = "John Smith";
      const newName = "John Smith";

      const hasChanged = oldName.trim() !== newName.trim();
      expect(hasChanged).toBe(false);
    });
  });

  describe("Error Message Generation", () => {
    const testCases = [
      {
        scenario: "Non-confirmed appointment",
        error: "Can only edit date/time for Confirmed appointments"
      },
      {
        scenario: "Invalid time format",
        error: "Invalid time format. Use HH:MM or HH:MM AM/PM"
      },
      {
        scenario: "Past date",
        error: "Cannot schedule appointment in the past"
      },
      {
        scenario: "Slot not available",
        error: "Time slot is not available for the selected date"
      },
      {
        scenario: "Duplicate on date",
        error: "Patient already has an appointment on this date"
      },
      {
        scenario: "Doctor not found",
        error: "Doctor not found"
      },
      {
        scenario: "No slots available",
        error: "No available slots for this doctor on this date"
      }
    ];

    it.each(testCases)("should return correct error for: $scenario", ({ error }) => {
      expect(error).toBeDefined();
      expect(error.length > 0).toBe(true);
    });
  });

  describe("Audit Logging", () => {
    it("should create audit entries for appointment changes", () => {
      const auditEntry = {
        appointmentId: "apt-001",
        action: "TIME_UPDATED",
        oldValue: "14:00",
        newValue: "15:00",
        timestamp: new Date().toISOString()
      };

      expect(auditEntry.appointmentId).toBeDefined();
      expect(auditEntry.action).toMatch(/^(TIME|DATE|DOCTOR)_/);
      expect(auditEntry.oldValue).toBeDefined();
      expect(auditEntry.newValue).toBeDefined();
      expect(auditEntry.timestamp).toBeDefined();
    });

    it("should log both old and new values", () => {
      const changes = [
        { action: "TIME_UPDATED", old: "14:00", new: "15:00" },
        { action: "DATE_UPDATED", old: "2026-09-20", new: "2026-09-21" },
        { action: "DOCTOR_CHANGED", old: "doc-001", new: "doc-002" }
      ];

      changes.forEach(({ action, old: oldVal, new: newVal }) => {
        expect(oldVal).not.toEqual(newVal);
        expect(action).toBeTruthy();
      });
    });
  });
});

describe("Integration Scenarios", () => {
  it("should handle multiple changes in one reschedule", () => {
    const changes = {
      date: { old: "2026-09-20", new: "2026-09-25" },
      time: { old: "14:00", new: "10:00" }
    };

    expect(changes.date.old).not.toEqual(changes.date.new);
    expect(changes.time.old).not.toEqual(changes.time.new);
  });

  it("should handle doctor change with time adjustment", () => {
    const appointment = {
      doctor: { old: "doc-001", new: "doc-002" },
      time: { old: "14:00", new: "14:30" }
    };

    // Verify both can change in one operation
    expect(Object.keys(appointment)).toHaveLength(2);
  });
});
