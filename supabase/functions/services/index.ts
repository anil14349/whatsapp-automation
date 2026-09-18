/**
 * Which services a clinic offers.
 *
 * Returns the whole catalogue, not just what is switched on, so the portal can
 * offer a service the clinic has never used without anyone writing SQL.
 *
 * GET   /services?clinicId=   catalogue with this clinic's settings
 * PATCH /services             change one service
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
import { clearClinicServiceCache } from "../shared/clinic-services.ts";
import { getClinicTimezone, todayInTimezone } from "../shared/clinic-slots.ts";
import { withCors } from "../shared/cors.ts";

interface UpdateRequest {
  serviceTypeId?: string;
  clinicId?: string;
  name?: string;
  isEnabled?: unknown;
  offeredAtClinic?: unknown;
  offeredAtHome?: unknown;
  requiresDoctor?: unknown;
  clinicPrice?: unknown;
  homePrice?: unknown;
  durationMinutes?: unknown;
  concurrentCapacity?: unknown;
  minNoticeHours?: unknown;
  maxAheadDays?: unknown;
  availableFrom?: unknown;
  availableTo?: unknown;
  displayOrder?: unknown;
}

/**
 * A CLINIC_OWNER is pinned to their own clinic whatever they send; only a
 * platform ADMIN may name one.
 */
function resolveClinicId(user: TokenPayload, requested?: string | null): string | null {
  if (user.role === "ADMIN") {
    return requested || null;
  }

  return user.clinicId ?? null;
}

async function listServices(
  supabase: SupabaseClient,
  clinicId: string
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const [catalogue, configured] = await Promise.all([
    supabase
      .from("service_types")
      .select(
        "id, code, name, category, default_duration_minutes, default_clinic_price, default_home_price, is_active, clinic_id"
      )
      .eq("is_active", true)
      // Shared services plus this clinic's own. Without the scope one clinic
      // would see another's private services.
      .or(`clinic_id.is.null,clinic_id.eq.${clinicId}`)
      .order("name", { ascending: true }),
    supabase
      .from("clinic_services")
      .select(
        "service_type_id, is_enabled, offered_at_clinic, offered_at_home, requires_doctor, clinic_price, home_price, duration_minutes, concurrent_capacity, display_order, display_name, available_from, available_to, min_booking_window_hours, max_booking_window_days"
      )
      .eq("clinic_id", clinicId)
  ]);

  if (catalogue.error || configured.error) {
    debug("services", "List failed", {
      error: catalogue.error?.message ?? configured.error?.message
    });
    return { status: 500, payload: { error: "Failed to list services" } };
  }

  const byId = new Map(
    (configured.data ?? []).map((row: Record<string, any>) => [row.service_type_id, row])
  );

  const services = (catalogue.data ?? []).map((type: Record<string, any>) => {
    const row = byId.get(type.id);

    return {
      serviceTypeId: type.id,
      code: type.code,
      name: row?.display_name || type.name,
      // Shown so a clinic can tell it has renamed something, and get back.
      catalogueName: type.name,
      category: type.category,
      // Shared services cannot be renamed or removed by one clinic.
      isOwn: type.clinic_id !== null,
      // Never configured is not the same as switched off, so the portal can
      // show a service the clinic has simply not considered yet.
      configured: Boolean(row),
      isEnabled: row?.is_enabled === true,
      offeredAtClinic: row ? row.offered_at_clinic !== false : true,
      offeredAtHome: row ? row.offered_at_home === true : type.default_home_price !== null,
      requiresDoctor: row ? row.requires_doctor !== false : type.category === "CONSULTATION",
      clinicPrice: row?.clinic_price ?? null,
      homePrice: row?.home_price ?? null,
      durationMinutes: row?.duration_minutes ?? null,
      concurrentCapacity: row?.concurrent_capacity ?? 1,
      minNoticeHours: row?.min_booking_window_hours ?? 0,
      maxAheadDays: row?.max_booking_window_days ?? 0,
      // NULL means the service follows the premises hours.
      availableFrom: row?.available_from ? String(row.available_from).slice(0, 5) : null,
      availableTo: row?.available_to ? String(row.available_to).slice(0, 5) : null,
      displayOrder: row?.display_order ?? 0,
      defaults: {
        clinicPrice: type.default_clinic_price,
        homePrice: type.default_home_price,
        durationMinutes: type.default_duration_minutes
      }
    };
  });

  return { status: 200, payload: { services } };
}

function asBool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asNumberOrNull(value: unknown): number | null | undefined {
  if (value === null) {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }

  return undefined;
}

