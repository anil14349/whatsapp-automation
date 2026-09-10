"use client";

import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { getClinicBranding, getBrandingPresets, type ClinicBranding } from "@/lib/branding/clinic";
import { BrandingForm } from "./BrandingForm";
import { BrandingPreview } from "./BrandingPreview";
import { BrandingPresets } from "./BrandingPresets";

interface BrandingSettingsPageProps {
  clinicId: string;
}

export function BrandingSettingsPage({ clinicId }: BrandingSettingsPageProps) {
  const supabase = getSupabaseClient();
  const [branding, setBranding] = useState<ClinicBranding | null>(null);
  const [presets, setPresets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState(false);

  useEffect(() => {
    loadBranding();
  }, [clinicId]);

  const loadBranding = async () => {
    try {
      setLoading(true);
      const [brandingData, presetsData] = await Promise.all([
        getClinicBranding(supabase, clinicId),
        getBrandingPresets(supabase, clinicId)
      ]);
      setBranding(brandingData);
      setPresets(presetsData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load branding");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-slate-600">Loading branding settings...</div>
      </div>
    );
  }

  if (!branding) {
    return (
      <div className="rounded-md bg-red-50 p-4 text-red-700">
        Failed to load branding. Please try again.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Clinic Branding</h1>
          <p className="mt-1 text-sm text-slate-600">
            Customize the look and feel of your clinic's dashboard and patient-facing pages
          </p>
        </div>
        <button
          onClick={() => setPreviewMode(!previewMode)}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            previewMode
              ? "bg-blue-100 text-blue-700 hover:bg-blue-200"
              : "bg-slate-100 text-slate-700 hover:bg-slate-200"
          }`}
        >
          {previewMode ? "✓ Preview On" : "Preview"}
        </button>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 p-4 text-red-700">
          {error}
        </div>
      )}

      {/* Two-column layout: Form + Preview */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Branding Form (2 columns) */}
        <div className="lg:col-span-2 space-y-6">
          <BrandingForm
            clinicId={clinicId}
            branding={branding}
            onBrandingUpdate={(updated) => setBranding({ ...branding, ...updated })}
            onError={setError}
          />

          {/* Presets Section */}
          <BrandingPresets
            clinicId={clinicId}
            presets={presets}
            currentBranding={branding}
            onPresetsUpdate={loadBranding}
            onError={setError}
          />
        </div>

        {/* Preview Panel (1 column) */}
        <div className="lg:col-span-1">
          <BrandingPreview branding={branding} />
        </div>
      </div>

      {/* Info Section */}
      <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
        <h3 className="font-semibold text-slate-900 text-sm mb-2">💡 Tips</h3>
        <ul className="text-xs text-slate-600 space-y-1">
          <li>
            • <strong>Logo:</strong> Recommended size 200x60px, PNG or SVG format
          </li>
          <li>
            • <strong>Colors:</strong> Use contrasting colors for better accessibility
          </li>
          <li>
            • <strong>Dark Logo:</strong> Optional lighter version for dark backgrounds
          </li>
          <li>
            • <strong>Presets:</strong> Save your favorite color combinations for quick switching
          </li>
        </ul>
      </div>
    </div>
  );
}
