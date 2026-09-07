import type { Weekday } from "@/lib/supabase/database.types";

const WEEKDAYS: Weekday[] = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday"
];

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * True if `value` is a real calendar date in strict "YYYY-MM-DD" form
 * (rejects e.g. "2026-02-30", not just the regex shape).
 */
export function isValidISODate(value: string): boolean {
  const match = ISO_DATE_RE.exec(value);

  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const asUtc = new Date(Date.UTC(year, month - 1, day));

  return (
    asUtc.getUTCFullYear() === year &&
    asUtc.getUTCMonth() === month - 1 &&
    asUtc.getUTCDate() === day
  );
}

/**
 * Weekday name for a plain "YYYY-MM-DD" calendar date. Deliberately
 * anchors the computation in UTC rather than the server's local
 * timezone or the clinic's IANA timezone — a calendar date with no time
 * component has no timezone to begin with, so parsing it any other way
 * risks an off-by-one-day bug if the server process ever runs in a
 * different TZ than expected (a real class of bug the Apps Script
 * version was exposed to — see README "Reliability & security
 * hardening" section on the Monday-calculation bug it once had).
 */
export function isoDateToWeekday(dateString: string): Weekday {
  if (!isValidISODate(dateString)) {
    throw new Error(`Invalid date: ${dateString}`);
  }

  const match = ISO_DATE_RE.exec(dateString);
  const [, y, m, d] = match as RegExpExecArray;

  const utcDate = new Date(
    Date.UTC(Number(y), Number(m) - 1, Number(d))
  );

  const weekday = WEEKDAYS[utcDate.getUTCDay()];

  if (!weekday) {
    throw new Error(`Unreachable: weekday index out of range for ${dateString}`);
  }

  return weekday;
}

/**
 * Parses "HH:MM" or "HH:MM:SS" (as Postgres TIME columns come back) into
 * hours/minutes. Returns null instead of throwing on bad input, since
 * callers generally want to skip a malformed row rather than crash the
 * whole slot computation.
 */
export function parseTimeOfDay(
  value: string
): { hours: number; minutes: number } | null {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim());

  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours > 23 || minutes > 59) {
    return null;
  }

  return { hours, minutes };
}

/**
 * Combines a "YYYY-MM-DD" date with an "HH:MM[:SS]" time-of-day into a
 * single Date representing that instant in `timezone`. Used to compare
 * appointment slots against "now" and against Calendar event times.
 */
export function combineDateAndTime(
  dateString: string,
  timeString: string,
  timezone: string
): Date {
  const timeOfDay = parseTimeOfDay(timeString);

  if (!timeOfDay) {
    throw new Error(`Invalid time: ${timeString}`);
  }

  const offsetMinutes = getTimezoneOffsetMinutes(dateString, timezone);

  const [year, month, day] = ISO_DATE_RE.exec(dateString)!.slice(1).map(Number) as [
    number,
    number,
    number
  ];

  const utcMillis =
    Date.UTC(
      year,
      month - 1, // Date.UTC's month is 0-indexed; the parsed value isn't.
      day,
      timeOfDay.hours,
      timeOfDay.minutes
    ) - offsetMinutes * 60_000;

  return new Date(utcMillis);
}

/**
 * Offset (in minutes, e.g. +330 for IST) of `timezone` from UTC on the
 * given date. Computed via Intl rather than a hardcoded constant so it's
 * correct for timezones with DST (Asia/Kolkata has none, but this isn't
 * clinic-specific code — keep it general).
 */
function getTimezoneOffsetMinutes(dateString: string, timezone: string): number {
  const [y, m, d] = ISO_DATE_RE.exec(dateString)!.slice(1).map(Number) as [
    number,
    number,
    number
  ];

  // Noon UTC avoids any edge-of-day rounding from the formatter.
  const noonUtc = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(noonUtc).map((part) => [part.type, part.value])
  );

  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );

  return (asIfUtc - noonUtc.getTime()) / 60_000;
}

/** Human-readable "9:00 AM" style label for a Date, in the given timezone. */
export function formatTimeLabel(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).format(date);
}

/** "YYYY-MM-DD" for a Date, in the given timezone. */
export function formatDateKey(date: Date, timezone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value])
  );

  return `${parts.year}-${parts.month}-${parts.day}`;
}