async function updateService(
  supabase: SupabaseClient,
  clinicId: string,
  actor: string,
  body: UpdateRequest
): Promise<{ status: number; payload: Record<string, unknown> }> {
  if (!body.serviceTypeId) {
    return { status: 400, payload: { error: "serviceTypeId is required" } };
  }

  const { data: type } = await supabase
    .from("service_types")
    .select("id, code, name, category, default_home_price, clinic_id")
    .eq("id", body.serviceTypeId)
    .or(`clinic_id.is.null,clinic_id.eq.${clinicId}`)
    .maybeSingle();

  if (!type) {
    return { status: 404, payload: { error: "Unknown service" } };
  }

  // Set when a shared service is being renamed for this clinic only.
  let patchDisplayName: string | null | undefined;

  // A clinic's own service is renamed outright. A shared one gets a per-clinic
  // display name instead, so calling it "OP Consultation" here does not rename
  // it for every other clinic.
  if (typeof body.name === "string") {
    const name = body.name.trim();

    if (!name) {
      return { status: 400, payload: { error: "name cannot be empty" } };
    }

    if (name.length > 24) {
      return {
        status: 400,
        payload: { error: "name must be 24 characters or fewer so it fits a WhatsApp list" }
      };
    }

    if (type.clinic_id === clinicId) {
      const { error: renameError } = await supabase
        .from("service_types")
        .update({ name, updated_at: new Date().toISOString() })
        .eq("id", body.serviceTypeId)
        .eq("clinic_id", clinicId);

      if (renameError) {
        debug("services", "Rename failed", { error: renameError.message });
        return { status: 500, payload: { error: "Failed to rename the service" } };
      }
    } else {
      // Reverting to the catalogue name is clearing the override, not setting
      // it, so the clinic is not pinned to a name that later changes.
      patchDisplayName = name === type.name ? null : name;
    }

    clearClinicServiceCache();
  }

  const { data: existing } = await supabase
    .from("clinic_services")
    .select("*")
    .eq("clinic_id", clinicId)
    .eq("service_type_id", body.serviceTypeId)
    .maybeSingle();

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  const isEnabled = asBool(body.isEnabled);
  const offeredAtClinic = asBool(body.offeredAtClinic);
  const offeredAtHome = asBool(body.offeredAtHome);
  const requiresDoctor = asBool(body.requiresDoctor);

  if (isEnabled !== undefined) patch.is_enabled = isEnabled;
  if (offeredAtClinic !== undefined) patch.offered_at_clinic = offeredAtClinic;
  if (offeredAtHome !== undefined) patch.offered_at_home = offeredAtHome;
  if (requiresDoctor !== undefined) patch.requires_doctor = requiresDoctor;

  const clinicPrice = asNumberOrNull(body.clinicPrice);
  const homePrice = asNumberOrNull(body.homePrice);
  const duration = asNumberOrNull(body.durationMinutes);
  const capacity = asNumberOrNull(body.concurrentCapacity);
  const notice = asNumberOrNull(body.minNoticeHours);
  const order = asNumberOrNull(body.displayOrder);

  if (clinicPrice !== undefined) patch.clinic_price = clinicPrice;
  if (homePrice !== undefined) patch.home_price = homePrice;
  if (duration !== undefined) patch.duration_minutes = duration;
  if (order !== undefined) patch.display_order = order;
  if (patchDisplayName !== undefined) patch.display_name = patchDisplayName;

  if (notice !== undefined) {
    if (notice !== null && notice < 0) {
      return { status: 400, payload: { error: "minNoticeHours cannot be negative" } };
    }

    patch.min_booking_window_hours = notice ?? 0;
  }

  const ahead = asNumberOrNull(body.maxAheadDays);

  if (ahead !== undefined) {
    // A year ahead is already absurd for a clinic appointment, and the slot
    // generator walks day by day.
    if (ahead !== null && (ahead < 1 || ahead > 365)) {
      return { status: 400, payload: { error: "maxAheadDays must be between 1 and 365" } };
    }

    patch.max_booking_window_days = ahead ?? 7;
  }

  if (capacity !== undefined) {
    if (capacity === null || capacity < 1) {
      return { status: 400, payload: { error: "concurrentCapacity must be at least 1" } };
    }
    patch.concurrent_capacity = capacity;
  }

  // Empty clears the window back to the premises hours, which is what most
  // services want; a half-set window would silently apply only one end.
  const window: Record<string, string | null> = {};

  for (const [key, column] of [
    ["availableFrom", "available_from"],
    ["availableTo", "available_to"]
  ] as const) {
    const raw = body[key];

    if (raw === undefined) continue;

    const value = typeof raw === "string" ? raw.trim() : "";

    if (value !== "" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
      return { status: 400, payload: { error: `${key} must look like 07:00` } };
    }

    window[column] = value === "" ? null : value;
  }

  if (Object.keys(window).length > 0) {
    const from = window.available_from ?? (existing?.available_from ? String(existing.available_from).slice(0, 5) : null);
    const to = window.available_to ?? (existing?.available_to ? String(existing.available_to).slice(0, 5) : null);

    if (from !== null && to !== null && from >= to) {
      return { status: 400, payload: { error: "The service must close after it opens" } };
    }

    Object.assign(patch, window);
  }

  if (duration !== undefined && duration !== null && duration <= 0) {
    return { status: 400, payload: { error: "durationMinutes must be greater than zero" } };
  }

  // A service offered nowhere would sit in the menu leading nowhere.
  const finalAtClinic = offeredAtClinic ?? existing?.offered_at_clinic ?? true;
  const finalAtHome = offeredAtHome ?? existing?.offered_at_home ?? false;

  if (!finalAtClinic && !finalAtHome) {
    return {
      status: 400,
      payload: { error: "A service must be offered at the clinic, at home, or both" }
    };
  }

  let error;

  if (existing) {
    ({ error } = await supabase
      .from("clinic_services")
      .update(patch)
      .eq("clinic_id", clinicId)
      .eq("service_type_id", body.serviceTypeId));
  } else {
    ({ error } = await supabase.from("clinic_services").insert({
      clinic_id: clinicId,
      service_type_id: body.serviceTypeId,
      is_enabled: isEnabled ?? false,
      offered_at_clinic: finalAtClinic,
      offered_at_home: finalAtHome,
      requires_doctor: requiresDoctor ?? type.category === "CONSULTATION",
      clinic_price: clinicPrice ?? null,
      home_price: homePrice ?? null,
      duration_minutes: duration ?? null,
      display_name: patchDisplayName ?? null,
      concurrent_capacity: capacity ?? 1,
      display_order: order ?? 10
    }));
  }

  if (error) {
    debug("services", "Update failed", { error: error.message });
    return { status: 500, payload: { error: "Failed to update the service" } };
  }

  // Otherwise the patient menu keeps the old answer until the cache expires.
  clearClinicServiceCache();

  await recordAuditEvent(
    supabase,
    "clinic_service_updated",
    actor,
    "clinic_service",
    `${clinicId}:${body.serviceTypeId}`,
    existing ?? null,
    patch
  );

  return { status: 200, payload: { serviceTypeId: body.serviceTypeId, code: type.code } };
}

