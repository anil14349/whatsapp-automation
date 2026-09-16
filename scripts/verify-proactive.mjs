/**
 * Anything the clinic starts must survive the 24 hour window.
 *
 * Meta only accepts a free-form message within 24 hours of the recipient's own
 * last message. Every reminder was being sent as free-form, so Meta refused it,
 * the row was marked failed, retried against the same closed window, and the
 * patient was never told. Nothing surfaced it.
 *
 * These are the paths where the clinic speaks first. They must go through
 * sendProactive, which falls back to an approved template. A plain
 * sendTextMessage here is the bug coming back.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "functions");

/** Whole modules that exist only to send something the clinic initiated. */
const PROACTIVE_FILES = [
    "shared/appointment-reminder-scheduler.ts",
    "shared/home-collection-reminder-scheduler.ts",
    "shared/delay-notice.ts",
    "shared/credential-delivery.ts"
];

/** Single functions inside modules that are otherwise reply-driven. */
const PROACTIVE_FUNCTIONS = [
    ["shared/handlers/patient-handler.ts", "notifyDoctorNewBooking"],
    ["shared/handlers/waitlist-handler.ts", "notifyWaitlistOnCancellation"]
];

const DIRECT_SEND = /\.sendTextMessage\s*\(/;

/**
 * The body of a named method, found by matching braces from its signature.
 *
 * Anchored to a declaration, not merely the name: a call site appears earlier
 * in the file and would have this reading somebody else's block.
 */
function bodyOf(text, name) {
    const declaration = new RegExp(
        `^[ \\t]*(?:private |public |protected )?(?:static )?(?:async )?${name}\\s*\\(`,
        "m"
    );
    const found = declaration.exec(text);

    if (!found) {
        return null;
    }

    const open = text.indexOf("{", found.index + found[0].length);

    if (open === -1) {
        return null;
    }

    let depth = 0;

    for (let i = open; i < text.length; i += 1) {
        if (text[i] === "{") depth += 1;
        if (text[i] === "}") {
            depth -= 1;
            if (depth === 0) return text.slice(open, i + 1);
        }
    }

    return null;
}

const problems = [];

for (const relative of PROACTIVE_FILES) {
    const text = readFileSync(join(root, relative), "utf8");

    if (DIRECT_SEND.test(text)) {
        problems.push(
            `${relative} sends directly with sendTextMessage. The clinic starts this ` +
            `message, so it must use sendProactive and name a template.`
        );
    }
}

for (const [relative, name] of PROACTIVE_FUNCTIONS) {
    const text = readFileSync(join(root, relative), "utf8");
    const body = bodyOf(text, name);

    if (body === null) {
        problems.push(`${relative}: could not find ${name}. Renamed? Update this check.`);
        continue;
    }

    if (DIRECT_SEND.test(body)) {
        problems.push(
            `${relative}: ${name} sends directly with sendTextMessage. The recipient has ` +
            `usually not messaged recently, so it must use sendProactive.`
        );
    }
}

if (problems.length > 0) {
    console.error("verify-proactive: clinic-initiated messages that will be refused\n");
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
}

console.log(
    `verify-proactive: all ${PROACTIVE_FILES.length + PROACTIVE_FUNCTIONS.length} ` +
    `clinic-initiated paths fall back to a template`
);
