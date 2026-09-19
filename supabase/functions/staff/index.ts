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
import { getClinicTimezone, todayInTimezone } from "../shared/clinic-slots.ts";

type StaffType = "doctor" | "receptionist" | "collector";

interface CreateStaffRequest {
  type: StaffType;
  name: string;
  clinicId?: string;
  email?: string;
  phone?: string;
  specialization?: string;
  qualifications?: string;
  photoUrl?: string;
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
  action?: "resetCredential" | "edit";
  pin?: string;
  password?: string;
  name?: string;
  phone?: string;
  email?: string;
  specialization?: string;
  qualifications?: string;
  photoUrl?: string;
  takesOnlineAppointments?: boolean;
  maxCollectionsPerDay?: number;
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
    doctor: "id, name, phone, email, specialization, qualifications, photo_url, is_active, availability_status, takes_online_appointments",
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
  const phone = body.phone?.trim().replace(/\D/g, "");

  const { data: clinic } = await supabase
    .from("clinics")
    .select("name")
    .eq("id", clinicId)
    .maybeSingle();

  if (!clinic) {
    return { status: 400, payload: { error: "Unknown clinic" } };
  }

  // Staff are recognised by their number, on WhatsApp and now at sign in, so
  // two people cannot share one.
  if (phone) {
    const owner = await findPhoneOwner(supabase, clinicId, phone, body.type, "");

    if (owner) {
      return { status: 409, payload: { error: `That number already belongs to ${owner}` } };
    }
  }