const CATEGORIES = ["CONSULTATION", "DIAGNOSTIC", "IMAGING", "VACCINE", "OTHER"];

/**
 * Add a service this clinic offers that the shared catalogue does not have.
 *
 * The row is private to the clinic, so two clinics can both have a DENTAL
 * without agreeing on what it means or what it costs.
 */
async function createServiceType(
  supabase: SupabaseClient,
  clinicId: string,
  actor: string,
  body: Record<string, unknown>
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const name = typeof body.name === "string" ? body.name.trim() : "";

  if (!name) {
    return { status: 400, payload: { error: "name is required" } };
  }

  // The name reaches patients in a WhatsApp list row, which truncates at 24.
  if (name.length > 24) {
    return {
      status: 400,
      payload: { error: "name must be 24 characters or fewer so it fits a WhatsApp list" }
    };
  }

  const category = typeof body.category === "string" ? body.category.toUpperCase() : "OTHER";

  if (!CATEGORIES.includes(category)) {
    return { status: 400, payload: { error: `category must be one of ${CATEGORIES.join(", ")}` } };
  }

  const duration = asNumberOrNull(body.durationMinutes) ?? 30;

  if (duration === null || duration <= 0) {
    return { status: 400, payload: { error: "durationMinutes must be greater than zero" } };
  }

  const clinicPrice = asNumberOrNull(body.clinicPrice) ?? null;
  const homePrice = asNumberOrNull(body.homePrice) ?? null;

  // Derived rather than asked for: a code is an implementation detail and a
  // clinic should not have to invent one.
  const base = name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30);
  const code = base || `SERVICE_${Date.now()}`;

  const { data, error } = await supabase
    .from("service_types")
    .insert({
      clinic_id: clinicId,
      code,
      name,
      category,
      default_duration_minutes: duration,
      default_clinic_price: clinicPrice,
      default_home_price: homePrice,
      is_active: true
    })
    .select("id, code, name")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { status: 409, payload: { error: "This clinic already has a service with that name" } };
    }

    debug("services", "Create failed", { error: error.message });
    return { status: 500, payload: { error: "Failed to add the service" } };
  }

  await recordAuditEvent(
    supabase,
    "service_type_created",
    actor,
    "service_type",
    data.id,
    undefined,
    { clinicId, code, name, category }
  );

  clearClinicServiceCache();

  return { status: 201, payload: { serviceTypeId: data.id, code: data.code, name: data.name } };
}

