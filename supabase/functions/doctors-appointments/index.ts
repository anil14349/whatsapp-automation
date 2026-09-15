/**
 * Doctor Appointments API
 * 
 * GET /api/doctors/appointments
 * List appointments for authenticated doctor
 * Query params: date (YYYY-MM-DD), status (CONFIRMED|COMPLETED|NO_SHOW|CANCELLED)
 * 
 * Response:
 * {
 *   "appointments": [
 *     {
 *       "id": "apt-uuid",
 *       "date": "2026-09-15",
 *       "time": "10:00",
 *       "status": "CONFIRMED",
 *       "patient": { "id": "pat-uuid", "name": "John", "phone": "+91..." },
 *       "doctor": { "id": "doc-uuid", "name": "Dr. Jane" },
 *       "notes": "Consultation",
 *       "completedAt": null
 *     }
 *   ],
 *   "total": 5,
 *   "date": "2026-09-15"
 * }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withAuth, successResponse, errorResponse, badRequestResponse } from "../shared/auth-middleware.ts";
import { TokenPayload } from "../shared/jwt-auth.ts";
import { debug } from "../shared/logger.ts";
import { withCors } from "../shared/cors.ts";

interface AppointmentRow {
  id: string;
  appointment_date: string;
  appointment_time: string;
  status: string;
  patient_name: string;
  patient_phone: string;
  doctor_id: string;
  doctor: { name: string } | null;
  notes: string;
  completed_at: string | null;
  created_at: string;
}

/**
 * Fetch appointments for doctor
 */
async function fetchDoctorAppointments(
  supabase: SupabaseClient,
  doctorId: string,
  clinicId: string,
  date?: string,
  status?: string
): Promise<AppointmentRow[] | null> {
  try {
    let query = supabase
      .from("appointments")
      .select(`
        id,
        appointment_date,
        appointment_time,
        status,
        patient_name,
        patient_phone,
        doctor_id,
        doctor:doctors(name),
        service_type:service_types(code, name),
        booking_source,
        notes,
        completed_at,
        created_at
      `)
      .eq("doctor_id", doctorId)
      .eq("clinic_id", clinicId);

    // Filter by date if provided
    if (date) {
      query = query.eq("appointment_date", date);
    }

    // Filter by status if provided
    if (status) {
      query = query.eq("status", status);
    }

    // Order by time
    query = query.order("appointment_time", { ascending: true });

    const { data, error } = await query;

    if (error) {
      debug("doctorAppointments", "Database error", {
        error: error.message,
        doctorId
      });
      return null;
    }

    return data as unknown as AppointmentRow[];
  } catch (error) {
    debug("doctorAppointments", "Error fetching appointments", {
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

/**
 * Parse date query parameter
 */
function parseDate(dateStr?: string): { isValid: boolean; date?: string; error?: string } {
  if (!dateStr) {
    // Default to today
    const today = new Date();
    return {
      isValid: true,
      date: today.toISOString().split("T")[0]
    };
  }

  // Validate format YYYY-MM-DD
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateStr)) {
    return {
      isValid: false,
      error: "Date must be in YYYY-MM-DD format"
    };
  }

  return { isValid: true, date: dateStr };
}

/**
 * Format appointment for response
 */
function formatAppointment(row: AppointmentRow) {
  return {
    id: row.id,
    date: row.appointment_date,
    time: row.appointment_time,
    status: row.status,
    patient: {
      name: row.patient_name,
      phone: row.patient_phone
    },
    doctor: {
      id: row.doctor_id,
      name: row.doctor?.name ?? null
    },
    notes: row.notes,
    completedAt: row.completed_at,
    createdAt: row.created_at
  };
}

/**
 * Main handler
 */
async function handleGetAppointments(
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

    // Parse query parameters
    const url = new URL(req.url);
    const dateParam = url.searchParams.get("date");
    const statusParam = url.searchParams.get("status");

    // Validate date parameter
    const dateValidation = parseDate(dateParam || undefined);
    if (!dateValidation.isValid) {
      return badRequestResponse(dateValidation.error);
    }

    // Initialize Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      return errorResponse("Server configuration error", 500);
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch appointments
    const appointments = await fetchDoctorAppointments(
      supabase,
      user.userId,
      user.clinicId ?? "",
      dateValidation.date,
      statusParam || undefined
    );

    if (appointments === null) {
      return errorResponse("Failed to fetch appointments", 500);
    }

    debug("doctorAppointments", "Appointments retrieved", {
      doctorId: user.userId,
      count: appointments.length,
      date: dateValidation.date,
      status: statusParam
    });

    return successResponse({
      appointments: appointments.map(formatAppointment),
      total: appointments.length,
      date: dateValidation.date,
      filtered: {
        status: statusParam || null
      }
    });
  } catch (error) {
    debug("doctorAppointments", "Error handling request", {
      error: error instanceof Error ? error.message : String(error)
    });
    return errorResponse(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Wrapper to inject request into handler
 */
async function handler(user: TokenPayload, req: Request): Promise<Response> {
  return handleGetAppointments(user, req);
}

// Export for Deno serve
Deno.serve(withCors(async (req: Request) => {
  if (req.method !== "GET") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { "Content-Type": "application/json" } }
    );
  }

  return withAuth(req, "DOCTOR", (user) => handler(user, req));
}));
