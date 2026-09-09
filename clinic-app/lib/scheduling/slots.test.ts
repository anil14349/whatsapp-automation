import { describe, expect, it, vi } from "vitest";
import { getAvailableSlotsForDoctor } from "./slots";
import type { Doctor } from "@/lib/doctors";

// getAvailableSlotsForDoctor used to source "busy" time from Google
// Calendar; this exercises the replacement (lib/appointments, i.e. this
// system's own Confirmed rows, are now the source of truth) — the exact
// piece that guarantees the app doesn't double-book once Calendar is
// gone. isDoctorOnLeave/getDoctorAvailabilityForDate are stubbed out so
// the test isolates the busy-interval computation itself.
vi.mock("@/lib/doctors", () => ({
  isDoctorOnLeave: vi.fn(async () => false),
  getDoctorAvailabilityForDate: vi.fn(async () => [
    { start_time: "09:00", end_time: "11:00" }
  ])
}));

const DOCTOR = {
  id: "doc-1",
  appointment_duration_minutes: 30
} as Doctor;

const DATE = "2027-06-15"; // arbitrary future date; only the fixed window above matters

/** Fake supabase for the one query getAvailableSlotsForDoctor now makes directly: appointments for this doctor/date/Confirmed. */
function makeFakeSupabase(existingAppointmentTimes: string[]) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: async () => ({
              data: existingAppointmentTimes.map((appointment_time) => ({ appointment_time })),
              error: null
            })
          })
        })
      })
    })
  } as never;
}

describe("getAvailableSlotsForDoctor", () => {
  it("returns every 30-minute slot in the 09:00-11:00 window when nothing is booked", async () => {
    const supabase = makeFakeSupabase([]);
    const slots = await getAvailableSlotsForDoctor(supabase, {
      doctor: DOCTOR,
      dateString: DATE,
      timezone: "UTC"
    });

    expect(slots).toHaveLength(4); // 09:00, 09:30, 10:00, 10:30
  });

  it("excludes a slot already booked as a Confirmed appointment in this system", async () => {
    const supabase = makeFakeSupabase(["09:30"]);
    const slots = await getAvailableSlotsForDoctor(supabase, {
      doctor: DOCTOR,
      dateString: DATE,
      timezone: "UTC"
    });

    const times = slots.map((s) => s.toISOString().slice(11, 16));
    expect(times).toEqual(["09:00", "10:00", "10:30"]);
  });

  it("excludes every slot the booked appointment's duration overlaps, not just its exact start time", async () => {
    // A 09:15 booking (30 min) overlaps both the 09:00 and 09:30 slots.
    const supabase = makeFakeSupabase(["09:15"]);
    const slots = await getAvailableSlotsForDoctor(supabase, {
      doctor: DOCTOR,
      dateString: DATE,
      timezone: "UTC"
    });

    const times = slots.map((s) => s.toISOString().slice(11, 16));
    expect(times).toEqual(["10:00", "10:30"]);
  });
});
