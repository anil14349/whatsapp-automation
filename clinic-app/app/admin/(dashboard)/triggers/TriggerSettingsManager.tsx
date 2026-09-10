"use client";

import { useEffect, useState } from "react";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { invalidateCache } from "@/lib/triggers/cache";

interface Setting {
  id: string;
  setting_key: string;
  setting_value: string;
  value_type: "string" | "number" | "boolean" | "json";
  description?: string;
  is_secret: boolean;
}

const DEFAULT_SETTINGS: Omit<Setting, "id">[] = [
  {
    setting_key: "home_collection_radius",
    setting_value: "5",
    value_type: "number",
    description: "Maximum distance in km for home collection service",
    is_secret: false
  },
  {
    setting_key: "max_booking_days",
    setting_value: "30",
    value_type: "number",
    description: "Maximum days ahead patients can book appointments",
    is_secret: false
  },
  {
    setting_key: "enable_doctor_portal",
    setting_value: "true",
    value_type: "boolean",
    description: "Enable doctor portal features",
    is_secret: false
  },
  {
    setting_key: "appointment_reminder_hours",
    setting_value: "24",
    value_type: "number",
    description: "Send reminder this many hours before appointment",
    is_secret: false
  },
  {
    setting_key: "hospital_location",
    setting_value: "17.3850,78.4867",
    value_type: "string",
    description: "Clinic location as latitude,longitude",
    is_secret: false
  },
  {
    setting_key: "clinic_name",
    setting_value: "ABC Clinic",
    value_type: "string",
    description: "Official clinic name",
    is_secret: false
  }
];

