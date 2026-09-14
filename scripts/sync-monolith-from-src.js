/**
 * Sync top-level function bodies from legacy/src-archive/*.gs into
 * ABC_Clinic_WhatsApp_Complete.gs.
 *
 * STATUS: effectively disabled. The monolith is the source of truth and is now
 * 39 functions ahead of the archive. This script strips everything below the
 * auto-insert marker and re-adds only what the archive contains, so running it
 * would delete those 39 functions (the whole home-collection collector flow,
 * trigger installation, initializeClinicSystem). A guard in main() refuses to
 * write in that case and lists the functions at risk.
 *
 * To revive it, port the missing functions into legacy/src-archive/ first.
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
    "legacy/src-archive/Config.gs",
    "legacy/src-archive/Util_Common.gs",
    "legacy/src-archive/Util_Idempotency.gs",
    "legacy/src-archive/Util_Maintenance.gs",
    "legacy/src-archive/Util_SlotReservation.gs",
    "legacy/src-archive/Util_RLS.gs",
    "legacy/src-archive/Util_Reminders.gs",
    "legacy/src-archive/Util_DataBackup.gs",
    "legacy/src-archive/Util_Migration.gs",
    "legacy/src-archive/Util_RLSAuditing.gs",
    "legacy/src-archive/Util_DoctorProfile.gs",
    "legacy/src-archive/Util_QuickBooking.gs",
    "legacy/src-archive/Util_PatientHistory.gs",
    "legacy/src-archive/Util_Waitlist.gs",
    "legacy/src-archive/Util_NotificationPrefs.gs",
    "legacy/src-archive/Util_Feedback.gs",
    "legacy/src-archive/Util_Performance.gs",
    "legacy/src-archive/Util_CostOptimization.gs",
    "legacy/src-archive/Util_AdminDashboard.gs",
    "legacy/src-archive/Util_MonitoringDashboard.gs",
    "legacy/src-archive/Logging.gs",
    "legacy/src-archive/Model_Reminders.gs",
    "legacy/src-archive/Model_AppointmentStatus.gs",
    "legacy/src-archive/Model_AfterHours.gs",
    "legacy/src-archive/Model_Doctors.gs",
    "legacy/src-archive/Model_Calendar.gs",
    "legacy/src-archive/Model_Patients.gs",
    "legacy/src-archive/Model_Appointments.gs",
    "legacy/src-archive/Model_HomeCollection.gs",
    "legacy/src-archive/Model_Session.gs",
    "legacy/src-archive/Setup.gs",
    "legacy/src-archive/Api.gs",
    "legacy/src-archive/Webhook.gs",
    "legacy/src-archive/View_Menus.gs",
    "legacy/src-archive/View_Messages.gs",
    "legacy/src-archive/Controller_Shared.gs",
    "legacy/src-archive/Controller_Router.gs",
    "legacy/src-archive/Controller_DoctorFlow.gs",
    "legacy/src-archive/Controller_PatientFlow.gs",
    "legacy/src-archive/Controller_HomeCollection.gs",
    "legacy/src-archive/WhatsApp_Send.gs"
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

function collectFunctionNames(source) {
    const names = [];
    const nameRegex = /^function\s+([A-Za-z0-9_]+)\s*\(/gm;
    let match;

    while ((match = nameRegex.exec(source)) !== null) {
        names.push(match[1]);
    }

    return Array.from(new Set(names));
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

    const originalMonolith = fs.readFileSync(MONOLITH, "utf8");
    let monolith = stripPreviousAutoInsertBlock(originalMonolith);

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

    // Guard against a class of bug this script can't otherwise catch:
    // replaceFunction() only ever updates the FIRST declaration of a
    // given name it finds via regex. If the monolith ever ends up with
    // two declarations of the same function (e.g. from a manual edit
    // that pasted a duplicate elsewhere in the file), every future sync
    // silently keeps the first one current while the second — the one
    // that actually wins at runtime, since JS uses the last declaration
    // — goes stale forever with no warning. Fail loudly instead.
    const duplicateNames = [];
    const seenNames = {};
    const nameRegex = /^function\s+([A-Za-z0-9_]+)\s*\(/gm;
    let nameMatch;

    while ((nameMatch = nameRegex.exec(monolith)) !== null) {
        const fnName = nameMatch[1];

        if (seenNames[fnName]) {
            duplicateNames.push(fnName);
        }

        seenNames[fnName] = true;
    }

    if (duplicateNames.length > 0) {
        throw new Error(
            "Monolith has duplicate function declarations (the LAST " +
            "one silently wins at runtime, not necessarily the one " +
            "kept in sync with src/): " +
            Array.from(new Set(duplicateNames)).join(", ")
        );
    }

    // This script only adds back what exists in src/, but it first strips
    // everything below the auto-insert marker. Any function that was added
    // to the monolith by hand below that marker would be destroyed. Refuse
    // to write a monolith that has fewer functions than it started with.
    const droppedNames = collectFunctionNames(originalMonolith).filter(
        function (name) {
            return !findFunctionBounds(monolith, name);
        }
    );

    if (droppedNames.length > 0) {
        throw new Error(
            "Refusing to sync: " +
            droppedNames.length +
            " function(s) exist in the monolith but not in src/, and this " +
            "sync would delete them. Port them into src/ first (or stop " +
            "using this script if the monolith is the source of truth): " +
            droppedNames.join(", ")
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
