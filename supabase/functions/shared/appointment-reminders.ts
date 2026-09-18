/**
 * Appointment Reminders Service
 * Handles creation and sending of appointment reminders with idempotency
 * 
 * Reminders: 24-hour and 1-hour before appointment
 * Idempotency: Tracked via appointment_reminders table (UNIQUE on appointment_id + reminder_type)
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as types from "./multi-clinic-types.ts";
import { debug } from "./logger.ts";
import { clinicInstant, getClinicTimezone } from "./clinic-slots.ts";
import { formatClockTime, formatLongDate } from "./appointment-format.ts";

/**
 * Who or what the appointment is with.
 *
 * A sample collection has no doctor. The fallback used to be the literal
 * string "Dr.", which the template then prefixed again: "Dr. Dr.". Shown on a
 * line of its own with no label, because no one label fits both: "With:" is
 * wrong for a service and "Doctor:" is wrong for one too.
 */
export function reminderSubject(
  doctorName: string | undefined,
  serviceName: string | undefined,
  language: string
): string {
  const hi = language === "HI";

  if (doctorName) {
    return hi ? `डॉ. ${doctorName}` : `Dr. ${doctorName}`;
  }

  return serviceName || (hi ? "अपॉइंटमेंट" : "Appointment");
}

export function formatReminderMessage(
  content: types.ReminderMessageContent
): string {
  const { reminderType, patientName, doctorName, serviceName, appointmentDate, appointmentTime, language } = content;

  const hi = language === "HI";
  const subject = reminderSubject(doctorName, serviceName, language);
  const when = formatClockTime(appointmentTime);
  const day = formatLongDate(appointmentDate, language);

  if (hi) {
    if (reminderType === "24_HOUR") {
      return `👋 नमस्ते ${patientName}!\n\nकल आपकी विज़िट की याद:\n\n🩺 ${subject}\n📅 ${day}\n🕐 ${when}\n\nकुछ बदलना हो तो नीचे दिए गए बटन दबाएं।`;
    }

    return `⏰ ${patientName}, आपकी विज़िट लगभग 1 घंटे में है।\n\n🩺 ${subject}\n🕐 ${when}\n\nकृपया समय पर पहुंचें। धन्यवाद!`;
  }

  if (reminderType === "24_HOUR") {
    return `👋 Hi ${patientName}!\n\nA reminder for your visit tomorrow:\n\n🩺 ${subject}\n📅 ${day}\n🕐 ${when}\n\nUse the buttons below if you need to change anything.`;
  }

  return `⏰ ${patientName}, your visit is in about an hour.\n\n🩺 ${subject}\n🕐 ${when}\n\nPlease arrive on time. Thank you!`;
}

/**
 * Create pending reminders for an appointment
 * Called when appointment is booked
 */
export async function createAppointmentReminders(
  supabase: SupabaseClient,
  clinicId: string,
  appointmentId: string,
  appointmentDate: string,  // YYYY-MM-DD
  appointmentTime: string   // HH:MM
): Promise<{ success: boolean; error?: string }> {
  try {
    const timezone = await getClinicTimezone(supabase, clinicId);
    const appointmentDateTime = clinicInstant(appointmentDate, appointmentTime, timezone);

    const reminder24h = new Date(appointmentDateTime.getTime() - 24 * 60 * 60 * 1000);
    const reminder1h = new Date(appointmentDateTime.getTime() - 60 * 60 * 1000);

    // A booking made inside the window has already missed that reminder. Left
    // PENDING it is simply overdue, so the scheduler fires it on its next pass
    // -- which is how booking at 23:52 for 11:30 tomorrow produced a "reminder"
    // one minute later.
    const now = Date.now();
    const statusFor = (at: Date) => (at.getTime() > now ? "PENDING" : "SKIPPED");

    const reminders = [
      {
        clinic_id: clinicId,
        appointment_id: appointmentId,
        reminder_type: "24_HOUR",
        scheduled_time: reminder24h.toISOString(),
        status: statusFor(reminder24h)
      },
      {
        clinic_id: clinicId,
        appointment_id: appointmentId,
        reminder_type: "1_HOUR",
        scheduled_time: reminder1h.toISOString(),
        status: statusFor(reminder1h)
      }
    ];

    // Get patient phone from appointment
    const { data: appointment, error: fetchError } = await supabase
      .from("appointments")
      .select("patient_phone, patient_name")
      .eq("id", appointmentId)
      .single();

    if (fetchError || !appointment) {
      return { success: false, error: `Appointment not found: ${appointmentId}` };
    }

    // Add patient phone to reminders
    const remindersWithPhone = reminders.map(r => ({
      ...r,
      patient_phone: appointment.patient_phone
    }));

    // Insert reminders (idempotency: UNIQUE constraint prevents duplicates)
    const { error: insertError } = await supabase
      .from("appointment_reminders")
      .insert(remindersWithPhone);

    if (insertError) {
      // UNIQUE violation is expected if reminders already exist
      if (insertError.code === "23505") {
        debug("reminders", "Reminders already exist for appointment", { appointmentId });
        return { success: true };
      }
      return { success: false, error: insertError.message };
    }

    debug("reminders", "Created appointment reminders", { appointmentId });
    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    debug("reminders", "Error creating reminders", { error: errorMsg });
    return { success: false, error: errorMsg };
  }
}