  if (body.type === "doctor") {
    if (!phone) {
      return { status: 400, payload: { error: "phone is required for a doctor" } };
    }

    const photoUrl = body.photoUrl?.trim() || null;

    // Reaches the browser as an img src, so anything but http(s) is a script
    // rather than a photograph.
    if (photoUrl && !/^https?:\/\//i.test(photoUrl)) {
      return { status: 400, payload: { error: "The photo address must start with http:// or https://" } };
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
        qualifications: body.qualifications?.trim().slice(0, 160) || null,
        photo_url: photoUrl,
        is_active: true,
        availability_status: "AVAILABLE",
        pin_hash: await hashPassword(pin)
      })
      .select("id, name, phone, email, specialization, qualifications, photo_url")
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
    // Either will do: one of them is what they sign in with, and one of them is
    // where the password goes.
    if (!email && !phone) {
      return {
        status: 400,
        payload: { error: "A receptionist needs an email or a WhatsApp number" }
      };
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

  const collectorPin = body.pin?.trim() || generatePin();
  const collectorStrength = validatePinStrength(collectorPin);

  if (!collectorStrength.valid) {
    return {
      status: 400,
      payload: { error: `Invalid PIN: ${collectorStrength.errors.join(", ")}` }
    };
  }

  const { data, error } = await supabase
    .from("sample_collectors")
    .insert({
      clinic_id: clinicId,
      name,
      phone,
      email: email ?? null,
      is_active: true,
      max_collections_per_day: body.maxCollectionsPerDay ?? 8,
      pin_hash: await hashPassword(collectorPin)
    })
    .select("id, name, phone, email, max_collections_per_day")
    .single();

  if (error) {
    return {
      status: error.code === "23505" ? 409 : 500,
      payload: { error: `Failed to create collector: ${error.message}` }
    };
  }

  const collectorDelivery = await deliverCredential(
    supabase,
    clinicId,
    { name, phone, email },
    collectorPin,
    "PIN",
    clinic.name
  );

  return {
    status: 201,
    payload: {
      staff: data,
      temporaryPin: collectorDelivery.sent ? undefined : collectorPin,
      deliveredBy: collectorDelivery.channel,
      deliveryError: collectorDelivery.reason
    }
  };
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

  const { data: clinic } = await supabase
    .from("clinics")
    .select("name")
    .eq("id", clinicId)
    .maybeSingle();

  // Collectors sign in on WhatsApp rather than the portal, but a PIN they have
  // forgotten still has to be replaceable without deleting the person.
  if (body.type === "collector") {
    const pin = body.pin?.trim() || generatePin();
    const strength = validatePinStrength(pin);

    if (!strength.valid) {
      return { status: 400, payload: { error: `Invalid PIN: ${strength.errors.join(", ")}` } };
    }

    const { data: collector } = await supabase
      .from("sample_collectors")
      .select("id, name, phone, email")
      .eq("id", body.id)
      .eq("clinic_id", clinicId)
      .maybeSingle();

    if (!collector) {
      return { status: 404, payload: { error: "No such collector at this clinic" } };
    }

    const { error } = await supabase
      .from("sample_collectors")
      .update({ pin_hash: await hashPassword(pin), updated_at: new Date().toISOString() })
      .eq("id", collector.id)
      .eq("clinic_id", clinicId);

    if (error) {
      return { status: 500, payload: { error: `Failed to reset the PIN: ${error.message}` } };
    }

    const delivered = await deliverCredential(
      supabase,
      clinicId,
      { name: collector.name, phone: collector.phone, email: collector.email },
      pin,
      "PIN",
      clinic?.name ?? "the clinic"
    );

    return {
      status: 200,
      payload: {
        temporaryPin: delivered.sent ? undefined : pin,
        deliveredBy: delivered.channel,
        deliveryError: delivered.reason
      }
    };
  }

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

/**
 * Correct a staff member's details.
 *
 * The phone number is how the bot decides whether an incoming message is from a
 * doctor, so letting two people share one would hand the wrong person a staff
 * menu. Checked across all three staff tables at this clinic.
 */
async function editStaff(
  supabase: SupabaseClient,
  clinicId: string,
  body: UpdateStaffRequest
): Promise<{ status: number; payload: Record<string, unknown> }> {
  if (!body.id) {
    return { status: 400, payload: { error: "id is required" } };
  }

  const { data: existing } = await supabase
    .from(TABLES[body.type])
    .select("*")
    .eq("id", body.id)
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (!existing) {
    return { status: 404, payload: { error: "Staff member not found at this clinic" } };
  }

  const patch: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const name = body.name.trim();

    if (!name) {
      return { status: 400, payload: { error: "Name cannot be empty" } };
    }

    if (name.length > 120) {
      return { status: 400, payload: { error: "Name is too long" } };
    }

    patch.name = name;
  }

  if (body.phone !== undefined) {
    const phone = body.phone.replace(/\D/g, "");

    if (!phone && body.type !== "receptionist") {
      return { status: 400, payload: { error: "A WhatsApp number is required" } };
    }

    // Mirror of the email rule below: whichever is left has to be enough to
    // sign in with, or the database refuses it and the message means nothing.
    if (!phone && body.type === "receptionist") {
      const email = body.email !== undefined ? body.email.trim() : existing.email;

      if (!email) {
        return {
          status: 400,
          payload: { error: "A receptionist needs an email or a WhatsApp number to sign in" }
        };
      }
    }

    if (phone && (phone.length < 10 || phone.length > 15)) {
      return { status: 400, payload: { error: "Enter the number including country code" } };
    }

    if (phone && phone !== existing.phone) {
      const clash = await findPhoneOwner(supabase, clinicId, phone, body.type, body.id);

      if (clash) {
        return { status: 409, payload: { error: `That number already belongs to ${clash}` } };
      }
    }

    patch.phone = phone || null;
  }

  if (body.email !== undefined) {
    const email = body.email.trim().toLowerCase();

    // They sign in with one or the other, so the last one cannot be removed.
    if (!email && body.type === "receptionist") {
      const phone = body.phone !== undefined ? body.phone.replace(/\D/g, "") : existing.phone;

      if (!phone) {
        return {
          status: 400,
          payload: { error: "A receptionist needs an email or a WhatsApp number to sign in" }
        };
      }
    }

    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return { status: 400, payload: { error: "That email does not look right" } };
    }

    patch.email = email || null;
  }

  if (body.specialization !== undefined && body.type === "doctor") {
    patch.specialization = body.specialization.trim() || null;
  }

  if (body.qualifications !== undefined && body.type === "doctor") {
    patch.qualifications = body.qualifications.trim().slice(0, 160) || null;
  }

  if (body.takesOnlineAppointments !== undefined && body.type === "doctor") {
    patch.takes_online_appointments = body.takesOnlineAppointments === true;
  }

  if (body.photoUrl !== undefined && body.type === "doctor") {
    const photo = body.photoUrl.trim();

    // Reaches the browser as an img src, so anything but http(s) is a script
    // rather than a photograph.
    if (photo && !/^https?:\/\//i.test(photo)) {
      return { status: 400, payload: { error: "The photo address must start with http:// or https://" } };
    }

    patch.photo_url = photo || null;
  }

