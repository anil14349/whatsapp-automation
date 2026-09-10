"use client";

import { useState } from "react";
import { applyPresetAction, createPresetAction, deletePresetAction } from "./actions";
import { type ClinicBranding, type BrandingPreset } from "@/lib/branding/clinic";

interface BrandingPresetsProps {
  clinicId: string;
  presets: BrandingPreset[];
  currentBranding: ClinicBranding;
  onPresetsUpdate: () => void;
  onError: (error: string | null) => void;
}

export function BrandingPresets({
  clinicId,
  presets,
  currentBranding,
  onPresetsUpdate,
  onError
}: BrandingPresetsProps) {
  const [showNewPreset, setShowNewPreset] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const handleCreatePreset = async () => {
    if (!presetName.trim()) {
      onError("Preset name is required");
      return;
    }

    try {
      setSaving(true);
      onError(null);

      await createPresetAction(clinicId, presetName, {
        primary: currentBranding.primaryColor,
        secondary: currentBranding.secondaryColor,
        accent: currentBranding.accentColor
      });

      setPresetName("");
      setShowNewPreset(false);
      onPresetsUpdate();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to create preset");
    } finally {
      setSaving(false);
    }
  };

  const handleApplyPreset = async (presetId: string) => {
    try {
      onError(null);
      await applyPresetAction(clinicId, presetId);
      onPresetsUpdate();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to apply preset");
    }
  };

  const handleDeletePreset = async (presetId: string) => {
    if (!confirm("Delete this preset? This cannot be undone.")) {
      return;
    }

    try {
      setDeleting(presetId);
      onError(null);
      await deletePresetAction(clinicId, presetId);
      onPresetsUpdate();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to delete preset");
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-slate-900">Color Presets</h2>
        <button
          onClick={() => setShowNewPreset(!showNewPreset)}
          className="text-sm px-3 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700"
        >
          {showNewPreset ? "Cancel" : "+ New Preset"}
        </button>
      </div>

      {/* New Preset Form */}
      {showNewPreset && (
        <div className="mb-4 p-4 bg-slate-50 rounded-lg space-y-3 border border-slate-200">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Preset Name
            </label>
            <input
              type="text"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder="e.g., Ocean Blue"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              autoFocus
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCreatePreset}
              disabled={saving}
              className="flex-1 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save Preset"}
            </button>
          </div>
        </div>
      )}

      {/* Presets Grid */}
      {presets.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {presets.map((preset) => (
            <div key={preset.id} className="rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="font-medium text-slate-900 text-sm">{preset.presetName}</div>
                  {preset.description && (
                    <div className="text-xs text-slate-500">{preset.description}</div>
                  )}
                </div>
                {preset.isDefault && (
                  <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
                    Default
                  </span>
                )}
              </div>

              {/* Color Swatches */}
              <div className="flex gap-2 mb-3">
                <div
                  className="w-8 h-8 rounded border border-slate-200"
                  style={{ backgroundColor: preset.primaryColor }}
                  title="Primary"
                />
                <div
                  className="w-8 h-8 rounded border border-slate-200"
                  style={{ backgroundColor: preset.secondaryColor }}
                  title="Secondary"
                />
                <div
                  className="w-8 h-8 rounded border border-slate-200"
                  style={{ backgroundColor: preset.accentColor }}
                  title="Accent"
                />
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <button
                  onClick={() => handleApplyPreset(preset.id)}
                  className="flex-1 text-xs px-2 py-1.5 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 font-medium"
                >
                  Apply
                </button>
                <button
                  onClick={() => handleDeletePreset(preset.id)}
                  disabled={deleting === preset.id}
                  className="flex-1 text-xs px-2 py-1.5 rounded bg-red-50 text-red-700 hover:bg-red-100 font-medium disabled:opacity-50"
                >
                  {deleting === preset.id ? "…" : "Delete"}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-6 text-slate-500">
          <p className="text-sm">No presets yet. Create one to save your current color scheme!</p>
        </div>
      )}
    </div>
  );
}
