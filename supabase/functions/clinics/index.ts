/**
 * Clinic administration.
 *
 * Deactivating a clinic had no route at all, so it meant editing the row by
 * hand — and until now that barely did anything: no auth path checked
 * `clinics.is_active`, and inbound WhatsApp quietly fell through to the default
 * clinic, serving one tenant's patients under another.
 *
 * GET   /clinics        list clinics
 * PATCH /clinics        activate or deactivate one
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
import { clearClinicActiveCache } from "../shared/clinic-status.ts";
import { withCors } from "../shared/cors.ts";

async function listClinics(
  supabase: SupabaseClient
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const { data, error } = await supabase
    .from("clinics")
    .select("id, clinic_code, name, phone, timezone, is_active")
    .order("name", { ascending: true });

  if (error) {
    debug("clinics", "List failed", { error: error.message });
    return { status: 500, payload: { error: "Failed to list clinics" } };
  }

  return { status: 200, payload: { clinics: data ?? [] } };
}

async function setClinicActive(
  supabase: SupabaseClient,
  actor: string,
  body: { id?: string; isActive?: unknown; reason?: string }
): Promise<{ status: number; payload: Record<string, unknown> }> {
  if (!body.id) {
    return { status: 400, payload: { error: "id is required" } };
  }

  // Deactivation cuts off a whole tenant, so it must be asked for explicitly
  // rather than inferred from a missing field.
  if (typeof body.isActive !== "boolean") {
    return { status: 400, payload: { error: "isActive must be true or false" } };
  }

  const { data: existing, error: fetchError } = await supabase
    .from("clinics")
    .select("id, name, is_active")
    .eq("id", body.id)
    .maybeSingle();

  if (fetchError) {
    debug("clinics", "Lookup failed", { error: fetchError.message });
    return { status: 500, payload: { error: "Failed to read clinic" } };
  }

  if (!existing) {
    return { status: 404, payload: { error: "Clinic not found" } };
  }

  const { error: updateError } = await supabase
    .from("clinics")
    .update({ is_active: body.isActive, updated_at: new Date().toISOString() })
    .eq("id", body.id);

  if (updateError) {
    debug("clinics", "Update failed", { error: updateError.message });
    return { status: 500, payload: { error: "Failed to update clinic" } };
  }

  // Otherwise the change waits for this isolate's cache to expire.
  clearClinicActiveCache();

  await recordAuditEvent(
    supabase,
    body.isActive ? "clinic_activated" : "clinic_deactivated",
    actor,
    "clinic",
    body.id,
    { is_active: existing.is_active },
    { is_active: body.isActive, reason: body.reason ?? null }
  );

  debug("clinics", "Clinic active state changed", {
    clinicId: body.id,
    isActive: body.isActive
  });

  return {
    status: 200,
    payload: { id: body.id, name: existing.name, isActive: body.isActive }
  };
}

async function handleRequest(user: TokenPayload, req: Request): Promise<Response> {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      return errorResponse("Server configuration error", 500);
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const actor = `${user.role.toLowerCase()}:${user.email}`;

    if (req.method === "GET") {
      const result = await listClinics(supabase);
      return new Response(JSON.stringify(result.payload), {
        status: result.status,
        headers: { "Content-Type": "application/json" }
      });
    }

    const body = await req.json().catch(() => null);

    if (!body) {
      return badRequestResponse("Invalid JSON body");
    }

    const result = await setClinicActive(supabase, actor, body);

    return new Response(JSON.stringify(result.payload), {
      status: result.status,
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    debug("clinics", "Error handling request", {
      error: error instanceof Error ? error.message : String(error)
    });
    return errorResponse(error instanceof Error ? error : new Error(String(error)));
  }
}

Deno.serve(withCors(async (req: Request) => {
  if (!["GET", "PATCH"].includes(req.method)) {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { "Content-Type": "application/json" } }
    );
  }

  // Platform ADMIN only: a clinic owner must not be able to switch their own
  // clinic back on, or reach another clinic at all.
  return withAuth(req, "ADMIN", (user) => handleRequest(user, req));
}));
