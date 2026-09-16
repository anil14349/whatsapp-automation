/**
 * Every link in the documentation must point at something.
 *
 * The index listed files that had been renamed or moved years earlier, and
 * nothing said so: a dead link reads exactly like a live one until somebody
 * clicks it. Sixteen of them were sitting in the index when this was written,
 * including two carried forward while editing that very section.
 *
 * Only local targets are checked. Whether a URL on the internet still resolves
 * is not this script's business.
 */

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function markdownFiles(dir) {
    const out = [];

    for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === ".git" || name === ".next") continue;

        const path = join(dir, name);

        if (statSync(path).isDirectory()) {
            out.push(...markdownFiles(path));
        } else if (name.endsWith(".md")) {
            out.push(path);
        }
    }

    return out;
}

const LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

const problems = [];
let checked = 0;

// The legacy Apps Script notes describe a system that no longer runs, so their
// links are not worth holding to this standard.
for (const file of markdownFiles(join(root, "docs"))) {
    const text = readFileSync(file, "utf8");

    for (const match of text.matchAll(LINK)) {
        const target = match[1];

        if (/^(https?:|mailto:|tel:|#)/.test(target)) {
            continue;
        }

        const path = target.split("#")[0];

        if (!path) {
            continue;
        }

        checked++;

        if (!existsSync(resolve(dirname(file), path))) {
            const line = text.slice(0, match.index).split("\n").length;

            problems.push(`${file.slice(root.length + 1)}:${line}  ->  ${target}`);
        }
    }
}

if (problems.length > 0) {
    console.error("verify-docs: links that point at nothing\n");
    for (const problem of problems) console.error(`  ${problem}`);
    console.error(`\n${problems.length} broken of ${checked} local links`);
    process.exit(1);
}

console.log(`verify-docs: all ${checked} local documentation links resolve`);
