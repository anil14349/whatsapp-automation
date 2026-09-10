/**
 * Cron Job Execution Engine
 *
 * Load and execute cron jobs from database.
 * Determines which jobs should run based on schedule expression.
 * Tracks execution history and errors.
 *
 * Example:
 *   const scheduler = new CronJobScheduler(supabase);
 *   const jobsToRun = await scheduler.getJobsToRun();
 *   for (const job of jobsToRun) {
 *     await scheduler.executeJob(job);
 *   }
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export interface CronJob {
  id: string;
  clinic_id: string;
  job_name: string;
  schedule_expression: string;
  endpoint: string;
  enabled: boolean;
  timeout_seconds: number;
  retry_count: number;
  retry_delay_seconds: number;
  last_run_at?: string;
  next_run_at?: string;
  last_error?: string;
}

export interface CronJobExecution {
  job_id: string;
  clinic_id: string;
  started_at: Date;
  completed_at?: Date;
  status: "pending" | "running" | "completed" | "failed";
  error?: string;
  duration_ms?: number;
}

/**
 * Parse cron expression and determine if job should run at given time
 *
 * Format: minute hour day month weekday
 * Example: "*/30 * * * *" means every 30 minutes
 */
export function shouldCronJobRun(
  cronExpression: string,
  atTime: Date = new Date()
): boolean {
  try {
    const [minute, hour, day, month, weekday] = cronExpression.split(" ");

    const currentMinute = atTime.getMinutes();
    const currentHour = atTime.getHours();
    const currentDay = atTime.getDate();
    const currentMonth = atTime.getMonth() + 1; // 1-12
    const currentWeekday = atTime.getDay(); // 0-6 (Sunday=0)

    // Helper to check if value matches cron field
    const matches = (cronField: string, value: number): boolean => {
      if (cronField === "*") return true;

      if (cronField.startsWith("*/")) {
        const interval = parseInt(cronField.substring(2));
        return value % interval === 0;
      }

      if (cronField.includes(",")) {
        return cronField.split(",").some((v) => matches(v, value));
      }

      if (cronField.includes("-")) {
        const [start, end] = cronField.split("-").map(Number);
        return value >= start && value <= end;
      }

      return parseInt(cronField) === value;
    };

    return (
      matches(minute, currentMinute) &&
      matches(hour, currentHour) &&
      (day === "*" || matches(day, currentDay)) &&
      (month === "*" || matches(month, currentMonth)) &&
      (weekday === "*" || matches(weekday, currentWeekday))
    );
  } catch (error) {
    console.error("Invalid cron expression:", cronExpression, error);
    return false;
  }
}

/**
 * Calculate next run time for a cron job
 */
export function getNextCronRunTime(
  cronExpression: string,
  fromTime: Date = new Date()
): Date {
  const nextTime = new Date(fromTime);

  // Try up to 24 hours in the future
  for (let i = 0; i < 1440; i++) {
    nextTime.setMinutes(nextTime.getMinutes() + 1);

    if (shouldCronJobRun(cronExpression, nextTime)) {
      return nextTime;
    }
  }

  // If no match found in 24 hours, return current time + 1 hour
  nextTime.setHours(nextTime.getHours() + 1);
  return nextTime;
}

/**
 * Cron Job Scheduler
 */
export class CronJobScheduler {
  constructor(private supabase: SupabaseClient<Database>) {}

  /**
   * Get all enabled cron jobs for a clinic
   */
  async getClinicJobs(clinicId: string): Promise<CronJob[]> {
    try {
      const { data, error } = await this.supabase
        .from("trigger_cron_jobs")
        .select("*")
        .eq("clinic_id", clinicId)
        .eq("enabled", true);

      if (error) throw error;

      return data || [];
    } catch (error) {
      console.error("Failed to load cron jobs:", error);
      return [];
    }
  }

