// ============================================================
// DOCTOR APPOINTMENT SYSTEM
// Google Sheets + Google Calendar
// ============================================================
//
// SHEETS REQUIRED:
//
// Doctors
//   Doctor ID | Doctor Name | Clinic | Calendar ID | WhatsApp | AppointmentDuration
//
// Availability
//   Doctor ID | Day | Start | End
//
// Doctor_Leaves
//   Doctor ID | Date | Reason | Active
//
// Doctor self-service (WhatsApp): options 5–10 in Doctor Portal
//   5 Manage Availability — multiple sessions per day (Availability sheet)
//   6 Manage Leaves — single day or date range (Doctor_Leaves sheet)
//   7 My Patients — unique patients seen (derived from Appointments)
//   8 Cancel Patient Appointment
//   9 Reschedule Patient Appointment
//  10 Mark Visit Status (Completed / No-Show)
//
// Appointments
//   Appointment ID | Date | Time | Doctor ID | Patient Name |
//   Phone | Status | Calendar Event ID | Patient ID
//
// Patients
//   Patient ID | Phone | Name | Language | First Seen | Last Visit | Notes
//
// WhatsApp_Sessions (col 10: Patient Name during booking)
//
// Settings (auto-created) — log retention & toggles
//   Key | Value
//   LOG_RETENTION week|month|quarter|halfyear|year|none
//   LOG_MAX_ROWS | 5000
//   LOG_MESSAGE_MAX_CHARS | 500
//   ENABLE_INBOUND_LOG | TRUE
//   ENABLE_DEBUG_LOG | TRUE
//   ENABLE_APPOINTMENT_REMINDERS | TRUE
//   REMINDER_HOURS_BEFORE | 24
//   REMINDER_WINDOW_MINUTES | 45
//   ENABLE_REMINDER_ACTION_BUTTONS | TRUE
//   ENABLE_APPOINTMENT_WAITLIST | TRUE
//   WAITLIST_NOTIFY_COUNT | 3
//   ENABLE_POST_VISIT_FEEDBACK | TRUE
//   ENABLE_VISIT_TYPE_SELECTION | TRUE
//   FEEDBACK_HOURS_AFTER | 2
//   FEEDBACK_WINDOW_MINUTES | 45
//   FEEDBACK_MIN_RATING_FOR_REVIEW | 4
//   CLINIC_REVIEW_URL | (optional Google review link)
//   ENABLE_INTERACTIVE_MENUS | TRUE
//   AUTO_COMPLETE_PAST_APPOINTMENTS | FALSE
//   AUTO_COMPLETE_HOURS_AFTER | 4
//   ENABLE_AFTER_HOURS_REPLY | FALSE
//   CLINIC_OPEN_TIME | 09:00
//   CLINIC_CLOSE_TIME | 18:00
//   CLINIC_WORKING_DAYS | Mon,Tue,Wed,Thu,Fri,Sat
//   AFTER_HOURS_MESSAGE | (optional custom text)
//   CLINIC_WELCOME_IMAGE_URL | (optional public HTTPS URL — e.g. https://your-domain.com/clinic-welcome.png from landing/public/)
//   CLINIC_NAME | ABC Clinic
//   CLINIC_ADDRESS | (optional clinic address)
//   CLINIC_PHONE | (optional clinic phone for patients)
//   CLINIC_MAP_URL | (optional Google Maps link)
//   ENABLE_OWNER_DAILY_DIGEST | FALSE
//   CLINIC_OWNER_PHONE | (owner WhatsApp for daily summary)
//   OWNER_DIGEST_HOUR | 8
//
// Script Properties:
//   WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID (required)
//   WHATSAPP_VERIFY_TOKEN, WHATSAPP_WEBHOOK_POST_TOKEN (required — webhook
//     verification now fails closed if either is unset; there is no
//     hardcoded fallback token)
//   DEBUG_MODE, TEST_SKIP_WHATSAPP_SEND (optional, for ABC_Clinic_Tests.gs)
//
// Apps Script project files (all bound to the same project — Apps Script
// merges every .gs file into one shared global scope; file names/order
// don't matter to the runtime, only to humans reading the code):
//   src/Config.gs                 — constants, Settings sheet, debug/log-mode flags
//   src/Util_Common.gs            — phone/date/time parsing & formatting helpers
//   src/Logging.gs                — WhatsApp_Log / WhatsApp_Debug sheets, retention cleanup
//   src/Model_Reminders.gs        — appointment reminder scheduling & sending
//   src/Model_OwnerDigest.gs      — daily owner WhatsApp summary
//   src/Model_Waitlist.gs         — slot-alert waitlist and offer notifications
//   src/Model_Feedback.gs           — post-visit ratings and review link follow-up
//   src/Model_Services.gs           — visit type catalog and booking duration
//   src/Model_AppointmentStatus.gs — Completed/No-Show status workflow, auto-complete
//   src/Model_AfterHours.gs       — clinic-hours gate & after-hours auto-reply
//   src/Model_Doctors.gs          — doctor records, availability, leaves, schedule views
//   src/Model_Calendar.gs         — Calendar event lookup & slot availability engine
//   src/Model_Patients.gs         — Patients registry (find/upsert/sync)
//   src/Model_Appointments.gs     — book/cancel/reschedule, appointment lookups
//   src/Model_Session.gs          — WhatsApp_Sessions sheet read/write
//   src/Api.gs                   — api() HTTP-style dispatcher for external callers
//   src/Webhook.gs               — doGet/doPost entry points, inbound idempotency
//   src/View_Menus.gs             — interactive list/button menu specs
//   src/View_Messages.gs          — WhatsApp reply text builders & localization
//   src/Controller_Shared.gs      — flow helpers shared by patient & doctor state machines
//   src/Controller_Router.gs      — top-level message dispatch (greeting/navigation/router)
//   src/Controller_DoctorFlow.gs  — doctor-portal conversation state machine
//   src/Controller_PatientFlow.gs — patient conversation state machine
//   src/WhatsApp_Send.gs          — low-level WhatsApp Cloud API senders
//   ABC_Clinic_Tests.gs           — test functions (bind alongside, optional)
//
// ============================================================

