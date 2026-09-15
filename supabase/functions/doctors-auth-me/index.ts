/**
 * Doctor Profile API
 * 
 * GET /api/doctors/auth/me
 * Returns current authenticated doctor's profile
 * Requires: Authorization: Bearer <token>
 * 
 * Response:
 * {
 *   "id": "doctor-uuid",
 *   "name": "Dr. John Doe",
 *   "email": "doctor@example.com",
 *   "phone": "+91...",
 *   "specialization": "General Practitioner",
 *   "clinic": { "id": "clinic-uuid", "name": "ABC Clinic" }
 * }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withAuth, successResponse, errorResponse } from "../shared/auth-middleware.ts";
import { TokenPayload } from "../shared/jwt-auth.ts";
import { debug } from "../shared/logger.ts";
import { withCors } from "../shared/cors.ts";

/**
 * Fetch doctor profile from database
 */
async function getDoctorProfile(supabase: SupabaseClient, doctorId: string) {
  const { data, error } = await supabase
    .from("doctors")
    .select(`
      id,
      name,
      email,
      phone,
      specialization,
      clinic:clinics(id, name, location)
    `)
    .eq("id", doctorId)
    .single();

  if (error || !data) {
    debug("doctorProfile", "Doctor profile not found", { doctorId });
    return null;
  }

  return data;
}

/**
 * Main handler
 */
async function handleGetProfile(user: TokenPayload): Promise<Response> {
  try {
    // Verify user is DOCTOR role
    if (user.role !== "DOCTOR") {
      return new Response(
        JSON.stringify({ error: "Only doctors can access this endpoint" }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    // Initialize Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      return errorResponse("Server configuration error", 500);
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch doctor profile
    const profile = await getDoctorProfile(supabase, user.userId);

    if (!profile) {
      return errorResponse("Doctor profile not found", 404);
    }

    debug("doctorProfile", "Profile retrieved", { doctorId: user.userId });

    return successResponse(profile);
  } catch (error) {
    debug("doctorProfile", "Error fetching profile", {
      error: error instanceof Error ? error.message : String(error)
    });
    return errorResponse(error instanceof Error ? error : new Error(String(error)));
  }
}

// Export for Deno serve
Deno.serve(withCors(async (req: Request) => {
  if (req.method !== "GET") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { "Content-Type": "application/json" } }
    );
  }

  // Use withAuth middleware to validate token and get user
  return withAuth(req, "DOCTOR", handleGetProfile);
}));
