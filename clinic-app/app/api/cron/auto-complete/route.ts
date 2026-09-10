/**
 * Auto-Complete Cron Job
 *
 * POST /api/cron/auto-complete
 *
 * Automatically mark past appointments as completed.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const maxDuration = 60;

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
    // Get past appointments that are still "Confirmed"
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

    const { data: appointments, error: apptError } = await supabase
      .from("appointments")
      .select("id, appointment_date")
      .eq("clinic_id", clinicId)
      .eq("status", "Confirmed")
      .lt("appointment_date", twoHoursAgo.toISOString().split("T")[0]);

    if (apptError) {
      console.error("Failed to fetch appointments:", apptError);
      return NextResponse.json(
        { success: false, error: "Failed to fetch appointments" },
        { status: 500 }
      );
    }

    const appointmentIds = (appointments || []).map((a: any) => a.id);

    if (appointmentIds.length === 0) {
      return NextResponse.json({
        success: true,
        appointments_completed: 0,
        timestamp: new Date().toISOString()
      });
    }

    const { error: updateError } = await supabase
      .from("appointments")
      .update({ status: "Completed", updated_at: new Date().toISOString() })
      .in("id", appointmentIds);

    if (updateError) {
      console.error("Failed to update appointments:", updateError);
      return NextResponse.json(
        { success: false, error: "Failed to update appointments" },
        { status: 500 }
      );
    }

    console.log(`Auto-completed ${appointmentIds.length} appointments`);

    return NextResponse.json({
      success: true,
      appointments_completed: appointmentIds.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Auto-complete job error:", error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        appointments_completed: 0
      },
      { status: 500 }
    );
  }
}
