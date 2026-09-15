/**
 * Type check every deployed edge function entrypoint.
 *
 * `deno test` only checks what the tests import, which let broken calls into
 * production: a doctor menu that called a method that did not exist, a booking
 * confirmation that threw, queries selecting columns that were never there.
 * Supabase's deploy does not type check either, so this is the only gate.
 */

import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const FUNCTIONS_DIR = "supabase/functions";
const CONFIG = join(FUNCTIONS_DIR, "deno.json");

const entrypoints = readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "shared" && entry.name !== "tests")
    .map((entry) => join(FUNCTIONS_DIR, entry.name, "index.ts"))
    .filter((path) => existsSync(path));

if (entrypoints.length === 0) {
    console.error("typecheck-functions: no function entrypoints found");
    process.exit(1);
}

// `shell: true` would concatenate rather than escape these paths, so resolve
// the Deno executable instead.
const deno = process.platform === "win32" ? "deno.exe" : "deno";

const result = spawnSync(deno, ["check", "--config", CONFIG, ...entrypoints], {
    stdio: "inherit"
});

if (result.error) {
    console.error(`typecheck-functions: could not run ${deno}: ${result.error.message}`);
    console.error("Install Deno: winget install DenoLand.Deno");
    process.exit(1);
}

if (result.status !== 0) {
    console.error(`\ntypecheck-functions: failed (${entrypoints.length} entrypoints checked)`);
    process.exit(result.status ?? 1);
}

console.log(`typecheck-functions: ${entrypoints.length} entrypoints type check cleanly`);
