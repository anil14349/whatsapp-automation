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
import { debug, recordAuditEvent } from "../shared/logger.ts";
import { cancelAppointment, rescheduleAppointment } from "../shared/appointments.ts";
import MultiClinicSupabaseClient from "../shared/multi-clinic-supabase-client.ts";
import { withCors } from "../shared/cors.ts";
import { createAppointmentReminders } from "../shared/appointment-reminders.ts";
import { getEnabledServices, getServiceById } from "../shared/clinic-services.ts";
import { getClinicTimezone, todayInTimezone } from "../shared/clinic-slots.ts";

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
      .select("*, doctor:doctors(id, name), service_type:service_types(code, name)")
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

    // CONSULTATION is part of the shared catalogue; a clinic's own services can
    // reuse a code, so this must not match one of those.
    const { data: serviceType } = await supabase
      .from("service_types")
      .select("id")
      .eq("code", "CONSULTATION")
      .is("clinic_id", null)
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
        // Entered by the front desk, so nobody has messaged this patient yet.
        booking_source: "WALK_IN",
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
 * The clinic this request may touch.
 *
 * Receptionists and owners are pinned to their own clinic whatever they send.
 * A platform ADMIN has no clinic of their own, so they must name one.
 */
function resolveClinicId(user: TokenPayload, requested?: string | null): string | null {
  if (user.role === "ADMIN") {
    return requested || null;
  }

  return user.clinicId ?? null;
}

/**
 * Change the status of one appointment, or cancel, reschedule or edit it.
 */
async function updateAppointment(
  supabase: SupabaseClient,
  clinicId: string,
  actor: string,
  body: {
    id?: string;
    action?: string;
    status?: string;
    reason?: string;
    appointmentDate?: string;
    appointmentTime?: string;
    patientName?: string;
    patientPhone?: string;
    notes?: string;
    doctorId?: string | null;
    serviceTypeId?: string;
  }
): Promise<{ status: number; payload: Record<string, unknown> }> {
  if (!body.id) {
    return { status: 400, payload: { error: "id is required" } };
  }

  const action = body.action ?? "status";

  if (action === "cancel") {
    const result = await cancelAppointment(
      supabase,
      body.id,
      clinicId,
      body.reason || "Cancelled by clinic staff",
      actor
    );

    return result.success
      ? { status: 200, payload: { id: body.id, status: "CANCELLED" } }
      : { status: 400, payload: { error: result.message } };
  }

  if (action === "reschedule") {
    if (!body.appointmentDate || !body.appointmentTime) {
      return { status: 400, payload: { error: "appointmentDate and appointmentTime are required" } };
    }

    const result = await rescheduleAppointment(
      supabase,
      body.id,
      clinicId,
      body.appointmentDate,
      body.appointmentTime,
      actor
    );

    return result.success
      ? {
        status: 200,
        payload: { id: body.id, date: body.appointmentDate, time: body.appointmentTime }
      }
      : { status: 400, payload: { error: result.message } };
  }

  if (action === "edit") {
    return await editAppointment(supabase, clinicId, actor, body);
  }

  if (action !== "status") {
    return { status: 400, payload: { error: "action must be status, cancel, reschedule or edit" } };
  }

  const status = body.status;

  if (status !== "COMPLETED" && status !== "NO_SHOW" && status !== "CONFIRMED") {
    return { status: 400, payload: { error: "status must be COMPLETED, NO_SHOW or CONFIRMED" } };
  }

  const { data: existing } = await supabase
    .from("appointments")
    .select("id, status")
    .eq("id", body.id)
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (!existing) {
    return { status: 404, payload: { error: "Appointment not found at this clinic" } };
  }

  if (existing.status === "CANCELLED") {
    return { status: 400, payload: { error: "Cannot change a cancelled appointment" } };
  }

  const now = new Date().toISOString();

  const { error } = await supabase
    .from("appointments")
    .update({
      status,
      // Clearing this on reopen keeps the feedback sweep from treating a
      // reopened appointment as finished.
      completed_at: status === "COMPLETED" ? now : null,
      updated_at: now
    })
    .eq("id", body.id)
    .eq("clinic_id", clinicId);

  if (error) {
    return { status: 500, payload: { error: `Failed to update appointment: ${error.message}` } };
  }

  await recordAuditEvent(
    supabase,
    "appointment_status_changed",
    actor,
    "appointment",
    body.id,
    { status: existing.status },
    { status }
  );

  return { status: 200, payload: { id: body.id, status } };
}

