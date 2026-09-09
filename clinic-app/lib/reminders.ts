import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { getBooleanSetting, getSetting } from "@/lib/settings";
import { getDoctorById } from "@/lib/doctors";
import { findPatientByPhone } from "@/lib/patients";
import { combineDateAndTime, formatTimeLabel } from "@/lib/scheduling/dates";
import { hasReminderBeenSent, logMessage } from "@/lib/whatsapp/log";
import { sendWhatsAppText } from "@/lib/whatsapp/send";
import { localizeWhatsAppReply } from "@/lib/whatsapp/localize";

/**
 * Appointment reminder scheduling. Ports src/Model_Reminders.gs's
 * sendAppointmentReminders — meant to be called on a schedule (see
 * app/api/cron/reminders/route.ts) rather than per-message like the
 * conversation-flow files.
 *
 * The dedup ledger (has this appointment+lead-time reminder already
 * been sent?) is the message_log table itself (direction="REMINDER"),
 * same as the Apps Script version's WhatsApp_Log sheet rows — just a
 * real indexed query (message_log_reminder_dedup_idx) instead of a full
 * sheet scan.
 */

export interface ReminderRunResult {
  enabled: boolean;
  checked: number;
  sent: number;
  skipped: number;
  errors: number;
}

const SUPPORTED_LANGUAGES = new Set(["EN", "TE", "HI", "KA", "TA", "ML"]);

function parseHoursBeforeList(raw: string): number[] {
  const hours = raw
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);

  return hours.length > 0 ? hours : [24];
}

async function resolvePatientLanguage(
  supabase: SupabaseClient<Database>,
  phone: string
): Promise<string> {
  const patient = await findPatientByPhone(supabase, phone);
  const language = patient?.language?.trim().toUpperCase() ?? "";
  return SUPPORTED_LANGUAGES.has(language) ? language : "EN";
}

function buildReminderMessage(
  doctorName: string,
  dateLabel: string,
  timeLabel: string,
  appointmentCode: string,
  hoursBefore: number
): string {
  const hoursLabel = hoursBefore === 1 ? "1 hour" : `${hoursBefore} hours`;

  return (
    "🔔 Appointment Reminder\n\n" +
    `Reminder: ${hoursLabel} before your appointment.\n\n` +
    `Doctor: ${doctorName}\n` +
    `Date: ${dateLabel}\n` +
    `Time: ${timeLabel}\n` +
    `Appointment ID: ${appointmentCode}\n\n` +
    "Reply Hi to reschedule or cancel."
  );
}

export async function sendAppointmentReminders(
  supabase: SupabaseClient<Database>,
  timezone: string
): Promise<ReminderRunResult> {
  const enabled = await getBooleanSetting(supabase, "ENABLE_APPOINTMENT_REMINDERS", true);

  if (!enabled) {
    return { enabled: false, checked: 0, sent: 0, skipped: 0, errors: 0 };
  }

  const [hoursBeforeRaw, windowMinutesRaw, clinicName] = await Promise.all([
    getSetting(supabase, "REMINDER_HOURS_BEFORE", "24"),
    getSetting(supabase, "REMINDER_WINDOW_MINUTES", "45"),
    getSetting(supabase, "CLINIC_NAME", "ABC Clinic")
  ]);

  const hoursBeforeList = parseHoursBeforeList(hoursBeforeRaw);
  const windowMinutesParsed = Number(windowMinutesRaw);
  const windowMs = (windowMinutesParsed > 0 ? windowMinutesParsed : 45) * 60 * 1000;

  const { data: appointments, error } = await supabase
    .from("appointments")
    .select("*")
    .eq("status", "Confirmed");

  if (error) {
    throw new Error(`Failed to load appointments for reminders: ${error.message}`);
  }

  const now = Date.now();
  const result: ReminderRunResult = { enabled: true, checked: 0, sent: 0, skipped: 0, errors: 0 };

  for (const appointment of appointments) {
    const appointmentStart = combineDateAndTime(
      appointment.appointment_date,
      appointment.appointment_time,
      timezone
    );

    if (appointmentStart.getTime() <= now) {
      continue;
    }

    result.checked++;

    for (const hoursBefore of hoursBeforeList) {
      const reminderTarget = appointmentStart.getTime() - hoursBefore * 60 * 60 * 1000;
      const elapsed = now - reminderTarget;

      if (elapsed < 0 || elapsed > windowMs) {
        continue;
      }

      if (await hasReminderBeenSent(supabase, appointment.id, hoursBefore)) {
        result.skipped++;
        continue;
      }

      try {
        const doctor = await getDoctorById(supabase, appointment.doctor_id);
        const language = await resolvePatientLanguage(supabase, appointment.patient_phone);

        const message = localizeWhatsAppReply(
          language,
          buildReminderMessage(
            doctor?.name ?? "Doctor",
            appointment.appointment_date,
            formatTimeLabel(appointmentStart, timezone),
            appointment.appointment_code,
            hoursBefore
          ),
          clinicName
        );

        await sendWhatsAppText(appointment.patient_phone, message);

        await logMessage(supabase, {
          direction: "REMINDER",
          phone: appointment.patient_phone,
          status: "SUCCESS",
          appointmentId: appointment.id,
          hoursBefore
        });

        result.sent++;
      } catch (sendError) {
        await logMessage(supabase, {
          direction: "REMINDER",
          phone: appointment.patient_phone,
          status: `ERROR: ${sendError instanceof Error ? sendError.message : String(sendError)}`,
          appointmentId: appointment.id,
          hoursBefore
        });

        result.errors++;
        console.error(`Reminder failed for appointment ${appointment.id}:`, sendError);
      }
    }
  }

  return result;
}
