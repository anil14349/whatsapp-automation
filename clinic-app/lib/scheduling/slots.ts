import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { Doctor } from "@/lib/doctors";
import { getDoctorAvailabilityForDate, isDoctorOnLeave } from "@/lib/doctors";
import { computeAvailableSlots, type TimeWindow } from "./availability";
import { combineDateAndTime } from "./dates";

/**
 * I/O wrapper around the pure computeAvailableSlots() — was
 * getAvailableSlots() in src/Model_Calendar.gs. This is the only place
 * that touches Supabase to answer "what times can this doctor be booked
 * at on this date".
 *
 * Busy intervals used to come from Google Calendar (calendar.
 * getEventsForDay) — removed so a small clinic doesn't need a Google
 * Cloud service account + per-doctor calendar-sharing just to run this.
 * Every doctor's real schedule already lives in this system (WhatsApp/
 * the doctor web portal are how they actually manage it), so busy
 * intervals now come directly from this system's own Confirmed
 * appointments — the literal source of truth, not a synced copy of it.
 * One tradeoff from this: an external commitment a doctor puts only on
 * their personal calendar (never entered here as Leave) no longer
 * blocks booking slots automatically — see doctor_leaves for how to
 * block time instead.
 */
export async function getAvailableSlotsForDoctor(
  supabase: SupabaseClient<Database>,
  params: { doctor: Doctor; dateString: string; timezone: string }
): Promise<Date[]> {
  const { doctor, dateString, timezone } = params;

  if (await isDoctorOnLeave(supabase, doctor.id, dateString)) {
    return [];
  }

  const availabilityRows = await getDoctorAvailabilityForDate(
    supabase,
    doctor.id,
    dateString
  );

  if (availabilityRows.length === 0) {
    return [];
  }

  const windows = availabilityRows.map((row) => ({
    start: combineDateAndTime(dateString, row.start_time, timezone),
    end: combineDateAndTime(dateString, row.end_time, timezone)
  }));

  const busyIntervals = await getBusyIntervalsFromAppointments(supabase, doctor, dateString, timezone);

  return computeAvailableSlots({
    windows,
    busyIntervals,
    slotDurationMinutes: doctor.appointment_duration_minutes
  });
}

/**
 * One busy interval per Confirmed appointment this doctor already has
 * on `dateString`, using the doctor's *current*
 * appointment_duration_minutes for the interval length — same
 * simplification the rest of the app already makes (see
 * CONFIGURATION.md: changing slot length only affects future
 * computations, not a record of what duration a past booking used).
 */
async function getBusyIntervalsFromAppointments(
  supabase: SupabaseClient<Database>,
  doctor: Doctor,
  dateString: string,
  timezone: string
): Promise<TimeWindow[]> {
  const { data, error } = await supabase
    .from("appointments")
    .select("appointment_time")
    .eq("doctor_id", doctor.id)
    .eq("appointment_date", dateString)
    .eq("status", "Confirmed");

  if (error) {
    throw new Error(`Failed to load existing appointments: ${error.message}`);
  }

  return data.map((row) => {
    const start = combineDateAndTime(dateString, row.appointment_time, timezone);
    return {
      start,
      end: new Date(start.getTime() + doctor.appointment_duration_minutes * 60_000)
    };
  });
}
