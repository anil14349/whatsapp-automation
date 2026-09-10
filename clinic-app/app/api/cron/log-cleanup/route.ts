/**
 * Log Cleanup Cron Job
 *
 * POST /api/cron/log-cleanup
 *
 * Clean up old logs and analytics data.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const maxDuration = 300;

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
    // Delete old message logs (>90 days)
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const { data: deletedLogs } = await supabase
      .from("message_log")
      .delete()
      .eq("clinic_id", clinicId)
      .lt("created_at", ninetyDaysAgo.toISOString());

    // Delete old analytics (>180 days)
    const oneEightyDaysAgo = new Date();
    oneEightyDaysAgo.setDate(oneEightyDaysAgo.getDate() - 180);

    const { data: deletedMenuAnalytics } = await supabase
      .from("menu_analytics")
      .delete()
      .eq("clinic_id", clinicId)
      .lt("timestamp", oneEightyDaysAgo.toISOString());

    const { data: deletedTemplateAnalytics } = await supabase
      .from("template_analytics")
      .delete()
      .eq("clinic_id", clinicId)
      .lt("timestamp", oneEightyDaysAgo.toISOString());

    console.log("Logs cleaned up");

    return NextResponse.json({
      success: true,
      logs_deleted: deletedLogs ? (deletedLogs as any[]).length : 0,
      menu_analytics_deleted: deletedMenuAnalytics
        ? (deletedMenuAnalytics as any[]).length
        : 0,
      template_analytics_deleted: deletedTemplateAnalytics
        ? (deletedTemplateAnalytics as any[]).length
        : 0,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Log cleanup job error:", error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}
