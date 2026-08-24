/**
 * Static checks for post-visit feedback feature.
 * Run: node scripts/verify-post-visit-feedback.mjs
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

const feedback = read("src/Model_Feedback.gs");
const shared = read("src/Controller_Shared.gs");
const router = read("src/Controller_Router.gs");
const menus = read("src/View_Menus.gs");
const messages = read("src/View_Messages.gs");
const config = read("src/Config.gs");
const tests = read("ABC_Clinic_Tests.gs");
const sync = read("scripts/sync-monolith-from-src.js");

[
    "getFeedbackSettings",
    "sendPostVisitFeedbackRequests",
    "installPostVisitFeedbackTrigger",
    "findCompletedAppointmentForPhone",
    "logFeedbackResponse",
    "hasFeedbackRequestBeenSent"
].forEach(function (fn) {
    assert(
        `function ${fn} exists`,
        feedback.includes(`function ${fn}`),
        "missing in Model_Feedback.gs"
    );
});

[
    "parseFeedbackRatingChoice",
    "handleWhatsAppFeedbackAction"
].forEach(function (fn) {
    assert(
        `function ${fn} exists`,
        shared.includes(`function ${fn}`),
        "missing in Controller_Shared.gs"
    );
});

[
    "buildPostVisitFeedbackMessage",
    "buildFeedbackThankYouMessage"
].forEach(function (fn) {
    assert(
        `function ${fn} exists`,
        messages.includes(`function ${fn}`),
        "missing in View_Messages.gs"
    );
});

assert(
    "feedback rating list spec",
    menus.includes("getPostVisitFeedbackRatingSpec") &&
        menus.includes("feedback_rate_5_"),
    "missing in View_Menus.gs"
);

[
    "ENABLE_POST_VISIT_FEEDBACK",
    "FEEDBACK_HOURS_AFTER",
    "CLINIC_REVIEW_URL"
].forEach(function (key) {
    assert(
        `Settings key ${key}`,
        config.includes(`"${key}"`),
        "missing in Config.gs"
    );
});

assert(
    "Model_Feedback in sync script",
    sync.includes("src/Model_Feedback.gs"),
    "missing from sync-monolith-from-src.js"
);

const processIdx = router.indexOf(
    "function processWhatsAppTextMessage"
);
const processBody = router.slice(
    processIdx,
    processIdx + 2800
);
const waitlistIdx = processBody.indexOf(
    "handleWhatsAppWaitlistOfferAction"
);
const feedbackIdx = processBody.indexOf(
    "handleWhatsAppFeedbackAction"
);
const reminderIdx = processBody.indexOf(
    "handleWhatsAppReminderAction"
);
const greetingIdx = processBody.indexOf(
    "handleWhatsAppGreeting"
);

assert(
    "router handles feedback before reminder actions",
    waitlistIdx !== -1 &&
        feedbackIdx !== -1 &&
        reminderIdx !== -1 &&
        greetingIdx !== -1 &&
        waitlistIdx < feedbackIdx &&
        feedbackIdx < reminderIdx &&
        reminderIdx < greetingIdx,
    "wrong router order"
);

assert(
    "feedback only targets completed appointments",
    feedback.includes("APPOINTMENT_STATUS.COMPLETED"),
    "missing completed status check"
);

assert(
    "review link in thank-you message",
    messages.includes("Google review"),
    "missing review prompt"
);

assert(
    "runtime smoke test registered",
    tests.includes("testPostVisitFeedback"),
    "missing test"
);

if (failures.length > 0) {
    console.error("verify-post-visit-feedback: FAILED");
    failures.forEach(function (item) {
        console.error(" - " + item.name + ": " + item.detail);
    });
    process.exit(1);
}

console.log("verify-post-visit-feedback: all checks passed");
