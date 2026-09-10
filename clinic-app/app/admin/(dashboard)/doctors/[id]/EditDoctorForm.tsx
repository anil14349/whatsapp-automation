"use client";

import { useFormState, useFormStatus } from "react-dom";
import type { Doctor } from "@/lib/doctors";
import { updateDoctorAction, type FormState } from "../actions";
import { BrandedButton, BrandedInput } from "@/app/admin/(dashboard)/components/branded";

const initialState: FormState = {};

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <BrandedButton
      type="submit"
      disabled={pending}
      variant="primary"
    >
      {pending ? "Saving…" : "Save changes"}
    </BrandedButton>
  );
}

export function EditDoctorForm({ doctor }: { doctor: Doctor }) {
  const boundAction = updateDoctorAction.bind(null, doctor.id);
  const [state, formAction] = useFormState(boundAction, initialState);

  return (
    <form action={formAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <BrandedInput
        label="Name"
        id="name"
        name="name"
        required
        defaultValue={doctor.name}
      />

      <BrandedInput
        label="Specialization"
        id="specialization"
        name="specialization"
        defaultValue={doctor.specialization}
      />

      <BrandedInput
        label="Slot length (minutes)"
        id="appointmentDurationMinutes"
        name="appointmentDurationMinutes"
        type="number"
        min={5}
        step={5}
        defaultValue={doctor.appointment_duration_minutes}
        required
      />

      <BrandedInput
        label="WhatsApp number"
        id="whatsappPhone"
        name="whatsappPhone"
        defaultValue={doctor.whatsapp_phone}
      />

      <BrandedInput
        label="Clinic / location"
        id="clinicName"
        name="clinicName"
        defaultValue={doctor.clinic_name}
      />

      <div className="flex items-center gap-2 sm:col-span-2">
        <input
          id="active"
          name="active"
          type="checkbox"
          defaultChecked={doctor.active}
          className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
        />
        <label htmlFor="active" className="text-sm text-slate-700">
          Active (can log into the Doctor Portal and receives bookings)
        </label>
      </div>

      {state.error && (
        <p role="alert" className="sm:col-span-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}

      <div className="sm:col-span-2">
        <SubmitButton />
      </div>
    </form>
  );
}