/**
 * Remove a service the clinic added.
 *
 * Deactivated rather than deleted: appointments.service_type_id is NOT NULL, so
 * removing the row would either fail or, with a cascade, take the appointment
 * history with it. A clinic tidying its service list must not erase records.
 */
async function deleteServiceType(
  supabase: SupabaseClient,
  clinicId: string,
  actor: string,
  serviceTypeId: string | null
): Promise<{ status: number; payload: Record<string, unknown> }> {
  if (!serviceTypeId) {
    return { status: 400, payload: { error: "serviceTypeId is required" } };
  }

  const { data: type } = await supabase
    .from("service_types")
    .select("id, name, clinic_id")
    .eq("id", serviceTypeId)
    .maybeSingle();

  if (!type) {
    return { status: 404, payload: { error: "Unknown service" } };
  }

  // Switching a shared service off is what is_enabled is for; removing it would
  // affect every other clinic.
  if (type.clinic_id !== clinicId) {
    return {
      status: 403,
      payload: { error: "This is a shared service. Switch it off instead of removing it." }
    };
  }

  const today = todayInTimezone(await getClinicTimezone(supabase, clinicId));

  const { data: booked, error: bookedError } = await supabase
    .from("appointments")
    .select("id, appointment_date, appointment_time")
    .eq("clinic_id", clinicId)
    .eq("service_type_id", serviceTypeId)
    .gte("appointment_date", today)
    .neq("status", "CANCELLED");

  if (bookedError) {
    debug("services", "Booking check failed", { error: bookedError.message });
    return { status: 500, payload: { error: "Could not check existing appointments" } };
  }

  // Leaving these standing would have patients arrive for something the clinic
  // believes it no longer offers.
  if (booked && booked.length > 0) {
    return {
      status: 409,
      payload: {
        error: `${booked.length} appointment${booked.length === 1 ? " is" : "s are"} still booked for ${type.name}. Cancel or move ${booked.length === 1 ? "it" : "them"} first.`,
        appointments: booked.length,
        nextOn: booked
          .map((a: Record<string, any>) => `${a.appointment_date} ${a.appointment_time}`)
          .sort()[0]
      }
    };
  }

  const { error } = await supabase
    .from("service_types")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", serviceTypeId)
    .eq("clinic_id", clinicId);

  if (error) {
    debug("services", "Delete failed", { error: error.message });
    return { status: 500, payload: { error: "Failed to remove the service" } };
  }

  await supabase
    .from("clinic_services")
    .update({ is_enabled: false, updated_at: new Date().toISOString() })
    .eq("clinic_id", clinicId)
    .eq("service_type_id", serviceTypeId);

  clearClinicServiceCache();

  await recordAuditEvent(
    supabase,
    "service_type_removed",
    actor,
    "service_type",
    serviceTypeId,
    { name: type.name, is_active: true },
    { is_active: false }
  );

  return { status: 200, payload: { serviceTypeId, name: type.name, removed: true } };
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
    const body =
      req.method === "PATCH" || req.method === "POST" || req.method === "DELETE"
        ? await req.json().catch(() => null)
        : null;

    const clinicId = resolveClinicId(
      user,
      url.searchParams.get("clinicId") ?? body?.clinicId ?? null
    );

    if (!clinicId) {
      return badRequestResponse("clinicId is required");
    }

    const actor = `${user.role.toLowerCase()}:${user.email}`;

    let result;

    if (req.method === "GET") {
      result = await listServices(supabase, clinicId);
    } else if (req.method === "DELETE") {
      // The id may come from the query string, so a body is not required.
      result = await deleteServiceType(
        supabase,
        clinicId,
        actor,
        url.searchParams.get("serviceTypeId") ?? body?.serviceTypeId ?? null
      );
    } else if (!body) {
      result = { status: 400, payload: { error: "Invalid JSON body" } };
    } else if (req.method === "POST") {
      result = await createServiceType(supabase, clinicId, actor, body);
    } else {
      result = await updateService(supabase, clinicId, actor, body);
    }

    return new Response(JSON.stringify(result.payload), {
      status: result.status,
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    debug("services", "Error handling request", {
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
