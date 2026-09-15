/**
 * Staff provisioning.
 *
 * Creating a doctor, receptionist or sample collector previously meant writing
 * SQL by hand, which made onboarding a clinic a manual database exercise.
 *
 * GET    /staff?type=doctor|receptionist|collector   list staff for the clinic
 * POST   /staff                                      create a staff member
 * PATCH  /staff                                      activate/deactivate
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { TokenPayload } from "../shared/jwt-auth.ts";
import {
  withAuth,
  badRequestResponse,
  forbiddenResponse,
  errorResponse,
  successResponse
} from "../shared/auth-middleware.ts";
import { debug } from "../shared/logger.ts";
import { hashPassword, validatePinStrength, validatePasswordStrength } from "../shared/bcrypt-password.ts";
import { sendStaffInviteEmail } from "../shared/email.ts";
import { sendCredentialOverWhatsApp } from "../shared/credential-delivery.ts";
import { withCors } from "../shared/cors.ts";

type StaffType = "doctor" | "receptionist" | "collector";

interface CreateStaffRequest {
  type: StaffType;
  name: string;
  clinicId?: string;
  email?: string;
  phone?: string;
  specialization?: string;
  maxCollectionsPerDay?: number;
  /** Optional initial credential; generated when omitted. */
  pin?: string;
  password?: string;
}

interface UpdateStaffRequest {
  type: StaffType;
  id: string;
  clinicId?: string;
  isActive?: boolean;
  action?: "resetCredential";
  pin?: string;
  password?: string;
}

const TABLES: Record<StaffType, string> = {
  doctor: "doctors",
  receptionist: "receptionists",
  collector: "sample_collectors"
};

function isStaffType(value: unknown): value is StaffType {
  return value === "doctor" || value === "receptionist" || value === "collector";
}

/**
 * The clinic this request may touch.
 *
 * A CLINIC_OWNER is pinned to their own clinic regardless of what they send;
 * only a platform ADMIN may name one.
 */
function resolveClinicId(user: TokenPayload, requested?: string): string | null {
  if (user.role === "ADMIN") {
    return requested ?? null;
  }

  return user.clinicId ?? null;
}

function randomDigits(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => String(b % 10)).join("");
}

/** A PIN that passes validatePinStrength rather than one that merely looks random. */
function generatePin(): string {
  for (let attempt = 0; attempt < 20; attempt++) {
    const pin = randomDigits(6);

    if (validatePinStrength(pin).valid) {
      return pin;
    }
  }

  return "417293";
}

function generatePassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%^&*";
  const all = upper + lower + digits + symbols;

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  // Guarantee one of each class so validatePasswordStrength always passes.
  const required = [
    upper[bytes[0] % upper.length],
    lower[bytes[1] % lower.length],
    digits[bytes[2] % digits.length],
    symbols[bytes[3] % symbols.length]
  ];

  const rest = Array.from(bytes.slice(4), (b) => all[b % all.length]);

  return [...required, ...rest].join("");
}

interface DeliveryOutcome {
  sent: boolean;
  channel?: "whatsapp" | "email";
  reason?: string;
}

/**
 * Try WhatsApp, then email. Returning the credential to the admin is the last
 * resort, handled by the caller.
 */
async function deliverCredential(
  supabase: SupabaseClient,
  clinicId: string,
  staff: { name: string; phone?: string | null; email?: string | null },
  credential: string,
  kind: "PIN" | "password",
  clinicName: string
): Promise<DeliveryOutcome> {
  const viaWhatsApp = await sendCredentialOverWhatsApp(
    supabase,
    clinicId,
    staff.phone,
    staff.name,
    credential,
    kind
  );

  if (viaWhatsApp.delivered) {
    return { sent: true, channel: "whatsapp" };
  }

  if (staff.email) {
    const viaEmail = await sendStaffInviteEmail(
      staff.email,
      staff.name,
      kind === "PIN" ? "doctor" : "receptionist",
      credential,
      clinicName
    );

    if (viaEmail.sent) {
      return { sent: true, channel: "email" };
    }

    return { sent: false, reason: `whatsapp:${viaWhatsApp.reason}, email:${viaEmail.error}` };
  }

  return { sent: false, reason: `whatsapp:${viaWhatsApp.reason}, email:no_email` };
}

async function listStaff(
  supabase: SupabaseClient,
  clinicId: string,
  type: StaffType
) {
  const columns: Record<StaffType, string> = {
    doctor: "id, name, phone, email, specialization, is_active, availability_status",
    receptionist: "id, name, phone, email, status",
    collector: "id, name, phone, email, is_active, max_collections_per_day"
  };

  const { data, error } = await supabase
    .from(TABLES[type])
    .select(columns[type])
    .eq("clinic_id", clinicId)
    .order("name", { ascending: true });

  if (error) {
    debug("staff", "List failed", { error: error.message, type });
    return null;
  }

  return data;
}

