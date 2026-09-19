/**
 * Send a patient their report or prescription, and see what has been sent.
 *
 * GET  /patient-documents?appointmentId=…   what this visit has been sent
 * GET  /patient-documents?phone=…           everything this patient has been sent
 * POST /patient-documents                   multipart upload, then send
 *
 * The upload is multipart rather than JSON because a scanned report base64s to
 * a third larger, and the edge runtime has to hold the whole body in memory.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  withAuth,
  successResponse,
  errorResponse,
  badRequestResponse,
  forbiddenResponse
} from "../shared/auth-middleware.ts";
import { TokenPayload } from "../shared/jwt-auth.ts";
import { ownedAppointmentIds } from "../shared/document-access.ts";
import { withCors } from "../shared/cors.ts";
import { debug, recordAuditEvent } from "../shared/logger.ts";
import {
  ALLOWED_TYPES,
  MAX_BYTES,
  isDocumentKind,
  storeAndSendDocument
} from "../shared/patient-documents.ts";

function resolveClinicId(user: TokenPayload, requested?: string | null): string | null {
  if (user.role === "ADMIN") {
    return requested || null;
  }

  return user.clinicId ?? null;
}

async function list(
  supabase: SupabaseClient,
  clinicId: string,
  appointmentId: string | null,
  phone: string | null,
  user: TokenPayload
): Promise<Response> {
  let query = supabase
    .from("patient_documents")
    .select("id, appointment_id, patient_phone, patient_name, kind, file_name, status, error_message, sent_at, created_at, size_bytes")
    .eq("clinic_id", clinicId);

  if (appointmentId) {
    query = query.eq("appointment_id", appointmentId);
  } else if (phone) {
    query = query.eq("patient_phone", phone.replace(/\D/g, ""));
  }

  // Clinic scope alone let any doctor read another doctor's patient's reports
  // by passing their number. The front desk keeps the whole clinic's view.
  if (user.role === "DOCTOR") {
    const ids = await ownedAppointmentIds(supabase, clinicId, user.userId, {
      appointmentId,
      phone
    });

    if (ids === null) {
      debug("patientDocuments", "Ownership lookup failed", { clinicId });
      return errorResponse("Failed to list documents", 500);
    }

    if (ids.length === 0) {
      return successResponse({ documents: [] });
    }

    query = query.in("appointment_id", ids);
  }

  const { data, error } = await query.order("created_at", { ascending: false }).limit(50);

  if (error) {
    debug("patientDocuments", "List failed", { error: error.message, clinicId });
    return errorResponse("Failed to list documents", 500);
  }

  return successResponse({ documents: data ?? [] });
}

async function upload(
  supabase: SupabaseClient,
  clinicId: string,
  user: TokenPayload,
  req: Request
): Promise<Response> {
  let form: FormData;

  try {
    form = await req.formData();
  } catch {
    return badRequestResponse("Send the file as multipart/form-data");
  }

  const file = form.get("file");

  if (!(file instanceof File) || file.size === 0) {
    return badRequestResponse("Attach a file");
  }

  if (file.size > MAX_BYTES) {
    return badRequestResponse(
      `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_BYTES / 1024 / 1024} MB.`
    );
  }

  const contentType = file.type || "application/octet-stream";

  if (!(contentType in ALLOWED_TYPES)) {
    return badRequestResponse("Only PDF, JPEG and PNG files can be sent");
  }

  const kindRaw = String(form.get("kind") ?? "REPORT");

  if (!isDocumentKind(kindRaw)) {
    return badRequestResponse("kind must be REPORT, PRESCRIPTION, INVOICE or OTHER");
  }

  const appointmentId = String(form.get("appointmentId") ?? "").trim() || null;
  let phone = String(form.get("patientPhone") ?? "").replace(/\D/g, "");
  let patientName = String(form.get("patientName") ?? "").trim() || null;

  // Naming an appointment is the normal path, and the patient is read from it
  // rather than from the request: a document must not be addressable to an
  // arbitrary number by editing the form.
  if (appointmentId) {
    const { data: appointment } = await supabase
      .from("appointments")
      .select("id, patient_phone, patient_name")
      .eq("id", appointmentId)
      .eq("clinic_id", clinicId)
      .maybeSingle();

    if (!appointment) {
      return badRequestResponse("Appointment not found at this clinic");
    }

    phone = String(appointment.patient_phone ?? "").replace(/\D/g, "");
    patientName = appointment.patient_name ?? patientName;
  }

  if (phone.length < 10 || phone.length > 15) {
    return badRequestResponse("A valid patient number is required");
  }

  const result = await storeAndSendDocument(supabase, {
    clinicId,
    patientPhone: phone,
    patientName,
    appointmentId,
    kind: kindRaw,
    fileName: file.name,
    contentType,
    bytes: new Uint8Array(await file.arrayBuffer()),
    uploadedBy: `${user.role.toLowerCase()}:${user.email}`,
    note: String(form.get("note") ?? "")
  });

  if (!result.ok) {
    return errorResponse(result.error, 500);
  }

  await recordAuditEvent(
    supabase,
    "patient_document_sent",
    `${user.role.toLowerCase()}:${user.email}`,
    "patient_documents",
    result.id,
    undefined,
    { kind: kindRaw, status: result.status, appointmentId }
  );

  debug("patientDocuments", "Document handled", { clinicId, status: result.status });

  // A stored but undelivered document is not an error the caller should retry
  // blindly, so it comes back 200 with the reason attached.
  return successResponse({
    id: result.id,
    status: result.status,
    error: result.error
  });
}

async function handleRequest(user: TokenPayload, req: Request): Promise<Response> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseKey) {
    return errorResponse("Server configuration error", 500);
  }

  const url = new URL(req.url);
  const clinicId = resolveClinicId(user, url.searchParams.get("clinicId"));

  if (!clinicId) {
    return badRequestResponse("clinicId is required");
  }

  if (user.role === "CLINIC_OWNER" && url.searchParams.get("clinicId")
      && url.searchParams.get("clinicId") !== user.clinicId) {
    return forbiddenResponse("You can only manage documents at your own clinic");
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  if (req.method === "GET") {
    return await list(
      supabase,
      clinicId,
      url.searchParams.get("appointmentId"),
      url.searchParams.get("phone"),
      user
    );
  }

  return await upload(supabase, clinicId, user, req);
}

Deno.serve(withCors(async (req: Request) => {
  if (!["GET", "POST"].includes(req.method)) {
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
