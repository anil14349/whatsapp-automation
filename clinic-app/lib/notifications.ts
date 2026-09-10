import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { sendWhatsAppText } from "@/lib/whatsapp/send";

/**
 * Send WhatsApp notifications to patients when appointments change.
 * Used when receptionists edit appointments via admin portal.
 */

export interface AppointmentChangeNotification {
  patientPhone: string;
  patientName: string;
  doctorName: string;
  changeType: "TIME_CHANGED" | "DATE_CHANGED" | "DOCTOR_CHANGED" | "RESCHEDULED";
  oldValue?: string;
  newValue?: string;
  appointmentDate: string;
  appointmentTime: string;
  appointmentCode: string;
}

/**
 * Notify patient when appointment time changes (same day).
 */
export async function notifyAppointmentTimeChanged(params: {
  patientPhone: string;
  patientName: string;
  doctorName: string;
  oldTime: string;
  newTime: string;
  appointmentDate: string;
  appointmentCode: string;
}): Promise<{ success: boolean; message: string }> {
  const message = `👋 Hi ${params.patientName}!

Your appointment with ${params.doctorName} has been rescheduled.

📅 Date: ${params.appointmentDate}
🕐 Old Time: ${params.oldTime}
🕐 New Time: ${params.newTime}

Your appointment code: ${params.appointmentCode}

If you have any questions, please call the clinic.`;

  try {
    await sendWhatsAppText(params.patientPhone, message);
    return { success: true, message: "Time change notification sent" };
  } catch (error) {
    return {
      success: false,
      message: `Failed to send notification: ${error instanceof Error ? error.message : "Unknown error"}`
    };
  }
}

/**
 * Notify patient when appointment is rescheduled to different date.
 */
export async function notifyAppointmentRescheduled(params: {
  patientPhone: string;
  patientName: string;
  doctorName: string;
  oldDate: string;
  oldTime: string;
  newDate: string;
  newTime: string;
  appointmentCode: string;
}): Promise<{ success: boolean; message: string }> {
  const message = `👋 Hi ${params.patientName}!

Your appointment has been rescheduled.

📅 Old Date & Time: ${params.oldDate} at ${params.oldTime}
📅 New Date & Time: ${params.newDate} at ${params.newTime}

👨‍⚕️ Doctor: ${params.doctorName}
📋 Appointment Code: ${params.appointmentCode}

Please confirm if this new time works for you. If not, please call the clinic.`;

  try {
    await sendWhatsAppText(params.patientPhone, message);
    return { success: true, message: "Reschedule notification sent" };
  } catch (error) {
    return {
      success: false,
      message: `Failed to send notification: ${error instanceof Error ? error.message : "Unknown error"}`
    };
  }
}

/**
 * Notify patient when doctor is changed.
 */
export async function notifyDoctorChanged(params: {
  patientPhone: string;
  patientName: string;
  oldDoctorName: string;
  newDoctorName: string;
  newDoctorSpecialization?: string;
  appointmentDate: string;
  appointmentTime: string;
  appointmentCode: string;
}): Promise<{ success: boolean; message: string }> {
  const specialization = params.newDoctorSpecialization
    ? ` (${params.newDoctorSpecialization})`
    : "";

  const message = `👋 Hi ${params.patientName}!

Your doctor has been changed for your upcoming appointment.

👨‍⚕️ Previous Doctor: ${params.oldDoctorName}
👨‍⚕️ New Doctor: ${params.newDoctorName}${specialization}

📅 Appointment: ${params.appointmentDate} at ${params.appointmentTime}
📋 Appointment Code: ${params.appointmentCode}

If you have any concerns about this change, please call the clinic.`;

  try {
    await sendWhatsAppText(params.patientPhone, message);
    return { success: true, message: "Doctor change notification sent" };
  } catch (error) {
    return {
      success: false,
      message: `Failed to send notification: ${error instanceof Error ? error.message : "Unknown error"}`
    };
  }
}

/**
 * Notify patient of generic appointment change.
 */
export async function notifyAppointmentChanged(params: {
  patientPhone: string;
  patientName: string;
  doctorName: string;
  appointmentDate: string;
  appointmentTime: string;
  appointmentCode: string;
  changeDescription: string;
}): Promise<{ success: boolean; message: string }> {
  const message = `👋 Hi ${params.patientName}!

Your appointment has been updated.

${params.changeDescription}

👨‍⚕️ Doctor: ${params.doctorName}
📅 Date & Time: ${params.appointmentDate} at ${params.appointmentTime}
📋 Appointment Code: ${params.appointmentCode}

Please confirm if this works for you. If you have questions, call the clinic.`;

  try {
    await sendWhatsAppText(params.patientPhone, message);
    return { success: true, message: "Appointment change notification sent" };
  } catch (error) {
    return {
      success: false,
      message: `Failed to send notification: ${error instanceof Error ? error.message : "Unknown error"}`
    };
  }
}

/**
 * Log notification attempt to database for tracking.
 */
export async function logNotificationAttempt(
  supabase: SupabaseClient<Database>,
  params: {
    patientPhone: string;
    appointmentId: string;
    notificationType: string;
    success: boolean;
    error?: string;
  }
): Promise<void> {
  await supabase.from("message_log").insert({
    sender_phone: "SYSTEM",
    message_type: "NOTIFICATION",
    message_content: JSON.stringify({
      type: "appointment_notification",
      appointmentId: params.appointmentId,
      notificationType: params.notificationType,
      success: params.success,
      error: params.error,
      timestamp: new Date().toISOString()
    }),
    received_at: new Date().toISOString()
  });
}

/**
 * Check if patient opted in to notifications.
 * For now, all patients get notifications unless explicitly disabled.
 */
export async function shouldNotifyPatient(
  supabase: SupabaseClient<Database>,
  patientId: string
): Promise<boolean> {
  // In future, could add a notifications_enabled flag to patients table
  // For now, return true (notify all)
  return true;
}
