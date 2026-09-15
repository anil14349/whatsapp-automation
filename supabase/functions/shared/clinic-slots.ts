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

interface ClinicHours {
    openTime: string;
    closeTime: string;
    workingDays: string[];
    timezone: string;
}

async function getClinicHours(
    supabase: SupabaseClient,
    clinicId: string
): Promise<ClinicHours | null> {
    const { data, error } = await supabase
        .from("clinics")
        .select("open_time, close_time, working_days, timezone")
        .eq("id", clinicId)
        .maybeSingle();

    if (error || !data) {
        debug("clinicSlots", "Clinic hours lookup failed", { clinicId });
        return null;
    }

    return {
        openTime: data.open_time || "09:00",
        closeTime: data.close_time || "18:00",
        workingDays: String(data.working_days || "Mon,Tue,Wed,Thu,Fri,Sat")
            .split(",")
            .map((d: string) => d.trim())
            .filter(Boolean),
        timezone: data.timezone || "UTC"
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
 * Times a doctor-free service can still be booked on this date.
 */
export async function getClinicServiceSlots(
    supabase: SupabaseClient,
    clinicId: string,
    service: ClinicService,
    date: string
): Promise<string[]> {
    const hours = await getClinicHours(supabase, clinicId);

    if (!hours) {
        return [];
    }

    const dayName = DAY_NAMES[new Date(date + "T00:00:00").getDay()];

    if (!hours.workingDays.includes(dayName)) {
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
