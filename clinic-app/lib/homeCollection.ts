import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Ports the relevant parts of src/Model_HomeCollection.gs. Status starts
 * at the table's default ("Requested") — a staff member follows up by
 * phone to confirm the exact visit time, same "simple request, not a
 * bookable slot" design the Apps Script version used.
 */

export type HomeCollectionRequest =
  Database["public"]["Tables"]["home_collection_requests"]["Row"];

export interface CreateHomeCollectionRequestParams {
  phone: string;
  patientName: string;
  latitude: number;
  longitude: number;
  distanceKm: number;
  preferredDate: string; // "YYYY-MM-DD"
  timeWindow: string;
}

function generateRequestCode(): string {
  return "HC" + randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
}

export async function createHomeCollectionRequest(
  supabase: SupabaseClient<Database>,
  params: CreateHomeCollectionRequestParams
): Promise<HomeCollectionRequest> {
  const { data, error } = await supabase
    .from("home_collection_requests")
    .insert({
      request_code: generateRequestCode(),
      phone: params.phone,
      patient_name: params.patientName,
      latitude: params.latitude,
      longitude: params.longitude,
      distance_km: params.distanceKm,
      preferred_date: params.preferredDate,
      time_window: params.timeWindow
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create home collection request: ${error.message}`);
  }

  return data;
}

/**
 * Every status a staff member can move a request through, in the order
 * they'd naturally progress — no enum in the schema (unlike
 * appointment_status), since this is a much simpler "someone calls the
 * patient back" workflow than the booking system's, not worth a
 * migration to formalize until it needs to be.
 */
export const HOME_COLLECTION_STATUSES = [
  "Requested",
  "Contacted",
  "Completed",
  "Cancelled"
] as const;

export type HomeCollectionStatus = (typeof HOME_COLLECTION_STATUSES)[number];

export async function listHomeCollectionRequests(
  supabase: SupabaseClient<Database>,
  options: { status?: string } = {}
): Promise<HomeCollectionRequest[]> {
  let query = supabase
    .from("home_collection_requests")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  if (options.status) {
    query = query.eq("status", options.status);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to list home collection requests: ${error.message}`);
  }

  return data;
}

export async function updateHomeCollectionStatus(
  supabase: SupabaseClient<Database>,
  requestId: string,
  status: HomeCollectionStatus
): Promise<void> {
  const { error } = await supabase
    .from("home_collection_requests")
    .update({ status })
    .eq("id", requestId);

  if (error) {
    throw new Error(`Failed to update home collection request status: ${error.message}`);
  }
}
