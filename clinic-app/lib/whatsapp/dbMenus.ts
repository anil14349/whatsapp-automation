/**
 * Database-Driven Menu Loading Layer
 *
 * Loads WhatsApp menus from the database (via cache) with fallback to hardcoded menus.
 * This allows clinics to customize menu text, options, and labels without code changes.
 *
 * Architecture:
 * 1. Try to load from cache/database (if clinic_id available)
 * 2. Fall back to hardcoded menu if database menu missing
 * 3. Return standard MenuReply format
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { MenuReply, MenuRow } from "./send";
import { buildInteractiveButtonSpec, buildInteractiveListSpec } from "./menus";
import { getMenu } from "@/lib/triggers/cache";
import type { Doctor } from "@/lib/doctors";

/**
 * Load language menu from database with fallback
 */
export async function getLanguageMenuFromDb(
  supabase: SupabaseClient<Database>,
  clinicId: string | undefined,
  language: string
): Promise<MenuReply> {
  if (!clinicId) {
    return getLanguageMenuFallback();
  }

  try {
    const dbMenu = await getMenu(supabase, clinicId, "LANGUAGE_SELECT", language);

    if (dbMenu?.options && dbMenu.options.length > 0) {
      const rows: MenuRow[] = dbMenu.options.map((opt: any) => ({
        id: String(opt.id),
        title: opt.label,
        description: opt.description
      }));

      return {
        fallbackText: dbMenu.options.map((opt: any) => `${opt.id}. ${opt.label}`).join("\n"),
        interactive: buildInteractiveListSpec(rows, "Select language") || {
          type: "list",
          buttonLabel: "Select language",
          sections: [
            {
              title: "Options",
              rows: rows.map((r) => ({
                id: r.id,
                title: r.title,
                description: r.description || ""
              }))
            }
          ]
        }
      };
    }
  } catch (error) {
    console.warn("Failed to load LANGUAGE_SELECT from database, using fallback", error);
  }

  return getLanguageMenuFallback();
}

function getLanguageMenuFallback(): MenuReply {
  return {
    fallbackText: "1. English\n2. Telugu\n3. Hindi\n4. Kannada\n5. Tamil\n6. Malayalam",
    interactive: buildInteractiveListSpec(
      [
        { id: "1", title: "English" },
        { id: "2", title: "Telugu", description: "తెలుగు" },
        { id: "3", title: "Hindi", description: "हिन्दी" },
        { id: "4", title: "Kannada", description: "ಕನ್ನಡ" },
        { id: "5", title: "Tamil", description: "தமிழ்" },
        { id: "6", title: "Malayalam", description: "മലയാളം" }
      ],
      "Select language"
    )
  };
}

/**
 * Load main menu from database with fallback
 */
export async function getMainMenuFromDb(
  supabase: SupabaseClient<Database>,
  clinicId: string | undefined,
  language: string
): Promise<MenuReply> {
  if (!clinicId) {
    return getMainMenuFallback();
  }

  try {
    const dbMenu = await getMenu(supabase, clinicId, "MAIN_MENU", language);

    if (dbMenu?.options && dbMenu.options.length > 0) {
      const buttons = dbMenu.options
        .filter((opt: any) => opt.id !== "*")
        .slice(0, 3)
        .map((opt: any) => ({
          id: String(opt.id),
          title: opt.label
        }));

      return {
        fallbackText: dbMenu.options.map((opt: any) => `${opt.id}. ${opt.label}`).join("\n"),
        interactive: buildInteractiveButtonSpec(buttons)
      };
    }
  } catch (error) {
    console.warn("Failed to load MAIN_MENU from database, using fallback", error);
  }

  return getMainMenuFallback();
}

function getMainMenuFallback(): MenuReply {
  return {
    fallbackText: "1. Book Appointment\n2. My Appointments\n3. More",
    interactive: buildInteractiveButtonSpec([
      { id: "1", title: "Book Appointment" },
      { id: "2", title: "My Appointments" },
      { id: "menu_more", title: "More" }
    ])
  };
}

/**
 * Load date menu from database with fallback
 */
export async function getDateMenuFromDb(
  supabase: SupabaseClient<Database>,
  clinicId: string | undefined,
  language: string
): Promise<MenuReply> {
  if (!clinicId) {
    return getDateMenuFallback();
  }

  try {
    const dbMenu = await getMenu(supabase, clinicId, "BOOK_DATE", language);

    if (dbMenu?.options && dbMenu.options.length > 0) {
      const buttons = dbMenu.options.slice(0, 3).map((opt: any) => ({
        id: String(opt.id),
        title: opt.label
      }));

      return {
        fallbackText: dbMenu.options.map((opt: any) => `${opt.id}. ${opt.label}`).join("\n"),
        interactive: buildInteractiveButtonSpec(buttons)
      };
    }
  } catch (error) {
    console.warn("Failed to load BOOK_DATE from database, using fallback", error);
  }

  return getDateMenuFallback();
}

function getDateMenuFallback(): MenuReply {
  return {
    fallbackText: "1. Today\n2. Tomorrow\n3. Enter another date",
    interactive: buildInteractiveButtonSpec([
      { id: "1", title: "Today" },
      { id: "2", title: "Tomorrow" },
      { id: "3", title: "Other date" }
    ])
  };
}

/**
 * Load doctor selection menu from database with fallback
 * Note: Database menu is used as template; actual doctor list comes from function params
 */
export async function getDoctorSelectionMenuFromDb(
  supabase: SupabaseClient<Database>,
  clinicId: string | undefined,
  language: string,
  doctors: Doctor[],
  page = 0
): Promise<MenuReply> {
  // Build pagination
  const APPOINTMENT_LIST_PAGE_SIZE = 10;
  const start = page * APPOINTMENT_LIST_PAGE_SIZE;
  const pageItems = doctors.slice(start, start + APPOINTMENT_LIST_PAGE_SIZE);
  const hasPrev = page > 0;
  const hasNext = start + APPOINTMENT_LIST_PAGE_SIZE < doctors.length;

  const fallbackLines = doctors.map(
    (doctor, index) =>
      `${index + 1}. ${doctor.name}${doctor.specialization ? ` — ${doctor.specialization}` : ""}`
  );

  const rows: MenuRow[] = pageItems.map((doctor) => ({
    id: `doctor_select_${doctor.doctor_code}`,
    title: doctor.name,
    description: doctor.specialization || doctor.clinic_name
  }));

  if (hasPrev) {
    rows.push({ id: "doctor_prev", title: "⬅️ Previous" });
  }

  if (hasNext) {
    rows.push({ id: "doctor_next", title: "➡️ Next" });
  }

  return {
    fallbackText: fallbackLines.join("\n") + "\n\nReply with the doctor's number.",
    interactive: buildInteractiveListSpec(rows, "Select doctor")
  };
}