const TIMEZONE = "Asia/Kolkata";

const LOG_SHEET_MAX_ROWS = 5000;

const LOG_SETTINGS_CACHE_KEY = "LOG_SETTINGS_CACHE";

const LOG_SETTINGS_CACHE_SECONDS = 300;

const WA_CURRENT_MESSAGE_ID_KEY = "WA_CURRENT_MESSAGE_ID";

const WA_OUTBOUND_PREFIX = "WA_OUTBOUND_";


const LOG_RETENTION_DAYS = {
    week: 7,
    month: 30,
    quarter: 90,
    quarterly: 90,
    halfyear: 182,
    halfyearly: 182,
    year: 365,
    yearly: 365,
    none: 0,
    forever: 0
};


const APPOINTMENT_STATUS = {
    CONFIRMED: "Confirmed",
    CANCELLED: "Cancelled",
    COMPLETED: "Completed",
    NO_SHOW: "No-Show"
};



function normalizeAppointmentStatus(value) {

    const raw =
        String(value || "")
            .trim()
            .toLowerCase();

    if (
        raw === "cancelled" ||
        raw === "canceled"
    ) {
        return APPOINTMENT_STATUS.CANCELLED;
    }

    if (raw === "completed") {
        return APPOINTMENT_STATUS.COMPLETED;
    }

    if (
        raw === "no-show" ||
        raw === "noshow" ||
        raw === "no show"
    ) {
        return APPOINTMENT_STATUS.NO_SHOW;
    }

    if (raw === "confirmed") {
        return APPOINTMENT_STATUS.CONFIRMED;
    }

    const trimmed =
        String(value || "").trim();

    return trimmed || APPOINTMENT_STATUS.CONFIRMED;
}



function isInactiveAppointmentStatus(status) {

    const normalized =
        normalizeAppointmentStatus(status);

    return (
        normalized === APPOINTMENT_STATUS.CANCELLED ||
        normalized === APPOINTMENT_STATUS.COMPLETED ||
        normalized === APPOINTMENT_STATUS.NO_SHOW
    );
}