/**
 * Get pending reminders that should be sent now
 */
export async function getPendingReminders(
  supabase: SupabaseClient,
  clinicId: string
): Promise<types.AppointmentReminder[]> {
  try {
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from("appointment_reminders")
      .select("*")
      .eq("clinic_id", clinicId)
      .eq("status", "PENDING")
      .lte("scheduled_time", now)  // scheduled_time <= now
      .order("scheduled_time", { ascending: true });

    if (error) {
      debug("reminders", "Error fetching pending reminders", { error: error.message });
      return [];
    }

    return data || [];
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    debug("reminders", "Error getting pending reminders", { error: errorMsg });
    return [];
  }
}

/**
 * Mark reminder as sent (idempotent via message_id)
 */
export async function markReminderAsSent(
  supabase: SupabaseClient,
  reminderId: string,
  messageId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Read-then-write: assigning a query builder to `attempts` produced an
    // unserialisable payload, so the row never moved off PENDING.
    const { data: current } = await supabase
      .from("appointment_reminders")
      .select("attempts")
      .eq("id", reminderId)
      .maybeSingle();

    const { error } = await supabase
      .from("appointment_reminders")
      .update({
        status: "SENT",
        sent_at: new Date().toISOString(),
        message_id: messageId,
        attempts: (current?.attempts ?? 0) + 1
      })
      .eq("id", reminderId);

    if (error) {
      return { success: false, error: error.message };
    }

    debug("reminders", "Marked reminder as sent", { reminderId, messageId });
    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    debug("reminders", "Error marking reminder as sent", { error: errorMsg });
    return { success: false, error: errorMsg };
  }
}

/**
 * Mark reminder as failed with retry logic
 */
export async function markReminderAsFailed(
  supabase: SupabaseClient,
  reminderId: string,
  errorMessage: string,
  /** Set when sending it again unchanged cannot work, such as a closed window. */
  permanent = false
): Promise<{ success: boolean; shouldRetry: boolean }> {
  try {
    // Fetch current attempts
    const { data: reminder, error: fetchError } = await supabase
      .from("appointment_reminders")
      .select("attempts, max_attempts")
      .eq("id", reminderId)
      .single();

    if (fetchError || !reminder) {
      return { success: false, shouldRetry: false };
    }

    const nextAttempt = reminder.attempts + 1;
    const shouldRetry = !permanent && nextAttempt < reminder.max_attempts;
    const newStatus = shouldRetry ? "PENDING" : "FAILED";

    const { error: updateError } = await supabase
      .from("appointment_reminders")
      .update({
        status: newStatus,
        error_message: errorMessage,
        attempts: nextAttempt,
        updated_at: new Date().toISOString()
      })
      .eq("id", reminderId);

    if (updateError) {
      return { success: false, shouldRetry: false };
    }

    debug("reminders", `Marked reminder as ${newStatus}`, { 
      reminderId, 
      attempts: nextAttempt, 
      maxAttempts: reminder.max_attempts 
    });

    return { success: true, shouldRetry };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    debug("reminders", "Error marking reminder as failed", { error: errorMsg });
    return { success: false, shouldRetry: false };
  }
}

/**
 * Mark reminder as skipped (e.g., appointment cancelled before reminder sent)
 */
