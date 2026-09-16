/**
 * Clinic settings.
 *
 * Opening hours drive every slot the bot offers, and until now changing them
 * meant writing SQL. Holidays are here for the same reason: a clinic closing
 * for a day had no way to say so, and patients would be offered times at a
 * locked door.
 *
 * GET   /clinic-settings   details, hours per day, upcoming closures
 * PATCH /clinic-settings   change details or one day's hours
 * POST  /clinic-settings   add a closure
 * DELETE /clinic-settings  remove a closure
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { TokenPayload } from "../shared/jwt-auth.ts";
import {
  withAuth,
  badRequestResponse,
  errorResponse
} from "../shared/auth-middleware.ts";
import { debug, recordAuditEvent } from "../shared/logger.ts";
import { withCors } from "../shared/cors.ts";

/** Monday is 1 and Sunday is 7, matching clinic_operating_hours. */
const DAY_LABELS = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function resolveClinicId(user: TokenPayload, requested?: string | null): string | null {
  if (user.role === "ADMIN") {
    return requested || null;
  }

  return user.clinicId ?? null;
}

async function getSettings(
  supabase: SupabaseClient,
  clinicId: string
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const today = new Date().toISOString().split("T")[0];

  const [clinic, hours, holidays] = await Promise.all([
    supabase
      .from("clinics")
      .select("id, name, phone, email, address, city, country, timezone, open_time, close_time, working_days, after_hours_message, enable_after_hours_reply, revisit_window_days")
      .eq("id", clinicId)
      .maybeSingle(),
    supabase
      .from("clinic_operating_hours")
      .select("day_of_week, opening_time, closing_time, is_active")
      .eq("clinic_id", clinicId)
      .order("day_of_week", { ascending: true }),
    supabase
      .from("clinic_holidays")
      .select("id, holiday_date, holiday_name, is_partial_closure, partial_opening_time, partial_closing_time")
      .eq("clinic_id", clinicId)
      .gte("holiday_date", today)
      .order("holiday_date", { ascending: true })
  ]);

  if (clinic.error || !clinic.data) {
    return { status: 404, payload: { error: "Clinic not found" } };
  }

  const byDay = new Map(
    (hours.data ?? []).map((row: Record<string, any>) => [row.day_of_week, row])
  );

  // Every weekday is returned, including ones with no row, so the portal can
  // show a complete week rather than only what happens to be configured.
  const week = [1, 2, 3, 4, 5, 6, 7].map((day) => {
    const row = byDay.get(day);

    return {
      dayOfWeek: day,
      label: DAY_LABELS[day],
      openTime: row ? String(row.opening_time).slice(0, 5) : null,
      closeTime: row ? String(row.closing_time).slice(0, 5) : null,
      // A day is shut if it has no row, is switched off, or opens and closes
      // at the same moment, which is how closed days were recorded.
      closed:
        !row ||
        row.is_active === false ||
        String(row.opening_time).slice(0, 5) === String(row.closing_time).slice(0, 5)
    };
  });

  return {
    status: 200,
    payload: {
      clinic: {
        id: clinic.data.id,
        name: clinic.data.name,
        phone: clinic.data.phone,
        email: clinic.data.email,
        address: clinic.data.address,
        city: clinic.data.city,
        country: clinic.data.country,
        timezone: clinic.data.timezone,
        afterHoursMessage: clinic.data.after_hours_message,
        afterHoursReply: clinic.data.enable_after_hours_reply === true,
        revisitWindowDays: Number(clinic.data.revisit_window_days ?? 0)
      },
      hours: week,
      holidays: holidays.data ?? []
    }
  };
}

