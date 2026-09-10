"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { requireAdminRole } from "@/lib/auth/authorize";
import {
  updateClinicBranding,
  createBrandingPreset,
  applyBrandingPreset,
  deleteBrandingPreset,
  isValidHexColor
} from "@/lib/branding/clinic";

/**
 * Update clinic branding
 */
export async function updateClinicBrandingAction(
  clinicId: string,
  branding: {
    primaryColor?: string;
    secondaryColor?: string;
    accentColor?: string;
    logoUrl?: string;
    website?: string;
    supportEmail?: string;
    phone?: string;
    address?: string;
  }
): Promise<void> {
  await requireAdminRole(["ADMIN"]);

  // Validate colors if provided
  if (branding.primaryColor && !isValidHexColor(branding.primaryColor)) {
    throw new Error("Invalid primary color format");
  }
  if (branding.secondaryColor && !isValidHexColor(branding.secondaryColor)) {
    throw new Error("Invalid secondary color format");
  }
  if (branding.accentColor && !isValidHexColor(branding.accentColor)) {
    throw new Error("Invalid accent color format");
  }

  try {
    const supabase = getSupabaseServerClient();
    await updateClinicBranding(supabase, clinicId, branding);
    revalidatePath("/admin/settings/branding");
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Failed to update branding");
  }
}

/**
 * Create a branding preset
 */
export async function createPresetAction(
  clinicId: string,
  presetName: string,
  colors: {
    primary: string;
    secondary: string;
    accent: string;
  }
): Promise<string> {
  await requireAdminRole(["ADMIN"]);

  try {
    const supabase = getSupabaseServerClient();
    const presetId = await createBrandingPreset(
      supabase,
      clinicId,
      presetName,
      colors
    );
    revalidatePath("/admin/settings/branding");
    return presetId;
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Failed to create preset");
  }
}

/**
 * Apply a branding preset
 */
export async function applyPresetAction(
  clinicId: string,
  presetId: string
): Promise<void> {
  await requireAdminRole(["ADMIN"]);

  try {
    const supabase = getSupabaseServerClient();
    await applyBrandingPreset(supabase, clinicId, presetId);
    revalidatePath("/admin/settings/branding");
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Failed to apply preset");
  }
}

/**
 * Delete a branding preset
 */
export async function deletePresetAction(
  clinicId: string,
  presetId: string
): Promise<void> {
  await requireAdminRole(["ADMIN"]);

  try {
    const supabase = getSupabaseServerClient();
    await deleteBrandingPreset(supabase, clinicId, presetId);
    revalidatePath("/admin/settings/branding");
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Failed to delete preset");
  }
}
