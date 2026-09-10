"use client";

import { useTransition } from "react";
import { editAppointmentTimeAction, getAvailableSlotsAction } from "./actions";
import type { Appointment } from "@/lib/appointments";
import type { Doctor } from "@/lib/doctors";
import { BrandedButton, BrandedInput, BrandedSelect } from "@/app/admin/(dashboard)/components/branded";

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
          <BrandedInput
            label="Doctor"
            type="text"
            value={doctor.name}
            disabled
          />

          <BrandedInput
            label="Date"
            type="text"
            value={appointment.appointment_date}
            disabled
          />

          <BrandedInput
            label="Current Time"
            type="text"
            value={appointment.appointment_time}
            disabled
          />

          <div>
            <label htmlFor="time" className="block text-sm font-medium text-slate-700">
              New Time
            </label>
            {availableSlots.length === 0 && (
              <BrandedButton
                type="button"
                onClick={handleLoadSlots}
                disabled={slots}
                variant="secondary"
                className="mt-2 mb-2"
              >
                {slots ? "Loading..." : "Load Available Times"}
              </BrandedButton>
            )}
            {availableSlots.length > 0 && (
              <BrandedSelect
                id="time"
                name="time"
                defaultValue=""
                options={[
                  { value: "", label: "Select a time..." },
                  ...availableSlots
                ]}
              />
            )}
          </div>

          {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</div>}

          <div className="flex justify-end gap-3 pt-4">
            <BrandedButton
              type="button"
              onClick={onClose}
              disabled={isPending}
              variant="secondary"
            >
              Cancel
            </BrandedButton>
            <BrandedButton
              type="submit"
              disabled={isPending}
              variant="primary"
            >
              {isPending ? "Updating..." : "Update Time"}
            </BrandedButton>
          </div>
        </form>
      </div>
    </div>
  );
}
