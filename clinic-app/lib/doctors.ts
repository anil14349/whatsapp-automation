import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Weekday } from "@/lib/supabase/database.types";
import { isoDateToWeekday } from "@/lib/scheduling/dates";
import { normalizeWhatsAppPhone, phonesMatch } from "@/lib/phone";

/**
 * Doctor records, availability, and leave management.
 * Ports the CRUD portions of src/Model_Doctors.gs. The read-only report
 * views (getDoctorTodaySchedule / ScheduleForDate / WeeklySchedule /
 * NextAppointment) are NOT ported 1:1 here — with real SQL, those are all
 * just `listAppointmentsForDoctor` with a different date filter, and the
 * admin UI can query however it needs instead of the app pre-baking four
 * near-identical hand-rolled report functions (see src/Model_Doctors.gs
 * for those, ~120 lines of near-duplicate logic each — one of the things
 * this rewrite improves on by construction).
 */

export type Doctor = Database["public"]["Tables"]["doctors"]["Row"];
export type DoctorInsert = Database["public"]["Tables"]["doctors"]["Insert"];
export type DoctorUpdate = Database["public"]["Tables"]["doctors"]["Update"];
export type DoctorAvailability =
  Database["public"]["Tables"]["doctor_availability"]["Row"];
export type DoctorLeave = Database["public"]["Tables"]["doctor_leaves"]["Row"];

export async function listDoctors(
  supabase: SupabaseClient<Database>,
  options: { activeOnly?: boolean } = {}
): Promise<Doctor[]> {
  let query = supabase.from("doctors").select("*").order("name");

  if (options.activeOnly) {
    query = query.eq("active", true);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to list doctors: ${error.message}`);
  }

  return data;
}

export async function getDoctorByCode(
  supabase: SupabaseClient<Database>,
  doctorCode: string
): Promise<Doctor | null> {
  const { data, error } = await supabase
    .from("doctors")
    .select("*")
    .eq("doctor_code", doctorCode)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load doctor "${doctorCode}": ${error.message}`);
  }

  return data;
}

export async function getDoctorById(
  supabase: SupabaseClient<Database>,
  id: string
): Promise<Doctor | null> {
  const { data, error } = await supabase
    .from("doctors")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load doctor ${id}: ${error.message}`);
  }

  return data;
}

/**
 * Was findDoctorByWhatsAppPhone — routes an inbound WhatsApp message to
 * the doctor conversation flow instead of the patient one.
 */
export async function findDoctorByWhatsAppPhone(
  supabase: SupabaseClient<Database>,
  phone: string
): Promise<Doctor | null> {
  const normalized = normalizeWhatsAppPhone(phone);

  if (!normalized) {
    return null;
  }

  // whatsapp_phone is stored however it was entered (with/without country
  // code), so an exact match on the normalized form covers the common
  // case; phonesMatch below is a defensive fallback for the rare case an
  // existing row wasn't normalized when it was created (e.g. imported
  // data). This function is called on every single inbound message, so
  // it's worth the exact-match fast path via the index on
  // doctors.whatsapp_phone rather than always scanning every doctor row.
  const { data: exact, error: exactError } = await supabase
    .from("doctors")
    .select("*")
    .eq("whatsapp_phone", normalized)
    .eq("active", true)
    .maybeSingle();

  if (exactError) {
    throw new Error(`Failed to look up doctor by phone: ${exactError.message}`);
  }

  if (exact) {
    return exact;
  }

  const { data: candidates, error: candidatesError } = await supabase
    .from("doctors")
    .select("*")
    .eq("active", true)
    .not("whatsapp_phone", "eq", "");

  if (candidatesError) {
    throw new Error(
      `Failed to look up doctor by phone: ${candidatesError.message}`
    );
  }

  return (
    candidates.find((doctor) => phonesMatch(doctor.whatsapp_phone, phone)) ??
    null
  );
}

export async function createDoctor(
  supabase: SupabaseClient<Database>,
  doctor: DoctorInsert
): Promise<Doctor> {
  const { data, error } = await supabase
    .from("doctors")
    .insert(doctor)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create doctor: ${error.message}`);
  }

  return data;
}

export async function updateDoctor(
  supabase: SupabaseClient<Database>,
  id: string,
  updates: DoctorUpdate
): Promise<Doctor> {
  const { data, error } = await supabase
    .from("doctors")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update doctor ${id}: ${error.message}`);
  }

  return data;
}

// ------------------------------------------------------------------
// Availability
// ------------------------------------------------------------------

export async function getDoctorAvailability(
  supabase: SupabaseClient<Database>,
  doctorId: string
): Promise<DoctorAvailability[]> {
  const { data, error } = await supabase
    .from("doctor_availability")
    .select("*")
    .eq("doctor_id", doctorId)
    .order("day_of_week")
    .order("start_time");

  if (error) {
    throw new Error(
      `Failed to load availability for doctor ${doctorId}: ${error.message}`
    );
  }

  return data;
}

export async function getDoctorAvailabilityForDate(
  supabase: SupabaseClient<Database>,
  doctorId: string,
  isoDate: string
): Promise<DoctorAvailability[]> {
  const weekday = isoDateToWeekday(isoDate);

  const { data, error } = await supabase
    .from("doctor_availability")
    .select("*")
    .eq("doctor_id", doctorId)
    .eq("day_of_week", weekday)
    .order("start_time");

  if (error) {
    throw new Error(
      `Failed to load availability for doctor ${doctorId} on ${isoDate}: ${error.message}`
    );
  }

  return data;
}

export async function addDoctorAvailabilitySession(
  supabase: SupabaseClient<Database>,
  doctorId: string,
  dayOfWeek: Weekday,
  startTime: string,
  endTime: string
): Promise<DoctorAvailability> {
  if (startTime >= endTime) {
    throw new Error("End time must be after start time.");
  }

  const { data, error } = await supabase
    .from("doctor_availability")
    .insert({ doctor_id: doctorId, day_of_week: dayOfWeek, start_time: startTime, end_time: endTime })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to add availability session: ${error.message}`);
  }

  return data;
}

