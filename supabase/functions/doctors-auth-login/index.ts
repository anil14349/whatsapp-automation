/**
 * Doctor Login API
 * 
 * POST /api/doctors/auth/login
 * Authenticate doctor with email/PIN and return JWT token
 * 
 * Request body:
 * {
 *   "email": "doctor@example.com",
 *   "pin": "1234",
 *   "clinicId": "clinic-uuid"
 * }
 * 
 * Response:
 * {
 *   "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
 *   "expiresIn": "24h",
 *   "doctor": {
 *     "id": "doctor-uuid",
 *     "name": "Dr. John Doe",
 *     "email": "doctor@example.com",
 *     "clinic": { "id": "clinic-uuid", "name": "ABC Clinic" }
 *   }
 * }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createJwtToken } from "../shared/jwt-auth.ts";
import { badRequestResponse, errorResponse, forbiddenResponse, successResponse } from "../shared/auth-middleware.ts";
import { isClinicActive } from "../shared/clinic-status.ts";
import { debug } from "../shared/logger.ts";
import { withCors } from "../shared/cors.ts";
import { verifyPassword } from "../shared/bcrypt-password.ts";
import { isRateLimited, recordFailedAttempt, clearFailedAttempts, getRemainingLockoutTime, DEFAULT_RATE_LIMIT } from "../shared/rate-limiting.ts";

interface LoginRequest {
  email: string;
  pin: string;
  clinicId: string;
}

/**
 * Verify doctor PIN against bcrypt-hashed PIN in database
 */
async function verifyDoctorPin(supabase: SupabaseClient, doctorId: string, pin: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("doctors")
      .select("pin_hash")
      .eq("id", doctorId)
      .single();

    if (error || !data) {
      return false;
    }

    // Use bcrypt to verify PIN securely
    const isValid = await verifyPassword(pin, data.pin_hash);
    return isValid;
  } catch (error) {
    debug("doctorLogin", "Error verifying PIN", { error: String(error) });
    return false;
  }
}

/**
 * Fetch doctor details
 *
 * By number as well as by address, because a doctor's email is optional when
 * they are added and their number is not. Requiring the address here locked
 * every doctor added without one out of the portal entirely.
 */
async function getDoctorDetails(supabase: SupabaseClient, identifier: string, clinicId: string) {
  const digits = identifier.replace(/\D/g, "");
  const looksLikePhone = digits.length >= 10 && digits.length <= 15 && !identifier.includes("@");

  const { data, error } = await supabase
    .from("doctors")
    .select(`
      id,
      name,
      email,
      clinic:clinics(id, name)
    `)
    .eq(looksLikePhone ? "phone" : "email", looksLikePhone ? digits : identifier.toLowerCase())
    .eq("clinic_id", clinicId)
    .single();

  if (error || !data) {
    debug("doctorLogin", "Doctor not found", { clinicId });
    return null;
  }

  // PostgREST returns an object for a to-one embed, not the array the
  // generated types describe.
  return data as unknown as {
    id: string;
    name: string;
    email: string;
    clinic: { id: string; name: string };
  };
}

/**
 * Main login handler
 */
export async function handleDoctorLogin(req: Request): Promise<Response> {
  try {
    // Parse request body
    const body = await req.json() as LoginRequest;

    // Validate required fields
    if (!body.email || !body.pin || !body.clinicId) {
      return badRequestResponse("Missing required fields: email, pin, clinicId");
    }

    debug("doctorLogin", "Login attempt", { email: body.email, clinicId: body.clinicId });

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      return errorResponse("Server configuration error", 500);
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get doctor by email and clinic
    const doctor = await getDoctorDetails(supabase, body.email, body.clinicId);

    if (!doctor) {
      debug("doctorLogin", "Doctor not found", { email: body.email });
      return badRequestResponse("Invalid email or clinic");
    }

    // Check rate limiting (prevent brute force)
    const isLocked = await isRateLimited(supabase, doctor.id, "doctor");
    if (isLocked) {
      const remainingMinutes = await getRemainingLockoutTime(supabase, doctor.id, "doctor");
      debug("doctorLogin", "Account locked due to failed attempts", { doctorId: doctor.id });
      return badRequestResponse(
        `Account temporarily locked. Try again in ${remainingMinutes} minutes.`
      );
    }

    // Verify PIN
    const pinValid = await verifyDoctorPin(supabase, doctor.id, body.pin);

    if (!pinValid) {
      debug("doctorLogin", "Invalid PIN", { doctorId: doctor.id });
      
      // Record failed attempt and check if should lock
      const wasLocked = await recordFailedAttempt(
        supabase,
        doctor.id,
        "doctor",
        body.clinicId
      );
      
      if (wasLocked) {
        return badRequestResponse(
          `Invalid PIN. Account locked for ${DEFAULT_RATE_LIMIT.lockoutDurationMinutes} minutes.`
        );
      }
      
      return badRequestResponse("Invalid PIN");
    }

    // Clear failed attempts on successful login
    await clearFailedAttempts(supabase, doctor.id, "doctor");

    if (!(await isClinicActive(body.clinicId))) {
      debug("doctorLogin", "Login rejected, clinic inactive", { clinicId: body.clinicId });
      return forbiddenResponse("This clinic is not active");
    }

    // Create JWT token
    const token = await createJwtToken(
      {
        userId: doctor.id,
        email: doctor.email,
        role: "DOCTOR",
        clinicId: doctor.clinic.id,
        doctorId: doctor.id
      },
      24 // 24 hour expiry
    );

    debug("doctorLogin", "Login successful", { doctorId: doctor.id, email: doctor.email });

    return successResponse({
      token,
      expiresIn: "24h",
      doctor: {
        id: doctor.id,
        name: doctor.name,
        email: doctor.email,
        clinic: doctor.clinic
      }
    });
  } catch (error) {
    debug("doctorLogin", "Error handling login", {
      error: error instanceof Error ? error.message : String(error)
    });
    return errorResponse(error instanceof Error ? error : new Error(String(error)));
  }
}

// Export for Deno serve
Deno.serve(withCors(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { "Content-Type": "application/json" } }
    );
  }

  return handleDoctorLogin(req);
}));
