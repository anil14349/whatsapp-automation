import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/lib/env";
import type { Database } from "./database.types";

let client: SupabaseClient<Database> | null = null;

/**
 * Server-only Supabase client using the SERVICE ROLE key — bypasses Row
 * Level Security. Never import this from a "use client" component or
 * expose its result to the browser. Every API route / server action that
 * needs the database goes through this single instance.
 */
export function getSupabaseServerClient(): SupabaseClient<Database> {
  if (client) {
    return client;
  }

  const env = getServerEnv();

  client = createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    }
  );

  return client;
}