/**
 * Correct the details of an appointment the front desk already took.
 *
 * Moving it in time is the reschedule action; this is for the things that were
 * simply written down wrong.
 */
async function editAppointment(
  supabase: SupabaseClient,
  clinicId: string,
  actor: string,
  body: {
    id?: string;
    patientName?: string;
    patientPhone?: string;
    notes?: string;
    doctorId?: string | null;
    serviceTypeId?: string;
  }
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const { data: existing } = await supabase
    .from("appointments")
    .select(
      "id, status, patient_name, patient_phone, notes, doctor_id, service_type_id, appointment_date, appointment_time"
    )
    .eq("id", body.id)
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (!existing) {
    return { status: 404, payload: { error: "Appointment not found at this clinic" } };
  }

  if (existing.status === "CANCELLED") {
    return { status: 400, payload: { error: "Cannot edit a cancelled appointment" } };
  }

  const patch: Record<string, unknown> = {};
  const before: Record<string, unknown> = {};

  if (body.patientName !== undefined) {
    const name = body.patientName.trim();

    if (!name) {
      return { status: 400, payload: { error: "Patient name cannot be empty" } };
    }

    if (name.length > 120) {
      return { status: 400, payload: { error: "Patient name is too long" } };
    }

    if (name !== existing.patient_name) {
      before.patient_name = existing.patient_name;
      patch.patient_name = name;
    }
  }

  if (body.patientPhone !== undefined) {
    // The bot finds a patient by this number, so a malformed one silently
    // detaches the appointment from its reminders.
    const phone = body.patientPhone.replace(/\D/g, "");

    if (phone.length < 10 || phone.length > 15) {
      return {
        status: 400,
        payload: { error: "Enter the patient's WhatsApp number including country code" }
      };
    }

    if (phone !== existing.patient_phone) {
      before.patient_phone = existing.patient_phone;
      patch.patient_phone = phone;
    }
  }

  if (body.notes !== undefined) {
    const notes = body.notes.trim();

    if (notes.length > 500) {
      return { status: 400, payload: { error: "Notes are too long" } };
    }

    if ((notes || null) !== existing.notes) {
      before.notes = existing.notes;
      patch.notes = notes || null;
    }
  }

  // The service decides whether a doctor is needed at all, so resolve it before
  // deciding what to do about the doctor.
  let service = null;

  if (body.serviceTypeId !== undefined && body.serviceTypeId !== existing.service_type_id) {
    service = await getServiceById(supabase, clinicId, body.serviceTypeId);

    if (!service) {
      return { status: 400, payload: { error: "That service is not offered at this clinic" } };
    }

    before.service_type_id = existing.service_type_id;
    patch.service_type_id = service.serviceTypeId;
    patch.duration_minutes = service.durationMinutes;
  } else {
    service = await getServiceById(supabase, clinicId, existing.service_type_id);
  }

  const needsDoctor = service ? service.requiresDoctor : true;
  const doctorId = body.doctorId === undefined ? existing.doctor_id : body.doctorId || null;

  if (needsDoctor && !doctorId) {
    return { status: 400, payload: { error: "This service needs a doctor" } };
  }

  if (doctorId !== existing.doctor_id) {
    if (doctorId) {
      const { data: doctor } = await supabase
        .from("doctors")
        .select("id, is_active")
        .eq("id", doctorId)
        .eq("clinic_id", clinicId)
        .maybeSingle();

      if (!doctor) {
        return { status: 400, payload: { error: "Doctor not found at this clinic" } };
      }

      if (doctor.is_active === false) {
        return { status: 400, payload: { error: "That doctor is no longer active" } };
      }

      // Hours, leave and existing bookings all matter, so ask for the same free
      // slots the booking flow would offer rather than only checking for a clash.
      const free = await listAvailableSlots(
        supabase,
        clinicId,
        doctorId,
        existing.appointment_date
      );
      const wanted = String(existing.appointment_time).slice(0, 5);

      if (!free.some((slot) => String(slot).slice(0, 5) === wanted)) {
        return {
          status: 409,
          payload: {
            error: `That doctor is not free at ${wanted} on ${existing.appointment_date}. Move the appointment first.`
          }
        };
      }
    }

    before.doctor_id = existing.doctor_id;
    patch.doctor_id = doctorId;
  }

  if (Object.keys(patch).length === 0) {
    return { status: 400, payload: { error: "Nothing to change" } };
  }

  patch.updated_at = new Date().toISOString();

  const { error } = await supabase
    .from("appointments")
    .update(patch)
    .eq("id", body.id)
    .eq("clinic_id", clinicId);

  if (error) {
    return { status: 500, payload: { error: `Failed to update appointment: ${error.message}` } };
  }

  await recordAuditEvent(
    supabase,
    "appointment_edited",
    actor,
    "appointment",
    String(body.id),
    before,
    patch
  );

  return { status: 200, payload: { id: body.id, changed: Object.keys(before) } };
}

