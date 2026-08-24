/**
 * Static patient/doctor flow coverage checks (no Apps Script deploy).
 * Run: node scripts/verify-flow-coverage.mjs
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

function extractStates(src, pattern) {
    const states = new Set();
    let match;
    const re = new RegExp(pattern, "g");
    while ((match = re.exec(src)) !== null) {
        states.add(match[1]);
    }
    return states;
}

const patientFlow = read("src/Controller_PatientFlow.gs");
const doctorFlow = read("src/Controller_DoctorFlow.gs");
const shared = read("src/Controller_Shared.gs");
const router = read("src/Controller_Router.gs");

const patientStates = extractStates(
    patientFlow,
    'state === "([A-Z_]+)"'
);
const doctorStates = extractStates(
    doctorFlow,
    'state === "([A-Z_]+)"'
);
const patientBackStates = extractStates(
    shared,
    'case "([A-Z_]+)":[\\s\\S]*?goBackInWhatsAppFlow'
);
const doctorBackStates = extractStates(
    shared,
    'case "([A-Z_]+)":[\\s\\S]*?goBackInDoctorWhatsAppFlow'
);

// Re-parse goBack switches more reliably
function extractGoBackCases(fnName, src) {
    const fnStart = src.indexOf(`function ${fnName}`);
    const switchStart = src.indexOf("switch (session.state)", fnStart);
    const switchBody = src.slice(switchStart, switchStart + 12000);
    return extractStates(switchBody, 'case "([A-Z_]+)":');
}

const patientBack = extractGoBackCases(
    "goBackInWhatsAppFlow",
    shared
);
const doctorBack = extractGoBackCases(
    "goBackInDoctorWhatsAppFlow",
    shared
);

const expectedPatientStates = [
    "LANGUAGE_SELECT",
    "LANGUAGE_CHANGE",
    "MAIN_MENU",
    "PATIENT_MAIN_MORE",
    "MY_APPOINTMENTS",
    "BOOK_DOCTOR",
    "BOOK_DATE",
    "BOOK_DATE_CUSTOM",
    "BOOK_NAME",
    "BOOK_CONFIRM",
    "BOOK_TIME",
    "CANCEL_SELECT",
    "CANCEL_CONFIRM",
    "RESCHEDULE_SELECT",
    "RESCHEDULE_DATE",
    "RESCHEDULE_DATE_CUSTOM",
    "RESCHEDULE_TIME",
    "RESCHEDULE_CONFIRM"
];

const expectedDoctorStates = [
    "DOCTOR_MENU",
    "DOCTOR_MENU_MORE",
    "DOCTOR_AVAIL_MENU",
    "DOCTOR_AVAIL_DAY_MENU",
    "DOCTOR_AVAIL_REMOVE",
    "DOCTOR_AVAIL_START",
    "DOCTOR_AVAIL_END",
    "DOCTOR_AVAIL_CONFIRM",
    "DOCTOR_CANCEL_SELECT",
    "DOCTOR_CANCEL_CONFIRM",
    "DOCTOR_STATUS_SELECT",
    "DOCTOR_STATUS_ACTION",
    "DOCTOR_RESCHEDULE_SELECT",
    "DOCTOR_RESCHEDULE_DATE",
    "DOCTOR_RESCHEDULE_DATE_CUSTOM",
    "DOCTOR_RESCHEDULE_TIME",
    "DOCTOR_RESCHEDULE_CONFIRM",
    "DOCTOR_LEAVE_MENU",
    "DOCTOR_LEAVE_DATE",
    "DOCTOR_LEAVE_REASON",
    "DOCTOR_LEAVE_CONFIRM",
    "DOCTOR_LEAVE_CANCEL_PICK",
    "DOCTOR_LEAVE_RANGE_START",
    "DOCTOR_LEAVE_RANGE_END",
    "DOCTOR_LEAVE_RANGE_REASON",
    "DOCTOR_LEAVE_RANGE_CONFIRM",
    "DOCTOR_DATE",
    "DOCTOR_DATE_CUSTOM"
];

for (const state of expectedPatientStates) {
    assert(
        `patient handler covers ${state}`,
        patientStates.has(state),
        `missing in Controller_PatientFlow.gs`
    );
}

for (const state of expectedDoctorStates) {
    assert(
        `doctor handler covers ${state}`,
        doctorStates.has(state),
        `missing in Controller_DoctorFlow.gs`
    );
}

// Router order: greeting → nav → doctor → patient
const processIdx = router.indexOf("function processWhatsAppTextMessage");
const processBody = router.slice(processIdx, processIdx + 2500);
const greetingIdx = processBody.indexOf("handleWhatsAppGreeting");
const navIdx = processBody.indexOf("handleWhatsAppUniversalNavigation");
const doctorIdx = processBody.indexOf("handleWhatsAppDoctorMessage");
const patientIdx = processBody.indexOf("handleWhatsAppPatientMessage");

assert(
    "router order greeting → nav → doctor → patient",
    greetingIdx !== -1 &&
        navIdx > greetingIdx &&
        doctorIdx > navIdx &&
        patientIdx > doctorIdx,
    "unexpected dispatch order"
);

const reminderIdx = processBody.indexOf(
    "handleWhatsAppReminderAction"
);

assert(
    "router order reminder → greeting",
    reminderIdx !== -1 &&
        greetingIdx !== -1 &&
        reminderIdx < greetingIdx,
    "reminder actions must run before greeting"
);

// Doctor menu: 9 excluded from universal back (reschedule on main menu)
assert(
    "DOCTOR_MENU excluded from universal 9",
    /state !== "DOCTOR_MENU"[\s\S]*normalizedMessage === "9"/.test(router),
    "typed 9 on doctor main must mean reschedule"
);

// Key shared helpers wired
[
    "handleWhatsAppMyAppointmentsState",
    "handleWhatsAppCancelSelectState",
    "handleWhatsAppRescheduleSelectState",
    "handleDoctorPortalMenuChoice",
    "isDoctorMenuChoiceAllowedForTier",
    "sendCancelConfirmMenuReply",
    "sendRescheduleConfirmMenuReply",
    "sendPatientAppointmentListMenuReply"
].forEach(function (fn) {
    const inShared = shared.includes(`function ${fn}`);
    const inSend = read("src/WhatsApp_Send.gs").includes(`function ${fn}`);
    assert(
        `helper ${fn} exists`,
        inShared || inSend,
        "missing function definition"
    );
});

assert(
    "buildDoctorSelectionBody exists",
    read("src/View_Messages.gs").includes("function buildDoctorSelectionBody"),
    "missing in View_Messages.gs"
);

assert(
    "getAppointmentListPageInfo exists",
    read("src/View_Menus.gs").includes("function getAppointmentListPageInfo"),
    "missing in View_Menus.gs"
);

assert(
    "returnToPatientMainMore exists",
    shared.includes("function returnToPatientMainMore"),
    "missing in Controller_Shared.gs"
);

assert(
    "cancel/reschedule back returns to More",
    /case "CANCEL_SELECT":[\s\S]*?returnToPatientMainMore/.test(shared),
    "missing goBack handler"
);

assert(
    "appointment list paging uses slotPage not apptPage",
    !shared.includes("apptPage") &&
        shared.includes("getAppointmentListPageInfo"),
    "stale apptPage reference"
);

assert(
    "welcome image skips duplicate after language pick",
    read("src/Controller_PatientFlow.gs").includes("skipWelcomeImage: true"),
    "missing skipWelcomeImage"
);

// listScreen call sites use known screens
const listCallRe =
    /sendPatientAppointmentListMenuReply\(\s*[\s\S]*?,\s*"(my_appointments|cancel|reschedule)"/g;
const listCalls = [...shared.matchAll(listCallRe), ...patientFlow.matchAll(listCallRe)];
assert(
    "patient appointment list uses listScreen ids",
    listCalls.length >= 4,
    `found ${listCalls.length} typed listScreen calls`
);

// Back-nav coverage for multi-step patient flows
[
    "BOOK_DATE",
    "BOOK_TIME",
    "BOOK_CONFIRM",
    "CANCEL_SELECT",
    "CANCEL_CONFIRM",
    "RESCHEDULE_SELECT",
    "RESCHEDULE_DATE",
    "RESCHEDULE_TIME",
    "RESCHEDULE_CONFIRM",
    "MY_APPOINTMENTS"
].forEach(function (state) {
    assert(
        `patient back nav defines ${state}`,
        patientBack.has(state),
        "missing goBackInWhatsAppFlow case"
    );
});

[
    "DOCTOR_MENU_MORE",
    "DOCTOR_RESCHEDULE_DATE",
    "DOCTOR_RESCHEDULE_TIME",
    "DOCTOR_RESCHEDULE_CONFIRM",
    "DOCTOR_CANCEL_CONFIRM"
].forEach(function (state) {
    assert(
        `doctor back nav defines ${state}`,
        doctorBack.has(state),
        "missing goBackInDoctorWhatsAppFlow case"
    );
});

if (failures.length === 0) {
    console.log("verify-flow-coverage: all checks passed");
    console.log(
        `  patient states: ${patientStates.size}, doctor states: ${doctorStates.size}`
    );
    console.log(
        `  patient back cases: ${patientBack.size}, doctor back cases: ${doctorBack.size}`
    );
    process.exit(0);
}

console.error("verify-flow-coverage: FAILED\n");
for (const f of failures) {
    console.error(`  ✗ ${f.name}`);
    if (f.detail) {
        console.error(`    ${f.detail.trim()}`);
    }
}
process.exit(1);
