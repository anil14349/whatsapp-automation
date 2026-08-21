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
//   ENABLE_INTERACTIVE_MENUS | TRUE
//   AUTO_COMPLETE_PAST_APPOINTMENTS | FALSE
//   AUTO_COMPLETE_HOURS_AFTER | 4
//   ENABLE_AFTER_HOURS_REPLY | FALSE
//   CLINIC_OPEN_TIME | 09:00
//   CLINIC_CLOSE_TIME | 18:00
//   CLINIC_WORKING_DAYS | Mon,Tue,Wed,Thu,Fri,Sat
//   AFTER_HOURS_MESSAGE | (optional custom text)
//
// Script Properties:
//   WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID
//   WHATSAPP_VERIFY_TOKEN, WHATSAPP_WEBHOOK_POST_TOKEN (optional)
//   DEBUG_MODE, TEST_SKIP_WHATSAPP_SEND (optional, for ABC_Clinic_Tests.gs)
//
// Apps Script project files:
//   ABC_Clinic_WhatsApp_Complete.gs  — this file (production)
//   ABC_Clinic_Tests.gs              — test functions
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


function truncateInteractiveLabel(
    text,
    maxLength
) {

    const value =
        String(text || "").trim();

    if (value.length <= maxLength) {
        return value;
    }

    if (maxLength <= 1) {
        return value.substring(0, maxLength);
    }

    return (
        value.substring(0, maxLength - 1) +
        "…"
    );
}


function extractInboundWhatsAppMessage(message) {

    const messageType =
        String(message.type || "");

    if (
        messageType === "text" &&
        message.text &&
        message.text.body !== undefined
    ) {

        return {
            type: "text",
            text: String(message.text.body).trim()
        };
    }

    if (
        messageType === "interactive" &&
        message.interactive
    ) {

        const interactive =
            message.interactive;

        if (
            interactive.type === "button_reply" &&
            interactive.button_reply
        ) {

            return {
                type: "interactive",
                text: String(
                    interactive.button_reply.id ||
                    ""
                ).trim()
            };
        }

        if (
            interactive.type === "list_reply" &&
            interactive.list_reply
        ) {

            return {
                type: "interactive",
                text: String(
                    interactive.list_reply.id ||
                    ""
                ).trim()
            };
        }
    }

    return {
        type: messageType,
        text: ""
    };
}


function buildInteractiveListSpec(
    rows,
    buttonLabel
) {

    if (
        !rows ||
        rows.length === 0 ||
        rows.length > 10
    ) {
        return null;
    }

    return {
        type: "list",
        buttonLabel:
            truncateInteractiveLabel(
                buttonLabel || "Choose",
                20
            ),
        sections: [
            {
                title: "Options",
                rows: rows.map(function (row) {
                    return {
                        id: String(row.id),
                        title:
                            truncateInteractiveLabel(
                                row.title,
                                24
                            ),
                        description:
                            truncateInteractiveLabel(
                                row.description || "",
                                72
                            )
                    };
                })
            }
        ]
    };
}


function buildInteractiveButtonSpec(buttons) {

    if (
        !buttons ||
        buttons.length === 0 ||
        buttons.length > 3
    ) {
        return null;
    }

    return {
        type: "button",
        buttons: buttons.map(function (button) {
            return {
                id: String(button.id),
                title:
                    truncateInteractiveLabel(
                        button.title,
                        20
                    )
            };
        })
    };
}


function getPatientMainMenuSpec() {

    const fallbackText =
        "1️⃣ Book Appointment\n" +
        "2️⃣ My Appointments\n" +
        "3️⃣ Cancel Appointment\n" +
        "4️⃣ Reschedule Appointment\n" +
        "5️⃣ Change Language";

    const interactive =
        buildInteractiveListSpec(
            [
                {
                    id: "1",
                    title: "Book Appointment",
                    description: "Schedule a visit"
                },
                {
                    id: "2",
                    title: "My Appointments",
                    description: "View upcoming"
                },
                {
                    id: "3",
                    title: "Cancel Appointment",
                    description: "Cancel a booking"
                },
                {
                    id: "4",
                    title: "Reschedule",
                    description: "Change date or time"
                },
                {
                    id: "5",
                    title: "Change Language",
                    description: "EN / TE / HI"
                }
            ],
            "Choose option"
        );

    return {
        fallbackText: fallbackText,
        interactive: interactive
    };
}


function getDoctorMainMenuSpec() {

    const fallbackText =
        "1️⃣ Today's Schedule\n" +
        "2️⃣ Next Appointment\n" +
        "3️⃣ This Week's Schedule\n" +
        "4️⃣ Schedule for a Date\n" +
        "5️⃣ Manage Availability\n" +
        "6️⃣ Manage Leaves\n" +
        "7️⃣ My Patients\n" +
        "8️⃣ Cancel Patient Appt\n" +
        "9️⃣ Reschedule Patient Appt\n" +
        "🔟 Mark Visit Status";

    const interactive =
        buildInteractiveListSpec(
            [
                { id: "1", title: "Today's Schedule" },
                { id: "2", title: "Next Appointment" },
                { id: "3", title: "This Week" },
                { id: "4", title: "Schedule by Date" },
                { id: "5", title: "Manage Availability" },
                { id: "6", title: "Manage Leaves" },
                { id: "7", title: "My Patients" },
                { id: "8", title: "Cancel Patient Appt" },
                { id: "9", title: "Reschedule Patient" },
                { id: "10", title: "Mark Visit Status" }
            ],
            "Doctor Portal"
        );

    return {
        fallbackText: fallbackText,
        interactive: interactive
    };
}


function getLanguageMenuSpec() {

    const fallbackText =
        "1️⃣ English\n" +
        "2️⃣ తెలుగు\n" +
        "3️⃣ हिन्दी";

    const interactive =
        buildInteractiveButtonSpec([
            { id: "1", title: "English" },
            { id: "2", title: "Telugu" },
            { id: "3", title: "Hindi" }
        ]);

    return {
        fallbackText: fallbackText,
        interactive: interactive
    };
}


function getDateMenuSpec() {

    const fallbackText =
        "1️⃣ Today\n" +
        "2️⃣ Tomorrow\n" +
        "3️⃣ Enter another date";

    const interactive =
        buildInteractiveButtonSpec([
            { id: "1", title: "Today" },
            { id: "2", title: "Tomorrow" },
            { id: "3", title: "Other date" }
        ]);

    return {
        fallbackText: fallbackText,
        interactive: interactive
    };
}


function getDoctorSelectionMenuSpec() {

    const doctors = getDoctors();

    if (doctors.length === 0) {
        return null;
    }

    let fallbackText = "";

    const rows = doctors.map(
        function (doctor, index) {

            const line =
                (index + 1) +
                ". " +
                doctor.doctorName +
                (
                    doctor.clinicName
                        ? " — " + doctor.clinicName
                        : ""
                );

            fallbackText += line + "\n";

            return {
                id: String(index + 1),
                title: doctor.doctorName,
                description:
                    doctor.clinicName || ""
            };
        }
    );

    fallbackText +=
        "\nReply with the doctor's number.";

    const interactive =
        buildInteractiveListSpec(
            rows,
            "Select doctor"
        );

    return {
        fallbackText: fallbackText,
        interactive: interactive
    };
}


function getSlotSelectionMenuSpec(slots) {

    if (!slots || slots.length === 0) {
        return null;
    }

    let fallbackText = "";

    const rows = slots.map(
        function (slot, index) {

            fallbackText +=
                (index + 1) +
                "️⃣ " +
                slot +
                "\n";

            return {
                id: String(index + 1),
                title: slot,
                description: ""
            };
        }
    );

    const interactive =
        buildInteractiveListSpec(
            rows,
            "Choose time"
        );

    return {
        fallbackText: fallbackText,
        interactive: interactive
    };
}


function getYesNoConfirmSpec() {

    const fallbackText =
        "1️⃣ Yes, cancel it\n" +
        "2️⃣ No, go back";

    const interactive =
        buildInteractiveButtonSpec([
            { id: "1", title: "Yes, cancel" },
            { id: "2", title: "No, go back" }
        ]);

    return {
        fallbackText: fallbackText,
        interactive: interactive
    };
}


function getRescheduleConfirmSpec() {

    const fallbackText =
        "1️⃣ Confirm\n" +
        "2️⃣ Choose another time\n" +
        "3️⃣ Cancel";

    const interactive =
        buildInteractiveButtonSpec([
            { id: "1", title: "Confirm" },
            { id: "2", title: "Other time" },
            { id: "3", title: "Cancel" }
        ]);

    return {
        fallbackText: fallbackText,
        interactive: interactive
    };
}


function getBookingConfirmSpec() {

    return getRescheduleConfirmSpec();
}


function requireDebugMode(functionName) {

    if (!isDebugMode()) {
        throw new Error(
            functionName +
            " requires DEBUG_MODE=true in Script Properties."
        );
    }
}

function normalizeWhatsAppPhone(phone) {

    const digits =
        String(phone || "").replace(/\D/g, "");

    return digits.length > 10
        ? digits.slice(-10)
        : digits;
}

function phonesMatch(phoneA, phoneB) {

    const a = normalizeWhatsAppPhone(phoneA);
    const b = normalizeWhatsAppPhone(phoneB);

    return !!a && a === b;
}

function getRequiredSheet(ss, sheetName) {

    const sheet = ss.getSheetByName(sheetName);

    if (!sheet) {
        throw new Error(
            sheetName + " sheet not found."
        );
    }

    return sheet;
}

function trimWhatsAppLogSheet(sheet) {

    cleanupLogSheet(
        sheet,
        getLogSettings()
    );
}


function ensureSettingsSheet() {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    let sheet =
        ss.getSheetByName("Settings");

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
    }

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

    const sheet =
        ensureSettingsSheet();

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
            return data[i][1];
        }
    }

    return defaultValue;
}


function loadLogSettingsFromSheet() {

    const retentionKey =
        normalizeLogRetention(
            getSetting(
                "LOG_RETENTION",
                "month"
            )
        );

    const maxRows =
        Number(
            getSetting(
                "LOG_MAX_ROWS",
                LOG_SHEET_MAX_ROWS
            )
        );

    const messageMaxChars =
        Number(
            getSetting(
                "LOG_MESSAGE_MAX_CHARS",
                500
            )
        );

    return {
        retentionKey: retentionKey,
        retentionDays:
            getLogRetentionDays(
                retentionKey
            ),
        maxRows:
            maxRows > 0
                ? maxRows
                : LOG_SHEET_MAX_ROWS,
        messageMaxChars:
            messageMaxChars > 0
                ? messageMaxChars
                : 500,
        enableInboundLog:
            parseSettingsBoolean(
                getSetting(
                    "ENABLE_INBOUND_LOG",
                    "TRUE"
                ),
                true
            ),
        enableDebugLog:
            parseSettingsBoolean(
                getSetting(
                    "ENABLE_DEBUG_LOG",
                    "TRUE"
                ),
                true
            )
    };
}


function getLogSettings() {

    const cache =
        CacheService.getScriptCache();

    const cached =
        cache.get(LOG_SETTINGS_CACHE_KEY);

    if (cached) {
        return JSON.parse(cached);
    }

    const settings =
        loadLogSettingsFromSheet();

    cache.put(
        LOG_SETTINGS_CACHE_KEY,
        JSON.stringify(settings),
        LOG_SETTINGS_CACHE_SECONDS
    );

    return settings;
}


function clearLogSettingsCache() {

    CacheService.getScriptCache().remove(
        LOG_SETTINGS_CACHE_KEY
    );
}


function parseLogTimestamp(value) {

    if (
        value instanceof Date &&
        !isNaN(value.getTime())
    ) {
        return value;
    }

    const parsed =
        new Date(value);

    return isNaN(parsed.getTime())
        ? null
        : parsed;
}


function truncateLogText(text, maxChars) {

    const value =
        String(text || "");

    if (
        !maxChars ||
        value.length <= maxChars
    ) {
        return value;
    }

    return (
        value.substring(0, maxChars) +
        "…"
    );
}


function cleanupLogSheet(sheet, settings) {

    if (
        !sheet ||
        sheet.getLastRow() < 2
    ) {
        return {
            deletedByAge: 0,
            deletedByCap: 0,
            retentionKey:
                settings.retentionKey
        };
    }

    const opts = settings || getLogSettings();
    let deletedByAge = 0;

    if (opts.retentionDays > 0) {

        const cutoff =
            new Date(
                Date.now() -
                opts.retentionDays *
                24 *
                60 *
                60 *
                1000
            );

        const data =
            sheet.getDataRange().getValues();

        const rowsToDelete = [];

        for (
            let i = 1;
            i < data.length;
            i++
        ) {

            const timestamp =
                parseLogTimestamp(
                    data[i][0]
                );

            if (
                timestamp &&
                timestamp.getTime() <
                cutoff.getTime()
            ) {
                rowsToDelete.push(i + 1);
            }
        }

        rowsToDelete
            .sort(function (a, b) {
                return b - a;
            })
            .forEach(function (row) {
                sheet.deleteRow(row);
                deletedByAge++;
            });
    }

    let deletedByCap = 0;
    const maxRows =
        opts.maxRows + 1;

    while (sheet.getLastRow() > maxRows) {
        sheet.deleteRows(
            2,
            sheet.getLastRow() - maxRows
        );
        deletedByCap++;
    }

    return {
        deletedByAge: deletedByAge,
        deletedByCap: deletedByCap,
        retentionKey: opts.retentionKey
    };
}


function ensureWhatsAppLogSheet(ss) {

    let sheet =
        ss.getSheetByName("WhatsApp_Log");

    if (!sheet) {

        sheet =
            ss.insertSheet("WhatsApp_Log");

        sheet.appendRow([
            "Timestamp",
            "Phone",
            "Name",
            "Type",
            "Message",
            "Phone Number ID"
        ]);
    }

    return sheet;
}


function ensureWhatsAppDebugSheet(ss) {

    let sheet =
        ss.getSheetByName("WhatsApp_Debug");

    if (!sheet) {

        sheet =
            ss.insertSheet("WhatsApp_Debug");

        sheet.appendRow([
            "Timestamp",
            "Direction",
            "Phone",
            "Status",
            "Response"
        ]);
    }

    return sheet;
}


function appendInboundWhatsAppLog(
    ss,
    entry
) {

    const settings =
        getLogSettings();

    if (!settings.enableInboundLog) {
        return;
    }

    const sheet =
        ensureWhatsAppLogSheet(ss);

    sheet.appendRow([
        new Date(),
        entry.phone,
        truncateLogText(
            entry.name,
            100
        ),
        entry.type,
        truncateLogText(
            entry.message,
            settings.messageMaxChars
        ),
        entry.phoneNumberId || ""
    ]);

    cleanupLogSheet(
        sheet,
        settings
    );
}


function appendWhatsAppDebugLog(
    ss,
    entry
) {

    const settings =
        getLogSettings();

    if (!settings.enableDebugLog) {
        return;
    }

    const sheet =
        ensureWhatsAppDebugSheet(ss);

    sheet.appendRow([
        new Date(),
        entry.direction || "OUTBOUND",
        entry.phone || "",
        entry.status || "",
        truncateLogText(
            entry.response,
            settings.messageMaxChars
        )
    ]);

    cleanupLogSheet(
        sheet,
        settings
    );
}


function cleanupAllWhatsAppLogs() {

    clearLogSettingsCache();

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const settings =
        getLogSettings();

    const results = {
        settings: settings,
        sheets: {}
    };

    [
        "WhatsApp_Log",
        "WhatsApp_Debug"
    ].forEach(function (name) {

        const sheet =
            ss.getSheetByName(name);

        results.sheets[name] =
            sheet
                ? cleanupLogSheet(
                    sheet,
                    settings
                )
                : {
                    deletedByAge: 0,
                    deletedByCap: 0,
                    retentionKey:
                        settings.retentionKey
                };
    });

    Logger.log(
        "cleanupAllWhatsAppLogs: " +
        JSON.stringify(results)
    );

    return results;
}


function installDailyLogCleanupTrigger() {

    requireDebugMode(
        "installDailyLogCleanupTrigger"
    );

    ScriptApp.getProjectTriggers()
        .forEach(function (trigger) {

            if (
                trigger.getHandlerFunction() ===
                "cleanupAllWhatsAppLogs"
            ) {
                ScriptApp.deleteTrigger(
                    trigger
                );
            }
        });

    ScriptApp.newTrigger(
        "cleanupAllWhatsAppLogs"
    )
        .timeBased()
        .everyDays(1)
        .atHour(3)
        .create();

    return {
        success: true,
        message:
            "Daily log cleanup trigger installed (3 AM)."
    };
}


// ============================================================
// APPOINTMENT REMINDERS
// ============================================================

function parseReminderHoursBefore(value) {

    const raw =
        String(value || "24").trim();

    if (!raw) {
        return [24];
    }

    const hours =
        raw.split(",")
            .map(function (part) {
                return Number(
                    String(part).trim()
                );
            })
            .filter(function (n) {
                return n > 0;
            });

    return hours.length > 0
        ? hours
        : [24];
}


function getReminderSettings() {

    ensureSettingsSheet();

    const enabled =
        parseSettingsBoolean(
            getSetting(
                "ENABLE_APPOINTMENT_REMINDERS",
                "TRUE"
            ),
            true
        );

    const windowMinutes =
        Number(
            getSetting(
                "REMINDER_WINDOW_MINUTES",
                "45"
            )
        );

    return {
        enabled: enabled,
        hoursBeforeList:
            parseReminderHoursBefore(
                getSetting(
                    "REMINDER_HOURS_BEFORE",
                    "24"
                )
            ),
        windowMinutes:
            windowMinutes > 0
                ? windowMinutes
                : 45
    };
}


function ensureReminderLogSheet() {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    let sheet =
        ss.getSheetByName("Reminder_Log");

    if (!sheet) {

        sheet =
            ss.insertSheet("Reminder_Log");

        sheet.appendRow([
            "Sent At",
            "Appointment ID",
            "Hours Before",
            "Phone",
            "Status"
        ]);
    }

    return sheet;
}


function hasReminderBeenSent(
    appointmentId,
    hoursBefore
) {

    const sheet =
        ensureReminderLogSheet();

    const data =
        sheet.getDataRange().getValues();

    const targetId =
        String(appointmentId || "").trim();

    const targetHours =
        Number(hoursBefore);

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        if (
            String(data[i][1] || "").trim() ===
            targetId &&
            Number(data[i][2]) === targetHours &&
            String(data[i][4] || "")
                .trim()
                .toUpperCase() ===
            "SUCCESS"
        ) {
            return true;
        }
    }

    return false;
}


function markReminderSent(
    appointmentId,
    hoursBefore,
    phone,
    status
) {

    const sheet =
        ensureReminderLogSheet();

    sheet.appendRow([
        new Date(),
        appointmentId,
        hoursBefore,
        phone,
        status
    ]);
}


function formatWhatsAppRecipientPhone(phone) {

    const digits =
        String(phone || "")
            .replace(/\D/g, "");

    if (!digits) {
        return "";
    }

    if (digits.length === 10) {
        return "91" + digits;
    }

    return digits;
}


function formatAppointmentDisplayDate(value) {

    if (
        value instanceof Date &&
        !isNaN(value.getTime())
    ) {
        return Utilities.formatDate(
            value,
            TIMEZONE,
            "dd-MMM-yyyy"
        );
    }

    const iso =
        normalizeAppointmentDate(value);

    if (iso) {
        return Utilities.formatDate(
            new Date(
                iso + "T00:00:00+05:30"
            ),
            TIMEZONE,
            "dd-MMM-yyyy"
        );
    }

    return String(value || "").trim();
}


function formatAppointmentDisplayTime(value) {

    if (
        value instanceof Date &&
        !isNaN(value.getTime())
    ) {
        return Utilities.formatDate(
            value,
            TIMEZONE,
            "hh:mm a"
        );
    }

    const time24 =
        convert12HourTo24Hour(
            formatAppointmentSheetTime(value)
        );

    if (!time24) {
        return String(value || "").trim();
    }

    const parts = time24.split(":");
    let hour = Number(parts[0]);
    const minute = parts[1];
    const suffix = hour >= 12 ? "PM" : "AM";

    hour = hour % 12;
    if (hour === 0) {
        hour = 12;
    }

    return (
        String(hour).padStart(2, "0") +
        ":" +
        minute +
        " " +
        suffix
    );
}


function resolvePatientLanguageFromRegistry(phone) {

    const patient =
        findPatientByPhone(phone);

    const language =
        patient &&
        String(patient.language || "")
            .trim()
            .toUpperCase();

    if (
        ["EN", "TE", "HI"].indexOf(
            language
        ) !== -1
    ) {
        return language;
    }

    return "EN";
}


function buildAppointmentReminderMessage(
    appointment,
    doctorName,
    hoursBefore
) {

    const displayDate =
        formatAppointmentDisplayDate(
            appointment.date
        );

    const displayTime =
        formatAppointmentDisplayTime(
            appointment.time
        );

    const hoursLabel =
        hoursBefore === 1
            ? "1 hour"
            : hoursBefore + " hours";

    return (
        "🔔 Appointment Reminder\n\n" +
        "Reminder: " +
        hoursLabel +
        " before your appointment.\n\n" +
        "Doctor: " +
        doctorName +
        "\n" +
        "Date: " +
        displayDate +
        "\n" +
        "Time: " +
        displayTime +
        "\n" +
        "Appointment ID: " +
        appointment.appointmentId +
        "\n\n" +
        "Reply Hi to reschedule or cancel."
    );
}


function sendOneAppointmentReminder(
    ss,
    appointment,
    hoursBefore
) {

    const doctor =
        getDoctorRecord(
            appointment.doctorId
        );

    const doctorName =
        doctor &&
        doctor.doctorName
            ? doctor.doctorName
            : String(
                appointment.doctorId || ""
            ).trim();

    const language =
        resolvePatientLanguageFromRegistry(
            appointment.phone
        );

    const message =
        localizeWhatsAppReply(
            language,
            buildAppointmentReminderMessage(
                appointment,
                doctorName,
                hoursBefore
            )
        );

    const recipient =
        formatWhatsAppRecipientPhone(
            appointment.phone
        );

    if (!recipient) {
        throw new Error(
            "Missing patient phone for reminder."
        );
    }

    const sendResult =
        sendWhatsAppText(
            recipient,
            message
        );

    appendWhatsAppDebugLog(
        ss,
        {
            direction: "REMINDER",
            phone: recipient,
            status: "SUCCESS",
            response: message
        }
    );

    return sendResult;
}


function sendAppointmentReminders() {

    const settings =
        getReminderSettings();

    if (!settings.enabled) {
        return {
            enabled: false,
            sent: 0,
            skipped: 0,
            errors: 0
        };
    }

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Appointments");

    if (!sheet) {
        return {
            enabled: true,
            sent: 0,
            skipped: 0,
            errors: 0,
            message:
                "Appointments sheet not found."
        };
    }

    const now = new Date();
    const windowMs =
        settings.windowMinutes *
        60 *
        1000;

    const data =
        sheet.getDataRange().getValues();

    const results = {
        enabled: true,
        sent: 0,
        skipped: 0,
        errors: 0,
        checked: 0,
        settings: settings
    };

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        const appointmentId =
            String(data[i][0] || "").trim();

        if (!appointmentId) {
            continue;
        }

        const status =
            String(data[i][6] || "")
                .trim()
                .toLowerCase();

        if (
            status === "cancelled" ||
            status === "completed" ||
            status === "no-show" ||
            status === "noshow" ||
            status === "no show"
        ) {
            continue;
        }

        const appointmentStart =
            parseAppointmentSheetDateTime(
                data[i][1],
                data[i][2]
            );

        if (
            !appointmentStart ||
            appointmentStart.getTime() <=
            now.getTime()
        ) {
            continue;
        }

        results.checked++;

        const appointment = {
            appointmentId: appointmentId,
            doctorId: data[i][3],
            patientName: data[i][4],
            phone: data[i][5],
            date: data[i][1],
            time: data[i][2]
        };

        settings.hoursBeforeList.forEach(
            function (hoursBefore) {

                const reminderTarget =
                    new Date(
                        appointmentStart.getTime() -
                        hoursBefore *
                        60 *
                        60 *
                        1000
                    );

                const elapsed =
                    now.getTime() -
                    reminderTarget.getTime();

                if (
                    elapsed < 0 ||
                    elapsed > windowMs
                ) {
                    return;
                }

                if (
                    hasReminderBeenSent(
                        appointmentId,
                        hoursBefore
                    )
                ) {
                    results.skipped++;
                    return;
                }

                try {

                    sendOneAppointmentReminder(
                        ss,
                        appointment,
                        hoursBefore
                    );

                    markReminderSent(
                        appointmentId,
                        hoursBefore,
                        appointment.phone,
                        "SUCCESS"
                    );

                    results.sent++;

                } catch (error) {

                    markReminderSent(
                        appointmentId,
                        hoursBefore,
                        appointment.phone,
                        "ERROR: " +
                        error.message
                    );

                    results.errors++;

                    Logger.log(
                        "Reminder failed for " +
                        appointmentId +
                        ": " +
                        error.message
                    );
                }
            }
        );
    }

    Logger.log(
        "sendAppointmentReminders: " +
        JSON.stringify(results)
    );

    return results;
}


function installAppointmentReminderTrigger() {

    ScriptApp.getProjectTriggers()
        .forEach(function (trigger) {

            if (
                trigger.getHandlerFunction() ===
                "sendAppointmentReminders"
            ) {
                ScriptApp.deleteTrigger(
                    trigger
                );
            }
        });

    ScriptApp.newTrigger(
        "sendAppointmentReminders"
    )
        .timeBased()
        .everyHours(1)
        .create();

    return {
        success: true,
        message:
            "Hourly appointment reminder trigger installed."
    };
}


// ============================================================
// APPOINTMENT STATUS (COMPLETED / NO-SHOW)
// ============================================================

function getAutoCompleteSettings() {

    ensureSettingsSheet();

    const enabled =
        parseSettingsBoolean(
            getSetting(
                "AUTO_COMPLETE_PAST_APPOINTMENTS",
                "FALSE"
            ),
            false
        );

    const hoursAfter =
        Number(
            getSetting(
                "AUTO_COMPLETE_HOURS_AFTER",
                "4"
            )
        );

    return {
        enabled: enabled,
        hoursAfter:
            hoursAfter > 0
                ? hoursAfter
                : 4
    };
}


function updateAppointmentStatus(
    appointmentId,
    newStatus,
    options
) {

    const opts = options || {};
    const targetStatus =
        normalizeAppointmentStatus(newStatus);

    if (
        targetStatus !== APPOINTMENT_STATUS.COMPLETED &&
        targetStatus !== APPOINTMENT_STATUS.NO_SHOW
    ) {

        return {
            success: false,
            message:
                "Status must be Completed or No-Show."
        };
    }

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Appointments");

    if (!sheet) {

        return {
            success: false,
            message:
                "Appointments sheet not found."
        };
    }

    const data =
        sheet.getDataRange().getValues();

    const targetId =
        String(appointmentId || "").trim();

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        const rowAppointmentId =
            String(data[i][0] || "").trim();

        if (rowAppointmentId !== targetId) {
            continue;
        }

        const currentStatus =
            normalizeAppointmentStatus(
                data[i][6]
            );

        const rowDoctorId =
            String(data[i][3] || "").trim();

        const authorizedDoctorId =
            String(
                opts.authorizedDoctorId || ""
            ).trim();

        if (authorizedDoctorId) {

            if (
                rowDoctorId !==
                authorizedDoctorId
            ) {

                return {
                    success: false,
                    message:
                        "Appointment does not belong to this doctor."
                };
            }

        } else if (
            opts.patientPhone &&
            !phonesMatch(
                data[i][5],
                opts.patientPhone
            )
        ) {

            return {
                success: false,
                message:
                    "Appointment does not belong to this phone number."
            };
        }

        if (
            currentStatus ===
            APPOINTMENT_STATUS.CANCELLED
        ) {

            return {
                success: false,
                message:
                    "Cancelled appointments cannot be updated."
            };
        }

        if (
            currentStatus ===
            APPOINTMENT_STATUS.COMPLETED ||
            currentStatus ===
            APPOINTMENT_STATUS.NO_SHOW
        ) {

            return {
                success: false,
                message:
                    "Appointment is already marked as " +
                    currentStatus +
                    "."
            };
        }

        if (
            currentStatus !==
            APPOINTMENT_STATUS.CONFIRMED
        ) {

            return {
                success: false,
                message:
                    "Only confirmed appointments can be marked Completed or No-Show."
            };
        }

        sheet
            .getRange(i + 1, 7)
            .setValue(targetStatus);

        return {
            success: true,
            message:
                "Appointment marked as " +
                targetStatus +
                ".",
            appointmentId: targetId,
            status: targetStatus,
            patientName:
                String(data[i][4] || "").trim(),
            date:
                formatAppointmentDisplayDate(
                    data[i][1]
                ),
            time:
                formatAppointmentDisplayTime(
                    data[i][2]
                )
        };
    }

    return {
        success: false,
        message:
            "Appointment not found."
    };
}


function getDoctorStatusEligibleAppointments(
    doctorId
) {

    const appointments =
        getDoctorConfirmedAppointments(
            doctorId
        );

    const now = new Date();
    const graceMs =
        15 * 60 * 1000;

    return appointments.filter(
        function (appt) {

            const dt =
                parseAppointmentDateTime(
                    appt.date,
                    appt.time
                );

            if (!dt) {
                return true;
            }

            return (
                dt.getTime() <=
                now.getTime() + graceMs
            );
        }
    );
}


function autoCompletePastAppointments() {

    const settings =
        getAutoCompleteSettings();

    if (!settings.enabled) {
        return {
            enabled: false,
            updated: 0,
            skipped: 0
        };
    }

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Appointments");

    if (!sheet) {
        return {
            enabled: true,
            updated: 0,
            skipped: 0,
            message:
                "Appointments sheet not found."
        };
    }

    const now = new Date();
    const cutoffMs =
        settings.hoursAfter *
        60 *
        60 *
        1000;

    const data =
        sheet.getDataRange().getValues();

    let updated = 0;
    let skipped = 0;

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        const appointmentId =
            String(data[i][0] || "").trim();

        if (!appointmentId) {
            continue;
        }

        if (
            !isConfirmedAppointmentStatus(
                data[i][6]
            )
        ) {
            skipped++;
            continue;
        }

        const appointmentStart =
            parseAppointmentSheetDateTime(
                data[i][1],
                data[i][2]
            );

        if (
            !appointmentStart ||
            now.getTime() <
            appointmentStart.getTime() + cutoffMs
        ) {
            skipped++;
            continue;
        }

        sheet
            .getRange(i + 1, 7)
            .setValue(
                APPOINTMENT_STATUS.COMPLETED
            );

        updated++;
    }

    Logger.log(
        "autoCompletePastAppointments: updated=" +
        updated +
        " skipped=" +
        skipped
    );

    return {
        enabled: true,
        updated: updated,
        skipped: skipped,
        settings: settings
    };
}


