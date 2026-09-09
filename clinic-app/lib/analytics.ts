import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { listDoctors, type Doctor } from "@/lib/doctors";
import { isoDateToWeekday, parseTimeOfDay } from "@/lib/scheduling/dates";

/**
 * Reporting queries for the admin Analytics page: booking volume over
 * time, no-show rate, and doctor slot utilization. Mirrors the query
 * style already used in app/admin/(dashboard)/page.tsx (count queries via
 * `.select("id", { count: "exact", head: true })`, row queries via
 * `.select("*")`/`.select("col")` with filters) rather than introducing a
 * new pattern, and does client-side aggregation in JS instead of adding a
 * SQL RPC/migration for GROUP BY — plain queries + JS aggregation are
 * plenty for a reporting page's data volumes.
 */

export interface DateRange {
  fromDate: string; // "YYYY-MM-DD", inclusive
  toDate: string; // "YYYY-MM-DD", inclusive
}

// ------------------------------------------------------------------
// Pure helpers (no I/O) — kept separate from the Supabase fetches below
// so the math is unit-testable without a live client.
// ------------------------------------------------------------------

/** Every "YYYY-MM-DD" date from fromDate to toDate, inclusive, in order. */
export function enumerateDateRange(fromDate: string, toDate: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${fromDate}T00:00:00Z`);
  const end = new Date(`${toDate}T00:00:00Z`);

  while (cursor.getTime() <= end.getTime()) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

export interface BookingVolumeDay {
  date: string;
  count: number;
}

/**
 * Groups a flat list of appointment_date strings into per-day counts,
 * filling in zero-count days so the range has no gaps (needed for a
 * continuous bar-per-day visualization).
 */
export function aggregateBookingVolumeByDay(
  appointmentDates: string[],
  range: DateRange
): BookingVolumeDay[] {
  const counts = new Map<string, number>();

  for (const date of appointmentDates) {
    counts.set(date, (counts.get(date) ?? 0) + 1);
  }

  return enumerateDateRange(range.fromDate, range.toDate).map((date) => ({
    date,
    count: counts.get(date) ?? 0
  }));
}

/**
 * No-show rate = count(status = 'No-Show') / count(status in
 * ('Completed', 'No-Show')). Deliberately excludes still-`Confirmed`
 * appointments (in the future — haven't happened yet, so whether the
 * patient will show up isn't known) and `Cancelled` appointments (never
 * happened at all — the patient didn't "no-show" a cancelled slot) from
 * the denominator. The rate should only be measured against appointments
 * that were actually supposed to occur.
 *
 * Returns null (not NaN) when there's no Completed/No-Show activity in
 * range to divide by.
 */
export function computeNoShowRate(counts: { completed: number; noShow: number }): number | null {
  const denominator = counts.completed + counts.noShow;

  if (denominator === 0) {
    return null;
  }

  return counts.noShow / denominator;
}

/** Minutes between two "HH:MM[:SS]" times; null if either fails to parse. */
function minutesBetween(startTime: string, endTime: string): number | null {
  const start = parseTimeOfDay(startTime);
  const end = parseTimeOfDay(endTime);

  if (!start || !end) {
    return null;
  }

  return end.hours * 60 + end.minutes - (start.hours * 60 + start.minutes);
}

export interface AvailabilityWindow {
  day_of_week: Database["public"]["Tables"]["doctor_availability"]["Row"]["day_of_week"];
  start_time: string;
  end_time: string;
}

/**
 * Theoretical slot capacity for one doctor across a date range: for each
 * calendar day, look up that weekday's availability windows, sum
 * floor((end - start) / slotDurationMinutes) slots per window, and zero
 * out any day the doctor is on active leave.
 */
export function computeDoctorCapacity(params: {
  fromDate: string;
  toDate: string;
  slotDurationMinutes: number;
  availability: AvailabilityWindow[];
  leaveDates: ReadonlySet<string>;
}): number {
  const { availability, leaveDates, slotDurationMinutes } = params;

  if (slotDurationMinutes <= 0) {
    return 0;
  }

  let capacity = 0;

  for (const date of enumerateDateRange(params.fromDate, params.toDate)) {
    if (leaveDates.has(date)) {
      continue;
    }

    const weekday = isoDateToWeekday(date);

    for (const window of availability) {
      if (window.day_of_week !== weekday) {
        continue;
      }

      const minutes = minutesBetween(window.start_time, window.end_time);

      if (minutes && minutes > 0) {
        capacity += Math.floor(minutes / slotDurationMinutes);
      }
    }
  }

  return capacity;
}

/** booked / capacity, as a 0..1 fraction. Null (not NaN/Infinity) when capacity is 0. */
export function computeUtilization(booked: number, capacity: number): number | null {
  if (capacity <= 0) {
    return null;
  }

  return booked / capacity;
}

// ------------------------------------------------------------------
// Supabase-backed fetches
// ------------------------------------------------------------------

export async function getBookingVolumeByDay(
  supabase: SupabaseClient<Database>,
  range: DateRange
): Promise<BookingVolumeDay[]> {
  // "Booking volume" = bookings made/existing regardless of outcome, so
  // every status is included here (unlike no-show rate / utilization,
  // which deliberately filter by status).
  const { data, error } = await supabase
    .from("appointments")
    .select("appointment_date")
    .gte("appointment_date", range.fromDate)
    .lte("appointment_date", range.toDate);

  if (error) {
    throw new Error(`Failed to load booking volume: ${error.message}`);
  }

  return aggregateBookingVolumeByDay(
    data.map((row) => row.appointment_date),
    range
  );
}

export interface NoShowRateByDoctor {
  doctorId: string;
  doctorName: string;
  completed: number;
  noShow: number;
  rate: number | null;
}

export interface NoShowRateResult {
  overall: { completed: number; noShow: number; rate: number | null };
  byDoctor: NoShowRateByDoctor[];
}

export async function getNoShowRate(
  supabase: SupabaseClient<Database>,
  range: DateRange,
  // Optional: pass an already-fetched doctor list (e.g. from the page,
  // which also needs it for getDoctorUtilization) to avoid querying the
  // doctors table twice per page render.
  preloadedDoctors?: Doctor[]
): Promise<NoShowRateResult> {
  const [doctors, { data, error }] = await Promise.all([
    preloadedDoctors ? Promise.resolve(preloadedDoctors) : listDoctors(supabase),
    supabase
      .from("appointments")
      .select("doctor_id, status")
      .gte("appointment_date", range.fromDate)
      .lte("appointment_date", range.toDate)
      .in("status", ["Completed", "No-Show"])
  ]);

  if (error) {
    throw new Error(`Failed to load no-show data: ${error.message}`);
  }

  const perDoctorCounts = new Map<string, { completed: number; noShow: number }>();

  for (const row of data) {
    const counts = perDoctorCounts.get(row.doctor_id) ?? { completed: 0, noShow: 0 };

    if (row.status === "Completed") {
      counts.completed += 1;
    } else {
      counts.noShow += 1;
    }

    perDoctorCounts.set(row.doctor_id, counts);
  }

  const byDoctor: NoShowRateByDoctor[] = doctors.map((doctor) => {
    const counts = perDoctorCounts.get(doctor.id) ?? { completed: 0, noShow: 0 };

    return {
      doctorId: doctor.id,
      doctorName: doctor.name,
      completed: counts.completed,
      noShow: counts.noShow,
      rate: computeNoShowRate(counts)
    };
  });

  const overallCounts = data.reduce(
    (acc, row) => {
      if (row.status === "Completed") {
        acc.completed += 1;
      } else {
        acc.noShow += 1;
      }

      return acc;
    },
    { completed: 0, noShow: 0 }
  );

  return {
    overall: { ...overallCounts, rate: computeNoShowRate(overallCounts) },
    byDoctor
  };
}

export interface DoctorUtilization {
  doctorId: string;
  doctorName: string;
  booked: number;
  capacity: number;
  utilization: number | null;
}

// Every appointment that consumed a real slot: Confirmed (booked, hasn't
// happened yet), Completed, and No-Show. Cancelled is excluded — a
// cancelled appointment frees the slot back up.
const BOOKED_STATUSES = ["Confirmed", "Completed", "No-Show"] as const;

export async function getDoctorUtilization(
  supabase: SupabaseClient<Database>,
  range: DateRange,
  // Optional: pass an already-fetched doctor list to avoid querying the
  // doctors table twice per page render (see getNoShowRate above).
  preloadedDoctors?: Doctor[]
): Promise<DoctorUtilization[]> {
  const [doctors, bookedResult, availabilityResult, leavesResult] = await Promise.all([
    preloadedDoctors ? Promise.resolve(preloadedDoctors) : listDoctors(supabase),
    supabase
      .from("appointments")
      .select("doctor_id, status")
      .gte("appointment_date", range.fromDate)
      .lte("appointment_date", range.toDate)
      .in("status", [...BOOKED_STATUSES]),
    supabase.from("doctor_availability").select("*"),
    // NOT lib/doctors.ts's getDoctorUpcomingLeaves — that's "from today
    // forward" only and would give wrong results for a historical date
    // range. Query doctor_leaves directly instead.
    supabase
      .from("doctor_leaves")
      .select("doctor_id, leave_date")
      .eq("active", true)
      .gte("leave_date", range.fromDate)
      .lte("leave_date", range.toDate)
  ]);

  if (bookedResult.error) {
    throw new Error(`Failed to load booked appointments: ${bookedResult.error.message}`);
  }

  if (availabilityResult.error) {
    throw new Error(`Failed to load doctor availability: ${availabilityResult.error.message}`);
  }

  if (leavesResult.error) {
    throw new Error(`Failed to load doctor leaves: ${leavesResult.error.message}`);
  }

  const bookedByDoctor = new Map<string, number>();

  for (const row of bookedResult.data) {
    bookedByDoctor.set(row.doctor_id, (bookedByDoctor.get(row.doctor_id) ?? 0) + 1);
  }

  const availabilityByDoctor = new Map<string, AvailabilityWindow[]>();

  for (const row of availabilityResult.data) {
    const windows = availabilityByDoctor.get(row.doctor_id) ?? [];
    windows.push(row);
    availabilityByDoctor.set(row.doctor_id, windows);
  }

  const leavesByDoctor = new Map<string, Set<string>>();

  for (const row of leavesResult.data) {
    const dates = leavesByDoctor.get(row.doctor_id) ?? new Set<string>();
    dates.add(row.leave_date);
    leavesByDoctor.set(row.doctor_id, dates);
  }

  return doctors.map((doctor) => {
    const capacity = computeDoctorCapacity({
      fromDate: range.fromDate,
      toDate: range.toDate,
      slotDurationMinutes: doctor.appointment_duration_minutes,
      availability: availabilityByDoctor.get(doctor.id) ?? [],
      leaveDates: leavesByDoctor.get(doctor.id) ?? new Set<string>()
    });
    const booked = bookedByDoctor.get(doctor.id) ?? 0;

    return {
      doctorId: doctor.id,
      doctorName: doctor.name,
      booked,
      capacity,
      utilization: computeUtilization(booked, capacity)
    };
  });
}
