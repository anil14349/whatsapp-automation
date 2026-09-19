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

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withAuth, successResponse, errorResponse, badRequestResponse } from "../shared/auth-middleware.ts";
import { TokenPayload } from "../shared/jwt-auth.ts";
import { debug, recordAuditEvent } from "../shared/logger.ts";
import { withCors } from "../shared/cors.ts";
import { skipAppointmentReminders } from "../shared/appointment-reminders.ts";
import { scheduleNextUpNotice } from "../shared/consultation-queue.ts";

interface StatusUpdateRequest {
  appointmentId: string;
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
  const appointmentId = req.appointmentId ?? req.id;

  if (typeof appointmentId !== "string" || !appointmentId) {
    return { valid: false, error: "appointmentId field required" };
  }

  if (!req.status || typeof req.status !== "string") {
    return { valid: false, error: "status field required (COMPLETED or NO_SHOW)" };
  }

  if (!["COMPLETED", "NO_SHOW"].includes(req.status)) {
    return { valid: false, error: "status must be COMPLETED or NO_SHOW" };
  }

  return {
    valid: true,
    data: {
      appointmentId,
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
  appointmentId: string,
  clinicId: string
): Promise<{ id: string; doctor_id: string; status: string } | null> {
  const { data, error } = await supabase
    .from("appointments")
    .select("id, doctor_id, status")
    .eq("id", appointmentId)
    .eq("clinic_id", clinicId)
    .maybeSingle();

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
  clinicId: string,
  doctorId: string,
  status: "COMPLETED" | "NO_SHOW",
  notes?: string
): Promise<{ id: string; status: string; completed_at: string; updated_at: string } | null> {
  try {
    const now = new Date().toISOString();

    // A patient who never arrived was never completed. The front desk endpoint
    // already only stamps this for COMPLETED; the Summary counts both.
    let updateData: Record<string, unknown> = {
      status,
      completed_at: status === "COMPLETED" ? now : null,
      updated_at: now
    };

    if (notes) {
      updateData.notes = notes;
    }

    const { data, error } = await supabase
      .from("appointments")
      .update(updateData)
      .eq("id", appointmentId)
      // The ownership check above read the row; these repeat it on the write,
      // so nothing can move between the two.
      .eq("clinic_id", clinicId)
      .eq("doctor_id", doctorId)
      .eq("status", "CONFIRMED")
      .select("id, status, completed_at, updated_at")
      .single();

    if (error) {
      debug("doctorUpdateStatus", "Database update error", {
        error: error.message,
        appointmentId
      });
      return null;
    }

    // Same rule as the front desk: someone already seen should not later be
    // told their visit is in an hour.
    if (status === "COMPLETED" || status === "NO_SHOW") {
      await skipAppointmentReminders(supabase, appointmentId);

      // The queue has moved up by one. Whoever is now at the front is told
      // after a pause, so undoing a mis-tap gets there first.
      scheduleNextUpNotice(supabase, clinicId, doctorId);
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
    const appointmentId = updateReq.appointmentId;

    if (!user.clinicId) {
      return badRequestResponse("Token is missing a clinic");
    }

    // Initialize Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      return errorResponse("Server configuration error", 500);
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch appointment to verify ownership
    const appointment = await getAppointment(supabase, appointmentId, user.clinicId);

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

    // Same answer as the front desk gives. Without this a doctor holding a page
    // opened before the desk cancelled could mark the patient seen, and the
    // record would say a cancelled visit happened.
    if (appointment.status !== "CONFIRMED") {
      return badRequestResponse("Cannot change a cancelled appointment");
    }

    // Update appointment status
    const updated = await updateAppointmentStatus(
      supabase,
      appointmentId,
      user.clinicId,
      user.userId,
      updateReq.status,
      updateReq.notes
    );

    if (!updated) {
      return errorResponse("Failed to update appointment", 500);
    }

    // The front desk's own status change is audited; a doctor marking somebody
    // seen was not, so the clinical half of the record had no author.
    await recordAuditEvent(
      supabase,
      "appointment_status_changed",
      `doctor:${user.userId}`,
      "appointment",
      appointmentId,
      { status: appointment.status },
      { status: updateReq.status }
    );

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

// Export for Deno serve
Deno.serve(withCors(async (req: Request) => {
  if (!["PUT", "PATCH"].includes(req.method)) {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { "Content-Type": "application/json" } }
    );
  }

  return withAuth(req, "DOCTOR", (user) => handleUpdateStatus(user, req));
}));
