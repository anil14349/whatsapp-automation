/**
 * Static checks for visit type / service selection feature.
 * Run: node scripts/verify-visit-type.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

function read(relPath) {
    return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

const failures = [];

function assert(name, condition, detail) {
    if (!condition) {
        failures.push({ name, detail: detail || "failed" });
    }
}

const services = read("src/Model_Services.gs");
const patientFlow = read("src/Controller_PatientFlow.gs");
const shared = read("src/Controller_Shared.gs");
const menus = read("src/View_Menus.gs");
const messages = read("src/View_Messages.gs");
const appointments = read("src/Model_Appointments.gs");
const calendar = read("src/Model_Calendar.gs");
const session = read("src/Model_Session.gs");
const config = read("src/Config.gs");
const tests = read("ABC_Clinic_Tests.gs");
const sync = read("scripts/sync-monolith-from-src.js");

[
    "getVisitTypeSettings",
    "ensureServicesSheet",
    "getActiveServices",
    "resolveBookingDurationMinutes",
    "getAvailableSlotsForBooking",
    "shouldOfferVisitTypeSelection"
].forEach(function (fn) {
    assert(
        `function ${fn} exists`,
        services.includes(`function ${fn}`),
        "missing in Model_Services.gs"
    );
});

[
    "getVisitTypeSelectionMenuSpec",
    "buildVisitTypeSelectionFallbackText"
].forEach(function (fn) {
    const inMenus = menus.includes(`function ${fn}`);
    const inMessages = messages.includes(`function ${fn}`);
    assert(
        `function ${fn} exists`,
        inMenus || inMessages,
        "missing menu/message helper"
    );
});

assert(
    "patient flow handles BOOK_SERVICE",
    patientFlow.includes("BOOK_SERVICE") &&
        patientFlow.includes("getVisitTypeSelectionMenuSpec"),
    "missing handler"
);

assert(
    "bookAppointment accepts serviceId",
    appointments.includes("serviceId") &&
        appointments.includes("resolveBookingDurationMinutes"),
    "missing in Model_Appointments.gs"
);

assert(
    "getAvailableSlots accepts custom duration",
    calendar.includes("durationMinutes"),
    "missing in Model_Calendar.gs"
);

assert(
    "session stores serviceId",
    session.includes("serviceId") &&
        session.includes("Service ID"),
    "missing in Model_Session.gs"
);

assert(
    "confirmation shows visit type",
    messages.includes("getServiceDisplayName") &&
        /buildBookingConfirmationMessage[\s\S]*?visitType/.test(
            messages
        ),
    "missing in buildBookingConfirmationMessage"
);

assert(
    "visit type back nav",
    /case "BOOK_SERVICE":[\s\S]*?BOOK_DOCTOR/.test(shared) &&
        /case "BOOK_DATE":[\s\S]*?BOOK_SERVICE/.test(shared),
    "missing goBack handlers"
);

assert(
    "ENABLE_VISIT_TYPE_SELECTION setting",
    config.includes("ENABLE_VISIT_TYPE_SELECTION"),
    "missing in Config.gs"
);

assert(
    "Model_Services in sync script",
    sync.includes("src/Model_Services.gs"),
    "missing from sync-monolith-from-src.js"
);

assert(
    "runtime smoke test registered",
    tests.includes("testVisitTypeSelection"),
    "missing test"
);

if (failures.length > 0) {
    console.error("verify-visit-type: FAILED");
    failures.forEach(function (item) {
        console.error(" - " + item.name + ": " + item.detail);
    });
    process.exit(1);
}

console.log("verify-visit-type: all checks passed");
