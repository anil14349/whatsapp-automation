/**
 * Static checks for owner daily digest feature.
 * Run: node scripts/verify-owner-digest.mjs
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

const ownerDigest = read("src/Model_OwnerDigest.gs");
const viewMessages = read("src/View_Messages.gs");
const config = read("src/Config.gs");
const syncScript = read("scripts/sync-monolith-from-src.js");
const tests = read("ABC_Clinic_Tests.gs");

[
    "getOwnerDigestSettings",
    "collectOwnerDigestStats",
    "sendOwnerDailyDigest",
    "installOwnerDailyDigestTrigger",
    "buildOwnerDailyDigestMessage",
    "hasOwnerDigestBeenSent",
    "markOwnerDigestSent"
].forEach(function (fn) {
    assert(
        `function ${fn} exists`,
        ownerDigest.includes(`function ${fn}`) ||
            viewMessages.includes(`function ${fn}`),
        "missing"
    );
});

[
    "ENABLE_OWNER_DAILY_DIGEST",
    "CLINIC_OWNER_PHONE",
    "OWNER_DIGEST_HOUR",
    "CLINIC_NAME"
].forEach(function (key) {
    assert(
        `Settings key ${key}`,
        config.includes(`"${key}"`),
        "missing in Config.gs"
    );
});

assert(
    "sync includes Model_OwnerDigest.gs",
    syncScript.includes("Model_OwnerDigest.gs"),
    "sync script not updated"
);

assert(
    "digest message includes today and tomorrow",
    viewMessages.includes("📅 Today") &&
        viewMessages.includes("📅 Tomorrow"),
    "message sections missing"
);

assert(
    "reminder-style dedup log sheet",
    ownerDigest.includes("Owner_Digest_Log"),
    "missing dedup log"
);

assert(
    "runtime smoke test registered",
    tests.includes("testOwnerDailyDigest"),
    "missing ABC_Clinic_Tests.gs test"
);

if (failures.length > 0) {
    console.error("verify-owner-digest: FAILED");
    failures.forEach(function (item) {
        console.error(" - " + item.name + ": " + item.detail);
    });
    process.exit(1);
}

console.log("verify-owner-digest: all checks passed");
