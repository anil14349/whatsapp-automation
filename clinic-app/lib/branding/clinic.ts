/**
 * Clinic Branding Management
 *
 * Functions for managing clinic logos, colors, and white-label settings.
 * All branding is cached for 1 hour to avoid repeated database queries.
 */

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { cache } from "react";

export interface ClinicBranding {
  clinicId: string;
  name: string;
  logoUrl?: string;
  logoDarkUrl?: string;
  primaryColor: string; // #RRGGBB
  secondaryColor: string;
  accentColor: string;
  website?: string;
  supportEmail?: string;
  phone?: string;
  address?: string;
  faviconUrl?: string;
  hideBrandedFooter: boolean;
  customDomain?: string;
  updatedAt: string;
}

export interface BrandingPreset {
  id: string;
  presetName: string;
  description?: string;
  isDefault: boolean;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  logoUrl?: string;
}

/**
 * Get clinic branding (cached)
 * Returns default branding if clinic has no custom branding
 */
export const getClinicBranding = cache(
  async (
    supabase: ReturnType<typeof getSupabaseServerClient>,
    clinicId: string
  ): Promise<ClinicBranding> => {
    try {
      const { data: clinic, error: clinicError } = await supabase
        .from("clinics")
        .select(
          `
        id,
        name,
        clinic_settings(
          clinic_logo_url,
          clinic_logo_dark_url,
          theme_primary_color,
          theme_secondary_color,
          theme_accent_color,
          clinic_website,
          clinic_support_email,
          clinic_phone,
          clinic_address,
          favicon_url,
          hide_branded_footer,
          custom_domain,
          branding_updated_at
        )
        `
        )
        .eq("id", clinicId)
        .single();

      if (clinicError) {
        console.error("Failed to fetch clinic branding:", clinicError);
        return getDefaultBranding(clinicId);
      }

      if (!clinic || !clinic.clinic_settings) {
        return getDefaultBranding(clinicId);
      }

      const settings = clinic.clinic_settings[0];

      return {
        clinicId,
        name: clinic.name,
        logoUrl: settings.clinic_logo_url,
        logoDarkUrl: settings.clinic_logo_dark_url,
        primaryColor: settings.theme_primary_color || "#0066cc",
        secondaryColor: settings.theme_secondary_color || "#00cc66",
        accentColor: settings.theme_accent_color || "#ff6600",
        website: settings.clinic_website,
        supportEmail: settings.clinic_support_email,
        phone: settings.clinic_phone,
        address: settings.clinic_address,
        faviconUrl: settings.favicon_url,
        hideBrandedFooter: settings.hide_branded_footer || false,
        customDomain: settings.custom_domain,
        updatedAt: settings.branding_updated_at
      };
    } catch (error) {
      console.error("Error fetching branding:", error);
      return getDefaultBranding(clinicId);
    }
  }
);

/**
 * Get default branding for new clinics
 */
export function getDefaultBranding(clinicId: string): ClinicBranding {
  return {
    clinicId,
    name: "Clinic",
    primaryColor: "#0066cc",
    secondaryColor: "#00cc66",
    accentColor: "#ff6600",
    hideBrandedFooter: false,
    updatedAt: new Date().toISOString()
  };
}

/**
 * Update clinic branding
 */
export async function updateClinicBranding(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  clinicId: string,
  branding: Partial<Omit<ClinicBranding, "clinicId" | "updatedAt">>
): Promise<void> {
  const updateData: Record<string, any> = {};

  if (branding.logoUrl !== undefined) updateData.clinic_logo_url = branding.logoUrl;
  if (branding.logoDarkUrl !== undefined) updateData.clinic_logo_dark_url = branding.logoDarkUrl;
  if (branding.primaryColor) updateData.theme_primary_color = branding.primaryColor;
  if (branding.secondaryColor) updateData.theme_secondary_color = branding.secondaryColor;
  if (branding.accentColor) updateData.theme_accent_color = branding.accentColor;
  if (branding.website !== undefined) updateData.clinic_website = branding.website;
  if (branding.supportEmail !== undefined) updateData.clinic_support_email = branding.supportEmail;
  if (branding.phone !== undefined) updateData.clinic_phone = branding.phone;
  if (branding.address !== undefined) updateData.clinic_address = branding.address;
  if (branding.faviconUrl !== undefined) updateData.favicon_url = branding.faviconUrl;
  if (branding.hideBrandedFooter !== undefined)
    updateData.hide_branded_footer = branding.hideBrandedFooter;
  if (branding.customDomain !== undefined) updateData.custom_domain = branding.customDomain;

  if (Object.keys(updateData).length === 0) {
    return; // Nothing to update
  }

  updateData.branding_updated_at = new Date().toISOString();

  const { error } = await supabase.from("clinic_settings").update(updateData).eq("clinic_id", clinicId);

  if (error) {
    throw new Error(`Failed to update branding: ${error.message}`);
  }
}

