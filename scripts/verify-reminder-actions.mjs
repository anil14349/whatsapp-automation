/**
 * Static checks for reminder action buttons feature.
 * Run: node scripts/verify-reminder-actions.mjs
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

const reminders = read("src/Model_Reminders.gs");
const shared = read("src/Controller_Shared.gs");
const router = read("src/Controller_Router.gs");
const menus = read("src/View_Menus.gs");
const config = read("src/Config.gs");
const tests = read("ABC_Clinic_Tests.gs");

const processIdx = router.indexOf(
    "function processWhatsAppTextMessage"
);
const processBody = router.slice(
    processIdx,
    processIdx + 2500
);
const reminderIdx = processBody.indexOf(
    "handleWhatsAppReminderAction"
);
const greetingIdx = processBody.indexOf(
    "handleWhatsAppGreeting"
);

[
    "getAppointmentReminderButtonSpec",
    "parseReminderButtonChoice",
    "handleWhatsAppReminderAction",
    "findConfirmedAppointmentForPhone",
    "buildReminderConfirmAckMessage",
    "logReminderPatientResponse"
].forEach(function (fn) {
    const inReminders = reminders.includes(`function ${fn}`);
    const inShared = shared.includes(`function ${fn}`);
    const inMenus = menus.includes(`function ${fn}`);
    assert(
        `function ${fn} exists`,
        inReminders || inShared || inMenus,
        "missing"
    );
});

assert(
    "router handles reminder actions before greeting",
    reminderIdx !== -1 &&
        greetingIdx !== -1 &&
        reminderIdx < greetingIdx,
    "wrong router order"
);

assert(
    "reminder send uses interactive buttons",
    reminders.includes("getAppointmentReminderButtonSpec") &&
        reminders.includes("sendWhatsAppInteractiveMessage"),
    "interactive reminder send missing"
);

assert(
    "ENABLE_REMINDER_ACTION_BUTTONS setting",
    config.includes("ENABLE_REMINDER_ACTION_BUTTONS"),
    "missing setting"
);

assert(
    "reminder buttons encode appointment id",
    menus.includes("reminder_confirm_") &&
        menus.includes("reminder_cancel_") &&
        menus.includes("reminder_reschedule_"),
    "button ids missing"
);

assert(
    "runtime smoke test registered",
    tests.includes("testReminderActionButtons"),
    "missing test"
);

if (failures.length > 0) {
    console.error("verify-reminder-actions: FAILED");
    failures.forEach(function (item) {
        console.error(" - " + item.name + ": " + item.detail);
    });
    process.exit(1);
}

console.log("verify-reminder-actions: all checks passed");