function installAutoCompletePastAppointmentsTrigger() {

    ScriptApp.getProjectTriggers()
        .forEach(function (trigger) {

            if (
                trigger.getHandlerFunction() ===
                "autoCompletePastAppointments"
            ) {
                ScriptApp.deleteTrigger(
                    trigger
                );
            }
        });

    ScriptApp.newTrigger(
        "autoCompletePastAppointments"
    )
        .timeBased()
        .everyDays(1)
        .atHour(23)
        .create();

    return {
        success: true,
        message:
            "Daily auto-complete trigger installed (11 PM)."
    };
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


function parseClinicWorkingDays(value) {

    const raw =
        String(value || "").trim();

    const defaultDays = [
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday"
    ];

    if (!raw) {
        return defaultDays;
    }

    const days = [];
    const seen = {};

    raw.split(",")
        .forEach(function (part) {

            const key =
                String(part || "")
                    .trim()
                    .toLowerCase();

            const dayName =
                CLINIC_DAY_ALIASES[key];

            if (
                dayName &&
                !seen[dayName]
            ) {
                seen[dayName] = true;
                days.push(dayName);
            }
        });

    return days.length > 0
        ? days
        : defaultDays;
}


function formatClinicTimeForDisplay(value) {

    const normalized =
        normalizeAvailabilityTimeInput(
            value
        );

    if (normalized) {
        return normalized;
    }

    const time24 =
        convert12HourTo24Hour(value);

    if (!time24) {
        return String(value || "").trim();
    }

    const parts =
        time24.split(":");

    let hour =
        Number(parts[0]);

    const minute =
        parts[1];

    const suffix =
        hour >= 12 ? "PM" : "AM";

    hour = hour % 12;
    if (hour === 0) {
        hour = 12;
    }

    return (
        hour +
        ":" +
        minute +
        " " +
        suffix
    );
}


function formatClinicWorkingDaysForDisplay(
    workingDays
) {

    const shortNames = {
        Monday: "Mon",
        Tuesday: "Tue",
        Wednesday: "Wed",
        Thursday: "Thu",
        Friday: "Fri",
        Saturday: "Sat",
        Sunday: "Sun"
    };

    const labels =
        (workingDays || []).map(
            function (day) {
                return (
                    shortNames[day] ||
                    day
                );
            }
        );

    if (labels.length === 0) {
        return "Mon–Sat";
    }

    if (labels.length === 1) {
        return labels[0];
    }

    return (
        labels[0] +
        "–" +
        labels[labels.length - 1]
    );
}


function getAfterHoursSettings() {

    ensureSettingsSheet();

    const enabled =
        parseSettingsBoolean(
            getSetting(
                "ENABLE_AFTER_HOURS_REPLY",
                "FALSE"
            ),
            false
        );

    const openTime =
        getSetting(
            "CLINIC_OPEN_TIME",
            "09:00"
        );

    const closeTime =
        getSetting(
            "CLINIC_CLOSE_TIME",
            "18:00"
        );

    const workingDays =
        parseClinicWorkingDays(
            getSetting(
                "CLINIC_WORKING_DAYS",
                "Mon,Tue,Wed,Thu,Fri,Sat"
            )
        );

    const customMessage =
        String(
            getSetting(
                "AFTER_HOURS_MESSAGE",
                ""
            ) || ""
        ).trim();

    return {
        enabled: enabled,
        openTime: openTime,
        closeTime: closeTime,
        workingDays: workingDays,
        customMessage: customMessage,
        openTimeDisplay:
            formatClinicTimeForDisplay(
                openTime
            ),
        closeTimeDisplay:
            formatClinicTimeForDisplay(
                closeTime
            ),
        workingDaysDisplay:
            formatClinicWorkingDaysForDisplay(
                workingDays
            )
    };
}


function isWithinClinicHours(
    now,
    settings
) {

    const current =
        now instanceof Date
            ? now
            : new Date();

    const config =
        settings ||
        getAfterHoursSettings();

    const dayName =
        Utilities.formatDate(
            current,
            TIMEZONE,
            "EEEE"
        );

    if (
        config.workingDays.indexOf(
            dayName
        ) === -1
    ) {
        return false;
    }

    const openAt =
        parseAvailabilityTimeValue(
            config.openTime,
            current
        );

    const closeAt =
        parseAvailabilityTimeValue(
            config.closeTime,
            current
        );

    if (
        !openAt ||
        !closeAt
    ) {
        return true;
    }

    const nowMs =
        current.getTime();

    return (
        nowMs >= openAt.getTime() &&
        nowMs < closeAt.getTime()
    );
}


function isActivePatientFlowSession(session) {

    if (
        !session ||
        !session.state
    ) {
        return false;
    }

    const idleStates = [
        "MAIN_MENU"
    ];

    return (
        idleStates.indexOf(
            String(session.state).trim()
        ) === -1
    );
}


function shouldBlockPatientForAfterHours(
    senderPhone,
    session
) {

    const settings =
        getAfterHoursSettings();

    if (!settings.enabled) {
        return false;
    }

    if (
        findDoctorByWhatsAppPhone(
            senderPhone
        )
    ) {
        return false;
    }

    if (
        session &&
        session.role === "DOCTOR"
    ) {
        return false;
    }

    if (
        isWithinClinicHours(
            new Date(),
            settings
        )
    ) {
        return false;
    }

    if (
        isActivePatientFlowSession(
            session
        )
    ) {
        return false;
    }

    return true;
}


function resolveLanguageForAfterHoursReply(
    phone,
    session
) {

    let language =
        session &&
        String(session.language || "")
            .trim()
            .toUpperCase();

    if (
        ["EN", "TE", "HI"].indexOf(
            language
        ) !== -1
    ) {
        return language;
    }

    return resolvePatientLanguageFromRegistry(
        phone
    );
}


function buildAfterHoursMessage(
    language,
    settings
) {

    const config =
        settings ||
        getAfterHoursSettings();

    if (config.customMessage) {
        return config.customMessage;
    }

    const hoursLine =
        config.workingDaysDisplay +
        ", " +
        config.openTimeDisplay +
        " – " +
        config.closeTimeDisplay;

    const message =
        "🕐 " +
        "ABC Clinic is currently closed.\n\n" +
        "Our hours: " +
        hoursLine +
        "\n\n" +
        "Please message us during clinic hours to book or manage appointments.\n\n" +
        "Reply Hi during open hours to get started.";

    return localizeWhatsAppReply(
        language,
        message
    );
}


function sendAfterHoursPatientReply(
    ss,
    phone,
    session
) {

    const language =
        resolveLanguageForAfterHoursReply(
            phone,
            session
        );

    const settings =
        getAfterHoursSettings();

    sendWhatsAppReply(
        ss,
        phone,
        buildAfterHoursMessage(
            language,
            settings
        )
    );
}


function handleAfterHoursPatientGate(
    ss,
    senderPhone,
    session
) {

    if (
        !shouldBlockPatientForAfterHours(
            senderPhone,
            session
        )
    ) {
        return false;
    }

    sendAfterHoursPatientReply(
        ss,
        senderPhone,
        session
    );

    return true;
}


// ============================================================
// TIME HELPERS
// ============================================================

function convert12HourTo24Hour(timeString) {

    const value =
        String(timeString || "").trim();

    // Already normalized 24-hour format: 10:00
    if (/^\d{1,2}:\d{2}$/.test(value)) {

        const parts = value.split(":");
        const hour = Number(parts[0]);
        const minute = Number(parts[1]);

        if (
            hour >= 0 &&
            hour <= 23 &&
            minute >= 0 &&
            minute <= 59
        ) {
            return (
                String(hour).padStart(2, "0") +
                ":" +
                String(minute).padStart(2, "0")
            );
        }
    }

    // User-facing format: 10:00 AM
    const match =
        value.match(
            /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i
        );

    if (!match) {
        return null;
    }

    let hour = Number(match[1]);
    const minute = Number(match[2]);
    const period = match[3].toUpperCase();

    if (
        hour < 1 ||
        hour > 12 ||
        minute < 0 ||
        minute > 59
    ) {
        return null;
    }

    if (period === "AM") {
        if (hour === 12) {
            hour = 0;
        }
    } else {
        if (hour !== 12) {
            hour += 12;
        }
    }

    return (
        String(hour).padStart(2, "0") +
        ":" +
        String(minute).padStart(2, "0")
    );
}


function isValidISODate(dateString) {

    const value =
        String(dateString || "").trim();

    if (
        !/^\d{4}-\d{2}-\d{2}$/.test(value)
    ) {
        return false;
    }

    const parts = value.split("-");
    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const day = Number(parts[2]);

    const date =
        new Date(
            `${value}T00:00:00+05:30`
        );

    if (isNaN(date.getTime())) {
        return false;
    }

    return (
        date.getFullYear() === year &&
        date.getMonth() + 1 === month &&
        date.getDate() === day
    );
}


function normalizeAppointmentDate(value) {

    if (value instanceof Date) {
        return Utilities.formatDate(
            value,
            TIMEZONE,
            "yyyy-MM-dd"
        );
    }

    const text =
        String(value || "").trim();

    if (!text) {
        return "";
    }

    // Already ISO
    if (isValidISODate(text)) {
        return text;
    }

    // dd-MMM-yyyy
    const match =
        text.match(
            /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/
        );

    if (!match) {
        return "";
    }

    const day =
        Number(match[1]);

    const monthNames = [
        "Jan", "Feb", "Mar",
        "Apr", "May", "Jun",
        "Jul", "Aug", "Sep",
        "Oct", "Nov", "Dec"
    ];

    const month =
        monthNames.indexOf(
            match[2].substring(0, 1).toUpperCase() +
            match[2].substring(1, 3).toLowerCase()
        );

    const year =
        Number(match[3]);

    if (month < 0) {
        return "";
    }

    const iso =
        year +
        "-" +
        String(month + 1).padStart(2, "0") +
        "-" +
        String(day).padStart(2, "0");

    return isValidISODate(iso)
        ? iso
        : "";
}


function formatAppointmentSheetDate(value) {

    if (
        value instanceof Date &&
        !isNaN(value.getTime())
    ) {
        return Utilities.formatDate(
            value,
            TIMEZONE,
            "dd-MMM-yyyy"
        );
    }

    const text =
        String(value || "").trim();

    if (!text) {
        return "";
    }

    const iso =
        normalizeAppointmentDate(text);

    if (iso) {
        return Utilities.formatDate(
            new Date(
                iso + "T00:00:00+05:30"
            ),
            TIMEZONE,
            "dd-MMM-yyyy"
        );
    }

    return text;
}


function formatAppointmentSheetTime(value) {

    if (
        value instanceof Date &&
        !isNaN(value.getTime())
    ) {
        return Utilities.formatDate(
            value,
            TIMEZONE,
            "HH:mm"
        );
    }

    const text =
        String(value || "").trim();

    if (!text) {
        return "";
    }

    const time24 =
        convert12HourTo24Hour(text);

    if (time24) {
        return time24;
    }

    if (/^\d{1,2}:\d{2}$/.test(text)) {
        return text;
    }

    return text;
}


function captureAppointmentSheetSnapshot(
    rowValues
) {

    return {
        date: rowValues[1],
        time: rowValues[2],
        status:
            String(rowValues[6] || "Confirmed"),
        eventId:
            String(rowValues[7] || "")
    };
}


function writeAppointmentSheetSchedule(
    sheet,
    row,
    startTime,
    status,
    eventId
) {

    sheet
        .getRange(row, 2)
        .setValue(
            Utilities.formatDate(
                startTime,
                TIMEZONE,
                "dd-MMM-yyyy"
            )
        );

    sheet
        .getRange(row, 3)
        .setValue(
            Utilities.formatDate(
                startTime,
                TIMEZONE,
                "HH:mm"
            )
        );

    sheet
        .getRange(row, 7)
        .setValue(status || "Confirmed");

    if (eventId !== undefined) {
        sheet
            .getRange(row, 8)
            .setValue(String(eventId || ""));
    }
}


function restoreAppointmentSheetSchedule(
    sheet,
    row,
    snapshot
) {

    sheet
        .getRange(row, 2)
        .setValue(
            formatAppointmentSheetDate(
                snapshot.date
            )
        );

    sheet
        .getRange(row, 3)
        .setValue(
            formatAppointmentSheetTime(
                snapshot.time
            )
        );

    sheet
        .getRange(row, 7)
        .setValue(
            snapshot.status || "Confirmed"
        );

    sheet
        .getRange(row, 8)
        .setValue(
            String(snapshot.eventId || "")
        );
}


function parseAppointmentSheetDateTime(
    dateValue,
    timeValue
) {

    const iso =
        normalizeAppointmentDate(dateValue);

    if (!iso) {
        return null;
    }

    const time24 =
        convert12HourTo24Hour(
            formatAppointmentSheetTime(timeValue)
        );

    if (!time24) {
        return null;
    }

    const dateTime =
        new Date(
            iso + "T" + time24 + ":00+05:30"
        );

    return isNaN(dateTime.getTime())
        ? null
        : dateTime;
}


// ============================================================
// 2. GET AVAILABLE SLOTS
// ============================================================

function getDoctorAppointmentDuration(doctorId) {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Doctors");

    if (!sheet) {
        throw new Error(
            "Doctors sheet not found."
        );
    }

    const data =
        sheet.getDataRange().getValues();

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        if (
            String(data[i][0]).trim() ===
            String(doctorId).trim()
        ) {

            const duration =
                Number(data[i][5]);

            if (
                !duration ||
                duration <= 0
            ) {
                throw new Error(
                    "Invalid AppointmentDuration for doctor " +
                    doctorId
                );
            }

            return duration;
        }
    }

    throw new Error(
        "Doctor not found: " +
        doctorId
    );
}

function isDoctorOnLeave(
    doctorId,
    dateString
) {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Doctor_Leaves");

    if (!sheet) {
        return false;
    }

    const data =
        sheet.getDataRange().getValues();

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        const rowDoctorId =
            String(data[i][0] || "").trim();

        let rowDate = "";

        if (
            data[i][1] instanceof Date
        ) {

            rowDate =
                Utilities.formatDate(
                    data[i][1],
                    TIMEZONE,
                    "yyyy-MM-dd"
                );

        } else {

            rowDate =
                String(data[i][1] || "").trim();
        }

        const active =
            String(data[i][3] || "")
                .toUpperCase() === "TRUE";

        if (
            rowDoctorId ===
            String(doctorId).trim() &&
            rowDate ===
            String(dateString).trim() &&
            active
        ) {
            return true;
        }
    }

    return false;
}

const DOCTOR_WEEKDAYS = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday"
];

function doctorWeekdayIndexToName(index) {

    const value = Number(index);

    if (
        !Number.isInteger(value) ||
        value < 1 ||
        value > 7
    ) {
        return null;
    }

    return DOCTOR_WEEKDAYS[value - 1];
}

function formatAvailabilityTimeForDisplay(value) {

    if (value instanceof Date) {
        return Utilities.formatDate(
            value,
            TIMEZONE,
            "hh:mm a"
        );
    }

    const normalized =
        normalizeAvailabilityTimeInput(
            String(value)
        );

    return normalized ||
        String(value || "").trim();
}

function normalizeAvailabilityTimeInput(timeString) {

    const time24 =
        convert12HourTo24Hour(timeString);

    if (!time24) {
        return null;
    }

    const parts =
        time24.split(":");

    let hour =
        Number(parts[0]);

    const minute =
        Number(parts[1]);

    const period =
        hour >= 12 ? "PM" : "AM";

    if (hour === 0) {
        hour = 12;
    } else if (hour > 12) {
        hour -= 12;
    }

    return (
        hour +
        ":" +
        String(minute).padStart(2, "0") +
        " " +
        period
    );
}

function compareAvailabilityTimes(
    startTime,
    endTime
) {

    const sampleDate =
        new Date("2026-01-01T00:00:00+05:30");

    const start =
        parseAvailabilityTimeValue(
            startTime,
            sampleDate
        );

    const end =
        parseAvailabilityTimeValue(
            endTime,
            sampleDate
        );

    if (
        !start ||
        !end ||
        start.getTime() >= end.getTime()
    ) {
        return false;
    }

    return true;
}

function getDoctorWeeklyAvailability(doctorId) {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Availability");

    const availability = {};

    DOCTOR_WEEKDAYS.forEach(function (day) {
        availability[day] = [];
    });

    if (!sheet) {
        return availability;
    }

    const data =
        sheet.getDataRange().getValues();

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        if (
            String(data[i][0] || "").trim() !==
            String(doctorId).trim()
        ) {
            continue;
        }

        const day =
            String(data[i][1] || "").trim();

        if (
            DOCTOR_WEEKDAYS.indexOf(day) === -1
        ) {
            continue;
        }

        availability[day].push({
            start:
                formatAvailabilityTimeForDisplay(
                    data[i][2]
                ),
            end:
                formatAvailabilityTimeForDisplay(
                    data[i][3]
                ),
            row: i + 1
        });
    }

    return availability;
}

function getDoctorDayAvailabilitySessions(
    doctorId,
    dayName
) {

    const weekly =
        getDoctorWeeklyAvailability(doctorId);

    return weekly[dayName] || [];
}

function addDoctorAvailabilitySession(
    doctorId,
    dayName,
    startTime,
    endTime
) {

    const start =
        normalizeAvailabilityTimeInput(
            startTime
        );

    const end =
        normalizeAvailabilityTimeInput(
            endTime
        );

    if (
        !start ||
        !end
    ) {
        return {
            success: false,
            message:
                "Invalid time format. Use Example: 10:00 AM"
        };
    }

    if (
        !compareAvailabilityTimes(
            start,
            end
        )
    ) {
        return {
            success: false,
            message:
                "End time must be after start time."
        };
    }

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    let sheet =
        ss.getSheetByName("Availability");

    if (!sheet) {
        sheet =
            ss.insertSheet("Availability");

        sheet.appendRow([
            "Doctor ID",
            "Day",
            "Start",
            "End"
        ]);
    }

    sheet.appendRow([
        String(doctorId).trim(),
        dayName,
        start,
        end
    ]);

    return {
        success: true,
        message:
            "Availability saved: " +
            start +
            " - " +
            end +
            " on " +
            dayName +
            "."
    };
}

function removeDoctorAvailabilitySession(
    doctorId,
    dayName,
    sessionIndex
) {

    const sessions =
        getDoctorDayAvailabilitySessions(
            doctorId,
            dayName
        );

    const pick =
        Number(sessionIndex);

    if (
        !Number.isInteger(pick) ||
        pick < 1 ||
        pick > sessions.length
    ) {
        return {
            success: false,
            message:
                "Invalid session number."
        };
    }

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Availability");

    if (!sheet) {
        return {
            success: false,
            message:
                "Availability sheet not found."
        };
    }

    sheet.deleteRow(
        sessions[pick - 1].row
    );

    return {
        success: true,
        message:
            "Removed session " +
            pick +
            " for " +
            dayName +
            "."
    };
}

function clearDoctorDayAvailability(
    doctorId,
    dayName
) {

    const sessions =
        getDoctorDayAvailabilitySessions(
            doctorId,
            dayName
        );

    if (sessions.length === 0) {
        return {
            success: true,
            message:
                dayName +
                " already has no sessions."
        };
    }

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Availability");

    if (!sheet) {
        return {
            success: false,
            message:
                "Availability sheet not found."
        };
    }

    const rows =
        sessions
            .map(function (session) {
                return session.row;
            })
            .sort(function (a, b) {
                return b - a;
            });

    rows.forEach(function (row) {
        sheet.deleteRow(row);
    });

    return {
        success: true,
        message:
            "Cleared all sessions for " +
            dayName +
            "."
    };
}

function normalizeLeaveSheetDate(value) {

    if (value instanceof Date) {
        return Utilities.formatDate(
            value,
            TIMEZONE,
            "yyyy-MM-dd"
        );
    }

    return String(value || "").trim();
}

function getDoctorUpcomingLeaves(doctorId) {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Doctor_Leaves");

    if (!sheet) {
        return [];
    }

    const data =
        sheet.getDataRange().getValues();

    const today =
        Utilities.formatDate(
            new Date(),
            TIMEZONE,
            "yyyy-MM-dd"
        );

    const leaves = [];

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        if (
            String(data[i][0] || "").trim() !==
            String(doctorId).trim()
        ) {
            continue;
        }

        const dateString =
            normalizeLeaveSheetDate(
                data[i][1]
            );

        const active =
            String(data[i][3] || "")
                .toUpperCase() === "TRUE";

        if (
            !active ||
            !dateString ||
            dateString < today
        ) {
            continue;
        }

        leaves.push({
            date: dateString,
            reason:
                String(data[i][2] || "").trim(),
            row: i + 1
        });
    }

    leaves.sort(function (a, b) {
        return a.date.localeCompare(b.date);
    });

    return leaves;
}

function addDoctorLeave(
    doctorId,
    dateString,
    reason
) {

    if (!isValidISODate(dateString)) {
        return {
            success: false,
            message:
                "Invalid date. Use YYYY-MM-DD."
        };
    }

    if (
        isDoctorOnLeave(
            doctorId,
            dateString
        )
    ) {
        return {
            success: false,
            message:
                "Leave already active on " +
                dateString +
                "."
        };
    }

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    let sheet =
        ss.getSheetByName("Doctor_Leaves");

    if (!sheet) {
        sheet =
            ss.insertSheet("Doctor_Leaves");

        sheet.appendRow([
            "Doctor ID",
            "Date",
            "Reason",
            "Active"
        ]);
    }

    sheet.appendRow([
        String(doctorId).trim(),
        dateString,
        String(reason || "").trim(),
        "TRUE"
    ]);

    return {
        success: true,
        message:
            "Leave added for " +
            dateString +
            "."
    };
}

function addDoctorLeaveRange(
    doctorId,
    startDate,
    endDate,
    reason
) {

    if (
        !isValidISODate(startDate) ||
        !isValidISODate(endDate)
    ) {
        return {
            success: false,
            message:
                "Invalid date range. Use YYYY-MM-DD."
        };
    }

    if (startDate > endDate) {
        return {
            success: false,
            message:
                "Start date must be on or before end date."
        };
    }

    let added = 0;
    let skipped = 0;

    const cursor =
        new Date(
            startDate + "T00:00:00+05:30"
        );

    const end =
        new Date(
            endDate + "T00:00:00+05:30"
        );

    while (cursor.getTime() <= end.getTime()) {

        const iso =
            Utilities.formatDate(
                cursor,
                TIMEZONE,
                "yyyy-MM-dd"
            );

        const result =
            addDoctorLeave(
                doctorId,
                iso,
                reason
            );

        if (result.success) {
            added++;
        } else {
            skipped++;
        }

        cursor.setDate(
            cursor.getDate() + 1
        );
    }

    return {
        success: added > 0,
        message:
            "Leave range processed: " +
            added +
            " day(s) added" +
            (
                skipped
                    ? ", " + skipped + " skipped"
                    : ""
            ) +
            "."
    };
}

function deactivateDoctorLeave(
    doctorId,
    dateString
) {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Doctor_Leaves");

    if (!sheet) {
        return {
            success: false,
            message:
                "Doctor_Leaves sheet not found."
        };
    }

    const data =
        sheet.getDataRange().getValues();

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        if (
            String(data[i][0] || "").trim() !==
            String(doctorId).trim()
        ) {
            continue;
        }

        const rowDate =
            normalizeLeaveSheetDate(
                data[i][1]
            );

        const active =
            String(data[i][3] || "")
                .toUpperCase() === "TRUE";

        if (
            rowDate === dateString &&
            active
        ) {

            sheet
                .getRange(i + 1, 4)
                .setValue("FALSE");

            return {
                success: true,
                message:
                    "Leave cancelled for " +
                    dateString +
                    "."
            };
        }
    }

    return {
        success: false,
        message:
            "Active leave not found for " +
            dateString +
            "."
    };
}

function getDoctorPatientsSeen(doctorId) {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Appointments");

    if (!sheet) {
        return [];
    }

    const data =
        sheet.getDataRange().getValues();

    const byPhone = {};

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        if (
            String(data[i][3] || "").trim() !==
            String(doctorId).trim()
        ) {
            continue;
        }

        const status =
            String(data[i][6] || "")
                .trim()
                .toLowerCase();

        if (status === "cancelled") {
            continue;
        }

        const phone =
            String(data[i][5] || "").trim();

        if (!phone) {
            continue;
        }

        const name =
            String(data[i][4] || "").trim() ||
            "Unknown";

        const dateValue =
            data[i][1] instanceof Date
                ? Utilities.formatDate(
                    data[i][1],
                    TIMEZONE,
                    "dd-MMM-yyyy"
                )
                : data[i][1];

        const timeValue =
            data[i][2] instanceof Date
                ? Utilities.formatDate(
                    data[i][2],
                    TIMEZONE,
                    "hh:mm a"
                )
                : data[i][2];

        const appointmentDate =
            parseAppointmentDateTime(
                dateValue,
                timeValue
            );

        const sortKey =
            appointmentDate
                ? appointmentDate.getTime()
                : 0;

        const key =
            normalizeWhatsAppPhone(phone) ||
            phone;

        if (!byPhone[key]) {

            byPhone[key] = {
                name: name,
                phone: phone,
                lastVisit:
                    appointmentDate
                        ? Utilities.formatDate(
                            appointmentDate,
                            TIMEZONE,
                            "yyyy-MM-dd"
                        )
                        : "",
                lastVisitTime: sortKey,
                visitCount: 1
            };

        } else {

            byPhone[key].visitCount++;

            if (sortKey >= byPhone[key].lastVisitTime) {
                byPhone[key].lastVisitTime =
                    sortKey;
                byPhone[key].lastVisit =
                    appointmentDate
                        ? Utilities.formatDate(
                            appointmentDate,
                            TIMEZONE,
                            "yyyy-MM-dd"
                        )
                        : byPhone[key].lastVisit;
                byPhone[key].name = name;
            }
        }
    }

    return Object.keys(byPhone)
        .map(function (key) {
            return byPhone[key];
        })
        .sort(function (a, b) {
            return b.lastVisitTime -
                a.lastVisitTime;
        });
}

function parseAvailabilityTimeValue(value, date) {

    if (value instanceof Date) {
        return new Date(value.getTime());
    }

    const text =
        String(value || "").trim();

    if (!text) {
        return null;
    }

    const timeValue =
        convert12HourTo24Hour(text);

    if (timeValue) {

        const parsed =
            new Date(date);

        const parts =
            timeValue.split(":");

        parsed.setHours(
            Number(parts[0]),
            Number(parts[1]),
            0,
            0
        );

        return parsed;
    }

    const match =
        text.match(/^\d{1,2}:\d{2}$/);

    if (!match) {
        return null;
    }

    const parsed =
        new Date(date);
    const parts =
        text.split(":");

    parsed.setHours(
        Number(parts[0]),
        Number(parts[1]),
        0,
        0
    );

    return parsed;
}

function calendarEventExists(
    calendar,
    eventId
) {

    if (!calendar || !eventId) {
        return false;
    }

    try {

        const event =
            calendar.getEventById(
                String(eventId).trim()
            );

        return !!event;

    } catch (error) {

        return false;
    }
}

function findCalendarEventForAppointment(
    calendar,
    appointmentId,
    calendarEventId,
    appointmentDate,
    appointmentTime
) {

    if (!calendar) {
        return null;
    }

    if (calendarEventId) {

        try {

            const event =
                calendar.getEventById(
                    String(calendarEventId).trim()
                );

            if (event) {
                return event;
            }

        } catch (error) {

            Logger.log(
                "Could not look up Calendar event " +
                calendarEventId + ": " +
                error.message
            );
        }
    }

    const parsedDate =
        appointmentDate instanceof Date
            ? appointmentDate
            : parseAppointmentDateTime(
                appointmentDate,
                appointmentTime
            );

    if (!parsedDate) {
        return null;
    }

    const dayEvents =
        calendar.getEventsForDay(parsedDate);

    const targetId =
        String(appointmentId);

    for (
        let i = 0;
        i < dayEvents.length;
        i++
    ) {

        if (
            dayEvents[i]
                .getDescription()
                .indexOf(
                    "Appointment ID: " +
                    targetId
                ) !== -1
        ) {
            return dayEvents[i];
        }
    }

    return null;
}

function getAvailableSlots(
    doctorId,
    dateString
) {

    const date =
        new Date(
            `${dateString}T00:00:00+05:30`
        );

    if (!isValidISODate(dateString)) {
        throw new Error(
            "Invalid date. Use YYYY-MM-DD."
        );
    }

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const availabilitySheet =
        ss.getSheetByName("Availability");

    if (!availabilitySheet) {
        throw new Error(
            "Availability sheet not found."
        );
    }

    const doctor =
        getDoctorRecord(doctorId);

    if (
        !doctor ||
        !doctor.calendarId
    ) {

        throw new Error(
            "Doctor or Calendar ID not found."
        );
    }

    const calendarId = doctor.calendarId;
    const doctorName = doctor.doctorName;

    if (
        isDoctorOnLeave(
            doctorId,
            dateString
        )
    ) {
        return [];
    }

    const appointmentDuration =
        getDoctorAppointmentDuration(
            doctorId
        );

    const availabilityData =
        availabilitySheet.getDataRange().getValues();

    const dayName =
        Utilities.formatDate(
            date,
            TIMEZONE,
            "EEEE"
        );

    const availabilityWindows = [];

    for (
        let i = 1;
        i < availabilityData.length;
        i++
    ) {

        const rowDoctorId =
            String(availabilityData[i][0] || "").trim();

        const rowDay =
            String(availabilityData[i][1] || "").trim();

        if (
            rowDoctorId ===
            String(doctorId).trim() &&
            rowDay ===
            String(dayName)
        ) {

            const startTime =
                parseAvailabilityTimeValue(
                    availabilityData[i][2],
                    date
                );

            const endTime =
                parseAvailabilityTimeValue(
                    availabilityData[i][3],
                    date
                );

            if (startTime && endTime) {
                availabilityWindows.push({
                    start: startTime,
                    end: endTime
                });
            }
        }
    }

    if (availabilityWindows.length === 0) {
        return [];
    }

    const calendar =
        CalendarApp.getCalendarById(
            calendarId
        );

    if (!calendar) {

        throw new Error(
            "Calendar not found."
        );
    }

    const slots = [];
    const now = new Date();

    for (
        let w = 0;
        w < availabilityWindows.length;
        w++
    ) {

        const window =
            availabilityWindows[w];

        let current =
            new Date(date);

        current.setHours(
            window.start.getHours(),
            window.start.getMinutes(),
            0,
            0
        );

        const closingTime =
            new Date(date);

        closingTime.setHours(
            window.end.getHours(),
            window.end.getMinutes(),
            0,
            0
        );

        while (
            current.getTime() +
            appointmentDuration * 60000 <=
            closingTime.getTime()
        ) {

            const slotEnd =
                new Date(
                    current.getTime() +
                    appointmentDuration * 60000
                );

            const events =
                calendar.getEvents(
                    current,
                    slotEnd
                );

            const sameDay =
                Utilities.formatDate(
                    date,
                    TIMEZONE,
                    "yyyy-MM-dd"
                ) ===
                Utilities.formatDate(
                    now,
                    TIMEZONE,
                    "yyyy-MM-dd"
                );

            if (
                (
                    current.getTime() > now.getTime() ||
                    !sameDay
                ) &&
                events.length === 0
            ) {

                slots.push(
                    Utilities.formatDate(
                        current,
                        TIMEZONE,
                        "hh:mm a"
                    )
                );
            }

            current =
                new Date(
                    current.getTime() +
                    appointmentDuration * 60000
                );
        }
    }

    Logger.log(
        "Available slots for " +
        doctorName +
        " on " +
        dayName +
        ": " +
        slots.join(", ")
    );

    const uniqueSlots = [];
    const seen = {};

    for (
        let i = 0;
        i < slots.length;
        i++
    ) {

        if (!seen[slots[i]]) {
            seen[slots[i]] = true;
            uniqueSlots.push(slots[i]);
        }
    }

    return uniqueSlots;
}


// ============================================================
// PATIENT REGISTRY
// ============================================================

function isValidPatientName(name) {

    const value =
        String(name || "").trim();

    if (value.length < 2) {
        return false;
    }

    if (/^\d+$/.test(value)) {
        return false;
    }

    return true;
}

