import { describe, expect, it } from "vitest";
import { generateAppointmentReceiptImageBuffer } from "./receipt";

const PNG_MAGIC_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe("generateAppointmentReceiptImageBuffer", () => {
  it("renders a real PNG for a full set of appointment details", async () => {
    const buffer = await generateAppointmentReceiptImageBuffer({
      clinicName: "ABC Clinic",
      patientName: "Jane Doe",
      doctorName: "Dr. Smith",
      specialization: "Cardiology",
      date: "2026-09-10",
      time: "9:00 AM",
      appointmentCode: "A1234ABCD"
    });

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(1000);
    expect(Array.from(buffer.subarray(0, 8))).toEqual(PNG_MAGIC_BYTES);
  });

  it("renders without throwing when optional fields are blank", async () => {
    const buffer = await generateAppointmentReceiptImageBuffer({
      clinicName: "ABC Clinic",
      patientName: "Jane Doe",
      doctorName: "Dr. Smith",
      specialization: "",
      date: "2026-09-10",
      time: "9:00 AM",
      appointmentCode: "A1234ABCD"
    });

    expect(Array.from(buffer.subarray(0, 8))).toEqual(PNG_MAGIC_BYTES);
  });
});
