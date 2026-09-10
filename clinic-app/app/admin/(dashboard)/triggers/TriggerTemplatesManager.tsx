"use client";

import { useEffect, useState } from "react";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { invalidateCache } from "@/lib/triggers/cache";

interface Template {
  id: string;
  template_key: string;
  language: string;
  subject?: string;
  body: string;
  enabled: boolean;
}

const LANGUAGES = [
  { code: "EN", name: "English" },
  { code: "TE", name: "తెలుగు (Telugu)" },
  { code: "HI", name: "हिन्दी (Hindi)" },
  { code: "KA", name: "ಕನ್ನಡ (Kannada)" },
  { code: "TA", name: "தமிழ் (Tamil)" },
  { code: "ML", name: "മലയാളം (Malayalam)" }
];

const COMMON_PLACEHOLDERS = [
  "{{patient_name}}",
  "{{doctor_name}}",
  "{{appointment_time}}",
  "{{appointment_date}}",
  "{{appointment_code}}",
  "{{clinic_name}}",
  "{{distance}}",
  "{{radius}}"
];

export function TriggerTemplatesManager() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clinicId, setClinicId] = useState<string | null>(null);

  useEffect(() => {
    loadClinicId();
  }, []);

  useEffect(() => {
    if (clinicId) {
      loadTemplates();
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

  async function loadTemplates() {
    try {
      setLoading(true);
      const supabase = getSupabaseServerClient();

      const { data, error: fetchError } = await supabase
        .from("trigger_templates")
        .select("*")
        .eq("clinic_id", clinicId)
        .order("template_key")
        .order("language");

      if (fetchError) throw fetchError;

      setTemplates(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load templates");
    } finally {
      setLoading(false);
    }
  }

  async function saveTemplate(template: Template) {
    try {
      const supabase = getSupabaseServerClient();

      const { error: updateError } = await supabase
        .from("trigger_templates")
        .update(template)
        .eq("id", template.id);

      if (updateError) throw updateError;

      // Invalidate cache for this clinic
      if (clinicId) {
        invalidateCache(clinicId);
      }

      setTemplates(templates.map((t) => (t.id === template.id ? template : t)));
      setEditingTemplate(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save template");
    }
  }

  if (loading) {
    return <div className="text-center text-slate-500">Loading templates...</div>;
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

      <div className="grid gap-4">
        {templates.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-center">
            <p className="text-slate-600">No templates found</p>
          </div>
        ) : (
          templates.map((template) => (
            <div key={template.id} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-slate-900">{template.template_key}</h3>
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">
                      {template.language}
                    </span>
                    {!template.enabled && (
                      <span className="text-xs text-red-600">DISABLED</span>
                    )}
                  </div>

                  {template.subject && (
                    <p className="mt-1 text-sm font-medium text-slate-700">
                      Subject: {template.subject}
                    </p>
                  )}

                  <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">
                    {template.body.substring(0, 150)}
                    {template.body.length > 150 ? "..." : ""}
                  </p>

                  {/* Show detected placeholders */}
                  <div className="mt-2 flex flex-wrap gap-1">
                    {Array.from(
                      new Set(
                        (template.body.match(/\{\{[^}]+\}\}/g) || []).map((p) =>
                          p.toLowerCase()
                        )
                      )
                    ).map((placeholder) => (
                      <span
                        key={placeholder}
                        className="rounded bg-blue-50 px-2 py-1 text-xs text-blue-600"
                      >
                        {placeholder}
                      </span>
                    ))}
                  </div>
                </div>

                <button
                  onClick={() => setEditingTemplate(template)}
                  className="rounded-md bg-brand-50 px-3 py-2 text-sm font-medium text-brand-600 hover:bg-brand-100"
                >
                  Edit
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {editingTemplate && (
        <TemplateEditModal
          template={editingTemplate}
          onSave={saveTemplate}
          onClose={() => setEditingTemplate(null)}
        />
      )}
    </div>
  );
}

function TemplateEditModal({
  template,
  onSave,
  onClose
}: {
  template: Template;
  onSave: (template: Template) => void;
  onClose: () => void;
}) {
  const [edited, setEdited] = useState(template);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    await onSave(edited);
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="w-full max-w-2xl rounded-lg bg-white p-6 shadow-lg max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold text-slate-900">Edit Template</h2>

        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700">Subject (Optional)</label>
            <input
              type="text"
              value={edited.subject || ""}
              onChange={(e) => setEdited({ ...edited, subject: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="e.g., Appointment Reminder"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">
              Message Body with Placeholders
            </label>
            <textarea
              value={edited.body}
              onChange={(e) => setEdited({ ...edited, body: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
              rows={8}
              placeholder="Use {{placeholder}} syntax for variables"
            />
            <p className="mt-2 text-xs text-slate-500">
              Common placeholders: {COMMON_PLACEHOLDERS.join(", ")}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={edited.enabled}
              onChange={(e) => setEdited({ ...edited, enabled: e.target.checked })}
              className="rounded"
            />
            <label className="text-sm font-medium text-slate-700">Enabled</label>
          </div>

          {/* Preview */}
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-xs font-medium text-slate-700">Preview:</p>
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">
              {edited.body}
            </p>
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