  /**
   * Get jobs that should run now
   */
  async getJobsToRun(clinicId: string): Promise<CronJob[]> {
    const jobs = await this.getClinicJobs(clinicId);
    const now = new Date();

    return jobs.filter((job) => {
      // Check if enough time has passed since last run
      if (job.last_run_at) {
        const lastRun = new Date(job.last_run_at);
        const minutesElapsed = (now.getTime() - lastRun.getTime()) / (1000 * 60);

        // Don't run the same job more than once per minute
        if (minutesElapsed < 1) {
          return false;
        }
      }

      return shouldCronJobRun(job.schedule_expression, now);
    });
  }

  /**
   * Execute a single cron job
   */
  async executeJob(
    job: CronJob,
    options?: { maxRetries?: number; timeout?: number }
  ): Promise<CronJobExecution> {
    const execution: CronJobExecution = {
      job_id: job.id,
      clinic_id: job.clinic_id,
      started_at: new Date(),
      status: "running"
    };

    const timeout = options?.timeout || job.timeout_seconds * 1000;
    const maxRetries = options?.maxRetries || job.retry_count;

    try {
      // Call the job endpoint
      const response = await this.callJobEndpoint(job.endpoint, job.clinic_id, timeout);

      if (!response.ok) {
        throw new Error(`Job failed with status ${response.status}`);
      }

      execution.status = "completed";
      execution.completed_at = new Date();
      execution.duration_ms = execution.completed_at.getTime() - execution.started_at.getTime();

      // Update job last run time
      await this.updateJobRunTime(job.id, execution.completed_at, null);

      return execution;
    } catch (error) {
      execution.status = "failed";
      execution.error = error instanceof Error ? error.message : String(error);
      execution.completed_at = new Date();
      execution.duration_ms = execution.completed_at.getTime() - execution.started_at.getTime();

      // Retry if available
      if (maxRetries > 0) {
        console.warn(
          `Job ${job.job_name} failed, retrying (${maxRetries} retries left)...`
        );
        await new Promise((resolve) =>
          setTimeout(resolve, job.retry_delay_seconds * 1000)
        );
        return this.executeJob(job, {
          maxRetries: maxRetries - 1,
          timeout
        });
      }

      // Update job with error
      await this.updateJobRunTime(job.id, execution.started_at, execution.error);

      return execution;
    }
  }

  /**
   * Call the job endpoint
   */
  private async callJobEndpoint(
    endpoint: string,
    clinicId: string,
    timeout: number
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const url = endpoint.startsWith("http")
        ? endpoint
        : `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}${endpoint}`;

      return await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Clinic-ID": clinicId,
          "X-Cron-Job": "true"
        },
        body: JSON.stringify({ clinic_id: clinicId, timestamp: new Date().toISOString() }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Update job run time and error
   */
  private async updateJobRunTime(
    jobId: string,
    lastRunAt: Date,
    lastError: string | null
  ): Promise<void> {
    const nextRunAt = getNextCronRunTime(
      // Get the actual job to get its schedule
      (await this.supabase
        .from("trigger_cron_jobs")
        .select("schedule_expression")
        .eq("id", jobId)
        .single()
        .then((r) => r.data?.schedule_expression)) || "* * * * *"
    );

    try {
      await this.supabase
        .from("trigger_cron_jobs")
        .update({
          last_run_at: lastRunAt.toISOString(),
          next_run_at: nextRunAt.toISOString(),
          last_error: lastError
        })
        .eq("id", jobId);
    } catch (error) {
      console.error("Failed to update job run time:", error);
    }
  }
}

/**
 * Helper to check if a cron schedule is valid
 */
export function isValidCronExpression(expression: string): boolean {
  try {
    const parts = expression.split(" ");
    if (parts.length !== 5) return false;

    // Try to parse each part
    for (const part of parts) {
      if (part === "*") continue;
      if (part.startsWith("*/")) {
        const interval = parseInt(part.substring(2));
        if (!Number.isInteger(interval) || interval <= 0) return false;
      } else if (part.includes(",")) {
        for (const v of part.split(",")) {
          if (!isNaN(Number(v))) continue;
          return false;
        }
      } else if (part.includes("-")) {
        const [start, end] = part.split("-").map(Number);
        if (!Number.isInteger(start) || !Number.isInteger(end)) return false;
      } else {
        if (isNaN(Number(part))) return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}
