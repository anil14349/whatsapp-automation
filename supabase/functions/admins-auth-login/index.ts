/**
 * Admin / clinic owner login.
 *
 * CLINIC_OWNER and ADMIN existed only as strings in the token type with no way
 * to obtain such a token. This issues one, which is what gates staff
 * provisioning.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createJwtToken } from "../shared/jwt-auth.ts";
import { badRequestResponse, errorResponse, forbiddenResponse, successResponse } from "../shared/auth-middleware.ts";
import { isClinicActive } from "../shared/clinic-status.ts";
import { debug } from "../shared/logger.ts";
import { verifyPassword } from "../shared/bcrypt-password.ts";
import { withCors } from "../shared/cors.ts";

interface LoginRequest {
  email: string;
  password: string;
  /** Omitted for platform admins, who are not scoped to a clinic. */
  clinicId?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function findAdmin(
  supabase: SupabaseClient,
  email: string,
  clinicId?: string
) {
  let query = supabase
    .from("clinic_admins")
    .select("id, clinic_id, name, email, password_hash, role, status")
    .eq("email", email.toLowerCase().trim())
    .eq("status", "ACTIVE");

  // The portal now always names its clinic, so a platform admin — who has no
  // clinic — would never be found by an equality match. Accept either and
  // prefer the clinic's own owner when both exist.
  //
  // The id is spliced into a PostgREST filter string, and this endpoint takes
  // an unauthenticated body, so anything that is not a uuid is dropped rather
  // than passed through as filter syntax.
  query = clinicId && UUID.test(clinicId)
    ? query.or(`clinic_id.eq.${clinicId},clinic_id.is.null`)
    : query.is("clinic_id", null);

  const { data, error } = await query
    .order("clinic_id", { ascending: true, nullsFirst: false })
    .limit(1);

  if (error) {
    debug("adminLogin", "Admin lookup failed", { error: error.message });
    return null;
  }

  return data?.[0] ?? null;
}

export async function handleAdminLogin(req: Request): Promise<Response> {
  try {
    const body = await req.json() as LoginRequest;

    if (!body.email || !body.password) {
      return badRequestResponse("Missing required fields: email, password");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      return errorResponse("Server configuration error", 500);
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const admin = await findAdmin(supabase, body.email, body.clinicId);

    // A missing account and a wrong password must be indistinguishable.
    const passwordValid = admin?.password_hash
      ? await verifyPassword(body.password, admin.password_hash)
      : false;

    if (!admin || !passwordValid) {
      debug("adminLogin", "Login rejected", { email: body.email });
      return badRequestResponse("Invalid credentials");
    }

    // A platform ADMIN has no clinic and stays reachable so a deactivated
    // clinic can still be turned back on.
    if (admin.clinic_id && !(await isClinicActive(admin.clinic_id))) {
      debug("adminLogin", "Login rejected, clinic inactive", { clinicId: admin.clinic_id });
      return forbiddenResponse("This clinic is not active");
    }

    const token = await createJwtToken(
      {
        userId: admin.id,
        email: admin.email,
        role: admin.role as "ADMIN" | "CLINIC_OWNER",
        clinicId: admin.clinic_id ?? undefined
      },
      12
    );

    await supabase
      .from("clinic_admins")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", admin.id);

    debug("adminLogin", "Login successful", { adminId: admin.id, role: admin.role });

    return successResponse({
      token,
      expiresIn: "12h",
      admin: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        clinicId: admin.clinic_id
      }
    });
  } catch (error) {
    debug("adminLogin", "Error handling login", {
      error: error instanceof Error ? error.message : String(error)
    });
    return errorResponse("Internal server error", 500);
  }
}

Deno.serve(withCors(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { "Content-Type": "application/json" } }
    );
  }

  return handleAdminLogin(req);
}));
