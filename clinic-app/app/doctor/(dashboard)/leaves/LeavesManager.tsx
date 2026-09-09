"use client";

import { useFormState, useFormStatus } from "react-dom";
import type { DoctorLeave } from "@/lib/doctors";
import { addLeaveAction, cancelLeaveAction, type FormState } from "./actions";

const initialState: FormState = {};
const inputClass =
  "rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Adding…" : "Add leave"}
    </button>
  );
}

function CancelButton({ leaveDate }: { leaveDate: string }) {
  return (
    <form action={cancelLeaveAction.bind(null, leaveDate)}>
      <button type="submit" className="text-xs font-medium text-red-600 hover:text-red-700">
        Cancel
      </button>
    </form>
  );
}

export function LeavesManager({ leaves }: { leaves: DoctorLeave[] }) {
  const [state, formAction] = useFormState(addLeaveAction, initialState);

  return (
    <div>
      {leaves.length === 0 ? (
        <p className="text-sm text-slate-400">No upcoming leaves.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {leaves.map((leave) => (
            <li key={leave.id} className="flex items-center justify-between py-2 text-sm">
              <span>
                <span className="font-medium text-slate-700">{leave.leave_date}</span>
                {leave.reason && <span className="text-slate-500"> — {leave.reason}</span>}
              </span>
              <CancelButton leaveDate={leave.leave_date} />
            </li>
          ))}
        </ul>
      )}

      <form action={formAction} className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700">Date</label>
          <input type="date" name="leaveDate" required className={inputClass} />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700">Reason (optional)</label>
          <input type="text" name="reason" className={inputClass} />
        </div>

        <SubmitButton />
      </form>

      {state.error && <p className="mt-2 text-sm text-red-700">{state.error}</p>}
    </div>
  );
}
