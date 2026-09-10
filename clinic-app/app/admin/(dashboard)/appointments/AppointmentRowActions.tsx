"use client";

import { useTransition, useState } from "react";
import {
  adminCancelAppointmentAction,
  markAppointmentStatusAction
} from "./actions";
import { EditAppointmentTimeModal } from "./EditAppointmentTimeModal";
import { EditAppointmentDateTimeModal } from "./EditAppointmentDateTimeModal";
import { EditAppointmentDoctorModal } from "./EditAppointmentDoctorModal";
import type { Appointment } from "@/lib/appointments";
import type { Doctor } from "@/lib/doctors";

export function AppointmentRowActions({
  appointment,
  doctor,
  allDoctors,
  onRefresh
}: {
  appointment: Appointment;
  doctor: Doctor;
  allDoctors: Doctor[];
  onRefresh: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [showTimeModal, setShowTimeModal] = useState(false);
  const [showDateTimeModal, setShowDateTimeModal] = useState(false);
  const [showDoctorModal, setShowDoctorModal] = useState(false);

  if (appointment.status !== "Confirmed") {
    return <span className="text-xs text-slate-400">—</span>;
  }

  return (
    <>
      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={() => setShowTimeModal(true)}
          className="text-xs font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50"
          title="Change time"
        >
          ⏰ Time
        </button>

        <button
          type="button"
          disabled={isPending}
          onClick={() => setShowDateTimeModal(true)}
          className="text-xs font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50"
          title="Reschedule"
        >
          📅 Reschedule
        </button>

        <button
          type="button"
          disabled={isPending}
          onClick={() => setShowDoctorModal(true)}
          className="text-xs font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50"
          title="Change doctor"
        >
          👨‍⚕️ Doctor
        </button>

        <button
          type="button"
          disabled={isPending}
          onClick={() =>
            startTransition(() => {
              void markAppointmentStatusAction(appointment.id, doctor.id, "Completed");
            })
          }
          className="text-xs font-medium text-green-600 hover:text-green-700 disabled:opacity-50"
        >
          ✓ Done
        </button>

        <button
          type="button"
          disabled={isPending}
          onClick={() =>
            startTransition(() => {
              void markAppointmentStatusAction(appointment.id, doctor.id, "No-Show");
            })
          }
          className="text-xs font-medium text-amber-600 hover:text-amber-700 disabled:opacity-50"
        >
          ✗ No-Show
        </button>

        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            if (confirm("Cancel this appointment?")) {
              startTransition(() => {
                void adminCancelAppointmentAction(appointment.id, doctor.id);
              });
            }
          }}
          className="text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>

      {showTimeModal && (
        <EditAppointmentTimeModal
          appointment={appointment}
          doctor={doctor}
          onClose={() => setShowTimeModal(false)}
          onSuccess={() => onRefresh()}
        />
      )}

      {showDateTimeModal && (
        <EditAppointmentDateTimeModal
          appointment={appointment}
          doctor={doctor}
          onClose={() => setShowDateTimeModal(false)}
          onSuccess={() => onRefresh()}
        />
      )}

      {showDoctorModal && (
        <EditAppointmentDoctorModal
          appointment={appointment}
          currentDoctor={doctor}
          allDoctors={allDoctors}
          onClose={() => setShowDoctorModal(false)}
          onSuccess={() => onRefresh()}
        />
      )}
    </>
  );
}
