/**
 * Copy a clinic's configuration from one Supabase project to another.
 *
 * Only the rows that describe the clinic: who works there, what it offers,
 * when it opens, who may sign in. Deliberately NOT appointments, reminders,
 * sessions, logs, feedback or documents - those belong to the project they
 * happened in, and carrying them over would fabricate history.
 *
 * Upserts on the primary key, so it can be run twice.
 *
 * Usage:
 *   deno run --allow-env --allow-net --allow-read scripts/copy-clinic-config.ts <targetRef> <targetServiceKey> [--yes]
 */

/** FK order: a doctor's hours need the doctor, a service needs the clinic. */
const TABLES = [
    "clinics",
    "service_types",
    "clinic_services",
    "clinic_operating_hours",
    "clinic_holidays",
    "doctors",
    "doctor_operating_hours",
    "doctor_home_visit_hours",
    "sample_collectors",
    "clinic_admins",
    "receptionists"
];

const positional = Deno.args.filter((arg) => !arg.startsWith("--"));
const assumeYes = Deno.args.includes("--yes");
const [targetRef, targetKey] = positional;

if (!targetRef || !targetKey) {
    console.error("usage: copy-clinic-config.ts <targetRef> <targetServiceKey> [--yes]");
    Deno.exit(1);
}

const env: Record<string, string> = {};

for (const line of (await Deno.readTextFile(".env.local")).split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (match) env[match[1]] = match[2].replace(/^"|"$/g, "");
}

const source = { url: env.SU_URL, key: env.SU_SERVICE_ROLE_KEY };
const target = { url: `https://${targetRef}.supabase.co`, key: targetKey };

function headers(key: string, extra: Record<string, string> = {}) {
    return { apikey: key, Authorization: `Bearer ${key}`, ...extra };
}

// Read everything before destroying anything. The target is cleared outright,
// so a source that answers halfway would otherwise leave it empty with nothing
// to put back.
const staged: Record<string, unknown[]> = {};

for (const table of TABLES) {
    const read = await fetch(`${source.url}/rest/v1/${table}?select=*`, {
        headers: headers(source.key)
    });

    if (!read.ok) {
        console.error(`${table.padEnd(26)} FAILED ${read.status} reading source - nothing changed`);
        Deno.exit(1);
    }

    const rows = await read.json();

    if (!Array.isArray(rows)) {
        console.error(`${table.padEnd(26)} unexpected answer from source - nothing changed`);
        Deno.exit(1);
    }

    staged[table] = rows;
    console.log(`${table.padEnd(26)} read ${rows.length}`);
}

// Retyping the ref, rather than "yes", is what catches the real mistake here:
// a target that is a valid project but not the intended one.
if (!assumeYes) {
    console.log(`\nThis DELETES every row in those tables on ${target.url} and replaces them.`);

    if (prompt(`Retype the target ref (${targetRef}) to continue:`) !== targetRef) {
        console.error("Stopped. Nothing changed.");
        Deno.exit(1);
    }
}

console.log("");

/**
 * The migrations seed their own DEFAULT_CLINIC and service catalogue, whose ids
 * differ from the source. Keeping the source ids matters - DEFAULT_CLINIC_ID,
 * every foreign key and every id already written down all point at them - so
 * the seeded rows are cleared first rather than merged with.
 */
for (const table of [...TABLES].reverse()) {
    const wipe = await fetch(`${target.url}/rest/v1/${table}?id=not.is.null`, {
        method: "DELETE",
        headers: headers(target.key, { Prefer: "return=representation" })
    });

    if (!wipe.ok) {
        console.error(
            `${table.padEnd(26)} FAILED ${wipe.status} clearing target - stopping part-way, ` +
                `the target is now incomplete and the copy has not run`
        );
        Deno.exit(1);
    }

    const removed = ((await wipe.json()) as unknown[]).length;

    console.log(`${table.padEnd(26)} cleared ${removed}`);
}

console.log("");

const failed: string[] = [];

for (const table of TABLES) {
    const rows = staged[table];

    if (rows.length === 0) {
        console.log(`${table.padEnd(26)} nothing to copy`);
        continue;
    }

    const write = await fetch(`${target.url}/rest/v1/${table}`, {
        method: "POST",
        headers: headers(target.key, {
            "Content-Type": "application/json",
            Prefer: "return=representation"
        }),
        body: JSON.stringify(rows)
    });

    const body = await write.text();

    if (!write.ok) {
        console.log(`${table.padEnd(26)} FAILED ${write.status}: ${body.slice(0, 200)}`);
        failed.push(table);
        continue;
    }

    console.log(`${table.padEnd(26)} copied ${rows.length}`);
}

if (failed.length > 0) {
    // Exiting 0 here used to report success for a half-copied project.
    console.error(`\n${failed.length} table(s) did not copy: ${failed.join(", ")}`);
    console.error("The target is incomplete. Fix the cause and run again.");
    Deno.exit(1);
}

console.log("\nDone.");
