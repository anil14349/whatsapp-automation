"use client";

import { useFormState, useFormStatus } from "react-dom";
import { createDoctorAction, type FormState } from "./actions";
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
      {pending ? "Adding…" : "Add doctor"}
    </BrandedButton>
  );
}

export function NewDoctorForm() {
  const [state, formAction] = useFormState(createDoctorAction, initialState);

  return (
    <form action={formAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <BrandedInput
        label="Doctor code"
        id="doctorCode"
        name="doctorCode"
        required
        placeholder="D001"
      />

      <BrandedInput
        label="Name"
        id="name"
        name="name"
        required
        placeholder="Dr. Jane Doe"
      />

      <BrandedInput
        label="Specialization"
        id="specialization"
        name="specialization"
        placeholder="Cardiologist"
      />

      <BrandedInput
        label="Slot length (minutes)"
        id="appointmentDurationMinutes"
        name="appointmentDurationMinutes"
        type="number"
        min={5}
        step={5}
        defaultValue={30}
        required
      />

      <BrandedInput
        label="WhatsApp number (for the Doctor Portal)"
        id="whatsappPhone"
        name="whatsappPhone"
        placeholder="919876543210"
      />

      <div className="sm:col-span-2">
        <BrandedInput
          label="Clinic / location"
          id="clinicName"
          name="clinicName"
        />
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
