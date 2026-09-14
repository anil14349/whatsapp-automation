/**
 * Appointment Reminders Service
 * Handles creation and sending of appointment reminders with idempotency
 * 
 * Reminders: 24-hour and 1-hour before appointment
 * Idempotency: Tracked via appointment_reminders table (UNIQUE on appointment_id + reminder_type)
 */

import { SupabaseClient } from "@supabase/supabase-js";
import * as types from "./multi-clinic-types.ts";
import { debug } from "./logger.ts";

/**
 * Format reminder message for patient
 */
export function formatReminderMessage(
  content: types.ReminderMessageContent
): string {
  const { reminderType, patientName, doctorName, appointmentDate, appointmentTime, language } = content;

  if (language === "HI") {
    if (reminderType === "24_HOUR") {
      return `👋 नमस्ते ${patientName}!\n\n📅 याद दिला रहे हैं: आपकी डॉ. ${doctorName} के साथ कल ${appointmentTime} बजे अपॉइंटमेंट है।\n\nयदि आप रद्द या स्थगित करना चाहते हैं तो हमें बताएं।`;
    } else {
      return `⏰ ${patientName}, आपकी अपॉइंटमेंट 1 घंटे में है!\n\n👨‍⚕️ डॉ. ${doctorName}\n⏰ समय: ${appointmentTime}\n📅 तारीख: ${appointmentDate}\n\nकृपया समय पर पहुंचें। धन्यवाद!`;
    }
  } else {
    // English
    if (reminderType === "24_HOUR") {
      return `👋 Hi ${patientName}!\n\n📅 Reminder: You have an appointment with Dr. ${doctorName} tomorrow at ${appointmentTime}.\n\nLet us know if you need to cancel or reschedule.`;
    } else {
      return `⏰ ${patientName}, your appointment is in 1 hour!\n\n👨‍⚕️ Dr. ${doctorName}\n⏰ Time: ${appointmentTime}\n📅 Date: ${appointmentDate}\n\nPlease arrive on time. Thank you!`;
    }
  }
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
    // Calculate reminder times (24 hours and 1 hour before)
    const appointmentDateTime = new Date(`${appointmentDate}T${appointmentTime}:00`);
    
    const reminder24h = new Date(appointmentDateTime.getTime() - 24 * 60 * 60 * 1000);
    const reminder1h = new Date(appointmentDateTime.getTime() - 60 * 60 * 1000);

    const reminders = [
      {
        clinic_id: clinicId,
        appointment_id: appointmentId,
        reminder_type: "24_HOUR",
        scheduled_time: reminder24h.toISOString(),
        status: "PENDING"
      },
      {
        clinic_id: clinicId,
        appointment_id: appointmentId,
        reminder_type: "1_HOUR",
        scheduled_time: reminder1h.toISOString(),
        status: "PENDING"
      }
    ];

    // Get patient phone from appointment
    const { data: appointment, error: fetchError } = await supabase
      .from("appointments")
      .select("phone, patient_name")
      .eq("id", appointmentId)
      .single();

    if (fetchError || !appointment) {
      return { success: false, error: `Appointment not found: ${appointmentId}` };
    }

    // Add patient phone to reminders
    const remindersWithPhone = reminders.map(r => ({
      ...r,
      patient_phone: appointment.phone
    }));

    // Insert reminders (idempotency: UNIQUE constraint prevents duplicates)
    const { error: insertError } = await supabase
      .from("appointment_reminders")
      .insert(remindersWithPhone)
      .on("*", payload => {
        debug("reminders", "Reminder inserted", { payload });
      });

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
    const { error } = await supabase
      .from("appointment_reminders")
      .update({
        status: "SENT",
        sent_at: new Date().toISOString(),
        message_id: messageId,
        attempts: supabase.rpc("increment_attempts", { reminder_id: reminderId })
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
  errorMessage: string
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
    const shouldRetry = nextAttempt < reminder.max_attempts;
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
      .eq("reminder_type", reminderType);

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
 * Get appointment details for reminder formatting
 */
export async function getAppointmentDetailsForReminder(
  supabase: SupabaseClient,
  appointmentId: string
): Promise<{
  patientName?: string;
  patientPhone?: string;
  doctorName?: string;
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
        doctor:doctors(name)
      `)
      .eq("id", appointmentId)
      .single();

    if (error) {
      return { error: error.message };
    }

    return {
      patientName: data.patient_name,
      patientPhone: data.patient_phone,
      doctorName: data.doctor?.name || "Dr.",
      appointmentDate: data.appointment_date,
      appointmentTime: data.appointment_time,
      preferredLanguage: data.preferred_language || "EN"
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return { error: errorMsg };
  }
}
