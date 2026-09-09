"use client";

import { useFormState, useFormStatus } from "react-dom";
import { broadcastToDoctorPatientsAction, type BroadcastFormState } from "./actions";

const initialState: BroadcastFormState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Sending…" : "Send broadcast"}
    </button>
  );
}

/**
 * Plain inline form, no modal — matches the rest of this admin UI (see
 * AppointmentRowActions.tsx / SettingsForm.tsx); a repo-wide grep found no
 * modal/dialog library anywhere in app/admin. Only rendered by page.tsx
 * when both doctorId and date filters are set, since a broadcast targets
 * exactly one doctor's confirmed appointments on exactly one date.
 */
export function BroadcastForm({ doctorId, date }: { doctorId: string; date: string }) {
  const [state, formAction] = useFormState(broadcastToDoctorPatientsAction, initialState);

  return (
    <form action={formAction} className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">
        Broadcast to patients confirmed on {date}
      </h2>
      <p className="mt-1 text-xs text-slate-500">
        Sends one WhatsApp message to every patient with a Confirmed appointment for this doctor on this date (e.g.
        &quot;running 30 min late today&quot;).
      </p>

      <input type="hidden" name="doctorId" value={doctorId} />
      <input type="hidden" name="date" value={date} />

      <textarea
        name="message"
        rows={3}
        placeholder="Message to send"
        required
        className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
      />

      {state.error && (
        <p role="alert" className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}

      {state.success && (
        <p role="status" className="mt-2 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
          Sent to {state.sent} of {state.recipientCount} patient{state.recipientCount === 1 ? "" : "s"}
          {state.errors && state.errors > 0 ? ` (${state.errors} failed)` : ""}.
        </p>
      )}

      <div className="mt-3">
        <SubmitButton />
      </div>
    </form>
  );
}
