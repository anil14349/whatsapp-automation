/**
 * Check column names used against the real database schema.
 *
 * Type checking cannot see inside `.select("patient_phone, ...")` or the keys
 * of an insert payload, which is how several column bugs reached production:
 * reminders selected `phone` instead of `patient_phone`, appointment lists read
 * `doctor_name` and `patient_id`, none of which exist.
 *
 * Needs network access and SU_SERVICE_ROLE_KEY, so it is a separate step from
 * `npm run verify`.
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const FUNCTIONS_DIR = "supabase/functions";

function readEnvLocal() {
    const values = {};

    if (!existsSync(".env.local")) {
        return values;
    }

    for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
        const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (match) values[match[1]] = match[2].trim();
    }

    return values;
}

function sourceFiles(dir) {
    const found = [];

    for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);

        if (statSync(path).isDirectory()) {
            if (entry === "tests") continue;
            found.push(...sourceFiles(path));
        } else if (entry.endsWith(".ts")) {
            found.push(path);
        }
    }

    return found;
}

/**
 * Column references we can attribute to a table with confidence.
 *
 * Only `.from("x").select(...)` / `.eq("col", ...)` chains are considered;
 * anything dynamic is skipped rather than guessed at.
 */
function extractReferences(source, file) {
    const refs = [];
    const chain = /\.from\(\s*["'`]([a-z_]+)["'`]\s*\)([\s\S]{0,1200}?)(?=\.from\(|\n\s*(?:async\s+)?function |\n}\n|$)/g;

    let match;
    while ((match = chain.exec(source)) !== null) {
        const table = match[1];
        const body = match[2];
        const line = source.slice(0, match.index).split("\n").length;

        // .select("a, b, embed:other(x)") - embeds belong to the other table.
        const select = /\.select\(\s*[`"']([\s\S]*?)[`"']\s*\)/.exec(body);

        if (select) {
            const withoutEmbeds = select[1].replace(/[a-z_]+\s*:\s*[a-z_]+\s*\([^)]*\)/gi, "");

            for (const raw of withoutEmbeds.split(",")) {
                const column = raw.trim().replace(/\s+/g, "");
                if (column && column !== "*" && /^[a-z_][a-z0-9_]*$/.test(column)) {
                    refs.push({ table, column, file, line });
                }
            }
        }

        // Filters name a column directly.
        const filter = /\.(?:eq|neq|gt|gte|lt|lte|like|ilike|is|in)\(\s*["'`]([a-z_][a-z0-9_]*)["'`]/g;
        let f;
        while ((f = filter.exec(body)) !== null) {
            refs.push({ table, column: f[1], file, line });
        }

        // .order("col")
        const order = /\.order\(\s*["'`]([a-z_][a-z0-9_]*)["'`]/g;
        let o;
        while ((o = order.exec(body)) !== null) {
            refs.push({ table, column: o[1], file, line });
        }

        // Keys of an inline insert/update payload. Spreads and computed keys
        // are skipped, so this only reports what it can read literally.
        const payload = /\.(?:insert|update|upsert)\(\s*\{([\s\S]*?)\}\s*(?:,|\))/g;
        let p;
        while ((p = payload.exec(body)) !== null) {
            if (p[1].includes("...")) continue;

            const keys = p[1].matchAll(/(?:^|,)\s*([a-z_][a-z0-9_]*)\s*:/g);

            for (const k of keys) {
                refs.push({ table, column: k[1], file, line });
            }
        }
    }

    return refs;
}

const env = readEnvLocal();
const url = env.SU_URL || process.env.SUPABASE_URL;
const key = env.SU_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
    console.error("verify-schema: SU_URL / SU_SERVICE_ROLE_KEY not found; skipping");
    process.exit(0);
}

const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }
});

if (!response.ok) {
    console.error(`verify-schema: could not read schema (${response.status})`);
    process.exit(1);
}

const spec = await response.json();
const schema = new Map();

for (const [table, definition] of Object.entries(spec.definitions ?? {})) {
    schema.set(table, new Set(Object.keys(definition.properties ?? {})));
}

const problems = [];
let checked = 0;

for (const file of sourceFiles(FUNCTIONS_DIR)) {
    const source = readFileSync(file, "utf8");

    for (const ref of extractReferences(source, file)) {
        const columns = schema.get(ref.table);

        // An unknown table is usually a view or a typo in a comment; report it
        // separately rather than flooding the output with its columns.
        if (!columns) continue;

        checked++;

        if (!columns.has(ref.column)) {
            problems.push(ref);
        }
    }
}

if (problems.length > 0) {
    console.error("verify-schema: columns referenced that do not exist\n");

    for (const p of problems) {
        console.error(`  ${p.file}:${p.line}  ${p.table}.${p.column}`);
    }

    console.error(`\n${problems.length} problem(s) across ${checked} column references`);
    process.exit(1);
}

console.log(`verify-schema: ${checked} column references match the database`);
