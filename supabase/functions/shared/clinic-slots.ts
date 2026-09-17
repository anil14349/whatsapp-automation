/**
 * Slots for services that do not need a doctor.
 *
 * Existing slot logic is entirely doctor-driven — doctor hours, doctor leave,
 * that doctor's booked appointments — so a blood test with nobody assigned had
 * no source of times at all. These come from the clinic's own opening hours,
 * and a slot stays open until the service's concurrent capacity is used up,
 * because a diagnostic room is not a single doctor seeing one patient.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { debug } from "./logger.ts";
import type { ClinicService } from "./clinic-services.ts";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Today's date as the clinic sees it.
 *
 * Edge functions run on UTC, so `new Date()` is five and a half hours behind a
 * clinic in Asia/Kolkata. Every evening after 18:30 local the server's "today"
 * is still yesterday, which made the Today and Tomorrow buttons offer a date
 * that had already passed.
 */
export function todayInTimezone(timezone: string): string {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(new Date());

    const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";

    return `${part("year")}-${part("month")}-${part("day")}`;
}

export function addDays(date: string, days: number): string {
    const d = new Date(date + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

/**
 * The actual instant a clinic means by "2026-09-18 at 11:30".
 *
 * `new Date("2026-09-18T11:30:00")` is read as UTC by a runtime whose clock is
 * UTC, so for a clinic in Asia/Kolkata every such instant landed five and a
 * half hours late. Anything measured backwards from it inherited that: the
 * hour-before reminder for an 11:30 appointment came out at 16:00 local, four
 * and a half hours after the patient had been and gone.
 */
export function clinicInstant(date: string, time: string, timezone: string): Date {
    const naive = new Date(`${date}T${time}:00Z`);

    // Two passes, because the offset is itself a function of the instant and a
    // clinic near a DST boundary would otherwise be an hour out.
    let guess = new Date(naive.getTime() - zoneOffsetMs(naive, timezone));
    guess = new Date(naive.getTime() - zoneOffsetMs(guess, timezone));

    return guess;
}

/** How far ahead of UTC the zone is at that instant, in milliseconds. */
function zoneOffsetMs(instant: Date, timezone: string): number {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone,
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
    }).formatToParts(instant);

    const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");

    const asIfUtc = Date.UTC(
        part("year"),
        part("month") - 1,
        part("day"),
        part("hour") % 24,
        part("minute"),
        part("second")
    );

    return asIfUtc - instant.getTime();
}

/**
 * The clinic's own timezone, falling back to UTC when it has none set.
 */
export async function getClinicTimezone(
    supabase: SupabaseClient,
    clinicId: string
): Promise<string> {
    const { data } = await supabase
        .from("clinics")
        .select("timezone")
        .eq("id", clinicId)
        .maybeSingle();

    return data?.timezone || "UTC";
}

/**
 * Hours for one day.
 *
 * `clinic_operating_hours` holds a row per weekday and is what the doctor slot
 * path already uses; the open_time/close_time columns on `clinics` are a
 * single pair for the whole week. Reading only the latter offered Saturday
 * slots until 18:00 at a clinic that shuts at 14:00.
 */
export async function getClinicHoursForDay(
    supabase: SupabaseClient,
    clinicId: string,
    date: string
): Promise<{ openTime: string; closeTime: string; timezone: string } | null> {
    const { data: clinic } = await supabase
        .from("clinics")
        .select("open_time, close_time, working_days, timezone")
        .eq("id", clinicId)
        .maybeSingle();

    if (!clinic) {
        debug("clinicSlots", "Clinic not found", { clinicId });
        return null;
    }

    const timezone = clinic.timezone || "UTC";

    // Monday is 1 and Sunday is 7, matching the doctor hours lookup.
    const jsDay = new Date(date + "T00:00:00").getDay();
    const dayOfWeek = jsDay === 0 ? 7 : jsDay;

    const { data: perDay } = await supabase
        .from("clinic_operating_hours")
        .select("opening_time, closing_time, is_active")
        .eq("clinic_id", clinicId)
        .eq("day_of_week", dayOfWeek)
        .maybeSingle();

    if (perDay) {
        if (perDay.is_active === false) {
            return null;
        }

        const open = String(perDay.opening_time).slice(0, 5);
        const close = String(perDay.closing_time).slice(0, 5);

        // A clinic marks a closed day as 00:00-00:00 rather than deleting it.
        if (open === close) {
            return null;
        }

        return { openTime: open, closeTime: close, timezone };
    }

    // No row for this day: fall back to the week-wide hours.
    const dayName = DAY_NAMES[jsDay];
    const workingDays = String(clinic.working_days || "Mon,Tue,Wed,Thu,Fri,Sat")
        .split(",")
        .map((d: string) => d.trim())
        .filter(Boolean);

    if (!workingDays.includes(dayName)) {
        return null;
    }

    return {
        openTime: clinic.open_time || "09:00",
        closeTime: clinic.close_time || "18:00",
        timezone
    };
}

