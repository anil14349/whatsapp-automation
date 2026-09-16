/**
 * Every WhatsApp client must be built with somewhere to log.
 *
 * Logging used to be an argument on each send call, and 118 of 187 sends never
 * passed it, so most of what the bot said to patients was never recorded. The
 * client now takes a Supabase client once; this keeps it that way.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "functions");

function walk(dir) {
    const out = [];

    for (const name of readdirSync(dir)) {
        const path = join(dir, name);

        if (statSync(path).isDirectory()) {
            // The test fake replaces sending altogether, so it has nothing to log.
            if (name === "tests") continue;
            out.push(...walk(path));
        } else if (name.endsWith(".ts")) {
            out.push(path);
        }
    }

    return out;
}

const problems = [];

for (const file of walk(root)) {
    const text = readFileSync(file, "utf8");
    const call = /new WhatsAppClient\s*\(/g;
    let match;

    while ((match = call.exec(text)) !== null) {
        let depth = 0;
        let i = match.index + match[0].length - 1;
        let end = i;

        for (; i < text.length; i++) {
            if (text[i] === "(") depth++;
            else if (text[i] === ")") {
                depth--;
                if (depth === 0) {
                    end = i;
                    break;
                }
            }
        }

        const args = splitArgs(text.slice(match.index + match[0].length, end));

        if (args.length < 3 || !args[2]) {
            const line = text.slice(0, match.index).split("\n").length;
            const where = file.slice(root.length + 1).replace(/\\/g, "/");
            problems.push(`${where}:${line} builds a client with nowhere to log`);
        }
    }
}

/** Top-level commas only, so a nested call does not look like an argument break. */
function splitArgs(source) {
    const args = [];
    let depth = 0;
    let current = "";

    for (const char of source) {
        if (char === "(" || char === "[" || char === "{") depth++;
        else if (char === ")" || char === "]" || char === "}") depth--;

        if (char === "," && depth === 0) {
            args.push(current.trim());
            current = "";
            continue;
        }

        current += char;
    }

    if (current.trim()) {
        args.push(current.trim());
    }

    return args;
}

if (problems.length > 0) {
    console.error("verify-outbound-logging: a client would send without recording it\n");

    for (const problem of problems) {
        console.error(`  ${problem}`);
    }

    console.error("\nPass the Supabase client as the third argument, and the clinic id as the fourth.");
    process.exit(1);
}

console.log("verify-outbound-logging: every client records what it sends");
