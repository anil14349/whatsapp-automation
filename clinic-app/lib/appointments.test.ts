import { describe, expect, it } from "vitest";
import { checkAppointmentOwnership, normalizeTimeInput } from "./appointments";
import type { Appointment } from "./appointments";

describe("normalizeTimeInput", () => {
  it("accepts 24-hour HH:MM", () => {
    expect(normalizeTimeInput("09:30")).toBe("09:30");
    expect(normalizeTimeInput("9:30")).toBe("09:30");
    expect(normalizeTimeInput("23:59")).toBe("23:59");
  });

  it("accepts 12-hour with AM/PM (any case)", () => {
    expect(normalizeTimeInput("9:00 AM")).toBe("09:00");
    expect(normalizeTimeInput("9:00 am")).toBe("09:00");
    expect(normalizeTimeInput("12:00 AM")).toBe("00:00"); // midnight
    expect(normalizeTimeInput("12:00 PM")).toBe("12:00"); // noon
    expect(normalizeTimeInput("1:15 PM")).toBe("13:15");
  });

  it("rejects invalid input", () => {
    expect(normalizeTimeInput("25:00")).toBeNull();
    expect(normalizeTimeInput("13:00 PM")).toBeNull(); // 13 isn't valid in 12h form
    expect(normalizeTimeInput("not a time")).toBeNull();
    expect(normalizeTimeInput("")).toBeNull();
  });
});

describe("checkAppointmentOwnership", () => {
  const baseAppointment = {
    id: "appt-1",
    doctor_id: "doc-1",
    patient_phone: "9876543210"
  } as Appointment;

  it("allows the authorized doctor", () => {
    expect(
      checkAppointmentOwnership(baseAppointment, { authorizedDoctorId: "doc-1" })
    ).toBeNull();
  });

  it("rejects a different doctor", () => {
    const result = checkAppointmentOwnership(baseAppointment, {
      authorizedDoctorId: "doc-2"
    });
    expect(result?.success).toBe(false);
  });

  it("allows the matching patient phone", () => {
    expect(
      checkAppointmentOwnership(baseAppointment, { patientPhone: "9876543210" })
    ).toBeNull();
  });

  it("rejects a different patient phone", () => {
    const result = checkAppointmentOwnership(baseAppointment, {
      patientPhone: "9999999999"
    });
    expect(result?.success).toBe(false);
  });

  it("fails closed when neither is supplied — regression guard for the exact bug fixed in updateAppointmentStatus", () => {
    const result = checkAppointmentOwnership(baseAppointment, {});
    expect(result).not.toBeNull();
    expect(result?.success).toBe(false);
  });

  it("prefers the doctor check when both are supplied", () => {
    // authorizedDoctorId takes priority per the function's own doc
    // comment/order — a doctor-portal call should never accidentally
    // fall through to a patient-phone check.
    const result = checkAppointmentOwnership(baseAppointment, {
      authorizedDoctorId: "doc-2",
      patientPhone: "9876543210"
    });
    expect(result?.success).toBe(false);
  });
});
