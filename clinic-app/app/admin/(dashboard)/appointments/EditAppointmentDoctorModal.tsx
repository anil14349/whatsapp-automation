"use client";

import { useTransition, useState } from "react";
import { editAppointmentDoctorAction, getAvailableSlotsAction } from "./actions";
import type { Appointment } from "@/lib/appointments";
import type { Doctor } from "@/lib/doctors";
import { BrandedButton, BrandedInput, BrandedSelect } from "@/app/admin/(dashboard)/components/branded";

interface EditAppointmentDoctorModalProps {
  appointment: Appointment;
  currentDoctor: Doctor;
  allDoctors: Doctor[];
  onClose: () => void;
  onSuccess: () => void;
}

export function EditAppointmentDoctorModal({
  appointment,
  currentDoctor,
  allDoctors,
  onClose,
  onSuccess
}: EditAppointmentDoctorModalProps) {
  const [isPending, startTransition] = useTransition();
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedDoctorId, setSelectedDoctorId] = useState(currentDoctor.id);
  const [availableSlots, setAvailableSlots] = useState<
    Array<{ value: string; label: string }>
  >([]);
  const [error, setError] = useState("");

  const handleDoctorChange = async (newDoctorId: string) => {
    setSelectedDoctorId(newDoctorId);
    setAvailableSlots([]);
    setError("");

    setLoadingSlots(true);
    const result = await getAvailableSlotsAction(newDoctorId, appointment.appointment_date);
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
    const doctorId = formData.get("doctor") as string;
    const timeString = formData.get("time") as string;

    if (!doctorId || !timeString) {
      setError("Please select both doctor and time");
      return;
    }

    startTransition(async () => {
      const result = await editAppointmentDoctorAction(
        appointment.id,
        appointment.doctor_id,
        doctorId,
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
        <h2 className="text-lg font-semibold text-slate-900">Reassign Doctor</h2>
        <p className="mt-1 text-sm text-slate-500">
          Change doctor for {appointment.appointment_date}
        </p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
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

          <BrandedSelect
            label="Select New Doctor"
            id="doctor"
            name="doctor"
            value={selectedDoctorId}
            onChange={(e) => handleDoctorChange(e.target.value)}
            options={[
              { value: "", label: "Select a doctor..." },
              ...allDoctors.map((doc) => ({
                value: doc.id,
                label: `${doc.name} - ${doc.specialization}`
              }))
            ]}
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
            ) : selectedDoctorId && selectedDoctorId !== currentDoctor.id ? (
              <div className="mt-2 rounded-md bg-amber-50 p-3 text-sm text-amber-600">
                No available slots for this doctor on this date
              </div>
            ) : null}
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
              {isPending ? "Reassigning..." : "Reassign Doctor"}
            </BrandedButton>
          </div>
        </form>
      </div>
    </div>
  );
}