/**
 * Validate hex color format
 */
export function isValidHexColor(color: string): boolean {
  return /^#[0-9A-F]{6}$/i.test(color);
}

/**
 * Get all branding presets for a clinic
 */
export async function getBrandingPresets(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  clinicId: string
): Promise<BrandingPreset[]> {
  const { data, error } = await supabase
    .from("branding_presets")
    .select("*")
    .eq("clinic_id", clinicId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch branding presets: ${error.message}`);
  }

  return (data || []).map((preset) => ({
    id: preset.id,
    presetName: preset.preset_name,
    description: preset.description,
    isDefault: preset.is_default,
    primaryColor: preset.primary_color,
    secondaryColor: preset.secondary_color,
    accentColor: preset.accent_color,
    logoUrl: preset.logo_url
  }));
}

/**
 * Create a new branding preset
 */
export async function createBrandingPreset(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  clinicId: string,
  presetName: string,
  colors: {
    primary: string;
    secondary: string;
    accent: string;
  },
  logoUrl?: string
): Promise<string> {
  // Validate colors
  if (!isValidHexColor(colors.primary)) {
    throw new Error("Invalid primary color format");
  }
  if (!isValidHexColor(colors.secondary)) {
    throw new Error("Invalid secondary color format");
  }
  if (!isValidHexColor(colors.accent)) {
    throw new Error("Invalid accent color format");
  }

  const { data, error } = await supabase
    .from("branding_presets")
    .insert({
      clinic_id: clinicId,
      preset_name: presetName,
      primary_color: colors.primary,
      secondary_color: colors.secondary,
      accent_color: colors.accent,
      logo_url: logoUrl
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Failed to create preset: ${error.message}`);
  }

  return data.id;
}

/**
 * Apply a preset to the clinic
 */
export async function applyBrandingPreset(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  clinicId: string,
  presetId: string
): Promise<void> {
  // Get preset
  const { data: preset, error: fetchError } = await supabase
    .from("branding_presets")
    .select("*")
    .eq("id", presetId)
    .eq("clinic_id", clinicId)
    .single();

  if (fetchError || !preset) {
    throw new Error("Preset not found");
  }

  // Apply colors to clinic_settings
  await updateClinicBranding(supabase, clinicId, {
    primaryColor: preset.primary_color,
    secondaryColor: preset.secondary_color,
    accentColor: preset.accent_color,
    logoUrl: preset.logo_url
  });
}

/**
 * Delete a branding preset
 */
export async function deleteBrandingPreset(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  clinicId: string,
  presetId: string
): Promise<void> {
  const { error } = await supabase
    .from("branding_presets")
    .delete()
    .eq("id", presetId)
    .eq("clinic_id", clinicId);

  if (error) {
    throw new Error(`Failed to delete preset: ${error.message}`);
  }
}

/**
 * Format color for CSS
 */
export function colorToCss(hexColor: string): string {
  return hexColor; // Already in hex format
}

/**
 * Generate CSS variables from branding
 */
export function generateCssVariables(branding: ClinicBranding): Record<string, string> {
  return {
    "--color-brand-600": branding.primaryColor,
    "--color-brand-700": darkenColor(branding.primaryColor, 0.1),
    "--color-accent": branding.accentColor,
    "--color-secondary": branding.secondaryColor
  };
}

/**
 * Darken a hex color
 */
function darkenColor(hex: string, percent: number): string {
  let num = parseInt(hex.replace("#", ""), 16);
  let amt = Math.round(2.55 * percent);
  let R = (num >> 16) - amt;
  let G = (num >> 8 & 0x00FF) - amt;
  let B = (num & 0x0000FF) - amt;
  return (
    "#" +
    (
      0x1000000 +
      (R < 255 ? (R < 1 ? 0 : R) : 255) * 0x10000 +
      (G < 255 ? (G < 1 ? 0 : G) : 255) * 0x100 +
      (B < 255 ? (B < 1 ? 0 : B) : 255)
    )
      .toString(16)
      .slice(1)
  );
}
