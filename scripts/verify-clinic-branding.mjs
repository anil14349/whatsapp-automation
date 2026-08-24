/**
 * Static checks for clinic branding / contact feature.
 * Run: node scripts/verify-clinic-branding.mjs
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

const config = read("src/Config.gs");
const menus = read("src/View_Menus.gs");
const messages = read("src/View_Messages.gs");
const patientFlow = read("src/Controller_PatientFlow.gs");
const send = read("src/WhatsApp_Send.gs");
const tests = read("ABC_Clinic_Tests.gs");

[
    "CLINIC_ADDRESS",
    "CLINIC_PHONE",
    "CLINIC_MAP_URL"
].forEach(function (key) {
    assert(
        `Settings key ${key}`,
        config.includes(`"${key}"`),
        "missing in Config.gs"
    );
});

[
    "getClinicBrandingSettings",
    "buildClinicContactMessage"
].forEach(function (fn) {
    assert(
        `function ${fn}`,
        messages.includes(`function ${fn}`),
        "missing in View_Messages.gs"
    );
});

assert(
    "sendClinicContactReply helper",
    send.includes("function sendClinicContactReply"),
    "missing in WhatsApp_Send.gs"
);

assert(
    "More menu includes Contact & Location",
    menus.includes("menu_contact") &&
        menus.includes("Contact & Location"),
    "missing list row"
);

assert(
    "patient flow handles menu_contact",
    patientFlow.includes("menu_contact") &&
        patientFlow.includes("sendClinicContactReply"),
    "missing handler"
);

assert(
    "More menu uses list spec",
    /getPatientMainMoreMenuSpec[\s\S]*?buildInteractiveListSpec/.test(
        menus
    ),
    "More menu should be a list"
);

assert(
    "runtime smoke test registered",
    tests.includes("testClinicBranding"),
    "missing test"
);

if (failures.length > 0) {
    console.error("verify-clinic-branding: FAILED");
    failures.forEach(function (item) {
        console.error(" - " + item.name + ": " + item.detail);
    });
    process.exit(1);
}

console.log("verify-clinic-branding: all checks passed");