export async function markReminderAsSkipped(
  supabase: SupabaseClient,
  appointmentId: string,
  reminderType: "24_HOUR" | "1_HOUR"
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from("appointment_reminders")
      .update({
        status: "SKIPPED",
        updated_at: new Date().toISOString()
      })
      .eq("appointment_id", appointmentId)
      .eq("reminder_type", reminderType)
      // One already sent stays SENT: it happened, and rewriting it to SKIPPED
      // would lose the only record that the patient was messaged.
      .eq("status", "PENDING");

    if (error) {
      return { success: false, error: error.message };
    }

    debug("reminders", "Marked reminder as skipped", { appointmentId, reminderType });
    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    debug("reminders", "Error marking reminder as skipped", { error: errorMsg });
    return { success: false, error: errorMsg };
  }
}

/**
 * Stop both reminders for an appointment.
 *
 * Cancelling used to leave them PENDING, so the scheduler still messaged the
 * patient about a visit that was no longer happening.
 */
export async function skipAppointmentReminders(
  supabase: SupabaseClient,
  appointmentId: string
): Promise<void> {
  await markReminderAsSkipped(supabase, appointmentId, "24_HOUR");
  await markReminderAsSkipped(supabase, appointmentId, "1_HOUR");
}

/**
 * Move an appointment's reminders to a new date and time.
 *
 * One already sent is reset rather than left alone: it told the patient a time
 * that no longer applies, so the new time needs its own reminder.
 */
export async function rescheduleAppointmentReminders(
  supabase: SupabaseClient,
  clinicId: string,
  appointmentId: string,
  appointmentDate: string,
  appointmentTime: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const timezone = await getClinicTimezone(supabase, clinicId);
    const appointmentDateTime = clinicInstant(appointmentDate, appointmentTime, timezone);
    const now = Date.now();

    const scheduleFor: Array<["24_HOUR" | "1_HOUR", Date]> = [
      ["24_HOUR", new Date(appointmentDateTime.getTime() - 24 * 60 * 60 * 1000)],
      ["1_HOUR", new Date(appointmentDateTime.getTime() - 60 * 60 * 1000)]
    ];

    for (const [reminderType, at] of scheduleFor) {
      const { error } = await supabase
        .from("appointment_reminders")
        .update({
          scheduled_time: at.toISOString(),
          status: at.getTime() > now ? "PENDING" : "SKIPPED",
          sent_at: null,
          message_id: null,
          error_message: null,
          attempts: 0,
          updated_at: new Date().toISOString()
        })
        .eq("appointment_id", appointmentId)
        .eq("clinic_id", clinicId)
        .eq("reminder_type", reminderType);

      if (error) {
        return { success: false, error: error.message };
      }
    }

    debug("reminders", "Moved reminders", { appointmentId, appointmentDate, appointmentTime });
    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    debug("reminders", "Error moving reminders", { error: errorMsg });
    return { success: false, error: errorMsg };
  }
}

/**
 * Get appointment details for reminder formatting
 */
export async function getAppointmentDetailsForReminder(
  supabase: SupabaseClient,
  appointmentId: string
): Promise<{
  patientName?: string;
  patientPhone?: string;
  doctorName?: string;
  serviceName?: string;
  appointmentDate?: string;
  appointmentTime?: string;
  preferredLanguage?: string;
  error?: string;
}> {
  try {
    const { data, error } = await supabase
      .from("appointments")
      .select(`
        patient_name,
        patient_phone,
        appointment_date,
        appointment_time,
        preferred_language,
        doctor:doctors(name),
        service_type:service_types(name)
      `)
      .eq("id", appointmentId)
      .single();

    if (error) {
      return { error: error.message };
    }

    // PostgREST returns an object for a to-one embed.
    const row = data as unknown as {
      patient_name: string;
      patient_phone: string;
      appointment_date: string;
      appointment_time: string;
      preferred_language: string | null;
      doctor: { name: string } | null;
      service_type: { name: string } | null;
    };

    return {
      patientName: row.patient_name,
      patientPhone: row.patient_phone,
      // Left undefined rather than defaulted: the caller decides what to say
      // when a service has no doctor.
      doctorName: row.doctor?.name || undefined,
      serviceName: row.service_type?.name || undefined,
      appointmentDate: row.appointment_date,
      appointmentTime: row.appointment_time,
      preferredLanguage: row.preferred_language || "EN"
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return { error: errorMsg };
  }
}
