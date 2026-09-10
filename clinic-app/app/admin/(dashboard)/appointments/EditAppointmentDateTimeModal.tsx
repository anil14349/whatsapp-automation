"use client";

import { useTransition, useState } from "react";
import { editAppointmentDateTimeAction, getAvailableSlotsAction } from "./actions";
import type { Appointment } from "@/lib/appointments";
import type { Doctor } from "@/lib/doctors";
import { BrandedButton, BrandedInput, BrandedSelect } from "@/app/admin/(dashboard)/components/branded";

interface EditAppointmentDateTimeModalProps {
  appointment: Appointment;
  doctor: Doctor;
  onClose: () => void;
  onSuccess: () => void;
}

export function EditAppointmentDateTimeModal({
  appointment,
  doctor,
  onClose,
  onSuccess
}: EditAppointmentDateTimeModalProps) {
  const [isPending, startTransition] = useTransition();
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedDate, setSelectedDate] = useState(appointment.appointment_date);
  const [availableSlots, setAvailableSlots] = useState<
    Array<{ value: string; label: string }>
  >([]);
  const [error, setError] = useState("");

  const handleDateChange = async (newDate: string) => {
    setSelectedDate(newDate);
    setAvailableSlots([]);
    setError("");

    setLoadingSlots(true);
    const result = await getAvailableSlotsAction(doctor.id, newDate);
    setLoadingSlots(false);

    if (result.error) {
      setError(result.error);
    } else {
      setAvailableSlots(result.slots);
    }
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const dateString = formData.get("date") as string;
    const timeString = formData.get("time") as string;

    if (!dateString || !timeString) {
      setError("Please select both date and time");
      return;
    }

    startTransition(async () => {
      const result = await editAppointmentDateTimeAction(
        appointment.id,
        doctor.id,
        dateString,
        timeString
      );
      if (result.success) {
        onSuccess();
        onClose();
      } else {
        setError(result.message);
      }
    });
  };

  // Get tomorrow's date
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const minDate = tomorrow.toISOString().split("T")[0];

  // Get date 30 days from now
  const maxDate = new Date();
  maxDate.setDate(maxDate.getDate() + 30);
  const maxDateStr = maxDate.toISOString().split("T")[0];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
        <h2 className="text-lg font-semibold text-slate-900">Reschedule Appointment</h2>
        <p className="mt-1 text-sm text-slate-500">Change date and/or time</p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <BrandedInput
            label="Doctor"
            type="text"
            value={doctor.name}
            disabled
          />

          <BrandedInput
            label="Current Schedule"
            type="text"
            value={`${appointment.appointment_date} ${appointment.appointment_time}`}
            disabled
          />

          <BrandedInput
            label="New Date"
            id="date"
            type="date"
            name="date"
            value={selectedDate}
            onChange={(e) => handleDateChange(e.target.value)}
            min={minDate}
            max={maxDateStr}
          />

          <div>
            <label htmlFor="time" className="block text-sm font-medium text-slate-700">
              New Time
            </label>
            {loadingSlots ? (
              <div className="mt-2 text-sm text-slate-500">Loading available times...</div>
            ) : availableSlots.length > 0 ? (
              <BrandedSelect
                id="time"
                name="time"
                defaultValue=""
                options={[
                  { value: "", label: "Select a time..." },
                  ...availableSlots
                ]}
              />
            ) : (
              <div className="mt-2 rounded-md bg-amber-50 p-3 text-sm text-amber-600">
                No available slots for this date
              </div>
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
              disabled={isPending || availableSlots.length === 0}
              variant="primary"
            >
              {isPending ? "Updating..." : "Reschedule"}
            </BrandedButton>
          </div>
        </form>
      </div>
    </div>
  );
}
