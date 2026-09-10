"use client";

import { useEffect, useState } from "react";
import { getSupabaseServerClient } from "@/lib/supabase/server";

interface CronJob {
  id: string;
  job_name: string;
  description?: string;
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

const CRON_PRESETS = {
  "Every 30 minutes": "*/30 * * * *",
  "Every hour": "0 * * * *",
  "Every 6 hours": "0 */6 * * *",
  "Daily at 1 AM": "0 1 * * *",
  "Daily at 9 AM": "0 9 * * *",
  "Weekdays at 9 AM": "0 9 * * 1-5",
  "First of month": "0 0 1 * *"
};

export function TriggerCronJobsManager() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingJob, setEditingJob] = useState<CronJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clinicId, setClinicId] = useState<string | null>(null);

  useEffect(() => {
    loadClinicId();
  }, []);

  useEffect(() => {
    if (clinicId) {
      loadJobs();
    }
  }, [clinicId]);

  async function loadClinicId() {
    try {
      const supabase = getSupabaseServerClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) return;

      const { data: clinicUser } = await supabase
        .from("clinic_users")
        .select("clinic_id")
        .eq("user_id", user.id)
        .single();

      if (clinicUser) {
        setClinicId(clinicUser.clinic_id);
      }
    } catch (err) {
      console.error("Failed to load clinic ID:", err);
    }
  }

  async function loadJobs() {
    try {
      setLoading(true);
      const supabase = getSupabaseServerClient();

      const { data, error: fetchError } = await supabase
        .from("trigger_cron_jobs")
        .select("*")
        .eq("clinic_id", clinicId)
        .order("job_name");

      if (fetchError) throw fetchError;

      setJobs(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load cron jobs");
    } finally {
      setLoading(false);
    }
  }

  async function saveJob(job: CronJob) {
    try {
      const supabase = getSupabaseServerClient();

      const { error: updateError } = await supabase
        .from("trigger_cron_jobs")
        .update({
          description: job.description,
          schedule_expression: job.schedule_expression,
          endpoint: job.endpoint,
          enabled: job.enabled,
          timeout_seconds: job.timeout_seconds,
          retry_count: job.retry_count,
          retry_delay_seconds: job.retry_delay_seconds
        })
        .eq("id", job.id);

      if (updateError) throw updateError;

      setJobs(jobs.map((j) => (j.id === job.id ? job : j)));
      setEditingJob(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save cron job");
    }
  }

  function parseCronExpression(expression: string): string {
    const parts = expression.split(" ");
    if (parts.length !== 5) return "Invalid cron expression";

    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
    const descriptions = [];

    // Build human-readable description
    if (minute === "*" && hour === "*") {
      descriptions.push("Every minute");
    } else if (minute === "*") {
      descriptions.push(`Every minute of hour ${hour}`);
    } else if (minute.startsWith("*/")) {
      const interval = minute.substring(2);
      descriptions.push(`Every ${interval} minutes`);
    } else if (hour.startsWith("*/")) {
      const interval = hour.substring(2);
      descriptions.push(`Every ${interval} hours`);
    } else {
      descriptions.push(`At ${hour}:${minute}`);
    }

    if (dayOfWeek !== "*") {
      descriptions.push(`(Weekdays: ${dayOfWeek})`);
    } else if (dayOfMonth !== "*") {
      descriptions.push(`(Day: ${dayOfMonth})`);
    }

    return descriptions.join(" ");
  }

  function formatDateTime(dateStr?: string): string {
    if (!dateStr) return "Never";
    const date = new Date(dateStr);
    return date.toLocaleString();
  }

  if (loading) {
    return <div className="text-center text-slate-500">Loading cron jobs...</div>;
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-2 text-xs underline"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="rounded-lg bg-blue-50 p-3 text-sm text-blue-600">
        ⏰ Cron jobs run on the server. Use standard cron format (minute hour day month weekday).
      </div>

      <div className="grid gap-4">
        {jobs.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-center">
            <p className="text-slate-600">No cron jobs found</p>
          </div>
        ) : (
          jobs.map((job) => (
            <div key={job.id} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-slate-900">{job.job_name}</h3>
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-medium ${
                        job.enabled
                          ? "bg-green-100 text-green-700"
                          : "bg-red-100 text-red-700"
                      }`}
                    >
                      {job.enabled ? "Enabled" : "Disabled"}
                    </span>
                  </div>

                  {job.description && (
                    <p className="mt-1 text-sm text-slate-600">{job.description}</p>
                  )}

                  <div className="mt-3 space-y-1 text-sm">
                    <div className="flex gap-2">
                      <span className="font-medium text-slate-700 w-28">Schedule:</span>
                      <code className="bg-slate-100 px-2 py-1 rounded text-slate-600">
                        {job.schedule_expression}
                      </code>
                    </div>
                    <div className="flex gap-2">
                      <span className="font-medium text-slate-700 w-28">Meaning:</span>
                      <span className="text-slate-600">{parseCronExpression(job.schedule_expression)}</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="font-medium text-slate-700 w-28">Endpoint:</span>
                      <code className="bg-slate-100 px-2 py-1 rounded text-slate-600">
                        {job.endpoint}
                      </code>
                    </div>
                    <div className="flex gap-2">
                      <span className="font-medium text-slate-700 w-28">Timeout:</span>
                      <span className="text-slate-600">{job.timeout_seconds}s</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="font-medium text-slate-700 w-28">Retries:</span>
                      <span className="text-slate-600">
                        {job.retry_count} times (delay: {job.retry_delay_seconds}s)
                      </span>
                    </div>

                    {job.last_run_at && (
                      <div className="flex gap-2">
                        <span className="font-medium text-slate-700 w-28">Last run:</span>
                        <span className="text-slate-600">{formatDateTime(job.last_run_at)}</span>
                      </div>
                    )}

                    {job.next_run_at && (
                      <div className="flex gap-2">
                        <span className="font-medium text-slate-700 w-28">Next run:</span>
                        <span className="text-slate-600">{formatDateTime(job.next_run_at)}</span>
                      </div>
                    )}

                    {job.last_error && (
                      <div className="mt-2 rounded-lg bg-red-50 p-2">
                        <span className="text-xs font-medium text-red-700">Last error:</span>
                        <p className="text-xs text-red-600 mt-1">{job.last_error}</p>
                      </div>
                    )}
                  </div>
                </div>

                <button
                  onClick={() => setEditingJob(job)}
                  className="rounded-md bg-brand-50 px-3 py-2 text-sm font-medium text-brand-600 hover:bg-brand-100"
                >
                  Edit
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {editingJob && (
        <CronJobEditModal
          job={editingJob}
          onSave={saveJob}
          onClose={() => setEditingJob(null)}
        />
      )}
    </div>
  );
}

function CronJobEditModal({
  job,
  onSave,
  onClose
}: {
  job: CronJob;
  onSave: (job: CronJob) => void;
  onClose: () => void;
}) {
  const [edited, setEdited] = useState(job);
  const [saving, setSaving] = useState(false);
  const [cronHelp, setCronHelp] = useState(false);

  async function handleSave() {
    setSaving(true);
    await onSave(edited);
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="w-full max-w-2xl rounded-lg bg-white p-6 shadow-lg max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold text-slate-900">Edit Cron Job</h2>

        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700">Job Name</label>
            <input
              type="text"
              value={edited.job_name}
              disabled
              className="mt-1 w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-600"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">Description</label>
            <textarea
              value={edited.description || ""}
              onChange={(e) => setEdited({ ...edited, description: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              rows={2}
            />
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-slate-700">Cron Expression</label>
              <button
                onClick={() => setCronHelp(!cronHelp)}
                className="text-xs text-blue-600 hover:underline"
              >
                {cronHelp ? "Hide" : "Show"} help
              </button>
            </div>
            <input
              type="text"
              value={edited.schedule_expression}
              onChange={(e) => setEdited({ ...edited, schedule_expression: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
              placeholder="*/30 * * * *"
            />

            {cronHelp && (
              <div className="mt-3 space-y-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                <p className="font-medium">Cron Format: minute hour day month weekday</p>
                <p>Examples:</p>
                <div className="space-y-1 pl-2">
                  {Object.entries(CRON_PRESETS).map(([label, value]) => (
                    <div key={value} className="flex justify-between">
                      <span>{label}</span>
                      <code className="text-slate-900 font-mono">{value}</code>
                      <button
                        onClick={() => setEdited({ ...edited, schedule_expression: value })}
                        className="text-blue-600 hover:underline"
                      >
                        Use
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">Endpoint</label>
            <input
              type="text"
              value={edited.endpoint}
              onChange={(e) => setEdited({ ...edited, endpoint: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
              placeholder="/api/cron/reminders"
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700">
                Timeout (seconds)
              </label>
              <input
                type="number"
                value={edited.timeout_seconds}
                onChange={(e) =>
                  setEdited({ ...edited, timeout_seconds: parseInt(e.target.value) })
                }
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                min="10"
                max="3600"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700">Retry Count</label>
              <input
                type="number"
                value={edited.retry_count}
                onChange={(e) =>
                  setEdited({ ...edited, retry_count: parseInt(e.target.value) })
                }
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                min="0"
                max="10"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700">
                Retry Delay (seconds)
              </label>
              <input
                type="number"
                value={edited.retry_delay_seconds}
                onChange={(e) =>
                  setEdited({ ...edited, retry_delay_seconds: parseInt(e.target.value) })
                }
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                min="10"
                max="3600"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={edited.enabled}
              onChange={(e) => setEdited({ ...edited, enabled: e.target.checked })}
              className="rounded"
            />
            <label className="text-sm font-medium text-slate-700">Enabled</label>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
