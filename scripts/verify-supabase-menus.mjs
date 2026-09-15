/**
 * Static checks for the Supabase patient/doctor menus.
 *
 * verify-menu-flows and verify-flow-coverage read the legacy Apps Script
 * monolith, which is no longer what runs, so the menus that actually reach
 * patients had no gate at all. Type checking does not help here either: a
 * button id is just a string, so sending one that nothing handles compiles
 * cleanly and then does nothing in front of a patient.
 *
 * Run: node scripts/verify-supabase-menus.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const HANDLERS = path.join(ROOT, "supabase/functions/shared/handlers");

const failures = [];

function fail(message, detail) {
    failures.push({ message, detail });
}

const files = fs
    .readdirSync(HANDLERS)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => ({ name, src: fs.readFileSync(path.join(HANDLERS, name), "utf8") }));

const everything = files.map((f) => f.src).join("\n");

/**
 * Ids offered to the user must be ids the code can act on.
 *
 * An unhandled id falls through to the default branch, which quietly returns
 * the patient to the main menu, so the button looks like it does nothing.
 */
const sent = new Set();
const handled = new Set();

const HANDLED_PATTERNS = [
    /\bcase\s+(BUTTON_IDS\.[A-Z_]+\.[A-Z_]+)\s*:/g,
    /===\s*(BUTTON_IDS\.[A-Z_]+\.[A-Z_]+)/g,
    /\b(BUTTON_IDS\.[A-Z_]+\.[A-Z_]+)\s*===/g,
    // includes(BUTTON_IDS.X.Y) — how the paging handlers match
    /includes\(\s*(BUTTON_IDS\.[A-Z_]+\.[A-Z_]+)\s*\)/g,
    // [BUTTON_IDS.X.Y]: "VALUE" — a lookup table instead of a switch
    /\[\s*(BUTTON_IDS\.[A-Z_]+\.[A-Z_]+)\s*\]\s*:/g
];

for (const { src } of files) {
    for (const match of src.matchAll(/\bid:\s*(BUTTON_IDS\.[A-Z_]+\.[A-Z_]+)/g)) {
        sent.add(match[1]);
    }

    for (const pattern of HANDLED_PATTERNS) {
        for (const match of src.matchAll(pattern)) {
            handled.add(match[1]);
        }
    }
}

for (const id of [...sent].sort()) {
    if (!handled.has(id)) {
        fail(`${id} is offered to the user but nothing handles it`, "the button would do nothing");
    }
}

/**
 * Meta's limits are hard errors rather than degradation: the client throws
 * above three buttons and above ten list rows. A clinic enabling a few more
 * services must not be able to take the bot down.
 *
 * Rows built from a constant declared in the file are fixed at authoring time
 * and safe. Anything else can grow with the data.
 */
function isFileLocalConstant(src, identifier) {
    return new RegExp(`const\\s+${identifier}\\b[^=]*=\\s*\\[`).test(src);
}

function mappedSources(call) {
    return [...call.matchAll(/([A-Za-z_$][\w$]*)\s*\.map\(/g)].map((m) => m[1]);
}

for (const { name, src } of files) {
    for (const match of src.matchAll(/sendInteractiveButtonMessage\(([\s\S]{0,800}?)\n\s*\);/g)) {
        const call = match[1];
        const literalButtons = (call.match(/\bid:\s/g) || []).length;

        if (literalButtons > 3) {
            fail(
                `${name}: a button message is built with ${literalButtons} buttons`,
                "the client throws above 3"
            );
        }

        for (const source of mappedSources(call)) {
            if (!isFileLocalConstant(src, source) && !/slice\(0,\s*[123]\)/.test(call)) {
                fail(
                    `${name}: buttons are built from "${source}" with no cap`,
                    "cap it at 3 before sending"
                );
            }
        }
    }

    for (const match of src.matchAll(/sendInteractiveListMessage\(([\s\S]{0,1000}?)\n\s*\);/g)) {
        const call = match[1];

        for (const source of mappedSources(call)) {
            const capped = /slice\(0,\s*\d+\)/.test(call) || /\bpage\b/i.test(call);

            if (!isFileLocalConstant(src, source) && !capped) {
                fail(
                    `${name}: list rows are built from "${source}" with no cap`,
                    "WhatsApp refuses more than 10 rows across all sections"
                );
            }
        }
    }
}

/**
 * Services are chosen per clinic, so their ids cannot be declared up front.
 * They must still be checked against the clinic rather than trusted.
 */
if (/isServiceButton/.test(everything) && !/getServiceById/.test(everything)) {
    fail(
        "service buttons are accepted without being checked against the clinic",
        "hiding a button is not authorisation"
    );
}

if (failures.length > 0) {
    console.error("verify-supabase-menus: FAILED\n");

    for (const { message, detail } of failures) {
        console.error(`  - ${message}`);
        if (detail) console.error(`    ${detail}`);
    }

    process.exit(1);
}

console.log(
    `verify-supabase-menus: all checks passed (${sent.size} menu ids sent, all handled)`
);
