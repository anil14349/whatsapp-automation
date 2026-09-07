/**
 * Pure slot-availability computation. Ported from getAvailableSlots in
 * src/Model_Calendar.gs, with one behavioral improvement: the old
 * version called the Calendar API once per candidate slot until a later
 * fix batched it to once per day (see README "Reliability & security
 * hardening"). This port takes `busyIntervals` as a plain argument so
 * that fix is the *only* way it's ever been written here — there's no
 * per-slot I/O to accidentally regress to, since this function does no
 * I/O at all.
 */

export interface TimeWindow {
  start: Date;
  end: Date;
}

export interface ComputeAvailableSlotsParams {
  /** Doctor's working hours windows on the target date (from doctor_availability). */
  windows: TimeWindow[];
  /** Existing Calendar events (or booked appointments) to avoid overlapping. */
  busyIntervals: TimeWindow[];
  /** Appointment slot length. */
  slotDurationMinutes: number;
  /** Defaults to `new Date()` — injectable so tests are deterministic. */
  now?: Date;
}

/**
 * Returns the start Date of every bookable slot: inside a working-hours
 * window, not overlapping any busy interval, and not already in the
 * past. Slots are deduplicated and returned in chronological order.
 *
 * Note there's no separate "is this window's date today" check (the
 * Apps Script original had one, via a `sameDay` flag) — comparing
 * `slotStart` directly against `now` gives the identical result without
 * it: a window on a genuinely future date always has every slot after
 * `now` anyway, so the extra check was redundant, and dropping it avoids
 * a timezone-ambiguity trap (a "day" boundary depends on which timezone
 * you ask, `now` doesn't).
 */
export function computeAvailableSlots(
  params: ComputeAvailableSlotsParams
): Date[] {
  const { windows, busyIntervals, slotDurationMinutes } = params;
  const now = params.now ?? new Date();

  if (slotDurationMinutes <= 0) {
    throw new Error("slotDurationMinutes must be positive");
  }

  const slotDurationMs = slotDurationMinutes * 60_000;

  const slots: Date[] = [];
  const seen = new Set<number>();

  for (const window of windows) {
    let current = window.start.getTime();
    const windowEnd = window.end.getTime();

    while (current + slotDurationMs <= windowEnd) {
      const slotStart = current;
      const slotEnd = current + slotDurationMs;

      const isPast = slotStart <= now.getTime();

      const hasConflict = busyIntervals.some(
        (busy) => busy.start.getTime() < slotEnd && busy.end.getTime() > slotStart
      );

      if (!isPast && !hasConflict && !seen.has(slotStart)) {
        seen.add(slotStart);
        slots.push(new Date(slotStart));
      }

      current += slotDurationMs;
    }
  }

  slots.sort((a, b) => a.getTime() - b.getTime());

  return slots;
}