function ensurePatientsSheet() {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    let sheet =
        ss.getSheetByName("Patients");

    if (!sheet) {

        sheet =
            ss.insertSheet("Patients");

        sheet.appendRow([
            "Patient ID",
            "Phone",
            "Name",
            "Language",
            "First Seen",
            "Last Visit",
            "Notes"
        ]);
    }

    return sheet;
}

function generatePatientId() {

    return (
        "PAT-" +
        Utilities.formatDate(
            new Date(),
            TIMEZONE,
            "yyyyMMdd"
        ) +
        "-" +
        String(
            Math.floor(Math.random() * 9000) + 1000
        )
    );
}

function findPatientByPhone(phone) {

    const sheet =
        ensurePatientsSheet();

    const data =
        sheet.getDataRange().getValues();

    const target =
        normalizeWhatsAppPhone(phone);

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        if (
            phonesMatch(
                data[i][1],
                target
            )
        ) {

            return {
                patientId:
                    String(data[i][0]).trim(),
                phone:
                    String(data[i][1]).trim(),
                name:
                    String(data[i][2] || "").trim(),
                language:
                    String(data[i][3] || "EN")
                        .trim()
                        .toUpperCase(),
                row: i + 1
            };
        }
    }

    return null;
}

function upsertPatient(
    phone,
    name,
    language,
    options
) {

    const opts = options || {};
    const sheet = ensurePatientsSheet();
    const lock = LockService.getScriptLock();
    let locked = false;

    try {

        if (!opts.skipLock) {

            if (!lock.tryLock(10000)) {

                return {
                    success: false,
                    message:
                        "Unable to save patient record. Please try again."
                };
            }

            locked = true;
        }

        const existing =
            findPatientByPhone(phone);

        const now = new Date();
        const lang =
            String(language || "EN")
                .trim()
                .toUpperCase();

        if (existing) {

            sheet.getRange(existing.row, 1, 1, 7).setValues([[
                existing.patientId,
                existing.phone,
                name || existing.name,
                lang || existing.language,
                sheet.getRange(existing.row, 5).getValue(),
                opts.updateLastVisit === false
                    ? sheet.getRange(existing.row, 6).getValue()
                    : now,
                sheet.getRange(existing.row, 7).getValue()
            ]]);

            return {
                success: true,
                patientId: existing.patientId,
                name: name || existing.name
            };
        }

        const patientId = generatePatientId();

        sheet.appendRow([
            patientId,
            String(phone).trim(),
            name,
            lang,
            now,
            opts.updateLastVisit === false ? "" : now,
            ""
        ]);

        return {
            success: true,
            patientId: patientId,
            name: name
        };

    } finally {

        if (
            locked &&
            lock.hasLock()
        ) {
            lock.releaseLock();
        }
    }
}


function registerPatientForBooking(
    phone,
    name,
    language
) {

    let lang =
        String(language || "")
            .trim()
            .toUpperCase();

    if (
        ["EN", "TE", "HI"].indexOf(lang) === -1
    ) {

        const existing =
            findPatientByPhone(phone);

        lang =
            existing &&
            ["EN", "TE", "HI"].indexOf(
                existing.language
            ) !== -1
                ? existing.language
                : "EN";
    }

    return upsertPatient(
        phone,
        name,
        lang,
        {
            updateLastVisit: true,
            skipLock: true
        }
    );
}

function resolveKnownPatientName(phone) {

    const patient =
        findPatientByPhone(phone);

    if (
        patient &&
        isValidPatientName(patient.name)
    ) {
        return patient.name;
    }

    return findPatientNameFromAppointments(phone);
}

function findPatientNameFromAppointments(phone) {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Appointments");

    if (!sheet) {
        return "";
    }

    const data =
        sheet.getDataRange().getValues();

    let bestName = "";
    let bestTime = 0;

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        if (
            !phonesMatch(
                data[i][5],
                phone
            )
        ) {
            continue;
        }

        const status =
            String(data[i][6] || "")
                .trim()
                .toLowerCase();

        if (status === "cancelled") {
            continue;
        }

        const name =
            String(data[i][4] || "").trim();

        if (!isValidPatientName(name)) {
            continue;
        }

        const dateValue =
            data[i][1] instanceof Date
                ? Utilities.formatDate(
                    data[i][1],
                    TIMEZONE,
                    "dd-MMM-yyyy"
                )
                : data[i][1];

        const timeValue =
            data[i][2] instanceof Date
                ? Utilities.formatDate(
                    data[i][2],
                    TIMEZONE,
                    "hh:mm a"
                )
                : data[i][2];

        const appointmentDate =
            parseAppointmentDateTime(
                dateValue,
                timeValue
            );

        const sortKey =
            appointmentDate
                ? appointmentDate.getTime()
                : 0;

        if (
            sortKey >= bestTime ||
            (
                sortKey === bestTime &&
                !bestName
            )
        ) {
            bestTime = sortKey;
            bestName = name;
        }
    }

    return bestName;
}

function ensurePatientRecordFromHistory(
    phone,
    language
) {

    if (findPatientByPhone(phone)) {
        return;
    }

    const name =
        findPatientNameFromAppointments(phone);

    if (!isValidPatientName(name)) {
        return;
    }

    upsertPatient(
        phone,
        name,
        language || "EN",
        { updateLastVisit: false }
    );
}

function syncPatientLanguagePreference(
    phone,
    language
) {

    const lang =
        String(language || "EN")
            .trim()
            .toUpperCase();

    if (
        ["EN", "TE", "HI"].indexOf(lang) === -1
    ) {
        return;
    }

    const existing =
        findPatientByPhone(phone);

    if (existing) {

        upsertPatient(
            phone,
            existing.name,
            lang,
            { updateLastVisit: false }
        );

        return;
    }

    const name =
        findPatientNameFromAppointments(phone);

    if (isValidPatientName(name)) {

        upsertPatient(
            phone,
            name,
            lang,
            { updateLastVisit: false }
        );
    }
}

function resolvePatientLanguage(phone, session) {

    if (
        session &&
        session.role === "DOCTOR"
    ) {
        return "EN";
    }

    if (
        session &&
        session.state === "LANGUAGE_SELECT"
    ) {
        return "EN";
    }

    const sessionLang =
        session &&
        String(session.language || "")
            .trim()
            .toUpperCase();

    if (
        ["EN", "TE", "HI"].indexOf(
            sessionLang
        ) !== -1
    ) {
        return sessionLang;
    }

    const patient =
        findPatientByPhone(phone);

    if (
        patient &&
        ["EN", "TE", "HI"].indexOf(
            patient.language
        ) !== -1
    ) {
        return patient.language;
    }

    return "EN";
}

function resolvePatientNameForBooking(
    phone,
    session,
    senderName
) {

    if (
        session &&
        isValidPatientName(
            session.patientName
        )
    ) {
        return session.patientName;
    }

    const knownName =
        resolveKnownPatientName(phone);

    if (isValidPatientName(knownName)) {
        return knownName;
    }

    if (isValidPatientName(senderName)) {
        return String(senderName).trim();
    }

    return "WhatsApp Patient";
}

function syncPatientsFromAppointments() {

    requireDebugMode(
        "syncPatientsFromAppointments"
    );

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Appointments");

    if (!sheet) {
        throw new Error(
            "Appointments sheet not found."
        );
    }

    const data =
        sheet.getDataRange().getValues();

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        const status =
            String(data[i][6] || "")
                .trim()
                .toLowerCase();

        if (status === "cancelled") {
            skipped++;
            continue;
        }

        const phone = data[i][5];
        const name =
            String(data[i][4] || "").trim();

        if (
            !phone ||
            !isValidPatientName(name)
        ) {
            skipped++;
            continue;
        }

        const existing =
            findPatientByPhone(phone);

        const result =
            upsertPatient(
                phone,
                name,
                existing
                    ? existing.language
                    : "EN",
                { updateLastVisit: true }
            );

        if (!result.success) {
            skipped++;
            continue;
        }

        if (existing) {
            updated++;
        } else {
            created++;
        }
    }

    const summary = {
        created: created,
        updated: updated,
        skipped: skipped,
        total: created + updated
    };

    Logger.log(
        "syncPatientsFromAppointments: " +
        JSON.stringify(summary)
    );

    return summary;
}

function patientNeedsNameCapture(phone) {

    return !isValidPatientName(
        resolveKnownPatientName(phone)
    );
}


// ============================================================
// 3. BOOK APPOINTMENT
// ============================================================

function bookAppointment(
    doctorId,
    dateString,
    timeString,
    patientName,
    patientPhone,
    patientLanguage
) {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const appointmentSheet =
        ss.getSheetByName("Appointments");

    const doctor =
        getDoctorRecord(doctorId);

    if (
        !doctor ||
        !doctor.calendarId
    ) {

        return {
            success: false,
            message: "Doctor not found."
        };
    }

    const doctorName = doctor.doctorName;
    const clinicName = doctor.clinicName;
    const calendarId = doctor.calendarId;

    // ----------------------------------------------------------
    // Create date/time
    // ----------------------------------------------------------

    if (
        !isValidISODate(
            dateString
        )
    ) {

        return {
            success: false,
            message:
                "Invalid appointment date."
        };
    }

    const time24 =
        convert12HourTo24Hour(
            timeString
        );

    if (!time24) {

        return {
            success: false,
            message:
                "Invalid appointment time."
        };
    }

    const startTime =
        new Date(
            `${dateString}T${time24}:00+05:30`
        );

    if (isNaN(startTime.getTime())) {

        return {
            success: false,
            message:
                "Invalid date or time."
        };
    }

    const appointmentDuration =
        getDoctorAppointmentDuration(
            doctorId
        );

    const endTime =
        new Date(
            startTime.getTime() +
            appointmentDuration * 60000
        );

    // ----------------------------------------------------------
    // Calendar
    // ----------------------------------------------------------

    const calendar =
        CalendarApp.getCalendarById(
            calendarId
        );

    if (!calendar) {

        return {
            success: false,
            message:
                "Google Calendar not found."
        };
    }

    // Do not allow a direct caller to create an appointment in the past.
    if (startTime.getTime() <= new Date().getTime()) {

        return {
            success: false,
            message:
                "Appointment time must be in the future."
        };
    }

    // ----------------------------------------------------------
    // Validate against working hours
    // ----------------------------------------------------------

    const availableSlots =
        getAvailableSlots(
            doctorId,
            dateString
        );

    const formattedRequestedTime =
        Utilities.formatDate(
            startTime,
            TIMEZONE,
            "hh:mm a"
        );

    if (
        !availableSlots.includes(
            formattedRequestedTime
        )
    ) {

        return {
            success: false,
            message:
                "The selected appointment time is not available."
        };
    }

    // ----------------------------------------------------------
    // Generate appointment ID
    // ----------------------------------------------------------

    const appointmentId =
        "A" +
        Utilities.getUuid()
            .replace(/-/g, "")
            .substring(0, 8)
            .toUpperCase();

    // ----------------------------------------------------------
    // Create Calendar event
    // ----------------------------------------------------------

    const lock =
        LockService.getScriptLock();

    let event = null;

    try {

        if (!lock.tryLock(30000)) {

            return {
                success: false,
                message:
                    "Booking is busy. Please try again."
            };
        }

        if (
            hasActiveAppointmentOnDate(
                patientPhone,
                dateString
            )
        ) {

            return {
                success: false,
                message:
                    "You already have an active appointment on this date."
            };
        }

        const existingEvents =
            calendar.getEvents(
                startTime,
                endTime
            );

        if (existingEvents.length > 0) {

            return {
                success: false,
                message:
                    "This appointment slot is already booked."
            };
        }

        event =
            calendar.createEvent(
                `Appointment - ${patientName}`,
                startTime,
                endTime,
                {
                    description:
                        `Appointment ID: ${appointmentId}\n` +
                        `Doctor: ${doctorName}\n` +
                        `Patient: ${patientName}`,

                    location: clinicName
                }
            );

        // ----------------------------------------------------------
        // Save appointment
        // ----------------------------------------------------------

        const patientRecord =
            registerPatientForBooking(
                patientPhone,
                patientName,
                patientLanguage
            );

        const patientId =
            patientRecord.success
                ? patientRecord.patientId
                : "";

        appointmentSheet.appendRow([

            appointmentId,

            Utilities.formatDate(
                startTime,
                TIMEZONE,
                "dd-MMM-yyyy"
            ),

            Utilities.formatDate(
                startTime,
                TIMEZONE,
                "HH:mm"
            ),

            doctorId,

            patientName,

            patientPhone,

            "Confirmed",

            event.getId(),

            patientId

        ]);

    } catch (error) {

        if (event) {
            try {
                event.deleteEvent();
            } catch (deleteError) {
                console.error(
                    "Failed to roll back appointment event after booking failure.",
                    deleteError
                );
            }
        }

        console.error(
            "Booking failed; calendar event was rolled back.",
            error
        );

        return {
            success: false,
            message:
                "Unable to save appointment. No booking was created."
        };

    } finally {

        if (lock.hasLock()) {
            lock.releaseLock();
        }
    }

    // ----------------------------------------------------------
    // Return result
    // ----------------------------------------------------------

    return {

        success: true,

        appointmentId:
            appointmentId,

        doctor:
            doctorName,

        patient:
            patientName,

        date:
            Utilities.formatDate(
                startTime,
                TIMEZONE,
                "dd-MMM-yyyy"
            ),

        time:
            Utilities.formatDate(
                startTime,
                TIMEZONE,
                "hh:mm a"
            )
    };
}


// ============================================================
// 5. CANCEL APPOINTMENT - SECURE
// ============================================================

function cancelAppointment(
    appointmentId,
    patientPhone,
    options
) {

    const opts = options || {};

    const lock =
        LockService.getScriptLock();

    if (!lock.tryLock(30000)) {

        return {
            success: false,
            message:
                "Cancellation is busy. Please try again."
        };
    }

    try {

        const ss =
            SpreadsheetApp.getActiveSpreadsheet();

        const appointmentSheet =
            ss.getSheetByName("Appointments");

        const appointmentData =
            appointmentSheet
                .getDataRange()
                .getValues();

        // ----------------------------------------------------------
        // Find appointment
        // ----------------------------------------------------------

        for (
            let i = 1;
            i < appointmentData.length;
            i++
        ) {

            const rowAppointmentId =
                String(appointmentData[i][0]);

            if (
                rowAppointmentId ===
                String(appointmentId)
            ) {

                const rowPhone =
                    String(appointmentData[i][5]);

                const status =
                    String(appointmentData[i][6]);

                const calendarEventId =
                    appointmentData[i][7];

                const rowDoctorId =
                    String(
                        appointmentData[i][3] || ""
                    ).trim();

                const authorizedDoctorId =
                    String(
                        opts.authorizedDoctorId || ""
                    ).trim();

                // ------------------------------------------------------
                // SECURITY CHECK
                // ------------------------------------------------------

                if (authorizedDoctorId) {

                    if (
                        rowDoctorId !==
                        authorizedDoctorId
                    ) {

                        return {
                            success: false,
                            message:
                                "Appointment does not belong to this doctor."
                        };
                    }

                } else if (
                    !phonesMatch(
                        rowPhone,
                        patientPhone
                    )
                ) {

                    return {
                        success: false,
                        message:
                            "Appointment does not belong to this phone number."
                    };
                }

                // ------------------------------------------------------
                // Already cancelled
                // ------------------------------------------------------

                if (
                    normalizeAppointmentStatus(
                        status
                    ) ===
                    APPOINTMENT_STATUS.CANCELLED
                ) {

                    return {
                        success: false,
                        message:
                            "Appointment is already cancelled."
                    };
                }

                const normalizedStatus =
                    normalizeAppointmentStatus(
                        status
                    );

                if (
                    normalizedStatus ===
                    APPOINTMENT_STATUS.COMPLETED ||
                    normalizedStatus ===
                    APPOINTMENT_STATUS.NO_SHOW
                ) {

                    return {
                        success: false,
                        message:
                            "Appointment is already marked as " +
                            normalizedStatus +
                            "."
                    };
                }

                // ------------------------------------------------------
                // Find doctor's calendar
                // ------------------------------------------------------

                const doctorId =
                    appointmentData[i][3];

                const doctor =
                    getDoctorRecord(doctorId);

                if (
                    !doctor ||
                    !doctor.calendarId
                ) {

                    return {
                        success: false,
                        message:
                            "Doctor calendar is not configured; appointment was not cancelled."
                    };
                }

                const calendar =
                    CalendarApp.getCalendarById(
                        String(doctor.calendarId).trim()
                    );

                if (!calendar) {

                    return {
                        success: false,
                        message:
                            "Doctor calendar was not found; appointment was not cancelled."
                    };
                }

                const event =
                    findCalendarEventForAppointment(
                        calendar,
                        rowAppointmentId,
                        calendarEventId,
                        appointmentData[i][1],
                        appointmentData[i][2]
                    );

                if (!event) {

                    return {
                        success: false,
                        message:
                            "Calendar event was not found; appointment was not cancelled."
                    };
                }

                try {

                    event.deleteEvent();

                } catch (error) {

                    Logger.log(
                        "Could not delete Calendar event " +
                        rowAppointmentId + ": " +
                        error.message
                    );

                    return {
                        success: false,
                        message:
                            "Could not remove the Google Calendar event; appointment was not cancelled."
                    };
                }

                // ------------------------------------------------------
                // Update Sheet
                // ------------------------------------------------------

                appointmentSheet
                    .getRange(i + 1, 7)
                    .setValue("Cancelled");

                return {

                    success: true,

                    appointmentId:
                        appointmentId,

                    message:
                        "Appointment cancelled successfully."
                };
            }
        }

        return {

            success: false,

            message:
                "Appointment not found."
        };

    } finally {

        if (lock.hasLock()) {
            lock.releaseLock();
        }
    }
}


// ============================================================
// 7. RESCHEDULE APPOINTMENT - SECURE
// ============================================================

function rescheduleAppointment(
    appointmentId,
    patientPhoneInput,
    newDateString,
    newTimeString,
    options
) {

    const opts = options || {};

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const appointmentSheet =
        ss.getSheetByName("Appointments");

    const appointmentData =
        appointmentSheet
            .getDataRange()
            .getValues();

    // ----------------------------------------------------------
    // Variables
    // ----------------------------------------------------------

    let appointmentRow = -1;
    let appointmentIndex = -1;

    let doctorId = "";
    let patientName = "";
    let storedPatientPhone = "";
    let calendarEventId = "";
    let status = "";

    // ----------------------------------------------------------
    // Find appointment
    // ----------------------------------------------------------

    for (
        let i = 1;
        i < appointmentData.length;
        i++
    ) {

        if (
            String(appointmentData[i][0]) ===
            String(appointmentId)
        ) {

            appointmentRow =
                i + 1;
            appointmentIndex = i;

            doctorId =
                appointmentData[i][3];

            patientName =
                appointmentData[i][4];

            storedPatientPhone =
                String(appointmentData[i][5]);

            status =
                String(appointmentData[i][6]);

            calendarEventId =
                appointmentData[i][7];

            break;
        }
    }

    // ----------------------------------------------------------
    // Appointment not found
    // ----------------------------------------------------------

    if (
        appointmentRow === -1
    ) {

        return {

            success: false,

            message:
                "Appointment ID not found."
        };
    }

    // ----------------------------------------------------------
    // SECURITY CHECK
    // ----------------------------------------------------------

    const authorizedDoctorId =
        String(
            opts.authorizedDoctorId || ""
        ).trim();

    if (authorizedDoctorId) {

        if (
            String(doctorId || "").trim() !==
            authorizedDoctorId
        ) {

            return {

                success: false,

                message:
                    "Appointment does not belong to this doctor."
            };
        }

    } else if (
        !phonesMatch(
            storedPatientPhone,
            patientPhoneInput
        )
    ) {

        return {

            success: false,

            message:
                "Appointment does not belong to this phone number."
        };
    }

    // ----------------------------------------------------------
    // Check status
    // ----------------------------------------------------------

    const normalizedStatus =
        normalizeAppointmentStatus(status);

    if (
        normalizedStatus ===
        APPOINTMENT_STATUS.CANCELLED
    ) {

        return {

            success: false,

            message:
                "Cancelled appointments cannot be rescheduled."
        };
    }

    if (
        normalizedStatus ===
        APPOINTMENT_STATUS.COMPLETED ||
        normalizedStatus ===
        APPOINTMENT_STATUS.NO_SHOW
    ) {

        return {

            success: false,

            message:
                "Appointments marked as " +
                normalizedStatus +
                " cannot be rescheduled."
        };
    }

    // ----------------------------------------------------------
    // Find doctor
    // ----------------------------------------------------------

    const doctor =
        getDoctorRecord(doctorId);

    if (
        !doctor ||
        !doctor.calendarId
    ) {

        return {

            success: false,

            message:
                "Doctor calendar not found."
        };
    }

    const doctorName = doctor.doctorName;
    const clinicName = doctor.clinicName;
    const calendarId = doctor.calendarId;

    const calendar =
        CalendarApp.getCalendarById(
            calendarId
        );

    if (!calendar) {

        return {

            success: false,

            message:
                "Google Calendar not found."
        };
    }

    // ----------------------------------------------------------
    // Create new date/time
    // ----------------------------------------------------------

    if (
        !isValidISODate(
            newDateString
        )
    ) {

        return {
            success: false,
            message:
                "Invalid new appointment date."
        };
    }

    const newTime24 =
        convert12HourTo24Hour(
            newTimeString
        );

    if (!newTime24) {

        return {
            success: false,
            message:
                "Invalid new appointment time."
        };
    }

    const newStartTime =
        new Date(
            `${newDateString}T${newTime24}:00+05:30`
        );

    if (
        isNaN(
            newStartTime.getTime()
        )
    ) {

        return {
            success: false,
            message:
                "Invalid new date or time."
        };
    }

    const appointmentDuration =
        getDoctorAppointmentDuration(
            doctorId
        );

    const newEndTime =
        new Date(
            newStartTime.getTime() +
            appointmentDuration * 60000
        );

    let oldEvent = null;
    let newEvent = null;

    const originalSnapshot =
        captureAppointmentSheetSnapshot(
            appointmentData[appointmentIndex]
        );

    const originalStartTime =
        parseAppointmentSheetDateTime(
            originalSnapshot.date,
            originalSnapshot.time
        );

    const originalFormattedTime =
        originalStartTime
            ? Utilities.formatDate(
                originalStartTime,
                TIMEZONE,
                "hh:mm a"
            )
            : "";

    // ----------------------------------------------------------
    // Validate against working hours
    // ----------------------------------------------------------

    const availableSlots =
        getAvailableSlots(
            doctorId,
            newDateString
        );

    const formattedRequestedTime =
        Utilities.formatDate(
            newStartTime,
            TIMEZONE,
            "hh:mm a"
        );

    // Check if trying to reschedule to same date/time
    const normalizedOriginalDate =
        normalizeAppointmentDate(
            originalSnapshot.date
        );

    const isSameDateAndTime =
        !!originalStartTime &&
        newDateString === normalizedOriginalDate &&
        formattedRequestedTime ===
            originalFormattedTime;

    if (
        !availableSlots.includes(formattedRequestedTime) &&
        !isSameDateAndTime
    ) {

        return {
            success: false,
            message:
                "The selected time is not available."
        };
    }

    const lock =
        LockService.getScriptLock();

    try {

        if (!lock.tryLock(30000)) {

            return {
                success: false,
                message:
                    "Reschedule is busy. Please try again."
            };
        }

        if (
            hasActiveAppointmentOnDate(
                patientPhoneInput,
                newDateString,
                appointmentId
            )
        ) {

            return {
                success: false,
                message:
                    "You already have an active appointment on this date."
            };
        }

        // ----------------------------------------------------------
        // Check new slot
        // ----------------------------------------------------------

        const existingEvents =
            calendar.getEvents(
                newStartTime,
                newEndTime
            );

        const conflictingEvents =
            existingEvents.filter(
                event =>
                    event.getId() !==
                    calendarEventId
            );

        if (
            conflictingEvents.length > 0
        ) {

            return {

                success: false,

                message:
                    "The new appointment slot is already booked."
            };
        }

        oldEvent =
            findCalendarEventForAppointment(
                calendar,
                appointmentId,
                calendarEventId,
                appointmentData[appointmentIndex][1],
                appointmentData[appointmentIndex][2]
            );

        // ----------------------------------------------------------
        // Create new Calendar event first
        // ----------------------------------------------------------

        newEvent =
            calendar.createEvent(
                `Appointment - ${patientName}`,
                newStartTime,
                newEndTime,
                {

                    description:
                        `Appointment ID: ${appointmentId}\n` +
                        `Doctor: ${doctorName}\n` +
                        `Patient: ${patientName}`,

                    location:
                        clinicName
                }
            );

        // ----------------------------------------------------------
        // Update Sheet
        // ----------------------------------------------------------

        writeAppointmentSheetSchedule(
            appointmentSheet,
            appointmentRow,
            newStartTime,
            "Confirmed",
            newEvent.getId()
        );

        // ----------------------------------------------------------
        // Delete old event only after the sheet has been updated.
        // ----------------------------------------------------------

        if (oldEvent) {
            oldEvent.deleteEvent();
        }

    } catch (error) {

        if (newEvent) {
            try {
                newEvent.deleteEvent();
            } catch (deleteError) {
                console.error(
                    "Failed to roll back newly created reschedule event.",
                    deleteError
                );
            }
        }

        if (appointmentRow > 0) {
            restoreAppointmentSheetSchedule(
                appointmentSheet,
                appointmentRow,
                originalSnapshot
            );
        }

        if (
            oldEvent &&
            oldEvent.getId() &&
            !calendarEventExists(
                calendar,
                oldEvent.getId()
            )
        ) {
            try {
                const oldStartTime =
                    parseAppointmentSheetDateTime(
                        originalSnapshot.date,
                        originalSnapshot.time
                    );

                if (oldStartTime) {
                    const oldEndTime =
                        new Date(
                            oldStartTime.getTime() +
                            appointmentDuration *
                            60000
                        );

                    const restoredOldEvent =
                        calendar.createEvent(
                            `Appointment - ${patientName}`,
                            oldStartTime,
                            oldEndTime,
                            {
                                description:
                                    `Appointment ID: ${appointmentId}\n` +
                                    `Doctor: ${doctorName}\n` +
                                    `Patient: ${patientName}`,

                                location: clinicName
                            }
                        );

                    appointmentSheet
                        .getRange(
                            appointmentRow,
                            8
                        )
                        .setValue(
                            restoredOldEvent.getId()
                        );
                }
            } catch (restoreError) {
                console.error(
                    "Failed to restore original event during reschedule rollback.",
                    restoreError
                );
            }
        }

        console.error(
            "Reschedule failed; original appointment was restored.",
            error
        );

        return {
            success: false,
            message:
                "Unable to complete reschedule. The original appointment was restored."
        };

    } finally {

        if (lock.hasLock()) {
            lock.releaseLock();
        }
    }

    // ----------------------------------------------------------
    // Return result
    // ----------------------------------------------------------

    return {

        success: true,

        appointmentId:
            appointmentId,

        doctor:
            doctorName,

        patient:
            patientName,

        date:
            Utilities.formatDate(
                newStartTime,
                TIMEZONE,
                "dd-MMM-yyyy"
            ),

        time:
            Utilities.formatDate(
                newStartTime,
                TIMEZONE,
                "hh:mm a"
            ),

        message:
            "Appointment rescheduled successfully."
    };
}


// ============================================================
// 9. GET DOCTORS
// ============================================================

function getDoctors() {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Doctors");

    const data =
        sheet.getDataRange().getValues();

    const doctors = [];

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        if (!data[i][0]) {
            continue;
        }

        doctors.push({

            doctorId:
                data[i][0],

            doctorName:
                data[i][1],

            clinicName:
                data[i][2]
        });
    }

    return doctors;
}


function getDoctorRecord(doctorId) {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Doctors");

    if (!sheet) {
        return null;
    }

    const data =
        sheet.getDataRange().getValues();

    const target =
        String(doctorId || "").trim();

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        if (
            String(data[i][0]).trim() ===
            target
        ) {

            return {
                doctorId:
                    String(data[i][0]).trim(),
                doctorName:
                    String(data[i][1] || "").trim(),
                clinicName:
                    String(data[i][2] || "").trim(),
                calendarId:
                    String(data[i][3] || "").trim(),
                whatsApp:
                    String(data[i][4] || "").trim(),
                appointmentDuration:
                    Number(data[i][5]) || 30
            };
        }
    }

    return null;
}


function buildDoctorSelectionMessage() {

    const doctors = getDoctors();

    if (doctors.length === 0) {
        return "❌ No doctors are currently available.";
    }

    let message =
        "📅 Book Appointment\n\n" +
        "Select a doctor:\n\n";

    for (
        let i = 0;
        i < doctors.length;
        i++
    ) {

        message +=
            (i + 1) + ". " +
            doctors[i].doctorName +
            (doctors[i].clinicName
                ? " — " + doctors[i].clinicName
                : "") +
            "\n";
    }

    return message +
        "\nReply with the doctor's number.";
}


function hasActiveAppointmentOnDate(
    patientPhone,
    dateString,
    excludedAppointmentId
) {

    const targetDateIso =
        normalizeAppointmentDate(dateString);

    if (!targetDateIso) {
        return false;
    }

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Appointments");

    if (!sheet) {
        throw new Error(
            "Appointments sheet not found."
        );
    }

    const data =
        sheet.getDataRange().getValues();

    const excludedId =
        String(excludedAppointmentId || "").trim();

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        const status =
            String(data[i][6] || "")
                .trim()
                .toLowerCase();

        const isInactive =
            status === "cancelled" ||
            status === "completed" ||
            status === "no-show" ||
            status === "noshow" ||
            status === "no show";

        const rowDateIso =
            normalizeAppointmentDate(
                data[i][1]
            );

        if (
            String(data[i][0] || "").trim() !== excludedId &&
            phonesMatch(
                data[i][5],
                patientPhone
            ) &&
            rowDateIso === targetDateIso &&
            !isInactive
        ) {
            return true;
        }
    }

    return false;
}


// ============================================================
// 10. GET PATIENT APPOINTMENTS
// ============================================================

function getMyAppointments(
    patientPhone
) {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Appointments");

    const data =
        sheet.getDataRange().getValues();

    const appointments = [];

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        const appointmentId =
            data[i][0];

        const date =
            data[i][1];

        const time =
            data[i][2];

        const doctorId =
            data[i][3];

        const patientName =
            data[i][4];

        const phone =
            data[i][5];

        const status =
            data[i][6];

        if (
            phonesMatch(
                phone,
                patientPhone
            )
        ) {

            // -------------------------------------------------------
            // Format appointment time
            // -------------------------------------------------------

            let appointmentTime = "";

            if (data[i][2] instanceof Date) {

                appointmentTime =
                    Utilities.formatDate(
                        data[i][2],
                        TIMEZONE,
                        "hh:mm a"
                    );

            } else {

                appointmentTime =
                    String(data[i][2]).trim();

            }


            // -------------------------------------------------------
            // Add appointment
            // -------------------------------------------------------

            appointments.push({

                appointmentId:
                    String(appointmentId).trim(),

                date:
                    data[i][1] instanceof Date
                        ? Utilities.formatDate(
                            data[i][1],
                            TIMEZONE,
                            "dd-MMM-yyyy"
                        )
                        : String(date).trim(),

                time:
                    appointmentTime,

                doctorId:
                    String(doctorId).trim(),

                patientName:
                    String(patientName).trim(),

                phone:
                    String(phone).trim(),

                status:
                    String(status).trim()

            });
        }
    }

    return appointments;
}


// ============================================================
// 11. UNIFIED API
// ============================================================

