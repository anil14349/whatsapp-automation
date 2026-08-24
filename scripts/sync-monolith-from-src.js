/**
 * Sync top-level function bodies from src/*.gs into ABC_Clinic_WhatsApp_Complete.gs.
 *
 * All 22 production files under src/ are included (same set as Option B in README).
 * Only `function` bodies are copied — top-level const/var blocks in Config.gs stay
 * duplicated manually in the monolith header.
 *
 * Run: node scripts/sync-monolith-from-src.js
 * Check (no write): node scripts/sync-monolith-from-src.js --check
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const MONOLITH = path.join(ROOT, "ABC_Clinic_WhatsApp_Complete.gs");

/** Same order as README Option B — later files win on duplicate names. */
const SRC_FILES = [
    "src/Config.gs",
    "src/Util_Common.gs",
    "src/Logging.gs",
    "src/Model_Reminders.gs",
    "src/Model_OwnerDigest.gs",
    "src/Model_Waitlist.gs",
    "src/Model_Feedback.gs",
    "src/Model_AppointmentStatus.gs",
    "src/Model_AfterHours.gs",
    "src/Model_Doctors.gs",
    "src/Model_Calendar.gs",
    "src/Model_Patients.gs",
    "src/Model_Appointments.gs",
    "src/Model_Session.gs",
    "src/Api.gs",
    "src/Webhook.gs",
    "src/View_Menus.gs",
    "src/View_Messages.gs",
    "src/Controller_Shared.gs",
    "src/Controller_Router.gs",
    "src/Controller_DoctorFlow.gs",
    "src/Controller_PatientFlow.gs",
    "src/WhatsApp_Send.gs"
];

const AUTO_INSERT_MARKER =
    "// Auto-inserted by scripts/sync-monolith-from-src.js";

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

function stripPreviousAutoInsertBlock(monolith) {
    const markerIndex = monolith.indexOf(AUTO_INSERT_MARKER);

    if (markerIndex === -1) {
        return monolith;
    }

    const sectionStart = monolith.lastIndexOf(
        "\n// ============================================================",
        markerIndex
    );

    if (sectionStart === -1) {
        return monolith.slice(0, markerIndex).trimEnd() + "\n";
    }

    return monolith.slice(0, sectionStart).trimEnd() + "\n";
}

function appendMissingFunctions(monolith, missingItems) {
    if (missingItems.length === 0) {
        return monolith;
    }

    const block =
        "\n\n\n// ============================================================\n" +
        AUTO_INSERT_MARKER + "\n" +
        "// ============================================================\n\n\n" +
        missingItems.map(function (item) {
            return item.code;
        }).join("\n\n\n") +
        "\n";

    return monolith.trimEnd() + block;
}

function loadAllSourceFunctions() {
    const allFunctions = new Map();
    const byFile = {};

    for (const relPath of SRC_FILES) {
        const filePath = path.join(ROOT, relPath);

        if (!fs.existsSync(filePath)) {
            throw new Error("Missing src file: " + relPath);
        }

        const source = fs.readFileSync(filePath, "utf8");
        const fns = extractTopLevelFunctions(source);

        byFile[relPath] = fns.size;

        for (const [name, code] of fns.entries()) {
            allFunctions.set(name, code);
        }
    }

    return { allFunctions, byFile };
}

function main() {
    const checkOnly =
        process.argv.indexOf("--check") !== -1;

    let monolith = fs.readFileSync(MONOLITH, "utf8");
    monolith = stripPreviousAutoInsertBlock(monolith);

    const { allFunctions, byFile } =
        loadAllSourceFunctions();

    const missing = [];
    let replaced = 0;

    for (const [name, code] of allFunctions.entries()) {
        const updated = replaceFunction(monolith, name, code);

        if (updated === null) {
            missing.push({ name, code });
        } else {
            monolith = updated;
            replaced++;
        }
    }

    monolith = appendMissingFunctions(monolith, missing);

    const stillMissing = missing.filter(function (item) {
        return !findFunctionBounds(monolith, item.name);
    });

    if (stillMissing.length > 0) {
        throw new Error(
            "Still missing functions: " +
            stillMissing.map(function (item) {
                return item.name;
            }).join(", ")
        );
    }

    if (checkOnly) {
        console.log(
            "Check OK: " +
            allFunctions.size +
            " src functions, " +
            replaced +
            " replaced, " +
            missing.length +
            " would be inserted."
        );

        return;
    }

    fs.writeFileSync(MONOLITH, monolith, "utf8");

    console.log(
        "Synced " +
        allFunctions.size +
        " functions from " +
        SRC_FILES.length +
        " src files (" +
        replaced +
        " replaced, " +
        missing.length +
        " inserted)."
    );

    Object.keys(byFile).forEach(function (relPath) {
        console.log("  " + relPath + ": " + byFile[relPath]);
    });
}

main();
