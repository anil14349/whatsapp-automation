/**
 * What a service really offers today, asked of the live database.
 *
 * Run: deno run --allow-env --allow-net --allow-read scripts/check-service-slots.ts [clinicId] [YYYY-MM-DD]
 *
 * Defaults to DEFAULT_CLINIC_ID from .env.local, which is the clinic the rest
 * of the local tooling talks to.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getEnabledServices } from "../supabase/functions/shared/clinic-services.ts";
import {
    getClinicServiceSlots,
    getClinicTimezone,
    todayInTimezone
} from "../supabase/functions/shared/clinic-slots.ts";

const env: Record<string, string> = {};

for (const line of (await Deno.readTextFile(".env.local")).split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (match) env[match[1]] = match[2].replace(/^"|"$/g, "");
}

// A bare date is the common case, so it is accepted in either position.
const args = Deno.args.filter(Boolean);
const dateArg = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
const clinicArg = args.find((a) => a !== dateArg);

const CLINIC = clinicArg ?? env.DEFAULT_CLINIC_ID ?? (await onlyClinic());

// DEFAULT_CLINIC_ID lives in clinic-app/.env.local, not the one this reads, so
// a single-clinic project would otherwise be made to paste its own uuid.
async function onlyClinic(): Promise<string | null> {
    const { data } = await createClient(env.SU_URL, env.SU_SERVICE_ROLE_KEY)
        .from("clinics")
        .select("id, name");

    if (!data || data.length === 0) return null;

    if (data.length > 1) {
        console.error("Several clinics here, name one:");
        for (const c of data) console.error(`  ${c.id}  ${c.name}`);
        return null;
    }

    return data[0].id;
}

if (!CLINIC) {
    console.error("\nUsage: check-service-slots.ts [clinicId] [YYYY-MM-DD]");
    Deno.exit(1);
}

const supabase = createClient(env.SU_URL, env.SU_SERVICE_ROLE_KEY);

// Asking in the server's zone would report the wrong day for half of each
// evening, which is the bug this script exists to find.
const timezone = await getClinicTimezone(supabase, CLINIC);
const date = dateArg ?? todayInTimezone(timezone);
const services = await getEnabledServices(supabase, CLINIC, "home");

console.log(`home services on ${date} (${timezone}), clock now ${new Date().toISOString()}\n`);

for (const service of services) {
    if (service.requiresDoctor) continue;

    const slots = await getClinicServiceSlots(supabase, CLINIC, service, date);

    console.log(
        `${service.name}: notice ${service.minNoticeHours}h, ` +
            `${slots.length} slots` +
            (slots.length ? `, first ${slots[0]}, last ${slots[slots.length - 1]}` : "")
    );
}