function isHiddenAppointmentStatus(status) {

    return isInactiveAppointmentStatus(status);
}



function isConfirmedAppointmentStatus(status) {

    return (
        normalizeAppointmentStatus(status) ===
        APPOINTMENT_STATUS.CONFIRMED
    );
}



// ============================================================
// CONFIG & INFRASTRUCTURE
// ============================================================

function getScriptProperty(name, defaultValue) {

    const value =
        PropertiesService
            .getScriptProperties()
            .getProperty(name);

    if (value === null || value === undefined) {
        return defaultValue;
    }

    return value;
}


function isDebugMode() {

    return String(
        getScriptProperty("DEBUG_MODE", "false")
    ).toLowerCase() === "true";
}


function shouldSkipOutboundWhatsApp() {

    return (
        isDebugMode() &&
        String(
            getScriptProperty(
                "TEST_SKIP_WHATSAPP_SEND",
                "false"
            )
        ).toLowerCase() === "true"
    );
}



function interactiveMenusEnabled() {

    ensureSettingsSheet();

    return parseSettingsBoolean(
        getSetting(
            "ENABLE_INTERACTIVE_MENUS",
            "TRUE"
        ),
        true
    );
}



function requireDebugMode(functionName) {

    if (!isDebugMode()) {
        throw new Error(
            functionName +
            " requires DEBUG_MODE=true in Script Properties."
        );
    }
}



// Per-execution caches for the Settings sheet. Every getSetting() call
// used to trigger ensureSettingsSheet(), which (on the "sheet already
// exists" branch) re-reads the whole sheet ~9 times via ensureSettingKey,
// plus another full read inside getSetting itself — 10+ Sheets API
// reads per setting lookup. A single Apps Script execution (one webhook
// invocation) only needs to do this once; settings are edited by hand in
// the sheet UI, never written by this script, so caching for the
// lifetime of one execution cannot serve stale data across requests.
let _settingsSheetEnsured = false;

let _settingsValuesCache = null;


