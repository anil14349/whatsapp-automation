/**
 * Sync top-level function bodies from src/*.gs into ABC_Clinic_WhatsApp_Complete.gs.
 * Run: node scripts/sync-monolith-from-src.js
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const MONOLITH = path.join(ROOT, "ABC_Clinic_WhatsApp_Complete.gs");

const SRC_FILES = [
    "src/View_Menus.gs",
    "src/View_Messages.gs",
    "src/WhatsApp_Send.gs",
    "src/Model_Session.gs",
    "src/Controller_Shared.gs",
    "src/Controller_PatientFlow.gs",
    "src/Controller_DoctorFlow.gs"
];

function extractTopLevelFunctions(source) {
    const functions = new Map();
    const fnRegex = /^function\s+([A-Za-z0-9_]+)\s*\(/gm;
    const positions = [];
    let match;

    while ((match = fnRegex.exec(source)) !== null) {
        positions.push({
            name: match[1],
            start: match.index
        });
    }

    for (let i = 0; i < positions.length; i++) {
        const { name, start } = positions[i];
        let braceIndex = start;

        while (
            braceIndex < source.length &&
            source[braceIndex] !== "{"
        ) {
            braceIndex++;
        }

        if (braceIndex >= source.length) {
            continue;
        }

        let depth = 0;
        let end = braceIndex;

        for (; end < source.length; end++) {
            const ch = source[end];

            if (ch === "{") {
                depth++;
            } else if (ch === "}") {
                depth--;

                if (depth === 0) {
                    end++;
                    break;
                }
            }
        }

        functions.set(name, source.slice(start, end));
    }

    return functions;
}

function findFunctionBounds(source, name) {
    const fnRegex = new RegExp(
        "^function\\s+" + name + "\\s*\\(",
        "m"
    );
    const match = fnRegex.exec(source);

    if (!match) {
        return null;
    }

    const start = match.index;
    let braceIndex = start;

    while (
        braceIndex < source.length &&
        source[braceIndex] !== "{"
    ) {
        braceIndex++;
    }

    let depth = 0;
    let end = braceIndex;

    for (; end < source.length; end++) {
        const ch = source[end];

        if (ch === "{") {
            depth++;
        } else if (ch === "}") {
            depth--;

            if (depth === 0) {
                end++;
                break;
            }
        }
    }

    return { start, end };
}

function replaceFunction(monolith, name, code) {
    const bounds = findFunctionBounds(monolith, name);

    if (!bounds) {
        return null;
    }

    return (
        monolith.slice(0, bounds.start) +
        code +
        monolith.slice(bounds.end)
    );
}

function insertAfterFunction(monolith, anchorName, code) {
    const bounds = findFunctionBounds(monolith, anchorName);

    if (!bounds) {
        throw new Error(
            "Anchor function not found: " + anchorName
        );
    }

    return (
        monolith.slice(0, bounds.end) +
        "\n\n\n" +
        code +
        monolith.slice(bounds.end)
    );
}

function main() {
    let monolith = fs.readFileSync(MONOLITH, "utf8");
    const allFunctions = new Map();
    const missing = [];

    for (const relPath of SRC_FILES) {
        const filePath = path.join(ROOT, relPath);
        const source = fs.readFileSync(filePath, "utf8");
        const fns = extractTopLevelFunctions(source);

        for (const [name, code] of fns.entries()) {
            allFunctions.set(name, code);
        }
    }

    for (const [name, code] of allFunctions.entries()) {
        const updated = replaceFunction(monolith, name, code);

        if (updated === null) {
            missing.push({ name, code });
        } else {
            monolith = updated;
        }
    }

    const menuInserts = [];
    const sendInserts = [];
    const sessionInserts = [];

    for (const item of missing) {
        if (item.name.indexOf("send") === 0) {
            sendInserts.push(item.code);
        } else if (
            item.name.indexOf("ensureWhatsAppSession") === 0 ||
            item.name === "resolveSlotSelectionPage"
        ) {
            sessionInserts.push(item.code);
        } else {
            menuInserts.push(item.code);
        }
    }

    if (menuInserts.length > 0) {
        monolith = insertAfterFunction(
            monolith,
            "getDoctorStatusActionSpec",
            menuInserts.join("\n\n\n")
        );
    }

    if (sendInserts.length > 0) {
        monolith = insertAfterFunction(
            monolith,
            "sendDoctorSelectionReply",
            sendInserts.join("\n\n\n")
        );
    }

    if (sessionInserts.length > 0) {
        monolith = insertAfterFunction(
            monolith,
            "ensureWhatsAppSessionPatientNameColumn",
            sessionInserts.join("\n\n\n")
        );
    }

    const stillMissing = [];

    for (const item of missing) {
        if (!findFunctionBounds(monolith, item.name)) {
            stillMissing.push(item.name);
        }
    }

    if (stillMissing.length > 0) {
        throw new Error(
            "Still missing functions: " +
            stillMissing.join(", ")
        );
    }

    fs.writeFileSync(MONOLITH, monolith, "utf8");

    console.log(
        "Synced " +
        allFunctions.size +
        " functions (" +
        missing.length +
        " newly inserted)."
    );
}

main();
