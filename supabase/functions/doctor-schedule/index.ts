/**
 * A doctor's consulting hours and leave, set by the clinic.
 *
 * Both already existed but only the doctor could reach them, from their own
 * WhatsApp menu. A doctor who never opens the bot therefore had no hours at
 * all, and nobody could cover for one who was away.
 *
 * GET    /doctor-schedule?doctorId=...   hours for all seven days, plus upcoming leave
 * PATCH  { doctorId, dayOfWeek, openTime, closeTime, working }
 * PATCH  { doctorId, dayOfWeek, openTime, closeTime, working, visiting: true }
 *                                        the same for hours spent visiting homes
 * POST   { doctorId, startDate, endDate, reason }   record leave
 * DELETE { doctorId, leaveId }                      cancel leave
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  withAuth,
  successResponse,
  errorResponse,
  badRequestResponse
} from "../shared/auth-middleware.ts";
import { TokenPayload } from "../shared/jwt-auth.ts";
import { debug, recordAuditEvent } from "../shared/logger.ts";
import { withCors } from "../shared/cors.ts";
import { getClinicHoursForDay, getClinicTimezone, todayInTimezone } from "../shared/clinic-slots.ts";

const DAY_LABELS = [
  "",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday"
];

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function resolveClinicId(user: TokenPayload, requested?: string | null): string | null {
  if (user.role === "ADMIN") {
    return requested || null;
  }

  return user.clinicId ?? null;
}

/** Confirms the doctor belongs to this clinic before anything is read or written. */
async function findDoctor(
  supabase: SupabaseClient,
  clinicId: string,
  doctorId: string
): Promise<{ id: string; name: string } | null> {
  const { data } = await supabase
    .from("doctors")
    .select("id, name")
    .eq("id", doctorId)
    .eq("clinic_id", clinicId)
    .maybeSingle();

  return data ?? null;
}

async function readSchedule(
  supabase: SupabaseClient,
  clinicId: string,
  doctorId: string
): Promise<Record<string, unknown>> {
  const { data: rows } = await supabase
    .from("doctor_operating_hours")
    .select("day_of_week, opening_time, closing_time, is_active")
    .eq("clinic_id", clinicId)
    .eq("doctor_id", doctorId);

  const byDay = new Map<number, Record<string, unknown>>();

  for (const row of rows ?? []) {
    byDay.set(Number(row.day_of_week), row);
  }

  // Home visiting hours are a separate table because they are separate hours:
  // a doctor consults in the morning and visits in the afternoon.
  const { data: visitRows } = await supabase
    .from("doctor_home_visit_hours")
    .select("day_of_week, opening_time, closing_time, is_active, max_home_visits_per_day")
    .eq("clinic_id", clinicId)
    .eq("doctor_id", doctorId);

  const visitByDay = new Map<number, Record<string, unknown>>();

  for (const row of visitRows ?? []) {
    visitByDay.set(Number(row.day_of_week), row);
  }

  const today = todayInTimezone(await getClinicTimezone(supabase, clinicId));

  const { data: leaves } = await supabase
    .from("doctor_leaves")
    .select("id, leave_start_date, leave_end_date, reason, leave_type, status")
    .eq("clinic_id", clinicId)
    .eq("doctor_id", doctorId)
    .eq("status", "APPROVED")
    .gte("leave_end_date", today)
    .order("leave_start_date", { ascending: true });

  // Every weekday is returned, so a day the doctor has never set still shows.
  const hours = [1, 2, 3, 4, 5, 6, 7].map((day) => {
    const row = byDay.get(day);
    const open = row ? String(row.opening_time).slice(0, 5) : null;
    const close = row ? String(row.closing_time).slice(0, 5) : null;

    const visit = visitByDay.get(day);
    const visitOpen = visit ? String(visit.opening_time).slice(0, 5) : null;
    const visitClose = visit ? String(visit.closing_time).slice(0, 5) : null;

    return {
      dayOfWeek: day,
      label: DAY_LABELS[day],
      openTime: open,
      closeTime: close,
      working: Boolean(row) && row?.is_active !== false && open !== close,
      visitOpenTime: visitOpen,
      visitCloseTime: visitClose,
      visiting: Boolean(visit) && visit?.is_active !== false && visitOpen !== visitClose
    };
  });

  return { hours, leaves: leaves ?? [] };
}