function api(
    action,
    data
) {

    switch (action) {

        // --------------------------------------------------------
        // GET DOCTORS
        // --------------------------------------------------------

        case "getDoctors":

            return getDoctors();


        // --------------------------------------------------------
        // GET AVAILABLE SLOTS
        // --------------------------------------------------------

        case "getAvailableSlots":

            return getAvailableSlots(
                data.doctorId,
                data.date
            );


        // --------------------------------------------------------
        // BOOK
        // --------------------------------------------------------

        case "book":

            return bookAppointment(

                data.doctorId,

                data.date,

                data.time,

                data.patientName,

                data.patientPhone,

                data.patientLanguage
            );


        // --------------------------------------------------------
        // GET PATIENT APPOINTMENTS
        // --------------------------------------------------------

        case "getMyAppointments":

            return getMyAppointments(
                data.patientPhone
            );


        // --------------------------------------------------------
        // CANCEL - SECURE
        // --------------------------------------------------------

        case "cancel":

            return cancelAppointment(

                data.appointmentId,

                data.patientPhone
            );


        // --------------------------------------------------------
        // RESCHEDULE - SECURE
        // --------------------------------------------------------

        case "reschedule":

            return rescheduleAppointment(

                data.appointmentId,

                data.patientPhone,

                data.newDate,

                data.newTime
            );


        case "doctorToday":

            return getDoctorTodaySchedule(
                data.doctorId
            );

        case "doctorWeek":

            return getDoctorWeeklySchedule(
                data.doctorId
            );

        case "doctorNext":

            return getDoctorNextAppointment(
                data.doctorId
            );

        case "doctorPatients":

            return {
                success: true,
                patients:
                    getDoctorPatientsSeen(
                        data.doctorId
                    )
            };

        case "doctorAvailability":

            return {
                success: true,
                availability:
                    getDoctorWeeklyAvailability(
                        data.doctorId
                    )
            };

        case "doctorLeaves":

            return {
                success: true,
                leaves:
                    getDoctorUpcomingLeaves(
                        data.doctorId
                    )
            };

        // --------------------------------------------------------
        // UNKNOWN ACTION
        // --------------------------------------------------------

        default:

            return {

                success: false,

                message:
                    "Unknown action."
            };
    }
}


function getDoctorTodaySchedule(doctorId) {

    const ss = SpreadsheetApp.getActiveSpreadsheet();

    const appointmentSheet =
        ss.getSheetByName("Appointments");

    const doctorSheet =
        ss.getSheetByName("Doctors");

    const data =
        appointmentSheet.getDataRange().getValues();

    const doctorData =
        doctorSheet.getDataRange().getValues();

    // ----------------------------------------------------------
    // Find doctor
    // ----------------------------------------------------------

    let doctorName = "";
    let clinicName = "";

    for (let i = 1; i < doctorData.length; i++) {

        if (
            String(doctorData[i][0]).trim() ===
            String(doctorId).trim()
        ) {

            doctorName = doctorData[i][1];
            clinicName = doctorData[i][2];

            break;
        }
    }

    if (!doctorName) {

        return {
            success: false,
            message: "Doctor not found."
        };
    }

    // ----------------------------------------------------------
    // Today's date
    // ----------------------------------------------------------

    const today =
        Utilities.formatDate(
            new Date(),
            TIMEZONE,
            "dd-MMM-yyyy"
        );

    const appointments = [];

    // ----------------------------------------------------------
    // Find today's appointments
    // ----------------------------------------------------------

    for (let i = 1; i < data.length; i++) {

        const rowDate =
            String(data[i][1]).trim();

        const rowDoctorId =
            String(data[i][3]).trim();

        const status =
            String(data[i][6]).trim();

        // Only this doctor
        if (rowDoctorId !== String(doctorId).trim()) {
            continue;
        }

        // Only today
        if (rowDate !== today) {
            continue;
        }

        // Don't show inactive appointments
        if (
            isHiddenAppointmentStatus(status)
        ) {
            continue;
        }

        appointments.push({

            appointmentId:
                data[i][0],

            time:
                data[i][2],

            patientName:
                data[i][4],

            phone:
                data[i][5],

            status:
                status
        });
    }

    // ----------------------------------------------------------
    // Sort by time
    // ----------------------------------------------------------

    appointments.sort(function (a, b) {

        return String(a.time)
            .localeCompare(String(b.time));

    });

    // ----------------------------------------------------------
    // Return
    // ----------------------------------------------------------

    return {

        success: true,

        doctorId:
            doctorId,

        doctorName:
            doctorName,

        clinicName:
            clinicName,

        date:
            today,

        totalAppointments:
            appointments.length,

        appointments:
            appointments
    };
}


function getDoctorScheduleForDate(
    doctorId,
    dateString
) {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const appointmentSheet =
        ss.getSheetByName("Appointments");

    const doctorSheet =
        ss.getSheetByName("Doctors");

    const range =
        appointmentSheet.getDataRange();

    const data =
        range.getValues();

    const displayData =
        range.getDisplayValues();

    const doctorData =
        doctorSheet
            .getDataRange()
            .getValues();


    // =========================================================
    // FIND DOCTOR
    // =========================================================

    let doctorName = "";
    let clinicName = "";

    for (
        let i = 1;
        i < doctorData.length;
        i++
    ) {

        if (
            String(doctorData[i][0]).trim() ===
            String(doctorId).trim()
        ) {

            doctorName =
                doctorData[i][1];

            clinicName =
                doctorData[i][2];

            break;
        }
    }


    if (!doctorName) {

        return {
            success: false,
            message: "Doctor not found."
        };
    }


    // =========================================================
    // NORMALIZE TARGET DATE
    // =========================================================

    const targetDate =
        Utilities.formatDate(
            new Date(
                `${dateString}T00:00:00+05:30`
            ),
            TIMEZONE,
            "dd-MMM-yyyy"
        );


    const appointments = [];


    // =========================================================
    // FIND APPOINTMENTS
    // =========================================================

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        const rowDoctorId =
            String(data[i][3]).trim();

        const rowStatus =
            String(data[i][6]).trim();


        // Doctor filter

        if (
            rowDoctorId !==
            String(doctorId).trim()
        ) {

            continue;
        }


        // Ignore inactive statuses

        if (
            isHiddenAppointmentStatus(
                rowStatus
            )
        ) {

            continue;
        }


        // =======================================================
        // NORMALIZE DATE
        // =======================================================

        let rowDate = "";

        if (
            data[i][1] instanceof Date
        ) {

            rowDate =
                Utilities.formatDate(
                    data[i][1],
                    TIMEZONE,
                    "dd-MMM-yyyy"
                );

        } else {

            rowDate =
                String(data[i][1]).trim();
        }


        // Date comparison

        if (
            rowDate !==
            targetDate
        ) {

            continue;
        }


        // =======================================================
        // FORMAT TIME
        // =======================================================

        let appointmentTime = "";

        if (
            data[i][2] instanceof Date
        ) {

            appointmentTime =
                Utilities.formatDate(
                    data[i][2],
                    TIMEZONE,
                    "hh:mm a"
                );

        } else {

            appointmentTime =
                String(data[i][2]).trim();
        }


        // =======================================================
        // ADD APPOINTMENT
        // =======================================================

        appointments.push({

            appointmentId:
                String(data[i][0]).trim(),

            time:
                appointmentTime,

            patientName:
                String(data[i][4]).trim(),

            phone:
                String(data[i][5]).trim(),

            status:
                rowStatus

        });
    }


    // =========================================================
    // SORT BY TIME
    // =========================================================

    appointments.sort(
        function (a, b) {

            return String(a.time)
                .localeCompare(
                    String(b.time)
                );

        }
    );


    // =========================================================
    // RETURN RESULT
    // =========================================================

    return {

        success: true,

        doctorId:
            doctorId,

        doctorName:
            doctorName,

        clinicName:
            clinicName,

        date:
            targetDate,

        totalAppointments:
            appointments.length,

        appointments:
            appointments

    };
}


function getDoctorWeeklySchedule(
    doctorId,
    weekStartString
) {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const appointmentSheet =
        ss.getSheetByName("Appointments");

    const doctorSheet =
        ss.getSheetByName("Doctors");

    const range =
        appointmentSheet.getDataRange();

    const data =
        range.getValues();

    const displayData =
        range.getDisplayValues();

    const doctorData =
        doctorSheet
            .getDataRange()
            .getValues();


    // =========================================================
    // FIND DOCTOR
    // =========================================================

    let doctorName = "";
    let clinicName = "";

    for (
        let i = 1;
        i < doctorData.length;
        i++
    ) {

        if (
            String(doctorData[i][0]).trim() ===
            String(doctorId).trim()
        ) {

            doctorName =
                doctorData[i][1];

            clinicName =
                doctorData[i][2];

            break;
        }
    }


    if (!doctorName) {

        return {
            success: false,
            message: "Doctor not found."
        };
    }


    // =========================================================
    // CURRENT WEEK
    // Monday → Sunday
    // =========================================================

    let monday;

    if (weekStartString) {

        // Explicit Monday supplied
        monday =
            new Date(
                `${weekStartString}T00:00:00+05:30`
            );

    } else {

        // Current week's Monday
        const today = new Date();

        const dayOfWeek =
            Number(
                Utilities.formatDate(
                    today,
                    TIMEZONE,
                    "u"
                )
            );

        monday =
            new Date(today);

        monday.setDate(
            today.getDate() -
            (dayOfWeek - 1)
        );

        monday.setHours(
            0, 0, 0, 0
        );
    }

    monday.setHours(
        0, 0, 0, 0
    );


    const sunday =
        new Date(monday);

    sunday.setDate(
        monday.getDate() + 6
    );

    sunday.setHours(
        23, 59, 59, 999
    );


    // =========================================================
    // CREATE WEEK STRUCTURE
    // =========================================================

    const week = {};

    for (
        let i = 0;
        i < 7;
        i++
    ) {

        const currentDate =
            new Date(monday);

        currentDate.setDate(
            monday.getDate() + i
        );

        const dateKey =
            Utilities.formatDate(
                currentDate,
                TIMEZONE,
                "dd-MMM-yyyy"
            );

        const dayName =
            Utilities.formatDate(
                currentDate,
                TIMEZONE,
                "EEEE"
            );

        week[dateKey] = {

            day:
                dayName,

            date:
                dateKey,

            appointments: []

        };
    }


    // =========================================================
    // FIND APPOINTMENTS
    // =========================================================

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        const rowDoctorId =
            String(data[i][3]).trim();

        const status =
            String(data[i][6]).trim();


        // Doctor filter

        if (
            rowDoctorId !==
            String(doctorId).trim()
        ) {

            continue;
        }


        // Ignore inactive statuses

        if (
            isHiddenAppointmentStatus(status)
        ) {

            continue;
        }


        // -------------------------------------------------------
        // Normalize date
        // -------------------------------------------------------

        let rowDate = "";

        if (
            data[i][1] instanceof Date
        ) {

            rowDate =
                Utilities.formatDate(
                    data[i][1],
                    TIMEZONE,
                    "dd-MMM-yyyy"
                );

        } else {

            rowDate =
                String(data[i][1]).trim();
        }


        // -------------------------------------------------------
        // Only current week
        // -------------------------------------------------------

        if (
            !week[rowDate]
        ) {

            continue;
        }


        // -------------------------------------------------------
        // Format appointment time
        // -------------------------------------------------------

        let appointmentTime = "";

        if (data[i][2] instanceof Date) {

            appointmentTime =
                Utilities.formatDate(
                    data[i][2],
                    TIMEZONE,
                    "hh:mm a"
                );

        } else {

            appointmentTime =
                String(data[i][2]).trim();

        }


        // -------------------------------------------------------
        // Add appointment
        // -------------------------------------------------------

        week[rowDate]
            .appointments
            .push({

                appointmentId:
                    String(data[i][0]).trim(),

                time:
                    appointmentTime,

                patientName:
                    String(data[i][4]).trim(),

                phone:
                    String(data[i][5]).trim(),

                status:
                    status

            });

    }
    // =========================================================
    // SORT EACH DAY
    // =========================================================

    Object.keys(week).forEach(
        function (dateKey) {

            week[dateKey]
                .appointments
                .sort(
                    function (a, b) {

                        return String(a.time)
                            .localeCompare(
                                String(b.time)
                            );

                    }
                );

        }
    );


    // =========================================================
    // TOTAL APPOINTMENTS
    // =========================================================

    let totalAppointments = 0;

    Object.keys(week).forEach(
        function (dateKey) {

            totalAppointments +=
                week[dateKey]
                    .appointments
                    .length;

        }
    );


    // =========================================================
    // RETURN
    // =========================================================

    return {

        success: true,

        doctorId:
            doctorId,

        doctorName:
            doctorName,

        clinicName:
            clinicName,

        weekStart:
            Utilities.formatDate(
                monday,
                TIMEZONE,
                "dd-MMM-yyyy"
            ),

        weekEnd:
            Utilities.formatDate(
                sunday,
                TIMEZONE,
                "dd-MMM-yyyy"
            ),

        totalAppointments:
            totalAppointments,

        week:
            week

    };
}


function getDoctorNextAppointment(doctorId) {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const appointmentSheet =
        ss.getSheetByName("Appointments");

    const doctorSheet =
        ss.getSheetByName("Doctors");

    const range =
        appointmentSheet.getDataRange();

    const data =
        range.getValues();

    const displayData =
        range.getDisplayValues();

    const doctorData =
        doctorSheet
            .getDataRange()
            .getValues();


    // =========================================================
    // FIND DOCTOR
    // =========================================================

    let doctorName = "";
    let clinicName = "";

    for (
        let i = 1;
        i < doctorData.length;
        i++
    ) {

        if (
            String(doctorData[i][0]).trim() ===
            String(doctorId).trim()
        ) {

            doctorName =
                doctorData[i][1];

            clinicName =
                doctorData[i][2];

            break;
        }
    }


    if (!doctorName) {

        return {
            success: false,
            message: "Doctor not found."
        };
    }


    // =========================================================
    // CURRENT TIME
    // =========================================================

    const now =
        new Date();

    let nextAppointment = null;
    let nextDateTime = null;


    // =========================================================
    // CHECK APPOINTMENTS
    // =========================================================

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        const rowDoctorId =
            String(data[i][3]).trim();

        const status =
            String(data[i][6]).trim();


        // Doctor filter

        if (
            rowDoctorId !==
            String(doctorId).trim()
        ) {

            continue;
        }


        // Ignore inactive statuses

        if (
            isHiddenAppointmentStatus(status)
        ) {

            continue;
        }


        // =======================================================
        // DATE
        // =======================================================

        let appointmentDate;

        if (
            data[i][1] instanceof Date
        ) {

            appointmentDate =
                new Date(data[i][1]);

        } else {

            const dateText =
                String(data[i][1]).trim();

            appointmentDate =
                new Date(
                    `${dateText} 00:00:00`
                );
        }


        // =======================================================
        // TIME
        // =======================================================

        let appointmentDateTime =
            new Date(appointmentDate);


        if (
            data[i][2] instanceof Date
        ) {

            appointmentDateTime.setHours(
                data[i][2].getHours(),
                data[i][2].getMinutes(),
                data[i][2].getSeconds(),
                0
            );

        } else {

            const timeText =
                String(data[i][2]).trim();

            const parts =
                timeText.split(":");

            appointmentDateTime.setHours(
                Number(parts[0]),
                Number(parts[1]),
                0,
                0
            );
        }


        // =======================================================
        // ONLY FUTURE APPOINTMENTS
        // =======================================================

        if (
            appointmentDateTime <= now
        ) {

            continue;
        }


        // =======================================================
        // FIND EARLIEST
        // =======================================================

        if (
            nextDateTime === null ||
            appointmentDateTime < nextDateTime
        ) {

            nextDateTime =
                appointmentDateTime;

            nextAppointment = {

                appointmentId:
                    String(data[i][0]).trim(),

                date:
                    Utilities.formatDate(
                        appointmentDateTime,
                        TIMEZONE,
                        "dd-MMM-yyyy"
                    ),

                time:
                    Utilities.formatDate(
                        appointmentDateTime,
                        TIMEZONE,
                        "hh:mm a"
                    ),

                patientName:
                    String(data[i][4]).trim(),

                phone:
                    String(data[i][5]).trim(),

                status:
                    status

            };
        }
    }


    // =========================================================
    // NO UPCOMING APPOINTMENT
    // =========================================================

    if (!nextAppointment) {

        return {

            success: true,

            doctorId:
                doctorId,

            doctorName:
                doctorName,

            clinicName:
                clinicName,

            message:
                "No upcoming appointments.",

            appointment:
                null

        };
    }


    // =========================================================
    // RETURN
    // =========================================================

    return {

        success: true,

        doctorId:
            doctorId,

        doctorName:
            doctorName,

        clinicName:
            clinicName,

        appointment:
            nextAppointment

    };
}


function webhookOkResponse() {

    return ContentService
        .createTextOutput("EVENT_RECEIVED")
        .setMimeType(
            ContentService.MimeType.TEXT
        );
}

function verifyWhatsAppWebhookRequest(e, rawBody) {

    const expectedToken =
        getScriptProperty(
            "WHATSAPP_WEBHOOK_POST_TOKEN",
            ""
        );

    if (!expectedToken) {
        return true;
    }

    const token =
        e &&
        e.parameter &&
        e.parameter.token
            ? String(e.parameter.token)
            : "";

    return token === expectedToken;
}


function doGet(e) {

    const params = e.parameter;

    const mode =
        params["hub.mode"];

    const token =
        params["hub.verify_token"];

    const challenge =
        params["hub.challenge"];

    const verifyToken =
        getScriptProperty(
            "WHATSAPP_VERIFY_TOKEN",
            "ABC_CLINIC_VERIFY_2026"
        );

    if (
        mode === "subscribe" &&
        token === verifyToken
    ) {

        return ContentService
            .createTextOutput(challenge)
            .setMimeType(
                ContentService.MimeType.TEXT
            );
    }

    return ContentService
        .createTextOutput("Verification failed")
        .setMimeType(
            ContentService.MimeType.TEXT
        );
}


// ============================================================
// WHATSAPP HELPERS - APPOINTMENT LISTS & SLOT FORMATTING
// ============================================================
//
// These support the "My Appointments", "Cancel Appointment",
// and "Reschedule Appointment" WhatsApp conversation flows.
//
// ============================================================

function parseAppointmentDateTime(
    dateString,
    timeString
) {

    const MONTHS = {
        Jan: 0, Feb: 1, Mar: 2, Apr: 3,
        May: 4, Jun: 5, Jul: 6, Aug: 7,
        Sep: 8, Oct: 9, Nov: 10, Dec: 11
    };

    const dateParts =
        String(dateString || "")
            .trim()
            .split("-");

    if (dateParts.length !== 3) {
        return null;
    }

    const day = Number(dateParts[0]);
    const month = MONTHS[dateParts[1]];
    const year = Number(dateParts[2]);

    if (
        isNaN(day) ||
        month === undefined ||
        isNaN(year)
    ) {
        return null;
    }

    const time24 =
        convert12HourTo24Hour(timeString);

    if (!time24) {
        return null;
    }

    const timeParts =
        time24.split(":");

    return new Date(
        year,
        month,
        day,
        Number(timeParts[0]),
        Number(timeParts[1]),
        0,
        0
    );
}


function getConfirmedAppointmentsForPhone(phone) {

    const appointments =
        getMyAppointments(phone);

    const confirmed =
        appointments.filter(
            function (appt) {
                return isConfirmedAppointmentStatus(
                    appt.status
                );
            }
        );

    confirmed.sort(
        function (a, b) {

            const dateA =
                parseAppointmentDateTime(
                    a.date,
                    a.time
                );

            const dateB =
                parseAppointmentDateTime(
                    b.date,
                    b.time
                );

            const timeA =
                dateA ? dateA.getTime() : 0;

            const timeB =
                dateB ? dateB.getTime() : 0;

            return timeA - timeB;
        }
    );

    return confirmed;
}


function formatAppointmentsListForWhatsApp(appointments) {

    let text = "";

    for (
        let i = 0;
        i < appointments.length;
        i++
    ) {

        const appt =
            appointments[i];

        const doctorName =
            findDoctorById(appt.doctorId) ||
            "Unknown Doctor";

        text +=
            (i + 1) + "️⃣ " +
            "👨‍⚕️ " + doctorName + "\n" +
            "   📅 " + appt.date +
            "   🕐 " + appt.time + "\n" +
            "   🆔 " + appt.appointmentId +
            "\n\n";
    }

    return text;
}


function formatAvailableSlotsForWhatsApp(slots) {

    let text = "";

    for (
        let i = 0;
        i < slots.length;
        i++
    ) {

        text +=
            (i + 1) + "️⃣ " +
            slots[i] + "\n";
    }

    return text;
}


function buildAppointmentPickerPrompt(
    title,
    selectLine,
    appointments
) {

    return (
        title +
        "\n\n" +
        selectLine +
        "\n\n" +
        formatAppointmentsListForWhatsApp(
            appointments
        ) +
        "0️⃣ Back to Main Menu"
    );
}


function buildInvalidSlotSelectionReply(slots) {

    return (
        "❌ Invalid time selection.\n\n" +
        "Please choose one of the available slots:\n\n" +
        formatAvailableSlotsForWhatsApp(slots)
    );
}


function buildCancelConfirmMessage(chosen) {

    const doctorName =
        findDoctorById(
            chosen.doctorId
        ) || "Unknown Doctor";

    return (
        "❌ Cancel this appointment?\n\n" +
        "👨‍⚕️ Doctor: " + doctorName + "\n" +
        "📅 Date: " + chosen.date + "\n" +
        "🕐 Time: " + chosen.time + "\n" +
        "🆔 " + chosen.appointmentId +
        "\n\n" +
        "1️⃣ Yes, cancel it\n" +
        "2️⃣ No, go back"
    );
}


function buildRescheduleSlotConfirmMessage(
    session,
    newDate,
    selectedTime
) {

    return (
        "🕐 New time selected: " +
        selectedTime +
        "\n\n" +
        "👨‍⚕️ Doctor: " +
        (
            findDoctorById(
                session.doctorId
            ) || "Unknown Doctor"
        ) +
        "\n" +
        "📅 New Date: " +
        newDate +
        "\n" +
        "🕐 New Time: " +
        selectedTime +
        "\n\n" +
        "Confirm reschedule?\n\n" +
        "1️⃣ Confirm\n" +
        "2️⃣ Choose another time\n" +
        "3️⃣ Cancel"
    );
}


function beginWhatsAppCancelFlow(
    ss,
    phone
) {

    const appointments =
        getConfirmedAppointmentsForPhone(phone);

    if (
        !appointments ||
        appointments.length === 0
    ) {

        saveWhatsAppSession(phone, {
            role: "PATIENT",
            state: "MAIN_MENU"
        });

        sendWhatsAppReply(
            ss,
            phone,
            buildMainMenuMessage(
                "❌ You have no active appointments to cancel."
            )
        );

        return false;
    }

    saveWhatsAppSession(phone, {
        role: "PATIENT",
        state: "CANCEL_SELECT"
    });

    sendWhatsAppReply(
        ss,
        phone,
        buildAppointmentPickerPrompt(
            "❌ Cancel Appointment",
            "Select the appointment to cancel:",
            appointments
        )
    );

    return true;
}


function beginWhatsAppRescheduleFlow(
    ss,
    phone
) {

    const appointments =
        getConfirmedAppointmentsForPhone(phone);

    if (
        !appointments ||
        appointments.length === 0
    ) {

        saveWhatsAppSession(phone, {
            role: "PATIENT",
            state: "MAIN_MENU"
        });

        sendWhatsAppReply(
            ss,
            phone,
            buildMainMenuMessage(
                "❌ You have no active appointments to reschedule."
            )
        );

        return false;
    }

    saveWhatsAppSession(phone, {
        role: "PATIENT",
        state: "RESCHEDULE_SELECT"
    });

    sendWhatsAppReply(
        ss,
        phone,
        buildAppointmentPickerPrompt(
            "🔄 Reschedule Appointment",
            "Select the appointment to reschedule:",
            appointments
        )
    );

    return true;
}


function getDoctorConfirmedAppointments(doctorId) {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Appointments");

    if (!sheet) {
        return [];
    }

    const data =
        sheet.getDataRange().getValues();

    const appointments = [];
    const targetDoctor =
        String(doctorId || "").trim();

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        if (
            String(data[i][3] || "").trim() !==
            targetDoctor
        ) {
            continue;
        }

        const status =
            String(data[i][6] || "").trim();

        if (
            !isConfirmedAppointmentStatus(
                status
            )
        ) {
            continue;
        }

        let appointmentTime = "";

        if (data[i][2] instanceof Date) {

            appointmentTime =
                Utilities.formatDate(
                    data[i][2],
                    TIMEZONE,
                    "hh:mm a"
                );

        } else {

            appointmentTime =
                String(data[i][2] || "").trim();
        }

        appointments.push({

            appointmentId:
                String(data[i][0] || "").trim(),

            date:
                data[i][1] instanceof Date
                    ? Utilities.formatDate(
                        data[i][1],
                        TIMEZONE,
                        "dd-MMM-yyyy"
                    )
                    : String(data[i][1] || "").trim(),

            time: appointmentTime,

            doctorId: targetDoctor,

            patientName:
                String(data[i][4] || "").trim(),

            phone:
                String(data[i][5] || "").trim(),

            status: status
        });
    }

    appointments.sort(
        function (a, b) {

            const dateA =
                parseAppointmentDateTime(
                    a.date,
                    a.time
                );

            const dateB =
                parseAppointmentDateTime(
                    b.date,
                    b.time
                );

            const timeA =
                dateA ? dateA.getTime() : 0;

            const timeB =
                dateB ? dateB.getTime() : 0;

            return timeA - timeB;
        }
    );

    return appointments;
}


function formatDoctorPatientAppointmentsListForWhatsApp(
    appointments
) {

    let text = "";

    for (
        let i = 0;
        i < appointments.length;
        i++
    ) {

        const appt =
            appointments[i];

        text +=
            (i + 1) + "️⃣ " +
            "👤 " + appt.patientName + "\n" +
            "   📅 " + appt.date +
            "   🕐 " + appt.time + "\n" +
            "   🆔 " + appt.appointmentId +
            "\n\n";
    }

    return text;
}


function buildDoctorPatientAppointmentPickerPrompt(
    title,
    selectLine,
    appointments
) {

    return (
        title +
        "\n\n" +
        selectLine +
        "\n\n" +
        formatDoctorPatientAppointmentsListForWhatsApp(
            appointments
        ) +
        "0️⃣ Doctor Portal"
    );
}


function buildDoctorCancelConfirmMessage(chosen) {

    return (
        "❌ Cancel this patient appointment?\n\n" +
        "👤 Patient: " +
        chosen.patientName +
        "\n" +
        "📅 Date: " +
        chosen.date +
        "\n" +
        "🕐 Time: " +
        chosen.time +
        "\n" +
        "🆔 " +
        chosen.appointmentId +
        "\n\n" +
        "1️⃣ Yes, cancel it\n" +
        "2️⃣ No, go back"
    );
}


function buildDoctorRescheduleSlotConfirmMessage(
    session,
    newDate,
    selectedTime
) {

    const patientLine =
        session &&
        session.patientName
            ? "👤 Patient: " +
            session.patientName +
            "\n"
            : "";

    return (
        "🕐 New time selected: " +
        selectedTime +
        "\n\n" +
        patientLine +
        "📅 New Date: " +
        newDate +
        "\n" +
        "🕐 New Time: " +
        selectedTime +
        "\n\n" +
        "Confirm reschedule?\n\n" +
        "1️⃣ Confirm\n" +
        "2️⃣ Choose another time\n" +
        "3️⃣ Cancel"
    );
}


function notifyPatientOfDoctorCancellation(
    appointment
) {

    try {

        const recipient =
            formatWhatsAppRecipientPhone(
                appointment.phone
            );

        if (!recipient) {
            return;
        }

        sendWhatsAppText(
            recipient,
            "ABC Clinic: Your appointment on " +
            appointment.date +
            " at " +
            appointment.time +
            " has been cancelled by the clinic.\n\n" +
            "Reply Hi to book again."
        );

    } catch (error) {

        Logger.log(
            "Patient cancel notify failed: " +
            error.message
        );
    }
}


function notifyPatientOfDoctorReschedule(
    appointment,
    result
) {

    try {

        const recipient =
            formatWhatsAppRecipientPhone(
                appointment.phone
            );

        if (!recipient) {
            return;
        }

        sendWhatsAppText(
            recipient,
            "ABC Clinic: Your appointment has been rescheduled by the clinic.\n\n" +
            "📅 New Date: " +
            result.date +
            "\n" +
            "🕐 New Time: " +
            result.time +
            "\n" +
            "🆔 Appointment ID: " +
            result.appointmentId +
            "\n\n" +
            "Reply Hi if you need to make changes."
        );

    } catch (error) {

        Logger.log(
            "Patient reschedule notify failed: " +
            error.message
        );
    }
}


function handleDoctorWhatsAppAppointmentListSelection(
    ss,
    phone,
    session,
    normalizedMessage,
    options
) {

    const opts = options || {};
    const doctorId =
        session &&
        session.doctorId
            ? session.doctorId
            : "";

    if (normalizedMessage === "0") {

        returnDoctorToMenu(
            ss,
            phone,
            doctorId
        );

        return;
    }

    const appointments =
        typeof opts.getAppointments === "function"
            ? opts.getAppointments()
            : getDoctorConfirmedAppointments(
                doctorId
            );

    const selection =
        parseInt(
            normalizedMessage,
            10
        );

    if (
        isNaN(selection) ||
        selection < 1 ||
        selection > appointments.length
    ) {

        sendWhatsAppReply(
            ss,
            phone,
            "❌ Invalid selection.\n\n" +
            opts.selectLine +
            "\n\n" +
            formatDoctorPatientAppointmentsListForWhatsApp(
                appointments
            ) +
            "0️⃣ Doctor Portal"
        );

        return;
    }

    opts.onChosen(
        appointments[selection - 1]
    );
}


function beginDoctorCancelFlow(
    ss,
    phone,
    doctorId
) {

    const appointments =
        getDoctorConfirmedAppointments(
            doctorId
        );

    if (appointments.length === 0) {

        returnDoctorToMenu(
            ss,
            phone,
            doctorId,
            "❌ You have no confirmed patient appointments to cancel."
        );

        return false;
    }

    saveWhatsAppSession(phone, {
        role: "DOCTOR",
        state: "DOCTOR_CANCEL_SELECT",
        doctorId: doctorId,
        date: "",
        time: "",
        appointmentId: ""
    });

    sendWhatsAppReply(
        ss,
        phone,
        buildDoctorPatientAppointmentPickerPrompt(
            "❌ Cancel Patient Appointment",
            "Select the appointment to cancel:",
            appointments
        )
    );

    return true;
}


function beginDoctorRescheduleFlow(
    ss,
    phone,
    doctorId
) {

    const appointments =
        getDoctorConfirmedAppointments(
            doctorId
        );

    if (appointments.length === 0) {

        returnDoctorToMenu(
            ss,
            phone,
            doctorId,
            "❌ You have no confirmed patient appointments to reschedule."
        );

        return false;
    }

    saveWhatsAppSession(phone, {
        role: "DOCTOR",
        state: "DOCTOR_RESCHEDULE_SELECT",
        doctorId: doctorId,
        date: "",
        time: "",
        appointmentId: ""
    });

    sendWhatsAppReply(
        ss,
        phone,
        buildDoctorPatientAppointmentPickerPrompt(
            "🔄 Reschedule Patient Appointment",
            "Select the appointment to reschedule:",
            appointments
        )
    );

    return true;
}


