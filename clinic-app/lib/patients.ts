import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { normalizeWhatsAppPhone } from "@/lib/phone";

/**
 * Patient registry. Ports src/Model_Patients.gs.
 *
 * upsertPatient() no longer needs LockService — a Postgres
 * `INSERT ... ON CONFLICT (phone) DO UPDATE` is atomic by construction,
 * so there's no check-then-act race to guard against in the first
 * place (the Apps Script version's lock was working around Sheets
 * having no equivalent primitive).
 */

export type Patient = Database["public"]["Tables"]["patients"]["Row"];

const SUPPORTED_LANGUAGES = ["EN", "TE", "HI", "KA", "TA", "ML"] as const;
export type PatientLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export function isValidPatientName(name: string | null | undefined): boolean {
  const value = String(name ?? "").trim();

  if (value.length < 2) {
    return false;
  }

  if (/^\d+$/.test(value)) {
    return false;
  }

  return true;
}

export function normalizePatientLanguage(language: string | null | undefined): PatientLanguage {
  const upper = String(language ?? "").trim().toUpperCase();
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(upper)
    ? (upper as PatientLanguage)
    : "EN";
}

function generatePatientCode(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const suffix = Math.floor(Math.random() * 9000) + 1000;
  return `PAT-${y}${m}${d}-${suffix}`;
}

export async function findPatientByPhone(
  supabase: SupabaseClient<Database>,
  phone: string
): Promise<Patient | null> {
  const normalized = normalizeWhatsAppPhone(phone);

  if (!normalized) {
    return null;
  }

  const { data, error } = await supabase
    .from("patients")
    .select("*")
    .eq("phone", normalized)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to look up patient: ${error.message}`);
  }

  return data;
}

export interface UpsertPatientOptions {
  /** Defaults to true — set false for a lookup-only touch that shouldn't bump the visit timestamp (e.g. mid-booking name capture before the appointment is confirmed). */
  updateLastVisit?: boolean;
}

export interface UpsertPatientResult {
  patient: Patient;
  wasNew: boolean;
}

export async function upsertPatient(
  supabase: SupabaseClient<Database>,
  phone: string,
  name: string,
  language: string,
  options: UpsertPatientOptions = {}
): Promise<UpsertPatientResult> {
  const normalizedPhone = normalizeWhatsAppPhone(phone);

  if (!normalizedPhone) {
    throw new Error("Cannot upsert a patient with a blank phone number.");
  }

  const lang = normalizePatientLanguage(language);
  const updateLastVisit = options.updateLastVisit !== false;
  const now = new Date().toISOString();

  const existing = await findPatientByPhone(supabase, normalizedPhone);

  if (existing) {
    const { data, error } = await supabase
      .from("patients")
      .update({
        name: name || existing.name,
        language: lang,
        ...(updateLastVisit ? { last_visit_at: now } : {})
      })
      .eq("id", existing.id)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update patient: ${error.message}`);
    }

    return { patient: data, wasNew: false };
  }

  // Retry on the rare patient_code collision (4-digit random suffix —
  // the Apps Script version had no collision handling at all for this;
  // a unique constraint + short retry loop makes it actually safe
  // instead of just low-probability-of-failure).
  const MAX_ATTEMPTS = 5;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { data, error } = await supabase
      .from("patients")
      .insert({
        patient_code: generatePatientCode(),
        phone: normalizedPhone,
        name,
        language: lang,
        first_seen_at: now,
        last_visit_at: updateLastVisit ? now : null
      })
      .select()
      .single();

    if (!error) {
      return { patient: data, wasNew: true };
    }

    const isPatientCodeCollision = error.code === "23505" && error.message.includes("patient_code");

    if (!isPatientCodeCollision || attempt === MAX_ATTEMPTS) {
      throw new Error(`Failed to create patient: ${error.message}`);
    }
  }

  // Unreachable — the loop above always returns or throws.
  throw new Error("Failed to create patient after retries.");
}

/**
 * Was registerPatientForBooking — resolves the patient's language from
 * their existing record if the caller didn't supply one, so a returning
 * patient's language preference doesn't get silently reset to EN mid-
 * booking.
 */
export async function registerPatientForBooking(
  supabase: SupabaseClient<Database>,
  phone: string,
  name: string,
  language?: string
): Promise<UpsertPatientResult> {
  let lang = normalizePatientLanguage(language);

  if (!language) {
    const existing = await findPatientByPhone(supabase, phone);
    lang = existing ? normalizePatientLanguage(existing.language) : "EN";
  }

  return upsertPatient(supabase, phone, name, lang, { updateLastVisit: true });
}

/**
 * True if this phone number has no name on file yet (or an invalid
 * placeholder name) and the booking flow should ask for one before
 * continuing.
 */
export async function patientNeedsNameCapture(
  supabase: SupabaseClient<Database>,
  phone: string
): Promise<boolean> {
  const patient = await findPatientByPhone(supabase, phone);
  return !patient || !isValidPatientName(patient.name);
}

/**
 * Update patient name (for receptionist corrections).
 */
export async function updatePatientName(
  supabase: SupabaseClient<Database>,
  patientId: string,
  newName: string
): Promise<{ success: boolean; message: string; patient?: Patient }> {
  if (!isValidPatientName(newName)) {
    return { success: false, message: "Patient name must be at least 2 characters." };
  }

  const { data: patient, error: fetchError } = await supabase
    .from("patients")
    .select("*")
    .eq("id", patientId)
    .single();

  if (fetchError || !patient) {
    return { success: false, message: "Patient not found." };
  }

  const { data: updated, error: updateError } = await supabase
    .from("patients")
    .update({ name: newName })
    .eq("id", patientId)
    .select()
    .single();

  if (updateError) {
    return { success: false, message: `Failed to update patient name: ${updateError.message}` };
  }

  return {
    success: true,
    message: "Patient name updated successfully.",
    patient: updated
  };
}
