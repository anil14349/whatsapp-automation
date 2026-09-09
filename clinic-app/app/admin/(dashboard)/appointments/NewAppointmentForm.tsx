"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useFormState, useFormStatus } from "react-dom";
import {
  createWalkInAppointmentAction,
  getAvailableSlotsAction,
  type WalkInFormState
} from "./actions";

const initialState: WalkInFormState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Booking…" : "Book Appointment"}
    </button>
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
    <form ref={formRef} action={formAction} className="flex flex-wrap items-end gap-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-700">Doctor</label>
        <select
          name="doctorId"
          value={doctorId}
          onChange={(e) => setDoctorId(e.target.value)}
          required
          className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
        >
          <option value="">Select doctor…</option>
          {doctors.map((doctor) => (
            <option key={doctor.id} value={doctor.id}>
              {doctor.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-700">Date</label>
        <input
          type="date"
          name="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
          className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-700">Time</label>
        <select
          name="slot"
          required
          disabled={!doctorId || isPending}
          className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm disabled:opacity-50"
        >
          <option value="">
            {isPending ? "Loading…" : slots.length === 0 ? "No slots available" : "Select time…"}
          </option>
          {slots.map((slot) => (
            <option key={slot.value} value={slot.value}>
              {slot.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-700">Patient name</label>
        <input
          type="text"
          name="patientName"
          required
          className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-700">Patient phone</label>
        <input
          type="tel"
          name="patientPhone"
          required
          className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
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