function buildDoctorStatusActionMessage(chosen) {

    return (
        "✅ Mark visit status\n\n" +
        "👤 Patient: " +
        chosen.patientName +
        "\n" +
        "📅 Date: " +
        chosen.date +
        "\n" +
        "🕐 Time: " +
        chosen.time +
        "\n" +
        "🆔 " +
        chosen.appointmentId +
        "\n\n" +
        "1️⃣ Completed\n" +
        "2️⃣ No-Show\n" +
        "0️⃣ Doctor Portal"
    );
}


function getDoctorStatusActionSpec() {

    const fallbackText =
        "1️⃣ Completed\n" +
        "2️⃣ No-Show";

    const interactive =
        buildInteractiveButtonSpec([
            {
                id: "1",
                title: "Completed"
            },
            {
                id: "2",
                title: "No-Show"
            }
        ]);

    return {
        fallbackText: fallbackText,
        interactive: interactive
    };
}


function beginDoctorStatusFlow(
    ss,
    phone,
    doctorId
) {

    const appointments =
        getDoctorStatusEligibleAppointments(
            doctorId
        );

    if (appointments.length === 0) {

        returnDoctorToMenu(
            ss,
            phone,
            doctorId,
            "❌ No confirmed appointments are ready to mark yet.\n\n" +
            "You can mark Completed or No-Show after the appointment time has started."
        );

        return false;
    }

    saveWhatsAppSession(phone, {
        role: "DOCTOR",
        state: "DOCTOR_STATUS_SELECT",
        doctorId: doctorId,
        date: "",
        time: "",
        appointmentId: ""
    });

    sendWhatsAppReply(
        ss,
        phone,
        buildDoctorPatientAppointmentPickerPrompt(
            "✅ Mark Visit Status",
            "Select the appointment to update:",
            appointments
        )
    );

    return true;
}


function beginDoctorRescheduleDateSelection(
    ss,
    phone,
    doctorId,
    chosen
) {

    saveWhatsAppSession(phone, {
        role: "DOCTOR",
        state: "DOCTOR_RESCHEDULE_DATE",
        doctorId: doctorId,
        appointmentId:
            chosen.appointmentId,
        patientName:
            chosen.patientName,
        date: "",
        time: ""
    });

    sendDateMenuReply(
        ss,
        phone,
        "🔄 Rescheduling " +
        chosen.patientName +
        "'s appointment (currently " +
        chosen.date +
        " " +
        chosen.time +
        ").\n\nPlease choose a new date:"
    );
}


function handleDoctorWhatsAppRescheduleTimeState(
    ss,
    senderPhone,
    session,
    normalizedMessage
) {

    handleWhatsAppSlotSelection(
        ss,
        senderPhone,
        session,
        normalizedMessage,
        {
            expiredMessage:
                "❌ Doctor session expired.\n\n" +
                "Please send Hi to open the Doctor Portal again.",
            invalidDateMessage:
                "❌ The selected date is invalid.\n\n" +
                "Please send Hi to open the Doctor Portal again.",
            onValidSlot: function (
                selectedTime,
                isoDate
            ) {
                saveWhatsAppSession(
                    senderPhone,
                    {
                        role: "DOCTOR",
                        state: "DOCTOR_RESCHEDULE_CONFIRM",
                        time: selectedTime
                    }
                );

                sendWhatsAppMenuReply(
                    ss,
                    senderPhone,
                    buildDoctorRescheduleSlotConfirmMessage(
                        session,
                        isoDate,
                        selectedTime
                    ),
                    getRescheduleConfirmSpec()
                );
            }
        }
    );
}


function beginRescheduleDateSelection(
    ss,
    phone,
    chosen
) {

    saveWhatsAppSession(phone, {
        state: "RESCHEDULE_DATE",
        appointmentId:
            chosen.appointmentId,
        doctorId:
            chosen.doctorId,
        date: "",
        time: ""
    });

    const doctorName =
        findDoctorById(
            chosen.doctorId
        ) || "Unknown Doctor";

    sendDateMenuReply(
        ss,
        phone,
        "🔄 Rescheduling appointment with " +
        doctorName +
        " (currently " +
        chosen.date +
        " " +
        chosen.time +
        ").\n\nPlease choose a new date:"
    );
}


function handleWhatsAppSlotSelection(
    ss,
    phone,
    session,
    normalizedMessage,
    options
) {

    const opts = options || {};

    if (
        !session.doctorId ||
        !session.date
    ) {

        sendWhatsAppReply(
            ss,
            phone,
            opts.expiredMessage ||
                "❌ Your session has expired.\n\n" +
                "Please send Hi to start again."
        );

        return;
    }

    const isoDate =
        String(session.date).trim();

    if (!isValidISODate(isoDate)) {

        sendWhatsAppReply(
            ss,
            phone,
            opts.invalidDateMessage ||
                "❌ The selected date is invalid.\n\n" +
                "Please send Hi to start again."
        );

        return;
    }

    const slotNumber =
        parseInt(
            normalizedMessage,
            10
        );

    const slots =
        getAvailableSlots(
            session.doctorId,
            isoDate
        );

    if (
        isNaN(slotNumber) ||
        slotNumber < 1 ||
        slotNumber > slots.length
    ) {

        sendWhatsAppReply(
            ss,
            phone,
            buildInvalidSlotSelectionReply(slots)
        );

        return;
    }

    opts.onValidSlot(
        slots[slotNumber - 1],
        isoDate,
        slots
    );
}


function handleWhatsAppAppointmentListSelection(
    ss,
    phone,
    normalizedMessage,
    options
) {

    const opts = options || {};

    if (normalizedMessage === "0") {

        saveWhatsAppSession(phone, {
            role: "PATIENT",
            state: "MAIN_MENU",
            doctorId: "",
            date: "",
            time: "",
            appointmentId: ""
        });

        sendWhatsAppReply(
            ss,
            phone,
            buildMainMenuMessage(
                "👋 Back to main menu."
            )
        );

        return;
    }

    const appointments =
        getConfirmedAppointmentsForPhone(phone);

    const selection =
        parseInt(
            normalizedMessage,
            10
        );

    const selectLine =
        opts.selectLine;

    if (
        isNaN(selection) ||
        selection < 1 ||
        selection > appointments.length
    ) {

        sendWhatsAppReply(
            ss,
            phone,
            "❌ Invalid selection.\n\n" +
            selectLine +
            "\n\n" +
            formatAppointmentsListForWhatsApp(
                appointments
            ) +
            "0️⃣ Back to Main Menu"
        );

        return;
    }

    opts.onChosen(
        appointments[selection - 1]
    );
}


function handleWhatsAppBookTimeState(
    ss,
    senderPhone,
    session,
    normalizedMessage
) {

    handleWhatsAppSlotSelection(
        ss,
        senderPhone,
        session,
        normalizedMessage,
        {
            expiredMessage:
                "❌ Your booking session has expired.\n\n" +
                "Please send Hi to start again.",
            invalidDateMessage:
                "❌ The booking date is invalid.\n\n" +
                "Please send Hi to start again.",
            onValidSlot: function (
                selectedTime
            ) {
                proceedAfterBookingSlotSelected(
                    ss,
                    senderPhone,
                    session,
                    selectedTime
                );
            }
        }
    );
}


function handleWhatsAppRescheduleTimeState(
    ss,
    senderPhone,
    session,
    normalizedMessage
) {

    handleWhatsAppSlotSelection(
        ss,
        senderPhone,
        session,
        normalizedMessage,
        {
            expiredMessage:
                "❌ Your reschedule session has expired.\n\n" +
                "Please send Hi to start again.",
            invalidDateMessage:
                "❌ The selected date is invalid.\n\n" +
                "Please send Hi to start again.",
            onValidSlot: function (
                selectedTime,
                isoDate
            ) {
                saveWhatsAppSession(
                    senderPhone,
                    {
                        state: "RESCHEDULE_CONFIRM",
                        time: selectedTime
                    }
                );

                sendWhatsAppMenuReply(
                    ss,
                    senderPhone,
                    buildRescheduleSlotConfirmMessage(
                        session,
                        isoDate,
                        selectedTime
                    ),
                    getRescheduleConfirmSpec()
                );
            }
        }
    );
}


function handleWhatsAppCancelSelectState(
    ss,
    senderPhone,
    normalizedMessage
) {

    handleWhatsAppAppointmentListSelection(
        ss,
        senderPhone,
        normalizedMessage,
        {
            title:
                "❌ Cancel Appointment",
            selectLine:
                "Select the appointment to cancel:",
            onChosen: function (chosen) {
                saveWhatsAppSession(
                    senderPhone,
                    {
                        state: "CANCEL_CONFIRM",
                        appointmentId:
                            chosen.appointmentId
                    }
                );

                sendWhatsAppMenuReply(
                    ss,
                    senderPhone,
                    buildCancelConfirmMessage(
                        chosen
                    ),
                    getYesNoConfirmSpec()
                );
            }
        }
    );
}


function handleWhatsAppRescheduleSelectState(
    ss,
    senderPhone,
    normalizedMessage
) {

    handleWhatsAppAppointmentListSelection(
        ss,
        senderPhone,
        normalizedMessage,
        {
            title:
                "🔄 Reschedule Appointment",
            selectLine:
                "Select the appointment to reschedule:",
            onChosen: function (chosen) {
                beginRescheduleDateSelection(
                    ss,
                    senderPhone,
                    chosen
                );
            }
        }
    );
}


function buildLanguageSelectionMessage() {

    return (
        "🌐 Please select your language:\n\n" +
        "1️⃣ English\n" +
        "2️⃣ తెలుగు\n" +
        "3️⃣ हिन्दी"
    );
}


function localizeWhatsAppReply(language, message) {

    const selectedLanguage =
        String(language || "EN").toUpperCase();

    if (selectedLanguage === "EN") {
        return String(message);
    }

    const translations = {
        TE: {
            "Welcome to ABC Clinic!": "ABC క్లినిక్‌కు స్వాగతం!",
            "Please choose an option:": "దయచేసి ఒక ఎంపికను ఎంచుకోండి:",
            "Book Appointment": "అపాయింట్‌మెంట్ బుక్ చేయండి",
            "My Appointments": "నా అపాయింట్‌మెంట్‌లు",
            "Cancel Appointment": "అపాయింట్‌మెంట్ రద్దు చేయండి",
            "Reschedule Appointment": "అపాయింట్‌మెంట్ సమయాన్ని మార్చండి",
            "Change Language": "భాషను మార్చండి",
            "Select a doctor:": "డాక్టర్‌ను ఎంచుకోండి:",
            "Reply with the doctor's number.": "డాక్టర్ నంబర్‌తో సమాధానం ఇవ్వండి.",
            "Please choose a date:": "తేదీని ఎంచుకోండి:",
            "Today": "ఈరోజు",
            "Tomorrow": "రేపు",
            "Enter another date": "వేరే తేదీని నమోదు చేయండి",
            "Available slots:": "అందుబాటులో ఉన్న సమయాలు:",
            "Please choose a time.": "సమయాన్ని ఎంచుకోండి.",
            "Confirm appointment?": "అపాయింట్‌మెంట్‌ను నిర్ధారించాలా?",
            "Confirm": "నిర్ధారించండి",
            "Choose another time": "వేరే సమయం ఎంచుకోండి",
            "Cancel": "రద్దు చేయండి",
            "Back to Main Menu": "ప్రధాన మెనూకు తిరిగి వెళ్ళండి",
            "Back to main menu.": "ప్రధాన మెనూకు తిరిగి వచ్చారు.",
            "Main Menu": "ప్రధాన మెను",
            "Back": "వెనక్కి",
            "Invalid option.": "చెల్లని ఎంపిక.",
            "Please reply with:": "దయచేసి ఇలా సమాధానం ఇవ్వండి:",
            "Please enter the date in YYYY-MM-DD format.": "దయచేసి తేదీని YYYY-MM-DD ఫార్మాట్‌లో నమోదు చేయండి.",
            "Please enter the new date in YYYY-MM-DD format.": "దయచేసి కొత్త తేదీని YYYY-MM-DD ఫార్మాట్‌లో నమోదు చేయండి.",
            "Example:": "ఉదాహరణ:",
            "Your Appointments:": "మీ అపాయింట్‌మెంట్‌లు:",
            "Select the appointment to cancel:": "రద్దు చేయాల్సిన అపాయింట్‌మెంట్‌ను ఎంచుకోండి:",
            "Select the appointment to reschedule:": "మార్చాల్సిన అపాయింట్‌మెంట్‌ను ఎంచుకోండి:",
            "Yes, cancel it": "అవును, రద్దు చేయండి",
            "No, go back": "లేదు, వెనక్కి వెళ్ళండి",
            "Doctor selected:": "ఎంచుకున్న డాక్టర్:",
            "Doctor:": "డాక్టర్:",
            "Patient:": "రోగి:",
            "Date:": "తేదీ:",
            "Time:": "సమయం:",
            "New Date:": "కొత్త తేదీ:",
            "New Time:": "కొత్త సమయం:",
            "Appointment ID:": "అపాయింట్‌మెంట్ ఐడి:",
            "Appointment confirmed!": "అపాయింట్‌మెంట్ నిర్ధారించబడింది!",
            "Appointment cancelled successfully.": "అపాయింట్‌మెంట్ విజయవంతంగా రద్దు చేయబడింది.",
            "Appointment booking cancelled.": "అపాయింట్‌మెంట్ బుకింగ్ రద్దు చేయబడింది.",
            "Reschedule cancelled.": "సమయం మార్పు రద్దు చేయబడింది.",
            "Confirm reschedule?": "సమయం మార్పును నిర్ధారించాలా?",
            "Please choose a new date:": "కొత్త తేదీని ఎంచుకోండి:",
            "Please choose a valid doctor number.": "దయచేసి సరైన డాక్టర్ నంబర్‌ను ఎంచుకోండి.",
            "Sorry, there are no available slots on ": "క్షమించండి, ఈ తేదీన అందుబాటులో సమయాలు లేవు: ",
            "Please choose another date.": "దయచేసి వేరే తేదీని ఎంచుకోండి.",
            "No available slots remain for ": "ఈ తేదీకి అందుబాటులో సమయాలు లేవు: ",
            "Your booking session has expired.": "మీ బుకింగ్ సెషన్ గడువు ముగిసింది.",
            "Your reschedule session has expired.": "మీ సమయం మార్పు సెషన్ గడువు ముగిసింది.",
            "Thank you for choosing ABC Clinic.": "ABC క్లినిక్‌ను ఎంచుకున్నందుకు ధన్యవాదాలు.",
            "Please send Hi to start again.": "మళ్లీ ప్రారంభించడానికి Hi పంపండి.",
            "Sorry, I didn't understand that.": "క్షమించండి, నాకు అర్థం కాలేదు.",
            "Language changed successfully.": "భాష విజయవంతంగా మార్చబడింది.",
            "Please enter your full name to complete the booking.": "బుకింగ్ పూర్తి చేయడానికి దయచేసి మీ పూర్తి పేరు నమోదు చేయండి.",
            "Please confirm your appointment:": "దయచేసి మీ అపాయింట్‌మెంట్‌ను నిర్ధారించండి:",
            "Please enter a valid full name (at least 2 characters).": "దయచేసి సరైన పూర్తి పేరు నమోదు చేయండి (కనీసం 2 అక్షరాలు).",
            "Unable to save your name.": "మీ పేరును సేవ్ చేయలేకపోయాం.",
            "Invalid time selection.": "చెల్లని సమయ ఎంపిక.",
            "Please choose one of the available slots:": "దయచేసి అందుబాటులో ఉన్న సమయాలից ఒకదాన్ని ఎంచుకోండి:",
            "Invalid selection.": "చెల్లని ఎంపిక.",
            "Date selected:": "ఎంచుకున్న తేదీ:",
            "Appointment Reminder": "అపాయింట్‌మెంట్ రిమైండర్",
            "Reminder: ": "రిమైండర్: ",
            " before your appointment.": " మీ అపాయింట్‌మెంట్‌కు ముందు.",
            "Reply Hi to reschedule or cancel.": "మార్చడానికి లేదా రద్దు చేయడానికి Hi పంపండి.",
            "ABC Clinic is currently closed.": "ABC క్లినిక్ ప్రస్తుతం మూసివేయబడింది.",
            "Our hours:": "మా సమయాలు:",
            "Please message us during clinic hours to book or manage appointments.": "అపాయింట్‌మెంట్‌లు బుక్ చేయడానికి లేదా నిర్వహించడానికి క్లినిక్ సమయంలో మాకు సందేశం పంపండి.",
            "Reply Hi during open hours to get started.": "ప్రారంభించడానికి తెరిచి ఉన్న సమయంలో Hi పంపండి."
        },
        HI: {
            "Welcome to ABC Clinic!": "एबीसी क्लिनिक में आपका स्वागत है!",
            "Please choose an option:": "कृपया एक विकल्प चुनें:",
            "Book Appointment": "अपॉइंटमेंट बुक करें",
            "My Appointments": "मेरे अपॉइंटमेंट",
            "Cancel Appointment": "अपॉइंटमेंट रद्द करें",
            "Reschedule Appointment": "अपॉइंटमेंट का समय बदलें",
            "Change Language": "भाषा बदलें",
            "Select a doctor:": "डॉक्टर चुनें:",
            "Reply with the doctor's number.": "डॉक्टर के नंबर से उत्तर दें।",
            "Please choose a date:": "तारीख चुनें:",
            "Today": "आज",
            "Tomorrow": "कल",
            "Enter another date": "दूसरी तारीख दर्ज करें",
            "Available slots:": "उपलब्ध समय:",
            "Please choose a time.": "समय चुनें।",
            "Confirm appointment?": "अपॉइंटमेंट की पुष्टि करें?",
            "Confirm": "पुष्टि करें",
            "Choose another time": "दूसरा समय चुनें",
            "Cancel": "रद्द करें",
            "Back to Main Menu": "मुख्य मेनू पर वापस जाएं",
            "Back to main menu.": "मुख्य मेनू पर वापस आ गए हैं।",
            "Main Menu": "मुख्य मेनू",
            "Back": "वापस",
            "Invalid option.": "अमान्य विकल्प।",
            "Please reply with:": "कृपया इस तरह उत्तर दें:",
            "Please enter the date in YYYY-MM-DD format.": "कृपया तारीख YYYY-MM-DD प्रारूप में दर्ज करें।",
            "Please enter the new date in YYYY-MM-DD format.": "कृपया नई तारीख YYYY-MM-DD प्रारूप में दर्ज करें।",
            "Example:": "उदाहरण:",
            "Your Appointments:": "आपके अपॉइंटमेंट:",
            "Select the appointment to cancel:": "रद्द करने के लिए अपॉइंटमेंट चुनें:",
            "Select the appointment to reschedule:": "बदलने के लिए अपॉइंटमेंट चुनें:",
            "Yes, cancel it": "हां, रद्द करें",
            "No, go back": "नहीं, वापस जाएं",
            "Doctor selected:": "चुना गया डॉक्टर:",
            "Doctor:": "डॉक्टर:",
            "Patient:": "मरीज़:",
            "Date:": "तारीख:",
            "Time:": "समय:",
            "New Date:": "नई तारीख:",
            "New Time:": "नया समय:",
            "Appointment ID:": "अपॉइंटमेंट आईडी:",
            "Appointment confirmed!": "अपॉइंटमेंट की पुष्टि हो गई!",
            "Appointment cancelled successfully.": "अपॉइंटमेंट सफलतापूर्वक रद्द कर दिया गया।",
            "Appointment booking cancelled.": "अपॉइंटमेंट बुकिंग रद्द कर दी गई।",
            "Reschedule cancelled.": "समय परिवर्तन रद्द कर दिया गया।",
            "Confirm reschedule?": "समय परिवर्तन की पुष्टि करें?",
            "Please choose a new date:": "नई तारीख चुनें:",
            "Please choose a valid doctor number.": "कृपया सही डॉक्टर नंबर चुनें।",
            "Sorry, there are no available slots on ": "क्षमा करें, इस तारीख पर कोई समय उपलब्ध नहीं है: ",
            "Please choose another date.": "कृपया दूसरी तारीख चुनें।",
            "No available slots remain for ": "इस तारीख के लिए कोई समय उपलब्ध नहीं है: ",
            "Your booking session has expired.": "आपका बुकिंग सत्र समाप्त हो गया है।",
            "Your reschedule session has expired.": "आपका समय परिवर्तन सत्र समाप्त हो गया है।",
            "Thank you for choosing ABC Clinic.": "एबीसी क्लिनिक चुनने के लिए धन्यवाद।",
            "Please send Hi to start again.": "फिर से शुरू करने के लिए Hi भेजें।",
            "Sorry, I didn't understand that.": "क्षमा करें, मैं समझ नहीं पाया।",
            "Language changed successfully.": "भाषा सफलतापूर्वक बदल दी गई है।",
            "Please enter your full name to complete the booking.": "बुकिंग पूरी करने के लिए कृपया अपना पूरा नाम दर्ज करें।",
            "Please confirm your appointment:": "कृपया अपने अपॉइंटमेंट की पुष्टि करें:",
            "Please enter a valid full name (at least 2 characters).": "कृपया एक मान्य पूरा नाम दर्ज करें (कम से कम 2 अक्षर)।",
            "Unable to save your name.": "आपका नाम सहेज नहीं सके।",
            "Invalid time selection.": "अमान्य समय चयन।",
            "Please choose one of the available slots:": "कृपया उपलब्ध समयों में से एक चुनें:",
            "Invalid selection.": "अमान्य चयन।",
            "Date selected:": "चुनी गई तारीख:",
            "Appointment Reminder": "अपॉइंटमेंट रिमाइंडर",
            "Reminder: ": "रिमाइंडर: ",
            " before your appointment.": " आपके अपॉइंटमेंट से पहले।",
            "Reply Hi to reschedule or cancel.": "बदलने या रद्द करने के लिए Hi भेजें।",
            "ABC Clinic is currently closed.": "एबीसी क्लिनिक अभी बंद है।",
            "Our hours:": "हमारे समय:",
            "Please message us during clinic hours to book or manage appointments.": "अपॉइंटमेंट बुक या प्रबंधित करने के लिए कृपया क्लिनिक के समय में संदेश भेजें।",
            "Reply Hi during open hours to get started.": "शुरू करने के लिए खुले समय में Hi भेजें।"
        }
    };

    const dictionary = translations[selectedLanguage] || {};
    let localizedMessage = String(message);

    Object.keys(dictionary)
        .sort(function (a, b) {
            return b.length - a.length;
        })
        .forEach(function (englishText) {
            localizedMessage = localizedMessage
                .split(englishText)
                .join(dictionary[englishText]);
        });

    return localizedMessage;
}


function buildMainMenuMessage(prefix) {

    return (
        prefix +
        "\n\n" +
        "Please choose an option:\n\n" +
        "1️⃣ Book Appointment\n" +
        "2️⃣ My Appointments\n" +
        "3️⃣ Cancel Appointment\n" +
        "4️⃣ Reschedule Appointment\n" +
        "5️⃣ Change Language"
    );
}

function maskPhone(phone) {
    const digits = String(phone || "").replace(/\D/g, "");
    if (!digits) return "";
    if (digits.length <= 4) return digits;
    const visible = digits.slice(-4);
    const hidden = "x".repeat(Math.max(0, digits.length - 4));
    return hidden + visible;
}

function findDoctorByWhatsAppPhone(phone) {
    const sheet = SpreadsheetApp.getActiveSpreadsheet()
        .getSheetByName("Doctors");
    if (!sheet) return null;
    const target = normalizeWhatsAppPhone(phone);
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
        if (
            target &&
            normalizeWhatsAppPhone(data[i][4]) === target
        ) {
            return {
                doctorId: String(data[i][0]).trim(),
                doctorName: String(data[i][1]).trim()
            };
        }
    }
    return null;
}

function buildDoctorMenu(doctorName) {
    return "👨‍⚕️ Doctor Portal" +
        (doctorName ? " — " + doctorName : "") +
        "\n\n1️⃣ Today's Schedule\n" +
        "2️⃣ Next Appointment\n" +
        "3️⃣ This Week's Schedule\n" +
        "4️⃣ Schedule for a Date\n" +
        "5️⃣ Manage Availability\n" +
        "6️⃣ Manage Leaves\n" +
        "7️⃣ My Patients\n" +
        "8️⃣ Cancel Patient Appointment\n" +
        "9️⃣ Reschedule Patient Appointment\n" +
        "🔟 Mark Visit Status (Completed / No-Show)";
}

function formatDoctorAvailabilityMenu(doctorId) {

    const availability =
        getDoctorWeeklyAvailability(
            doctorId
        );

    let text =
        "📅 Manage Availability\n\n";

    DOCTOR_WEEKDAYS.forEach(
        function (day, index) {

            const sessions =
                availability[day];

            let summary =
                "Not set";

            if (sessions.length > 0) {
                summary =
                    sessions.length +
                    " session(s) (" +
                    sessions.map(function (session) {
                        return (
                            session.start +
                            " - " +
                            session.end
                        );
                    }).join(", ") +
                    ")";
            }

            text +=
                (index + 1) +
                ". " +
                day +
                ": " +
                summary +
                "\n";
        }
    );

    text +=
        "\nReply with day number (1-7) to manage that day.";

    return text;
}

function formatDoctorDayAvailabilityMenu(
    doctorId,
    dayName
) {

    const sessions =
        getDoctorDayAvailabilitySessions(
            doctorId,
            dayName
        );

    let text =
        "📅 " +
        dayName +
        " Availability\n\n";

    if (sessions.length === 0) {
        text += "No sessions set.\n\n";
    } else {
        sessions.forEach(
            function (session, index) {
                text +=
                    (index + 1) +
                    ". " +
                    session.start +
                    " - " +
                    session.end +
                    "\n";
            }
        );
        text += "\n";
    }

    text +=
        "1️⃣ Add session\n" +
        "2️⃣ Remove session\n" +
        "3️⃣ Clear entire day";

    return text;
}

function formatDoctorLeavesMenu() {

    return (
        "🏖 Manage Leaves\n\n" +
        "1️⃣ Add single-day leave\n" +
        "2️⃣ View upcoming leaves\n" +
        "3️⃣ Cancel a leave\n" +
        "4️⃣ Add leave range"
    );
}

function formatDoctorUpcomingLeaves(doctorId) {

    const leaves =
        getDoctorUpcomingLeaves(doctorId);

    if (leaves.length === 0) {
        return "No upcoming leaves.";
    }

    let text =
        "Upcoming leaves:\n\n";

    leaves.forEach(
        function (leave, index) {
            text +=
                (index + 1) +
                ". " +
                leave.date +
                (
                    leave.reason
                        ? " — " + leave.reason
                        : ""
                ) +
                "\n";
        }
    );

    return text;
}

function formatDoctorPatientsList(doctorId) {

    const patients =
        getDoctorPatientsSeen(doctorId);

    if (patients.length === 0) {
        return (
            "👥 My Patients\n\n" +
            "No patients found yet."
        );
    }

    let text =
        "👥 My Patients (" +
        patients.length +
        ")\n\n";

    const limit =
        Math.min(patients.length, 20);

    for (let i = 0; i < limit; i++) {

        const patient =
            patients[i];

        text +=
            (i + 1) +
            ". " +
            patient.name +
            " • 📞 " +
            maskPhone(patient.phone) +
            " • " +
            patient.visitCount +
            " visit(s)";

        if (patient.lastVisit) {
            text +=
                " • last " +
                patient.lastVisit;
        }

        text += "\n";
    }

    if (patients.length > 20) {
        text +=
            "\n(Showing first 20 patients)";
    }

    return text;
}

function showDoctorAvailabilityMenu(
    ss,
    phone,
    doctorId
) {

    saveWhatsAppSession(phone, {
        role: "DOCTOR",
        state: "DOCTOR_AVAIL_MENU",
        doctorId: doctorId,
        date: "",
        time: "",
        appointmentId: ""
    });

    sendWhatsAppReply(
        ss,
        phone,
        formatDoctorAvailabilityMenu(
            doctorId
        )
    );
}

function showDoctorDayAvailabilityMenu(
    ss,
    phone,
    doctorId,
    dayName
) {

    saveWhatsAppSession(phone, {
        role: "DOCTOR",
        state: "DOCTOR_AVAIL_DAY_MENU",
        doctorId: doctorId,
        date: dayName,
        time: "",
        appointmentId: ""
    });

    sendWhatsAppReply(
        ss,
        phone,
        formatDoctorDayAvailabilityMenu(
            doctorId,
            dayName
        )
    );
}

function returnToDoctorDayAvailability(
    ss,
    phone,
    doctorId,
    dayName,
    prefix
) {

    saveWhatsAppSession(phone, {
        role: "DOCTOR",
        state: "DOCTOR_AVAIL_DAY_MENU",
        doctorId: doctorId,
        date: dayName,
        time: "",
        appointmentId: ""
    });

    const menu =
        formatDoctorDayAvailabilityMenu(
            doctorId,
            dayName
        );

    sendWhatsAppReply(
        ss,
        phone,
        prefix
            ? String(prefix) + "\n\n" + menu
            : menu
    );
}

function showDoctorLeavesMenu(
    ss,
    phone,
    doctorId
) {

    saveWhatsAppSession(phone, {
        role: "DOCTOR",
        state: "DOCTOR_LEAVE_MENU",
        doctorId: doctorId,
        date: "",
        time: "",
        appointmentId: ""
    });

    sendWhatsAppReply(
        ss,
        phone,
        formatDoctorLeavesMenu()
    );
}

function formatDoctorSchedule(result, title) {
    if (!result || !result.success) {
        return "❌ " + (result && result.message || "Unable to load schedule.");
    }
    let text = "📋 " + title + "\n\n";
    if (!result.appointments || result.appointments.length === 0) {
        return text + "No appointments found.";
    }
    result.appointments.forEach(function (appointment, index) {
        const phoneText = appointment.phone ?
            " • 📞 " + maskPhone(appointment.phone) :
            "";
        text += (index + 1) + ". " + appointment.time + " — " +
            appointment.patientName + phoneText + "\n";
    });
    return text;
}

function formatDoctorWeek(result) {
    if (!result || !result.success) return "❌ Unable to load weekly schedule.";
    let text = "📅 Weekly Schedule\n\n";
    Object.keys(result.week).forEach(function (date) {
        const day = result.week[date];
        text += day.day + ", " + date + ": " +
            (day.appointments.length || "No") + " appointment(s)\n";
    });
    return text;
}

function formatDoctorNext(result) {
    if (!result || !result.success) {
        return "❌ " + (result && result.message || "Unable to load next appointment.");
    }
    if (!result.appointment) {
        return "📌 Next Appointment\n\n" +
            (result.message || "No upcoming appointments.");
    }
    const appointment = result.appointment;
    const phoneText = appointment.phone ?
        " • 📞 " + maskPhone(appointment.phone) :
        "";
    return "📌 Next Appointment\n\n" +
        appointment.date + " " + appointment.time + " — " +
        appointment.patientName + phoneText;
}


function addWhatsAppNavigationOptions(session, message) {

    if (
        !session ||
        !session.state ||
        session.state === "MAIN_MENU" ||
        session.state === "DOCTOR_MENU" ||
        session.state === "LANGUAGE_SELECT" ||
        session.state === "LANGUAGE_CHANGE"
    ) {
        return message;
    }

    const options = [];
    const homeLabel =
        session.role === "DOCTOR"
            ? "0️⃣ Doctor Portal"
            : "0️⃣ Main Menu";

    if (
        String(message).indexOf("0️⃣ Back to Main Menu") === -1 &&
        String(message).indexOf("0️⃣ Doctor Portal") === -1
    ) {
        options.push(homeLabel);
    }

    options.push("9️⃣ Back");

    return String(message) +
        "\n\n" +
        options.join("\n");
}


function buildDateMenuOptionsText() {

    return (
        "1️⃣ Today\n" +
        "2️⃣ Tomorrow\n" +
        "3️⃣ Enter another date"
    );
}

