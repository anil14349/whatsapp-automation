/**
 * Template Loading and Interpolation Layer
 *
 * Load message templates from database and interpolate {{variables}}.
 * Supports A/B testing with version selection.
 *
 * Example:
 *   const template = await getTemplateAndInterpolate(supabase, clinicId, "APPOINTMENT_REMINDER", "EN", {
 *     patient_name: "John",
 *     doctor_name: "Dr. Smith",
 *     appointment_time: "2:00 PM"
 *   }, { testGroup: "variant_a" });
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { getTemplate, interpolateTemplate } from "./cache";

/**
 * Get template and interpolate all {{variables}}
 * Supports A/B testing with variant selection
 */
export async function getTemplateAndInterpolate(
  supabase: SupabaseClient<Database>,
  clinicId: string | undefined,
  templateKey: string,
  language: string,
  variables: Record<string, string | number | boolean>,
  options?: {
    testGroup?: string; // A/B test variant
    fallbackBody?: string; // Fallback if template not found
  }
): Promise<string> {
  if (!clinicId) {
    return options?.fallbackBody || "Template not available";
  }

  try {
    const template = await getTemplate(supabase, clinicId, templateKey, language);

    if (!template?.body) {
      return options?.fallbackBody || "Template not available";
    }

    // TODO: A/B testing - select variant if multiple versions exist
    // For now, use the first/default version

    return interpolateTemplate(template.body, variables);
  } catch (error) {
    console.warn(
      `Failed to load template ${templateKey}, using fallback`,
      error
    );
    return options?.fallbackBody || "Template not available";
  }
}

/**
 * Get template without interpolation (for admin/preview)
 */
export async function getTemplateRaw(
  supabase: SupabaseClient<Database>,
  clinicId: string | undefined,
  templateKey: string,
  language: string
): Promise<string> {
  if (!clinicId) {
    return "";
  }

  try {
    const template = await getTemplate(supabase, clinicId, templateKey, language);
    return template?.body || "";
  } catch (error) {
    console.warn(`Failed to load template ${templateKey}`, error);
    return "";
  }
}

/**
 * List all available template keys for a clinic
 * Used by admin UI to show available templates
 */
export async function listTemplateKeys(
  supabase: SupabaseClient<Database>,
  clinicId: string | undefined
): Promise<string[]> {
  if (!clinicId) {
    return [];
  }

  try {
    const { data, error } = await supabase
      .from("trigger_templates")
      .select("template_key")
      .eq("clinic_id", clinicId)
      .distinct();

    if (error) {
      console.error("Failed to list templates:", error);
      return [];
    }

    return data?.map((row: any) => row.template_key) || [];
  } catch (error) {
    console.error("Failed to list templates:", error);
    return [];
  }
}

/**
 * Validate template variables are provided
 */
export function validateTemplateVariables(
  templateBody: string,
  providedVariables: Record<string, string | number | boolean>
): { valid: boolean; missingVariables: string[] } {
  const placeholderRegex = /\{\{([^}]+)\}\}/g;
  const matches = Array.from(templateBody.matchAll(placeholderRegex));
  const requiredVars = new Set(matches.map((m) => m[1]?.trim()));

  const missingVariables = Array.from(requiredVars).filter(
    (v) => !(v in providedVariables)
  );

  return {
    valid: missingVariables.length === 0,
    missingVariables
  };
}
