/**
 * Which days the clinic will actually offer, asked of the live database.
 *
 * Run: deno run --allow-env --allow-net --allow-read scripts/check-open-days.ts [clinicId]
 *
 * The patient's date list is built from getOpenDays, so this shows exactly
 * what a patient would be offered, and what is being held back and why.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
    addDays,
    getClinicClosure,
    getClinicTimezone,
    getOpenDays,
    todayInTimezone
} from "../supabase/functions/shared/clinic-slots.ts";

const env: Record<string, string> = {};

for (const line of (await Deno.readTextFile(".env.local")).split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (match) env[match[1]] = match[2].replace(/^"|"$/g, "");
}

const supabase = createClient(env.SU_URL, env.SU_SERVICE_ROLE_KEY);
const clinic = Deno.args[0] ?? env.DEFAULT_CLINIC_ID ?? (await onlyClinic());

async function onlyClinic(): Promise<string> {
    const { data } = await supabase.from("clinics").select("id, name");

    if (!data || data.length !== 1) {
        console.error("Pass a clinic id: this project has none or more than one.");
        Deno.exit(1);
    }

    console.log(`Clinic: ${data[0].name}\n`);
    return data[0].id as string;
}

const timezone = await getClinicTimezone(supabase, clinic);
const today = todayInTimezone(timezone);
const dates = Array.from({ length: 8 }, (_, i) => addDays(today, i));
const open = new Set(await getOpenDays(supabase, clinic, dates));

console.log(`Today in ${timezone}: ${today}\n`);

for (const date of dates) {
    const weekday = new Intl.DateTimeFormat("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
        timeZone: "UTC"
    }).format(new Date(`${date}T00:00:00Z`));

    if (open.has(date)) {
        console.log(`  offered   ${date}  ${weekday}`);
        continue;
    }

    const closure = await getClinicClosure(supabase, clinic, date);
    const why = closure?.reason === "holiday" ? `holiday: ${closure.name}` : "not an opening day";

    console.log(`  held back ${date}  ${weekday}  (${why})`);
}

console.log(`\n${open.size} of ${dates.length} days would be offered.`);
