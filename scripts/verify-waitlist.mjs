/**
 * Static checks for appointment waitlist / slot-alert feature.
 * Run: node scripts/verify-waitlist.mjs
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

const waitlist = read("src/Model_Waitlist.gs");
const shared = read("src/Controller_Shared.gs");
const router = read("src/Controller_Router.gs");
const menus = read("src/View_Menus.gs");
const messages = read("src/View_Messages.gs");
const patientFlow = read("src/Controller_PatientFlow.gs");
const appointments = read("src/Model_Appointments.gs");
const config = read("src/Config.gs");
const tests = read("ABC_Clinic_Tests.gs");
const sync = read("scripts/sync-monolith-from-src.js");

[
    "getWaitlistSettings",
    "ensureWaitlistSheet",
    "ensureSlotOfferSheet",
    "addPatientToWaitlist",
    "findActiveWaitlistPatients",
    "notifyWaitlistForOpenedSlot",
    "acceptWaitlistSlotOffer",
    "buildOpenedSlotFromAppointmentRow"
].forEach(function (fn) {
    assert(
        `function ${fn} exists`,
        waitlist.includes(`function ${fn}`),
        "missing in Model_Waitlist.gs"
    );
});

[
    "parseWaitlistOfferChoice",
    "handleWhatsAppWaitlistOfferAction"
].forEach(function (fn) {
    assert(
        `function ${fn} exists`,
        shared.includes(`function ${fn}`),
        "missing in Controller_Shared.gs"
    );
});

[
    "buildWaitlistJoinIntro",
    "buildWaitlistOfferMessage"
].forEach(function (fn) {
    assert(
        `function ${fn} exists`,
        messages.includes(`function ${fn}`),
        "missing in View_Messages.gs"
    );
});

assert(
    "More menu includes Slot alerts",
    menus.includes("menu_waitlist") &&
        menus.includes("Slot alerts"),
    "missing list row"
);

assert(
    "waitlist offer button spec",
    menus.includes("getWaitlistOfferButtonSpec") &&
        menus.includes("waitlist_accept_"),
    "missing button spec"
);

assert(
    "patient flow handles menu_waitlist",
    patientFlow.includes("menu_waitlist") &&
        patientFlow.includes("WAITLIST_DOCTOR") &&
        patientFlow.includes("addPatientToWaitlist"),
    "missing handler"
);

assert(
    "cancel triggers waitlist notify",
    appointments.includes("notifyWaitlistForOpenedSlot") &&
        appointments.includes("buildOpenedSlotFromAppointmentRow"),
    "missing cancel hook"
);

assert(
    "waitlist settings in Config",
    config.includes("ENABLE_APPOINTMENT_WAITLIST") &&
        config.includes("WAITLIST_NOTIFY_COUNT"),
    "missing settings"
);

assert(
    "Model_Waitlist in sync script",
    sync.includes("src/Model_Waitlist.gs"),
    "missing from sync-monolith-from-src.js"
);

const processIdx = router.indexOf(
    "function processWhatsAppTextMessage"
);
const processBody = router.slice(
    processIdx,
    processIdx + 2500
);
const waitlistIdx = processBody.indexOf(
    "handleWhatsAppWaitlistOfferAction"
);
const reminderIdx = processBody.indexOf(
    "handleWhatsAppReminderAction"
);
const greetingIdx = processBody.indexOf(
    "handleWhatsAppGreeting"
);

assert(
    "router handles waitlist offers before reminder actions",
    waitlistIdx !== -1 &&
        reminderIdx !== -1 &&
        greetingIdx !== -1 &&
        waitlistIdx < reminderIdx &&
        reminderIdx < greetingIdx,
    "wrong router order"
);

assert(
    "waitlist back nav returns to More",
    /case "WAITLIST_DOCTOR":[\s\S]*?returnToPatientMainMore/.test(
        shared
    ),
    "missing goBack handler"
);

assert(
    "runtime smoke test registered",
    tests.includes("testWaitlist"),
    "missing test"
);

if (failures.length > 0) {
    console.error("verify-waitlist: FAILED");
    failures.forEach(function (item) {
        console.error(" - " + item.name + ": " + item.detail);
    });
    process.exit(1);
}

console.log("verify-waitlist: all checks passed");
