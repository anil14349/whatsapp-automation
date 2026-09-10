"use client";

import { useState } from "react";
import { BrandedTable, BrandedTableHeader, BrandedTableRow, BrandedTableCell, BrandedBadge } from "@/app/admin/(dashboard)/components/branded";

interface WebhookEvent {
  id: string;
  event_type: string;
  status: string;
  retry_count: number;
  created_at: string;
  error_message?: string;
  payload?: any;
}

interface WebhookEventsListProps {
  events?: WebhookEvent[];
}

export function WebhookEventsList({ events = [] }: WebhookEventsListProps) {
  const [selectedEvent, setSelectedEvent] = useState<WebhookEvent | null>(null);

  return (
    <div className="space-y-4">
      <BrandedTable>
        <BrandedTableHeader>
          <BrandedTableCell>Time</BrandedTableCell>
          <BrandedTableCell>Type</BrandedTableCell>
          <BrandedTableCell>Status</BrandedTableCell>
          <BrandedTableCell>Retries</BrandedTableCell>
          <BrandedTableCell>Error</BrandedTableCell>
        </BrandedTableHeader>
        <tbody>
          {events.map((event) => (
            <BrandedTableRow
              key={event.id}
              onClick={() => setSelectedEvent(event)}
              className="cursor-pointer"
            >
              <BrandedTableCell>
                {new Date(event.created_at).toLocaleString()}
              </BrandedTableCell>
              <BrandedTableCell>{event.event_type}</BrandedTableCell>
              <BrandedTableCell>
                <BrandedBadge
                  variant={
                    event.status === "processed"
                      ? "success"
                      : event.status === "failed"
                      ? "danger"
                      : event.status === "retrying"
                      ? "warning"
                      : "default"
                  }
                  size="sm"
                >
                  {event.status}
                </BrandedBadge>
              </BrandedTableCell>
              <BrandedTableCell>{event.retry_count}</BrandedTableCell>
              <BrandedTableCell className="truncate">
                {event.error_message || "—"}
              </BrandedTableCell>
            </BrandedTableRow>
          ))}
        </tbody>
      </BrandedTable>

      {selectedEvent && (
        <div className="mt-4 p-4 bg-slate-50 rounded-lg border border-slate-200">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-semibold text-slate-900">Event Details</h3>
            <button
              onClick={() => setSelectedEvent(null)}
              className="text-slate-400 hover:text-slate-600"
            >
              ✕
            </button>
          </div>

          <div className="space-y-2 text-sm">
            <div>
              <strong className="text-slate-700">Event ID:</strong>
              <code className="ml-2 bg-white px-2 py-1 rounded border border-slate-200">
                {selectedEvent.id}
              </code>
            </div>

            <div>
              <strong className="text-slate-700">Type:</strong>
              <span className="ml-2">{selectedEvent.event_type}</span>
            </div>

            <div>
              <strong className="text-slate-700">Status:</strong>
              <span className="ml-2">
                <BrandedBadge
                  variant={
                    selectedEvent.status === "processed"
                      ? "success"
                      : selectedEvent.status === "failed"
                      ? "danger"
                      : "warning"
                  }
                  size="sm"
                >
                  {selectedEvent.status}
                </BrandedBadge>
              </span>
            </div>

            {selectedEvent.error_message && (
              <div>
                <strong className="text-red-700">Error:</strong>
                <p className="mt-1 bg-red-50 p-2 rounded text-red-700 text-xs">
                  {selectedEvent.error_message}
                </p>
              </div>
            )}

            {selectedEvent.payload && (
              <div>
                <strong className="text-slate-700">Payload:</strong>
                <pre className="mt-2 bg-white p-2 rounded border border-slate-200 overflow-auto text-xs max-h-48">
                  {JSON.stringify(selectedEvent.payload, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