export function TriggerSettingsManager() {
  const [settings, setSettings] = useState<Setting[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingSetting, setEditingSetting] = useState<Setting | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clinicId, setClinicId] = useState<string | null>(null);

  useEffect(() => {
    loadClinicId();
  }, []);

  useEffect(() => {
    if (clinicId) {
      loadSettings();
    }
  }, [clinicId]);

  async function loadClinicId() {
    try {
      const supabase = getSupabaseServerClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) return;

      const { data: clinicUser } = await supabase
        .from("clinic_users")
        .select("clinic_id")
        .eq("user_id", user.id)
        .single();

      if (clinicUser) {
        setClinicId(clinicUser.clinic_id);
      }
    } catch (err) {
      console.error("Failed to load clinic ID:", err);
    }
  }

  async function loadSettings() {
    try {
      setLoading(true);
      const supabase = getSupabaseServerClient();

      const { data, error: fetchError } = await supabase
        .from("trigger_settings")
        .select("*")
        .eq("clinic_id", clinicId)
        .order("setting_key");

      if (fetchError) throw fetchError;

      setSettings(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }

  async function saveSetting(setting: Setting) {
    try {
      const supabase = getSupabaseServerClient();

      const { error: updateError } = await supabase
        .from("trigger_settings")
        .update(setting)
        .eq("id", setting.id);

      if (updateError) throw updateError;

      // Invalidate cache for this clinic
      if (clinicId) {
        invalidateCache(clinicId);
      }

      setSettings(settings.map((s) => (s.id === setting.id ? setting : s)));
      setEditingSetting(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save setting");
    }
  }

  function getDisplayValue(setting: Setting): string {
    if (setting.is_secret) {
      return "••••••••";
    }
    if (setting.value_type === "json") {
      try {
        return JSON.stringify(JSON.parse(setting.setting_value), null, 2);
      } catch {
        return setting.setting_value;
      }
    }
    return setting.setting_value;
  }

  function getValueColor(
    valueType: string,
    value: string
  ): string {
    if (valueType === "boolean") {
      return value === "true" ? "text-green-600" : "text-red-600";
    }
    if (valueType === "number") {
      return "text-blue-600";
    }
    return "text-slate-600";
  }

  if (loading) {
    return <div className="text-center text-slate-500">Loading settings...</div>;
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-2 text-xs underline"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="rounded-lg bg-blue-50 p-3 text-sm text-blue-600">
        💡 Tip: Settings are cached for 1 hour. Changes take effect immediately in UI but may take up to
        1 hour to propagate to active sessions.
      </div>

      <div className="grid gap-3">
        {settings.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-center">
            <p className="text-slate-600">No settings found</p>
          </div>
        ) : (
          settings.map((setting) => (
            <div
              key={setting.id}
              className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-4"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-slate-900">{setting.setting_key}</h3>
                  <span
                    className={`rounded-full bg-slate-100 px-2 py-1 text-xs font-mono ${getValueColor(
                      setting.value_type,
                      setting.setting_value
                    )}`}
                  >
                    {setting.value_type}
                  </span>
                </div>
                {setting.description && (
                  <p className="mt-1 text-sm text-slate-600">{setting.description}</p>
                )}
                <p className={`mt-1 text-sm font-mono ${getValueColor(setting.value_type, setting.setting_value)}`}>
                  {getDisplayValue(setting)}
                </p>
              </div>

              <button
                onClick={() => setEditingSetting(setting)}
                className="rounded-md bg-brand-50 px-3 py-2 text-sm font-medium text-brand-600 hover:bg-brand-100"
              >
                Edit
              </button>
            </div>
          ))
        )}
      </div>

      {editingSetting && (
        <SettingEditModal
          setting={editingSetting}
          onSave={saveSetting}
          onClose={() => setEditingSetting(null)}
        />
      )}
    </div>
  );
}

function SettingEditModal({
  setting,
  onSave,
  onClose
}: {
  setting: Setting;
  onSave: (setting: Setting) => void;
  onClose: () => void;
}) {
  const [edited, setEdited] = useState(setting);
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  function validateValue(): boolean {
    setValidationError(null);

    if (edited.value_type === "number") {
      if (isNaN(Number(edited.setting_value))) {
        setValidationError("Value must be a valid number");
        return false;
      }
    } else if (edited.value_type === "json") {
      try {
        JSON.parse(edited.setting_value);
      } catch {
        setValidationError("Value must be valid JSON");
        return false;
      }
    }

    return true;
  }

  async function handleSave() {
    if (!validateValue()) {
      return;
    }

    setSaving(true);
    await onSave(edited);
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="w-full max-w-2xl rounded-lg bg-white p-6 shadow-lg">
        <h2 className="text-lg font-semibold text-slate-900">Edit Setting</h2>

        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700">Setting Key</label>
            <input
              type="text"
              value={edited.setting_key}
              disabled
              className="mt-1 w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-600"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">Type</label>
            <select
              value={edited.value_type}
              onChange={(e) =>
                setEdited({
                  ...edited,
                  value_type: e.target.value as Setting["value_type"]
                })
              }
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="string">String</option>
              <option value="number">Number</option>
              <option value="boolean">Boolean</option>
              <option value="json">JSON</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">Value</label>
            {edited.value_type === "boolean" ? (
              <div className="mt-2 flex gap-4">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={edited.setting_value === "true"}
                    onChange={() => setEdited({ ...edited, setting_value: "true" })}
                    className="rounded"
                  />
                  <span className="text-sm">True</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={edited.setting_value === "false"}
                    onChange={() => setEdited({ ...edited, setting_value: "false" })}
                    className="rounded"
                  />
                  <span className="text-sm">False</span>
                </label>
              </div>
            ) : (
              <textarea
                value={edited.setting_value}
                onChange={(e) => setEdited({ ...edited, setting_value: e.target.value })}
                className={`mt-1 w-full rounded-md border px-3 py-2 text-sm font-mono ${
                  validationError
                    ? "border-red-300 bg-red-50"
                    : "border-slate-300"
                }`}
                rows={edited.value_type === "json" ? 6 : 3}
              />
            )}
            {validationError && (
              <p className="mt-1 text-sm text-red-600">{validationError}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">Description</label>
            <textarea
              value={edited.description || ""}
              onChange={(e) => setEdited({ ...edited, description: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              rows={2}
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={edited.is_secret}
              onChange={(e) => setEdited({ ...edited, is_secret: e.target.checked })}
              className="rounded"
            />
            <label className="text-sm font-medium text-slate-700">
              Hide value in UI (for secrets)
            </label>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
