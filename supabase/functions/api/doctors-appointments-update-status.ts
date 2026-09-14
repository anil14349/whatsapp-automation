/**
 * Update Doctor Appointment Status API
 * 
 * PUT /api/doctors/appointments/:appointmentId/status
 * Update appointment status to COMPLETED or NO_SHOW
 * Requires: Authorization: Bearer <token>
 * 
 * Request body:
 * {
 *   "status": "COMPLETED|NO_SHOW",
 *   "notes": "Optional notes"
 * }
 * 
 * Response:
 * {
 *   "id": "apt-uuid",
 *   "status": "COMPLETED",
 *   "completedAt": "2026-09-14T10:30:00Z",
 *   "updatedAt": "2026-09-14T10:30:00Z"
 * }
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withAuth, successResponse, errorResponse, badRequestResponse } from "../shared/auth-middleware.ts";
import { TokenPayload } from "../shared/jwt-auth.ts";
import { debug } from "../shared/logger.ts";

interface StatusUpdateRequest {
  status: "COMPLETED" | "NO_SHOW";
  notes?: string;
}

/**
 * Validate status update request
 */
function validateStatusUpdate(body: unknown): { valid: boolean; error?: string; data?: StatusUpdateRequest } {
  if (typeof body !== "object" || body === null) {
    return { valid: false, error: "Request body must be JSON object" };
  }

  const req = body as Record<string, unknown>;

  if (!req.status || typeof req.status !== "string") {
    return { valid: false, error: "status field required (COMPLETED or NO_SHOW)" };
  }

  if (!["COMPLETED", "NO_SHOW"].includes(req.status)) {
    return { valid: false, error: "status must be COMPLETED or NO_SHOW" };
  }

  return {
    valid: true,
    data: {
      status: req.status as "COMPLETED" | "NO_SHOW",
      notes: typeof req.notes === "string" ? req.notes : undefined
    }
  };
}

/**
 * Fetch appointment to verify ownership
 */
async function getAppointment(
  supabase: SupabaseClient,
  appointmentId: string
): Promise<{ id: string; doctor_id: string; status: string } | null> {
  const { data, error } = await supabase
    .from("appointments")
    .select("id, doctor_id, status")
    .eq("id", appointmentId)
    .single();

  if (error || !data) {
    return null;
  }

  return data;
}

/**
 * Update appointment status in database
 */
async function updateAppointmentStatus(
  supabase: SupabaseClient,
  appointmentId: string,
  status: "COMPLETED" | "NO_SHOW",
  notes?: string
): Promise<{ id: string; status: string; completed_at: string; updated_at: string } | null> {
  try {
    const completed_at = new Date().toISOString();

    let updateData: Record<string, unknown> = {
      status,
      completed_at,
      updated_at: completed_at
    };

    if (notes) {
      updateData.notes = notes;
    }

    const { data, error } = await supabase
      .from("appointments")
      .update(updateData)
      .eq("id", appointmentId)
      .select("id, status, completed_at, updated_at")
      .single();

    if (error) {
      debug("doctorUpdateStatus", "Database update error", {
        error: error.message,
        appointmentId
      });
      return null;
    }

    return data;
  } catch (error) {
    debug("doctorUpdateStatus", "Error updating appointment", {
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

/**
 * Main handler
 */
async function handleUpdateStatus(
  user: TokenPayload,
  appointmentId: string,
  req: Request
): Promise<Response> {
  try {
    // Verify user is DOCTOR
    if (user.role !== "DOCTOR") {
      return new Response(
        JSON.stringify({ error: "Only doctors can access this endpoint" }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    // Parse and validate request body
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return badRequestResponse("Invalid JSON body");
    }

    const validation = validateStatusUpdate(body);
    if (!validation.valid) {
      return badRequestResponse(validation.error);
    }

    const updateReq = validation.data!;

    // Initialize Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      return errorResponse("Server configuration error", 500);
    }

    const supabase = new SupabaseClient(supabaseUrl, supabaseKey);

    // Fetch appointment to verify ownership
    const appointment = await getAppointment(supabase, appointmentId);

    if (!appointment) {
      return errorResponse("Appointment not found", 404);
    }

    // Verify doctor owns this appointment
    if (appointment.doctor_id !== user.userId) {
      debug("doctorUpdateStatus", "Unauthorized - doctor ID mismatch", {
        appointmentId,
        doctorId: user.userId,
        appointmentDoctorId: appointment.doctor_id
      });
      return new Response(
        JSON.stringify({ error: "You can only update your own appointments" }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    // Check if appointment can be updated
    if (["COMPLETED", "NO_SHOW"].includes(appointment.status)) {
      return badRequestResponse(`Cannot update appointment already marked as ${appointment.status}`);
    }

    // Update appointment status
    const updated = await updateAppointmentStatus(
      supabase,
      appointmentId,
      updateReq.status,
      updateReq.notes
    );

    if (!updated) {
      return errorResponse("Failed to update appointment", 500);
    }

    debug("doctorUpdateStatus", "Appointment status updated", {
      appointmentId,
      doctorId: user.userId,
      newStatus: updateReq.status
    });

    return successResponse({
      id: updated.id,
      status: updated.status,
      completedAt: updated.completed_at,
      updatedAt: updated.updated_at
    });
  } catch (error) {
    debug("doctorUpdateStatus", "Error handling request", {
      error: error instanceof Error ? error.message : String(error)
    });
    return errorResponse(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Wrapper to extract URL parameters
 */
async function handler(user: TokenPayload, req: Request): Promise<Response> {
  // Extract appointmentId from URL path
  // URL format: /api/doctors/appointments/:appointmentId/status
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/");
  const appointmentId = pathParts[4]; // Index 4 is the appointmentId

  if (!appointmentId) {
    return badRequestResponse("Appointment ID required in URL");
  }

  return handleUpdateStatus(user, appointmentId, req);
}

// Export for Deno serve
Deno.serve(async (req: Request) => {
  if (req.method !== "PUT") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { "Content-Type": "application/json" } }
    );
  }

  return withAuth(req, "DOCTOR", (user) => handler(user, req));
});
