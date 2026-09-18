/**
 * What a service really offers today, asked of the live database.
 *
 * Run: deno run --allow-env --allow-net --allow-read scripts/check-service-slots.ts [YYYY-MM-DD]
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getEnabledServices } from "../supabase/functions/shared/clinic-services.ts";
import { getClinicServiceSlots, todayInTimezone } from "../supabase/functions/shared/clinic-slots.ts";

const CLINIC = "402ae46c-56ed-40b0-a4b0-df63d6b43acc";

const env: Record<string, string> = {};

for (const line of (await Deno.readTextFile(".env.local")).split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (match) env[match[1]] = match[2].replace(/^"|"$/g, "");
}

const supabase = createClient(env.SU_URL, env.SU_SERVICE_ROLE_KEY);
const date = Deno.args[0] ?? todayInTimezone("Asia/Kolkata");
const services = await getEnabledServices(supabase, CLINIC, "home");

console.log(`home services on ${date}, clock now ${new Date().toISOString()}\n`);

for (const service of services) {
    if (service.requiresDoctor) continue;

    const slots = await getClinicServiceSlots(supabase, CLINIC, service, date);

    console.log(
        `${service.name}: notice ${service.minNoticeHours}h, ` +
            `${slots.length} slots` +
            (slots.length ? `, first ${slots[0]}, last ${slots[slots.length - 1]}` : "")
    );
}