  if (body.maxCollectionsPerDay !== undefined && body.type === "collector") {
    const max = Number(body.maxCollectionsPerDay);

    if (!Number.isInteger(max) || max < 1) {
      return { status: 400, payload: { error: "Collections per day must be at least 1" } };
    }

    patch.max_collections_per_day = max;
  }

  if (Object.keys(patch).length === 0) {
    return { status: 400, payload: { error: "Nothing to change" } };
  }

  const { error } = await supabase
    .from(TABLES[body.type])
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", body.id)
    .eq("clinic_id", clinicId);

  if (error) {
    return { status: 500, payload: { error: `Failed to update staff: ${error.message}` } };
  }

  return { status: 200, payload: { id: body.id, changed: Object.keys(patch) } };
}

/** Describes who already uses a number, or null when nobody does. */
async function findPhoneOwner(
  supabase: SupabaseClient,
  clinicId: string,
  phone: string,
  skipType: StaffType,
  skipId?: string
): Promise<string | null> {
  const labels: Record<StaffType, string> = {
    doctor: "a doctor",
    receptionist: "a receptionist",
    collector: "home visit staff"
  };

  for (const type of Object.keys(TABLES) as StaffType[]) {
    let query = supabase
      .from(TABLES[type])
      .select("id, name")
      .eq("clinic_id", clinicId)
      .eq("phone", phone);

    // Only when editing: a row is allowed to keep its own number.
    if (type === skipType && skipId) {
      query = query.neq("id", skipId);
    }

    const { data } = await query.maybeSingle();

    if (data) {
      return `${labels[type]}, ${data.name}`;
    }
  }

  return null;
}

/**
 * Remove a staff member outright.
 *
 * Refused while work still points at them, because deleting the row would
 * either break the link or silently orphan an appointment a patient is still
 * expecting. Deactivating is the answer in that case.
 */
async function deleteStaff(
  supabase: SupabaseClient,
  clinicId: string,
  type: StaffType,
  id: string
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const { data: existing } = await supabase
    .from(TABLES[type])
    .select("id, name")
    .eq("id", id)
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (!existing) {
    return { status: 404, payload: { error: "Staff member not found at this clinic" } };
  }

  const today = todayInTimezone(await getClinicTimezone(supabase, clinicId));

  if (type === "doctor") {
    const { count } = await supabase
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId)
      .eq("doctor_id", id)
      .gte("appointment_date", today)
      .neq("status", "CANCELLED");

    if (count && count > 0) {
      return {
        status: 409,
        payload: {
          error: `${existing.name} still has ${count} appointment${count === 1 ? "" : "s"} booked. Cancel or move them first, or deactivate instead.`
        }
      };
    }
  }

  if (type === "collector") {
    const { count } = await supabase
      .from("home_collection_requests")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId)
      .eq("assigned_technician_id", id)
      .gte("requested_date", today)
      .neq("status", "CANCELLED");

    if (count && count > 0) {
      return {
        status: 409,
        payload: {
          error: `${existing.name} still has ${count} collection${count === 1 ? "" : "s"} assigned. Reassign them first, or deactivate instead.`
        }
      };
    }
  }

  const { error } = await supabase
    .from(TABLES[type])
    .delete()
    .eq("id", id)
    .eq("clinic_id", clinicId);

  if (error) {
    return { status: 500, payload: { error: `Failed to remove staff: ${error.message}` } };
  }

  return { status: 200, payload: { id, removed: true, name: existing.name } };
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
    : req.method === "DELETE"
      ? await deleteStaff(supabase, clinicId, body.type, (body as UpdateStaffRequest).id)
      : (body as UpdateStaffRequest).action === "resetCredential"
        ? await resetStaffCredential(supabase, clinicId, body as UpdateStaffRequest)
        : (body as UpdateStaffRequest).action === "edit"
          ? await editStaff(supabase, clinicId, body as UpdateStaffRequest)
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
  if (!["GET", "POST", "PATCH", "DELETE"].includes(req.method)) {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { "Content-Type": "application/json" } }
    );
  }

  return withAuth(req, ["ADMIN", "CLINIC_OWNER"], (user) => handleRequest(user, req));
}));