function ensureSettingsSheet() {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    let sheet =
        ss.getSheetByName("Settings");

    if (sheet && _settingsSheetEnsured) {
        return sheet;
    }

    if (!sheet) {

        sheet =
            ss.insertSheet("Settings");

        sheet.appendRow([
            "Key",
            "Value"
        ]);

        sheet.appendRow([
            "LOG_RETENTION",
            "month"
        ]);

        sheet.appendRow([
            "LOG_MAX_ROWS",
            String(LOG_SHEET_MAX_ROWS)
        ]);

        sheet.appendRow([
            "LOG_MESSAGE_MAX_CHARS",
            "500"
        ]);

        sheet.appendRow([
            "ENABLE_INBOUND_LOG",
            "TRUE"
        ]);

        sheet.appendRow([
            "ENABLE_DEBUG_LOG",
            "TRUE"
        ]);

        sheet.appendRow([
            "ENABLE_APPOINTMENT_REMINDERS",
            "TRUE"
        ]);

        sheet.appendRow([
            "REMINDER_HOURS_BEFORE",
            "24"
        ]);

        sheet.appendRow([
            "REMINDER_WINDOW_MINUTES",
            "45"
        ]);

        sheet.appendRow([
            "ENABLE_INTERACTIVE_MENUS",
            "TRUE"
        ]);

        sheet.appendRow([
            "AUTO_COMPLETE_PAST_APPOINTMENTS",
            "FALSE"
        ]);

        sheet.appendRow([
            "AUTO_COMPLETE_HOURS_AFTER",
            "4"
        ]);

        sheet.appendRow([
            "ENABLE_AFTER_HOURS_REPLY",
            "FALSE"
        ]);

        sheet.appendRow([
            "CLINIC_OPEN_TIME",
            "09:00"
        ]);

        sheet.appendRow([
            "CLINIC_CLOSE_TIME",
            "18:00"
        ]);

        sheet.appendRow([
            "CLINIC_WORKING_DAYS",
            "Mon,Tue,Wed,Thu,Fri,Sat"
        ]);

        sheet.appendRow([
            "AFTER_HOURS_MESSAGE",
            ""
        ]);

        sheet.appendRow([
            "CLINIC_WELCOME_IMAGE_URL",
            ""
        ]);

        sheet.appendRow([
            "CLINIC_NAME",
            "ABC Clinic"
        ]);

        sheet.appendRow([
            "CLINIC_ADDRESS",
            ""
        ]);

        sheet.appendRow([
            "CLINIC_PHONE",
            ""
        ]);

        sheet.appendRow([
            "CLINIC_MAP_URL",
            ""
        ]);

        sheet.appendRow([
            "ENABLE_OWNER_DAILY_DIGEST",
            "FALSE"
        ]);

        sheet.appendRow([
            "CLINIC_OWNER_PHONE",
            ""
        ]);

        sheet.appendRow([
            "OWNER_DIGEST_HOUR",
            "8"
        ]);

        sheet.appendRow([
            "ENABLE_REMINDER_ACTION_BUTTONS",
            "TRUE"
        ]);

        sheet.appendRow([
            "ENABLE_APPOINTMENT_WAITLIST",
            "TRUE"
        ]);

        sheet.appendRow([
            "WAITLIST_NOTIFY_COUNT",
            "3"
        ]);

        sheet.appendRow([
            "ENABLE_POST_VISIT_FEEDBACK",
            "TRUE"
        ]);

        sheet.appendRow([
            "FEEDBACK_HOURS_AFTER",
            "2"
        ]);

        sheet.appendRow([
            "FEEDBACK_WINDOW_MINUTES",
            "45"
        ]);

        sheet.appendRow([
            "FEEDBACK_MIN_RATING_FOR_REVIEW",
            "4"
        ]);

        sheet.appendRow([
            "CLINIC_REVIEW_URL",
            ""
        ]);

        sheet.appendRow([
            "ENABLE_VISIT_TYPE_SELECTION",
            "TRUE"
        ]);
    } else {
        ensureSettingKey(
            sheet,
            "ENABLE_APPOINTMENT_REMINDERS",
            "TRUE"
        );
        ensureSettingKey(
            sheet,
            "REMINDER_HOURS_BEFORE",
            "24"
        );
        ensureSettingKey(
            sheet,
            "REMINDER_WINDOW_MINUTES",
            "45"
        );
        ensureSettingKey(
            sheet,
            "ENABLE_INTERACTIVE_MENUS",
            "TRUE"
        );
        ensureSettingKey(
            sheet,
            "AUTO_COMPLETE_PAST_APPOINTMENTS",
            "FALSE"
        );
        ensureSettingKey(
            sheet,
            "AUTO_COMPLETE_HOURS_AFTER",
            "4"
        );
        ensureSettingKey(
            sheet,
            "ENABLE_AFTER_HOURS_REPLY",
            "FALSE"
        );
        ensureSettingKey(
            sheet,
            "CLINIC_OPEN_TIME",
            "09:00"
        );
        ensureSettingKey(
            sheet,
            "CLINIC_CLOSE_TIME",
            "18:00"
        );
        ensureSettingKey(
            sheet,
            "CLINIC_WORKING_DAYS",
            "Mon,Tue,Wed,Thu,Fri,Sat"
        );
        ensureSettingKey(
            sheet,
            "AFTER_HOURS_MESSAGE",
            ""
        );
        ensureSettingKey(
            sheet,
            "CLINIC_WELCOME_IMAGE_URL",
            ""
        );
        ensureSettingKey(
            sheet,
            "CLINIC_NAME",
            "ABC Clinic"
        );
        ensureSettingKey(
            sheet,
            "CLINIC_ADDRESS",
            ""
        );
        ensureSettingKey(
            sheet,
            "CLINIC_PHONE",
            ""
        );
        ensureSettingKey(
            sheet,
            "CLINIC_MAP_URL",
            ""
        );
        ensureSettingKey(
            sheet,
            "ENABLE_OWNER_DAILY_DIGEST",
            "FALSE"
        );
        ensureSettingKey(
            sheet,
            "CLINIC_OWNER_PHONE",
            ""
        );
        ensureSettingKey(
            sheet,
            "OWNER_DIGEST_HOUR",
            "8"
        );
        ensureSettingKey(
            sheet,
            "ENABLE_REMINDER_ACTION_BUTTONS",
            "TRUE"
        );
        ensureSettingKey(
            sheet,
            "ENABLE_APPOINTMENT_WAITLIST",
            "TRUE"
        );
        ensureSettingKey(
            sheet,
            "WAITLIST_NOTIFY_COUNT",
            "3"
        );
        ensureSettingKey(
            sheet,
            "ENABLE_POST_VISIT_FEEDBACK",
            "TRUE"
        );
        ensureSettingKey(
            sheet,
            "FEEDBACK_HOURS_AFTER",
            "2"
        );
        ensureSettingKey(
            sheet,
            "FEEDBACK_WINDOW_MINUTES",
            "45"
        );
        ensureSettingKey(
            sheet,
            "FEEDBACK_MIN_RATING_FOR_REVIEW",
            "4"
        );
        ensureSettingKey(
            sheet,
            "CLINIC_REVIEW_URL",
            ""
        );
        ensureSettingKey(
            sheet,
            "ENABLE_VISIT_TYPE_SELECTION",
            "TRUE"
        );
    }

    _settingsSheetEnsured = true;

    return sheet;
}



