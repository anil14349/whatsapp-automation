"use client";

import { useFormState, useFormStatus } from "react-dom";
import { DORMANT_SETTING_KEYS } from "@/lib/settings";
import { updateSettingsAction, type FormState } from "./actions";

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
      {pending ? "Saving…" : "Save settings"}
    </button>
  );
}

/**
 * "Not yet active" badge, shown whenever a field's key is in
 * DORMANT_SETTING_KEYS (see lib/settings.ts) — the setting is still
 * saved and editable, but no bot code reads it yet because the feature
 * it controls hasn't been ported. See CONFIGURATION.md for details on
 * each one.
 */
function DormantBadge() {
  return (
    <span
      title="Saved, but no bot feature reads this setting yet — see CONFIGURATION.md"
      className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700"
    >
      Not yet active
    </span>
  );
}

function ToggleField({
  name,
  label,
  checked
}: {
  name: string;
  label: string;
  checked: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        id={name}
        name={name}
        type="checkbox"
        defaultChecked={checked}
        className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
      />
      <label htmlFor={name} className="text-sm text-slate-700">
        {label}
      </label>
      {DORMANT_SETTING_KEYS.has(name) && <DormantBadge />}
    </div>
  );
}

function TextField({
  name,
  label,
  value,
  placeholder
}: {
  name: string;
  label: string;
  value: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label htmlFor={name} className={labelClass}>
        {label}
        {DORMANT_SETTING_KEYS.has(name) && <DormantBadge />}
      </label>
      <input id={name} name={name} defaultValue={value} placeholder={placeholder} className={inputClass} />
    </div>
  );
}

