/**
 * A/B Testing for Templates and Menus
 *
 * Support multiple versions of templates/menus and track performance.
 * Deterministic variant selection based on user ID or random.
 *
 * Example:
 *   const variant = selectVariant(userId, ["control", "variant_a"], { allocation: { control: 0.5, variant_a: 0.5 } });
 *   const template = await getTemplateVariant(supabase, clinicId, templateKey, language, variant);
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export interface ABTestConfig {
  test_key: string; // e.g., "reminder_template_v2"
  clinic_id: string;
  template_key: string;
  enabled: boolean;
  variants: Record<string, number>; // variant name -> allocation %
  created_at: string;
  updated_at: string;
}

export interface ABTestResult {
  test_key: string;
  clinic_id: string;
  variant: string;
  user_id?: string;
  event_type: "shown" | "clicked" | "error";
  created_at: string;
}

/**
 * Simple hash function for consistent variant selection
 */
function hashCode(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/**
 * Select variant deterministically based on user ID
 * Same user always gets same variant
 */
export function selectVariantDeterministic(
  userId: string | undefined,
  variants: string[],
  allocation?: Record<string, number>
): string {
  if (variants.length === 0) {
    throw new Error("Must provide at least one variant");
  }

  if (variants.length === 1) {
    return variants[0];
  }

  if (!userId) {
    // No user ID, pick randomly
    return selectVariantRandom(variants, allocation);
  }

  // Use hash of user ID to pick variant
  const hash = hashCode(userId);
  const total = allocation
    ? Object.values(allocation).reduce((a, b) => a + b, 0)
    : 100;

  let cumulative = 0;
  const normalizedAllocation =
    allocation ||
    Object.fromEntries(
      variants.map((v) => [v, 100 / variants.length])
    );

  const bucket = (hash % total) + 1;

  for (const variant of variants) {
    cumulative += normalizedAllocation[variant] || 0;
    if (bucket <= cumulative) {
      return variant;
    }
  }

  return variants[variants.length - 1];
}

/**
 * Select variant randomly
 */
export function selectVariantRandom(
  variants: string[],
  allocation?: Record<string, number>
): string {
  if (variants.length === 0) {
    throw new Error("Must provide at least one variant");
  }

  if (variants.length === 1) {
    return variants[0];
  }

  const normalizedAllocation =
    allocation ||
    Object.fromEntries(
      variants.map((v) => [v, 100 / variants.length])
    );

  const random = Math.random() * 100;
  let cumulative = 0;

  for (const variant of variants) {
    cumulative += normalizedAllocation[variant] || 0;
    if (random <= cumulative) {
      return variant;
    }
  }

  return variants[variants.length - 1];
}

/**
 * Track A/B test event
 */
export async function trackABTestEvent(
  supabase: SupabaseClient<Database>,
  clinicId: string | undefined,
  testKey: string,
  variant: string,
  eventType: "shown" | "clicked" | "error",
  userId?: string
): Promise<void> {
  if (!clinicId) {
    return;
  }

  try {
    await supabase
      .from("ab_test_results")
      .insert({
        clinic_id: clinicId,
        test_key: testKey,
        variant,
        user_id: userId,
        event_type: eventType,
        created_at: new Date().toISOString()
      });
  } catch (error) {
    console.warn("Failed to track A/B test event:", error);
  }
}

/**
 * Get A/B test results summary
 */
export async function getABTestResults(
  supabase: SupabaseClient<Database>,
  clinicId: string | undefined,
  testKey: string
): Promise<{
  test_key: string;
  variants: Record<
    string,
    { shown: number; clicked: number; error: number; ctr: number }
  >;
}> {
  if (!clinicId) {
    return { test_key: testKey, variants: {} };
  }

  try {
    const { data, error } = await supabase
      .from("ab_test_results")
      .select("variant, event_type")
      .eq("clinic_id", clinicId)
      .eq("test_key", testKey);

    if (error) throw error;

    const results: Record<
      string,
      { shown: number; clicked: number; error: number }
    > = {};

    for (const row of data || []) {
      if (!results[row.variant]) {
        results[row.variant] = { shown: 0, clicked: 0, error: 0 };
      }

      if (row.event_type === "shown") results[row.variant].shown++;
      if (row.event_type === "clicked") results[row.variant].clicked++;
      if (row.event_type === "error") results[row.variant].error++;
    }

    // Calculate CTR (click-through rate)
    const withCTR: Record<
      string,
      { shown: number; clicked: number; error: number; ctr: number }
    > = {};
    for (const [variant, counts] of Object.entries(results)) {
      withCTR[variant] = {
        ...counts,
        ctr: counts.shown > 0 ? (counts.clicked / counts.shown) * 100 : 0
      };
    }

    return { test_key: testKey, variants: withCTR };
  } catch (error) {
    console.error("Failed to get A/B test results:", error);
    return { test_key: testKey, variants: {} };
  }
}

/**
 * Get active A/B tests for a clinic
 */
export async function getActiveABTests(
  supabase: SupabaseClient<Database>,
  clinicId: string | undefined
): Promise<ABTestConfig[]> {
  if (!clinicId) {
    return [];
  }

  try {
    const { data, error } = await supabase
      .from("ab_tests")
      .select("*")
      .eq("clinic_id", clinicId)
      .eq("enabled", true);

    if (error) throw error;

    return data || [];
  } catch (error) {
    console.error("Failed to get A/B tests:", error);
    return [];
  }
}
