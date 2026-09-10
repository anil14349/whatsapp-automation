/**
 * Trigger Configuration Caching Layer
 * Caches menus, templates, and settings to avoid database queries on every message
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export interface TriggerMenu {
  id: string;
  trigger_key: string;
  language: string;
  title: string;
  description?: string;
  options: Array<{
    id: string;
    label: string;
    description?: string;
  }>;
  footer?: string;
}

export interface TriggerTemplate {
  id: string;
  template_key: string;
  language: string;
  subject?: string;
  body: string;
}

export interface TriggerSetting {
  setting_key: string;
  setting_value: string;
  value_type: "string" | "number" | "boolean" | "json";
}

// In-memory cache with TTL (Time To Live)
class TriggerCache {
  private menus = new Map<string, { data: TriggerMenu; expires: number }>();
  private templates = new Map<string, { data: TriggerTemplate; expires: number }>();
  private settings = new Map<string, { data: TriggerSetting[]; expires: number }>();

  private readonly DEFAULT_TTL_MS = 3600000; // 1 hour

  /**
   * Get cached menu or null if expired
   */
  getMenu(key: string): TriggerMenu | null {
    const cached = this.menus.get(key);
    if (!cached) return null;

    if (Date.now() > cached.expires) {
      this.menus.delete(key);
      return null;
    }

    return cached.data;
  }

  /**
   * Set menu in cache with TTL
   */
  setMenu(key: string, menu: TriggerMenu, ttlMs = this.DEFAULT_TTL_MS): void {
    this.menus.set(key, {
      data: menu,
      expires: Date.now() + ttlMs
    });
  }

  /**
   * Get cached template or null if expired
   */
  getTemplate(key: string): TriggerTemplate | null {
    const cached = this.templates.get(key);
    if (!cached) return null;

    if (Date.now() > cached.expires) {
      this.templates.delete(key);
      return null;
    }

    return cached.data;
  }

  /**
   * Set template in cache with TTL
   */
  setTemplate(key: string, template: TriggerTemplate, ttlMs = this.DEFAULT_TTL_MS): void {
    this.templates.set(key, {
      data: template,
      expires: Date.now() + ttlMs
    });
  }

  /**
   * Get cached settings or null if expired
   */
  getSettings(key: string): TriggerSetting[] | null {
    const cached = this.settings.get(key);
    if (!cached) return null;

    if (Date.now() > cached.expires) {
      this.settings.delete(key);
      return null;
    }

    return cached.data;
  }

  /**
   * Set settings in cache with TTL
   */
  setSettings(key: string, settings: TriggerSetting[], ttlMs = this.DEFAULT_TTL_MS): void {
    this.settings.set(key, {
      data: settings,
      expires: Date.now() + ttlMs
    });
  }

  /**
   * Clear all caches (useful for testing or full refresh)
   */
  clearAll(): void {
    this.menus.clear();
    this.templates.clear();
    this.settings.clear();
  }

  /**
   * Clear caches for a specific clinic
   */
  clearClinic(clinicId: string): void {
    // Clear menus for this clinic
    for (const [key] of this.menus) {
      if (key.startsWith(`menu:${clinicId}:`)) {
        this.menus.delete(key);
      }
    }

    // Clear templates for this clinic
    for (const [key] of this.templates) {
      if (key.startsWith(`template:${clinicId}:`)) {
        this.templates.delete(key);
      }
    }

    // Clear settings for this clinic
    for (const [key] of this.settings) {
      if (key.startsWith(`settings:${clinicId}:`)) {
        this.settings.delete(key);
      }
    }
  }

  /**
   * Get cache statistics (for debugging)
   */
  getStats() {
    return {
      menus: this.menus.size,
      templates: this.templates.size,
      settings: this.settings.size,
      total: this.menus.size + this.templates.size + this.settings.size
    };
  }
}

// Global cache instance
const cache = new TriggerCache();

/**
 * Get menu from cache or database
 */
export async function getMenu(
  supabase: SupabaseClient<Database>,
  clinicId: string,
  triggerKey: string,
  language = "EN"
): Promise<TriggerMenu | null> {
  const cacheKey = `menu:${clinicId}:${triggerKey}:${language}`;

  // Try cache first
  let menu = cache.getMenu(cacheKey);
  if (menu) {
    return menu;
  }

  // Query database
  const { data, error } = await supabase
    .from("trigger_menus")
    .select("*")
    .eq("clinic_id", clinicId)
    .eq("trigger_key", triggerKey)
    .eq("language", language)
    .eq("enabled", true)
    .single();

  if (error || !data) {
    return null;
  }

  menu = data as TriggerMenu;
  cache.setMenu(cacheKey, menu);

  return menu;
}

/**
 * Get template from cache or database
 */