async function setHours(
  supabase: SupabaseClient,
  clinicId: string,
  actor: string,
  body: Record<string, any>
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const day = Number(body.dayOfWeek);

  if (!Number.isInteger(day) || day < 1 || day > 7) {
    return { status: 400, payload: { error: "dayOfWeek must be 1 (Monday) to 7 (Sunday)" } };
  }

  const working = body.working !== false;
  const open = typeof body.openTime === "string" ? body.openTime.slice(0, 5) : "";
  const close = typeof body.closeTime === "string" ? body.closeTime.slice(0, 5) : "";

  if (working) {
    if (!TIME.test(open) || !TIME.test(close)) {
      return { status: 400, payload: { error: "openTime and closeTime must be HH:MM" } };
    }

    if (close <= open) {
      return { status: 400, payload: { error: "Closing time must be after opening time" } };
    }
  }

  // Visiting hours are not clinic hours: the doctor is out, so the clinic
  // being shut does not constrain them, and they get their own row.
  if (body.visiting === true || body.visiting === false) {
    const { error: visitError } = await supabase
      .from("doctor_home_visit_hours")
      .upsert(
        {
          clinic_id: clinicId,
          doctor_id: body.doctorId,
          day_of_week: day,
          opening_time: working ? open : "00:00",
          closing_time: working ? close : "00:00",
          is_active: working,
          updated_at: new Date().toISOString()
        },
        { onConflict: "doctor_id,day_of_week" }
      );

    if (visitError) {
      return {
        status: 500,
        payload: { error: `Failed to save visiting hours: ${visitError.message}` }
      };
    }

    await recordAuditEvent(
      supabase,
      "doctor_home_visit_hours_changed",
      actor,
      "doctor",
      String(body.doctorId),
      {},
      { day: DAY_LABELS[day], working, open, close }
    );

    return { status: 200, payload: { dayOfWeek: day, working, visiting: true } };
  }

  const { error } = await supabase
    .from("doctor_operating_hours")
    .upsert(
      {
        clinic_id: clinicId,
        doctor_id: body.doctorId,
        day_of_week: day,
        opening_time: working ? open : "00:00",
        closing_time: working ? close : "00:00",
        is_active: working,
        updated_at: new Date().toISOString()
      },
      { onConflict: "doctor_id,day_of_week" }
    );

  if (error) {
    return { status: 500, payload: { error: `Failed to save hours: ${error.message}` } };
  }

  await recordAuditEvent(
    supabase,
    "doctor_hours_changed",
    actor,
    "doctor",
    String(body.doctorId),
    {},
    { day: DAY_LABELS[day], working, open, close }
  );

  // The clinic's own hours win when slots are generated, so say so rather than
  // letting someone set 18:00 on a day the clinic shuts at 14:00 and wonder.
  let note: string | undefined;

  if (working) {
    const sample = await sampleDateForDay(supabase, clinicId, day);
    const clinicHours = sample ? await getClinicHoursForDay(supabase, clinicId, sample) : null;

    if (!clinicHours) {
      note = `The clinic is closed on ${DAY_LABELS[day]}, so no slots will be offered.`;
    } else if (open < clinicHours.openTime || close > clinicHours.closeTime) {
      note = `The clinic is open ${clinicHours.openTime}–${clinicHours.closeTime} on ${DAY_LABELS[day]}, so only that part will be offered.`;
    }
  }

  return { status: 200, payload: { dayOfWeek: day, working, note } };
}

/** Any date falling on this weekday, used to ask the clinic about its hours. */
async function sampleDateForDay(
  supabase: SupabaseClient,
  clinicId: string,
  day: number
): Promise<string | null> {
  const today = todayInTimezone(await getClinicTimezone(supabase, clinicId));
  const base = new Date(today + "T00:00:00Z");

  for (let i = 0; i < 7; i++) {
    const candidate = new Date(base);
    candidate.setUTCDate(candidate.getUTCDate() + i);

    const jsDay = candidate.getUTCDay();
    const isoDay = jsDay === 0 ? 7 : jsDay;

    if (isoDay === day) {
      return candidate.toISOString().slice(0, 10);
    }
  }

  return null;
}

