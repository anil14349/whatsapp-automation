/**
 * What a clinic looks like: its name, its logo, its colour.
 *
 * Separate from clinic-settings because that one is for the people who can
 * change these, while every signed-in person needs to see them. A doctor
 * looking at their own day should still see their clinic's name in the header.
 *
 * GET /clinic-branding
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withAuth, successResponse, errorResponse, badRequestResponse } from "../shared/auth-middleware.ts";
import { TokenPayload } from "../shared/jwt-auth.ts";
import { withCors } from "../shared/cors.ts";

async function handleRequest(user: TokenPayload, req: Request): Promise<Response> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseKey) {
    return errorResponse("Server configuration error", 500);
  }

  const url = new URL(req.url);

  // A platform admin has no clinic of their own, so they have to name one.
  const clinicId =
    user.role === "ADMIN" ? url.searchParams.get("clinicId") : user.clinicId;

  if (!clinicId) {
    return badRequestResponse("clinicId is required");
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

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

Deno.serve(withCors(async (req: Request) => {
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" }
    });
  }

  return withAuth(
    req,
    ["ADMIN", "CLINIC_OWNER", "RECEPTIONIST", "DOCTOR"],
    (user) => handleRequest(user, req)
  );
}));
