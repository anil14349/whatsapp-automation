/**
 * What a clinic looks like: its name, its logo, its colour.
 *
 * Separate from clinic-settings because that one is for the people who can
 * change these, while every signed-in person needs to see them. A doctor
 * looking at their own day should still see their clinic's name in the header.
 *
 * GET    /clinic-branding   name, logo and colour
 * POST   /clinic-branding   multipart logo upload, managers only
 * DELETE /clinic-branding   drop the logo, managers only
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withAuth, successResponse, errorResponse, badRequestResponse } from "../shared/auth-middleware.ts";
import { TokenPayload } from "../shared/jwt-auth.ts";
import { withCors } from "../shared/cors.ts";
import { debug, recordAuditEvent } from "../shared/logger.ts";
import {
  ALLOWED_LOGO_TYPES,
  MAX_LOGO_BYTES,
  removeStoredLogo,
  storeLogo
} from "../shared/clinic-logo.ts";

function serviceClient(): SupabaseClient | null {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseKey) {
    return null;
  }

  return createClient(supabaseUrl, supabaseKey);
}

function resolveClinicId(user: TokenPayload, req: Request): string | null {
  // A platform admin has no clinic of their own, so they have to name one.
  if (user.role === "ADMIN") {
    return new URL(req.url).searchParams.get("clinicId");
  }

  return user.clinicId ?? null;
}

async function currentLogoUrl(
  supabase: SupabaseClient,
  clinicId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("clinics")
    .select("logo_url")
    .eq("id", clinicId)
    .maybeSingle();

  return data?.logo_url ?? null;
}

async function read(supabase: SupabaseClient, clinicId: string): Promise<Response> {
  const { data, error } = await supabase
    .from("clinics")
    .select("id, name, logo_url, brand_colour")
    .eq("id", clinicId)
    .maybeSingle();

  if (error) {
    return errorResponse("Failed to load branding", 500);
  }

  if (!data) {
    return badRequestResponse("Clinic not found");
  }

  return successResponse({
    clinicId: data.id,
    name: data.name,
    logoUrl: data.logo_url,
    brandColour: data.brand_colour
  });
}

async function upload(
  supabase: SupabaseClient,
  clinicId: string,
  user: TokenPayload,
  req: Request
): Promise<Response> {
  let form: FormData;

  try {
    form = await req.formData();
  } catch {
    return badRequestResponse("Send the image as multipart/form-data");
  }

  const file = form.get("file");

  if (!(file instanceof File) || file.size === 0) {
    return badRequestResponse("Choose an image");
  }

  if (file.size > MAX_LOGO_BYTES) {
    return badRequestResponse(
      `That image is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 2 MB.`
    );
  }

  const contentType = file.type || "";

  if (!(contentType in ALLOWED_LOGO_TYPES)) {
    return badRequestResponse("A logo must be a PNG, JPEG or WebP image");
  }

  const previous = await currentLogoUrl(supabase, clinicId);

  const stored = await storeLogo(supabase, clinicId, {
    bytes: await file.arrayBuffer(),
    contentType
  });

  if (!stored.ok || !stored.url) {
    return badRequestResponse(stored.error ?? "Could not store the logo");
  }

  const { error } = await supabase
    .from("clinics")
    .update({ logo_url: stored.url, updated_at: new Date().toISOString() })
    .eq("id", clinicId);

  if (error) {
    // The row is what makes the object reachable, so an unreferenced upload is
    // rubbish rather than a logo.
    await removeStoredLogo(supabase, clinicId, stored.url);
    debug("clinicBranding", "Could not save the logo address", { clinicId, error: error.message });
    return errorResponse("Could not save the logo", 500);
  }

  await removeStoredLogo(supabase, clinicId, previous);

  await recordAuditEvent(
    supabase,
    "CLINIC_LOGO_UPLOADED",
    user.userId,
    "clinic",
    clinicId,
    { logoUrl: previous },
    { logoUrl: stored.url }
  );

  return successResponse({ logoUrl: stored.url });
}

async function clear(
  supabase: SupabaseClient,
  clinicId: string,
  user: TokenPayload
): Promise<Response> {
  const previous = await currentLogoUrl(supabase, clinicId);

  const { error } = await supabase
    .from("clinics")
    .update({ logo_url: null, updated_at: new Date().toISOString() })
    .eq("id", clinicId);

  if (error) {
    return errorResponse("Could not remove the logo", 500);
  }

  await removeStoredLogo(supabase, clinicId, previous);

  await recordAuditEvent(
    supabase,
    "CLINIC_LOGO_REMOVED",
    user.userId,
    "clinic",
    clinicId,
    { logoUrl: previous },
    { logoUrl: null }
  );

  return successResponse({ logoUrl: null });
}

Deno.serve(withCors(async (req: Request) => {
  const method = req.method;

  if (method !== "GET" && method !== "POST" && method !== "DELETE") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" }
    });
  }

  // Everyone signed in may look; only a manager may change it.
  const roles: TokenPayload["role"][] =
    method === "GET"
      ? ["ADMIN", "CLINIC_OWNER", "RECEPTIONIST", "DOCTOR"]
      : ["ADMIN", "CLINIC_OWNER"];

  return withAuth(req, roles, async (user) => {
    const supabase = serviceClient();

    if (!supabase) {
      return errorResponse("Server configuration error", 500);
    }

    const clinicId = resolveClinicId(user, req);

    if (!clinicId) {
      return badRequestResponse("clinicId is required");
    }

    if (method === "GET") {
      return read(supabase, clinicId);
    }

    if (method === "POST") {
      return upload(supabase, clinicId, user, req);
    }

    return clear(supabase, clinicId, user);
  });
}));
