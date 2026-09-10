"use client";

import { useEffect, useState } from "react";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Appointment } from "@/lib/appointments";

interface AuditEntry {
  id?: string;
  timestamp: string;
  action: string;
  oldValue: string;
  newValue: string;
}

interface AppointmentAuditViewerProps {
  appointmentId: string;
  appointment: Appointment;
}

export function AppointmentAuditViewer({
  appointmentId,
  appointment
}: AppointmentAuditViewerProps) {
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadAuditHistory = async () => {
      try {
        setLoading(true);
        const supabase = getSupabaseServerClient();

        // Query message_log for audit entries related to this appointment
        const { data, error: queryError } = await supabase
          .from("message_log")
          .select("*")
          .eq("message_type", "AUDIT")
          .order("received_at", { ascending: false })
          .limit(100);

        if (queryError) {
          setError(queryError.message);
          return;
        }

        // Parse and filter for this appointment
        const entries: AuditEntry[] = [];
        data?.forEach((log) => {
          try {
            const content = JSON.parse(log.message_content);
            if (
              content.type === "appointment_edit" &&
              content.appointmentId === appointmentId
            ) {
              entries.push({
                timestamp: content.timestamp,
                action: content.action,
                oldValue: content.oldValue,
                newValue: content.newValue
              });
            }
          } catch (e) {
            // Skip entries that can't be parsed
          }
        });

        setAuditEntries(entries);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load audit history");
      } finally {
        setLoading(false);
      }
    };

    loadAuditHistory();
  }, [appointmentId]);

  const getActionLabel = (action: string): string => {
    const labels: Record<string, string> = {
      TIME_UPDATED: "⏰ Time Updated",
      DATE_UPDATED: "📅 Date Updated",
      DOCTOR_CHANGED: "👨‍⚕️ Doctor Changed",
      APPOINTMENT_CREATED: "✨ Created",
      APPOINTMENT_CANCELLED: "❌ Cancelled",
      STATUS_CHANGED: "📊 Status Changed"
    };
    return labels[action] || action;
  };

  const getValueDisplay = (action: string, value: string): string => {
    if (action === "TIME_UPDATED" || action === "DATE_UPDATED") {
      return value;
    }
    if (action === "DOCTOR_CHANGED" || action === "STATUS_CHANGED") {
      return value;
    }
    return value;
  };

  if (loading) {
    return (
      <div className="text-center text-sm text-slate-500">
        Loading appointment history...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <h3 className="text-sm font-semibold text-slate-900">Appointment Details</h3>
        <div className="mt-3 grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-slate-500">Current Status</p>
            <p className="font-medium text-slate-900">{appointment.status}</p>
          </div>
          <div>
            <p className="text-slate-500">Appointment Code</p>
            <p className="font-mono text-slate-900">{appointment.appointment_code}</p>
          </div>
          <div>
            <p className="text-slate-500">Date & Time</p>
            <p className="font-medium text-slate-900">
              {appointment.appointment_date} at {appointment.appointment_time}
            </p>
          </div>
          <div>
            <p className="text-slate-500">Patient</p>
            <p className="font-medium text-slate-900">{appointment.patient_name}</p>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-slate-900">Change History</h3>
        {auditEntries.length === 0 ? (
          <div className="mt-3 rounded-lg border border-slate-200 bg-white p-4 text-center">
            <p className="text-sm text-slate-500">No changes recorded for this appointment</p>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            {auditEntries.map((entry, idx) => (
              <div
                key={idx}
                className="rounded-lg border border-slate-200 bg-white p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900">
                        {getActionLabel(entry.action)}
                      </span>
                      <span className="text-xs text-slate-500">
                        {new Date(entry.timestamp).toLocaleString()}
                      </span>
                    </div>

                    <div className="mt-2 space-y-1 text-sm">
                      <div className="flex gap-2">
                        <span className="text-slate-500">From:</span>
                        <span className="font-mono text-red-600">
                          {getValueDisplay(entry.action, entry.oldValue)}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <span className="text-slate-500">To:</span>
                        <span className="font-mono text-green-600">
                          {getValueDisplay(entry.action, entry.newValue)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="text-2xl">
                    {entry.action.includes("TIME") && "⏰"}
                    {entry.action.includes("DATE") && "📅"}
                    {entry.action.includes("DOCTOR") && "👨‍⚕️"}
                    {entry.action.includes("STATUS") && "📊"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}
    </div>
  );
}
