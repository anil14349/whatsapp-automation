/**
 * Appointment Reminder Cron Job
 *
 * POST /api/cron/appointment-reminders
 *
 * Sends appointment reminders to patients.
 * Called by: /api/cron/execute endpoint
 *
 * Config in database:
 *   job_name: "appointment_reminders"
 *   schedule_expression: "*/30 * * * *" (every 30 minutes)
 *   endpoint: "/api/cron/appointment-reminders"
 *   timeout_seconds: 300
 *
 * What it does:
 *   1. Get appointments happening in the next N hours (from clinic setting)
 *   2. Get patients who haven't been reminded yet
 *   3. Load reminder template from database
 *   4. Interpolate patient/doctor/appointment details
 *   5. Send via WhatsApp
 *   6. Track analytics
 *   7. Return success count
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { sendWhatsAppText } from "@/lib/whatsapp/send";
import { getTemplateAndInterpolate } from "@/lib/triggers/templates";
import { getAppointmentReminderHours } from "@/lib/triggers/clinicSettings";
import { trackTemplateSent, trackTemplateError } from "@/lib/triggers/analytics";
import type { Appointment } from "@/lib/appointments";

export const maxDuration = 60; // 1 minute per job

export async function POST(request: NextRequest): Promise<NextResponse> {
  const supabase = getSupabaseServerClient();
  const clinicId = request.headers.get("X-Clinic-ID");

  if (!clinicId) {
    return NextResponse.json(
      { success: false, error: "Missing X-Clinic-ID header" },
      { status: 400 }
    );
  }

  try {
    const reminderHours = await getAppointmentReminderHours(supabase, clinicId);

    // Get appointments in the next N hours
    const now = new Date();
    const futureTime = new Date(now.getTime() + reminderHours * 60 * 60 * 1000);

    const { data: appointments, error: apptError } = await supabase
      .from("appointments")
      .select("*")
      .eq("clinic_id", clinicId)
      .eq("status", "Confirmed")
      .gte("appointment_date", now.toISOString().split("T")[0])
      .lte("appointment_date", futureTime.toISOString().split("T")[0])
      .is("reminder_sent_at", null); // Not yet reminded

    if (apptError) {
      console.error("Failed to fetch appointments:", apptError);
      return NextResponse.json(
        { success: false, error: "Failed to fetch appointments" },
        { status: 500 }
      );
    }

    let reminderssent = 0;
    let remindersFailed = 0;
    const errors: string[] = [];

    // Get doctor info for each appointment
    for (const appointment of appointments || []) {
      try {
        // Get doctor details
        const { data: doctor } = await supabase
          .from("doctors")
          .select("name")
          .eq("id", appointment.doctor_id)
          .single();

        // Load template from database
        const message = await getTemplateAndInterpolate(
          supabase,
          clinicId,
          "APPOINTMENT_REMINDER",
          "EN", // TODO: Get patient language from database
          {
            patient_name: appointment.patient_name,
            doctor_name: doctor?.name || "Your Doctor",
            appointment_date: appointment.appointment_date,
            appointment_time: appointment.appointment_time,
            appointment_code: appointment.id.slice(0, 8).toUpperCase()
          },
          {
            fallbackBody: `Hi ${appointment.patient_name}! Your appointment with ${doctor?.name || "Your Doctor"} is on ${appointment.appointment_date} at ${appointment.appointment_time}.`
          }
        );

        // Send message
        await sendWhatsAppText(appointment.patient_phone, message);

        // Mark appointment as reminded
        await supabase
          .from("appointments")
          .update({ reminder_sent_at: new Date().toISOString() })
          .eq("id", appointment.id);

        // Track analytics
        await trackTemplateSent(
          supabase,
          clinicId,
          "APPOINTMENT_REMINDER",
          "EN",
          appointment.patient_phone
        );

        reminderssent++;
      } catch (error) {
        remindersFailed++;
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push(`${appointment.id}: ${errorMsg}`);

        // Track error
        await trackTemplateError(
          supabase,
          clinicId,
          "APPOINTMENT_REMINDER",
          "EN",
          errorMsg,
          appointment.patient_phone
        );
      }
    }

    console.log(
      `Appointment reminders: ${reminderssent} sent, ${remindersFailed} failed`
    );

    return NextResponse.json({
      success: true,
      reminders_sent: reminderssent,
      reminders_failed: remindersFailed,
      errors: errors.length > 0 ? errors : undefined,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Appointment reminder job error:", error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        reminders_sent: 0,
        reminders_failed: 0
      },
      { status: 500 }
    );
  }
}
