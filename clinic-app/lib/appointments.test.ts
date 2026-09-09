import { describe, expect, it, vi } from "vitest";
import { bookAppointment, checkAppointmentOwnership, normalizeTimeInput } from "./appointments";
import type { Appointment } from "./appointments";
import { combineDateAndTime } from "./scheduling/dates";

// bookAppointment's own duplicate-of-the-day pre-check and insert are
// exercised directly against a hand-rolled Supabase query-builder fake
// below; everything else it depends on (doctor lookup, slot availability,
// patient upsert) is stubbed out so the test focuses on the phone-
// normalization bug (see lib/phone.ts's normalizeWhatsAppPhone).
vi.mock("./doctors", () => ({
  getDoctorById: vi.fn(async () => ({
    id: "doc-1",
    calendar_id: "cal-1",
    appointment_duration_minutes: 30,
    name: "Dr. Test",
    clinic_name: "Test Clinic"
  }))
}));

vi.mock("./scheduling/slots", () => ({
  getAvailableSlotsForDoctor: vi.fn(async () => [FIXED_SLOT])
}));

vi.mock("./patients", () => ({
  registerPatientForBooking: vi.fn(async () => ({
    patient: { id: "patient-1" },
    wasNew: false
  }))
}));

// One year out so it's always in the future regardless of when the test
// suite runs, on a fixed HH:MM (no seconds/ms) so it lines up exactly
// with what combineDateAndTime (which bookAppointment uses internally)
// produces for the same inputs.
const FIXED_DATE = `${new Date().getUTCFullYear() + 1}-06-15`;
const FIXED_TIME = "10:00";
const FIXED_SLOT = combineDateAndTime(FIXED_DATE, FIXED_TIME, "UTC");

/**
 * Minimal stand-in for the two `supabase.from("appointments")` chains
 * bookAppointment uses directly: the same-day-duplicate `.maybeSingle()`
 * pre-check and the insert. `existingRow` seeds a row (with a
 * `patient_phone` in whatever format a prior booking stored it in) as if
 * it already exists for that patient/date/status; the pre-check only
 * "finds" it if bookAppointment queries with a matching `patient_phone`
 * value, so this actually exercises whether the value passed to `.eq()`
 * was normalized rather than just asserting a canned result.
 */
function makeFakeSupabase(existingRow: { patient_phone: string } | null) {
  const filters: Record<string, unknown> = {};

  return {
    from: () => ({
      select: () => ({
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return {
            eq: (column2: string, value2: unknown) => {
              filters[column2] = value2;
              return {
                eq: (column3: string, value3: unknown) => {
                  filters[column3] = value3;
                  const matches =
                    existingRow !== null && filters.patient_phone === existingRow.patient_phone;
                  return {
                    maybeSingle: async () => ({
                      data: matches ? { id: "existing-appt" } : null,
                      error: null
                    })
                  };
                }
              };
            }
          };
        }
      }),
      insert: (row: Record<string, unknown>) => ({
        select: () => ({
          single: async () => ({
            data: { id: "new-appt", ...row },
            error: null
          })
        })
      })
    })
  } as never;
}

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

  it("matches a WhatsApp-format stored phone against a bare 10-digit lookup phone", () => {
    // Regression guard: appointment.patient_phone may have been stored in
    // Meta's country-code-prefixed format (e.g. by a caller that predates
    // the normalization fix in bookAppointment), while a later lookup
    // (e.g. a walk-in ownership check) may supply just the bare 10 digits
    // for the same real number. phonesMatch normalizes both sides so
    // these still resolve to the same patient.
    const appointment = { ...baseAppointment, patient_phone: "919876543210" } as Appointment;
    expect(checkAppointmentOwnership(appointment, { patientPhone: "9876543210" })).toBeNull();
  });
});

describe("bookAppointment — phone normalization", () => {
  // Reproduces the reported bug: a patient books over WhatsApp (phone
  // arrives as Meta's consistently country-code-prefixed sender phone),
  // and later the same day a receptionist books a walk-in for the same
  // real person but types just the bare 10 digits (no country code).
  // Without normalizing patientPhone at the root, these look like two
  // different patients to the same-day-duplicate pre-check and the
  // appointments_one_active_per_patient_per_day_idx constraint, even
  // though patients.phone already resolves both to one row.

  it("treats a WhatsApp-format phone and its bare-10-digit form as the same patient for the same-day-duplicate check", async () => {
    // Existing row as it would have been stored by a prior WhatsApp
    // booking for this patient/date.
    const supabase = makeFakeSupabase({ patient_phone: "9876543210" });

    const result = await bookAppointment(supabase, {
      doctorId: "doc-1",
      dateString: FIXED_DATE,
      timeString: FIXED_TIME,
      patientName: "Test Patient",
      patientPhone: "919876543210", // walk-in typed without stripping the country code, or vice versa
      timezone: "UTC"
    });

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/already have an active appointment/i);
  });

  it("stores patient_phone normalized to the last 10 digits regardless of the input format", async () => {
    const supabase = makeFakeSupabase(null);

    const result = await bookAppointment(supabase, {
      doctorId: "doc-1",
      dateString: FIXED_DATE,
      timeString: FIXED_TIME,
      patientName: "Test Patient",
      patientPhone: "+91 98765-43210",
      timezone: "UTC"
    });

    expect(result.success).toBe(true);
    expect(result.appointment?.patient_phone).toBe("9876543210");
  });

  it("rejects a blank/unusable phone number instead of booking with an empty patient_phone", async () => {
    const supabase = makeFakeSupabase(null);

    const result = await bookAppointment(supabase, {
      doctorId: "doc-1",
      dateString: FIXED_DATE,
      timeString: FIXED_TIME,
      patientName: "Test Patient",
      patientPhone: "   ",
      timezone: "UTC"
    });

    expect(result.success).toBe(false);
  });
});
