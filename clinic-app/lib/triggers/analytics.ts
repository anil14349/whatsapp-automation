/**
 * Menu and Message Analytics
 *
 * Track menu interactions and message delivery for analytics.
 * Understand which menus are used most, success rates, etc.
 *
 * Example:
 *   await trackMenuShown(supabase, clinicId, "MAIN_MENU", language, patientPhone);
 *   await trackMenuClicked(supabase, clinicId, "MAIN_MENU", "1", language, patientPhone);
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export interface MenuAnalytic {
  id: string;
  clinic_id: string;
  menu_key: string;
  language: string;
  action: "shown" | "clicked" | "error";
  user_phone?: string;
  selected_option?: string;
  timestamp: string;
}

export interface TemplateAnalytic {
  id: string;
  clinic_id: string;
  template_key: string;
  language: string;
  action: "sent" | "failed" | "bounced";
  user_phone?: string;
  error_message?: string;
  timestamp: string;
}

/**
 * Track menu shown event
 */
export async function trackMenuShown(
  supabase: SupabaseClient<Database>,
  clinicId: string | undefined,
  menuKey: string,
  language: string,
  userPhone?: string
): Promise<void> {
  if (!clinicId) {
    return;
  }

  try {
    await supabase.from("menu_analytics").insert({
      clinic_id: clinicId,
      menu_key: menuKey,
      language,
      action: "shown",
      user_phone: userPhone,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.warn("Failed to track menu shown:", error);
  }
}

/**
 * Track menu clicked event
 */
export async function trackMenuClicked(
  supabase: SupabaseClient<Database>,
  clinicId: string | undefined,
  menuKey: string,
  selectedOption: string,
  language: string,
  userPhone?: string
): Promise<void> {
  if (!clinicId) {
    return;
  }

  try {
    await supabase.from("menu_analytics").insert({
      clinic_id: clinicId,
      menu_key: menuKey,
      language,
      action: "clicked",
      selected_option: selectedOption,
      user_phone: userPhone,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.warn("Failed to track menu clicked:", error);
  }
}

/**
 * Track menu error
 */
export async function trackMenuError(
  supabase: SupabaseClient<Database>,
  clinicId: string | undefined,
  menuKey: string,
  language: string,
  errorMessage: string,
  userPhone?: string
): Promise<void> {
  if (!clinicId) {
    return;
  }

  try {
    await supabase.from("menu_analytics").insert({
      clinic_id: clinicId,
      menu_key: menuKey,
      language,
      action: "error",
      user_phone: userPhone,
      selected_option: errorMessage,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.warn("Failed to track menu error:", error);
  }
}

/**
 * Track template sent event
 */
export async function trackTemplateSent(
  supabase: SupabaseClient<Database>,
  clinicId: string | undefined,
  templateKey: string,
  language: string,
  userPhone?: string
): Promise<void> {
  if (!clinicId) {
    return;
  }

  try {
    await supabase.from("template_analytics").insert({
      clinic_id: clinicId,
      template_key: templateKey,
      language,
      action: "sent",
      user_phone: userPhone,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.warn("Failed to track template sent:", error);
  }
}

/**
 * Track template failure
 */
export async function trackTemplateError(
  supabase: SupabaseClient<Database>,
  clinicId: string | undefined,
  templateKey: string,
  language: string,
  errorMessage: string,
  userPhone?: string
): Promise<void> {
  if (!clinicId) {
    return;
  }

  try {
    await supabase.from("template_analytics").insert({
      clinic_id: clinicId,
      template_key: templateKey,
      language,
      action: "failed",
      user_phone: userPhone,
      error_message: errorMessage,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.warn("Failed to track template error:", error);
  }
}

/**
 * Get menu analytics summary
 */
export async function getMenuAnalyticsSummary(
  supabase: SupabaseClient<Database>,
  clinicId: string | undefined,
  menuKey?: string,
  days: number = 7
): Promise<{
  menu_key?: string;
  total_shown: number;
  total_clicked: number;
  total_errors: number;
  ctr: number; // click-through rate
  menus?: Record<string, { shown: number; clicked: number; errors: number; ctr: number }>;
}> {
  if (!clinicId) {
    return { total_shown: 0, total_clicked: 0, total_errors: 0, ctr: 0 };
  }

  try {
    const since = new Date();
    since.setDate(since.getDate() - days);

    let query = supabase
      .from("menu_analytics")
      .select("menu_key, action")
      .eq("clinic_id", clinicId)
      .gte("timestamp", since.toISOString());

    if (menuKey) {
      query = query.eq("menu_key", menuKey);
    }

    const { data, error } = await query;

    if (error) throw error;

    const results: Record<string, { shown: number; clicked: number; errors: number }> = {};
    let totalShown = 0,
      totalClicked = 0,
      totalErrors = 0;

    for (const row of data || []) {
      if (!results[row.menu_key]) {
        results[row.menu_key] = { shown: 0, clicked: 0, errors: 0 };
      }

      if (row.action === "shown") {
        results[row.menu_key].shown++;
        totalShown++;
      } else if (row.action === "clicked") {
        results[row.menu_key].clicked++;
        totalClicked++;
      } else if (row.action === "error") {
        results[row.menu_key].errors++;
        totalErrors++;
      }
    }

    // Calculate CTR
    const menus: Record<string, { shown: number; clicked: number; errors: number; ctr: number }> = {};
    for (const [key, counts] of Object.entries(results)) {
      menus[key] = {
        ...counts,
        ctr: counts.shown > 0 ? (counts.clicked / counts.shown) * 100 : 0
      };
    }

    return {
      menu_key: menuKey,
      total_shown: totalShown,
      total_clicked: totalClicked,
      total_errors: totalErrors,
      ctr: totalShown > 0 ? (totalClicked / totalShown) * 100 : 0,
      menus: menuKey ? undefined : menus
    };
  } catch (error) {
    console.error("Failed to get menu analytics:", error);
    return { total_shown: 0, total_clicked: 0, total_errors: 0, ctr: 0 };
  }
}

/**
 * Get template analytics summary
 */
export async function getTemplateAnalyticsSummary(
  supabase: SupabaseClient<Database>,
  clinicId: string | undefined,
  templateKey?: string,
  days: number = 7
): Promise<{
  template_key?: string;
  total_sent: number;
  total_failed: number;
  success_rate: number;
  templates?: Record<string, { sent: number; failed: number; success_rate: number }>;
}> {
  if (!clinicId) {
    return { total_sent: 0, total_failed: 0, success_rate: 0 };
  }

  try {
    const since = new Date();
    since.setDate(since.getDate() - days);

    let query = supabase
      .from("template_analytics")
      .select("template_key, action")
      .eq("clinic_id", clinicId)
      .gte("timestamp", since.toISOString());

    if (templateKey) {
      query = query.eq("template_key", templateKey);
    }

    const { data, error } = await query;

    if (error) throw error;

    const results: Record<string, { sent: number; failed: number }> = {};
    let totalSent = 0,
      totalFailed = 0;

    for (const row of data || []) {
      if (!results[row.template_key]) {
        results[row.template_key] = { sent: 0, failed: 0 };
      }

      if (row.action === "sent") {
        results[row.template_key].sent++;
        totalSent++;
      } else if (row.action === "failed") {
        results[row.template_key].failed++;
        totalFailed++;
      }
    }

    // Calculate success rate
    const templates: Record<string, { sent: number; failed: number; success_rate: number }> = {};
    for (const [key, counts] of Object.entries(results)) {
      const total = counts.sent + counts.failed;
      templates[key] = {
        ...counts,
        success_rate: total > 0 ? (counts.sent / total) * 100 : 0
      };
    }

    const totalAll = totalSent + totalFailed;

    return {
      template_key: templateKey,
      total_sent: totalSent,
      total_failed: totalFailed,
      success_rate: totalAll > 0 ? (totalSent / totalAll) * 100 : 0,
      templates: templateKey ? undefined : templates
    };
  } catch (error) {
    console.error("Failed to get template analytics:", error);
    return { total_sent: 0, total_failed: 0, success_rate: 0 };
  }
}
