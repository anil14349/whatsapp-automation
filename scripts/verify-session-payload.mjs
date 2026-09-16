/**
 * Every booking-flow transition must carry the session payload forward.
 *
 * Rebuilding the payload at each step looks harmless until a new field is
 * added. serviceTypeId was dropped twice this way: once on the way into
 * BOOK_TIME, and once on the way into BOOK_DATE_CUSTOM, which left a
 * doctor-free service unable to find a slot on any date at all.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = join(root, "supabase/functions/shared/handlers/patient-handler.ts");
const source = readFileSync(file, "utf8");

// States that sit inside a booking or reschedule flow, where earlier answers
// still matter. Menus and terminal states deliberately start clean.
const FLOW_STATE = /^(BOOK_|SERVICE_SELECT|RESCHEDULE_)/;

// The first step of a flow has no earlier answers to keep. Listed with a reason
// so the exemption stays deliberate rather than becoming a habit.
const STARTS_A_FLOW = {
    SERVICE_SELECT: "the first step of a booking, so there is nothing to carry"
};

const problems = [];
const call = /updateSession\(\s*phone\s*,\s*"([A-Z_]+)"\s*,\s*\{/g;

let match;

while ((match = call.exec(source)) !== null) {
    const state = match[1];

    if (!FLOW_STATE.test(state) || STARTS_A_FLOW[state]) {
        continue;
    }

    // Read the object literal that follows, balancing braces.
    let depth = 0;
    let i = match.index + match[0].length - 1;
    let end = i;

    for (; i < source.length; i++) {
        if (source[i] === "{") depth++;
        else if (source[i] === "}") {
            depth--;
            if (depth === 0) {
                end = i;
                break;
            }
        }
    }

    const body = source.slice(match.index, end + 1);

    if (!body.includes("...session.data") && !body.includes("...data")) {
        const line = source.slice(0, match.index).split("\n").length;
        problems.push(`${state} at patient-handler.ts:${line} rebuilds the payload instead of spreading it`);
    }
}

if (problems.length > 0) {
    console.error("verify-session-payload: a booking step would lose earlier answers\n");
    for (const p of problems) {
        console.error(`  ${p}`);
    }
    console.error("\nSpread ...session.data so fields set earlier in the flow survive.");
    process.exit(1);
}

console.log("verify-session-payload: every booking step carries the session forward");
