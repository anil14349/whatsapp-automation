"use client";

import { useTransition } from "react";
import { editAppointmentTimeAction, getAvailableSlotsAction } from "./actions";
import type { Appointment } from "@/lib/appointments";
import type { Doctor } from "@/lib/doctors";

interface EditAppointmentTimeModalProps {
  appointment: Appointment;
  doctor: Doctor;
  onClose: () => void;
  onSuccess: () => void;
}

export function EditAppointmentTimeModal({
  appointment,
  doctor,
  onClose,
  onSuccess
}: EditAppointmentTimeModalProps) {
  const [isPending, startTransition] = useTransition();
  const [slots, setSlots] = useTransition();
  const [selectedTime, setSelectedTime] = useTransition();
  const [error, setError] = useTransition();
  const [availableSlots, setAvailableSlots] = useTransition();

  const handleLoadSlots = () => {
    startTransition(async () => {
      const result = await getAvailableSlotsAction(doctor.id, appointment.appointment_date);
      if (result.error) {
        setError(result.error);
      } else {
        setAvailableSlots(result.slots);
      }
    });
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const timeString = formData.get("time") as string;

    if (!timeString) {
      setError("Please select a time");
      return;
    }

    startTransition(async () => {
      const result = await editAppointmentTimeAction(appointment.id, doctor.id, timeString);
      if (result.success) {
        onSuccess();
        onClose();
      } else {
        setError(result.message);
      }
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
        <h2 className="text-lg font-semibold text-slate-900">Edit Appointment Time</h2>
        <p className="mt-1 text-sm text-slate-500">
          Change time for {appointment.appointment_date}
        </p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700">Doctor</label>
            <input
              type="text"
              value={doctor.name}
              disabled
              className="mt-1 w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">Date</label>
            <input
              type="text"
              value={appointment.appointment_date}
              disabled
              className="mt-1 w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">Current Time</label>
            <input
              type="text"
              value={appointment.appointment_time}
              disabled
              className="mt-1 w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-500"
            />
          </div>

          <div>
            <label htmlFor="time" className="block text-sm font-medium text-slate-700">
              New Time
            </label>
            {availableSlots.length === 0 && (
              <button
                type="button"
                onClick={handleLoadSlots}
                disabled={slots}
                className="mt-2 mb-2 rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-600 hover:bg-slate-200 disabled:opacity-50"
              >
                {slots ? "Loading..." : "Load Available Times"}
              </button>
            )}
            {availableSlots.length > 0 && (
              <select
                id="time"
                name="time"
                defaultValue=""
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                <option value="">Select a time...</option>
                {availableSlots.map((slot) => (
                  <option key={slot.value} value={slot.value}>
                    {slot.label}
                  </option>
                ))}
              </select>
            )}
          </div>

          {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</div>}

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
            >
              {isPending ? "Updating..." : "Update Time"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
