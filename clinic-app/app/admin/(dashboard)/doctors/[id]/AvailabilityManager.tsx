"use client";

import { useFormState, useFormStatus } from "react-dom";
import type { DoctorAvailability } from "@/lib/doctors";
import type { Weekday } from "@/lib/supabase/database.types";
import { addAvailabilityAction, removeAvailabilityAction, type FormState } from "../actions";

const WEEKDAYS: Weekday[] = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday"
];

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
      {pending ? "Adding…" : "Add session"}
    </button>
  );
}

function RemoveButton({ doctorId, sessionId }: { doctorId: string; sessionId: string }) {
  return (
    <form action={removeAvailabilityAction.bind(null, doctorId, sessionId)}>
      <button type="submit" className="text-xs font-medium text-red-600 hover:text-red-700">
        Remove
      </button>
    </form>
  );
}

export function AvailabilityManager({
  doctorId,
  sessions
}: {
  doctorId: string;
  sessions: DoctorAvailability[];
}) {
  const boundAction = addAvailabilityAction.bind(null, doctorId);
  const [state, formAction] = useFormState(boundAction, initialState);

  const byDay = WEEKDAYS.map((day) => ({
    day,
    sessions: sessions.filter((s) => s.day_of_week === day)
  }));

  return (
    <div>
      <ul className="divide-y divide-slate-100">
        {byDay.map(({ day, sessions: daySessions }) => (
          <li key={day} className="flex items-start justify-between py-2 text-sm">
            <span className="w-28 font-medium text-slate-700">{day}</span>
            <div className="flex-1">
              {daySessions.length === 0 ? (
                <span className="text-slate-400">No sessions</span>
              ) : (
                <ul className="space-y-1">
                  {daySessions.map((session) => (
                    <li key={session.id} className="flex items-center gap-3">
                      <span className="text-slate-600">
                        {session.start_time.slice(0, 5)} – {session.end_time.slice(0, 5)}
                      </span>
                      <RemoveButton doctorId={doctorId} sessionId={session.id} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ul>

      <form action={formAction} className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700">Day</label>
          <select name="dayOfWeek" required className={inputClass} defaultValue="Monday">
            {WEEKDAYS.map((day) => (
              <option key={day} value={day}>
                {day}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700">Start</label>
          <input type="time" name="startTime" required className={inputClass} />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700">End</label>
          <input type="time" name="endTime" required className={inputClass} />
        </div>

        <SubmitButton />
      </form>

      {state.error && <p className="mt-2 text-sm text-red-700">{state.error}</p>}
    </div>
  );
}