async function createStaff(
  supabase: SupabaseClient,
  clinicId: string,
  body: CreateStaffRequest
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const name = body.name?.trim();

  if (!name) {
    return { status: 400, payload: { error: "name is required" } };
  }

  const email = body.email?.trim().toLowerCase();
  const phone = body.phone?.trim();

  const { data: clinic } = await supabase
    .from("clinics")
    .select("name")
    .eq("id", clinicId)
    .maybeSingle();

  if (!clinic) {
    return { status: 400, payload: { error: "Unknown clinic" } };
  }

  if (body.type === "doctor") {
    if (!phone) {
      return { status: 400, payload: { error: "phone is required for a doctor" } };
    }

    const pin = body.pin?.trim() || generatePin();
    const strength = validatePinStrength(pin);

    if (!strength.valid) {
      return { status: 400, payload: { error: `Invalid PIN: ${strength.errors.join(", ")}` } };
    }

    const { data, error } = await supabase
      .from("doctors")
      .insert({
        clinic_id: clinicId,
        name,
        phone,
        email: email ?? null,
        specialization: body.specialization ?? null,
        is_active: true,
        availability_status: "AVAILABLE",
        pin_hash: await hashPassword(pin)
      })
      .select("id, name, phone, email, specialization")
      .single();

    if (error) {
      return {
        status: error.code === "23505" ? 409 : 500,
        payload: { error: `Failed to create doctor: ${error.message}` }
      };
    }

    // WhatsApp first: it is the channel the doctor already uses, and needs no
    // mail infrastructure. Email is the fallback when the 24 hour window is
    // closed or no number reached them.
    const delivered = await deliverCredential(
      supabase,
      clinicId,
      { name, phone, email },
      pin,
      "PIN",
      clinic.name
    );

    return {
      status: 201,
      payload: {
        staff: data,
        // Returned only when it could not be delivered, so the admin can pass it on.
        temporaryPin: delivered.sent ? undefined : pin,
        deliveredBy: delivered.channel,
        deliveryError: delivered.reason
      }
    };
  }

  if (body.type === "receptionist") {
    if (!email) {
      return { status: 400, payload: { error: "email is required for a receptionist" } };
    }

    const password = body.password?.trim() || generatePassword();
    const strength = validatePasswordStrength(password);

    if (!strength.valid) {
      return {
        status: 400,
        payload: { error: `Invalid password: ${strength.errors.join(", ")}` }
      };
    }

    const { data, error } = await supabase
      .from("receptionists")
      .insert({
        clinic_id: clinicId,
        name,
        email,
        phone: phone ?? null,
        status: "ACTIVE",
        password_hash: await hashPassword(password)
      })
      .select("id, name, phone, email, status")
      .single();

    if (error) {
      return {
        status: error.code === "23505" ? 409 : 500,
        payload: { error: `Failed to create receptionist: ${error.message}` }
      };
    }

    const delivered = await deliverCredential(
      supabase,
      clinicId,
      { name, phone, email },
      password,
      "password",
      clinic.name
    );

    return {
      status: 201,
      payload: {
        staff: data,
        temporaryPassword: delivered.sent ? undefined : password,
        deliveredBy: delivered.channel,
        deliveryError: delivered.reason
      }
    };
  }

  if (!phone) {
    return { status: 400, payload: { error: "phone is required for a collector" } };
  }

  const { data, error } = await supabase
    .from("sample_collectors")
    .insert({
      clinic_id: clinicId,
      name,
      phone,
      email: email ?? null,
      is_active: true,
      max_collections_per_day: body.maxCollectionsPerDay ?? 8
    })
    .select("id, name, phone, email, max_collections_per_day")
    .single();

  if (error) {
    return {
      status: error.code === "23505" ? 409 : 500,
      payload: { error: `Failed to create collector: ${error.message}` }
    };
  }

  return { status: 201, payload: { staff: data } };
}

/**
 * Issue a fresh credential for an existing staff member.
 *
 * Doctors created before per-doctor PINs have no hash at all, and with the
 * shared PIN disabled this is the only way back in.
 */
