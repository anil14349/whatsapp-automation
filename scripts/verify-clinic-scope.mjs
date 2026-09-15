/**
 * Every clinic-scoped query must say which clinic.
 *
 * The edge functions connect with the service role key, which bypasses row
 * level security, so the database will not catch a missing clinic filter. That
 * makes `.eq("clinic_id", ...)` the only thing standing between one clinic and
 * another's records, and a forgotten one returns data rather than an error.
 *
 * Run: node scripts/verify-clinic-scope.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const FUNCTIONS = path.join(ROOT, "supabase/functions");

// Tables holding one clinic's data. Reading any of these without naming a
// clinic is either a bug or needs saying out loud.
const SCOPED_TABLES = [
    "appointments",
    "patients",
    "doctors",
    "receptionists",
    "sample_collectors",
    "clinic_admins",
    "clinic_services",
    "whatsapp_sessions",
    "appointment_reminders",
    "home_collection_requests",
    "feedback",
    "clinic_holidays",
    "doctor_leaves",
    "waitlist"
];

/**
 * Deliberate exceptions, each with a reason. Anything not listed must scope.
 */
const ALLOWED_UNSCOPED = [
    // The scheduler works across every clinic by design, one at a time.
    { file: "scheduled-reminders/index.ts", reason: "runs for all clinics in turn" },
    { file: "shared/appointment-reminders.ts", reason: "reminder rows carry their own clinic_id" },
    // Routing resolves which clinic an inbound message belongs to.
    { file: "shared/clinic-routing.ts", reason: "resolves the clinic itself" },
    { file: "shared/clinic-status.ts", reason: "reads one clinic by primary key" },
    // Bootstrapping the first admin has no clinic context yet.
    { file: "scripts/create-admin.ts", reason: "bootstrap" },
    // Scopes conditionally on a following line, which the chain regex cannot
    // see: a clinic owner is matched on their clinic, a platform admin on
    // clinic_id IS NULL.
    { file: "admins-auth-login/index.ts", reason: "scopes via a ternary" }
];

// Columns that identify a single row on their own, so a clinic filter adds
// nothing. Anything else must name the clinic.
const OWN_KEYS = ["id", "request_id"];

function walk(dir) {
    const out = [];

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            if (entry.name === "tests") continue;
            out.push(...walk(full));
        } else if (entry.name.endsWith(".ts")) {
            out.push(full);
        }
    }

    return out;
}

const failures = [];

for (const file of walk(FUNCTIONS)) {
    const rel = path.relative(FUNCTIONS, file).replace(/\\/g, "/");

    if (ALLOWED_UNSCOPED.some((a) => rel.endsWith(a.file))) {
        continue;
    }

    const src = fs.readFileSync(file, "utf8");

    for (const table of SCOPED_TABLES) {
        const pattern = new RegExp(`\\.from\\(["'\`]${table}["'\`]\\)([\\s\\S]{0,400}?);`, "g");

        for (const match of src.matchAll(pattern)) {
            const chain = match[1];

            // An insert that sets clinic_id is naming the clinic, not missing it.
            if (/\.insert\(/.test(chain) && /clinic_id\s*:/.test(chain)) {
                continue;
            }

            const scoped =
                /\.eq\(\s*["'`]clinic_id["'`]/.test(chain) ||
                OWN_KEYS.some((key) =>
                    new RegExp(`\\.eq\\(\\s*["'\`]${key}["'\`]`).test(chain)
                );

            if (!scoped) {
                const line = src.slice(0, match.index).split("\n").length;

                failures.push({
                    where: `${rel}:${line}`,
                    table,
                    snippet: chain.replace(/\s+/g, " ").trim().slice(0, 80)
                });
            }
        }
    }
}

if (failures.length > 0) {
    console.error("verify-clinic-scope: FAILED\n");

    for (const f of failures) {
        console.error(`  - ${f.where}  query on "${f.table}" names no clinic`);
        console.error(`    ${f.snippet}`);
    }

    console.error(
        "\n  Add .eq(\"clinic_id\", clinicId), or list the file in ALLOWED_UNSCOPED with a reason."
    );

    process.exit(1);
}

console.log("verify-clinic-scope: every clinic-scoped query names a clinic");
