/**
 * Receptionist Appointments API
 * 
 * GET /api/receptionists/appointments?date=YYYY-MM-DD&status=CONFIRMED
 * List appointments for clinic
 * 
 * POST /api/receptionists/appointments
 * Create new appointment
 * 
 * POST body:
 * {
 *   "patientName": "John Doe",
 *   "patientPhone": "+91...",
 *   "patientEmail": "john@example.com",
 *   "doctorId": "doctor-uuid",
 *   "appointmentDate": "2026-09-15",
 *   "appointmentTime": "10:00",
 *   "notes": "Consultation for checkup",
 *   "preferredLanguage": "EN"
 * }
 * 
 * GET Response:
 * {
 *   "appointments": [...],
 *   "total": 5,
 *   "date": "2026-09-15"
 * }
 * 
 * POST Response:
 * {
 *   "id": "apt-uuid",
 *   "appointmentDate": "2026-09-15",
 *   "appointmentTime": "10:00",
 *   "status": "CONFIRMED",
 *   "patientName": "John Doe",
 *   "patientPhone": "+91...",
 *   "doctorName": "Dr. Jane"
 * }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withAuth, successResponse, errorResponse, badRequestResponse } from "../shared/auth-middleware.ts";
import { TokenPayload } from "../shared/jwt-auth.ts";
import { debug } from "../shared/logger.ts";
import MultiClinicSupabaseClient from "../shared/multi-clinic-supabase-client.ts";
import { withCors } from "../shared/cors.ts";
import { createAppointmentReminders } from "../shared/appointment-reminders.ts";

interface CreateAppointmentRequest {
  patientName: string;
  patientPhone: string;
  patientEmail?: string;
  doctorId: string;
  appointmentDate: string;
  appointmentTime: string;
  notes?: string;
  preferredLanguage?: "EN" | "HI";
}

/**
 * Validate email format
 */