function minutesNowIn(timezone: string): { today: string; minutes: number } {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
    }).formatToParts(new Date());

    const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";

    return {
        today: `${part("year")}-${part("month")}-${part("day")}`,
        minutes: Number(part("hour")) * 60 + Number(part("minute"))
    };
}

function toMinutes(value: string): number {
    const [h, m] = value.split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
}

function toTimeString(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Why a date has no slots, when the reason is the clinic rather than demand.
 *
 * "Fully booked" and "we are shut that day" need different replies. Offering a
 * waitlist for a day the clinic is closed leaves the patient waiting for a slot
 * that is never going to appear.
 */
export type ClinicClosure = { reason: "holiday"; name: string } | { reason: "closed" };

export async function getClinicClosure(
    supabase: SupabaseClient,
    clinicId: string,
    date: string
): Promise<ClinicClosure | null> {
    const { data: holiday } = await supabase
        .from("clinic_holidays")
        .select("holiday_name")
        .eq("clinic_id", clinicId)
        .eq("holiday_date", date)
        .maybeSingle();

    if (holiday) {
        return { reason: "holiday", name: String(holiday.holiday_name ?? "").trim() };
    }

    const hours = await getClinicHoursForDay(supabase, clinicId, date);

    return hours ? null : { reason: "closed" };
}

/**
 * Times a doctor-free service can still be booked on this date.
 */
export async function getClinicServiceSlots(
    supabase: SupabaseClient,
    clinicId: string,
    service: ClinicService,
    date: string
): Promise<string[]> {
    const hours = await getClinicHoursForDay(supabase, clinicId, date);

    if (!hours) {
        return [];
    }

    const { data: closure } = await supabase
        .from("clinic_holidays")
        .select("id")
        .eq("clinic_id", clinicId)
        .eq("holiday_date", date)
        .maybeSingle();

    if (closure) {
        return [];
    }

    const { data: booked, error } = await supabase
        .from("appointments")
        .select("appointment_time")
        .eq("clinic_id", clinicId)
        .eq("service_type_id", service.serviceTypeId)
        .eq("appointment_date", date)
        .neq("status", "CANCELLED");

    if (error) {
        debug("clinicSlots", "Booked lookup failed", { clinicId, error: error.message });
        return [];
    }

    const takenBySlot: Record<string, number> = {};

    for (const row of booked ?? []) {
        const key = String(row.appointment_time).slice(0, 5);
        takenBySlot[key] = (takenBySlot[key] ?? 0) + 1;
    }

    const { today, minutes: nowMinutes } = minutesNowIn(hours.timezone);
    const isToday = date === today;

    const step = service.durationMinutes > 0 ? service.durationMinutes : 30;
    const open = toMinutes(hours.openTime);
    const close = toMinutes(hours.closeTime);

    const slots: string[] = [];

    // The whole appointment must fit before closing, so step past the last
    // start that would overrun.
    for (let time = open; time + step <= close; time += step) {
        if (isToday && time <= nowMinutes) {
            continue;
        }

        const label = toTimeString(time);

        if ((takenBySlot[label] ?? 0) < service.concurrentCapacity) {
            slots.push(label);
        }
    }

    return slots;
}

export async function isClinicServiceSlotAvailable(
    supabase: SupabaseClient,
    clinicId: string,
    service: ClinicService,
    date: string,
    time: string
): Promise<boolean> {
    const slots = await getClinicServiceSlots(supabase, clinicId, service, date);
    return slots.includes(time);
}
