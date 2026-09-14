/**
 * Static checks for patient/doctor interactive menu flows (no Apps Script deploy).
 * Run: node scripts/verify-menu-flows.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

// Checks run against the monolith, which is what actually gets deployed.
// Apps Script merges every .gs file into one global scope, so the old
// per-file reads were only ever a convenience.
const MONOLITH = fs.readFileSync(
    path.join(ROOT, "ABC_Clinic_WhatsApp_Complete.gs"),
    "utf8"
);

function read(relPath) {
    // Flow logic is checked against the monolith; other files are read as-is.
    if (!relPath || relPath.startsWith("legacy/src-archive/")) {
        return MONOLITH;
    }

    return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

const failures = [];

function assert(name, condition, detail) {
    if (!condition) {
        failures.push({ name, detail: detail || "failed" });
    }
}

function mustInclude(file, pattern, label) {
    const src = read(file);
    const ok =
        pattern instanceof RegExp
            ? pattern.test(src)
            : src.includes(pattern);
    assert(label || `${file} includes ${pattern}`, ok);
}

// --- Patient main menu (regression) ---
mustInclude(
    "legacy/src-archive/View_Menus.gs",
    /function getPatientMainMenuSpec[\s\S]*?id:\s*"menu_more"/,
    "patient main menu has menu_more button"
);
mustInclude(
    "legacy/src-archive/Controller_PatientFlow.gs",
    'state === "PATIENT_MAIN_MORE"',
    "patient PATIENT_MAIN_MORE state handler"
);
mustInclude(
    "legacy/src-archive/Controller_PatientFlow.gs",
    'state === "MY_APPOINTMENTS"',
    "patient MY_APPOINTMENTS state handler"
);
mustInclude(
    "legacy/src-archive/Controller_Shared.gs",
    "function whatsAppNavigationShowsBack",
    "smart navigation back detection"
);
mustInclude(
    "legacy/src-archive/View_Menus.gs",
    /appendWhatsAppHomeNavRow[\s\S]*?nav_main_menu[\s\S]*?Doctor Portal/,
    "appointment lists use home nav only"
);
mustInclude(
    "legacy/src-archive/WhatsApp_Send.gs",
    "function sendCancelConfirmMenuReply",
    "cancel confirm menu sender"
);
mustInclude(
    "legacy/src-archive/View_Messages.gs",
    "function buildMyAppointmentsListBody",
    "my appointments screen body builder"
);
mustInclude(
    "legacy/src-archive/View_Menus.gs",
    "formatAppointmentListRowDescription",
    "formatted appointment list row dates"
);

// --- Doctor button sub-menu ---
mustInclude(
    "legacy/src-archive/View_Menus.gs",
    /function getDoctorMainMenuSpec[\s\S]*?buildInteractiveButtonSpec[\s\S]*?menu_more/,
    "doctor main menu is 3-button spec with menu_more"
);
mustInclude(
    "legacy/src-archive/View_Menus.gs",
    "function getDoctorMainMenuMoreSpec(tier)",
    "doctor more menu spec by tier"
);
mustInclude(
    "legacy/src-archive/View_Menus.gs",
    'id: "doctor_reschedule"',
    "doctor tier-4 reschedule semantic id"
);
mustInclude(
    "legacy/src-archive/View_Menus.gs",
    'id: "doctor_status"',
    "doctor tier-4 status semantic id"
);
mustInclude(
    "legacy/src-archive/WhatsApp_Send.gs",
    "function sendDoctorMainMenuMoreReply",
    "sendDoctorMainMenuMoreReply helper"
);
mustInclude(
    "legacy/src-archive/Controller_DoctorFlow.gs",
    'state === "DOCTOR_MENU_MORE"',
    "doctor DOCTOR_MENU_MORE state handler"
);
mustInclude(
    "legacy/src-archive/Controller_Shared.gs",
    "function handleDoctorPortalMenuChoice",
    "shared doctor menu choice handler"
);
mustInclude(
    "legacy/src-archive/Controller_Shared.gs",
    "function isDoctorMenuChoiceAllowedForTier",
    "tier-gated doctor more menu choices"
);
mustInclude(
    "legacy/src-archive/Controller_Shared.gs",
    'case "DOCTOR_MENU_MORE":',
    "doctor back nav for DOCTOR_MENU_MORE"
);
mustInclude(
    "legacy/src-archive/Controller_Shared.gs",
    /doctor_reschedule[\s\S]*return "9"/,
    "normalizeDoctorMenuChoice maps doctor_reschedule → 9"
);

// --- Router: DOCTOR_MENU still exempt from universal 9 (option 9 = reschedule on main) ---
const router = read("legacy/src-archive/Controller_Router.gs");
assert(
    "router exempts DOCTOR_MENU from universal 9",
    /state !== "DOCTOR_MENU"[\s\S]*normalizedMessage === "9"/.test(router),
    "DOCTOR_MENU must stay excluded so typed 9 triggers reschedule"
);
assert(
    "DOCTOR_MENU_MORE uses universal 9 for back",
    router.includes('state !== "DOCTOR_MENU"') &&
        !router.includes('state !== "DOCTOR_MENU_MORE"'),
    "DOCTOR_MENU_MORE should NOT be excluded (9 = back on sub-menus)"
);

// --- Tests updated ---
mustInclude(
    "ABC_Clinic_Tests.gs",
    "doctor main menu spec should be 3-button menu",
    "testInteractiveMenus expects doctor buttons"
);
mustInclude(
    "ABC_Clinic_Tests.gs",
    "doctor_reschedule",
    "tests cover doctor semantic ids"
);

// --- Sync guard ---
// The monolith is the source of truth. The sync script must either run clean
// or refuse outright; it must never quietly drop monolith-only functions.
const sync = spawnSync(
    process.execPath,
    ["scripts/sync-monolith-from-src.js", "--check"],
    { cwd: ROOT, encoding: "utf8" }
);

const syncOutput = (sync.stdout || "") + (sync.stderr || "");

assert(
    "sync script is clean or refuses to drop functions",
    sync.status === 0 || syncOutput.includes("Refusing to sync"),
    `exit ${sync.status}: ${syncOutput.trim().slice(0, 400)}`
);

if (failures.length === 0) {
    console.log("verify-menu-flows: all checks passed");
    process.exit(0);
}

console.error("verify-menu-flows: FAILED\n");
for (const f of failures) {
    console.error(`  ✗ ${f.name}`);
    if (f.detail) {
        console.error(`    ${f.detail.trim()}`);
    }
}
process.exit(1);
