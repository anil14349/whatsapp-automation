"use client";

import { type ClinicBranding } from "@/lib/branding/clinic";

interface BrandingPreviewProps {
  branding: ClinicBranding;
}

export function BrandingPreview({ branding }: BrandingPreviewProps) {
  return (
    <div className="sticky top-4 space-y-4">
      {/* Live Preview Card */}
      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden shadow-sm">
        <div
          className="h-24 flex items-center justify-center px-4"
          style={{ backgroundColor: branding.primaryColor }}
        >
          {branding.logoUrl ? (
            <img
              src={branding.logoUrl}
              alt="Logo"
              className="h-16 object-contain"
            />
          ) : (
            <div className="text-white text-center">
              <div className="text-2xl mb-1">🏥</div>
              <div className="text-xs">{branding.name}</div>
            </div>
          )}
        </div>

        <div className="p-4 space-y-3">
          <h3 className="text-sm font-semibold text-slate-900">Preview</h3>

          {/* Color Swatches */}
          <div className="space-y-2">
            <div className="flex gap-2 items-center">
              <div
                className="w-6 h-6 rounded border border-slate-200"
                style={{ backgroundColor: branding.primaryColor }}
              />
              <div>
                <div className="text-xs font-medium text-slate-600">Primary</div>
                <div className="text-xs text-slate-500">{branding.primaryColor}</div>
              </div>
            </div>

            <div className="flex gap-2 items-center">
              <div
                className="w-6 h-6 rounded border border-slate-200"
                style={{ backgroundColor: branding.secondaryColor }}
              />
              <div>
                <div className="text-xs font-medium text-slate-600">Secondary</div>
                <div className="text-xs text-slate-500">{branding.secondaryColor}</div>
              </div>
            </div>

            <div className="flex gap-2 items-center">
              <div
                className="w-6 h-6 rounded border border-slate-200"
                style={{ backgroundColor: branding.accentColor }}
              />
              <div>
                <div className="text-xs font-medium text-slate-600">Accent</div>
                <div className="text-xs text-slate-500">{branding.accentColor}</div>
              </div>
            </div>
          </div>

          {/* Button Preview */}
          <div className="pt-2 border-t border-slate-200">
            <div className="text-xs font-medium text-slate-600 mb-2">Buttons</div>
            <button
              className="w-full px-3 py-2 text-white text-xs font-medium rounded-md mb-2"
              style={{ backgroundColor: branding.primaryColor }}
            >
              Primary Button
            </button>
            <button
              className="w-full px-3 py-2 text-white text-xs font-medium rounded-md"
              style={{ backgroundColor: branding.accentColor }}
            >
              Action Button
            </button>
          </div>

          {/* Text Preview */}
          <div className="pt-2 border-t border-slate-200">
            <div className="text-xs font-medium text-slate-600 mb-2">Text</div>
            <div style={{ color: branding.primaryColor }} className="text-sm font-medium mb-1">
              Heading Text
            </div>
            <div className="text-xs text-slate-600">
              Regular body text in gray with accent highlights{" "}
              <span style={{ color: branding.accentColor }}>like this</span>.
            </div>
          </div>
        </div>
      </div>

      {/* Contact Info Card */}
      {(branding.website || branding.supportEmail || branding.phone) && (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">Contact</h3>
          <div className="space-y-2 text-xs">
            {branding.website && (
              <div>
                <div className="text-slate-600 mb-0.5">Website</div>
                <a
                  href={branding.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline break-all"
                >
                  {branding.website}
                </a>
              </div>
            )}
            {branding.supportEmail && (
              <div>
                <div className="text-slate-600 mb-0.5">Email</div>
                <a href={`mailto:${branding.supportEmail}`} className="text-blue-600 hover:underline">
                  {branding.supportEmail}
                </a>
              </div>
            )}
            {branding.phone && (
              <div>
                <div className="text-slate-600 mb-0.5">Phone</div>
                <a href={`tel:${branding.phone}`} className="text-blue-600 hover:underline">
                  {branding.phone}
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