export async function removeDoctorAvailabilitySession(
  supabase: SupabaseClient<Database>,
  sessionId: string
): Promise<void> {
  const { error } = await supabase
    .from("doctor_availability")
    .delete()
    .eq("id", sessionId);

  if (error) {
    throw new Error(`Failed to remove availability session: ${error.message}`);
  }
}

export async function clearDoctorDayAvailability(
  supabase: SupabaseClient<Database>,
  doctorId: string,
  dayOfWeek: Weekday
): Promise<void> {
  const { error } = await supabase
    .from("doctor_availability")
    .delete()
    .eq("doctor_id", doctorId)
    .eq("day_of_week", dayOfWeek);

  if (error) {
    throw new Error(`Failed to clear ${dayOfWeek} availability: ${error.message}`);
  }
}

/**
 * Replace-all for a whole week in one call — the shape the admin UI's
 * availability editor naturally produces (a form with checkboxes/time
 * pickers per day), as opposed to the WhatsApp bot's one-session-at-a-
 * time conversation which uses the granular functions above instead.
 */
export async function replaceDoctorWeeklyAvailability(
  supabase: SupabaseClient<Database>,
  doctorId: string,
  sessions: Array<{ dayOfWeek: Weekday; startTime: string; endTime: string }>
): Promise<void> {
  for (const session of sessions) {
    if (session.startTime >= session.endTime) {
      throw new Error(
        `Invalid session for ${session.dayOfWeek}: end time must be after start time.`
      );
    }
  }

  const { error: deleteError } = await supabase
    .from("doctor_availability")
    .delete()
    .eq("doctor_id", doctorId);

  if (deleteError) {
    throw new Error(`Failed to replace availability: ${deleteError.message}`);
  }

  if (sessions.length === 0) {
    return;
  }

  const { error: insertError } = await supabase.from("doctor_availability").insert(
    sessions.map((session) => ({
      doctor_id: doctorId,
      day_of_week: session.dayOfWeek,
      start_time: session.startTime,
      end_time: session.endTime
    }))
  );

  if (insertError) {
    throw new Error(`Failed to replace availability: ${insertError.message}`);
  }
}

// ------------------------------------------------------------------
// Leaves
// ------------------------------------------------------------------

export async function isDoctorOnLeave(
  supabase: SupabaseClient<Database>,
  doctorId: string,
  isoDate: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("doctor_leaves")
    .select("id")
    .eq("doctor_id", doctorId)
    .eq("leave_date", isoDate)
    .eq("active", true)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to check leave status: ${error.message}`);
  }

  return data !== null;
}

export async function getDoctorUpcomingLeaves(
  supabase: SupabaseClient<Database>,
  doctorId: string,
  fromIsoDate: string
): Promise<DoctorLeave[]> {
  const { data, error } = await supabase
    .from("doctor_leaves")
    .select("*")
    .eq("doctor_id", doctorId)
    .eq("active", true)
    .gte("leave_date", fromIsoDate)
    .order("leave_date");

  if (error) {
    throw new Error(`Failed to load upcoming leaves: ${error.message}`);
  }

  return data;
}

export async function addDoctorLeave(
  supabase: SupabaseClient<Database>,
  doctorId: string,
  isoDate: string,
  reason = ""
): Promise<DoctorLeave> {
  // Upsert semantics: re-adding a leave for a date that has an inactive
  // (previously cancelled) row for the same date reactivates it instead
  // of erroring on the unique (doctor_id, leave_date) constraint.
  const { data, error } = await supabase
    .from("doctor_leaves")
    .upsert(
      { doctor_id: doctorId, leave_date: isoDate, reason, active: true },
      { onConflict: "doctor_id,leave_date" }
    )
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to add leave: ${error.message}`);
  }

  return data;
}

export async function addDoctorLeaveRange(
  supabase: SupabaseClient<Database>,
  doctorId: string,
  startIsoDate: string,
  endIsoDate: string,
  reason = ""
): Promise<{ added: number }> {
  if (startIsoDate > endIsoDate) {
    throw new Error("Start date must be on or before end date.");
  }

  const dates: string[] = [];
  const cursor = new Date(`${startIsoDate}T00:00:00Z`);
  const end = new Date(`${endIsoDate}T00:00:00Z`);

  while (cursor.getTime() <= end.getTime()) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const { error } = await supabase.from("doctor_leaves").upsert(
    dates.map((leaveDate) => ({
      doctor_id: doctorId,
      leave_date: leaveDate,
      reason,
      active: true
    })),
    { onConflict: "doctor_id,leave_date" }
  );

  if (error) {
    throw new Error(`Failed to add leave range: ${error.message}`);
  }

  return { added: dates.length };
}

export async function deactivateDoctorLeave(
  supabase: SupabaseClient<Database>,
  doctorId: string,
  isoDate: string
): Promise<void> {
  const { error } = await supabase
    .from("doctor_leaves")
    .update({ active: false })
    .eq("doctor_id", doctorId)
    .eq("leave_date", isoDate);

  if (error) {
    throw new Error(`Failed to cancel leave: ${error.message}`);
  }
}
