/**
 * Receptionist Login API
 * 
 * POST /api/receptionists/auth/login
 * Authenticate receptionist with email and password
 * 
 * Request body:
 * {
 *   "email": "receptionist@example.com",
 *   "password": "password123",
 *   "clinicId": "clinic-uuid"
 * }
 * 
 * Response:
 * {
 *   "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
 *   "expiresIn": "24h",
 *   "receptionist": {
 *     "id": "receptionist-uuid",
 *     "name": "Jane Doe",
 *     "email": "receptionist@example.com",
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

interface ReceptionistLoginRequest {
  email: string;
  password: string;
  clinicId: string;
}

/**
 * Verify receptionist password (bcrypt-hashed)
 */
async function verifyReceptionistPassword(
  supabase: SupabaseClient,
  receptionistId: string,
  password: string
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("receptionists")
      .select("password_hash")
      .eq("id", receptionistId)
      .single();

    if (error || !data) {
      return false;
    }

    // Use bcrypt to verify password securely
    const isValid = await verifyPassword(password, data.password_hash);
    return isValid;
  } catch (error) {
    debug("receptionistLogin", "Error verifying password", { error: String(error) });
    return false;
  }
}

/**
 * Fetch receptionist details
 */
/**
 * Finds a receptionist by whatever they signed in with.
 *
 * A doctor signs in with their number, so insisting a receptionist has an email
 * was a difference with no reason behind it. Plenty of front desk staff have a
 * phone and no work address.
 */
async function getReceptionistDetails(
  supabase: SupabaseClient,
  identifier: string,
  clinicId: string
) {
  const digits = identifier.replace(/\D/g, "");
  const looksLikePhone = digits.length >= 10 && digits.length <= 15 && !identifier.includes("@");

  const { data, error } = await supabase
    .from("receptionists")
    .select(`
      id,
      name,
      email,
      status,
      clinic:clinics(id, name)
    `)
    .eq(looksLikePhone ? "phone" : "email", looksLikePhone ? digits : identifier.toLowerCase())
    .eq("clinic_id", clinicId)
    .eq("status", "ACTIVE")
    .single();

  if (error || !data) {
    debug("receptionistLogin", "Receptionist not found", { clinicId });
    return null;
  }

  // PostgREST returns an object for a to-one embed, not the array the
  // generated types describe.
  return data as unknown as {
    id: string;
    name: string;
    email: string;
    status: string;
    clinic: { id: string; name: string };
  };
}

/**
 * Main login handler
 */
export async function handleReceptionistLogin(req: Request): Promise<Response> {
  try {
    // Parse request body
    const body = await req.json() as ReceptionistLoginRequest;

    // Validate required fields
    const identifier = (body.email ?? "").trim();

    if (!identifier || !body.password || !body.clinicId) {
      return badRequestResponse("Missing required fields: email, password, clinicId");
    }

    debug("receptionistLogin", "Login attempt", { clinicId: body.clinicId });

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      return errorResponse("Server configuration error", 500);
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // An email address or a WhatsApp number, whichever they were given.
    const receptionist = await getReceptionistDetails(supabase, identifier, body.clinicId);

    if (!receptionist) {
      debug("receptionistLogin", "Receptionist not found or inactive", { clinicId: body.clinicId });
      return badRequestResponse("Invalid sign in details");
    }

    // Check rate limiting (prevent brute force)
    const isLocked = await isRateLimited(supabase, receptionist.id, "receptionist");
    if (isLocked) {
      const remainingMinutes = await getRemainingLockoutTime(supabase, receptionist.id, "receptionist");
      debug("receptionistLogin", "Account locked due to failed attempts", { receptionistId: receptionist.id });
      return badRequestResponse(
        `Account temporarily locked. Try again in ${remainingMinutes} minutes.`
      );
    }

    // Verify password
    const passwordValid = await verifyReceptionistPassword(supabase, receptionist.id, body.password);

    if (!passwordValid) {
      debug("receptionistLogin", "Invalid password", { receptionistId: receptionist.id });

      // Record failed attempt and check if should lock
      const wasLocked = await recordFailedAttempt(
        supabase,
        receptionist.id,
        "receptionist",
        body.clinicId
      );

      if (wasLocked) {
        return badRequestResponse(
          `Invalid password. Account locked for ${DEFAULT_RATE_LIMIT.lockoutDurationMinutes} minutes.`
        );
      }

      return badRequestResponse("Invalid email or password");
    }

    // Clear failed attempts on successful login
    await clearFailedAttempts(supabase, receptionist.id, "receptionist");

    if (!(await isClinicActive(receptionist.clinic.id))) {
      debug("receptionistLogin", "Login rejected, clinic inactive", {
        clinicId: receptionist.clinic.id
      });
      return forbiddenResponse("This clinic is not active");
    }

    // Create JWT token
    const token = await createJwtToken(
      {
        userId: receptionist.id,
        email: receptionist.email,
        role: "RECEPTIONIST",
        clinicId: receptionist.clinic.id
      },
      24 // 24 hour expiry
    );

    debug("receptionistLogin", "Login successful", {
      receptionistId: receptionist.id,
      email: receptionist.email
    });

    return successResponse({
      token,
      expiresIn: "24h",
      receptionist: {
        id: receptionist.id,
        name: receptionist.name,
        email: receptionist.email,
        clinic: receptionist.clinic
      }
    });
  } catch (error) {
    debug("receptionistLogin", "Error handling login", {
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

  return handleReceptionistLogin(req);
}));
