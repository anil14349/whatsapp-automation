/**
 * How the clinic is doing, for the people who own it.
 *
 * GET /clinic-summary?range=today|week|month
 * GET /clinic-summary?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Deliberately not open to the front desk: this is the clinic's own trading
 * position, not the day's work.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  withAuth,
  successResponse,
  errorResponse,
  badRequestResponse
} from "../shared/auth-middleware.ts";
import { TokenPayload } from "../shared/jwt-auth.ts";
import { withCors } from "../shared/cors.ts";
import { addDays, getClinicTimezone, todayInTimezone } from "../shared/clinic-slots.ts";
import { buildSummary } from "../shared/summary.ts";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The longest period worth offering; beyond it the counts stop being a summary. */
const MAX_DAYS = 366;

function resolveClinicId(user: TokenPayload, requested?: string | null): string | null {
  if (user.role === "ADMIN") {
    return requested || null;
  }

  return user.clinicId ?? null;
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

  const supabase = createClient(supabaseUrl, supabaseKey);

  // The clinic's own day, not the server's: drawn in UTC, a morning's bookings
  // fall into yesterday for anywhere east of it.
  const today = todayInTimezone(await getClinicTimezone(supabase, clinicId));

  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");

  let from: string;
  let to: string;

  if (fromParam || toParam) {
    if (!DATE.test(fromParam ?? "") || !DATE.test(toParam ?? "")) {
      return badRequestResponse("from and to must both be YYYY-MM-DD");
    }

    from = fromParam as string;
    to = toParam as string;

    if (from > to) {
      return badRequestResponse("from must not be after to");
    }

    const days = Math.round(
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000
    );

    if (days > MAX_DAYS) {
      return badRequestResponse(`Choose a period of ${MAX_DAYS} days or fewer`);
    }
  } else {
    const range = url.searchParams.get("range") ?? "week";

    if (range === "today") {
      from = today;
      to = today;
    } else if (range === "month") {
      from = addDays(today, -29);
      to = today;
    } else if (range === "week") {
      from = addDays(today, -6);
      to = today;
    } else {
      return badRequestResponse("range must be today, week or month");
    }
  }

  const summary = await buildSummary(supabase, clinicId, from, to);

  if (!summary) {
    return errorResponse("Failed to build the summary", 500);
  }

  return successResponse({ summary, today });
}

Deno.serve(withCors(async (req: Request) => {
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" }
    });
  }

  return withAuth(req, ["ADMIN", "CLINIC_OWNER"], (user) => handleRequest(user, req));
}));