/**
 * Main handler
 */
async function handleRequest(user: TokenPayload, req: Request): Promise<Response> {
  try {
    // A clinic owner runs the front desk too. A platform ADMIN is allowed but
    // must name the clinic, since they have none of their own.
    if (
      user.role !== "RECEPTIONIST" &&
      user.role !== "CLINIC_OWNER" &&
      user.role !== "ADMIN"
    ) {
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
    const url = new URL(req.url);

    const clinicId = resolveClinicId(user, url.searchParams.get("clinicId"));

    if (!clinicId) {
      return badRequestResponse("clinicId is required");
    }

    const actor = `${user.role.toLowerCase()}:${user.email}`;

    // Handle GET (list appointments)
    if (req.method === "GET") {
      const dateParam = url.searchParams.get("date");
      const statusParam = url.searchParams.get("status");
      const resource = url.searchParams.get("resource");

      // Booking a walk-in needs the clinic's doctors and their free slots,
      // neither of which a receptionist can reach through the staff endpoint.
      if (resource === "doctors") {
        const { data, error } = await supabase
          .from("doctors")
          .select("id, name, specialization, availability_status")
          .eq("clinic_id", clinicId)
          .eq("is_active", true)
          .order("name", { ascending: true });

        if (error) {
          debug("receptionistAppointments", "Doctor list failed", { error: error.message });
          return errorResponse("Failed to list doctors", 500);
        }

        return successResponse({ doctors: data ?? [] });
      }

      // Correcting a booking may mean changing what it is for, and the services
      // endpoint is owner-only.
      if (resource === "services") {
        const services = await getEnabledServices(supabase, clinicId);

        return successResponse({
          services: services.map((s) => ({
            serviceTypeId: s.serviceTypeId,
            name: s.name,
            requiresDoctor: s.requiresDoctor
          }))
        });
      }

      if (resource === "slots") {
        const doctorId = url.searchParams.get("doctorId");

        if (!doctorId || !dateParam) {
          return badRequestResponse("doctorId and date are required");
        }

        const slots = await listAvailableSlots(supabase, clinicId, doctorId, dateParam);

        return successResponse({ doctorId, date: dateParam, slots });
      }

      // Falling back to the server's date shows a clinic ahead of UTC the wrong
      // day's list every evening.
      const listDate =
        dateParam || todayInTimezone(await getClinicTimezone(supabase, clinicId));

      const appointments = await listAppointments(
        supabase,
        clinicId,
        listDate,
        statusParam || undefined
      );

      if (appointments === null) {
        return errorResponse("Failed to fetch appointments", 500);
      }

      debug("receptionistAppointments", "Appointments listed", {
        clinicId,
        count: appointments.length,
        date: listDate
      });

      return successResponse({
        appointments,
        total: appointments.length,
        date: listDate
      });
    }

    // Handle PATCH (complete, no-show, cancel, reschedule)
    if (req.method === "PATCH") {
      const body = await req.json().catch(() => null);

      if (!body) {
        return badRequestResponse("Invalid JSON body");
      }

      const result = await updateAppointment(supabase, clinicId, actor, body);

      return new Response(JSON.stringify(result.payload), {
        status: result.status,
        headers: { "Content-Type": "application/json" }
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

      const result = await createAppointment(supabase, clinicId, validation.data!);

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
  if (!["GET", "POST", "PATCH"].includes(req.method)) {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { "Content-Type": "application/json" } }
    );
  }

  return withAuth(req, ["RECEPTIONIST", "CLINIC_OWNER", "ADMIN"], (user) => handleRequest(user, req));
}));