function buildDateMenuPrompt(introText) {

    return (
        String(introText || "Please choose a date:") +
        "\n\n" +
        buildDateMenuOptionsText()
    );
}

function buildInvalidDateMenuReply() {

    return (
        "❌ Invalid option.\n\n" +
        "Please reply with:\n\n" +
        buildDateMenuOptionsText()
    );
}

function buildCustomDateEntryPrompt(isReschedule) {

    const prefix =
        isReschedule
            ? "📅 Please enter the new date"
            : "📅 Please enter the date";

    return (
        prefix +
        " in YYYY-MM-DD format.\n\n" +
        "Example:\n" +
        "2026-08-25"
    );
}

function getISODateFromMenuChoice(normalizedMessage) {

    if (normalizedMessage === "1") {

        return Utilities.formatDate(
            new Date(),
            TIMEZONE,
            "yyyy-MM-dd"
        );
    }

    if (normalizedMessage === "2") {

        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);

        return Utilities.formatDate(
            tomorrow,
            TIMEZONE,
            "yyyy-MM-dd"
        );
    }

    return null;
}

function validateFutureISODate(typedDate) {

    if (!isValidISODate(typedDate)) {

        return {
            valid: false,
            message:
                "❌ That doesn't look like a valid date.\n\n" +
                "Please enter the date in YYYY-MM-DD format.\n\n" +
                "Example:\n" +
                "2026-08-25"
        };
    }

    const todayStart =
        new Date(
            Utilities.formatDate(
                new Date(),
                TIMEZONE,
                "yyyy-MM-dd"
            ) + "T00:00:00+05:30"
        );

    const requestedDate =
        new Date(
            typedDate + "T00:00:00+05:30"
        );

    if (
        requestedDate.getTime() <
        todayStart.getTime()
    ) {

        return {
            valid: false,
            message:
                "❌ That date is in the past.\n\n" +
                "Please enter a valid future date (YYYY-MM-DD)."
        };
    }

    return {
        valid: true,
        date: typedDate
    };
}


function handleWhatsAppDateMenuInput(
    ss,
    phone,
    doctorId,
    normalizedMessage,
    nextSlotState,
    customDateState,
    isReschedule
) {

    const selectedDate =
        getISODateFromMenuChoice(
            normalizedMessage
        );

    if (selectedDate) {

        whatsAppShowSlotsForDate(
            ss,
            phone,
            doctorId,
            selectedDate,
            nextSlotState
        );

        return;
    }

    if (normalizedMessage === "3") {

        saveWhatsAppSession(
            phone,
            { state: customDateState }
        );

        sendWhatsAppReply(
            ss,
            phone,
            buildCustomDateEntryPrompt(isReschedule)
        );

        return;
    }

    sendWhatsAppReply(
        ss,
        phone,
        buildInvalidDateMenuReply()
    );
}


function handleWhatsAppCustomDateInput(
    ss,
    phone,
    doctorId,
    messageText,
    nextSlotState
) {

    const validation =
        validateFutureISODate(
            messageText.trim()
        );

    if (!validation.valid) {

        sendWhatsAppReply(
            ss,
            phone,
            validation.message
        );

        return;
    }

    whatsAppShowSlotsForDate(
        ss,
        phone,
        doctorId,
        validation.date,
        nextSlotState
    );
}


function requireDoctorId(ss, phone, session) {

    const doctorId =
        resolveDoctorIdFromSession(
            phone,
            session
        );

    if (!doctorId) {

        sendWhatsAppReply(
            ss,
            phone,
            "❌ Doctor session expired.\n\n" +
            "Please send Hi to start again."
        );

        return null;
    }

    return doctorId;
}


function showBookingDateSelection(ss, phone) {

    sendDateMenuReply(
        ss,
        phone,
        "Please choose a date:"
    );
}


function showRescheduleDateSelection(ss, phone) {

    sendDateMenuReply(
        ss,
        phone,
        "Please choose a new date:"
    );
}


function showDoctorDateSelection(ss, phone) {

    sendDateMenuReply(
        ss,
        phone,
        "Please choose a date:"
    );
}


function resolveDoctorIdFromSession(phone, session) {

    if (
        session &&
        session.doctorId
    ) {
        return String(session.doctorId).trim();
    }

    const doctor =
        findDoctorByWhatsAppPhone(phone);

    return doctor
        ? doctor.doctorId
        : "";
}


function returnDoctorToDateSelection(ss, phone, doctorId) {

    saveWhatsAppSession(
        phone,
        {
            role: "DOCTOR",
            state: "DOCTOR_DATE",
            doctorId: doctorId,
            date: "",
            time: "",
            appointmentId: ""
        }
    );

    showDoctorDateSelection(ss, phone);
}


function showDoctorScheduleForDateAndReturn(
    ss,
    phone,
    doctorId,
    isoDate
) {

    returnDoctorToMenu(
        ss,
        phone,
        doctorId,
        formatDoctorSchedule(
            getDoctorScheduleForDate(
                doctorId,
                isoDate
            ),
            "Schedule for " + isoDate
        )
    );
}


function returnToMainMenu(ss, phone, prefix) {

    saveWhatsAppSession(
        phone,
        {
            role: "PATIENT",
            state: "MAIN_MENU",
            doctorId: "",
            date: "",
            time: "",
            appointmentId: ""
        }
    );

    sendPatientMainMenuReply(
        ss,
        phone,
        prefix || "👋 Back to main menu."
    );
}


function returnDoctorToMenu(ss, phone, doctorId, prefix) {

    const doctorName =
        findDoctorById(doctorId) || "";

    saveWhatsAppSession(
        phone,
        {
            role: "DOCTOR",
            state: "DOCTOR_MENU",
            doctorId: doctorId,
            date: "",
            time: "",
            appointmentId: ""
        }
    );

    sendDoctorMainMenuReply(
        ss,
        phone,
        doctorId,
        prefix
    );
}


function goBackInWhatsAppFlow(ss, phone, session) {

    switch (session.state) {

        case "BOOK_DOCTOR":
            returnToMainMenu(ss, phone);
            return;

        case "BOOK_DATE":
            saveWhatsAppSession(phone, {
                state: "BOOK_DOCTOR",
                doctorId: ""
            });
            sendDoctorSelectionReply(
                ss,
                phone
            );
            return;

        case "BOOK_DATE_CUSTOM":
        case "BOOK_TIME":
            saveWhatsAppSession(phone, {
                state: "BOOK_DATE",
                date: "",
                time: ""
            });
            showBookingDateSelection(ss, phone);
            return;

        case "BOOK_NAME":
            if (session.doctorId && session.date) {
                whatsAppShowSlotsForDate(
                    ss,
                    phone,
                    session.doctorId,
                    session.date,
                    "BOOK_TIME"
                );
                return;
            }
            returnToMainMenu(ss, phone);
            return;

        case "BOOK_CONFIRM":
            if (session.doctorId && session.date) {
                whatsAppShowSlotsForDate(
                    ss,
                    phone,
                    session.doctorId,
                    session.date,
                    "BOOK_TIME"
                );
                return;
            }
            returnToMainMenu(ss, phone);
            return;

        case "CANCEL_CONFIRM":
            saveWhatsAppSession(phone, {
                state: "CANCEL_SELECT",
                appointmentId: ""
            });
            sendWhatsAppReply(
                ss,
                phone,
                buildAppointmentPickerPrompt(
                    "❌ Cancel Appointment",
                    "Select the appointment to cancel:",
                    getConfirmedAppointmentsForPhone(phone)
                )
            );
            return;

        case "RESCHEDULE_DATE":
            saveWhatsAppSession(phone, {
                state: "RESCHEDULE_SELECT",
                appointmentId: "",
                doctorId: "",
                date: "",
                time: ""
            });
            sendWhatsAppReply(
                ss,
                phone,
                buildAppointmentPickerPrompt(
                    "🔄 Reschedule Appointment",
                    "Select the appointment to reschedule:",
                    getConfirmedAppointmentsForPhone(phone)
                )
            );
            return;

        case "RESCHEDULE_DATE_CUSTOM":
        case "RESCHEDULE_TIME":
            saveWhatsAppSession(phone, {
                state: "RESCHEDULE_DATE",
                date: "",
                time: ""
            });
            showRescheduleDateSelection(ss, phone);
            return;

        case "RESCHEDULE_CONFIRM":
            if (session.doctorId && session.date) {
                whatsAppShowSlotsForDate(
                    ss,
                    phone,
                    session.doctorId,
                    session.date,
                    "RESCHEDULE_TIME"
                );
                return;
            }
            returnToMainMenu(ss, phone);
            return;

        default:
            returnToMainMenu(ss, phone);
    }
}


function goBackInDoctorWhatsAppFlow(
    ss,
    phone,
    session
) {

    const doctorId =
        resolveDoctorIdFromSession(
            phone,
            session
        );

    switch (session.state) {

        case "DOCTOR_DATE":
        case "DOCTOR_DATE_CUSTOM":
            returnDoctorToMenu(
                ss,
                phone,
                doctorId
            );
            return;

        case "DOCTOR_AVAIL_MENU":
            returnDoctorToMenu(
                ss,
                phone,
                doctorId
            );
            return;

        case "DOCTOR_AVAIL_DAY_MENU":
            showDoctorAvailabilityMenu(
                ss,
                phone,
                doctorId
            );
            return;

        case "DOCTOR_AVAIL_REMOVE":
            returnToDoctorDayAvailability(
                ss,
                phone,
                doctorId,
                session.date
            );
            return;

        case "DOCTOR_AVAIL_START":
            returnToDoctorDayAvailability(
                ss,
                phone,
                doctorId,
                session.date
            );
            return;

        case "DOCTOR_AVAIL_END":
            saveWhatsAppSession(phone, {
                role: "DOCTOR",
                state: "DOCTOR_AVAIL_START",
                doctorId: doctorId,
                date: session.date,
                time: "",
                appointmentId: ""
            });
            sendWhatsAppReply(
                ss,
                phone,
                "🕐 Enter start time for " +
                session.date +
                " (Example: 10:00 AM):"
            );
            return;

        case "DOCTOR_AVAIL_CONFIRM":
            saveWhatsAppSession(phone, {
                role: "DOCTOR",
                state: "DOCTOR_AVAIL_END",
                doctorId: doctorId,
                date: session.date,
                time: session.time,
                appointmentId: ""
            });
            sendWhatsAppReply(
                ss,
                phone,
                "🕐 Enter end time for " +
                session.date +
                " (Example: 2:00 PM):"
            );
            return;

        case "DOCTOR_LEAVE_MENU":
            returnDoctorToMenu(
                ss,
                phone,
                doctorId
            );
            return;

        case "DOCTOR_CANCEL_SELECT":
        case "DOCTOR_CANCEL_CONFIRM":
            beginDoctorCancelFlow(
                ss,
                phone,
                doctorId
            );
            return;

        case "DOCTOR_RESCHEDULE_SELECT":
            beginDoctorRescheduleFlow(
                ss,
                phone,
                doctorId
            );
            return;

        case "DOCTOR_STATUS_SELECT":
        case "DOCTOR_STATUS_ACTION":
            beginDoctorStatusFlow(
                ss,
                phone,
                doctorId
            );
            return;

        case "DOCTOR_RESCHEDULE_DATE":
        case "DOCTOR_RESCHEDULE_DATE_CUSTOM":
            saveWhatsAppSession(phone, {
                role: "DOCTOR",
                state: "DOCTOR_RESCHEDULE_SELECT",
                doctorId: doctorId,
                appointmentId: "",
                patientName: "",
                date: "",
                time: ""
            });
            sendWhatsAppReply(
                ss,
                phone,
                buildDoctorPatientAppointmentPickerPrompt(
                    "🔄 Reschedule Patient Appointment",
                    "Select the appointment to reschedule:",
                    getDoctorConfirmedAppointments(
                        doctorId
                    )
                )
            );
            return;

        case "DOCTOR_RESCHEDULE_TIME":
            saveWhatsAppSession(phone, {
                role: "DOCTOR",
                state: "DOCTOR_RESCHEDULE_DATE",
                date: "",
                time: ""
            });
            sendWhatsAppReply(
                ss,
                phone,
                buildDateMenuPrompt(
                    "Please choose a new date:"
                )
            );
            return;

        case "DOCTOR_RESCHEDULE_CONFIRM":
            if (
                session.doctorId &&
                session.date
            ) {
                whatsAppShowSlotsForDate(
                    ss,
                    phone,
                    session.doctorId,
                    session.date,
                    "DOCTOR_RESCHEDULE_TIME"
                );
                return;
            }
            returnDoctorToMenu(
                ss,
                phone,
                doctorId
            );
            return;

        case "DOCTOR_LEAVE_DATE":
        case "DOCTOR_LEAVE_LIST":
            showDoctorLeavesMenu(
                ss,
                phone,
                doctorId
            );
            return;

        case "DOCTOR_LEAVE_REASON":
            saveWhatsAppSession(phone, {
                role: "DOCTOR",
                state: "DOCTOR_LEAVE_DATE",
                doctorId: doctorId,
                date: "",
                time: "",
                appointmentId: ""
            });
            sendWhatsAppReply(
                ss,
                phone,
                "📅 Enter leave date (YYYY-MM-DD):\n\n" +
                "Example:\n2026-08-25"
            );
            return;

        case "DOCTOR_LEAVE_CONFIRM":
            saveWhatsAppSession(phone, {
                role: "DOCTOR",
                state: "DOCTOR_LEAVE_REASON",
                doctorId: doctorId,
                date: session.date,
                time: "",
                appointmentId: ""
            });
            sendWhatsAppReply(
                ss,
                phone,
                "📝 Enter reason for leave (optional).\n\n" +
                "Reply with text or send - to skip."
            );
            return;

        case "DOCTOR_LEAVE_CANCEL_PICK":
            showDoctorLeavesMenu(
                ss,
                phone,
                doctorId
            );
            return;

        case "DOCTOR_LEAVE_RANGE_START":
            showDoctorLeavesMenu(
                ss,
                phone,
                doctorId
            );
            return;

        case "DOCTOR_LEAVE_RANGE_END":
            saveWhatsAppSession(phone, {
                role: "DOCTOR",
                state: "DOCTOR_LEAVE_RANGE_START",
                doctorId: doctorId,
                date: "",
                time: "",
                appointmentId: ""
            });
            sendWhatsAppReply(
                ss,
                phone,
                "📅 Enter range start date (YYYY-MM-DD):"
            );
            return;

        case "DOCTOR_LEAVE_RANGE_REASON":
            saveWhatsAppSession(phone, {
                role: "DOCTOR",
                state: "DOCTOR_LEAVE_RANGE_END",
                doctorId: doctorId,
                date: session.date,
                time: "",
                appointmentId: ""
            });
            sendWhatsAppReply(
                ss,
                phone,
                "📅 Enter range end date (YYYY-MM-DD):"
            );
            return;

        case "DOCTOR_LEAVE_RANGE_CONFIRM":
            saveWhatsAppSession(phone, {
                role: "DOCTOR",
                state: "DOCTOR_LEAVE_RANGE_REASON",
                doctorId: doctorId,
                date: session.date,
                time: session.time,
                appointmentId: ""
            });
            sendWhatsAppReply(
                ss,
                phone,
                "📝 Enter reason for leave range (optional).\n\n" +
                "Reply with text or send - to skip."
            );
            return;

        default:
            returnDoctorToMenu(
                ss,
                phone,
                doctorId
            );
    }
}


function buildBookNamePrompt() {

    return (
        "👤 Please enter your full name to complete the booking.\n\n" +
        "Example: Ravi Kumar"
    );
}


function buildInvalidPatientNameReply() {

    return (
        "❌ Please enter a valid full name (at least 2 characters).\n\n" +
        "Example: Ravi Kumar"
    );
}


function buildBookingConfirmationMessage(
    session,
    patientName
) {

    return (
        "Please confirm your appointment:\n\n" +
        "👤 Patient: " + patientName + "\n" +
        "👨‍⚕️ Doctor: " +
        (
            findDoctorById(
                session.doctorId
            ) || "Unknown Doctor"
        ) +
        "\n" +
        "📅 Date: " + session.date + "\n" +
        "🕐 Time: " + session.time + "\n\n" +
        "1️⃣ Confirm\n" +
        "2️⃣ Choose another time\n" +
        "3️⃣ Cancel"
    );
}


function proceedAfterBookingSlotSelected(
    ss,
    senderPhone,
    session,
    selectedTime
) {

    if (patientNeedsNameCapture(senderPhone)) {

        saveWhatsAppSession(
            senderPhone,
            {
                state: "BOOK_NAME",
                time: selectedTime
            }
        );

        sendWhatsAppReply(
            ss,
            senderPhone,
            buildBookNamePrompt()
        );

        return;
    }

    const knownName =
        resolveKnownPatientName(senderPhone);

    ensurePatientRecordFromHistory(
        senderPhone,
        session.language || "EN"
    );

    saveWhatsAppSession(
        senderPhone,
        {
            state: "BOOK_CONFIRM",
            time: selectedTime,
            patientName: knownName
        }
    );

    sendWhatsAppMenuReply(
        ss,
        senderPhone,
        buildBookingConfirmationMessage(
            Object.assign({}, session, {
                time: selectedTime
            }),
            knownName
        ),
        getBookingConfirmSpec()
    );
}


// ------------------------------------------------------------
// Shows available slots for a date and moves the session into
// the given "time selection" state. Returns true if slots were
// found and shown, false if no slots were available (in which
// case an error reply has already been sent).
// ------------------------------------------------------------

function whatsAppShowSlotsForDate(
    ss,
    senderPhone,
    doctorId,
    selectedDate,
    nextState
) {

    const slots =
        getAvailableSlots(
            doctorId,
            selectedDate
        );

    if (
        !slots ||
        slots.length === 0
    ) {

        sendWhatsAppReply(
            ss,
            senderPhone,
            "❌ Sorry, there are no available slots on " +
            selectedDate +
            ".\n\n" +
            "Please choose another date."
        );

        return false;
    }

    saveWhatsAppSession(
        senderPhone,
        {
            state: nextState,
            date: selectedDate
        }
    );

    sendWhatsAppMenuReply(
        ss,
        senderPhone,
        "📅 Date selected: " +
        selectedDate +
        "\n\nAvailable slots:\nPlease choose a time.",
        getSlotSelectionMenuSpec(slots)
    );

    return true;
}


// ============================================================
// WHATSAPP MESSAGE ROUTER
// ============================================================


function handleWhatsAppGreeting(
    ss,
    senderPhone,
    session,
    normalizedMessage
) {

// HI / HELLO / HEY
// ======================================================

if (
    normalizedMessage === "hi" ||
    normalizedMessage === "hello" ||
    normalizedMessage === "hey" ||
    normalizedMessage === "హాయ్" ||
    normalizedMessage === "హలో" ||
    normalizedMessage === "नमस्ते" ||
    normalizedMessage === "हेलो"
) {

    const doctor =
        findDoctorByWhatsAppPhone(senderPhone);

    if (doctor) {

        returnDoctorToMenu(
            ss,
            senderPhone,
            doctor.doctorId
        );

    } else {

        let savedLanguage =
            session &&
            String(session.language || "")
                .trim()
                .toUpperCase();

        if (
            ["EN", "TE", "HI"].indexOf(
                savedLanguage
            ) === -1
        ) {

            const patient =
                findPatientByPhone(
                    senderPhone
                );

            if (
                patient &&
                ["EN", "TE", "HI"].indexOf(
                    patient.language
                ) !== -1
            ) {
                savedLanguage =
                    patient.language;
            }
        }

        const hasSavedLanguage =
            ["EN", "TE", "HI"].indexOf(
                savedLanguage
            ) !== -1;

        if (hasSavedLanguage) {

            saveWhatsAppSession(
                senderPhone,
                {
                    role: "PATIENT",
                    state: "MAIN_MENU",
                    language: savedLanguage,
                    doctorId: "",
                    date: "",
                    time: "",
                    appointmentId: ""
                }
            );

            sendPatientMainMenuReply(
                ss,
                senderPhone,
                "👋 Welcome to ABC Clinic!"
            );

        } else {

            // First-time users choose their preferred language.
            saveWhatsAppSession(
                senderPhone,
                {
                    role: "PATIENT",
                    language: "",
                    state: "LANGUAGE_SELECT",
                    doctorId: "",
                    date: "",
                    time: "",
                    appointmentId: ""
                }
            );

            sendLanguageMenuReply(
                ss,
                senderPhone
            );
        }
    }

    return true;
}


// ======================================================

    return false;
}

function handleWhatsAppUniversalNavigation(
    ss,
    senderPhone,
    session,
    normalizedMessage
) {

// UNIVERSAL NAVIGATION
// ======================================================

if (
    session &&
    session.state !== "MAIN_MENU" &&
    session.state !== "DOCTOR_MENU" &&
    session.state !== "LANGUAGE_SELECT" &&
    session.state !== "LANGUAGE_CHANGE" &&
    normalizedMessage === "0"
) {

    if (session.role === "DOCTOR") {

        returnDoctorToMenu(
            ss,
            senderPhone,
            resolveDoctorIdFromSession(
                senderPhone,
                session
            )
        );

    } else {

        returnToMainMenu(ss, senderPhone);
    }

    return true;
}

if (
    session &&
    session.state !== "MAIN_MENU" &&
    session.state !== "DOCTOR_MENU" &&
    session.state !== "LANGUAGE_SELECT" &&
    session.state !== "LANGUAGE_CHANGE" &&
    normalizedMessage === "9"
) {

    if (session.role === "DOCTOR") {

        goBackInDoctorWhatsAppFlow(
            ss,
            senderPhone,
            session
        );

    } else {

        goBackInWhatsAppFlow(
            ss,
            senderPhone,
            session
        );
    }

    return true;
}


// ======================================================

    return false;
}

function handleWhatsAppDoctorMessage(
    ss,
    senderPhone,
    senderName,
    messageText,
    normalizedMessage,
    session
) {

    if (
        !session ||
        session.role !== "DOCTOR"
    ) {
        return false;
    }

// DOCTOR MENU
// ======================================================

if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_MENU"
) {

    const doctorId =
        requireDoctorId(
            ss,
            senderPhone,
            session
        );

    if (!doctorId) {

        return true;

    } else if (
        normalizedMessage === "0" ||
        normalizedMessage === "9"
    ) {

        returnDoctorToMenu(
            ss,
            senderPhone,
            doctorId
        );

    } else if (normalizedMessage === "1") {

        returnDoctorToMenu(
            ss,
            senderPhone,
            doctorId,
            formatDoctorSchedule(
                getDoctorTodaySchedule(
                    doctorId
                ),
                "Today's Schedule"
            )
        );

    } else if (normalizedMessage === "2") {

        returnDoctorToMenu(
            ss,
            senderPhone,
            doctorId,
            formatDoctorNext(
                getDoctorNextAppointment(
                    doctorId
                )
            )
        );

    } else if (normalizedMessage === "3") {

        returnDoctorToMenu(
            ss,
            senderPhone,
            doctorId,
            formatDoctorWeek(
                getDoctorWeeklySchedule(
                    doctorId
                )
            )
        );

    } else if (normalizedMessage === "4") {

        saveWhatsAppSession(
            senderPhone,
            {
                role: "DOCTOR",
                state: "DOCTOR_DATE",
                doctorId: doctorId,
                date: "",
                time: "",
                appointmentId: ""
            }
        );

        showDoctorDateSelection(
            ss,
            senderPhone
        );

    } else if (normalizedMessage === "5") {

        showDoctorAvailabilityMenu(
            ss,
            senderPhone,
            doctorId
        );

    } else if (normalizedMessage === "6") {

        showDoctorLeavesMenu(
            ss,
            senderPhone,
            doctorId
        );

    } else if (normalizedMessage === "7") {

        returnDoctorToMenu(
            ss,
            senderPhone,
            doctorId,
            formatDoctorPatientsList(
                doctorId
            )
        );

    } else if (normalizedMessage === "8") {

        beginDoctorCancelFlow(
            ss,
            senderPhone,
            doctorId
        );

    } else if (normalizedMessage === "9") {

        beginDoctorRescheduleFlow(
            ss,
            senderPhone,
            doctorId
        );

    } else if (normalizedMessage === "10") {

        beginDoctorStatusFlow(
            ss,
            senderPhone,
            doctorId
        );

    } else {

        returnDoctorToMenu(
            ss,
            senderPhone,
            doctorId,
            "❌ Invalid option. Please choose 1, 2, 3, 4, 5, 6, 7, 8, 9, or 10."
        );
    }
    return true;
}


// ======================================================
// DOCTOR — MANAGE AVAILABILITY
// ======================================================

if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_AVAIL_MENU"
) {

    const doctorId =
        requireDoctorId(
            ss,
            senderPhone,
            session
        );

    if (!doctorId) {
        return true;
    }

    const dayName =
        doctorWeekdayIndexToName(
            normalizedMessage
        );

    if (dayName) {

        showDoctorDayAvailabilityMenu(
            ss,
            senderPhone,
            doctorId,
            dayName
        );

    } else {

        sendWhatsAppReply(
            ss,
            senderPhone,
            "❌ Invalid day.\n\n" +
            formatDoctorAvailabilityMenu(
                doctorId
            )
        );
    }
}

if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_AVAIL_DAY_MENU"
) {

    const doctorId =
        requireDoctorId(
            ss,
            senderPhone,
            session
        );

    const dayName =
        session.date;

    if (
        !doctorId ||
        !dayName
    ) {
        return true;
    }

    if (normalizedMessage === "1") {

        saveWhatsAppSession(
            senderPhone,
            {
                role: "DOCTOR",
                state: "DOCTOR_AVAIL_START",
                doctorId: doctorId,
                date: dayName,
                time: "",
                appointmentId: ""
            }
        );

        sendWhatsAppReply(
            ss,
            senderPhone,
            "🕐 Enter start time for " +
            dayName +
            " (Example: 10:00 AM):"
        );

    } else if (normalizedMessage === "2") {

        const sessions =
            getDoctorDayAvailabilitySessions(
                doctorId,
                dayName
            );

        if (sessions.length === 0) {

            returnToDoctorDayAvailability(
                ss,
                senderPhone,
                doctorId,
                dayName,
                "❌ No sessions to remove."
            );

        } else {

            saveWhatsAppSession(
                senderPhone,
                {
                    role: "DOCTOR",
                    state: "DOCTOR_AVAIL_REMOVE",
                    doctorId: doctorId,
                    date: dayName,
                    time: "",
                    appointmentId: ""
                }
            );

            sendWhatsAppReply(
                ss,
                senderPhone,
                "Select session to remove:\n\n" +
                formatDoctorDayAvailabilityMenu(
                    doctorId,
                    dayName
                )
            );
        }

    } else if (normalizedMessage === "3") {

        const result =
            clearDoctorDayAvailability(
                doctorId,
                dayName
            );

        returnToDoctorDayAvailability(
            ss,
            senderPhone,
            doctorId,
            dayName,
            (result.success ? "✅ " : "❌ ") +
            result.message
        );

    } else {

        returnToDoctorDayAvailability(
            ss,
            senderPhone,
            doctorId,
            dayName,
            "❌ Invalid option."
        );
    }
}

if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_AVAIL_REMOVE"
) {

    const doctorId =
        requireDoctorId(
            ss,
            senderPhone,
            session
        );

    const dayName =
        session.date;

    if (
        !doctorId ||
        !dayName
    ) {
        return true;
    }

    const pick =
        Number(normalizedMessage);

    const result =
        removeDoctorAvailabilitySession(
            doctorId,
            dayName,
            pick
        );

    returnToDoctorDayAvailability(
        ss,
        senderPhone,
        doctorId,
        dayName,
        (result.success ? "✅ " : "❌ ") +
        result.message
    );
}

if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_AVAIL_START"
) {

    const doctorId =
        requireDoctorId(
            ss,
            senderPhone,
            session
        );

    const dayName =
        session.date;

    if (
        !doctorId ||
        !dayName
    ) {
        return true;
    }

    const startTime =
        normalizeAvailabilityTimeInput(
            messageText.trim()
        );

    if (!startTime) {

        sendWhatsAppReply(
            ss,
            senderPhone,
            "❌ Invalid time format.\n\n" +
            "Example: 10:00 AM"
        );

        return true;
    }

    saveWhatsAppSession(
        senderPhone,
        {
            role: "DOCTOR",
            state: "DOCTOR_AVAIL_END",
            doctorId: doctorId,
            date: dayName,
            time: startTime,
            appointmentId: ""
        }
    );

    sendWhatsAppReply(
        ss,
        senderPhone,
        "🕐 Enter end time for " +
        dayName +
        " (Example: 2:00 PM):"
    );
}

if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_AVAIL_END"
) {

    const doctorId =
        requireDoctorId(
            ss,
            senderPhone,
            session
        );

    const dayName =
        session.date;

    const startTime =
        session.time;

    if (
        !doctorId ||
        !dayName ||
        !startTime
    ) {
        return true;
    }

    const endTime =
        normalizeAvailabilityTimeInput(
            messageText.trim()
        );

    if (!endTime) {

        sendWhatsAppReply(
            ss,
            senderPhone,
            "❌ Invalid time format.\n\n" +
            "Example: 2:00 PM"
        );

        return true;
    }

    saveWhatsAppSession(
        senderPhone,
        {
            role: "DOCTOR",
            state: "DOCTOR_AVAIL_CONFIRM",
            doctorId: doctorId,
            date: dayName,
            time: startTime,
            appointmentId: endTime
        }
    );

    sendWhatsAppReply(
        ss,
        senderPhone,
        "Please confirm new session:\n\n" +
        "📅 " + dayName + "\n" +
        "🕐 " + startTime + " - " + endTime + "\n\n" +
        "1️⃣ Confirm\n" +
        "2️⃣ Cancel"
    );
}

if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_AVAIL_CONFIRM"
) {

    const doctorId =
        requireDoctorId(
            ss,
            senderPhone,
            session
        );

    const dayName =
        session.date;

    const startTime =
        session.time;

    const endTime =
        session.appointmentId;

    if (
        !doctorId ||
        !dayName ||
        !startTime ||
        !endTime
    ) {
        return true;
    }

    if (normalizedMessage === "1") {

        const result =
            addDoctorAvailabilitySession(
                doctorId,
                dayName,
                startTime,
                endTime
            );

        returnToDoctorDayAvailability(
            ss,
            senderPhone,
            doctorId,
            dayName,
            (result.success ? "✅ " : "❌ ") +
            result.message
        );

    } else if (normalizedMessage === "2") {

        returnToDoctorDayAvailability(
            ss,
            senderPhone,
            doctorId,
            dayName,
            "❌ Session not saved."
        );

    } else {

        sendWhatsAppReply(
            ss,
            senderPhone,
            "❌ Invalid option.\n\n" +
            "1️⃣ Confirm\n" +
            "2️⃣ Cancel"
        );
    }
    return true;
}


// ======================================================
// DOCTOR — CANCEL / RESCHEDULE PATIENT APPOINTMENTS
// ======================================================

if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_CANCEL_SELECT"
) {

    const doctorId =
        requireDoctorId(
            ss,
            senderPhone,
            session
        );

    if (!doctorId) {
        return true;
    }

    handleDoctorWhatsAppAppointmentListSelection(
        ss,
        senderPhone,
        session,
        normalizedMessage,
        {
            selectLine:
                "Select the appointment to cancel:",
            onChosen: function (chosen) {

                saveWhatsAppSession(
                    senderPhone,
                    {
                        role: "DOCTOR",
                        state: "DOCTOR_CANCEL_CONFIRM",
                        doctorId: doctorId,
                        appointmentId:
                            chosen.appointmentId,
                        patientName:
                            chosen.patientName
                    }
                );

                sendWhatsAppMenuReply(
                    ss,
                    senderPhone,
                    buildDoctorCancelConfirmMessage(
                        chosen
                    ),
                    getYesNoConfirmSpec()
                );
            }
        }
    );

    return true;
}


