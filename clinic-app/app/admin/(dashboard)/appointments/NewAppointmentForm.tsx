"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useFormState, useFormStatus } from "react-dom";
import {
  createWalkInAppointmentAction,
  getAvailableSlotsAction,
  type WalkInFormState
} from "./actions";
import { BrandedButton, BrandedSelect, BrandedInput } from "@/app/admin/(dashboard)/components/branded";

const initialState: WalkInFormState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <BrandedButton
      type="submit"
      disabled={pending}
      variant="primary"
    >
      {pending ? "Booking…" : "Book Appointment"}
    </BrandedButton>
  );
}

/**
 * "New Appointment" — for patients who walk into the hospital directly
 * rather than booking over WhatsApp. Goes through the exact same
 * bookAppointment() the WhatsApp flow uses (see actions.ts's
 * createWalkInAppointmentAction), so a walk-in and a WhatsApp booking
 * can never double-book the same slot.
 *
 * The time <select> is populated by re-fetching real availability
 * (getAvailableSlotsAction) whenever doctor or date changes, rather than
 * letting staff type an arbitrary time — same "only ever offer a slot
 * that's actually free" guarantee the patient-facing flow has.
 */
export function NewAppointmentForm({
  doctors
}: {
  doctors: Array<{ id: string; name: string }>;
}) {
  const [state, formAction] = useFormState(createWalkInAppointmentAction, initialState);
  const [doctorId, setDoctorId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [slots, setSlots] = useState<Array<{ value: string; label: string }>>([]);
  const [slotsError, setSlotsError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!doctorId || !date) {
      setSlots([]);
      return;
    }

    startTransition(() => {
      void getAvailableSlotsAction(doctorId, date).then((result) => {
        setSlots(result.slots);
        setSlotsError(result.error);
      });
    });
    // Re-runs after a successful booking too (state.success flips), so
    // the just-booked slot disappears from the list instead of still
    // showing as available.
  }, [doctorId, date, state.success]);

  useEffect(() => {
    if (state.success) {
      // Clear the uncontrolled patient name/phone/slot inputs — doctor
      // and date deliberately stay put, since booking several walk-ins
      // for the same doctor/day back-to-back is the common case.
      formRef.current?.reset();
    }
  }, [state.success]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-wrap items-end gap-4">
      <div className="flex-1 min-w-fit">
        <BrandedSelect
          label="Doctor"
          name="doctorId"
          value={doctorId}
          onChange={(e) => setDoctorId(e.target.value)}
          required
          options={[
            { value: "", label: "Select doctor…" },
            ...doctors.map((doctor) => ({ value: doctor.id, label: doctor.name }))
          ]}
        />
      </div>

      <div className="flex-1 min-w-fit">
        <BrandedInput
          label="Date"
          type="date"
          name="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
        />
      </div>

      <div className="flex-1 min-w-fit">
        <BrandedSelect
          label="Time"
          name="slot"
          required
          disabled={!doctorId || isPending}
          options={[
            {
              value: "",
              label: isPending ? "Loading…" : slots.length === 0 ? "No slots available" : "Select time…"
            },
            ...slots
          ]}
        />
      </div>

      <div className="flex-1 min-w-fit">
        <BrandedInput
          label="Patient name"
          type="text"
          name="patientName"
          required
        />
      </div>

      <div className="flex-1 min-w-fit">
        <BrandedInput
          label="Patient phone"
          type="tel"
          name="patientPhone"
          required
        />
      </div>

      <SubmitButton />

      {slotsError && (
        <p role="alert" className="w-full text-sm text-red-700">
          {slotsError}
        </p>
      )}

      {state.error && (
        <p role="alert" className="w-full text-sm text-red-700">
          {state.error}
        </p>
      )}

      {state.success && (
        <p role="status" className="w-full text-sm text-green-700">
          Appointment booked.
        </p>
      )}
    </form>
  );
}
