import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { Doctor } from "@/lib/doctors";
import { getDoctorAvailabilityForDate, isDoctorOnLeave } from "@/lib/doctors";
import type { CalendarPort } from "@/lib/calendar/types";
import { computeAvailableSlots } from "./availability";
import { combineDateAndTime } from "./dates";

/**
 * I/O wrapper around the pure computeAvailableSlots() — was
 * getAvailableSlots() in src/Model_Calendar.gs. This is the only place
 * that touches both Supabase (availability/leaves) and the Calendar API
 * (busy events) to answer "what times can this doctor be booked at on
 * this date".
 */
export async function getAvailableSlotsForDoctor(
  supabase: SupabaseClient<Database>,
  calendar: CalendarPort,
  params: { doctor: Doctor; dateString: string; timezone: string }
): Promise<Date[]> {
  const { doctor, dateString, timezone } = params;

  if (!doctor.calendar_id) {
    return [];
  }

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

  // Anchor "the day" at local midnight so getEventsForDay's UTC-day
  // truncation still lines up with the clinic's calendar date for
  // timezones ahead of UTC (e.g. IST) — see computeAvailableSlots'
  // comment for why slot-vs-now comparison itself doesn't need this.
  const dayAnchor = combineDateAndTime(dateString, "00:00", timezone);

  const busyEvents = await calendar.getEventsForDay(doctor.calendar_id, dayAnchor);

  return computeAvailableSlots({
    windows,
    busyIntervals: busyEvents.map((event) => ({ start: event.start, end: event.end })),
    slotDurationMinutes: doctor.appointment_duration_minutes
  });
}