if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_CANCEL_CONFIRM"
) {

    const doctorId =
        requireDoctorId(
            ss,
            senderPhone,
            session
        );

    if (!doctorId) {
        return true;
    }

    if (normalizedMessage === "1") {

        const appointments =
            getDoctorConfirmedAppointments(
                doctorId
            );

        let chosen = null;

        appointments.forEach(
            function (appt) {

                if (
                    appt.appointmentId ===
                    session.appointmentId
                ) {
                    chosen = appt;
                }
            }
        );

        const result =
            cancelAppointment(
                session.appointmentId,
                "",
                {
                    authorizedDoctorId:
                        doctorId
                }
            );

        if (
            result &&
            result.success
        ) {

            if (chosen) {
                notifyPatientOfDoctorCancellation(
                    chosen
                );
            }

            returnDoctorToMenu(
                ss,
                senderPhone,
                doctorId,
                "✅ " + result.message
            );

        } else {

            const errorMessage =
                result && result.message
                    ? result.message
                    : "Unable to cancel the appointment.";

            sendWhatsAppReply(
                ss,
                senderPhone,
                "❌ " + errorMessage + "\n\n" +
                "1️⃣ Yes, cancel it\n" +
                "2️⃣ No, go back"
            );
        }

    } else if (normalizedMessage === "2") {

        returnDoctorToMenu(
            ss,
            senderPhone,
            doctorId,
            "👍 Okay, appointment was not cancelled."
        );

    } else {

        sendWhatsAppReply(
            ss,
            senderPhone,
            "❌ Invalid option.\n\n" +
            "1️⃣ Yes, cancel it\n" +
            "2️⃣ No, go back"
        );
    }

    return true;
}


if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_STATUS_SELECT"
) {

    const doctorId =
        requireDoctorId(
            ss,
            senderPhone,
            session
        );

    if (!doctorId) {
        return true;
    }

    handleDoctorWhatsAppAppointmentListSelection(
        ss,
        senderPhone,
        session,
        normalizedMessage,
        {
            selectLine:
                "Select the appointment to update:",
            getAppointments: function () {
                return getDoctorStatusEligibleAppointments(
                    doctorId
                );
            },
            onChosen: function (chosen) {

                saveWhatsAppSession(
                    senderPhone,
                    {
                        role: "DOCTOR",
                        state: "DOCTOR_STATUS_ACTION",
                        doctorId: doctorId,
                        appointmentId:
                            chosen.appointmentId,
                        patientName:
                            chosen.patientName,
                        date: chosen.date,
                        time: chosen.time
                    }
                );

                sendWhatsAppMenuReply(
                    ss,
                    senderPhone,
                    buildDoctorStatusActionMessage(
                        chosen
                    ),
                    getDoctorStatusActionSpec()
                );
            }
        }
    );

    return true;
}


if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_STATUS_ACTION"
) {

    const doctorId =
        requireDoctorId(
            ss,
            senderPhone,
            session
        );

    if (!doctorId) {
        return true;
    }

    if (normalizedMessage === "0") {

        returnDoctorToMenu(
            ss,
            senderPhone,
            doctorId
        );

        return true;
    }

    let targetStatus = "";

    if (normalizedMessage === "1") {
        targetStatus =
            APPOINTMENT_STATUS.COMPLETED;
    } else if (normalizedMessage === "2") {
        targetStatus =
            APPOINTMENT_STATUS.NO_SHOW;
    } else {

        sendWhatsAppMenuReply(
            ss,
            senderPhone,
            "❌ Invalid option.\n\n" +
            "1️⃣ Completed\n" +
            "2️⃣ No-Show",
            getDoctorStatusActionSpec()
        );

        return true;
    }

    const result =
        updateAppointmentStatus(
            session.appointmentId,
            targetStatus,
            {
                authorizedDoctorId:
                    doctorId
            }
        );

    if (
        result &&
        result.success
    ) {

        returnDoctorToMenu(
            ss,
            senderPhone,
            doctorId,
            "✅ " + result.message
        );

    } else {

        const errorMessage =
            result && result.message
                ? result.message
                : "Unable to update appointment status.";

        sendWhatsAppMenuReply(
            ss,
            senderPhone,
            "❌ " + errorMessage + "\n\n" +
            "1️⃣ Completed\n" +
            "2️⃣ No-Show",
            getDoctorStatusActionSpec()
        );
    }

    return true;
}


if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_RESCHEDULE_SELECT"
) {

    const doctorId =
        requireDoctorId(
            ss,
            senderPhone,
            session
        );

    if (!doctorId) {
        return true;
    }

    handleDoctorWhatsAppAppointmentListSelection(
        ss,
        senderPhone,
        session,
        normalizedMessage,
        {
            selectLine:
                "Select the appointment to reschedule:",
            onChosen: function (chosen) {

                beginDoctorRescheduleDateSelection(
                    ss,
                    senderPhone,
                    doctorId,
                    chosen
                );
            }
        }
    );

    return true;
}


if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_RESCHEDULE_DATE"
) {

    handleWhatsAppDateMenuInput(
        ss,
        senderPhone,
        session.doctorId,
        normalizedMessage,
        "DOCTOR_RESCHEDULE_TIME",
        "DOCTOR_RESCHEDULE_DATE_CUSTOM",
        true
    );

    return true;
}


if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_RESCHEDULE_DATE_CUSTOM"
) {

    handleWhatsAppCustomDateInput(
        ss,
        senderPhone,
        session.doctorId,
        messageText,
        "DOCTOR_RESCHEDULE_TIME"
    );

    return true;
}


if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_RESCHEDULE_TIME"
) {

    handleDoctorWhatsAppRescheduleTimeState(
        ss,
        senderPhone,
        session,
        normalizedMessage
    );

    return true;
}


if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_RESCHEDULE_CONFIRM"
) {

    const doctorId =
        requireDoctorId(
            ss,
            senderPhone,
            session
        );

    if (!doctorId) {
        return true;
    }

    if (normalizedMessage === "1") {

        if (
            !session.appointmentId ||
            !session.date ||
            !session.time
        ) {

            returnDoctorToMenu(
                ss,
                senderPhone,
                doctorId,
                "❌ Doctor session expired.\n\n" +
                "Please send Hi to open the Doctor Portal again."
            );

            return true;
        }

        const appointments =
            getDoctorConfirmedAppointments(
                doctorId
            );

        let chosen = null;

        appointments.forEach(
            function (appt) {

                if (
                    appt.appointmentId ===
                    session.appointmentId
                ) {
                    chosen = appt;
                }
            }
        );

        const result =
            rescheduleAppointment(
                session.appointmentId,
                "",
                session.date,
                session.time,
                {
                    authorizedDoctorId:
                        doctorId
                }
            );

        if (
            result &&
            result.success
        ) {

            if (chosen) {
                notifyPatientOfDoctorReschedule(
                    chosen,
                    result
                );
            }

            returnDoctorToMenu(
                ss,
                senderPhone,
                doctorId,
                "✅ Appointment rescheduled!\n\n" +
                "👤 Patient: " +
                (
                    session.patientName ||
                    chosen &&
                    chosen.patientName ||
                    ""
                ) +
                "\n" +
                "🆔 Appointment ID: " +
                result.appointmentId +
                "\n" +
                "📅 New Date: " +
                result.date +
                "\n" +
                "🕐 New Time: " +
                result.time
            );

        } else {

            const errorMessage =
                result && result.message
                    ? result.message
                    : "Unable to reschedule the appointment.";

            sendWhatsAppReply(
                ss,
                senderPhone,
                "❌ " + errorMessage + "\n\n" +
                "Please reply with:\n\n" +
                "1️⃣ Confirm\n" +
                "2️⃣ Choose another time\n" +
                "3️⃣ Cancel"
            );
        }

    } else if (normalizedMessage === "2") {

        if (
            !session.doctorId ||
            !session.date
        ) {

            returnDoctorToMenu(
                ss,
                senderPhone,
                doctorId,
                "❌ Doctor session expired.\n\n" +
                "Please send Hi to open the Doctor Portal again."
            );

            return true;
        }

        whatsAppShowSlotsForDate(
            ss,
            senderPhone,
            session.doctorId,
            session.date,
            "DOCTOR_RESCHEDULE_TIME"
        );

    } else if (normalizedMessage === "3") {

        returnDoctorToMenu(
            ss,
            senderPhone,
            doctorId,
            "❌ Reschedule cancelled."
        );

    } else {

        sendWhatsAppReply(
            ss,
            senderPhone,
            "❌ Invalid option.\n\n" +
            "1️⃣ Confirm\n" +
            "2️⃣ Choose another time\n" +
            "3️⃣ Cancel"
        );
    }

    return true;
}


// ======================================================
// DOCTOR — MANAGE LEAVES
// ======================================================

if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_LEAVE_MENU"
) {

    const doctorId =
        requireDoctorId(
            ss,
            senderPhone,
            session
        );

    if (!doctorId) {
        return true;
    }

    if (normalizedMessage === "1") {

        saveWhatsAppSession(
            senderPhone,
            {
                role: "DOCTOR",
                state: "DOCTOR_LEAVE_DATE",
                doctorId: doctorId,
                date: "",
                time: "",
                appointmentId: ""
            }
        );

        sendWhatsAppReply(
            ss,
            senderPhone,
            "📅 Enter leave date (YYYY-MM-DD):\n\n" +
            "Example:\n2026-08-25"
        );

    } else if (normalizedMessage === "2") {

        saveWhatsAppSession(
            senderPhone,
            {
                role: "DOCTOR",
                state: "DOCTOR_LEAVE_LIST",
                doctorId: doctorId,
                date: "",
                time: "",
                appointmentId: ""
            }
        );

        returnDoctorToMenu(
            ss,
            senderPhone,
            doctorId,
            formatDoctorUpcomingLeaves(
                doctorId
            )
        );

    } else if (normalizedMessage === "3") {

        const leaves =
            getDoctorUpcomingLeaves(
                doctorId
            );

        if (leaves.length === 0) {

            returnDoctorToMenu(
                ss,
                senderPhone,
                doctorId,
                "No upcoming leaves to cancel."
            );

        } else {

            saveWhatsAppSession(
                senderPhone,
                {
                    role: "DOCTOR",
                    state: "DOCTOR_LEAVE_CANCEL_PICK",
                    doctorId: doctorId,
                    date: "",
                    time: "",
                    appointmentId: ""
                }
            );

            sendWhatsAppReply(
                ss,
                senderPhone,
                "Select leave to cancel:\n\n" +
                formatDoctorUpcomingLeaves(
                    doctorId
                )
            );
        }

    } else if (normalizedMessage === "4") {

        saveWhatsAppSession(
            senderPhone,
            {
                role: "DOCTOR",
                state: "DOCTOR_LEAVE_RANGE_START",
                doctorId: doctorId,
                date: "",
                time: "",
                appointmentId: ""
            }
        );

        sendWhatsAppReply(
            ss,
            senderPhone,
            "📅 Enter range start date (YYYY-MM-DD):"
        );

    } else {

        sendWhatsAppReply(
            ss,
            senderPhone,
            "❌ Invalid option.\n\n" +
            formatDoctorLeavesMenu()
        );
    }
}

if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_LEAVE_DATE"
) {

    const doctorId =
        requireDoctorId(
            ss,
            senderPhone,
            session
        );

    const leaveDate =
        messageText.trim();

    if (!doctorId) {
        return true;
    }

    if (!isValidISODate(leaveDate)) {

        sendWhatsAppReply(
            ss,
            senderPhone,
            "❌ Invalid date.\n\n" +
            "Use YYYY-MM-DD format."
        );

        return true;
    }

    saveWhatsAppSession(
        senderPhone,
        {
            role: "DOCTOR",
            state: "DOCTOR_LEAVE_REASON",
            doctorId: doctorId,
            date: leaveDate,
            time: "",
            appointmentId: ""
        }
    );

    sendWhatsAppReply(
        ss,
        senderPhone,
        "📝 Enter reason for leave (optional).\n\n" +
        "Reply with text or send - to skip."
    );
}

if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_LEAVE_REASON"
) {

    const doctorId =
        requireDoctorId(
            ss,
            senderPhone,
            session
        );

    const leaveDate =
        session.date;

    if (
        !doctorId ||
        !leaveDate
    ) {
        return true;
    }

    const reason =
        normalizedMessage === "-"
            ? ""
            : messageText.trim();

    saveWhatsAppSession(
        senderPhone,
        {
            role: "DOCTOR",
            state: "DOCTOR_LEAVE_CONFIRM",
            doctorId: doctorId,
            date: leaveDate,
            time: reason,
            appointmentId: ""
        }
    );

    sendWhatsAppReply(
        ss,
        senderPhone,
        "Confirm leave:\n\n" +
        "📅 " + leaveDate + "\n" +
        (
            reason
                ? "📝 " + reason + "\n"
                : ""
        ) +
        "\n1️⃣ Confirm\n" +
        "2️⃣ Cancel"
    );
}

if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_LEAVE_CONFIRM"
) {

    const doctorId =
        requireDoctorId(
            ss,
            senderPhone,
            session
        );

    const leaveDate =
        session.date;

    const reason =
        session.time;

    if (
        !doctorId ||
        !leaveDate
    ) {
        return true;
    }

    if (normalizedMessage === "1") {

        const result =
            addDoctorLeave(
                doctorId,
                leaveDate,
                reason
            );

        returnDoctorToMenu(
            ss,
            senderPhone,
            doctorId,
            (result.success ? "✅ " : "❌ ") +
            result.message
        );

    } else if (normalizedMessage === "2") {

        returnDoctorToMenu(
            ss,
            senderPhone,
            doctorId,
            "❌ Leave not saved."
        );

    } else {

        sendWhatsAppReply(
            ss,
            senderPhone,
            "❌ Invalid option.\n\n" +
            "1️⃣ Confirm\n" +
            "2️⃣ Cancel"
        );
    }
}

if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_LEAVE_CANCEL_PICK"
) {

    const doctorId =
        requireDoctorId(
            ss,
            senderPhone,
            session
        );

    if (!doctorId) {
        return true;
    }

    const leaves =
        getDoctorUpcomingLeaves(
            doctorId
        );

    const pick =
        Number(normalizedMessage);

    if (
        !Number.isInteger(pick) ||
        pick < 1 ||
        pick > leaves.length
    ) {

        sendWhatsAppReply(
            ss,
            senderPhone,
            "❌ Invalid selection.\n\n" +
            formatDoctorUpcomingLeaves(
                doctorId
            )
        );

        return true;
    }

    const result =
        deactivateDoctorLeave(
            doctorId,
            leaves[pick - 1].date
        );

    returnDoctorToMenu(
        ss,
        senderPhone,
        doctorId,
        (result.success ? "✅ " : "❌ ") +
        result.message
    );
}

if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_LEAVE_RANGE_START"
) {

    const doctorId =
        requireDoctorId(
            ss,
            senderPhone,
            session
        );

    const startDate =
        messageText.trim();

    if (!doctorId) {
        return true;
    }

    if (!isValidISODate(startDate)) {

        sendWhatsAppReply(
            ss,
            senderPhone,
            "❌ Invalid date.\n\n" +
            "Use YYYY-MM-DD format."
        );

        return true;
    }

    saveWhatsAppSession(
        senderPhone,
        {
            role: "DOCTOR",
            state: "DOCTOR_LEAVE_RANGE_END",
            doctorId: doctorId,
            date: startDate,
            time: "",
            appointmentId: ""
        }
    );

    sendWhatsAppReply(
        ss,
        senderPhone,
        "📅 Enter range end date (YYYY-MM-DD):"
    );
}

if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_LEAVE_RANGE_END"
) {

    const doctorId =
        requireDoctorId(
            ss,
            senderPhone,
            session
        );

    const startDate =
        session.date;

    const endDate =
        messageText.trim();

    if (
        !doctorId ||
        !startDate
    ) {
        return true;
    }

    if (!isValidISODate(endDate)) {

        sendWhatsAppReply(
            ss,
            senderPhone,
            "❌ Invalid date.\n\n" +
            "Use YYYY-MM-DD format."
        );

        return true;
    }

    if (endDate < startDate) {

        sendWhatsAppReply(
            ss,
            senderPhone,
            "❌ End date must be on or after start date."
        );

        return true;
    }

    saveWhatsAppSession(
        senderPhone,
        {
            role: "DOCTOR",
            state: "DOCTOR_LEAVE_RANGE_REASON",
            doctorId: doctorId,
            date: startDate,
            time: endDate,
            appointmentId: ""
        }
    );

    sendWhatsAppReply(
        ss,
        senderPhone,
        "📝 Enter reason for leave range (optional).\n\n" +
        "Reply with text or send - to skip."
    );
}

if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_LEAVE_RANGE_REASON"
) {

    const doctorId =
        requireDoctorId(
            ss,
            senderPhone,
            session
        );

    const startDate =
        session.date;

    const endDate =
        session.time;

    if (
        !doctorId ||
        !startDate ||
        !endDate
    ) {
        return true;
    }

    const reason =
        normalizedMessage === "-"
            ? ""
            : messageText.trim();

    saveWhatsAppSession(
        senderPhone,
        {
            role: "DOCTOR",
            state: "DOCTOR_LEAVE_RANGE_CONFIRM",
            doctorId: doctorId,
            date: startDate,
            time: endDate,
            appointmentId: reason
        }
    );

    sendWhatsAppReply(
        ss,
        senderPhone,
        "Confirm leave range:\n\n" +
        "📅 " + startDate +
        " to " + endDate + "\n" +
        (
            reason
                ? "📝 " + reason + "\n"
                : ""
        ) +
        "\n1️⃣ Confirm\n" +
        "2️⃣ Cancel"
    );
}

if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_LEAVE_RANGE_CONFIRM"
) {

    const doctorId =
        requireDoctorId(
            ss,
            senderPhone,
            session
        );

    const startDate =
        session.date;

    const endDate =
        session.time;

    const reason =
        session.appointmentId;

    if (
        !doctorId ||
        !startDate ||
        !endDate
    ) {
        return true;
    }

    if (normalizedMessage === "1") {

        const result =
            addDoctorLeaveRange(
                doctorId,
                startDate,
                endDate,
                reason
            );

        returnDoctorToMenu(
            ss,
            senderPhone,
            doctorId,
            (result.success ? "✅ " : "❌ ") +
            result.message
        );

    } else if (normalizedMessage === "2") {

        returnDoctorToMenu(
            ss,
            senderPhone,
            doctorId,
            "❌ Leave range not saved."
        );

    } else {

        sendWhatsAppReply(
            ss,
            senderPhone,
            "❌ Invalid option.\n\n" +
            "1️⃣ Confirm\n" +
            "2️⃣ Cancel"
        );
    }
    return true;
}


// ======================================================
// DOCTOR DATE
// ======================================================

if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_DATE"
) {

    const doctorId =
        requireDoctorId(
            ss,
            senderPhone,
            session
        );

    if (!doctorId) {

        return true;

    } else if (normalizedMessage === "1") {

        showDoctorScheduleForDateAndReturn(
            ss,
            senderPhone,
            doctorId,
            Utilities.formatDate(
                new Date(),
                TIMEZONE,
                "yyyy-MM-dd"
            )
        );

    } else if (normalizedMessage === "2") {

        const tomorrow =
            new Date();

        tomorrow.setDate(
            tomorrow.getDate() + 1
        );

        showDoctorScheduleForDateAndReturn(
            ss,
            senderPhone,
            doctorId,
            Utilities.formatDate(
                tomorrow,
                TIMEZONE,
                "yyyy-MM-dd"
            )
        );

    } else if (normalizedMessage === "3") {

        saveWhatsAppSession(
            senderPhone,
            {
                role: "DOCTOR",
                state: "DOCTOR_DATE_CUSTOM",
                doctorId: doctorId,
                date: "",
                time: "",
                appointmentId: ""
            }
        );

        sendWhatsAppReply(
            ss,
            senderPhone,
            "📅 Please enter the date in YYYY-MM-DD format.\n\n" +
            "Example:\n" +
            "2026-08-25"
        );

    } else {

        sendWhatsAppReply(
            ss,
            senderPhone,
            "❌ Invalid option.\n\n" +
            "Please reply with:\n\n" +
            "1️⃣ Today\n" +
            "2️⃣ Tomorrow\n" +
            "3️⃣ Enter another date"
        );
    }
    return true;
}


// ======================================================
// DOCTOR DATE CUSTOM (manually typed date)
// ======================================================

if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_DATE_CUSTOM"
) {

    const doctorId =
        requireDoctorId(
            ss,
            senderPhone,
            session
        );

    const typedDate =
        messageText.trim();

    if (!doctorId) {

        return true;

    } else if (
        !isValidISODate(typedDate)
    ) {

        sendWhatsAppReply(
            ss,
            senderPhone,
            "❌ That doesn't look like a valid date.\n\n" +
            "Please enter the date in YYYY-MM-DD format.\n\n" +
            "Example:\n" +
            "2026-08-25"
        );

    } else {

        showDoctorScheduleForDateAndReturn(
            ss,
            senderPhone,
            doctorId,
            typedDate
        );
    }
    return true;
}


// ======================================================

    return false;
}

function handleWhatsAppPatientMessage(
    ss,
    senderPhone,
    senderName,
    messageText,
    normalizedMessage,
    session
) {

// LANGUAGE SELECTION
// ======================================================

if (
    session &&
    session.state === "LANGUAGE_SELECT"
) {

    const languageByChoice = {
        "1": "EN",
        "2": "TE",
        "3": "HI"
    };

    const language =
        languageByChoice[normalizedMessage];

    if (!language) {

        sendWhatsAppReply(
            ss,
            senderPhone,
            buildLanguageSelectionMessage()
        );

    } else {

        saveWhatsAppSession(
            senderPhone,
            {
                role: "PATIENT",
                language: language,
                state: "MAIN_MENU",
                doctorId: "",
                date: "",
                time: "",
                appointmentId: ""
            }
        );

        syncPatientLanguagePreference(
            senderPhone,
            language
        );

        sendWhatsAppReply(
            ss,
            senderPhone,
            buildMainMenuMessage(
                "👋 Welcome to ABC Clinic!"
            )
        );
    }
    return true;
}


// ======================================================
// LANGUAGE CHANGE
// ======================================================

if (
    session &&
    session.state === "LANGUAGE_CHANGE"
) {

    const languageByChoice = {
        "1": "EN",
        "2": "TE",
        "3": "HI"
    };

    const language =
        languageByChoice[normalizedMessage];

    if (!language) {

        sendWhatsAppReply(
            ss,
            senderPhone,
            buildLanguageSelectionMessage()
        );

    } else {

        const currentSession =
            session || {};

        if (
            currentSession.role ===
            "DOCTOR"
        ) {

            const doctorId =
                resolveDoctorIdFromSession(
                    senderPhone,
                    currentSession
                );

            saveWhatsAppSession(
                senderPhone,
                {
                    role: "DOCTOR",
                    language: language,
                    state: "DOCTOR_MENU",
                    doctorId: doctorId,
                    date: "",
                    time: "",
                    appointmentId: ""
                }
            );

            returnDoctorToMenu(
                ss,
                senderPhone,
                doctorId,
                "✅ Language changed successfully."
            );

        } else {

            saveWhatsAppSession(
                senderPhone,
                {
                    role: "PATIENT",
                    language: language,
                    state: "MAIN_MENU",
                    doctorId: "",
                    date: "",
                    time: "",
                    appointmentId: ""
                }
            );

            syncPatientLanguagePreference(
                senderPhone,
                language
            );

            sendWhatsAppReply(
                ss,
                senderPhone,
                buildMainMenuMessage(
                    "✅ Language changed successfully."
                )
            );
        }
    }
    return true;
}


// ======================================================
// MAIN MENU → BOOK APPOINTMENT
// ======================================================

if (
    normalizedMessage === "1" &&
    session &&
    session.state === "MAIN_MENU"
) {

    saveWhatsAppSession(
        senderPhone,
        {
            role: "PATIENT",
            state: "BOOK_DOCTOR"
        }
    );

    sendDoctorSelectionReply(
        ss,
        senderPhone
    );

    return true;
}


// ======================================================
// MAIN MENU → MY APPOINTMENTS
// ======================================================

if (
    normalizedMessage === "2" &&
    session &&
    session.state === "MAIN_MENU"
) {

    const appointments =
        getMyAppointments(
            senderPhone
        ).filter(
            function (appt) {
                return isConfirmedAppointmentStatus(
                    appt.status
                );
            }
        );

    let reply;

    if (
        !appointments ||
        appointments.length === 0
    ) {

        reply =
            buildMainMenuMessage(
                "📋 You have no upcoming appointments."
            );

    } else {

        reply =
            "📋 Your Appointments:\n\n" +
            formatAppointmentsListForWhatsApp(
                appointments
            ) +
            "Reply with:\n\n" +
            "1️⃣ Book Appointment\n" +
            "2️⃣ My Appointments\n" +
            "3️⃣ Cancel Appointment\n" +
            "4️⃣ Reschedule Appointment\n" +
            "5️⃣ Change Language";
    }

    saveWhatsAppSession(
        senderPhone,
        {
            role: "PATIENT",
            state: "MAIN_MENU"
        }
    );

    sendWhatsAppReply(
        ss,
        senderPhone,
        reply
    );

    return true;
}


// ======================================================
// MAIN MENU → CANCEL APPOINTMENT
// ======================================================

if (
    normalizedMessage === "3" &&
    session &&
    session.state === "MAIN_MENU"
) {

    beginWhatsAppCancelFlow(
        ss,
        senderPhone
    );
    return true;
}


// ======================================================
// MAIN MENU → RESCHEDULE APPOINTMENT
// ======================================================

if (
    normalizedMessage === "4" &&
    session &&
    session.state === "MAIN_MENU"
) {

    beginWhatsAppRescheduleFlow(
        ss,
        senderPhone
    );
    return true;
}


// ======================================================
// MAIN MENU → CHANGE LANGUAGE
// ======================================================

if (
    normalizedMessage === "5" &&
    session &&
    session.state === "MAIN_MENU"
) {

    saveWhatsAppSession(
        senderPhone,
        {
            role: "PATIENT",
            state: "LANGUAGE_CHANGE"
        }
    );

    sendWhatsAppReply(
        ss,
        senderPhone,
        buildLanguageSelectionMessage()
    );
    return true;
}


// ======================================================
// MAIN MENU → UNRECOGNIZED OPTION
// ======================================================

if (
    session &&
    session.state === "MAIN_MENU"
) {

    sendWhatsAppReply(
        ss,
        senderPhone,
        buildMainMenuMessage(
            "❌ Invalid option."
        )
    );
    return true;
}


// ======================================================
// BOOK_DOCTOR STATE
// ======================================================

if (
    session &&
    session.state === "BOOK_DOCTOR"
) {

    const doctorNumber =
        Number(messageText.trim());

    const doctors =
        getDoctors();

    const doctor =
        Number.isInteger(doctorNumber) &&
        doctorNumber >= 1 &&
        doctorNumber <= doctors.length
            ? doctors[doctorNumber - 1]
            : null;


    // ======================================================
    // DOCTOR NOT FOUND
    // ======================================================

    if (!doctor) {

        sendWhatsAppMenuReply(
            ss,
            senderPhone,
            "❌ Please choose a valid doctor number.\n\n" +
            "📅 Book Appointment\n\nSelect a doctor:",
            getDoctorSelectionMenuSpec()
        );

    }


    // ======================================================
    // DOCTOR FOUND
    // ======================================================

    else {

        saveWhatsAppSession(
            senderPhone,
            {
                role: "PATIENT",
                state: "BOOK_DATE",
                doctorId:
                    doctor.doctorId
            }
        );


        sendDateMenuReply(
            ss,
            senderPhone,
            "👨‍⚕️ Doctor selected: " +
            doctor.doctorName +
            ".\n\nPlease choose a date:"
        );
    }
}

// ======================================================
// BOOK_DATE STATE
// ======================================================

if (
    session &&
    session.state === "BOOK_DATE"
) {

    handleWhatsAppDateMenuInput(
        ss,
        senderPhone,
        session.doctorId,
        normalizedMessage,
        "BOOK_TIME",
        "BOOK_DATE_CUSTOM",
        false
    );
    return true;
}


// ======================================================
// BOOK_DATE_CUSTOM STATE (manually typed date)
// ======================================================

if (
    session &&
    session.state === "BOOK_DATE_CUSTOM"
) {

    handleWhatsAppCustomDateInput(
        ss,
        senderPhone,
        session.doctorId,
        messageText,
        "BOOK_TIME"
    );
    return true;
}


// ======================================================
// BOOK_NAME STATE (first-time patient name)
// ======================================================

if (
    session &&
    session.state === "BOOK_NAME"
) {

    if (
        !session.doctorId ||
        !session.date ||
        !session.time
    ) {

        sendWhatsAppReply(
            ss,
            senderPhone,
            "❌ Your booking session has expired.\n\n" +
            "Please send Hi to start again."
        );

        return true;
    }

    const enteredName =
        messageText.trim();

    if (!isValidPatientName(enteredName)) {

        sendWhatsAppReply(
            ss,
            senderPhone,
            buildInvalidPatientNameReply()
        );

        return true;
    }

    const language =
        session.language || "EN";

    const registration =
        upsertPatient(
            senderPhone,
            enteredName,
            language,
            { updateLastVisit: false }
        );

    if (!registration.success) {

        sendWhatsAppReply(
            ss,
            senderPhone,
            "❌ " +
            (registration.message ||
                "Unable to save your name.")
        );

        return true;
    }

    saveWhatsAppSession(
        senderPhone,
        {
            state: "BOOK_CONFIRM",
            patientName: enteredName
        }
    );

    sendWhatsAppMenuReply(
        ss,
        senderPhone,
        buildBookingConfirmationMessage(
            session,
            enteredName
        ),
        getBookingConfirmSpec()
    );
    return true;
}


// ======================================================
// BOOK_CONFIRM STATE
// ======================================================

if (
    session &&
    session.state === "BOOK_CONFIRM"
) {

    if (normalizedMessage === "1") {

        if (
            !session.doctorId ||
            !session.date ||
            !session.time
        ) {

            clearWhatsAppSession(
                senderPhone
            );

            sendWhatsAppReply(
                ss,
                senderPhone,
                "❌ Your booking session has expired.\n\n" +
                "Please send Hi to start again."
            );

            return true;
        }

        const patientName =
            resolvePatientNameForBooking(
                senderPhone,
                session,
                senderName
            );

        const bookingResult =
            bookAppointment(
                session.doctorId,
                session.date,
                session.time,
                patientName,
                senderPhone,
                session.language ||
                    resolvePatientLanguage(
                        senderPhone,
                        session
                    )
            );

        if (
            bookingResult &&
            bookingResult.success
        ) {

            saveWhatsAppSession(
                senderPhone,
                {
                    role: "PATIENT",
                    state: "MAIN_MENU",
                    doctorId: "",
                    date: "",
                    time: "",
                    appointmentId:
                        bookingResult.appointmentId
                }
            );

            const reply =
                "✅ Appointment confirmed!\n\n" +
                "🆔 Appointment ID: " +
                bookingResult.appointmentId +
                "\n" +
                "👨‍⚕️ Doctor: " +
                bookingResult.doctor +
                "\n" +
                "📅 Date: " +
                bookingResult.date +
                "\n" +
                "🕐 Time: " +
                bookingResult.time +
                "\n\n" +
                "Thank you for choosing ABC Clinic.";

            sendWhatsAppReply(
                ss,
                senderPhone,
                reply
            );

        } else {

            const errorMessage =
                bookingResult &&
                bookingResult.message
                    ? bookingResult.message
                    : "Unable to book the appointment.";

            sendWhatsAppReply(
                ss,
                senderPhone,
                "❌ " +
                errorMessage +
                "\n\n" +
                "Please choose another time or send Hi to start again."
            );
        }

    } else if (
        normalizedMessage === "2"
    ) {

        if (
            !session.doctorId ||
            !session.date
        ) {

            clearWhatsAppSession(
                senderPhone
            );

            sendWhatsAppReply(
                ss,
                senderPhone,
                "❌ Your booking session has expired.\n\n" +
                "Please send Hi to start again."
            );

            return true;
        }

        const slots =
            getAvailableSlots(
                session.doctorId,
                session.date
            );

        if (
            !slots ||
            slots.length === 0
        ) {

            clearWhatsAppSession(
                senderPhone
            );

            sendWhatsAppReply(
                ss,
                senderPhone,
                "❌ No available slots remain for " +
                session.date +
                ".\n\n" +
                "Please send Hi to start again."
            );

            return true;
        }

        saveWhatsAppSession(
            senderPhone,
            {
                state: "BOOK_TIME",
                time: ""
            }
        );

        let reply =
            "📅 Date: " +
            session.date +
            "\n\n" +
            "Available slots:\n\n";

        for (
            let i = 0;
            i < slots.length;
            i++
        ) {

            reply +=
                (i + 1) +
                "️⃣ " +
                slots[i] +
                "\n";
        }

        reply +=
            "\nPlease choose a time.";

        sendWhatsAppReply(
            ss,
            senderPhone,
            reply
        );

    } else if (
        normalizedMessage === "3"
    ) {

        saveWhatsAppSession(
            senderPhone,
            {
                role: "PATIENT",
                state: "MAIN_MENU",
                doctorId: "",
                date: "",
                time: "",
                appointmentId: ""
            }
        );

        sendWhatsAppReply(
            ss,
            senderPhone,
            "❌ Appointment booking cancelled.\n\n" +
            "Please choose an option:\n\n" +
            "1️⃣ Book Appointment\n" +
            "2️⃣ My Appointments\n" +
            "3️⃣ Cancel Appointment\n" +
            "4️⃣ Reschedule Appointment\n" +
            "5️⃣ Change Language"
        );

    } else {

        sendWhatsAppReply(
            ss,
            senderPhone,
            "❌ Invalid option.\n\n" +
            "Please reply with:\n\n" +
            "1️⃣ Confirm\n" +
            "2️⃣ Choose another time\n" +
            "3️⃣ Cancel"
        );
    }
    return true;
}


// ======================================================
// BOOK_TIME STATE
// ======================================================

if (
    session &&
    session.state === "BOOK_TIME"
) {

    handleWhatsAppBookTimeState(
        ss,
        senderPhone,
        session,
        normalizedMessage
    );
    return true;
}


// ======================================================
// CANCEL_SELECT STATE
// ======================================================

if (
    session &&
    session.state === "CANCEL_SELECT"
) {

    handleWhatsAppCancelSelectState(
        ss,
        senderPhone,
        normalizedMessage
    );
    return true;
}


// ======================================================
// CANCEL_CONFIRM STATE
// ======================================================

if (
    session &&
    session.state === "CANCEL_CONFIRM"
) {

    if (normalizedMessage === "1") {

        const result =
            cancelAppointment(
                session.appointmentId,
                senderPhone
            );

        if (
            result &&
            result.success
        ) {

            saveWhatsAppSession(
                senderPhone,
                {
                    role: "PATIENT",
                    state: "MAIN_MENU",
                    doctorId: "",
                    date: "",
                    time: "",
                    appointmentId: ""
                }
            );

            sendWhatsAppReply(
                ss,
                senderPhone,
                buildMainMenuMessage(
                    "✅ " + result.message
                )
            );

        } else {

            const errorMessage =
                result && result.message
                    ? result.message
                    : "Unable to cancel the appointment.";

            sendWhatsAppReply(
                ss,
                senderPhone,
                "❌ " + errorMessage + "\n\n" +
                "1️⃣ Yes, cancel it\n" +
                "2️⃣ No, go back"
            );
        }

    } else if (normalizedMessage === "2") {

        saveWhatsAppSession(
            senderPhone,
            {
                role: "PATIENT",
                state: "MAIN_MENU",
                doctorId: "",
                date: "",
                time: "",
                appointmentId: ""
            }
        );

        sendWhatsAppReply(
            ss,
            senderPhone,
            buildMainMenuMessage(
                "👍 Okay, appointment was not cancelled."
            )
        );

    } else {

        sendWhatsAppReply(
            ss,
            senderPhone,
            "❌ Invalid option.\n\n" +
            "1️⃣ Yes, cancel it\n" +
            "2️⃣ No, go back"
        );
    }
    return true;
}


// ======================================================
// RESCHEDULE_SELECT STATE
// ======================================================

if (
    session &&
    session.state === "RESCHEDULE_SELECT"
) {

    handleWhatsAppRescheduleSelectState(
        ss,
        senderPhone,
        normalizedMessage
    );
    return true;
}


// ======================================================
// RESCHEDULE_DATE STATE
// ======================================================

if (
    session &&
    session.state === "RESCHEDULE_DATE"
) {

    handleWhatsAppDateMenuInput(
        ss,
        senderPhone,
        session.doctorId,
        normalizedMessage,
        "RESCHEDULE_TIME",
        "RESCHEDULE_DATE_CUSTOM",
        true
    );
    return true;
}


// ======================================================
// RESCHEDULE_DATE_CUSTOM STATE (manually typed date)
// ======================================================

if (
    session &&
    session.state === "RESCHEDULE_DATE_CUSTOM"
) {

    handleWhatsAppCustomDateInput(
        ss,
        senderPhone,
        session.doctorId,
        messageText,
        "RESCHEDULE_TIME"
    );
    return true;
}


// ======================================================
// RESCHEDULE_TIME STATE
// ======================================================

if (
    session &&
    session.state === "RESCHEDULE_TIME"
) {

    handleWhatsAppRescheduleTimeState(
        ss,
        senderPhone,
        session,
        normalizedMessage
    );
    return true;
}


// ======================================================
// RESCHEDULE_CONFIRM STATE
// ======================================================

if (
    session &&
    session.state === "RESCHEDULE_CONFIRM"
) {

    if (normalizedMessage === "1") {

        if (
            !session.appointmentId ||
            !session.date ||
            !session.time
        ) {

            clearWhatsAppSession(
                senderPhone
            );

            sendWhatsAppReply(
                ss,
                senderPhone,
                "❌ Your reschedule session has expired.\n\n" +
                "Please send Hi to start again."
            );

            return true;
        }

        const result =
            rescheduleAppointment(
                session.appointmentId,
                senderPhone,
                session.date,
                session.time
            );

        if (
            result &&
            result.success
        ) {

            saveWhatsAppSession(
                senderPhone,
                {
                    role: "PATIENT",
                    state: "MAIN_MENU",
                    doctorId: "",
                    date: "",
                    time: "",
                    appointmentId:
                        result.appointmentId
                }
            );

            const reply =
                "✅ Appointment rescheduled!\n\n" +
                "🆔 Appointment ID: " +
                result.appointmentId +
                "\n" +
                "👨‍⚕️ Doctor: " +
                result.doctor +
                "\n" +
                "📅 New Date: " +
                result.date +
                "\n" +
                "🕐 New Time: " +
                result.time +
                "\n\n" +
                "Thank you for choosing ABC Clinic.";

            sendWhatsAppReply(
                ss,
                senderPhone,
                reply
            );

        } else {

            const errorMessage =
                result && result.message
                    ? result.message
                    : "Unable to reschedule the appointment.";

            sendWhatsAppReply(
                ss,
                senderPhone,
                "❌ " + errorMessage + "\n\n" +
                "Please reply with:\n\n" +
                "1️⃣ Confirm\n" +
                "2️⃣ Choose another time\n" +
                "3️⃣ Cancel"
            );
        }

    } else if (
        normalizedMessage === "2"
    ) {

        if (
            !session.doctorId ||
            !session.date
        ) {

            clearWhatsAppSession(
                senderPhone
            );

            sendWhatsAppReply(
                ss,
                senderPhone,
                "❌ Your reschedule session has expired.\n\n" +
                "Please send Hi to start again."
            );

            return true;
        }

        whatsAppShowSlotsForDate(
            ss,
            senderPhone,
            session.doctorId,
            session.date,
            "RESCHEDULE_TIME"
        );

    } else if (
        normalizedMessage === "3"
    ) {

        saveWhatsAppSession(
            senderPhone,
            {
                role: "PATIENT",
                state: "MAIN_MENU",
                doctorId: "",
                date: "",
                time: "",
                appointmentId: ""
            }
        );

        sendWhatsAppReply(
            ss,
            senderPhone,
            buildMainMenuMessage(
                "❌ Reschedule cancelled."
            )
        );

    } else {

        sendWhatsAppReply(
            ss,
            senderPhone,
            "❌ Invalid option.\n\n" +
            "Please reply with:\n\n" +
            "1️⃣ Confirm\n" +
            "2️⃣ Choose another time\n" +
            "3️⃣ Cancel"
        );
    }
    return true;
}


// ======================================================

    return false;
}

