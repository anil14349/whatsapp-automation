/**
 * Run monolith sync check + all static verify scripts.
 * Exit 1 on first failure.
 *
 * Run: node scripts/run-verify-all.mjs
 *      npm run verify
 */

import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const VERIFY_SCRIPTS = [
    "verify-flow-coverage.mjs",
    "verify-menu-flows.mjs",
    "verify-appointment-list-pages.mjs",
    "verify-owner-digest.mjs",
    "verify-reminder-actions.mjs",
    "verify-clinic-branding.mjs",
    "verify-waitlist.mjs",
    "verify-post-visit-feedback.mjs",
    "verify-visit-type.mjs"
];

function runNodeScript(relativePath, args) {

    const scriptPath =
        path.join(ROOT, relativePath);

    const result =
        spawnSync(
            process.execPath,
            [scriptPath].concat(args || []),
            {
                cwd: ROOT,
                stdio: "inherit",
                shell: false
            }
        );

    if (result.error) {
        console.error(result.error.message);
        return 1;
    }

    return result.status === null
        ? 1
        : result.status;
}

console.log("=== sync-monolith-from-src.js --check ===");

const syncStatus =
    runNodeScript(
        "scripts/sync-monolith-from-src.js",
        ["--check"]
    );

if (syncStatus !== 0) {
    process.exit(syncStatus);
}

for (
    let i = 0;
    i < VERIFY_SCRIPTS.length;
    i++
) {

    const name =
        VERIFY_SCRIPTS[i];

    console.log("");
    console.log("=== " + name + " ===");

    const status =
        runNodeScript(
            "scripts/" + name
        );

    if (status !== 0) {
        process.exit(status);
    }
}

console.log("");
console.log("All verify checks passed.");
