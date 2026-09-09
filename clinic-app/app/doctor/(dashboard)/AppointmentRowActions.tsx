"use client";

import { useTransition } from "react";
import {
  doctorCancelAppointmentAction,
  doctorMarkAppointmentStatusAction
} from "./actions";

export function AppointmentRowActions({
  appointmentId,
  status
}: {
  appointmentId: string;
  status: string;
}) {
  const [isPending, startTransition] = useTransition();

  if (status !== "Confirmed") {
    return <span className="text-xs text-slate-400">—</span>;
  }

  return (
    <div className="flex justify-end gap-3">
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(() => {
            void doctorMarkAppointmentStatusAction(appointmentId, "Completed");
          })
        }
        className="text-xs font-medium text-green-600 hover:text-green-700 disabled:opacity-50"
      >
        Completed
      </button>

      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(() => {
            void doctorMarkAppointmentStatusAction(appointmentId, "No-Show");
          })
        }
        className="text-xs font-medium text-amber-600 hover:text-amber-700 disabled:opacity-50"
      >
        No-Show
      </button>

      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (confirm("Cancel this appointment?")) {
            startTransition(() => {
              void doctorCancelAppointmentAction(appointmentId);
            });
          }
        }}
        className="text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
      >
        Cancel
      </button>
    </div>
  );
}