async function updateSettings(
  supabase: SupabaseClient,
  clinicId: string,
  actor: string,
  body: Record<string, unknown>
): Promise<{ status: number; payload: Record<string, unknown> }> {
  // Changing one day's hours.
  if (body.dayOfWeek !== undefined) {
    const day = Number(body.dayOfWeek);

    if (!Number.isInteger(day) || day < 1 || day > 7) {
      return { status: 400, payload: { error: "dayOfWeek must be 1 (Monday) to 7 (Sunday)" } };
    }

    const closed = body.closed === true;
    const open = typeof body.openTime === "string" ? body.openTime.slice(0, 5) : "";
    const close = typeof body.closeTime === "string" ? body.closeTime.slice(0, 5) : "";

    if (!closed) {
      if (!TIME.test(open) || !TIME.test(close)) {
        return { status: 400, payload: { error: "openTime and closeTime must be HH:MM" } };
      }

      // Closing before opening would silently offer no slots all day.
      if (open >= close) {
        return { status: 400, payload: { error: "Closing time must be after opening time" } };
      }
    }

    const row = {
      clinic_id: clinicId,
      day_of_week: day,
      opening_time: closed ? "00:00" : open,
      closing_time: closed ? "00:00" : close,
      is_active: !closed,
      updated_at: new Date().toISOString()
    };

    const { data: existing } = await supabase
      .from("clinic_operating_hours")
      .select("id")
      .eq("clinic_id", clinicId)
      .eq("day_of_week", day)
      .maybeSingle();

    const { error } = existing
      ? await supabase.from("clinic_operating_hours").update(row).eq("id", existing.id)
      : await supabase.from("clinic_operating_hours").insert(row);

    if (error) {
      debug("clinicSettings", "Hours update failed", { error: error.message });
      return { status: 500, payload: { error: "Failed to save the hours" } };
    }

    await recordAuditEvent(
      supabase,
      "clinic_hours_changed",
      actor,
      "clinic",
      clinicId,
      undefined,
      { day: DAY_LABELS[day], closed, open, close }
    );

    return { status: 200, payload: { dayOfWeek: day, closed } };
  }

  // Otherwise the clinic's own details.
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : undefined);

  const name = text(body.name);
  if (name !== undefined) {
    if (!name) {
      return { status: 400, payload: { error: "name cannot be empty" } };
    }
    patch.name = name;
  }

  for (const [key, column] of [
    ["phone", "phone"],
    ["email", "email"],
    ["address", "address"],
    ["city", "city"],
    ["country", "country"],
    ["afterHoursMessage", "after_hours_message"]
  ] as const) {
    const value = text(body[key]);
    if (value !== undefined) patch[column] = value || null;
  }

  if (typeof body.afterHoursReply === "boolean") {
    patch.enable_after_hours_reply = body.afterHoursReply;
  }

  if (body.revisitWindowDays !== undefined) {
    const days = Number(body.revisitWindowDays);

    // Zero switches it off. A year is already absurd for a follow-up.
    if (!Number.isInteger(days) || days < 0 || days > 365) {
      return { status: 400, payload: { error: "Revisit window must be between 0 and 365 days" } };
    }

    patch.revisit_window_days = days;
  }

  // The timezone decides what "today" means for every slot and reminder, so a
  // typo here would quietly shift the whole day.
  const timezone = text(body.timezone);
  if (timezone !== undefined) {
    try {
      new Intl.DateTimeFormat("en-GB", { timeZone: timezone }).format(new Date());
    } catch {
      return { status: 400, payload: { error: `"${timezone}" is not a known timezone` } };
    }
    patch.timezone = timezone;
  }

  if (Object.keys(patch).length === 1) {
    return { status: 400, payload: { error: "Nothing to change" } };
  }

  const { error } = await supabase.from("clinics").update(patch).eq("id", clinicId);

  if (error) {
    debug("clinicSettings", "Details update failed", { error: error.message });
    return { status: 500, payload: { error: "Failed to save the details" } };
  }

  await recordAuditEvent(supabase, "clinic_details_changed", actor, "clinic", clinicId, undefined, patch);

  return { status: 200, payload: { updated: Object.keys(patch).filter((k) => k !== "updated_at") } };
}

