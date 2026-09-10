/**
 * Cron Job Execution Endpoint
 *
 * POST /api/cron/execute
 *
 * Executes all scheduled cron jobs that are due to run.
 * Called by external cron scheduler (Vercel Cron, AWS EventBridge, etc.)
 *
 * Authentication: X-Cron-Token header must match CRON_SECRET_TOKEN env var
 *
 * Request:
 *   {
 *     "clinic_id": "uuid",  // Optional: if not provided, runs for all clinics
 *     "job_name": "string"  // Optional: if provided, runs only this job
 *   }
 *
 * Response:
 *   {
 *     "success": true,
 *     "jobs_executed": 5,
 *     "jobs_failed": 1,
 *     "results": [
 *       {
 *         "clinic_id": "uuid",
 *         "job_name": "appointment_reminders",
 *         "status": "completed",
 *         "duration_ms": 2500,
 *         "error": null
 *       }
 *     ]
 *   }
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getServerEnv } from "@/lib/env";
import { CronJobScheduler } from "@/lib/triggers/cronJobs";

export const maxDuration = 300; // 5 minutes

export async function POST(request: NextRequest): Promise<NextResponse> {
  const env = getServerEnv();
  const cronToken = request.headers.get("X-Cron-Token") || request.nextUrl.searchParams.get("token") || "";

  // Validate cron token
  if (!env.CRON_SECRET_TOKEN || cronToken !== env.CRON_SECRET_TOKEN) {
    console.error("Cron endpoint: Invalid or missing token");
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const clinicId = body.clinic_id as string | undefined;
    const jobName = body.job_name as string | undefined;

    const supabase = getSupabaseServerClient();
    const scheduler = new CronJobScheduler(supabase);

    const results: Array<{
      clinic_id: string;
      job_name: string;
      status: string;
      duration_ms?: number;
      error?: string;
    }> = [];

    let jobsExecuted = 0;
    let jobsFailed = 0;

    // If clinic_id is provided, run jobs for that clinic
    if (clinicId) {
      const jobsToRun = await scheduler.getJobsToRun(clinicId);
      const filtered = jobName
        ? jobsToRun.filter((j) => j.job_name === jobName)
        : jobsToRun;

      for (const job of filtered) {
        const execution = await scheduler.executeJob(job);

        results.push({
          clinic_id: clinicId,
          job_name: job.job_name,
          status: execution.status,
          duration_ms: execution.duration_ms,
          error: execution.error
        });

        if (execution.status === "completed") {
          jobsExecuted++;
        } else {
          jobsFailed++;
        }
      }
    } else {
      // Run jobs for all clinics
      const clinics = await getClinicsWithJobs(supabase);

      for (const clinic of clinics) {
        const jobsToRun = await scheduler.getJobsToRun(clinic.id);
        const filtered = jobName
          ? jobsToRun.filter((j) => j.job_name === jobName)
          : jobsToRun;

        for (const job of filtered) {
          const execution = await scheduler.executeJob(job);

          results.push({
            clinic_id: clinic.id,
            job_name: job.job_name,
            status: execution.status,
            duration_ms: execution.duration_ms,
            error: execution.error
          });

          if (execution.status === "completed") {
            jobsExecuted++;
          } else {
            jobsFailed++;
          }
        }
      }
    }

    // Log summary
    console.log(
      `Cron execution complete: ${jobsExecuted} succeeded, ${jobsFailed} failed`
    );

    return NextResponse.json({
      success: true,
      jobs_executed: jobsExecuted,
      jobs_failed: jobsFailed,
      total_results: results.length,
      results
    });
  } catch (error) {
    console.error("Cron execution error:", error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        jobs_executed: 0,
        jobs_failed: 0,
        results: []
      },
      { status: 500 }
    );
  }
}

/**
 * Get all clinics that have enabled cron jobs
 */
async function getClinicsWithJobs(
  supabase: ReturnType<typeof getSupabaseServerClient>
): Promise<Array<{ id: string; name: string }>> {
  try {
    // Get distinct clinic IDs from enabled cron jobs
    const { data, error } = await supabase
      .from("trigger_cron_jobs")
      .select("clinic_id")
      .eq("enabled", true)
      .distinct();

    if (error) {
      console.error("Failed to get clinics with jobs:", error);
      return [];
    }

    // Get clinic details
    const clinicIds = data?.map((row: any) => row.clinic_id) || [];

    if (clinicIds.length === 0) {
      return [];
    }

    const { data: clinics, error: clinicError } = await supabase
      .from("clinics")
      .select("id, name")
      .in("id", clinicIds);

    if (clinicError) {
      console.error("Failed to get clinic details:", clinicError);
      return [];
    }

    return clinics || [];
  } catch (error) {
    console.error("Failed to get clinics with jobs:", error);
    return [];
  }
}

/**
 * GET endpoint for health check / manual trigger
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const cronToken = request.nextUrl.searchParams.get("token") || "";
  const env = getServerEnv();

  // Validate token
  if (!env.CRON_SECRET_TOKEN || cronToken !== env.CRON_SECRET_TOKEN) {
    return NextResponse.json(
      { message: "Cron endpoint is ready. Use POST to execute jobs." },
      { status: 200 }
    );
  }

  return NextResponse.json({
    message: "Cron endpoint is ready",
    timestamp: new Date().toISOString(),
    docs: "POST /api/cron/execute with X-Cron-Token header"
  });
}
