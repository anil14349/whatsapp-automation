/**
 * Reverse sync: push changes from ABC_Clinic_WhatsApp_Complete.gs (monolith) 
 * back to individual src/*.gs files.
 *
 * This script:
 * 1. Extracts all function bodies from the monolith
 * 2. For each function, finds which src/ file currently defines it
 * 3. Updates that src/ file with the new function body
 *
 * Run: node scripts/sync-src-from-monolith.js
 * Check (no write): node scripts/sync-src-from-monolith.js --check
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const MONOLITH = path.join(ROOT, "ABC_Clinic_WhatsApp_Complete.gs");

const SRC_FILES = [
    "src/Config.gs",
    "src/Util_Common.gs",
    "src/Util_Idempotency.gs",
    "src/Util_Maintenance.gs",
    "src/Util_SlotReservation.gs",
    "src/Util_RLS.gs",
    "src/Util_Reminders.gs",
    "src/Util_DataBackup.gs",
    "src/Util_Migration.gs",
    "src/Util_RLSAuditing.gs",
    "src/Util_DoctorProfile.gs",
    "src/Util_QuickBooking.gs",
    "src/Util_PatientHistory.gs",
    "src/Util_Waitlist.gs",
    "src/Util_NotificationPrefs.gs",
    "src/Util_Feedback.gs",
    "src/Util_Performance.gs",
    "src/Util_CostOptimization.gs",
    "src/Util_AdminDashboard.gs",
    "src/Util_MonitoringDashboard.gs",
    "src/Logging.gs",
    "src/Model_Reminders.gs",
    "src/Model_AppointmentStatus.gs",
    "src/Model_AfterHours.gs",
    "src/Model_Doctors.gs",
    "src/Model_Calendar.gs",
    "src/Model_Patients.gs",
    "src/Model_Appointments.gs",
    "src/Model_HomeCollection.gs",
    "src/Model_Session.gs",
    "src/Setup.gs",
    "src/Api.gs",
    "src/Webhook.gs",
    "src/View_Menus.gs",
    "src/View_Messages.gs",
    "src/Controller_Shared.gs",
    "src/Controller_Router.gs",
    "src/Controller_DoctorFlow.gs",
    "src/Controller_PatientFlow.gs",
    "src/Controller_HomeCollection.gs",
    "src/WhatsApp_Send.gs"
];

/**
 * Extract all top-level function definitions from source code.
 * Returns Map<functionName, functionBody>
 */
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

/**
 * Find the bounds of a function in source code.
 * Returns { start: number, end: number } or null if not found.
 */
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

/**
 * Update a single function in a source file.
 * Returns the updated source, or null if function not found.
 */
function updateFunctionInSource(source, name, newBody) {
    const bounds = findFunctionBounds(source, name);

    if (!bounds) {
        return null;
    }

    return (
        source.slice(0, bounds.start) +
        newBody +
        source.slice(bounds.end)
    );
}

/**
 * Find which src/ file contains a given function.
 * Returns the file path, or null if not found.
 */
function findFunctionInSrcFiles(functionName) {
    for (const srcFile of SRC_FILES) {
        const filePath = path.join(ROOT, srcFile);

        if (!fs.existsSync(filePath)) {
            continue;
        }

        const content = fs.readFileSync(filePath, "utf8");

        if (findFunctionBounds(content, functionName)) {
            return filePath;
        }
    }

    return null;
}

/**
 * Main sync logic
 */
function main() {
    const checkOnly = process.argv.includes("--check");

    if (!fs.existsSync(MONOLITH)) {
        console.error(
            `Error: Monolith file not found: ${MONOLITH}`
        );
        process.exit(1);
    }

    const monolithSource = fs.readFileSync(MONOLITH, "utf8");
    const monolithFunctions = extractTopLevelFunctions(monolithSource);

    console.log(`Found ${monolithFunctions.size} functions in monolith`);

    let updatedCount = 0;
    let notFoundCount = 0;
    const updates = new Map(); // srcFile -> { content, changes: [] }

    // Process each function from monolith
    for (const [functionName, functionBody] of monolithFunctions) {
        const srcFile = findFunctionInSrcFiles(functionName);

        if (!srcFile) {
            console.log(`⚠ Function not found in any src/ file: ${functionName}`);
            notFoundCount++;
            continue;
        }

        if (!updates.has(srcFile)) {
            const content = fs.readFileSync(srcFile, "utf8");
            updates.set(srcFile, { content, changes: [] });
        }

        const updateEntry = updates.get(srcFile);
        updateEntry.content = updateFunctionInSource(
            updateEntry.content,
            functionName,
            functionBody
        );

        if (updateEntry.content === null) {
            console.log(`✗ Failed to update ${functionName} in ${srcFile}`);
            continue;
        }

        updateEntry.changes.push(functionName);
        updatedCount++;
    }

    // Report changes
    console.log(`\nUpdates to apply:`);
    let totalChanges = 0;

    for (const [srcFile, { changes }] of updates) {
        console.log(`  ${srcFile}: ${changes.length} function(s)`);
        totalChanges += changes.length;
    }

    if (checkOnly) {
        console.log(`\n✓ Check mode: ${totalChanges} update(s) ready to apply`);
        if (notFoundCount > 0) {
            console.log(`⚠ ${notFoundCount} function(s) not found in src/ files`);
        }
        process.exit(0);
    }

    // Write updates
    console.log(`\nWriting updates...`);
    for (const [srcFile, { content }] of updates) {
        fs.writeFileSync(srcFile, content, "utf8");
        console.log(`✓ Updated ${srcFile}`);
    }

    console.log(`\n✓ Sync complete: ${totalChanges} function(s) updated`);
    if (notFoundCount > 0) {
        console.log(`⚠ ${notFoundCount} function(s) not found in src/ files`);
    }
}

main();
