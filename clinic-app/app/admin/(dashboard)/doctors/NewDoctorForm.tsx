"use client";

import { useFormState, useFormStatus } from "react-dom";
import { createDoctorAction, type FormState } from "./actions";

const initialState: FormState = {};

const inputClass =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";
const labelClass = "mb-1 block text-sm font-medium text-slate-700";

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Adding…" : "Add doctor"}
    </button>
  );
}

export function NewDoctorForm() {
  const [state, formAction] = useFormState(createDoctorAction, initialState);

  return (
    <form action={formAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div>
        <label htmlFor="doctorCode" className={labelClass}>
          Doctor code
        </label>
        <input id="doctorCode" name="doctorCode" required placeholder="D001" className={inputClass} />
      </div>

      <div>
        <label htmlFor="name" className={labelClass}>
          Name
        </label>
        <input id="name" name="name" required placeholder="Dr. Jane Doe" className={inputClass} />
      </div>

      <div>
        <label htmlFor="specialization" className={labelClass}>
          Specialization
        </label>
        <input id="specialization" name="specialization" placeholder="Cardiologist" className={inputClass} />
      </div>

      <div>
        <label htmlFor="appointmentDurationMinutes" className={labelClass}>
          Slot length (minutes)
        </label>
        <input
          id="appointmentDurationMinutes"
          name="appointmentDurationMinutes"
          type="number"
          min={5}
          step={5}
          defaultValue={30}
          required
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="whatsappPhone" className={labelClass}>
          WhatsApp number (for the Doctor Portal)
        </label>
        <input id="whatsappPhone" name="whatsappPhone" placeholder="919876543210" className={inputClass} />
      </div>

      <div className="sm:col-span-2">
        <label htmlFor="clinicName" className={labelClass}>
          Clinic / location
        </label>
        <input id="clinicName" name="clinicName" className={inputClass} />
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