async function resetStaffCredential(
  supabase: SupabaseClient,
  clinicId: string,
  body: UpdateStaffRequest
): Promise<{ status: number; payload: Record<string, unknown> }> {
  if (!body.id) {
    return { status: 400, payload: { error: "id is required" } };
  }

  if (body.type === "collector") {
    return { status: 400, payload: { error: "Collectors do not have portal credentials" } };
  }

  const { data: clinic } = await supabase
    .from("clinics")
    .select("name")
    .eq("id", clinicId)
    .maybeSingle();

  if (body.type === "doctor") {
    const pin = body.pin?.trim() || generatePin();
    const strength = validatePinStrength(pin);

    if (!strength.valid) {
      return { status: 400, payload: { error: `Invalid PIN: ${strength.errors.join(", ")}` } };
    }

    const { data, error } = await supabase
      .from("doctors")
      .update({ pin_hash: await hashPassword(pin), updated_at: new Date().toISOString() })
      .eq("id", body.id)
      .eq("clinic_id", clinicId)
      .select("id, name, email, phone")
      .maybeSingle();

    if (error) {
      return { status: 500, payload: { error: `Failed to reset PIN: ${error.message}` } };
    }

    if (!data) {
      return { status: 404, payload: { error: "Staff member not found at this clinic" } };
    }

    const delivered = await deliverCredential(
      supabase,
      clinicId,
      { name: data.name, phone: data.phone, email: data.email },
      pin,
      "PIN",
      clinic?.name ?? "your clinic"
    );

    return {
      status: 200,
      payload: {
        id: data.id,
        temporaryPin: delivered.sent ? undefined : pin,
        deliveredBy: delivered.channel,
        deliveryError: delivered.reason
      }
    };
  }

  const password = body.password?.trim() || generatePassword();
  const strength = validatePasswordStrength(password);

  if (!strength.valid) {
    return { status: 400, payload: { error: `Invalid password: ${strength.errors.join(", ")}` } };
  }

  const { data, error } = await supabase
    .from("receptionists")
    .update({ password_hash: await hashPassword(password), updated_at: new Date().toISOString() })
    .eq("id", body.id)
    .eq("clinic_id", clinicId)
    .select("id, name, email, phone")
    .maybeSingle();

  if (error) {
    return { status: 500, payload: { error: `Failed to reset password: ${error.message}` } };
  }

  if (!data) {
    return { status: 404, payload: { error: "Staff member not found at this clinic" } };
  }

  const delivered = await deliverCredential(
    supabase,
    clinicId,
    { name: data.name, phone: data.phone, email: data.email },
    password,
    "password",
    clinic?.name ?? "your clinic"
  );

  return {
    status: 200,
    payload: {
      id: data.id,
      temporaryPassword: delivered.sent ? undefined : password,
      deliveredBy: delivered.channel,
      deliveryError: delivered.reason
    }
  };
}

async function setStaffActive(
  supabase: SupabaseClient,
  clinicId: string,
  body: UpdateStaffRequest
): Promise<{ status: number; payload: Record<string, unknown> }> {
  if (!body.id) {
    return { status: 400, payload: { error: "id is required" } };
  }

  // Never infer this: a missing flag would silently deactivate the person.
  if (typeof body.isActive !== "boolean") {
    return { status: 400, payload: { error: "isActive must be true or false" } };
  }

  const patch = body.type === "receptionist"
    ? { status: body.isActive ? "ACTIVE" : "INACTIVE" }
    : { is_active: body.isActive };

  const { data, error } = await supabase
    .from(TABLES[body.type])
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", body.id)
    .eq("clinic_id", clinicId)
    .select("id")
    .maybeSingle();

  if (error) {
    return { status: 500, payload: { error: `Failed to update staff: ${error.message}` } };
  }

  if (!data) {
    return { status: 404, payload: { error: "Staff member not found at this clinic" } };
  }

  return { status: 200, payload: { id: data.id, isActive: body.isActive } };
}

async function handleRequest(user: TokenPayload, req: Request): Promise<Response> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseKey) {
    return errorResponse("Server configuration error", 500);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  if (req.method === "GET") {
    const url = new URL(req.url);
    const type = url.searchParams.get("type") ?? "doctor";
    const clinicId = resolveClinicId(user, url.searchParams.get("clinicId") ?? undefined);

    if (!isStaffType(type)) {
      return badRequestResponse("type must be doctor, receptionist or collector");
    }

    if (!clinicId) {
      return badRequestResponse("clinicId is required");
    }

    const staff = await listStaff(supabase, clinicId, type);

    if (staff === null) {
      return errorResponse("Failed to list staff", 500);
    }

    return successResponse({ type, clinicId, staff, total: staff.length });
  }

  const body = await req.json().catch(() => null);

  if (!body || !isStaffType(body.type)) {
    return badRequestResponse("type must be doctor, receptionist or collector");
  }

  const clinicId = resolveClinicId(user, body.clinicId);

  if (!clinicId) {
    return badRequestResponse("clinicId is required");
  }

  // A clinic owner naming someone else's clinic is a tenant breach, not a typo.
  if (user.role === "CLINIC_OWNER" && body.clinicId && body.clinicId !== user.clinicId) {
    return forbiddenResponse("You can only manage staff at your own clinic");
  }

  const result = req.method === "POST"
    ? await createStaff(supabase, clinicId, body as CreateStaffRequest)
    : (body as UpdateStaffRequest).action === "resetCredential"
      ? await resetStaffCredential(supabase, clinicId, body as UpdateStaffRequest)
      : await setStaffActive(supabase, clinicId, body as UpdateStaffRequest);

  debug("staff", `${req.method} ${body.type}`, {
    clinicId,
    actor: user.userId,
    status: result.status
  });

  return new Response(JSON.stringify(result.payload), {
    status: result.status,
    headers: { "Content-Type": "application/json" }
  });
}

Deno.serve(withCors(async (req: Request) => {
  if (!["GET", "POST", "PATCH"].includes(req.method)) {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { "Content-Type": "application/json" } }
    );
  }

  return withAuth(req, ["ADMIN", "CLINIC_OWNER"], (user) => handleRequest(user, req));
}));