function processWhatsAppTextMessage(
    ss,
    senderPhone,
    senderName,
    messageText
) {

    const normalizedMessage =
        messageText
            .toLowerCase()
            .trim();

    const session =
        getWhatsAppSession(senderPhone);

    if (
        handleAfterHoursPatientGate(
            ss,
            senderPhone,
            session
        )
    ) {
        return;
    }

    if (
        handleWhatsAppGreeting(
            ss,
            senderPhone,
            session,
            normalizedMessage
        )
    ) {
        return;
    }

    if (
        handleWhatsAppUniversalNavigation(
            ss,
            senderPhone,
            session,
            normalizedMessage
        )
    ) {
        return;
    }

    if (
        handleWhatsAppDoctorMessage(
            ss,
            senderPhone,
            senderName,
            messageText,
            normalizedMessage,
            session
        )
    ) {
        return;
    }

    if (
        handleWhatsAppPatientMessage(
            ss,
            senderPhone,
            senderName,
            messageText,
            normalizedMessage,
            session
        )
    ) {
        return;
    }

// FALLBACK - unrecognized message / no active session
// ======================================================

if (
    session &&
    session.role === "DOCTOR"
) {

    const doctorId =
        resolveDoctorIdFromSession(
            senderPhone,
            session
        );

    returnDoctorToMenu(
        ss,
        senderPhone,
        doctorId,
        "🤔 Sorry, I didn't understand that."
    );
}

else {

    sendWhatsAppReply(
        ss,
        senderPhone,
        "🤔 Sorry, I didn't understand that.\n\n" +
        "Please send Hi to start."
    );
}



}

function doPost(e) {

    let messageId = "";
    let processingStarted = false;

    try {

        if (
            !e ||
            !e.postData ||
            !e.postData.contents
        ) {
            return webhookOkResponse();
        }

        const rawBody =
            e.postData.contents;

        if (
            !verifyWhatsAppWebhookRequest(
                e,
                rawBody
            )
        ) {
            Logger.log(
                "Rejected WhatsApp webhook request."
            );
            return webhookOkResponse();
        }

        const body =
            JSON.parse(rawBody);

        const value =
            body &&
            body.entry &&
            body.entry[0] &&
            body.entry[0].changes &&
            body.entry[0].changes[0] &&
            body.entry[0].changes[0].value
                ? body.entry[0].changes[0].value
                : null;

        const message =
            value &&
            value.messages &&
            value.messages[0];

        // Ignore non-message webhook events
        if (!message) {

            return webhookOkResponse();
        }

        messageId =
            String(message.id || "");

        if (
            messageId &&
            !tryBeginWhatsAppMessageProcessing(
                messageId
            )
        ) {
            return webhookOkResponse();
        }

        processingStarted = !!messageId;

        const senderPhone =
            String(message.from);

        const inbound =
            extractInboundWhatsAppMessage(
                message
            );

        const messageType =
            inbound.type ||
            String(message.type);

        const messageText =
            inbound.text || "";


        // ========================================================
        // GOOGLE SHEET
        // ========================================================

        const ss =
            SpreadsheetApp
                .getActiveSpreadsheet();


        // ========================================================
        // LOG INCOMING MESSAGE
        // ========================================================

        const senderName =
            value.contacts &&
                value.contacts[0] &&
                value.contacts[0].profile
                ? value.contacts[0].profile.name
                : "";

        const phoneNumberId =
            value.metadata
                ? value.metadata.phone_number_id
                : "";

        appendInboundWhatsAppLog(
            ss,
            {
                phone: senderPhone,
                name: senderName,
                type: messageType,
                message: messageText,
                phoneNumberId: phoneNumberId
            }
        );


        // ========================================================
        // WHATSAPP CONVERSATION
        // ========================================================

        if (messageText) {

            setWhatsAppInboundMessageContext(
                messageId
            );

            try {

                processWhatsAppTextMessage(
                    ss,
                    senderPhone,
                    senderName,
                    messageText
                );

            } finally {

                clearWhatsAppInboundMessageContext();
            }
        }


        finishWhatsAppMessageProcessing(
            messageId,
            true
        );
        processingStarted = false;

        return webhookOkResponse();


    } catch (error) {

        if (processingStarted && messageId) {
            clearWhatsAppMessageProcessing(
                messageId
            );
        }
        processingStarted = false;

        Logger.log(
            "Webhook error: " +
            error.message
        );

        Logger.log(
            error.stack
        );

        try {

            const ss =
                SpreadsheetApp
                    .getActiveSpreadsheet();

            let debugSheet =
                ss.getSheetByName(
                    "WhatsApp_Debug"
                );

            if (!debugSheet) {

                debugSheet =
                    ss.insertSheet(
                        "WhatsApp_Debug"
                    );

                debugSheet.appendRow([
                    "Timestamp",
                    "Direction",
                    "Phone",
                    "Status",
                    "Response"
                ]);
            }

            debugSheet.appendRow([
                new Date(),
                "WEBHOOK",
                "",
                "ERROR",
                error.message +
                "\n" +
                error.stack
            ]);

        } catch (debugError) {

            Logger.log(
                "Could not write debug error: " +
                debugError.message
            );
        }

        return ContentService
            .createTextOutput(
                "ERROR"
            )
            .setMimeType(
                ContentService.MimeType.TEXT
            );
    }
}


function getWhatsAppOutboundCacheKey(messageId) {

    return WA_OUTBOUND_PREFIX + messageId;
}


function hasWhatsAppOutboundBeenSent(messageId) {

    if (!messageId) {
        return false;
    }

    return !!CacheService.getScriptCache().get(
        getWhatsAppOutboundCacheKey(messageId)
    );
}


function markWhatsAppOutboundSent(messageId) {

    if (!messageId) {
        return;
    }

    CacheService.getScriptCache().put(
        getWhatsAppOutboundCacheKey(messageId),
        "1",
        21600
    );
}


function setWhatsAppInboundMessageContext(messageId) {

    CacheService.getScriptCache().put(
        WA_CURRENT_MESSAGE_ID_KEY,
        String(messageId || ""),
        300
    );
}


function getWhatsAppInboundMessageId() {

    return (
        CacheService.getScriptCache().get(
            WA_CURRENT_MESSAGE_ID_KEY
        ) || ""
    );
}


function clearWhatsAppInboundMessageContext() {

    CacheService.getScriptCache().remove(
        WA_CURRENT_MESSAGE_ID_KEY
    );
}


function isWhatsAppMessageProcessed(messageId) {

    if (!messageId) {
        return false;
    }

    const cache =
        CacheService.getScriptCache();

    const key =
        "WA_PROCESSED_" + messageId;

    return !!cache.get(key);
}

function markWhatsAppMessageProcessed(messageId) {

    if (!messageId) {
        return;
    }

    const cache =
        CacheService.getScriptCache();

    const key =
        "WA_PROCESSED_" + messageId;

    cache.put(
        key,
        "1",
        21600
    );
}

function isWhatsAppMessageProcessing(messageId) {

    if (!messageId) {
        return false;
    }

    return !!CacheService.getScriptCache().get(
        "WA_PROCESSING_" + messageId
    );
}

function tryBeginWhatsAppMessageProcessing(messageId) {

    if (!messageId) {
        return true;
    }

    if (isWhatsAppMessageProcessed(messageId)) {
        return false;
    }

    if (hasWhatsAppOutboundBeenSent(messageId)) {
        return false;
    }

    const lock =
        LockService.getScriptLock();

    try {

        if (!lock.tryLock(5000)) {
            return false;
        }

        if (isWhatsAppMessageProcessed(messageId)) {
            return false;
        }

        if (hasWhatsAppOutboundBeenSent(messageId)) {
            return false;
        }

        if (isWhatsAppMessageProcessing(messageId)) {
            return false;
        }

        CacheService.getScriptCache().put(
            "WA_PROCESSING_" + messageId,
            "1",
            300
        );

        return true;

    } finally {
        lock.releaseLock();
    }
}

function clearWhatsAppMessageProcessing(messageId) {

    if (!messageId) {
        return;
    }

    CacheService.getScriptCache().remove(
        "WA_PROCESSING_" + messageId
    );
}

function finishWhatsAppMessageProcessing(
    messageId,
    success
) {

    if (!messageId) {
        return;
    }

    clearWhatsAppMessageProcessing(messageId);

    if (success) {
        markWhatsAppMessageProcessed(messageId);
    }
}


function sendWhatsAppGraphPayload(to, payload) {

    if (shouldSkipOutboundWhatsApp()) {
        return {
            skipped: true,
            to: to,
            payload: payload
        };
    }

    const properties =
        PropertiesService.getScriptProperties();

    const accessToken =
        properties.getProperty(
            "WHATSAPP_ACCESS_TOKEN"
        );

    const phoneNumberId =
        properties.getProperty(
            "WHATSAPP_PHONE_NUMBER_ID"
        );

    if (!accessToken) {
        throw new Error(
            "WHATSAPP_ACCESS_TOKEN is missing."
        );
    }

    if (!phoneNumberId) {
        throw new Error(
            "WHATSAPP_PHONE_NUMBER_ID is missing."
        );
    }

    const url =
        "https://graph.facebook.com/v26.0/" +
        phoneNumberId +
        "/messages";

    const response =
        UrlFetchApp.fetch(
            url,
            {
                method: "post",
                contentType: "application/json",
                headers: {
                    Authorization:
                        "Bearer " + accessToken
                },
                payload: JSON.stringify(payload),
                muteHttpExceptions: true
            }
        );

    const responseCode =
        response.getResponseCode();

    const responseBody =
        response.getContentText();

    if (
        responseCode < 200 ||
        responseCode >= 300
    ) {
        throw new Error(
            "WhatsApp API error: " +
            responseBody
        );
    }

    return JSON.parse(responseBody);
}


function sendWhatsAppInteractiveMessage(
    to,
    bodyText,
    spec
) {

    let interactive = null;

    if (spec.type === "list") {

        interactive = {
            type: "list",
            body: {
                text: String(bodyText)
            },
            action: {
                button: spec.buttonLabel,
                sections: spec.sections
            }
        };

    } else if (spec.type === "button") {

        interactive = {
            type: "button",
            body: {
                text: String(bodyText)
            },
            action: {
                buttons: spec.buttons.map(
                    function (button) {
                        return {
                            type: "reply",
                            reply: {
                                id: button.id,
                                title: button.title
                            }
                        };
                    }
                )
            }
        };
    }

    if (!interactive) {
        throw new Error(
            "Invalid interactive menu spec."
        );
    }

    return sendWhatsAppGraphPayload(
        to,
        {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: String(to),
            type: "interactive",
            interactive: interactive
        }
    );
}


function sendWhatsAppMenuReply(
    ss,
    phone,
    bodyText,
    menuSpec
) {

    try {

        const session =
            getWhatsAppSession(phone);

        const language =
            resolvePatientLanguage(
                phone,
                session
            );

        let localizedBody =
            localizeWhatsAppReply(
                language,
                String(bodyText || "")
            );

        localizedBody =
            addWhatsAppNavigationOptions(
                session,
                localizedBody
            );

        const inboundMessageId =
            getWhatsAppInboundMessageId();

        if (
            inboundMessageId &&
            hasWhatsAppOutboundBeenSent(
                inboundMessageId
            )
        ) {
            return {
                skipped: true,
                reason: "duplicate_outbound",
                messageId: inboundMessageId,
                to: phone
            };
        }

        let sendResult = null;
        let outboundLog =
            localizedBody;

        if (
            interactiveMenusEnabled() &&
            menuSpec &&
            menuSpec.interactive
        ) {

            try {

                sendResult =
                    sendWhatsAppInteractiveMessage(
                        phone,
                        localizedBody,
                        menuSpec.interactive
                    );

                outboundLog =
                    "[interactive:" +
                    menuSpec.interactive.type +
                    "] " +
                    localizedBody;

            } catch (interactiveError) {

                Logger.log(
                    "Interactive menu failed; using text fallback: " +
                    interactiveError.message
                );

                sendResult = null;
            }
        }

        if (!sendResult) {

            const fallbackText =
                menuSpec &&
                menuSpec.fallbackText
                    ? localizedBody +
                    "\n\n" +
                    menuSpec.fallbackText
                    : localizedBody;

            sendResult =
                sendWhatsAppText(
                    phone,
                    fallbackText
                );

            outboundLog = fallbackText;
        }

        if (
            inboundMessageId &&
            sendResult &&
            !sendResult.skipped
        ) {
            markWhatsAppOutboundSent(
                inboundMessageId
            );
        }

        appendWhatsAppDebugLog(
            ss,
            {
                direction: "OUTBOUND",
                phone: phone,
                status: "SUCCESS",
                response: outboundLog
            }
        );

        return sendResult;

    } catch (error) {

        appendWhatsAppDebugLog(
            ss,
            {
                direction: "OUTBOUND",
                phone: phone,
                status: "ERROR",
                response: error.message
            }
        );

        throw error;
    }
}


function sendPatientMainMenuReply(
    ss,
    phone,
    prefix
) {

    const body =
        String(prefix || "👋 Welcome to ABC Clinic!") +
        "\n\nPlease choose an option:";

    sendWhatsAppMenuReply(
        ss,
        phone,
        body,
        getPatientMainMenuSpec()
    );
}


function sendDoctorMainMenuReply(
    ss,
    phone,
    doctorId,
    prefix
) {

    const doctorName =
        findDoctorById(doctorId) || "";

    const body =
        (prefix
            ? String(prefix) + "\n\n"
            : "") +
        "👨‍⚕️ Doctor Portal" +
        (doctorName
            ? " — " + doctorName
            : "") +
        "\n\nPlease choose an option:";

    sendWhatsAppMenuReply(
        ss,
        phone,
        body,
        getDoctorMainMenuSpec()
    );
}


function sendLanguageMenuReply(ss, phone) {

    sendWhatsAppMenuReply(
        ss,
        phone,
        buildLanguageSelectionMessage(),
        getLanguageMenuSpec()
    );
}


function sendDateMenuReply(ss, phone, introText) {

    sendWhatsAppMenuReply(
        ss,
        phone,
        buildDateMenuPrompt(introText),
        getDateMenuSpec()
    );
}


function sendDoctorSelectionReply(ss, phone) {

    const doctors = getDoctors();

    if (doctors.length === 0) {

        sendWhatsAppReply(
            ss,
            phone,
            "❌ No doctors are currently available."
        );

        return;
    }

    const menuSpec =
        getDoctorSelectionMenuSpec();

    sendWhatsAppMenuReply(
        ss,
        phone,
        "📅 Book Appointment\n\nSelect a doctor:",
        menuSpec
    );
}


function sendWhatsAppReply(
    ss,
    phone,
    reply
) {

    try {

        const session =
            getWhatsAppSession(phone);

        const language =
            resolvePatientLanguage(
                phone,
                session
            );

        const replyWithNavigation =
            addWhatsAppNavigationOptions(
                session,
                reply
            );

        const localizedReply =
            localizeWhatsAppReply(
                language,
                replyWithNavigation
            );

        const inboundMessageId =
            getWhatsAppInboundMessageId();

        if (
            inboundMessageId &&
            hasWhatsAppOutboundBeenSent(
                inboundMessageId
            )
        ) {

            return {
                skipped: true,
                reason: "duplicate_outbound",
                messageId: inboundMessageId,
                to: phone
            };
        }

        const sendResult =
            sendWhatsAppText(
                phone,
                localizedReply
            );

        if (
            inboundMessageId &&
            sendResult &&
            !sendResult.skipped
        ) {
            markWhatsAppOutboundSent(
                inboundMessageId
            );
        }


        appendWhatsAppDebugLog(
            ss,
            {
                direction: "OUTBOUND",
                phone: phone,
                status: "SUCCESS",
                response: JSON.stringify(
                    sendResult
                )
            }
        );

        return sendResult;

    } catch (error) {

        appendWhatsAppDebugLog(
            ss,
            {
                direction: "OUTBOUND",
                phone: phone,
                status: "ERROR",
                response: error.message
            }
        );

        throw error;
    }
}

function sendWhatsAppText(to, messageText) {

    if (shouldSkipOutboundWhatsApp()) {
        return {
            skipped: true,
            to: to,
            message: messageText
        };
    }

    return sendWhatsAppGraphPayload(
        to,
        {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: String(to),
            type: "text",
            text: {
                preview_url: false,
                body: String(messageText)
            }
        }
    );
}


function sendWhatsAppTemplate(to) {

    const properties =
        PropertiesService.getScriptProperties();

    const accessToken =
        properties.getProperty(
            "WHATSAPP_ACCESS_TOKEN"
        );

    const phoneNumberId =
        properties.getProperty(
            "WHATSAPP_PHONE_NUMBER_ID"
        );

    const url =
        "https://graph.facebook.com/v26.0/" +
        phoneNumberId +
        "/messages";

    const payload = {

        messaging_product:
            "whatsapp",

        to:
            String(to),

        type:
            "template",

        template: {

            name:
                "hello_world",

            language: {
                code: "en_US"
            }

        }
    };

    const response =
        UrlFetchApp.fetch(
            url,
            {
                method: "post",

                contentType:
                    "application/json",

                headers: {
                    Authorization:
                        "Bearer " +
                        accessToken
                },

                payload:
                    JSON.stringify(payload),

                muteHttpExceptions:
                    true
            }
        );

    const code =
        response.getResponseCode();

    const body =
        response.getContentText();

    Logger.log(
        "HTTP: " + code
    );

    Logger.log(
        body
    );

    if (
        code < 200 ||
        code >= 300
    ) {
        throw new Error(
            "WhatsApp API error: " +
            body
        );
    }

    return JSON.parse(body);
}


function getWhatsAppSession(phone) {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("WhatsApp_Sessions");

    if (!sheet) {
        throw new Error(
            "WhatsApp_Sessions sheet not found."
        );
    }

    const range =
        sheet.getDataRange();

    const data =
        range.getValues();

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        if (
            !phonesMatch(
                data[i][0],
                phone
            )
        ) {
            continue;
        }

        // ----------------------------------------------------------
        // IMPORTANT:
        // Google Sheets may automatically convert:
        //   "2026-08-18" -> Date object
        //   "10:00 AM"  -> Date object
        //
        // Never use String(Date) for these fields because it produces
        // values such as:
        //   "Tue Aug 18 2026 00:00:00 GMT+0530..."
        //
        // Normalize them back to the values used by the application.
        // ----------------------------------------------------------

        let sessionDate = "";

        if (
            data[i][4] instanceof Date &&
            !isNaN(data[i][4].getTime())
        ) {

            sessionDate =
                Utilities.formatDate(
                    data[i][4],
                    TIMEZONE,
                    "yyyy-MM-dd"
                );

        } else {

            sessionDate =
                String(data[i][4] || "").trim();
        }

        let sessionTime = "";

        if (
            data[i][5] instanceof Date &&
            !isNaN(data[i][5].getTime())
        ) {

            sessionTime =
                Utilities.formatDate(
                    data[i][5],
                    TIMEZONE,
                    "hh:mm a"
                );

        } else {

            sessionTime =
                String(data[i][5] || "").trim();
        }

        return {

            row:
                i + 1,

            phone:
                String(data[i][0]).trim(),

            role:
                String(data[i][1] || "").trim(),

            state:
                String(data[i][2] || "").trim(),

            doctorId:
                String(data[i][3] || "").trim(),

            date:
                sessionDate,

            time:
                sessionTime,

            appointmentId:
                String(data[i][6] || "").trim(),

            updatedAt:
                data[i][7],

            language:
                String(data[i][8] || "")
                    .trim()
                    .toUpperCase(),

            patientName:
                String(data[i][9] || "").trim()
        };
    }

    return null;
}


function ensureWhatsAppSessionLanguageColumn(sheet) {

    if (!sheet.getRange(1, 9).getValue()) {
        sheet
            .getRange(1, 9)
            .setValue("Language");
    }
}

function ensureWhatsAppSessionPatientNameColumn(sheet) {

    if (!sheet.getRange(1, 10).getValue()) {
        sheet
            .getRange(1, 10)
            .setValue("Patient Name");
    }
}


function saveWhatsAppSession(
    phone,
    updates
) {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName(
            "WhatsApp_Sessions"
        );

    if (!sheet) {
        throw new Error(
            "WhatsApp_Sessions sheet not found."
        );
    }

    ensureWhatsAppSessionLanguageColumn(sheet);
    ensureWhatsAppSessionPatientNameColumn(sheet);

    const existing =
        getWhatsAppSession(phone);

    const now =
        new Date();

    if (existing) {

        const row =
            existing.row;

        const current =
            sheet
                .getRange(row, 1, 1, 10)
                .getValues()[0];

        sheet
            .getRange(row, 1, 1, 10)
            .setValues([[
                phone,

                updates.role !== undefined
                    ? updates.role
                    : current[1],

                updates.state !== undefined
                    ? updates.state
                    : current[2],

                updates.doctorId !== undefined
                    ? updates.doctorId
                    : current[3],

                updates.date !== undefined
                    ? updates.date
                    : current[4],

                updates.time !== undefined
                    ? updates.time
                    : current[5],

                updates.appointmentId !== undefined
                    ? updates.appointmentId
                    : current[6],

                now,

                updates.language !== undefined
                    ? updates.language
                    : current[8],

                updates.patientName !== undefined
                    ? updates.patientName
                    : current[9]
            ]]);

    } else {

        sheet.appendRow([
            phone,
            updates.role || "",
            updates.state || "",
            updates.doctorId || "",
            updates.date || "",
            updates.time || "",
            updates.appointmentId || "",
            now,
            updates.language || "EN",
            updates.patientName || ""
        ]);
    }
}

function clearWhatsAppSession(phone) {

    const session =
        getWhatsAppSession(phone);

    if (!session) {
        return;
    }

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName(
            "WhatsApp_Sessions"
        );

    sheet
        .getRange(
            session.row,
            2,
            1,
            7
        )
        .clearContent();
}


function findDoctorById(doctorId) {

    const doctor =
        getDoctorRecord(doctorId);

    return doctor
        ? doctor.doctorName
        : null;
}


function findDoctorByName(doctorName) {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Doctors");

    if (!sheet) {
        throw new Error(
            "Doctors sheet not found."
        );
    }

    const data =
        sheet.getDataRange().getValues();

    const searchName =
        String(doctorName)
            .trim()
            .toLowerCase();

    for (let i = 1; i < data.length; i++) {

        const doctorId =
            String(data[i][0]).trim();

        const name =
            String(data[i][1]).trim();

        if (
            name.toLowerCase() ===
            searchName
        ) {

            return {
                doctorId: doctorId,
                doctorName: name,
                clinicName:
                    String(data[i][2]).trim()
            };
        }
    }

    return null;
}