async function addHoliday(
  supabase: SupabaseClient,
  clinicId: string,
  actor: string,
  body: Record<string, unknown>
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const date = typeof body.date === "string" ? body.date.trim() : "";

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { status: 400, payload: { error: "date must be YYYY-MM-DD" } };
  }

  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "Closed";

  const { data: booked } = await supabase
    .from("appointments")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("appointment_date", date)
    .neq("status", "CANCELLED");

  const { error } = await supabase.from("clinic_holidays").insert({
    clinic_id: clinicId,
    holiday_date: date,
    holiday_name: name,
    is_partial_closure: false
  });

  if (error) {
    if (error.code === "23505") {
      return { status: 409, payload: { error: "That date is already marked as closed" } };
    }

    debug("clinicSettings", "Holiday insert failed", { error: error.message });
    return { status: 500, payload: { error: "Failed to add the closure" } };
  }

  await recordAuditEvent(supabase, "clinic_holiday_added", actor, "clinic", clinicId, undefined, { date, name });

  // Closing a day does not cancel what is already booked; saying so is better
  // than leaving staff to discover it on the morning.
  return {
    status: 201,
    payload: {
      date,
      name,
      existingAppointments: booked?.length ?? 0
    }
  };
}

async function removeHoliday(
  supabase: SupabaseClient,
  clinicId: string,
  actor: string,
  holidayId: string | null
): Promise<{ status: number; payload: Record<string, unknown> }> {
  if (!holidayId) {
    return { status: 400, payload: { error: "holidayId is required" } };
  }

  const { error } = await supabase
    .from("clinic_holidays")
    .delete()
    .eq("id", holidayId)
    .eq("clinic_id", clinicId);

  if (error) {
    debug("clinicSettings", "Holiday delete failed", { error: error.message });
    return { status: 500, payload: { error: "Failed to remove the closure" } };
  }

  await recordAuditEvent(supabase, "clinic_holiday_removed", actor, "clinic", clinicId, undefined, { holidayId });

  return { status: 200, payload: { holidayId, removed: true } };
}

async function handleRequest(user: TokenPayload, req: Request): Promise<Response> {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      return errorResponse("Server configuration error", 500);
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const url = new URL(req.url);
    const body = req.method === "GET" ? null : await req.json().catch(() => null);

    const clinicId = resolveClinicId(
      user,
      url.searchParams.get("clinicId") ?? (body?.clinicId as string | undefined) ?? null
    );

    if (!clinicId) {
      return badRequestResponse("clinicId is required");
    }

    const actor = `${user.role.toLowerCase()}:${user.email}`;

    let result;

    if (req.method === "GET") {
      result = await getSettings(supabase, clinicId);
    } else if (req.method === "DELETE") {
      result = await removeHoliday(
        supabase,
        clinicId,
        actor,
        url.searchParams.get("holidayId") ?? (body?.holidayId as string | undefined) ?? null
      );
    } else if (!body) {
      result = { status: 400, payload: { error: "Invalid JSON body" } };
    } else if (req.method === "POST") {
      result = await addHoliday(supabase, clinicId, actor, body);
    } else {
      result = await updateSettings(supabase, clinicId, actor, body);
    }

    return new Response(JSON.stringify(result.payload), {
      status: result.status,
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    debug("clinicSettings", "Error handling request", {
      error: error instanceof Error ? error.message : String(error)
    });
    return errorResponse(error instanceof Error ? error : new Error(String(error)));
  }
}

Deno.serve(withCors(async (req: Request) => {
  if (!["GET", "POST", "PATCH", "DELETE"].includes(req.method)) {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { "Content-Type": "application/json" } }
    );
  }

  return withAuth(req, ["ADMIN", "CLINIC_OWNER"], (user) => handleRequest(user, req));
}));
