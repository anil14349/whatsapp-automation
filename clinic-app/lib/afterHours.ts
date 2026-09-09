import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Weekday } from "@/lib/supabase/database.types";
import { getBooleanSetting, getSetting } from "@/lib/settings";
import { combineDateAndTime, formatDateKey, isoDateToWeekday, parseTimeOfDay } from "@/lib/scheduling/dates";
import { localizeWhatsAppReply } from "@/lib/whatsapp/localize";
import type { WhatsAppSession } from "@/lib/sessions";

/**
 * Clinic-hours gate and after-hours auto-reply for patients. Ports
 * src/Model_AfterHours.gs. Called from lib/whatsapp/router.ts before
 * dispatching to the patient flow — a doctor (by role or by
 * whatsapp_phone match, checked by the caller) is never gated, and a
 * patient already mid-conversation (any state other than MAIN_MENU/no
 * session) is never interrupted, same as the original's
 * isActivePatientFlowSession check.
 */

const CLINIC_DAY_ALIASES: Record<string, Weekday> = {
  mon: "Monday",
  monday: "Monday",
  tue: "Tuesday",
  tues: "Tuesday",
  tuesday: "Tuesday",
  wed: "Wednesday",
  weds: "Wednesday",
  wednesday: "Wednesday",
  thu: "Thursday",
  thur: "Thursday",
  thurs: "Thursday",
  thursday: "Thursday",
  fri: "Friday",
  friday: "Friday",
  sat: "Saturday",
  saturday: "Saturday",
  sun: "Sunday",
  sunday: "Sunday"
};

const DEFAULT_WORKING_DAYS: Weekday[] = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday"
];

export function parseClinicWorkingDays(value: string): Weekday[] {
  const raw = value.trim();

  if (!raw) {
    return DEFAULT_WORKING_DAYS;
  }

  const seen = new Set<Weekday>();
  const days: Weekday[] = [];

  for (const part of raw.split(",")) {
    const day = CLINIC_DAY_ALIASES[part.trim().toLowerCase()];

    if (day && !seen.has(day)) {
      seen.add(day);
      days.push(day);
    }
  }

  return days.length > 0 ? days : DEFAULT_WORKING_DAYS;
}

const SHORT_DAY_NAMES: Record<Weekday, string> = {
  Monday: "Mon",
  Tuesday: "Tue",
  Wednesday: "Wed",
  Thursday: "Thu",
  Friday: "Fri",
  Saturday: "Sat",
  Sunday: "Sun"
};

export function formatClinicWorkingDaysForDisplay(workingDays: Weekday[]): string {
  if (workingDays.length === 0) {
    return "Mon–Sat";
  }

  if (workingDays.length === 1) {
    return SHORT_DAY_NAMES[workingDays[0]!];
  }

  return `${SHORT_DAY_NAMES[workingDays[0]!]}–${SHORT_DAY_NAMES[workingDays[workingDays.length - 1]!]}`;
}

export function formatClinicTimeForDisplay(value: string): string {
  const parsed = parseTimeOfDay(value);

  if (!parsed) {
    return value.trim();
  }

  const suffix = parsed.hours >= 12 ? "PM" : "AM";
  const hour12 = parsed.hours % 12 === 0 ? 12 : parsed.hours % 12;

  return `${hour12}:${String(parsed.minutes).padStart(2, "0")} ${suffix}`;
}

export interface AfterHoursSettings {
  enabled: boolean;
  openTime: string;
  closeTime: string;
  workingDays: Weekday[];
  customMessage: string;
}

export async function getAfterHoursSettings(
  supabase: SupabaseClient<Database>
): Promise<AfterHoursSettings> {
  const [enabled, openTime, closeTime, workingDaysRaw, customMessage] = await Promise.all([
    getBooleanSetting(supabase, "ENABLE_AFTER_HOURS_REPLY", false),
    getSetting(supabase, "CLINIC_OPEN_TIME", "09:00"),
    getSetting(supabase, "CLINIC_CLOSE_TIME", "18:00"),
    getSetting(supabase, "CLINIC_WORKING_DAYS", "Mon,Tue,Wed,Thu,Fri,Sat"),
    getSetting(supabase, "AFTER_HOURS_MESSAGE", "")
  ]);

  return {
    enabled,
    openTime,
    closeTime,
    workingDays: parseClinicWorkingDays(workingDaysRaw),
    customMessage: customMessage.trim()
  };
}

export function isWithinClinicHours(
  now: Date,
  settings: AfterHoursSettings,
  timezone: string
): boolean {
  const todayDateString = formatDateKey(now, timezone);
  const todayWeekday = isoDateToWeekday(todayDateString);

  if (!settings.workingDays.includes(todayWeekday)) {
    return false;
  }

  const openAt = parseTimeOfDay(settings.openTime);
  const closeAt = parseTimeOfDay(settings.closeTime);

  if (!openAt || !closeAt) {
    // Fail open (treat as within clinic hours) rather than blocking
    // patients on a configuration typo — same reasoning as the Apps
    // Script version, logged loudly so the misconfiguration doesn't go
    // unnoticed indefinitely.
    console.error(
      `isWithinClinicHours: could not parse CLINIC_OPEN_TIME/CLINIC_CLOSE_TIME (openTime=${settings.openTime}, closeTime=${settings.closeTime}). Treating as within clinic hours.`
    );
    return true;
  }

  const openInstant = combineDateAndTime(todayDateString, settings.openTime, timezone);
  const closeInstant = combineDateAndTime(todayDateString, settings.closeTime, timezone);

  return now.getTime() >= openInstant.getTime() && now.getTime() < closeInstant.getTime();
}

/** A session is "actively mid-conversation" for gating purposes if it exists and isn't idling at the main menu. */
function isActivePatientFlowSession(session: WhatsAppSession | null): boolean {
  if (!session || !session.state) {
    return false;
  }

  return session.state !== "MAIN_MENU";
}

export interface AfterHoursGateParams {
  session: WhatsAppSession | null;
  isDoctor: boolean;
  timezone: string;
}

export async function shouldBlockPatientForAfterHours(
  supabase: SupabaseClient<Database>,
  params: AfterHoursGateParams
): Promise<boolean> {
  if (params.isDoctor || params.session?.role === "DOCTOR") {
    return false;
  }

  const settings = await getAfterHoursSettings(supabase);

  if (!settings.enabled) {
    return false;
  }

  if (isWithinClinicHours(new Date(), settings, params.timezone)) {
    return false;
  }

  if (isActivePatientFlowSession(params.session)) {
    return false;
  }

  return true;
}

export function buildAfterHoursMessage(
  language: string,
  clinicName: string,
  settings: AfterHoursSettings
): string {
  if (settings.customMessage) {
    return settings.customMessage;
  }

  const hoursLine = `${formatClinicWorkingDaysForDisplay(settings.workingDays)}, ${formatClinicTimeForDisplay(settings.openTime)} – ${formatClinicTimeForDisplay(settings.closeTime)}`;

  const message =
    "🕐 {{CLINIC_NAME}} is currently closed.\n\n" +
    `Our hours: ${hoursLine}\n\n` +
    "Please message us during clinic hours to book or manage appointments.\n\n" +
    "Reply Hi during open hours to get started.";

  return localizeWhatsAppReply(language, message, clinicName);
}
