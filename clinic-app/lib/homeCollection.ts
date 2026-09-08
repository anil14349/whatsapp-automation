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
