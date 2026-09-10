"use client";

import { useState } from "react";
import { updateClinicBrandingAction } from "./actions";
import { type ClinicBranding, isValidHexColor } from "@/lib/branding/clinic";

interface BrandingFormProps {
  clinicId: string;
  branding: ClinicBranding;
  onBrandingUpdate: (updated: Partial<ClinicBranding>) => void;
  onError: (error: string | null) => void;
}

export function BrandingForm({
  clinicId,
  branding,
  onBrandingUpdate,
  onError
}: BrandingFormProps) {
  const [saving, setSaving] = useState(false);
  const [logoPreview, setLogoPreview] = useState<string | null>(branding.logoUrl || null);
  const [logoDarkPreview, setLogoDarkPreview] = useState<string | null>(branding.logoDarkUrl || null);
  const [colors, setColors] = useState({
    primary: branding.primaryColor,
    secondary: branding.secondaryColor,
    accent: branding.accentColor
  });

  const handleColorChange = (colorKey: keyof typeof colors, value: string) => {
    setColors((prev) => ({ ...prev, [colorKey]: value }));
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      onError(null);

      // Validate colors
      if (!isValidHexColor(colors.primary)) {
        throw new Error("Invalid primary color");
      }
      if (!isValidHexColor(colors.secondary)) {
        throw new Error("Invalid secondary color");
      }
      if (!isValidHexColor(colors.accent)) {
        throw new Error("Invalid accent color");
      }

      await updateClinicBrandingAction(clinicId, {
        primaryColor: colors.primary,
        secondaryColor: colors.secondary,
        accentColor: colors.accent
      });

      onBrandingUpdate({
        primaryColor: colors.primary,
        secondaryColor: colors.secondary,
        accentColor: colors.accent
      });

      onError(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to save branding");
    } finally {
      setSaving(false);
    }
  };

  const ColorPickerField = ({
    label,
    value,
    onChange,
    colorKey
  }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    colorKey: string;
  }) => (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-2">{label}</label>
      <div className="flex gap-3 items-center">
        <div className="flex gap-2 items-center">
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="h-12 w-12 rounded-md border border-slate-300 cursor-pointer"
          />
          <span className="text-xs font-mono text-slate-600">{value}</span>
        </div>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#000000"
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none"
        />
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Logo Section */}
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Logo</h2>

        <div className="space-y-4">
          {/* Light Logo */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Light Logo (Light backgrounds)
            </label>
            <LogoUploader
              currentUrl={logoPreview}
              onUpload={(url) => setLogoPreview(url)}
            />
          </div>

          {/* Dark Logo */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Dark Logo (Dark backgrounds) - Optional
            </label>
            <LogoUploader
              currentUrl={logoDarkPreview}
              onUpload={(url) => setLogoDarkPreview(url)}
              isDark
            />
          </div>
        </div>
      </div>

      {/* Colors Section */}
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Color Scheme</h2>

        <div className="space-y-4">
          <ColorPickerField
            label="Primary Color"
            value={colors.primary}
            onChange={(value) => handleColorChange("primary", value)}
            colorKey="primary"
          />

          <ColorPickerField
            label="Secondary Color"
            value={colors.secondary}
            onChange={(value) => handleColorChange("secondary", value)}
            colorKey="secondary"
          />

          <ColorPickerField
            label="Accent Color"
            value={colors.accent}
            onChange={(value) => handleColorChange("accent", value)}
            colorKey="accent"
          />
        </div>
      </div>

      {/* Contact Info Section */}
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Contact Information</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Support Email
            </label>
            <input
              type="email"
              defaultValue={branding.supportEmail || ""}
              placeholder="support@clinic.com"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Phone Number
            </label>
            <input
              type="tel"
              defaultValue={branding.phone || ""}
              placeholder="+91 XXXXXXXXXX"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Website
            </label>
            <input
              type="url"
              defaultValue={branding.website || ""}
              placeholder="https://clinic.example.com"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Address
            </label>
            <textarea
              defaultValue={branding.address || ""}
              placeholder="123 Clinic Street, City, State 12345"
              rows={2}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Save Button */}
      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
      >
        {saving ? "Saving..." : "Save Branding"}
      </button>
    </div>
  );
}

/**
 * Logo uploader component
 */
function LogoUploader({
  currentUrl,
  onUpload,
  isDark = false
}: {
  currentUrl: string | null;
  onUpload: (url: string) => void;
  isDark?: boolean;
}) {
  const [dragging, setDragging] = useState(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFile(files[0]);
    }
  };

  const handleFile = (file: File) => {
    if (!file.type.startsWith("image/")) {
      alert("Please upload an image file");
      return;
    }

    // For now, just read the file and create a preview
    // In production, this would upload to Vercel Blob or Cloudinary
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      onUpload(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={`rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
        dragging
          ? "border-blue-500 bg-blue-50"
          : "border-slate-300 bg-slate-50 hover:border-slate-400"
      }`}
    >
      {currentUrl ? (
        <div className="space-y-2">
          <img
            src={currentUrl}
            alt={`${isDark ? "Dark" : "Light"} logo`}
            className="mx-auto h-16 object-contain"
          />
          <button
            type="button"
            onClick={() => {
              const input = document.createElement("input");
              input.type = "file";
              input.accept = "image/*";
              input.onchange = (e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (file) handleFile(file);
              };
              input.click();
            }}
            className="text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            Change Logo
          </button>
        </div>
      ) : (
        <div>
          <div className="mb-2 text-2xl">📤</div>
          <p className="text-sm text-slate-700">
            Drag and drop your logo here, or{" "}
            <button
              type="button"
              onClick={() => {
                const input = document.createElement("input");
                input.type = "file";
                input.accept = "image/*";
                input.onchange = (e) => {
                  const file = (e.target as HTMLInputElement).files?.[0];
                  if (file) handleFile(file);
                };
                input.click();
              }}
              className="text-blue-600 hover:text-blue-700 font-medium"
            >
              click to select
            </button>
          </p>
          <p className="text-xs text-slate-500 mt-1">PNG or SVG, max 5MB</p>
        </div>
      )}
    </div>
  );
}