function isValidEmail(email: string): boolean {
  // Basic email validation regex
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * List appointments for clinic
 */
async function listAppointments(
  supabase: SupabaseClient,
  clinicId: string,
  date?: string,
  status?: string
) {
  try {
    // The doctor is embedded because appointments has no doctor_name column;
    // reading one gave every row an empty doctor in the portal.
    let query = supabase
      .from("appointments")
      .select("*, doctor:doctors(id, name)")
      .eq("clinic_id", clinicId);

    if (date) {
      query = query.eq("appointment_date", date);
    }

    if (status) {
      query = query.eq("status", status);
    }

    query = query.order("appointment_time", { ascending: true });

    const { data, error } = await query;

    if (error) {
      debug("receptionistAppointments", "Database error", {
        error: error.message,
        clinicId
      });
      return null;
    }

    return data;
  } catch (error) {
    debug("receptionistAppointments", "Error listing appointments", {
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

/**
 * Validate create appointment request
 */
function validateCreateRequest(body: unknown): { valid: boolean; error?: string; data?: CreateAppointmentRequest } {
  if (typeof body !== "object" || body === null) {
    return { valid: false, error: "Request body must be JSON object" };
  }

  const req = body as Record<string, unknown>;

  // Validate required fields
  if (!req.patientName || typeof req.patientName !== "string") {
    return { valid: false, error: "patientName required" };
  }

  if (!req.patientPhone || typeof req.patientPhone !== "string") {
    return { valid: false, error: "patientPhone required" };
  }

  if (!req.doctorId || typeof req.doctorId !== "string") {
    return { valid: false, error: "doctorId required" };
  }

  if (!req.appointmentDate || typeof req.appointmentDate !== "string") {
    return { valid: false, error: "appointmentDate required (YYYY-MM-DD)" };
  }

  if (!req.appointmentTime || typeof req.appointmentTime !== "string") {
    return { valid: false, error: "appointmentTime required (HH:MM)" };
  }

  // Validate email format if provided
  if (req.patientEmail && typeof req.patientEmail === "string") {
    if (!isValidEmail(req.patientEmail)) {
      return { valid: false, error: "patientEmail must be a valid email address" };
    }
  }

  return {
    valid: true,
    data: {
      patientName: req.patientName as string,
      patientPhone: req.patientPhone as string,
      patientEmail: typeof req.patientEmail === "string" ? req.patientEmail : undefined,
      doctorId: req.doctorId as string,
      appointmentDate: req.appointmentDate as string,
      appointmentTime: req.appointmentTime as string,
      notes: typeof req.notes === "string" ? req.notes : undefined,
      preferredLanguage: req.preferredLanguage === "HI" ? "HI" : "EN"
    }
  };
}

/**
 * Free slots for a doctor, using the same rules as the WhatsApp flow so the
 * two channels cannot offer different availability.
 */
async function listAvailableSlots(
  _supabase: SupabaseClient,
  clinicId: string,
  doctorId: string,
  date: string
): Promise<string[]> {
  try {
    const client = new MultiClinicSupabaseClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    return await client.getAvailableSlots(clinicId, doctorId, date);
  } catch (error) {
    debug("receptionistAppointments", "Slot lookup failed", {
      error: error instanceof Error ? error.message : String(error)
    });
    return [];
  }
}

/**
 * Create new appointment
 */
async function createAppointment(
  supabase: SupabaseClient,
  clinicId: string,
  req: CreateAppointmentRequest
) {
  try {
    // First, verify doctor exists and belongs to clinic
    const { data: doctor, error: doctorError } = await supabase
      .from("doctors")
      .select("id, name")
      .eq("id", req.doctorId)
      .eq("clinic_id", clinicId)
      .single();

    if (doctorError || !doctor) {
      return {
        success: false,
        error: "Doctor not found or does not belong to this clinic"
      };
    }

    // Appointments need an explicit id and service type, mirroring the
    // WhatsApp booking path.
    const dateStr = new Date().toISOString().split("T")[0].replace(/-/g, "");
    const random = crypto.randomUUID().replace(/-/g, "").substring(0, 6);
    const appointmentId = `APT_${dateStr}_${random}`;

    // service_types is a global catalogue, not per-clinic.
    const { data: serviceType } = await supabase
      .from("service_types")
      .select("id")
      .eq("code", "CONSULTATION")
      .maybeSingle();

    if (!serviceType) {
      return {
        success: false,
        error: "No CONSULTATION service type is configured"
      };
    }

    // Create appointment
    const { data, error } = await supabase
      .from("appointments")
      .insert({
        id: appointmentId,
        clinic_id: clinicId,
        patient_name: req.patientName,
        patient_phone: req.patientPhone,
        doctor_id: req.doctorId,
        service_type_id: serviceType.id,
        location_type: "CLINIC",
        appointment_date: req.appointmentDate,
        appointment_time: req.appointmentTime,
        status: "CONFIRMED",
        notes: req.notes || null,
        preferred_language: req.preferredLanguage || "EN"
      })
      .select("*")
      .single();

    if (error) {
      debug("receptionistAppointments", "Error creating appointment", {
        error: error.message
      });
      return {
        success: false,
        error: `Failed to create appointment: ${error.message}`
      };
    }

    // Create appointment reminders (non-blocking)
    try {
      await createAppointmentReminders(
        supabase,
        clinicId,
        data.id,
        req.appointmentDate,
        req.appointmentTime
      );
    } catch (reminderError) {
      debug("receptionistAppointments", "Warning: Failed to create reminders", {
        error: reminderError instanceof Error ? reminderError.message : String(reminderError),
        appointmentId: data.id
      });
      // Don't fail the appointment creation if reminders fail
    }

    return {
      success: true,
      data: {
        id: data.id,
        appointmentDate: data.appointment_date,
        appointmentTime: data.appointment_time,
        status: data.status,
        patientName: data.patient_name,
        patientPhone: data.patient_phone,
        doctorName: doctor.name,
        createdAt: data.created_at
      }
    };
  } catch (error) {
    debug("receptionistAppointments", "Error in createAppointment", {
      error: error instanceof Error ? error.message : String(error)
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    };
  }
}

/**
 * Main handler
 */
async function handleRequest(user: TokenPayload, req: Request): Promise<Response> {
  try {
    // A clinic owner runs the front desk too; a platform ADMIN has no clinic
    // of their own so has nothing to scope this to.
    if (user.role !== "RECEPTIONIST" && user.role !== "CLINIC_OWNER") {
      return new Response(
        JSON.stringify({ error: "Only clinic staff can access this endpoint" }),
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

    // Handle GET (list appointments)
    if (req.method === "GET") {
      const url = new URL(req.url);
      const dateParam = url.searchParams.get("date");
      const statusParam = url.searchParams.get("status");
      const resource = url.searchParams.get("resource");

      // Booking a walk-in needs the clinic's doctors and their free slots,
      // neither of which a receptionist can reach through the staff endpoint.
      if (resource === "doctors") {
        const { data, error } = await supabase
          .from("doctors")
          .select("id, name, specialization, availability_status")
          .eq("clinic_id", user.clinicId!)
          .eq("is_active", true)
          .order("name", { ascending: true });

        if (error) {
          debug("receptionistAppointments", "Doctor list failed", { error: error.message });
          return errorResponse("Failed to list doctors", 500);
        }

        return successResponse({ doctors: data ?? [] });
      }

      if (resource === "slots") {
        const doctorId = url.searchParams.get("doctorId");

        if (!doctorId || !dateParam) {
          return badRequestResponse("doctorId and date are required");
        }

        const slots = await listAvailableSlots(supabase, user.clinicId!, doctorId, dateParam);

        return successResponse({ doctorId, date: dateParam, slots });
      }

      const appointments = await listAppointments(
        supabase,
        user.clinicId!,
        dateParam || undefined,
        statusParam || undefined
      );

      if (appointments === null) {
        return errorResponse("Failed to fetch appointments", 500);
      }

      debug("receptionistAppointments", "Appointments listed", {
        clinicId: user.clinicId,
        count: appointments.length,
        date: dateParam
      });

      return successResponse({
        appointments,
        total: appointments.length,
        date: dateParam
      });
    }

    // Handle POST (create appointment)
    if (req.method === "POST") {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return badRequestResponse("Invalid JSON body");
      }

      const validation = validateCreateRequest(body);
      if (!validation.valid) {
        return badRequestResponse(validation.error);
      }

      const result = await createAppointment(supabase, user.clinicId!, validation.data!);

      if (!result.success) {
        return badRequestResponse(result.error);
      }

      debug("receptionistAppointments", "Appointment created", {
        clinicId: user.clinicId,
        appointmentId: result.data!.id,
        patientName: result.data!.patientName
      });

      return successResponse(result.data, 201);
    }

    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    debug("receptionistAppointments", "Error handling request", {
      error: error instanceof Error ? error.message : String(error)
    });
    return errorResponse(error instanceof Error ? error : new Error(String(error)));
  }
}

// Export for Deno serve
Deno.serve(withCors(async (req: Request) => {
  if (!["GET", "POST"].includes(req.method)) {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { "Content-Type": "application/json" } }
    );
  }

  return withAuth(req, ["RECEPTIONIST", "CLINIC_OWNER"], (user) => handleRequest(user, req));
}));