function ensureSettingKey(
    sheet,
    key,
    defaultValue
) {

    const data =
        sheet.getDataRange().getValues();

    const target =
        String(key).trim().toUpperCase();

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        if (
            String(data[i][0] || "")
                .trim()
                .toUpperCase() ===
            target
        ) {
            return;
        }
    }

    sheet.appendRow([
        key,
        defaultValue
    ]);
}



function parseSettingsBoolean(value, defaultValue) {

    if (
        value === null ||
        value === undefined ||
        String(value).trim() === ""
    ) {
        return defaultValue;
    }

    const normalized =
        String(value)
            .trim()
            .toUpperCase();

    return (
        normalized === "TRUE" ||
        normalized === "YES" ||
        normalized === "1"
    );
}



function normalizeLogRetention(value) {

    const key =
        String(value || "month")
            .trim()
            .toLowerCase()
            .replace(/[\s_-]+/g, "");

    if (
        LOG_RETENTION_DAYS.hasOwnProperty(key)
    ) {
        return key;
    }

    return "month";
}



function getLogRetentionDays(retentionKey) {

    const key =
        normalizeLogRetention(retentionKey);

    return LOG_RETENTION_DAYS[key];
}



function getSetting(key, defaultValue) {

    if (!_settingsValuesCache) {

        const sheet =
            ensureSettingsSheet();

        const data =
            sheet.getDataRange().getValues();

        _settingsValuesCache = {};

        for (
            let i = 1;
            i < data.length;
            i++
        ) {

            const rowKey =
                String(data[i][0] || "")
                    .trim()
                    .toUpperCase();

            if (rowKey) {
                _settingsValuesCache[rowKey] = data[i][1];
            }
        }
    }

    const target =
        String(key).trim().toUpperCase();

    return _settingsValuesCache.hasOwnProperty(target)
        ? _settingsValuesCache[target]
        : defaultValue;
}



// ============================================================
// AFTER-HOURS / CLINIC CLOSED REPLY
// ============================================================

const CLINIC_DAY_ALIASES = {
    mon: "Monday",
    monday: "Monday",
    tue: "Tuesday",
    tues: "Tuesday",
    tuesday: "Tuesday",
    wed: "Wednesday",
    wednesday: "Wednesday",
    thu: "Thursday",
    thur: "Thursday",
    thurs: "Thursday",
    thursday: "Thursday",
    fri: "Friday",
    friday: "Friday",
    sat: "Saturday",
    saturday: "Saturday",
    sun: "Sunday",
    sunday: "Sunday"
};


const DOCTOR_WEEKDAYS = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday"
];
