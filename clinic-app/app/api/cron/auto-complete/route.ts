import { NextRequest, NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { autoCompletePastAppointments } from "@/lib/autoComplete";

/**
 * Scheduled job: auto-mark past Confirmed appointments Completed
 * (lib/autoComplete.ts). Configured to run hourly in vercel.json — this
 * one has no tight eligibility window to protect the way reminders do
 * (AUTO_COMPLETE_HOURS_AFTER is typically several hours), so a coarser
 * cadence than the reminders job is fine.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorizedCronRequest(request)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const env = getServerEnv();
  const supabase = getSupabaseServerClient();

  try {
    const result = await autoCompletePastAppointments(supabase, env.CLINIC_TIMEZONE);
    return NextResponse.json(result);
  } catch (error) {
    console.error("autoCompletePastAppointments cron job failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