async function addLeave(
  supabase: SupabaseClient,
  clinicId: string,
  actor: string,
  body: Record<string, any>
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const start = String(body.startDate ?? "");
  const end = String(body.endDate ?? start);

  if (!DATE.test(start) || !DATE.test(end)) {
    return { status: 400, payload: { error: "Dates must be YYYY-MM-DD" } };
  }

  if (end < start) {
    return { status: 400, payload: { error: "The last day cannot be before the first" } };
  }

  const { data: clash } = await supabase
    .from("doctor_leaves")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("doctor_id", body.doctorId)
    .eq("status", "APPROVED")
    .lte("leave_start_date", end)
    .gte("leave_end_date", start)
    .maybeSingle();

  if (clash) {
    return { status: 409, payload: { error: "That overlaps leave already recorded" } };
  }

  const { data: inserted, error } = await supabase
    .from("doctor_leaves")
    .insert({
      clinic_id: clinicId,
      doctor_id: body.doctorId,
      leave_start_date: start,
      leave_end_date: end,
      reason: body.reason?.trim() || null,
      leave_type: body.leaveType || "PERSONAL",
      // Recorded by the clinic, so it takes effect at once.
      status: "APPROVED",
      approval_date: new Date().toISOString()
    })
    .select("id")
    .maybeSingle();

  if (error) {
    return { status: 500, payload: { error: `Failed to record leave: ${error.message}` } };
  }

  // Leave does not cancel what is already booked, and finding that out on the
  // day would be worse than being told now.
  const { count } = await supabase
    .from("appointments")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", clinicId)
    .eq("doctor_id", body.doctorId)
    .gte("appointment_date", start)
    .lte("appointment_date", end)
    .neq("status", "CANCELLED");

  await recordAuditEvent(
    supabase,
    "doctor_leave_added",
    actor,
    "doctor",
    String(body.doctorId),
    {},
    { start, end, existingAppointments: count ?? 0 }
  );

  // Named as the cancel call expects it back, which `id` was not.
  return {
    status: 200,
    payload: { leaveId: inserted?.id, start, end, existingAppointments: count ?? 0 }
  };
}

async function cancelLeave(
  supabase: SupabaseClient,
  clinicId: string,
  actor: string,
  doctorId: string,
  leaveId: string
): Promise<{ status: number; payload: Record<string, unknown> }> {
  if (!leaveId) {
    return { status: 400, payload: { error: "leaveId is required" } };
  }

  const { data, error } = await supabase
    .from("doctor_leaves")
    .update({ status: "CANCELLED", updated_at: new Date().toISOString() })
    .eq("id", leaveId)
    .eq("clinic_id", clinicId)
    .eq("doctor_id", doctorId)
    .select("id")
    .maybeSingle();

  if (error) {
    return { status: 500, payload: { error: `Failed to cancel leave: ${error.message}` } };
  }

  if (!data) {
    return { status: 404, payload: { error: "That leave was not found for this doctor" } };
  }

  await recordAuditEvent(
    supabase,
    "doctor_leave_cancelled",
    actor,
    "doctor",
    doctorId,
    { leaveId },
    {}
  );

  return { status: 200, payload: { leaveId, cancelled: true } };
}

async function handleRequest(user: TokenPayload, req: Request): Promise<Response> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseKey) {
    return errorResponse("Server configuration error", 500);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const url = new URL(req.url);

  const body = req.method === "GET" ? {} : await req.json().catch(() => ({}));
  const clinicId = resolveClinicId(user, url.searchParams.get("clinicId") ?? body.clinicId);

  if (!clinicId) {
    return badRequestResponse("clinicId is required");
  }

  const doctorId = url.searchParams.get("doctorId") ?? body.doctorId;

  if (!doctorId) {
    return badRequestResponse("doctorId is required");
  }

  const doctor = await findDoctor(supabase, clinicId, doctorId);

  if (!doctor) {
    return badRequestResponse("Doctor not found at this clinic");
  }

  const actor = `${user.role.toLowerCase()}:${user.email}`;

  if (req.method === "GET") {
    const schedule = await readSchedule(supabase, clinicId, doctorId);

    return successResponse({ doctor, ...schedule });
  }

  const result =
    req.method === "PATCH"
      ? await setHours(supabase, clinicId, actor, { ...body, doctorId })
      : req.method === "POST"
        ? await addLeave(supabase, clinicId, actor, { ...body, doctorId })
        : await cancelLeave(
            supabase,
            clinicId,
            actor,
            doctorId,
            url.searchParams.get("leaveId") ?? body.leaveId
          );

  debug("doctorSchedule", `${req.method} ${doctorId}`, {
    clinicId,
    status: result.status
  });

  return new Response(JSON.stringify(result.payload), {
    status: result.status,
    headers: { "Content-Type": "application/json" }
  });
}

Deno.serve(withCors(async (req: Request) => {
  if (!["GET", "PATCH", "POST", "DELETE"].includes(req.method)) {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" }
    });
  }

  return withAuth(req, ["ADMIN", "CLINIC_OWNER"], (user) => handleRequest(user, req));
}));
