import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { cleanupMessageLog } from "@/lib/logCleanup";

/**
 * Scheduled job: message_log retention cleanup (lib/logCleanup.ts).
 * Configured to run daily in vercel.json — log volume grows slowly
 * enough relative to LOG_RETENTION/LOG_MAX_ROWS that this doesn't need
 * the tighter cadence the reminders job does.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorizedCronRequest(request)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const supabase = getSupabaseServerClient();

  try {
    const result = await cleanupMessageLog(supabase);
    return NextResponse.json(result);
  } catch (error) {
    console.error("cleanupMessageLog cron job failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
