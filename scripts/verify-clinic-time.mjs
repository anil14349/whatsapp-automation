/**
 * "Today" must be the clinic's day, never the server's.
 *
 * Edge functions run on UTC. A clinic in Asia/Kolkata is already on tomorrow
 * from 18:30 UTC, so anything deriving a date from `new Date()` is wrong for
 * five and a half hours out of every twenty-four. That window showed a doctor
 * the previous day's list, listed a finished appointment as upcoming, and left
 * yesterday's visits open until the morning.
 *
 * It also broke eight tests on the clock rather than the code, twice.
 *
 * `todayInTimezone(await getClinicTimezone(...))` is the answer; this refuses
 * the shapes that are not.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["supabase/functions", "clinic-app/app", "clinic-app/lib"];

/** A date pulled straight off the server clock. */
const OFFENDERS = [
    {
        pattern: /new Date\(\)\s*\.toISOString\(\)\s*\.split\("T"\)\[0\]/g,
        why: 'new Date().toISOString().split("T")[0] is the UTC day'
    },
    {
        pattern: /new Date\(\)\s*\.toISOString\(\)\s*\.slice\(0,\s*10\)/g,
        why: "new Date().toISOString().slice(0, 10) is the UTC day"
    },
    {
        pattern: /new Date\(\)\s*\.toISOString\(\)\s*\.substring\(0,\s*10\)/g,
        why: "new Date().toISOString().substring(0, 10) is the UTC day"
    }
];

/**
 * Deriving a date from a value that is already the right day is fine; only
 * reading the clock is not. These files hold those helpers.
 */
const ALLOWED = new Set([
    // Builds a YYYY-MM-DD from a date it was handed, not from now.
    "supabase/functions/shared/clinic-slots.ts",
    "supabase/functions/shared/revisit.ts",
    "supabase/functions/shared/appointment-format.ts"
]);

function walk(dir) {
    const out = [];

    for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);

        if (statSync(path).isDirectory()) {
            if (entry === "node_modules" || entry === ".next") continue;
            out.push(...walk(path));
        } else if (/\.(ts|tsx)$/.test(entry)) {
            out.push(path);
        }
    }

    return out;
}

const problems = [];

for (const root of ROOTS) {
    for (const file of walk(root)) {
        const relative = file.replace(/\\/g, "/");

        if (ALLOWED.has(relative)) {
            continue;
        }

        const source = readFileSync(file, "utf8");

        for (const { pattern, why } of OFFENDERS) {
            pattern.lastIndex = 0;

            let match;

            while ((match = pattern.exec(source)) !== null) {
                const line = source.slice(0, match.index).split("\n").length;

                problems.push(`  ${relative}:${line}  ${why}`);
            }
        }
    }
}

if (problems.length > 0) {
    console.error("verify-clinic-time: FAILED\n");
    console.error(problems.join("\n"));
    console.error(
        "\nUse todayInTimezone(await getClinicTimezone(supabase, clinicId)) so the" +
            "\nday is the clinic's own. A clinic in India is on tomorrow from 18:30 UTC."
    );
    process.exit(1);
}

console.log("verify-clinic-time: all checks passed (no date taken from the server clock)");