export async function getTemplate(
  supabase: SupabaseClient<Database>,
  clinicId: string,
  templateKey: string,
  language = "EN"
): Promise<TriggerTemplate | null> {
  const cacheKey = `template:${clinicId}:${templateKey}:${language}`;

  // Try cache first
  let template = cache.getTemplate(cacheKey);
  if (template) {
    return template;
  }

  // Query database
  const { data, error } = await supabase
    .from("trigger_templates")
    .select("*")
    .eq("clinic_id", clinicId)
    .eq("template_key", templateKey)
    .eq("language", language)
    .eq("enabled", true)
    .single();

  if (error || !data) {
    return null;
  }

  template = data as TriggerTemplate;
  cache.setTemplate(cacheKey, template);

  return template;
}

/**
 * Get all settings for a clinic
 */
export async function getSettings(
  supabase: SupabaseClient<Database>,
  clinicId: string
): Promise<Map<string, TriggerSetting>> {
  const cacheKey = `settings:${clinicId}`;

  // Try cache first
  let settings = cache.getSettings(cacheKey);
  if (settings) {
    return new Map(settings.map((s) => [s.setting_key, s]));
  }

  // Query database
  const { data, error } = await supabase
    .from("trigger_settings")
    .select("*")
    .eq("clinic_id", clinicId);

  if (error || !data) {
    return new Map();
  }

  const settingsArray = data as TriggerSetting[];
  cache.setSettings(cacheKey, settingsArray);

  return new Map(settingsArray.map((s) => [s.setting_key, s]));
}

/**
 * Get a single setting value
 */
export async function getSetting(
  supabase: SupabaseClient<Database>,
  clinicId: string,
  key: string,
  defaultValue?: string
): Promise<string | null> {
  const settings = await getSettings(supabase, clinicId);
  const setting = settings.get(key);

  if (!setting) {
    return defaultValue || null;
  }

  return setting.setting_value;
}

/**
 * Get setting as number
 */
export async function getSettingNumber(
  supabase: SupabaseClient<Database>,
  clinicId: string,
  key: string,
  defaultValue = 0
): Promise<number> {
  const value = await getSetting(supabase, clinicId, key);
  return value ? parseInt(value, 10) : defaultValue;
}

/**
 * Get setting as boolean
 */
export async function getSettingBoolean(
  supabase: SupabaseClient<Database>,
  clinicId: string,
  key: string,
  defaultValue = false
): Promise<boolean> {
  const value = await getSetting(supabase, clinicId, key);
  return value ? value.toLowerCase() === "true" : defaultValue;
}

/**
 * Interpolate template with variables
 */
export function interpolateTemplate(template: string, variables: Record<string, string>): string {
  let result = template;

  Object.entries(variables).forEach(([key, value]) => {
    const placeholder = `{{${key}}}`;
    result = result.replace(new RegExp(placeholder, "g"), value || "");
  });

  return result;
}

/**
 * Invalidate cache (call when triggers are updated)
 */
export function invalidateCache(clinicId?: string): void {
  if (clinicId) {
    cache.clearClinic(clinicId);
  } else {
    cache.clearAll();
  }
}

/**
 * Get cache statistics for monitoring
 */
export function getCacheStats() {
  return cache.getStats();
}

/**
 * Update menu and invalidate cache
 */
export async function updateMenu(
  supabase: SupabaseClient<Database>,
  clinicId: string,
  triggerKey: string,
  language: string,
  updates: Partial<TriggerMenu>
): Promise<TriggerMenu | null> {
  const { data, error } = await supabase
    .from("trigger_menus")
    .update(updates)
    .eq("clinic_id", clinicId)
    .eq("trigger_key", triggerKey)
    .eq("language", language)
    .select()
    .single();

  if (error || !data) {
    return null;
  }

  // Invalidate cache
  invalidateCache(clinicId);

  return data as TriggerMenu;
}

/**
 * Update template and invalidate cache
 */
export async function updateTemplate(
  supabase: SupabaseClient<Database>,
  clinicId: string,
  templateKey: string,
  language: string,
  updates: Partial<TriggerTemplate>
): Promise<TriggerTemplate | null> {
  const { data, error } = await supabase
    .from("trigger_templates")
    .update(updates)
    .eq("clinic_id", clinicId)
    .eq("template_key", templateKey)
    .eq("language", language)
    .select()
    .single();

  if (error || !data) {
    return null;
  }

  // Invalidate cache
  invalidateCache(clinicId);

  return data as TriggerTemplate;
}

/**
 * Update setting and invalidate cache
 */
export async function updateSetting(
  supabase: SupabaseClient<Database>,
  clinicId: string,
  key: string,
  value: string
): Promise<boolean> {
  const { error } = await supabase
    .from("trigger_settings")
    .upsert(
      {
        clinic_id: clinicId,
        setting_key: key,
        setting_value: value,
        updated_at: new Date().toISOString()
      },
      {
        onConflict: "clinic_id,setting_key"
      }
    );

  if (error) {
    return false;
  }

  // Invalidate cache
  invalidateCache(clinicId);

  return true;
}