export function SettingsForm({ settings }: { settings: Record<string, string> }) {
  const [state, formAction] = useFormState(updateSettingsAction, initialState);
  const value = (key: string, fallback = "") => settings[key] ?? fallback;
  const isOn = (key: string) => value(key).toUpperCase() === "TRUE";

  return (
    <form action={formAction} className="flex flex-col gap-8">
      <p className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-600">
        Fields marked <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">Not yet active</span> are saved but don&apos;t affect the bot yet — the feature they control hasn&apos;t been built out. See <code className="rounded bg-slate-200 px-1">CONFIGURATION.md</code> for details.
      </p>

      <section>
        <h2 className="text-sm font-semibold text-slate-900">Clinic</h2>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField name="CLINIC_NAME" label="Clinic name" value={value("CLINIC_NAME", "ABC Clinic")} />
          <TextField
            name="CLINIC_LOGO_URL"
            label="Logo URL (optional)"
            value={value("CLINIC_LOGO_URL")}
            placeholder="https://.../logo.png — shown on the appointment receipt card"
          />
          <TextField
            name="CLINIC_WELCOME_IMAGE_URL"
            label="Welcome image URL (optional)"
            value={value("CLINIC_WELCOME_IMAGE_URL")}
            placeholder="https://.../welcome.png — sent as the first message on a patient's greeting"
          />
          <TextField name="CLINIC_WORKING_DAYS" label="Working days" value={value("CLINIC_WORKING_DAYS")} placeholder="Mon,Tue,Wed,Thu,Fri,Sat" />
          <TextField name="CLINIC_OPEN_TIME" label="Opens" value={value("CLINIC_OPEN_TIME")} placeholder="09:00" />
          <TextField name="CLINIC_CLOSE_TIME" label="Closes" value={value("CLINIC_CLOSE_TIME")} placeholder="18:00" />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-slate-900">After-hours auto-reply</h2>
        <div className="mt-3 flex flex-col gap-3">
          <ToggleField name="ENABLE_AFTER_HOURS_REPLY" label="Reply automatically outside clinic hours" checked={isOn("ENABLE_AFTER_HOURS_REPLY")} />
          <TextField name="AFTER_HOURS_MESSAGE" label="Custom closed message (optional)" value={value("AFTER_HOURS_MESSAGE")} />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-slate-900">Appointment reminders</h2>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <ToggleField name="ENABLE_APPOINTMENT_REMINDERS" label="Send WhatsApp reminders before appointments" checked={isOn("ENABLE_APPOINTMENT_REMINDERS")} />
          </div>
          <TextField name="REMINDER_HOURS_BEFORE" label="Hours before (comma-separated)" value={value("REMINDER_HOURS_BEFORE")} placeholder="24,2" />
          <TextField name="REMINDER_WINDOW_MINUTES" label="Send window (minutes)" value={value("REMINDER_WINDOW_MINUTES")} placeholder="45" />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-slate-900">Auto-complete past appointments</h2>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <ToggleField name="AUTO_COMPLETE_PAST_APPOINTMENTS" label="Automatically mark past Confirmed appointments as Completed" checked={isOn("AUTO_COMPLETE_PAST_APPOINTMENTS")} />
          </div>
          <TextField name="AUTO_COMPLETE_HOURS_AFTER" label="Hours after start time" value={value("AUTO_COMPLETE_HOURS_AFTER")} placeholder="4" />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-slate-900">Home sample collection</h2>
        <div className="mt-3 flex flex-col gap-3">
          <ToggleField
            name="ENABLE_HOME_COLLECTION"
            label="Offer home sample collection to patients (turn off if this clinic doesn't do diagnostics/lab collection)"
            checked={isOn("ENABLE_HOME_COLLECTION")}
          />
        </div>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <TextField name="HOSPITAL_LATITUDE" label="Clinic latitude" value={value("HOSPITAL_LATITUDE")} />
          <TextField name="HOSPITAL_LONGITUDE" label="Clinic longitude" value={value("HOSPITAL_LONGITUDE")} />
          <TextField name="HOME_COLLECTION_RADIUS_KM" label="Service radius (km)" value={value("HOME_COLLECTION_RADIUS_KM", "5")} />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-slate-900">Doctor broadcast</h2>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            name="BROADCAST_SEND_CONCURRENCY"
            label="Parallel sends per batch"
            value={value("BROADCAST_SEND_CONCURRENCY", "5")}
            placeholder="5"
          />
        </div>
        <p className="mt-2 text-xs text-slate-500">
          How many WhatsApp messages the doctor/admin broadcast (&quot;message every patient confirmed today&quot;) sends at once instead of one at a time. Higher finishes faster for large patient lists but sends more requests to the WhatsApp API concurrently.
        </p>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-slate-900">Interactive menus &amp; logging</h2>
        <div className="mt-3 flex flex-col gap-3">
          <ToggleField name="ENABLE_INTERACTIVE_MENUS" label="Use tap-to-select WhatsApp menus (falls back to numbered text if off)" checked={isOn("ENABLE_INTERACTIVE_MENUS")} />
          <ToggleField
            name="ENABLE_WHATSAPP_FLOW_BOOKING"
            label="Use a native WhatsApp Flow form for Book Appointment (needs WHATSAPP_FLOW_ID + a private key configured — see CONFIGURATION.md)"
            checked={isOn("ENABLE_WHATSAPP_FLOW_BOOKING")}
          />
          <ToggleField name="ENABLE_INBOUND_LOG" label="Log inbound messages" checked={isOn("ENABLE_INBOUND_LOG")} />
          <ToggleField name="ENABLE_DEBUG_LOG" label="Log outbound sends" checked={isOn("ENABLE_DEBUG_LOG")} />
        </div>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <TextField name="LOG_RETENTION" label="Log retention" value={value("LOG_RETENTION", "month")} placeholder="week / month / quarter / year / none" />
          <TextField name="LOG_MAX_ROWS" label="Log row cap" value={value("LOG_MAX_ROWS", "5000")} />
          <TextField name="LOG_MESSAGE_MAX_CHARS" label="Log message max chars" value={value("LOG_MESSAGE_MAX_CHARS", "500")} />
        </div>
      </section>

      {state.error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}

      {state.success && (
        <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
          Settings saved.
        </p>
      )}

      <div>
        <SubmitButton />
      </div>
    </form>
  );
}
