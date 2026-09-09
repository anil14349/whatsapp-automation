import { NextRequest, NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { sendAppointmentReminders } from "@/lib/reminders";

/**
 * Scheduled job: appointment reminders (lib/reminders.ts). Configured to
 * run every 30 minutes in vercel.json — the Apps Script version's
 * installAppointmentReminderTrigger comment explains the cadence choice
 * (comfortable overlap with the default 45-minute eligibility window
 * even accounting for scheduler jitter); the same reasoning applies here.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorizedCronRequest(request)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const env = getServerEnv();
  const supabase = getSupabaseServerClient();

  try {
    const result = await sendAppointmentReminders(supabase, env.CLINIC_TIMEZONE);
    return NextResponse.json(result);
  } catch (error) {
    console.error("sendAppointmentReminders cron job failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
