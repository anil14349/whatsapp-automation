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
//   WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID (required)
//   WHATSAPP_VERIFY_TOKEN, WHATSAPP_WEBHOOK_POST_TOKEN (required — webhook
//     verification now fails closed if either is unset; there is no
//     hardcoded fallback token)
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


// States that allow plain text input (for names, dates, search, reasons, etc.)
// All other states should reject text input and require interactive options
const TEXT_INPUT_ALLOWED_STATES = [
    // ========== Patient Booking ==========
    "BOOK_NAME",                           // Patient name entry
    "DATE_CUSTOM",                         // Custom appointment date
    "HOME_COLLECTION_DATE_CUSTOM",         // Home collection custom date

    // ========== Doctor Management ==========
    "DOCTOR_DATE_CUSTOM",                  // Custom appointment date (doctor)
    "DOCTOR_LEAVE_REASON",                 // Leave reason text
    "DOCTOR_LEAVE_RANGE_REASON",           // Leave reason for date range

    // ========== Search & Lookup ==========
    "DOCTOR_SEARCH",                       // Search doctor by name
    "SEARCH_APPOINTMENTS_BY_PHONE",        // Search by patient phone
    "SEARCH_APPOINTMENTS_BY_ID"            // Search by appointment ID
];


// Protected booking states that prevent navigation away without completing the flow
// Users cannot press 0 (main menu), 9 (back), or change language in these states
const PROTECTED_BOOKING_STATES = [
    // ========== Patient Booking ==========
    "BOOK_DOCTOR",                         // Selecting doctor
    "BOOK_DATE",                           // Selecting appointment date
    "BOOK_TIME",                           // Selecting time slot
    "BOOK_CONFIRM",                        // Confirming appointment details
    "BOOK_NAME",                           // Entering patient name

    // ========== Home Sample Collection ==========
    "HOME_COLLECTION_LOCATION",            // Sharing location
    "HOME_COLLECTION_DATE",                // Selecting collection date
    "HOME_COLLECTION_TIME",                // Selecting time window

    // ========== Patient Reschedule ==========
    "RESCHEDULE_DATE",                     // Selecting new date
    "RESCHEDULE_TIME",                     // Selecting new time
    "RESCHEDULE_CONFIRM",                  // Confirming reschedule

    // ========== Patient Cancel ==========
    "CANCEL_SELECT",                       // Selecting appointment to cancel
    "CANCEL_CONFIRM",                      // Confirming cancellation

    // ========== Doctor Booking & Management ==========
    "DOCTOR_LEAVE_REASON",                 // Entering leave reason
    "DOCTOR_LEAVE_RANGE_REASON",           // Entering leave reason for date range
    "DOCTOR_AVAIL_CONFIRM",                // Confirming availability
    "DOCTOR_AVAIL_START",                  // Setting availability start
    "DOCTOR_AVAIL_END",                    // Setting availability end
    "DOCTOR_RESCHEDULE_DATE",              // Doctor selecting reschedule date
    "DOCTOR_RESCHEDULE_TIME",              // Doctor selecting reschedule time
    "DOCTOR_RESCHEDULE_CONFIRM",           // Doctor confirming reschedule
    "DOCTOR_CANCEL_CONFIRM",               // Doctor confirming cancellation
    "DOCTOR_STATUS_ACTION"                 // Doctor marking visit status
];


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

    // WhatsApp's native "Share Location" attachment — used by the home
    // blood-sample-collection flow to check the patient is within the
    // configured radius of the hospital. Carries no text body, so
    // downstream code must key off latitude/longitude, not messageText.
    if (
        messageType === "location" &&
        message.location &&
        message.location.latitude !== undefined &&
        message.location.longitude !== undefined
    ) {

        return {
            type: "location",
            text: "",
            latitude: Number(message.location.latitude),
            longitude: Number(message.location.longitude)
        };
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


// Convention for any menu with more real options than fit in 3 buttons:
// show the 2 most important options directly, and use the 3rd button as
// a "More" pivot (id "menu_more"/"menu_more_<tier>") into a follow-up
// screen holding the rest — never silently drop an option. See
// getPatientMainMenuSpec/getPatientMainMoreMenuSpec and
// getDoctorMainMenuSpec/getDoctorMainMenuMoreSpec (tiers 1-3) for the
// reference implementation. Only the final tier, with 2 or fewer options
// left, should skip "More" and use its free 3rd slot for the persistent
// nav button instead (see getDoctorMainMenuMoreSpec's tier-4 branch).
// If a menu legitimately needs more than 10 total options, switch to
// buildInteractiveListSpec instead (10-row cap) — see getLanguageMenuSpec.
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
        "3️⃣ More (Cancel / Reschedule / Language)";

    const interactive =
        buildInteractiveButtonSpec([
            {
                id: "1",
                title: "Book Appointment"
            },
            {
                id: "2",
                title: "My Appointments"
            },
            {
                id: "menu_more",
                title: "More"
            }
        ]);

    return {
        fallbackText: fallbackText,
        interactive: interactive
    };
}


function getDoctorMainMenuSpec() {

    const fallbackText =
        "1️⃣ Today's Schedule\n" +
        "2️⃣ Next Appointment\n" +
        "3️⃣ More (schedule / availability / patients…)";

    const interactive =
        buildInteractiveButtonSpec([
            {
                id: "1",
                title: "Today's Schedule"
            },
            {
                id: "2",
                title: "Next Appointment"
            },
            {
                id: "menu_more",
                title: "More"
            }
        ]);

    return {
        fallbackText: fallbackText,
        interactive: interactive
    };
}


function getLanguageMenuSpec() {

    // 6 languages exceeds WhatsApp's 3-button interactive limit, so this
    // uses a list menu (10-row limit) instead of buildInteractiveButtonSpec.
    const fallbackText =
        "1️⃣ English\n" +
        "2️⃣ తెలుగు\n" +
        "3️⃣ हिन्दी\n" +
        "4️⃣ ಕನ್ನಡ\n" +
        "5️⃣ தமிழ்\n" +
        "6️⃣ മലയാളം";

    const interactive =
        buildInteractiveListSpec(
            [
                { id: "1", title: "English", description: "English" },
                { id: "2", title: "Telugu", description: "తెలుగు" },
                { id: "3", title: "Hindi", description: "हिन्दी" },
                { id: "4", title: "Kannada", description: "ಕನ್ನಡ" },
                { id: "5", title: "Tamil", description: "தமிழ்" },
                { id: "6", title: "Malayalam", description: "മലയാളം" }
            ],
            "Choose language"
        );

    return {
        fallbackText: fallbackText,
        interactive: interactive
    };
}


function getDateMenuSpec(mode) {

    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayFormatted =
        Utilities.formatDate(today, TIMEZONE, "MMM dd, yyyy");
    const tomorrowFormatted =
        Utilities.formatDate(tomorrow, TIMEZONE, "MMM dd, yyyy");

    const fallbackText =
        "1️⃣ Today\n" +
        "2️⃣ Tomorrow\n" +
        "3️⃣ Enter another date";

    const rows = [
        {
            id: "date_today",
            title: "Today",
            description: todayFormatted
        },
        {
            id: "date_tomorrow",
            title: "Tomorrow",
            description: tomorrowFormatted
        },
        {
            id: "date_custom",
            title: "Other date",
            description: "Enter custom date in YYYY-MM-DD"
        }
    ];

    appendWhatsAppHomeNavRow(
        rows,
        mode
    );

    const interactive =
        buildInteractiveListSpec(
            rows,
            "Choose"
        );

    return {
        fallbackText: fallbackText,
        interactive: interactive
    };
}


function getDoctorSelectionMenuSpec(page) {

    const doctors = getDoctors();

    const total =
        doctors.length;

    if (total === 0) {
        return null;
    }

    const fallbackText =
        buildDoctorSelectionFallbackText(
            doctors
        );

    // More than 9 doctors no longer means falling back to a plain
    // numbered text list — paginate the same way the slot picker and
    // appointment list already do, reusing their generic page-bounds
    // math (it only cares about a count, not what the items are).
    const pageInfo =
        getSlotSelectionPageInfo(
            total,
            page || 0
        );

    const visibleDoctors =
        doctors.slice(
            pageInfo.start,
            pageInfo.end
        );

    const rows =
        visibleDoctors.map(
            function (doctor) {

                const description =
                    [
                        doctor.specialization,
                        doctor.clinicName
                    ]
                        .filter(Boolean)
                        .join(" — ");

                return {
                    // Use the real Doctor ID in the WhatsApp list so every
                    // doctor maps directly to the correct Doctors-sheet row.
                    // encodeURIComponent keeps spaces/special characters safe.
                    id:
                        "doctor_select_" +
                        encodeURIComponent(
                            String(doctor.doctorId)
                        ),
                    title: doctor.doctorName,
                    description: description
                };
            }
        );

    if (pageInfo.hasPrev) {

        rows.push({
            id: "doctor_prev",
            title: "Earlier doctors",
            description: "Previous page"
        });
    }

    if (pageInfo.hasNext) {

        rows.push({
            id: "doctor_next",
            title: "More doctors",
            description: "Next page"
        });
    }

    appendWhatsAppHomeNavRow(
        rows,
        "patient"
    );

    const interactive =
        buildInteractiveListSpec(
            rows,
            "Select doctor"
        );

    return {
        fallbackText: fallbackText,
        interactive: interactive,
        page: pageInfo.page,
        totalPages: pageInfo.totalPages,
        hasPrev: pageInfo.hasPrev,
        hasNext: pageInfo.hasNext
    };
}


function getSlotSelectionPageInfo(
    totalSlots,
    page
) {

    const total =
        Number(totalSlots) || 0;

    let safePage =
        Number(page) || 0;

    if (safePage < 0) {
        safePage = 0;
    }

    if (total <= 9) {

        return {
            start: 0,
            end: total,
            hasPrev: false,
            hasNext: false,
            page: 0,
            totalPages: 1
        };
    }

    const lastPage =
        getLastSlotSelectionPage(total);

    if (safePage > lastPage) {
        safePage = lastPage;
    }

    const bounds =
        computeSlotSelectionPageBounds(
            total,
            safePage
        );

    return {
        start: bounds.start,
        end: bounds.end,
        hasPrev: bounds.hasPrev,
        hasNext: bounds.hasNext,
        page: bounds.page,
        totalPages: lastPage + 1
    };
}

function getSlotSelectionMenuSpec(
    slots,
    page,
    mode
) {

    const safeSlots =
        Array.isArray(slots)
            ? slots
            : [];

    const total =
        safeSlots.length;

    if (total === 0) {
        return null;
    }

    const pageInfo =
        getSlotSelectionPageInfo(
            total,
            page || 0
        );

    const visibleSlots =
        safeSlots.slice(
            pageInfo.start,
            pageInfo.end
        );

    const rows =
        visibleSlots.map(
            function (slot, index) {

                const absoluteIndex =
                    pageInfo.start +
                    index;

                return {
                    id:
                        "slot_" +
                        String(absoluteIndex + 1),
                    title: String(slot),
                    description: ""
                };
            }
        );

    if (pageInfo.hasPrev) {

        rows.push({
            id: "slot_prev",
            title: "Earlier times",
            description: "Previous page"
        });
    }

    if (pageInfo.hasNext) {

        rows.push({
            id: "slot_next",
            title: "More times",
            description: "Next page"
        });
    }

    appendWhatsAppHomeNavRow(
        rows,
        mode === "doctor"
            ? "doctor"
            : "patient"
    );

    let fallbackText = "";

    if (pageInfo.totalPages > 1) {
        fallbackText +=
            "Page " +
            (pageInfo.page + 1) +
            " of " +
            pageInfo.totalPages +
            "\n\n";
    }

    fallbackText +=
        visibleSlots
            .map(
                function (slot, index) {
                    return (
                        String(
                            pageInfo.start +
                            index +
                            1
                        ) +
                        "️⃣ " +
                        String(slot)
                    );
                }
            )
            .join("\n");

    if (pageInfo.hasPrev) {
        fallbackText += "\n◀ Earlier times";
    }

    if (pageInfo.hasNext) {
        fallbackText += "\n▶ More times";
    }

    const interactive =
        buildInteractiveListSpec(
            rows,
            "Choose time"
        );

    if (
        !interactive &&
        total > 10
    ) {
        fallbackText =
            formatAvailableSlotsForWhatsApp(
                safeSlots
            );
    }

    return {
        fallbackText: fallbackText.trim(),
        interactive: interactive,
        page: pageInfo.page,
        totalPages: pageInfo.totalPages,
        hasPrev: pageInfo.hasPrev,
        hasNext: pageInfo.hasNext
    };
}

function getYesNoConfirmSpec(mode) {

    const fallbackText =
        "1️⃣ Yes, cancel it\n" +
        "2️⃣ No, go back";

    const interactive =
        buildInteractiveButtonSpec([
            {
                id: "confirm_yes_cancel",
                title: "Yes, cancel"
            },
            {
                id: "confirm_no_back",
                title: "No, go back"
            },
            {
                id: "nav_main_menu",
                title:
                    mode === "doctor"
                        ? "Doctor Portal"
                        : "Main Menu"
            }
        ]);

    return {
        fallbackText: fallbackText,
        interactive: interactive
    };
}


function getRescheduleConfirmSpec(mode) {

    const fallbackText =
        "1️⃣ Confirm\n" +
        "2️⃣ Choose another time\n" +
        "3️⃣ Cancel";

    const rows = [
        {
            id: "confirm_yes",
            title: "Confirm"
        },
        {
            id: "confirm_other_time",
            title: "Other time"
        },
        {
            id: "confirm_cancel",
            title: "Cancel"
        }
    ];

    appendWhatsAppHomeNavRow(
        rows,
        mode
    );

    const interactive =
        buildInteractiveListSpec(
            rows,
            "Choose"
        );

    return {
        fallbackText: fallbackText,
        interactive: interactive
    };
}


function getBookingConfirmSpec(mode) {

    return getRescheduleConfirmSpec(mode);
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
            "HOSPITAL_LATITUDE",
            ""
        ]);

        sheet.appendRow([
            "HOSPITAL_LONGITUDE",
            ""
        ]);

        sheet.appendRow([
            "HOME_COLLECTION_RADIUS_KM",
            "5"
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
            "HOSPITAL_LATITUDE",
            ""
        );
        ensureSettingKey(
            sheet,
            "HOSPITAL_LONGITUDE",
            ""
        );
        ensureSettingKey(
            sheet,
            "HOME_COLLECTION_RADIUS_KM",
            "5"
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
        try {
            return JSON.parse(cached);
        } catch (parseError) {
            Logger.log(
                "getLogSettings: corrupted cache entry, falling back to sheet. Error: " +
                parseError.message
            );
        }
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

    const data =
        sheet.getDataRange().getValues();

    const rowsToDelete = {};
    let deletedByAge = 0;
    let deletedByCap = 0;

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

        for (
            let i = 1;
            i < data.length;
            i++
        ) {

            if (data[i][1] === "REMINDER") {
                continue;
            }

            const timestamp =
                parseLogTimestamp(
                    data[i][0]
                );

            if (
                timestamp &&
                timestamp.getTime() <
                cutoff.getTime()
            ) {
                rowsToDelete[i + 1] = true;
                deletedByAge++;
            }
        }
    }

    const survivingNonReminderRows = [];

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        const row = i + 1;

        if (
            data[i][1] !== "REMINDER" &&
            !rowsToDelete[row]
        ) {
            survivingNonReminderRows.push(row);
        }
    }

    const excess =
        survivingNonReminderRows.length -
        opts.maxRows;

    if (excess > 0) {

        for (
            let k = 0;
            k < excess;
            k++
        ) {
            rowsToDelete[survivingNonReminderRows[k]] = true;
            deletedByCap++;
        }
    }

    Object.keys(rowsToDelete)
        .map(Number)
        .sort(function (a, b) {
            return b - a;
        })
        .forEach(function (row) {
            sheet.deleteRow(row);
        });

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
            "Direction",
            "Phone",
            "Name",
            "Status",
            "Message",
            "Appointment ID",
            "Hours Before",
            "Phone Number ID"
        ]);
    }

    return sheet;
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

    const sheet =
        ss.getSheetByName("WhatsApp_Log");

    results.sheets["WhatsApp_Log"] =
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


function hasReminderBeenSent(
    appointmentId,
    hoursBefore
) {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ensureWhatsAppLogSheet(ss);

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
            data[i][1] === "REMINDER" &&
            String(data[i][6] || "").trim() ===
            targetId &&
            Number(data[i][7]) === targetHours &&
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

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ensureWhatsAppLogSheet(ss);

    sheet.appendRow([
        new Date(),
        "REMINDER",
        phone,
        "",
        status,
        "",
        appointmentId,
        hoursBefore,
        ""
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
                buildISODatetimeWithTimezone(
                    iso,
                    "00:00"
                )
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
        ["EN", "TE", "HI", "KA", "TA", "ML"].indexOf(
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

    // No separate diagnostic log entry here — markReminderSent (called by
    // the caller right after this returns) already records this outcome
    // in the shared WhatsApp_Log sheet as the REMINDER ledger row.

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

    // Apps Script doesn't guarantee exact trigger timing (documented
    // multi-minute variance for load balancing), and the eligibility
    // window (REMINDER_WINDOW_MINUTES, default 45) is narrower than an
    // hour — an hourly cadence left almost no margin for two consecutive
    // runs to land more than an hour apart and skip a window entirely.
    // 30-minute cadence keeps comfortable overlap with the 45-minute
    // window even accounting for that jitter.
    ScriptApp.newTrigger(
        "sendAppointmentReminders"
    )
        .timeBased()
        .everyMinutes(30)
        .create();

    return {
        success: true,
        message:
            "Appointment reminder trigger installed (every 30 minutes)."
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

    // Fail closed: every caller must prove ownership via either an
    // authorized doctor ID or a matching patient phone number. Without
    // one of these, refuse the update rather than allowing an
    // unauthenticated status change.
    if (
        !String(opts.authorizedDoctorId || "").trim() &&
        !String(opts.patientPhone || "").trim()
    ) {

        return {
            success: false,
            message:
                "Not authorized to update this appointment."
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

        // CLINIC_OPEN_TIME/CLINIC_CLOSE_TIME failed to parse. Fail
        // open (treat as within clinic hours) rather than blocking
        // patients on a configuration typo, but log it loudly so the
        // misconfiguration doesn't go unnoticed and the after-hours
        // feature doesn't silently stay disabled indefinitely.
        Logger.log(
            "isWithinClinicHours: could not parse CLINIC_OPEN_TIME/" +
            "CLINIC_CLOSE_TIME (openTime=" + config.openTime +
            ", closeTime=" + config.closeTime +
            "). Treating as within clinic hours."
        );

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
        ["EN", "TE", "HI", "KA", "TA", "ML"].indexOf(
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

    // {{CLINIC_NAME}} — not a direct getClinicName() call — so this
    // literal text still matches the localization dictionary's key in
    // localizeWhatsAppReply() below; the final substitution there
    // replaces the placeholder with the real name for every language.
    const message =
        "🕐 " +
        "{{CLINIC_NAME}} is currently closed.\n\n" +
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
            buildISODatetimeWithTimezone(
                value,
                "00:00"
            )
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
                buildISODatetimeWithTimezone(
                    iso,
                    "00:00"
                )
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
            buildISODatetimeWithTimezone(
                iso,
                time24
            )
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
        new Date(
            buildISODatetimeWithTimezone(
                "2026-01-01",
                "00:00"
            )
        );

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

    const lock = LockService.getScriptLock();

    if (!lock.tryLock(10000)) {
        return {
            success: false,
            message:
                "Unable to save availability. Please try again."
        };
    }

    try {

        const sheet =
            ensureAvailabilitySheet();

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

    } finally {
        lock.releaseLock();
    }
}

function removeDoctorAvailabilitySession(
    doctorId,
    dayName,
    sessionIndex
) {

    const lock = LockService.getScriptLock();

    if (!lock.tryLock(10000)) {
        return {
            success: false,
            message:
                "Unable to remove availability. Please try again."
        };
    }

    try {

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

    } finally {
        lock.releaseLock();
    }
}

function clearDoctorDayAvailability(
    doctorId,
    dayName
) {

    const lock = LockService.getScriptLock();

    if (!lock.tryLock(10000)) {
        return {
            success: false,
            message:
                "Unable to clear availability. Please try again."
        };
    }

    try {

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

    } finally {
        lock.releaseLock();
    }
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

    const lock = LockService.getScriptLock();

    if (!lock.tryLock(10000)) {
        return {
            success: false,
            message:
                "Unable to save leave. Please try again."
        };
    }

    try {

        // Re-check under the lock — the check above (before acquiring
        // the lock) is only an early exit; without re-checking here,
        // two concurrent calls could both pass the earlier check and
        // both append a duplicate leave row.
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

        const sheet =
            ensureDoctorLeavesSheet();

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

    } finally {
        lock.releaseLock();
    }
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
            buildISODatetimeWithTimezone(
                startDate,
                "00:00"
            )
        );

    const end =
        new Date(
            buildISODatetimeWithTimezone(
                endDate,
                "00:00"
            )
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

    const lock = LockService.getScriptLock();

    if (!lock.tryLock(10000)) {
        return {
            success: false,
            message:
                "Unable to cancel leave. Please try again."
        };
    }

    try {

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

    } finally {
        lock.releaseLock();
    }
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
            buildISODatetimeWithTimezone(
                dateString,
                "00:00"
            )
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

    let appointmentDuration;

    try {

        appointmentDuration =
            getDoctorAppointmentDuration(
                doctorId
            );

    } catch (durationError) {

        Logger.log(
            "getAvailableSlots: could not resolve appointment duration for " +
            doctorId +
            ": " +
            durationError
        );

        return [];
    }

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

    let calendar;
    let dayEvents;

    try {

        calendar =
            CalendarApp.getCalendarById(
                calendarId
            );

        if (!calendar) {

            throw new Error(
                "Calendar not found."
            );
        }

        // Fetch the whole day's events once instead of calling
        // calendar.getEvents() per candidate slot — the previous
        // per-slot approach made one Calendar API call per slot
        // (potentially dozens per doctor per day), which is both
        // slow and at risk of hitting CalendarApp quotas.
        dayEvents =
            calendar.getEventsForDay(date);

    } catch (calendarError) {

        Logger.log(
            "getAvailableSlots: Calendar lookup failed for " +
            doctorId +
            " on " +
            dateString +
            ": " +
            calendarError
        );

        return [];
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

            const hasConflict =
                dayEvents.some(
                    function (event) {
                        return (
                            event.getStartTime().getTime() < slotEnd.getTime() &&
                            event.getEndTime().getTime() > current.getTime()
                        );
                    }
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
                !hasConflict
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
        ["EN", "TE", "HI", "KA", "TA", "ML"].indexOf(lang) === -1
    ) {

        const existing =
            findPatientByPhone(phone);

        lang =
            existing &&
            ["EN", "TE", "HI", "KA", "TA", "ML"].indexOf(
                existing.language
            ) !== -1
                ? existing.language
                : "EN";
    }

    // Note: this runs on the hottest concurrency path (patient booking),
    // where duplicate/retried WhatsApp webhook deliveries make a
    // check-then-act race on Patients rows most likely — do NOT skip
    // the lock here.
    return upsertPatient(
        phone,
        name,
        lang,
        {
            updateLastVisit: true
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
        ["EN", "TE", "HI", "KA", "TA", "ML"].indexOf(lang) === -1
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
        ["EN", "TE", "HI", "KA", "TA", "ML"].indexOf(
            sessionLang
        ) !== -1
    ) {
        return sessionLang;
    }

    const patient =
        findPatientByPhone(phone);

    if (
        patient &&
        ["EN", "TE", "HI", "KA", "TA", "ML"].indexOf(
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

    // ========================================================
    // DOCTOR VALIDATION (with null checks)
    // ========================================================

    if (!doctor) {

        return {
            success: false,
            message: "Doctor not found."
        };
    }

    if (!doctor.calendarId) {

        return {
            success: false,
            message:
                "Doctor calendar is not configured."
        };
    }

    const doctorName =
        doctor.doctorName || "";

    if (!doctorName) {

        return {
            success: false,
            message:
                "Doctor name is missing in system."
        };
    }

    const clinicName =
        doctor.clinicName || "";

    if (!clinicName) {

        return {
            success: false,
            message:
                "Clinic name is missing in system."
        };
    }

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
            buildISODatetimeWithTimezone(
                dateString,
                time24
            )
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
                "Time slot is not available."
        };
    }

    // ========================================================
    // TOCTOU PROTECTION: Check slot reservation
    // ========================================================
    // Prevent two patients from booking the same slot
    // if another patient reserved it between our availability check
    // and actual booking attempt.

    const slotReservationCheck =
        isSlotReservedByOther(
            doctorId,
            dateString,
            formattedRequestedTime,
            patientPhone
        );

    if (slotReservationCheck.isReserved) {

        return {
            success: false,
            message:
                "The selected appointment time is not available."
        };
    }

    // ----------------------------------------------------------
    // Create Calendar event
    // ----------------------------------------------------------

    const lock =
        LockService.getScriptLock();

    let event = null;
    let appointmentId = null;

    try {

        // ========================================================
        // RETRY LOCK ACQUISITION
        // ========================================================
        // Try up to 3 times with timeouts to handle brief lock contention
        // rather than failing immediately

        let lockAcquired = false;
        for (let attempt = 0; attempt < 3; attempt++) {
            if (lock.tryLock(5000)) {
                lockAcquired = true;
                break;
            }
        }

        if (!lockAcquired) {

            return {
                success: false,
                message:
                    "Booking is currently busy. Please try again in a moment."
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

        // Generated (and checked for uniqueness) only after the lock is
        // held, so two concurrent bookings can never race on the same ID.
        appointmentId =
            generateUniqueAppointmentId(
                appointmentSheet
            );

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
    // TOCTOU CLEANUP: Clear slot reservation
    // ----------------------------------------------------------
    // Remove patient's slot reservation now that booking is confirmed.
    // If cleanup fails, log but don't fail the entire booking.

    try {

        clearSlotReservation(
            doctorId,
            dateString,
            formattedRequestedTime,
            patientPhone
        );

    } catch (cleanupError) {

        Logger.log(
            "Warning: Failed to clear slot reservation: " +
            cleanupError.message
        );
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
        // Scan from end backwards since appointments are appended;
        // target is typically near the end, so this reduces avg scan time.

        for (
            let i = appointmentData.length - 1;
            i >= 1;
            i--
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

                // ========================================================
                // AUTHORIZATION CHECK: Doctor OR Patient Phone Required
                // ========================================================
                // Must have EITHER valid doctor authorization OR matching phone
                const isDoctorAuthorized =
                    authorizedDoctorId &&
                    rowDoctorId === authorizedDoctorId;

                const isPatientAuthorized =
                    !authorizedDoctorId &&
                    phonesMatch(rowPhone, patientPhone);

                if (!isDoctorAuthorized && !isPatientAuthorized) {

                    return {
                        success: false,
                        message:
                            "You are not authorized to cancel this appointment."
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

    // Acquire the lock before any validation runs (not just around the
    // final write). Locking only around the write left the lookup,
    // authorization, status, and slot-availability checks above free
    // to race against a concurrent reschedule/cancel on the same
    // appointment; those checks read a snapshot that could be stale
    // by the time the write happens.
    const rescheduleLock =
        LockService.getScriptLock();

    // ========================================================
    // RETRY LOCK ACQUISITION
    // ========================================================
    // Try up to 3 times with timeouts to handle brief lock contention

    let lockAcquired = false;
    for (let attempt = 0; attempt < 3; attempt++) {
        if (rescheduleLock.tryLock(5000)) {
            lockAcquired = true;
            break;
        }
    }

    if (!lockAcquired) {

        return {
            success: false,
            message:
                "Reschedule is currently busy. Please try again in a moment."
        };
    }

    try {

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
    // Scan from end backwards since appointments are appended;
    // target is typically near the end, so this reduces avg scan time.

    for (
        let i = appointmentData.length - 1;
        i >= 1;
        i--
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

    // ========================================================
    // AUTHORIZATION CHECK: Doctor OR Patient Phone Required
    // ========================================================
    // Must have EITHER valid doctor authorization OR matching phone
    const isDoctorAuthorized =
        authorizedDoctorId &&
        String(doctorId || "").trim() === authorizedDoctorId;

    const isPatientAuthorized =
        !authorizedDoctorId &&
        phonesMatch(storedPatientPhone, patientPhoneInput);

    if (!isDoctorAuthorized && !isPatientAuthorized) {

        return {

            success: false,

            message:
                "You are not authorized to reschedule this appointment."
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
    // Find doctor (with null checks)
    // ----------------------------------------------------------

    const doctor =
        getDoctorRecord(doctorId);

    if (!doctor) {

        return {

            success: false,

            message:
                "Doctor not found."
        };
    }

    if (!doctor.calendarId) {

        return {

            success: false,

            message:
                "Doctor calendar not configured."
        };
    }

    const doctorName =
        doctor.doctorName || "";

    if (!doctorName) {

        return {

            success: false,

            message:
                "Doctor name is missing in system."
        };
    }

    const clinicName =
        doctor.clinicName || "";

    if (!clinicName) {

        return {

            success: false,

            message:
                "Clinic name is missing in system."
        };
    }

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
            buildISODatetimeWithTimezone(
                newDateString,
                newTime24
            )
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

    try {

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

    } finally {

        if (rescheduleLock.hasLock()) {
            rescheduleLock.releaseLock();
        }
    }
}


// ============================================================
// 9. GET DOCTORS
// ============================================================

function getDoctors() {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Doctors");

    ensureDoctorSpecializationColumn(sheet);

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
                data[i][2],

            specialization:
                String(data[i][7] || "").trim()
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
                    Number(data[i][5]) || 30,
                specialization:
                    String(data[i][7] || "").trim()
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
        buildDoctorSelectionBody();

    message +=
        "\n\n" +
        buildDoctorSelectionFallbackText(
            doctors
        );

    return message;
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

    // ========================================================
    // OPTIMIZATION: Scan from end backwards
    // ========================================================
    // Most active appointments are recent; scanning from the end
    // reduces avg scan time on large sheets without missing results.

    for (
        let i = data.length - 1;
        i >= 1;
        i--
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

    if (!data || typeof data !== "object") {
        data = {};
    }

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

            if (!data.doctorId || !data.date) {
                return {
                    success: false,
                    message: "Missing required parameters: doctorId and date"
                };
            }

            return getAvailableSlots(
                data.doctorId,
                data.date
            );


        // --------------------------------------------------------
        // BOOK
        // --------------------------------------------------------

        case "book":

            if (!data.doctorId || !data.date || !data.time ||
                !data.patientName || !data.patientPhone) {
                return {
                    success: false,
                    message: "Missing required parameters: doctorId, date, time, patientName, patientPhone"
                };
            }

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

            if (!data.patientPhone) {
                return {
                    success: false,
                    message: "Missing required parameter: patientPhone"
                };
            }

            return getMyAppointments(
                data.patientPhone
            );


        // --------------------------------------------------------
        // CANCEL - SECURE
        // --------------------------------------------------------

        case "cancel":

            if (!data.appointmentId || !data.patientPhone) {
                return {
                    success: false,
                    message: "Missing required parameters: appointmentId, patientPhone"
                };
            }

            return cancelAppointment(

                data.appointmentId,

                data.patientPhone
            );


        // --------------------------------------------------------
        // RESCHEDULE - SECURE
        // --------------------------------------------------------

        case "reschedule":

            if (!data.appointmentId || !data.patientPhone ||
                !data.newDate || !data.newTime) {
                return {
                    success: false,
                    message: "Missing required parameters: appointmentId, patientPhone, newDate, newTime"
                };
            }

            return rescheduleAppointment(

                data.appointmentId,

                data.patientPhone,

                data.newDate,

                data.newTime
            );


        case "doctorToday":

            if (!data.doctorId) {
                return {
                    success: false,
                    message: "Missing required parameter: doctorId"
                };
            }

            return getDoctorTodaySchedule(
                data.doctorId
            );

        case "doctorWeek":

            if (!data.doctorId) {
                return {
                    success: false,
                    message: "Missing required parameter: doctorId"
                };
            }

            return getDoctorWeeklySchedule(
                data.doctorId
            );

        case "doctorNext":

            if (!data.doctorId) {
                return {
                    success: false,
                    message: "Missing required parameter: doctorId"
                };
            }

            return getDoctorNextAppointment(
                data.doctorId
            );

        case "doctorPatients":

            if (!data.doctorId) {
                return {
                    success: false,
                    message: "Missing required parameter: doctorId"
                };
            }

            return {
                success: true,
                patients:
                    getDoctorPatientsSeen(
                        data.doctorId
                    )
            };

        case "doctorAvailability":

            if (!data.doctorId) {
                return {
                    success: false,
                    message: "Missing required parameter: doctorId"
                };
            }

            return {
                success: true,
                availability:
                    getDoctorWeeklyAvailability(
                        data.doctorId
                    )
            };

        case "doctorLeaves":

            if (!data.doctorId) {
                return {
                    success: false,
                    message: "Missing required parameter: doctorId"
                };
            }

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
                buildISODatetimeWithTimezone(
                    dateString,
                    "00:00"
                )
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
                buildISODatetimeWithTimezone(
                    weekStartString,
                    "00:00"
                )
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

    // Fail closed: an unconfigured token must NOT be treated as
    // "verification disabled". Without this, the POST webhook would
    // silently accept any unauthenticated request whenever the
    // script property is missing.
    if (!expectedToken) {

        Logger.log(
            "verifyWhatsAppWebhookRequest: WHATSAPP_WEBHOOK_POST_TOKEN " +
            "is not configured — rejecting request."
        );

        return false;
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
            ""
        );

    // Fail closed: never fall back to a hardcoded, publicly-visible
    // verify token. If the property isn't configured, verification
    // must fail rather than succeed against a guessable default.
    if (!verifyToken) {

        Logger.log(
            "doGet: WHATSAPP_VERIFY_TOKEN is not configured — " +
            "rejecting webhook verification."
        );

        return ContentService
            .createTextOutput("Verification failed")
            .setMimeType(
                ContentService.MimeType.TEXT
            );
    }

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

    // Build the instant with an explicit +05:30 offset instead of the
    // new Date(y, m, d, h, min) constructor, which resolves its
    // components in the Apps Script *project's* configured timezone —
    // not necessarily the TIMEZONE constant (Asia/Kolkata) used
    // everywhere else. Matches parseAppointmentSheetDateTime's approach
    // so the two parsers can never disagree on what "now" means relative
    // to a given appointment.
    const iso =
        String(year).padStart(4, "0") +
        "-" +
        String(month + 1).padStart(2, "0") +
        "-" +
        String(day).padStart(2, "0");

    const dateTime =
        new Date(
            buildISODatetimeWithTimezone(
                iso,
                time24
            )
        );

    return isNaN(dateTime.getTime())
        ? null
        : dateTime;
}


function getConfirmedAppointmentsForPhone(phone) {

    const appointments =
        getMyAppointments(phone);

    // Show every active appointment. Only cancelled, completed, and
    // no-show appointments should be hidden — this prevents valid
    // appointments from disappearing when their status is blank or uses
    // another active label.
    const confirmed =
        appointments.filter(
            function (appt) {
                return !isInactiveAppointmentStatus(
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
            "   🕐 " + appt.time +
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


function buildCancelConfirmMessage(chosen) {

    const doctorName =
        findDoctorById(
            chosen.doctorId
        ) || "Unknown Doctor";

    return (
        "⚠️ Cancel this appointment?\n\n" +
        "👨‍⚕️ " + doctorName + "\n" +
        "📅 " +
        formatWhatsAppDisplayDate(
            chosen.date
        ) +
        "\n" +
        "🕐 " + chosen.time
    );
}


function buildRescheduleSlotConfirmMessage(
    session,
    newDate,
    selectedTime
) {

    return (
        "🔄 Confirm reschedule?\n\n" +
        "👨‍⚕️ " +
        (
            findDoctorById(
                session.doctorId
            ) || "Unknown Doctor"
        ) +
        "\n" +
        "📅 " +
        formatWhatsAppDisplayDate(newDate) +
        "\n" +
        "🕐 " + selectedTime
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

        sendPatientMainMenuReply(
            ss,
            phone,
            "❌ You have no active appointments to cancel."
        );

        return false;
    }

    saveWhatsAppSession(phone, {
        role: "PATIENT",
        state: "CANCEL_SELECT",
        apptPage: 0
    });

    sendPatientAppointmentListMenuReply(
        ss,
        phone,
        "cancel",
        appointments
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

        sendPatientMainMenuReply(
            ss,
            phone,
            "❌ You have no active appointments to reschedule."
        );

        return false;
    }

    saveWhatsAppSession(phone, {
        role: "PATIENT",
        state: "RESCHEDULE_SELECT",
        apptPage: 0
    });

    sendPatientAppointmentListMenuReply(
        ss,
        phone,
        "reschedule",
        appointments
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
            "   🕐 " + appt.time +
            "\n\n";
    }

    return text;
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
        chosen.time
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
        "🔄 Confirm reschedule?\n\n" +
        patientLine +
        "👨‍⚕️ " +
        (
            findDoctorById(
                session.doctorId
            ) || "Unknown Doctor"
        ) +
        "\n" +
        "📅 " +
        formatWhatsAppDisplayDate(newDate) +
        "\n" +
        "🕐 " + selectedTime
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
            getClinicName() + ": Your appointment on " +
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
            getClinicName() + ": Your appointment has been rescheduled by the clinic.\n\n" +
            "📅 " +
            result.date +
            "\n" +
            "🕐 " +
            result.time +
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

    if (!doctorId) {
        return;
    }

    const appointments =
        typeof opts.getAppointments === "function"
            ? opts.getAppointments()
            : getDoctorConfirmedAppointments(
                doctorId
            );

    const currentPage =
        Number(session.apptPage) || 0;

    const pageInfo =
        getSlotSelectionPageInfo(
            appointments.length,
            currentPage
        );

    const decision =
        classifyWhatsAppAppointmentListChoice(
            normalizedMessage,
            appointments.length
        );

    if (decision.type === "main_menu") {

        returnDoctorToMenu(
            ss,
            phone,
            doctorId
        );

        return;
    }

    if (decision.type === "back") {

        goBackInDoctorWhatsAppFlow(
            ss,
            phone,
            session
        );

        return;
    }

    if (decision.type === "prev") {

        if (!pageInfo.hasPrev) {

            sendDoctorAppointmentListMenuReply(
                ss,
                phone,
                "❌ Invalid selection.",
                opts.selectLine,
                appointments,
                currentPage
            );

            return;
        }

        const previousPage =
            currentPage - 1;

        saveWhatsAppSession(phone, {
            apptPage: previousPage
        });

        sendDoctorAppointmentListMenuReply(
            ss,
            phone,
            "",
            opts.selectLine,
            appointments,
            previousPage
        );

        return;
    }

    if (decision.type === "next") {

        if (!pageInfo.hasNext) {

            sendDoctorAppointmentListMenuReply(
                ss,
                phone,
                "❌ Invalid selection.",
                opts.selectLine,
                appointments,
                currentPage
            );

            return;
        }

        const nextPage =
            currentPage + 1;

        saveWhatsAppSession(phone, {
            apptPage: nextPage
        });

        sendDoctorAppointmentListMenuReply(
            ss,
            phone,
            "",
            opts.selectLine,
            appointments,
            nextPage
        );

        return;
    }

    if (decision.type !== "selection") {

        sendDoctorAppointmentListMenuReply(
            ss,
            phone,
            "❌ Invalid selection.",
            opts.selectLine,
            appointments,
            currentPage
        );

        return;
    }

    saveWhatsAppSession(phone, {
        apptPage: 0
    });

    opts.onChosen(
        appointments[decision.index]
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
        appointmentId: "",
        apptPage: 0
    });

    sendDoctorAppointmentListMenuReply(
        ss,
        phone,
        "❌ Cancel Patient Appointment",
        "Select the appointment to cancel:",
        appointments
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
        appointmentId: "",
        apptPage: 0
    });

    sendDoctorAppointmentListMenuReply(
        ss,
        phone,
        "🔄 Reschedule Patient Appointment",
        "Select the appointment to reschedule:",
        appointments
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
        chosen.time
    );
}


function getDoctorStatusActionSpec() {

    const fallbackText =
        "1️⃣ Completed\n" +
        "2️⃣ No-Show";

    const interactive =
        buildInteractiveButtonSpec([
            {
                id: "status_completed",
                title: "Completed"
            },
            {
                id: "status_no_show",
                title: "No-Show"
            },
            {
                id: "nav_main_menu",
                title: "Doctor Portal"
            }
        ]);

    return {
        fallbackText: fallbackText,
        interactive: interactive
    };
}


function isYesCancelConfirmChoice(normalizedMessage) {

    const choice =
        String(normalizedMessage || "")
            .trim()
            .toLowerCase();

    return (
        choice === "1" ||
        choice === "confirm_yes_cancel"
    );
}


function isNoGoBackConfirmChoice(normalizedMessage) {

    const choice =
        String(normalizedMessage || "")
            .trim()
            .toLowerCase();

    return (
        choice === "2" ||
        choice === "confirm_no_back"
    );
}


function localizeInteractiveMenu(
    language,
    interactive
) {

    if (
        !interactive ||
        String(language || "EN").toUpperCase() === "EN"
    ) {
        return interactive;
    }

    const copy =
        JSON.parse(
            JSON.stringify(interactive)
        );

    if (
        copy.type === "button" &&
        copy.buttons
    ) {

        copy.buttons =
            copy.buttons.map(
                function (button) {

                    return {
                        id: button.id,
                        title:
                            truncateInteractiveLabel(
                                localizeWhatsAppReply(
                                    language,
                                    button.title
                                ),
                                20
                            )
                    };
                }
            );
    }

    if (
        copy.type === "list"
    ) {

        if (copy.buttonLabel) {

            copy.buttonLabel =
                truncateInteractiveLabel(
                    localizeWhatsAppReply(
                        language,
                        copy.buttonLabel
                    ),
                    20
                );
        }

        if (copy.sections) {

            copy.sections =
                copy.sections.map(
                    function (section) {

                        return {
                            title:
                                truncateInteractiveLabel(
                                    localizeWhatsAppReply(
                                        language,
                                        section.title || ""
                                    ),
                                    24
                                ),
                            rows:
                                (section.rows || [])
                                    .map(
                                        function (row) {

                                            return {
                                                id: row.id,
                                                title:
                                                    truncateInteractiveLabel(
                                                        localizeWhatsAppReply(
                                                            language,
                                                            row.title
                                                        ),
                                                        24
                                                    ),
                                                description:
                                                    truncateInteractiveLabel(
                                                        localizeWhatsAppReply(
                                                            language,
                                                            row.description || ""
                                                        ),
                                                        72
                                                    )
                                            };
                                        }
                                    )
                        };
                    }
                );
        }
    }

    return copy;
}


function localizeInteractiveMenuForSession(
    session,
    language,
    interactive
) {

    if (
        session &&
        session.role === "DOCTOR"
    ) {
        return interactive;
    }

    return localizeInteractiveMenu(
        language,
        interactive
    );
}


function buildDoctorScheduleDateEntryPrompt() {

    return (
        "📅 Enter the date to view.\n\n" +
        "Format: YYYY-MM-DD\n" +
        "Example: 2026-08-25"
    );
}


function validateScheduleViewISODate(typedDate) {

    const trimmed =
        String(typedDate || "").trim();

    if (!isValidISODate(trimmed)) {

        return {
            valid: false,
            message:
                "❌ That doesn't look like a valid date.\n\n" +
                buildDoctorScheduleDateEntryPrompt()
        };
    }

    return {
        valid: true,
        date: trimmed
    };
}


function buildBookingDateSelectionIntro(session) {

    const doctorName =
        session &&
        session.doctorId
            ? findDoctorById(session.doctorId)
            : "";

    if (doctorName) {

        return (
            "👨‍⚕️ " +
            doctorName +
            "\n\nChoose an appointment date."
        );
    }

    return "Choose an appointment date.";
}


function buildRescheduleDateSelectionIntro(session) {

    const doctorName =
        session &&
        session.doctorId
            ? findDoctorById(session.doctorId)
            : "Doctor";

    return (
        "🔄 " +
        (doctorName || "Doctor") +
        "\n\nChoose a new appointment date."
    );
}


function buildDoctorRescheduleDateIntro(doctorId) {

    return (
        "🔄 " +
        (findDoctorById(doctorId) || "Doctor") +
        "\n\nChoose a new appointment date."
    );
}


// Row budget is 10 (WhatsApp's interactive-list cap). Every page reserves
// 1 row for the persistent "Main Menu"/"Back" nav row, on top of whatever
// is reserved for ◀/▶ pagination rows:
//   single page:        content ≤ 9   (+ 1 nav                = 10)
//   first page (>1 pg): content = 7   (+ 1 next  + 1 nav       = 9, ≤10)
//   middle page:        content = 6   (+ 1 prev + 1 next + nav = 9, ≤10)
//   last page:          content ≤ 8   (+ 1 prev + 1 nav        ≤ 10)
function computeSlotSelectionPageBounds(
    total,
    page
) {

    if (total <= 9) {

        return {
            start: 0,
            end: total,
            hasPrev: false,
            hasNext: false,
            page: 0
        };
    }

    if (page === 0) {

        return {
            start: 0,
            end: 7,
            hasPrev: false,
            hasNext: total > 7,
            page: 0
        };
    }

    const start =
        7 + (page - 1) * 6;

    const remaining =
        total - start;

    const hasNext =
        remaining > 8;

    const slotCount =
        hasNext
            ? 6
            : Math.min(remaining, 8);

    return {
        start: start,
        end: start + slotCount,
        hasPrev: true,
        hasNext: hasNext,
        page: page
    };
}


function formatWhatsAppDisplayDate(isoDate) {

    if (!isValidISODate(isoDate)) {
        return String(isoDate || "").trim();
    }

    return Utilities.formatDate(
        new Date(
            buildISODatetimeWithTimezone(
                isoDate,
                "00:00"
            )
        ),
        TIMEZONE,
        "dd-MMM-yyyy"
    );
}


function buildSlotSelectionIntro(
    isoDate,
    isReschedule
) {

    const formatted =
        formatWhatsAppDisplayDate(isoDate);

    const line =
        isReschedule
            ? "Choose a new time."
            : "Choose an available time.";

    return (
        "📅 " +
        formatted +
        "\n\n" +
        line
    );
}


function getLastSlotSelectionPage(totalSlots) {

    const total =
        Number(totalSlots) || 0;

    if (total <= 9) {
        return 0;
    }

    let page = 0;

    while (true) {

        const bounds =
            computeSlotSelectionPageBounds(
                total,
                page
            );

        if (!bounds.hasNext) {
            return page;
        }

        page++;
    }
}


function getConfirmCancelSpec() {

    const fallbackText =
        "1️⃣ Confirm\n" +
        "2️⃣ Cancel";

    const interactive =
        buildInteractiveButtonSpec([
            {
                id: "confirm_yes",
                title: "Confirm"
            },
            {
                id: "confirm_cancel",
                title: "Cancel"
            },
            {
                id: "nav_main_menu",
                title: "Doctor Portal"
            }
        ]);

    return {
        fallbackText: fallbackText,
        interactive: interactive
    };
}


function getAppointmentListMenuSpec(
    appointments,
    mode,
    page
) {

    if (
        !appointments ||
        appointments.length === 0
    ) {
        return {
            fallbackText: "",
            interactive: null
        };
    }

    const listMode =
        mode === "doctor"
            ? "doctor"
            : "patient";

    const total =
        appointments.length;

    const pageInfo =
        getSlotSelectionPageInfo(
            total,
            page || 0
        );

    const listed =
        appointments.slice(
            pageInfo.start,
            pageInfo.end
        );

    let fallbackText =
        listMode === "doctor"
            ? listed
                .map(
                    function (appt, index) {
                        return (
                            String(
                                pageInfo.start +
                                index +
                                1
                            ) +
                            "️⃣ " +
                            "👤 " +
                            (appt.patientName || "Patient") +
                            "\n" +
                            "   📅 " +
                            appt.date +
                            "   🕐 " +
                            appt.time +
                            "\n"
                        );
                    }
                )
                .join("\n")
            : listed
                .map(
                    function (appt, index) {
                        const doctorName =
                            findDoctorById(
                                appt.doctorId
                            ) ||
                            "Unknown Doctor";

                        return (
                            String(
                                pageInfo.start +
                                index +
                                1
                            ) +
                            "️⃣ " +
                            doctorName +
                            "\n" +
                            "   " +
                            formatAppointmentListRowDescription(
                                appt
                            ) +
                            "\n"
                        );
                    }
                )
                .join("\n");

    if (pageInfo.hasPrev) {
        fallbackText += "\n◀ Earlier appointments";
    }

    if (pageInfo.hasNext) {
        fallbackText += "\n▶ More appointments";
    }

    const rows =
        listed.map(
            function (appt, index) {

                const absoluteIndex =
                    pageInfo.start +
                    index;

                const doctorName =
                    findDoctorById(
                        appt.doctorId
                    ) ||
                    "Unknown Doctor";

                if (listMode === "doctor") {
                    return {
                        id:
                            "appt_" +
                            String(
                                absoluteIndex + 1
                            ),
                        title:
                            appt.patientName ||
                            "Patient",
                        description:
                            (appt.date || "") +
                            " · " +
                            (appt.time || "")
                    };
                }

                return {
                    id:
                        "appt_" +
                        String(
                            absoluteIndex + 1
                        ),
                    title: doctorName,
                    description:
                        formatAppointmentListRowDescription(
                            appt
                        )
                };
            }
        );

    if (pageInfo.hasPrev) {

        rows.push({
            id: "appt_prev",
            title: "Earlier appointments",
            description: "Previous page"
        });
    }

    if (pageInfo.hasNext) {

        rows.push({
            id: "appt_next",
            title: "More appointments",
            description: "Next page"
        });
    }

    appendWhatsAppHomeNavRow(
        rows,
        listMode
    );

    const interactive =
        buildInteractiveListSpec(
            rows,
            "Select appointment"
        );

    if (
        !interactive &&
        total > 10
    ) {
        fallbackText =
            listMode === "doctor"
                ? formatDoctorPatientAppointmentsListForWhatsApp(
                    appointments
                )
                : formatAppointmentsListForWhatsApp(
                    appointments
                );
    }

    return {
        fallbackText: fallbackText.trim(),
        interactive: interactive,
        page: pageInfo.page,
        totalPages: pageInfo.totalPages,
        hasPrev: pageInfo.hasPrev,
        hasNext: pageInfo.hasNext
    };
}


function getDoctorWeekdayMenuSpec(doctorId) {

    const availability =
        getDoctorWeeklyAvailability(
            doctorId
        );

    let fallbackText =
        "📅 Manage Availability\n\n";

    const rows =
        DOCTOR_WEEKDAYS.map(
            function (day, index) {

                const sessions =
                    availability[day];

                let summary =
                    "Not set";

                if (sessions.length > 0) {
                    summary =
                        sessions.length +
                        " session(s)";
                }

                fallbackText +=
                    (index + 1) +
                    ". " +
                    day +
                    ": " +
                    summary +
                    "\n";

                return {
                    id: String(index + 1),
                    title: day,
                    description: summary
                };
            }
        );

    fallbackText +=
        "\nSelect a day to manage.";

    appendWhatsAppHomeNavRow(
        rows,
        "doctor"
    );

    return {
        fallbackText: fallbackText,
        interactive:
            buildInteractiveListSpec(
                rows,
                "Select day"
            )
    };
}


function buildDoctorDayAvailabilityBody(
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
        text += "No sessions set.\n";
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
    }

    return text;
}


function getDoctorDayAvailabilityActionSpec() {

    const fallbackText =
        "1️⃣ Add session\n" +
        "2️⃣ Remove session\n" +
        "3️⃣ Clear entire day";

    const rows = [
        { id: "1", title: "Add session" },
        { id: "2", title: "Remove session" },
        { id: "3", title: "Clear day" }
    ];

    appendWhatsAppHomeNavRow(
        rows,
        "doctor"
    );

    const interactive =
        buildInteractiveListSpec(
            rows,
            "Choose"
        );

    return {
        fallbackText: fallbackText,
        interactive: interactive
    };
}


function getDoctorSessionRemoveListSpec(sessions, page) {

    if (
        !sessions ||
        sessions.length === 0
    ) {
        return null;
    }

    const total =
        sessions.length;

    let fallbackText = "";

    sessions.forEach(
        function (session, index) {

            fallbackText +=
                (index + 1) +
                ". " +
                session.start +
                " - " +
                session.end +
                "\n";
        }
    );

    // More than 9 sessions in a single day no longer falls back to a
    // plain numbered text list — paginate like getDoctorSelectionMenuSpec.
    // Row ids stay absolute 1-based indexes into the full list (matching
    // what removeDoctorAvailabilitySession expects), regardless of page.
    const pageInfo =
        getSlotSelectionPageInfo(
            total,
            page || 0
        );

    const visibleSessions =
        sessions.slice(
            pageInfo.start,
            pageInfo.end
        );

    const rows =
        visibleSessions.map(
            function (session, index) {

                return {
                    id: String(pageInfo.start + index + 1),
                    title:
                        session.start +
                        " - " +
                        session.end,
                    description: ""
                };
            }
        );

    if (pageInfo.hasPrev) {

        rows.push({
            id: "session_prev",
            title: "Earlier sessions",
            description: "Previous page"
        });
    }

    if (pageInfo.hasNext) {

        rows.push({
            id: "session_next",
            title: "More sessions",
            description: "Next page"
        });
    }

    appendWhatsAppHomeNavRow(
        rows,
        "doctor"
    );

    const interactive =
        buildInteractiveListSpec(
            rows,
            "Remove session"
        );

    return {
        fallbackText: fallbackText.trim(),
        interactive: interactive,
        page: pageInfo.page,
        totalPages: pageInfo.totalPages,
        hasPrev: pageInfo.hasPrev,
        hasNext: pageInfo.hasNext
    };
}


function getDoctorLeavesMenuSpec() {

    const fallbackText =
        formatDoctorLeavesMenu();

    const rows = [
        {
            id: "1",
            title: "Add single-day leave"
        },
        {
            id: "2",
            title: "View upcoming leaves"
        },
        {
            id: "3",
            title: "Cancel a leave"
        },
        {
            id: "4",
            title: "Add leave range"
        }
    ];

    appendWhatsAppHomeNavRow(
        rows,
        "doctor"
    );

    const interactive =
        buildInteractiveListSpec(
            rows,
            "Manage leaves"
        );

    return {
        fallbackText: fallbackText,
        interactive: interactive
    };
}


function getDoctorLeaveListMenuSpec(leaves) {

    if (
        !leaves ||
        leaves.length === 0
    ) {
        return {
            fallbackText: "No upcoming leaves.",
            interactive: null
        };
    }

    const limit =
        Math.min(leaves.length, 9);

    const listed =
        leaves.slice(0, limit);

    let fallbackText =
        "Upcoming leaves:\n\n";

    const rows =
        listed.map(
            function (leave, index) {

                const line =
                    leave.date +
                    (
                        leave.reason
                            ? " — " + leave.reason
                            : ""
                    );

                fallbackText +=
                    (index + 1) +
                    ". " +
                    line +
                    "\n";

                return {
                    id: String(index + 1),
                    title: leave.date,
                    description:
                        leave.reason || ""
                };
            }
        );

    appendWhatsAppHomeNavRow(
        rows,
        "doctor"
    );

    return {
        fallbackText: fallbackText.trim(),
        interactive:
            buildInteractiveListSpec(
                rows,
                "Select leave"
            )
    };
}


function buildLanguageSelectionIntro() {

    return "🌐 Choose your language.";
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

    sendDoctorAppointmentListMenuReply(
        ss,
        phone,
        "✅ Mark Visit Status",
        "Select the appointment to update:",
        appointments
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
        buildDoctorRescheduleDateIntro(doctorId),
        "doctor"
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
                    getRescheduleConfirmSpec("doctor")
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

    sendDateMenuReply(
        ss,
        phone,
        buildRescheduleDateSelectionIntro({
            doctorId: chosen.doctorId
        })
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

    if (!session) {

        sendWhatsAppReply(
            ss,
            phone,
            opts.expiredMessage ||
                "❌ Your booking session has expired.\n\n" +
                "Please send Hi to start again."
        );

        return;
    }

    const isoDate =
        String(session.date || "").trim();

    if (
        !isoDate ||
        !isValidISODate(isoDate)
    ) {

        sendWhatsAppReply(
            ss,
            phone,
            opts.invalidDateMessage ||
                "❌ The selected date is invalid.\n\n" +
                "Please send Hi to start again."
        );

        return;
    }

    const choice =
        String(normalizedMessage || "")
            .trim()
            .toLowerCase();

    const slotReplyOptions = {
        isoDate: isoDate,
        isReschedule:
            session.state === "RESCHEDULE_TIME" ||
            session.state === "DOCTOR_RESCHEDULE_TIME"
    };

    if (
        choice === "slot_prev" ||
        choice === "prev"
    ) {

        const slots =
            getAvailableSlots(
                session.doctorId,
                isoDate
            );

        const currentPage =
            Number(session.slotPage) || 0;

        const pageInfo =
            getSlotSelectionPageInfo(
                slots.length,
                currentPage
            );

        if (!pageInfo.hasPrev) {

            sendSlotSelectionMenuReply(
                ss,
                phone,
                "❌ Invalid time selection.\n\n" +
                "Please choose one of the available time slots.",
                slots,
                currentPage,
                slotReplyOptions
            );

            return;
        }

        const previousPage =
            currentPage - 1;

        saveWhatsAppSession(
            phone,
            {
                slotPage: previousPage
            }
        );

        sendSlotSelectionMenuReply(
            ss,
            phone,
            "",
            slots,
            previousPage,
            slotReplyOptions
        );

        return;
    }

    if (
        choice === "slot_next" ||
        choice === "next"
    ) {

        const slots =
            getAvailableSlots(
                session.doctorId,
                isoDate
            );

        const currentPage =
            Number(session.slotPage) || 0;

        const pageInfo =
            getSlotSelectionPageInfo(
                slots.length,
                currentPage
            );

        if (!pageInfo.hasNext) {

            sendSlotSelectionMenuReply(
                ss,
                phone,
                "❌ Invalid time selection.\n\n" +
                "Please choose one of the available time slots.",
                slots,
                currentPage,
                slotReplyOptions
            );

            return;
        }

        const nextPage =
            currentPage + 1;

        saveWhatsAppSession(
            phone,
            {
                slotPage: nextPage
            }
        );

        sendSlotSelectionMenuReply(
            ss,
            phone,
            "",
            slots,
            nextPage,
            slotReplyOptions
        );

        return;
    }

    let slotNumber = NaN;

    if (
        choice.indexOf("slot_") === 0
    ) {

        slotNumber =
            parseInt(
                choice.substring(5),
                10
            );

    } else {

        slotNumber =
            parseInt(
                choice,
                10
            );
    }

    const slots =
        getAvailableSlots(
            session.doctorId,
            isoDate
        );

    if (
        !Number.isInteger(slotNumber) ||
        slotNumber < 1 ||
        slotNumber > slots.length
    ) {

        sendSlotSelectionMenuReply(
            ss,
            phone,
            "❌ Invalid time selection.\n\n" +
            "Please choose one of the available time slots.",
            slots,
            Number(session.slotPage) || 0,
            slotReplyOptions
        );

        return;
    }

    const selectedTime =
        slots[slotNumber - 1];

    if (!selectedTime) {

        sendSlotSelectionMenuReply(
            ss,
            phone,
            "❌ That time slot is no longer available.\n\n" +
            "Please choose another time.",
            slots,
            Number(session.slotPage) || 0,
            slotReplyOptions
        );

        return;
    }

    saveWhatsAppSession(phone, {
        slotPage: 0
    });

    if (
        typeof opts.onValidSlot ===
        "function"
    ) {

        opts.onValidSlot(
            selectedTime,
            isoDate
        );

        return;
    }

    sendWhatsAppReply(
        ss,
        phone,
        "❌ Unable to process that time selection.\n\n" +
        "Please try again."
    );
}


function handleWhatsAppAppointmentListSelection(
    ss,
    phone,
    session,
    normalizedMessage,
    options
) {

    const opts = options || {};

    const appointments =
        typeof opts.getAppointments === "function"
            ? opts.getAppointments()
            : getConfirmedAppointmentsForPhone(phone);

    const currentPage =
        session
            ? Number(session.apptPage) || 0
            : 0;

    const pageInfo =
        getSlotSelectionPageInfo(
            appointments.length,
            currentPage
        );

    const listScreen =
        opts.listScreen || "";

    const decision =
        classifyWhatsAppAppointmentListChoice(
            normalizedMessage,
            appointments.length
        );

    if (decision.type === "main_menu") {

        saveWhatsAppSession(phone, {
            role: "PATIENT",
            state: "MAIN_MENU",
            doctorId: "",
            date: "",
            time: "",
            appointmentId: "",
            apptPage: 0
        });

        sendPatientMainMenuReply(
            ss,
            phone,
            "👋 Back to main menu."
        );

        return;
    }

    if (decision.type === "back") {

        goBackInWhatsAppFlow(
            ss,
            phone,
            session
        );

        return;
    }

    if (decision.type === "prev") {

        if (!pageInfo.hasPrev) {

            sendPatientAppointmentListMenuReply(
                ss,
                phone,
                listScreen,
                appointments,
                currentPage,
                "❌ Invalid selection."
            );

            return;
        }

        const previousPage =
            currentPage - 1;

        saveWhatsAppSession(phone, {
            apptPage: previousPage
        });

        sendPatientAppointmentListMenuReply(
            ss,
            phone,
            listScreen,
            appointments,
            previousPage
        );

        return;
    }

    if (decision.type === "next") {

        if (!pageInfo.hasNext) {

            sendPatientAppointmentListMenuReply(
                ss,
                phone,
                listScreen,
                appointments,
                currentPage,
                "❌ Invalid selection."
            );

            return;
        }

        const nextPage =
            currentPage + 1;

        saveWhatsAppSession(phone, {
            apptPage: nextPage
        });

        sendPatientAppointmentListMenuReply(
            ss,
            phone,
            listScreen,
            appointments,
            nextPage
        );

        return;
    }

    if (decision.type !== "selection") {

        sendPatientAppointmentListMenuReply(
            ss,
            phone,
            listScreen,
            appointments,
            currentPage,
            "❌ Invalid selection."
        );

        return;
    }

    saveWhatsAppSession(phone, {
        apptPage: 0
    });

    opts.onChosen(
        appointments[decision.index]
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
    session,
    normalizedMessage
) {

    handleWhatsAppAppointmentListSelection(
        ss,
        senderPhone,
        session,
        normalizedMessage,
        {
            listScreen: "cancel",
            onChosen: function (chosen) {
                saveWhatsAppSession(
                    senderPhone,
                    {
                        state: "CANCEL_CONFIRM",
                        appointmentId:
                            chosen.appointmentId
                    }
                );

                sendCancelConfirmMenuReply(
                    ss,
                    senderPhone,
                    chosen
                );
            }
        }
    );
}


function handleWhatsAppRescheduleSelectState(
    ss,
    senderPhone,
    session,
    normalizedMessage
) {

    handleWhatsAppAppointmentListSelection(
        ss,
        senderPhone,
        session,
        normalizedMessage,
        {
            listScreen: "reschedule",
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


function localizeWhatsAppReply(language, message) {

    const selectedLanguage =
        String(language || "EN").toUpperCase();

    // {{CLINIC_NAME}} is substituted unconditionally further down —
    // both branches below funnel through it, so a source message built
    // with the placeholder (see buildAfterHoursMessage, for example)
    // localizes correctly in every language including English.
    if (selectedLanguage === "EN") {
        return applyClinicNamePlaceholder(
            String(message)
        );
    }

    const translations = {
        TE: {
            "Welcome to {{CLINIC_NAME}}!": "{{CLINIC_NAME}} కు స్వాగతం!",
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
            "Thank you for choosing {{CLINIC_NAME}}.": "{{CLINIC_NAME}} ను ఎంచుకున్నందుకు ధన్యవాదాలు.",
            "Please send Hi to start again.": "మళ్లీ ప్రారంభించడానికి Hi పంపండి.",
            "Sorry, I didn't understand that.": "క్షమించండి, నాకు అర్థం కాలేదు.",
            "Language changed successfully.": "భాష విజయవంతంగా మార్చబడింది.",
            "Please enter your full name to complete the booking.": "బుకింగ్ పూర్తి చేయడానికి దయచేసి మీ పూర్తి పేరు నమోదు చేయండి.",
            "Please confirm your appointment:": "దయచేసి మీ అపాయింట్‌మెంట్‌ను నిర్ధారించండి:",
            "Please enter a valid full name (at least 2 characters).": "దయచేసి సరైన పూర్తి పేరు నమోదు చేయండి (కనీసం 2 అక్షరాలు).",
            "Unable to save your name.": "మీ పేరును సేవ్ చేయలేకపోయాం.",
            "Invalid time selection.": "చెల్లని సమయ ఎంపిక.",
            "Please choose one of the available slots:": "దయచేసి అందుబాటులో ఉన్న సమయాలలో ఒకదాన్ని ఎంచుకోండి:",
            "Invalid selection.": "చెల్లని ఎంపిక.",
            "Date selected:": "ఎంచుకున్న తేదీ:",
            "Appointment Reminder": "అపాయింట్‌మెంట్ రిమైండర్",
            "Reminder: ": "రిమైండర్: ",
            " before your appointment.": " మీ అపాయింట్‌మెంట్‌కు ముందు.",
            "Reply Hi to reschedule or cancel.": "మార్చడానికి లేదా రద్దు చేయడానికి Hi పంపండి.",
            "{{CLINIC_NAME}} is currently closed.": "{{CLINIC_NAME}} ప్రస్తుతం మూసివేయబడింది.",
            "Our hours:": "మా సమయాలు:",
            "Please message us during clinic hours to book or manage appointments.": "అపాయింట్‌మెంట్‌లు బుక్ చేయడానికి లేదా నిర్వహించడానికి క్లినిక్ సమయంలో మాకు సందేశం పంపండి.",
            "Reply Hi during open hours to get started.": "ప్రారంభించడానికి తెరిచి ఉన్న సమయంలో Hi పంపండి.",
            "How can we help you today?": "ఈరోజు మేము మీకు ఎలా సహాయం చేయగలం?",
            "Choose your doctor.": "మీ డాక్టర్‌ను ఎంచుకోండి.",
            "Choose an appointment date.": "అపాయింట్‌మెంట్ తేదీని ఎంచుకోండి.",
            "Choose an available time.": "అందుబాటులో ఉన్న సమయాన్ని ఎంచుకోండి.",
            "Choose a new time.": "కొత్త సమయాన్ని ఎంచుకోండి.",
            "Choose your language.": "మీ భాషను ఎంచుకోండి.",
            "Your appointments": "మీ అపాయింట్‌మెంట్‌లు",
            "Select an appointment.": "అపాయింట్‌మెంట్‌ను ఎంచుకోండి.",
            "Cancel appointment": "అపాయింట్‌మెంట్ రద్దు",
            "Select an appointment to cancel.": "రద్దు చేయడానికి అపాయింట్‌మెంట్‌ను ఎంచుకోండి.",
            "Reschedule appointment": "అపాయింట్‌మెంట్ సమయం మార్చండి",
            "Select an appointment to reschedule.": "మార్చడానికి అపాయింట్‌మెంట్‌ను ఎంచుకోండి.",
            "Choose a new appointment date.": "కొత్త అపాయింట్‌మెంట్ తేదీని ఎంచుకోండి.",
            "✅ Confirm appointment?": "✅ అపాయింట్‌మెంట్‌ను నిర్ధారించాలా?",
            "⚠️ Cancel this appointment?": "⚠️ ఈ అపాయింట్‌మెంట్‌ను రద్దు చేయాలా?",
            "🔄 Confirm reschedule?": "🔄 సమయం మార్పును నిర్ధారించాలా?",
            "Please choose a valid doctor.": "దయచేసి సరైన డాక్టర్‌ను ఎంచుకోండి.",
            "Please choose one of the available time slots.": "దయచేసి అందుబాటులో ఉన్న సమయాలలో ఒకదాన్ని ఎంచుకోండి.",
            "That time slot is no longer available.": "ఆ సమయ స్లాట్ ఇకపై అందుబాటులో లేదు.",
            "Please choose another time.": "దయచేసి వేరే సమయం ఎంచుకోండి.",
            "📅 Enter the appointment date.": "📅 అపాయింట్‌మెంట్ తేదీని నమోదు చేయండి.",
            "📅 Enter the new appointment date.": "📅 కొత్త అపాయింట్‌మెంట్ తేదీని నమోదు చేయండి.",
            "Format: YYYY-MM-DD": "ఫార్మాట్: YYYY-MM-DD",
            "Page ": "పేజీ ",
            " of ": " / ",
            "Other date": "వేరే తేదీ",
            "Other time": "వేరే సమయం",
            "Yes, cancel": "అవును, రద్దు",
            "Earlier times": "మునుపటి సమయాలు",
            "More times": "మరిన్ని సమయాలు",
            "Reschedule": "సమయం మార్చండి",
            "Choose option": "ఎంపికను ఎంచుకోండి",
            "Select appointment": "అపాయింట్‌మెంట్‌ను ఎంచుకోండి",
            "Choose time": "సమయాన్ని ఎంచుకోండి",
            "Select doctor": "డాక్టర్‌ను ఎంచుకోండి",
            "Select language": "భాషను ఎంచుకోండి",
            "Choose language": "భాష ఎంచుకోండి",
            "Invalid selection.": "చెల్లని ఎంపిక.",
            "Options": "ఎంపికలు",
            "No, go back": "లేదు, వెనక్కి",
            "Previous page": "మునుపటి పేజీ",
            "Next page": "తదుపరి పేజీ",
            "More appointments": "మరిన్ని అపాయింట్‌మెంట్‌లు",
            "Earlier appointments": "మునుపటి అపాయింట్‌మెంట్‌లు",
            "Schedule a visit": "సందర్శన షెడ్యూల్ చేయండి",
            "View upcoming": "రాబోయేవి చూడండి",
            "Cancel a booking": "బుకింగ్‌ను రద్దు చేయండి",
            "Change date or time": "తేదీ లేదా సమయం మార్చండి",
            "More": "మరిన్ని",
            "More options": "మరిన్ని ఎంపికలు"
        },
        HI: {
            "Welcome to {{CLINIC_NAME}}!": "{{CLINIC_NAME}} में आपका स्वागत है!",
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
            "Thank you for choosing {{CLINIC_NAME}}.": "{{CLINIC_NAME}} चुनने के लिए धन्यवाद।",
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
            "{{CLINIC_NAME}} is currently closed.": "{{CLINIC_NAME}} अभी बंद है।",
            "Our hours:": "हमारे समय:",
            "Please message us during clinic hours to book or manage appointments.": "अपॉइंटमेंट बुक या प्रबंधित करने के लिए कृपया क्लिनिक के समय में संदेश भेजें।",
            "Reply Hi during open hours to get started.": "शुरू करने के लिए खुले समय में Hi भेजें।",
            "How can we help you today?": "आज हम आपकी कैसे मदद कर सकते हैं?",
            "Choose your doctor.": "अपना डॉक्टर चुनें।",
            "Choose an appointment date.": "अपॉइंटमेंट की तारीख चुनें।",
            "Choose an available time.": "उपलब्ध समय चुनें।",
            "Choose a new time.": "नया समय चुनें।",
            "Choose your language.": "अपनी भाषा चुनें।",
            "Your appointments": "आपके अपॉइंटमेंट",
            "Select an appointment.": "अपॉइंटमेंट चुनें।",
            "Cancel appointment": "अपॉइंटमेंट रद्द करें",
            "Select an appointment to cancel.": "रद्द करने के लिए अपॉइंटमेंट चुनें।",
            "Reschedule appointment": "अपॉइंटमेंट का समय बदलें",
            "Select an appointment to reschedule.": "बदलने के लिए अपॉइंटमेंट चुनें।",
            "Choose a new appointment date.": "नई अपॉइंटमेंट तारीख चुनें।",
            "✅ Confirm appointment?": "✅ अपॉइंटमेंट की पुष्टि करें?",
            "⚠️ Cancel this appointment?": "⚠️ यह अपॉइंटमेंट रद्द करें?",
            "🔄 Confirm reschedule?": "🔄 समय परिवर्तन की पुष्टि करें?",
            "Please choose a valid doctor.": "कृपया सही डॉक्टर चुनें।",
            "Please choose one of the available time slots.": "कृपया उपलब्ध समयों में से एक चुनें।",
            "That time slot is no longer available.": "वह समय अब उपलब्ध नहीं है।",
            "Please choose another time.": "कृपया दूसरा समय चुनें।",
            "📅 Enter the appointment date.": "📅 अपॉइंटमेंट की तारीख दर्ज करें।",
            "📅 Enter the new appointment date.": "📅 नई अपॉइंटमेंट तारीख दर्ज करें।",
            "Format: YYYY-MM-DD": "प्रारूप: YYYY-MM-DD",
            "Page ": "पृष्ठ ",
            " of ": " / ",
            "Other date": "दूसरी तारीख",
            "Other time": "दूसरा समय",
            "Yes, cancel": "हां, रद्द करें",
            "Earlier times": "पिछले समय",
            "More times": "और समय",
            "Reschedule": "समय बदलें",
            "Choose option": "विकल्प चुनें",
            "Select appointment": "अपॉइंटमेंट चुनें",
            "Choose time": "समय चुनें",
            "Select doctor": "डॉक्टर चुनें",
            "Select language": "भाषा चुनें",
            "Choose language": "भाषा चुनें",
            "Invalid selection.": "अमान्य चयन।",
            "Options": "विकल्प",
            "No, go back": "नहीं, वापस जाएं",
            "Previous page": "पिछला पृष्ठ",
            "Next page": "अगला पृष्ठ",
            "More appointments": "और अपॉइंटमेंट",
            "Earlier appointments": "पिछले अपॉइंटमेंट",
            "Schedule a visit": "विज़िट शेड्यूल करें",
            "View upcoming": "आगामी देखें",
            "Cancel a booking": "बुकिंग रद्द करें",
            "Change date or time": "तारीख या समय बदलें",
            "More": "और",
            "More options": "और विकल्प"
        },

        // NOTE: KA/TA/ML translations below are an initial AI-assisted pass,
        // not yet reviewed by a native speaker. Treat as a starting point —
        // verify against real clinic usage before relying on them in
        // production, especially for time/date-sensitive phrases.
        KA: {
            "Welcome to {{CLINIC_NAME}}!": "{{CLINIC_NAME}} ಗೆ ಸ್ವಾಗತ!",
            "Please choose an option:": "ದಯವಿಟ್ಟು ಒಂದು ಆಯ್ಕೆಯನ್ನು ಆರಿಸಿ:",
            "Book Appointment": "ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಬುಕ್ ಮಾಡಿ",
            "My Appointments": "ನನ್ನ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್‌ಗಳು",
            "Cancel Appointment": "ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ರದ್ದುಗೊಳಿಸಿ",
            "Reschedule Appointment": "ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಮರುಹೊಂದಿಸಿ",
            "Change Language": "ಭಾಷೆ ಬದಲಾಯಿಸಿ",
            "Select a doctor:": "ವೈದ್ಯರನ್ನು ಆಯ್ಕೆಮಾಡಿ:",
            "Reply with the doctor's number.": "ವೈದ್ಯರ ಸಂಖ್ಯೆಯೊಂದಿಗೆ ಉತ್ತರಿಸಿ.",
            "Please choose a date:": "ದಯವಿಟ್ಟು ದಿನಾಂಕವನ್ನು ಆರಿಸಿ:",
            "Today": "ಇಂದು",
            "Tomorrow": "ನಾಳೆ",
            "Enter another date": "ಬೇರೆ ದಿನಾಂಕವನ್ನು ನಮೂದಿಸಿ",
            "Available slots:": "ಲಭ್ಯವಿರುವ ಸಮಯಗಳು:",
            "Please choose a time.": "ದಯವಿಟ್ಟು ಸಮಯವನ್ನು ಆರಿಸಿ.",
            "Confirm appointment?": "ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ದೃಢೀಕರಿಸುವುದೇ?",
            "Confirm": "ದೃಢೀಕರಿಸಿ",
            "Choose another time": "ಬೇರೆ ಸಮಯ ಆರಿಸಿ",
            "Cancel": "ರದ್ದುಗೊಳಿಸಿ",
            "Back to Main Menu": "ಮುಖ್ಯ ಮೆನುಗೆ ಹಿಂತಿರುಗಿ",
            "Back to main menu.": "ಮುಖ್ಯ ಮೆನುಗೆ ಹಿಂತಿರುಗಿದ್ದೀರಿ.",
            "Main Menu": "ಮುಖ್ಯ ಮೆನು",
            "Back": "ಹಿಂದೆ",
            "Invalid option.": "ಅಮಾನ್ಯ ಆಯ್ಕೆ.",
            "Please reply with:": "ದಯವಿಟ್ಟು ಇದರೊಂದಿಗೆ ಉತ್ತರಿಸಿ:",
            "Please enter the date in YYYY-MM-DD format.": "ದಯವಿಟ್ಟು ದಿನಾಂಕವನ್ನು YYYY-MM-DD ಸ್ವರೂಪದಲ್ಲಿ ನಮೂದಿಸಿ.",
            "Please enter the new date in YYYY-MM-DD format.": "ದಯವಿಟ್ಟು ಹೊಸ ದಿನಾಂಕವನ್ನು YYYY-MM-DD ಸ್ವರೂಪದಲ್ಲಿ ನಮೂದಿಸಿ.",
            "Example:": "ಉದಾಹರಣೆ:",
            "Your Appointments:": "ನಿಮ್ಮ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್‌ಗಳು:",
            "Select the appointment to cancel:": "ರದ್ದುಗೊಳಿಸಲು ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಆಯ್ಕೆಮಾಡಿ:",
            "Select the appointment to reschedule:": "ಮರುಹೊಂದಿಸಲು ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಆಯ್ಕೆಮಾಡಿ:",
            "Yes, cancel it": "ಹೌದು, ರದ್ದುಗೊಳಿಸಿ",
            "No, go back": "ಇಲ್ಲ, ಹಿಂದೆ ಹೋಗಿ",
            "Doctor selected:": "ಆಯ್ಕೆಮಾಡಿದ ವೈದ್ಯರು:",
            "Doctor:": "ವೈದ್ಯರು:",
            "Patient:": "ರೋಗಿ:",
            "Date:": "ದಿನಾಂಕ:",
            "Time:": "ಸಮಯ:",
            "New Date:": "ಹೊಸ ದಿನಾಂಕ:",
            "New Time:": "ಹೊಸ ಸಮಯ:",
            "Appointment ID:": "ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಐಡಿ:",
            "Appointment confirmed!": "ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ದೃಢೀಕರಿಸಲಾಗಿದೆ!",
            "Appointment cancelled successfully.": "ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಯಶಸ್ವಿಯಾಗಿ ರದ್ದುಗೊಳಿಸಲಾಗಿದೆ.",
            "Appointment booking cancelled.": "ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಬುಕಿಂಗ್ ರದ್ದುಗೊಳಿಸಲಾಗಿದೆ.",
            "Reschedule cancelled.": "ಮರುಹೊಂದಿಕೆ ರದ್ದುಗೊಳಿಸಲಾಗಿದೆ.",
            "Confirm reschedule?": "ಮರುಹೊಂದಿಕೆ ದೃಢೀಕರಿಸುವುದೇ?",
            "Please choose a new date:": "ದಯವಿಟ್ಟು ಹೊಸ ದಿನಾಂಕವನ್ನು ಆರಿಸಿ:",
            "Please choose a valid doctor number.": "ದಯವಿಟ್ಟು ಮಾನ್ಯ ವೈದ್ಯರ ಸಂಖ್ಯೆಯನ್ನು ಆರಿಸಿ.",
            "Sorry, there are no available slots on ": "ಕ್ಷಮಿಸಿ, ಈ ದಿನಾಂಕದಂದು ಯಾವುದೇ ಸಮಯಗಳು ಲಭ್ಯವಿಲ್ಲ ",
            "Please choose another date.": "ದಯವಿಟ್ಟು ಬೇರೆ ದಿನಾಂಕವನ್ನು ಆರಿಸಿ.",
            "No available slots remain for ": "ಇದಕ್ಕೆ ಯಾವುದೇ ಸಮಯಗಳು ಉಳಿದಿಲ್ಲ ",
            "Your booking session has expired.": "ನಿಮ್ಮ ಬುಕಿಂಗ್ ಅವಧಿ ಮುಕ್ತಾಯಗೊಂಡಿದೆ.",
            "Your reschedule session has expired.": "ನಿಮ್ಮ ಮರುಹೊಂದಿಕೆ ಅವಧಿ ಮುಕ್ತಾಯಗೊಂಡಿದೆ.",
            "Thank you for choosing {{CLINIC_NAME}}.": "{{CLINIC_NAME}} ಆಯ್ಕೆ ಮಾಡಿದ್ದಕ್ಕೆ ಧನ್ಯವಾದಗಳು.",
            "Please send Hi to start again.": "ಮತ್ತೆ ಪ್ರಾರಂಭಿಸಲು ದಯವಿಟ್ಟು Hi ಕಳುಹಿಸಿ.",
            "Sorry, I didn't understand that.": "ಕ್ಷಮಿಸಿ, ನನಗೆ ಅರ್ಥವಾಗಲಿಲ್ಲ.",
            "Language changed successfully.": "ಭಾಷೆ ಯಶಸ್ವಿಯಾಗಿ ಬದಲಾಯಿಸಲಾಗಿದೆ.",
            "Please enter your full name to complete the booking.": "ಬುಕಿಂಗ್ ಪೂರ್ಣಗೊಳಿಸಲು ದಯವಿಟ್ಟು ನಿಮ್ಮ ಪೂರ್ಣ ಹೆಸರನ್ನು ನಮೂದಿಸಿ.",
            "Please confirm your appointment:": "ದಯವಿಟ್ಟು ನಿಮ್ಮ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ದೃಢೀಕರಿಸಿ:",
            "Please enter a valid full name (at least 2 characters).": "ದಯವಿಟ್ಟು ಮಾನ್ಯ ಪೂರ್ಣ ಹೆಸರನ್ನು ನಮೂದಿಸಿ (ಕನಿಷ್ಠ 2 ಅಕ್ಷರಗಳು).",
            "Unable to save your name.": "ನಿಮ್ಮ ಹೆಸರನ್ನು ಉಳಿಸಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ.",
            "Invalid time selection.": "ಅಮಾನ್ಯ ಸಮಯ ಆಯ್ಕೆ.",
            "Please choose one of the available slots:": "ದಯವಿಟ್ಟು ಲಭ್ಯವಿರುವ ಸಮಯಗಳಲ್ಲಿ ಒಂದನ್ನು ಆರಿಸಿ:",
            "Invalid selection.": "ಅಮಾನ್ಯ ಆಯ್ಕೆ.",
            "Date selected:": "ಆಯ್ಕೆಮಾಡಿದ ದಿನಾಂಕ:",
            "Appointment Reminder": "ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಜ್ಞಾಪನೆ",
            "Reminder: ": "ಜ್ಞಾಪನೆ: ",
            " before your appointment.": " ನಿಮ್ಮ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್‌ಗೆ ಮೊದಲು.",
            "Reply Hi to reschedule or cancel.": "ಮರುಹೊಂದಿಸಲು ಅಥವಾ ರದ್ದುಗೊಳಿಸಲು Hi ಎಂದು ಉತ್ತರಿಸಿ.",
            "{{CLINIC_NAME}} is currently closed.": "{{CLINIC_NAME}} ಪ್ರಸ್ತುತ ಮುಚ್ಚಿದೆ.",
            "Our hours:": "ನಮ್ಮ ಸಮಯ:",
            "Please message us during clinic hours to book or manage appointments.": "ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಬುಕ್ ಮಾಡಲು ಅಥವಾ ನಿರ್ವಹಿಸಲು ದಯವಿಟ್ಟು ಕ್ಲಿನಿಕ್ ಸಮಯದಲ್ಲಿ ನಮಗೆ ಸಂದೇಶ ಕಳುಹಿಸಿ.",
            "Reply Hi during open hours to get started.": "ಪ್ರಾರಂಭಿಸಲು ತೆರೆದಿರುವ ಸಮಯದಲ್ಲಿ Hi ಎಂದು ಉತ್ತರಿಸಿ.",
            "How can we help you today?": "ಇಂದು ನಾವು ನಿಮಗೆ ಹೇಗೆ ಸಹಾಯ ಮಾಡಬಹುದು?",
            "Choose your doctor.": "ನಿಮ್ಮ ವೈದ್ಯರನ್ನು ಆರಿಸಿ.",
            "Choose an appointment date.": "ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ದಿನಾಂಕವನ್ನು ಆರಿಸಿ.",
            "Choose an available time.": "ಲಭ್ಯವಿರುವ ಸಮಯವನ್ನು ಆರಿಸಿ.",
            "Choose a new time.": "ಹೊಸ ಸಮಯವನ್ನು ಆರಿಸಿ.",
            "Choose your language.": "ನಿಮ್ಮ ಭಾಷೆಯನ್ನು ಆರಿಸಿ.",
            "Your appointments": "ನಿಮ್ಮ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್‌ಗಳು",
            "Select an appointment.": "ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಆಯ್ಕೆಮಾಡಿ.",
            "Cancel appointment": "ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ರದ್ದುಗೊಳಿಸಿ",
            "Select an appointment to cancel.": "ರದ್ದುಗೊಳಿಸಲು ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಆಯ್ಕೆಮಾಡಿ.",
            "Reschedule appointment": "ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಮರುಹೊಂದಿಸಿ",
            "Select an appointment to reschedule.": "ಮರುಹೊಂದಿಸಲು ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಆಯ್ಕೆಮಾಡಿ.",
            "Choose a new appointment date.": "ಹೊಸ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ದಿನಾಂಕವನ್ನು ಆರಿಸಿ.",
            "✅ Confirm appointment?": "✅ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ದೃಢೀಕರಿಸುವುದೇ?",
            "⚠️ Cancel this appointment?": "⚠️ ಈ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ರದ್ದುಗೊಳಿಸುವುದೇ?",
            "🔄 Confirm reschedule?": "🔄 ಮರುಹೊಂದಿಕೆ ದೃಢೀಕರಿಸುವುದೇ?",
            "Please choose a valid doctor.": "ದಯವಿಟ್ಟು ಮಾನ್ಯ ವೈದ್ಯರನ್ನು ಆರಿಸಿ.",
            "Please choose one of the available time slots.": "ದಯವಿಟ್ಟು ಲಭ್ಯವಿರುವ ಸಮಯಗಳಲ್ಲಿ ಒಂದನ್ನು ಆರಿಸಿ.",
            "That time slot is no longer available.": "ಆ ಸಮಯ ಸ್ಲಾಟ್ ಇನ್ನು ಲಭ್ಯವಿಲ್ಲ.",
            "Please choose another time.": "ದಯವಿಟ್ಟು ಬೇರೆ ಸಮಯ ಆರಿಸಿ.",
            "📅 Enter the appointment date.": "📅 ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ದಿನಾಂಕವನ್ನು ನಮೂದಿಸಿ.",
            "📅 Enter the new appointment date.": "📅 ಹೊಸ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ದಿನಾಂಕವನ್ನು ನಮೂದಿಸಿ.",
            "Format: YYYY-MM-DD": "ಸ್ವರೂಪ: YYYY-MM-DD",
            "Page ": "ಪುಟ ",
            " of ": " / ",
            "Other date": "ಬೇರೆ ದಿನಾಂಕ",
            "Other time": "ಬೇರೆ ಸಮಯ",
            "Yes, cancel": "ಹೌದು, ರದ್ದು",
            "Earlier times": "ಹಿಂದಿನ ಸಮಯ",
            "More times": "ಹೆಚ್ಚು ಸಮಯ",
            "Reschedule": "ಮರುಹೊಂದಿಸಿ",
            "Choose option": "ಆಯ್ಕೆಯನ್ನು ಆರಿಸಿ",
            "Select appointment": "ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಆರಿಸಿ",
            "Choose time": "ಸಮಯ ಆರಿಸಿ",
            "Select doctor": "ವೈದ್ಯರನ್ನು ಆರಿಸಿ",
            "Select language": "ಭಾಷೆ ಆರಿಸಿ",
            "Choose language": "ಭಾಷೆ ಆರಿಸಿ",
            "Invalid selection.": "ಅಮಾನ್ಯ ಆಯ್ಕೆ.",
            "Options": "ಆಯ್ಕೆಗಳು",
            "No, go back": "ಇಲ್ಲ, ಹಿಂದೆ ಹೋಗಿ",
            "Previous page": "ಹಿಂದಿನ ಪುಟ",
            "Next page": "ಮುಂದಿನ ಪುಟ",
            "More appointments": "ಹೆಚ್ಚು ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್‌ಗಳು",
            "Earlier appointments": "ಹಿಂದಿನ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್‌ಗಳು",
            "Schedule a visit": "ಭೇಟಿ ನಿಗದಿಪಡಿಸಿ",
            "View upcoming": "ಮುಂದಿನವುಗಳನ್ನು ನೋಡಿ",
            "Cancel a booking": "ಬುಕಿಂಗ್ ರದ್ದುಗೊಳಿಸಿ",
            "Change date or time": "ದಿನಾಂಕ ಅಥವಾ ಸಮಯ ಬದಲಾಯಿಸಿ",
            "More": "ಇನ್ನಷ್ಟು",
            "More options": "ಹೆಚ್ಚಿನ ಆಯ್ಕೆಗಳು"
        },

        TA: {
            "Welcome to {{CLINIC_NAME}}!": "{{CLINIC_NAME}}க்கு வரவேற்கிறோம்!",
            "Please choose an option:": "தயவுசெய்து ஒரு விருப்பத்தைத் தேர்ந்தெடுக்கவும்:",
            "Book Appointment": "அப்பாயின்ட்மென்ட் பதிவு செய்யவும்",
            "My Appointments": "எனது அப்பாயின்ட்மென்ட்கள்",
            "Cancel Appointment": "அப்பாயின்ட்மென்டை ரத்து செய்யவும்",
            "Reschedule Appointment": "அப்பாயின்ட்மென்டை மாற்றியமைக்கவும்",
            "Change Language": "மொழியை மாற்றவும்",
            "Select a doctor:": "மருத்துவரைத் தேர்ந்தெடுக்கவும்:",
            "Reply with the doctor's number.": "மருத்துவரின் எண்ணுடன் பதிலளிக்கவும்.",
            "Please choose a date:": "தயவுசெய்து தேதியைத் தேர்ந்தெடுக்கவும்:",
            "Today": "இன்று",
            "Tomorrow": "நாளை",
            "Enter another date": "வேறு தேதியை உள்ளிடவும்",
            "Available slots:": "கிடைக்கும் நேரங்கள்:",
            "Please choose a time.": "தயவுசெய்து நேரத்தைத் தேர்ந்தெடுக்கவும்.",
            "Confirm appointment?": "அப்பாயின்ட்மென்டை உறுதிப்படுத்தவா?",
            "Confirm": "உறுதிப்படுத்து",
            "Choose another time": "வேறு நேரத்தைத் தேர்ந்தெடு",
            "Cancel": "ரத்து செய்",
            "Back to Main Menu": "முதன்மை மெனுவிற்குத் திரும்பு",
            "Back to main menu.": "முதன்மை மெனுவிற்குத் திரும்பியுள்ளீர்கள்.",
            "Main Menu": "முதன்மை மெனு",
            "Back": "பின்செல்",
            "Invalid option.": "தவறான விருப்பம்.",
            "Please reply with:": "தயவுசெய்து இதனுடன் பதிலளிக்கவும்:",
            "Please enter the date in YYYY-MM-DD format.": "தயவுசெய்து தேதியை YYYY-MM-DD வடிவத்தில் உள்ளிடவும்.",
            "Please enter the new date in YYYY-MM-DD format.": "தயவுசெய்து புதிய தேதியை YYYY-MM-DD வடிவத்தில் உள்ளிடவும்.",
            "Example:": "எடுத்துக்காட்டு:",
            "Your Appointments:": "உங்கள் அப்பாயின்ட்மென்ட்கள்:",
            "Select the appointment to cancel:": "ரத்து செய்ய அப்பாயின்ட்மென்டைத் தேர்ந்தெடுக்கவும்:",
            "Select the appointment to reschedule:": "மாற்றியமைக்க அப்பாயின்ட்மென்டைத் தேர்ந்தெடுக்கவும்:",
            "Yes, cancel it": "ஆம், ரத்து செய்யவும்",
            "No, go back": "இல்லை, திரும்பிச் செல்",
            "Doctor selected:": "தேர்ந்தெடுக்கப்பட்ட மருத்துவர்:",
            "Doctor:": "மருத்துவர்:",
            "Patient:": "நோயாளி:",
            "Date:": "தேதி:",
            "Time:": "நேரம்:",
            "New Date:": "புதிய தேதி:",
            "New Time:": "புதிய நேரம்:",
            "Appointment ID:": "அப்பாயின்ட்மென்ட் ஐடி:",
            "Appointment confirmed!": "அப்பாயின்ட்மென்ட் உறுதிசெய்யப்பட்டது!",
            "Appointment cancelled successfully.": "அப்பாயின்ட்மென்ட் வெற்றிகரமாக ரத்து செய்யப்பட்டது.",
            "Appointment booking cancelled.": "அப்பாயின்ட்மென்ட் பதிவு ரத்து செய்யப்பட்டது.",
            "Reschedule cancelled.": "மாற்றியமைத்தல் ரத்து செய்யப்பட்டது.",
            "Confirm reschedule?": "மாற்றியமைப்பதை உறுதிப்படுத்தவா?",
            "Please choose a new date:": "தயவுசெய்து புதிய தேதியைத் தேர்ந்தெடுக்கவும்:",
            "Please choose a valid doctor number.": "தயவுசெய்து சரியான மருத்துவர் எண்ணைத் தேர்ந்தெடுக்கவும்.",
            "Sorry, there are no available slots on ": "மன்னிக்கவும், இந்த தேதியில் நேரங்கள் எதுவும் இல்லை ",
            "Please choose another date.": "தயவுசெய்து வேறு தேதியைத் தேர்ந்தெடுக்கவும்.",
            "No available slots remain for ": "இதற்கு நேரங்கள் எதுவும் மீதமில்லை ",
            "Your booking session has expired.": "உங்கள் பதிவு அமர்வு காலாவதியானது.",
            "Your reschedule session has expired.": "உங்கள் மாற்றியமைப்பு அமர்வு காலாவதியானது.",
            "Thank you for choosing {{CLINIC_NAME}}.": "{{CLINIC_NAME}}-ஐத் தேர்ந்தெடுத்ததற்கு நன்றி.",
            "Please send Hi to start again.": "மீண்டும் தொடங்க தயவுசெய்து Hi அனுப்பவும்.",
            "Sorry, I didn't understand that.": "மன்னிக்கவும், எனக்கு அது புரியவில்லை.",
            "Language changed successfully.": "மொழி வெற்றிகரமாக மாற்றப்பட்டது.",
            "Please enter your full name to complete the booking.": "பதிவை முடிக்க தயவுசெய்து உங்கள் முழுப் பெயரை உள்ளிடவும்.",
            "Please confirm your appointment:": "தயவுசெய்து உங்கள் அப்பாயின்ட்மென்டை உறுதிப்படுத்தவும்:",
            "Please enter a valid full name (at least 2 characters).": "தயவுசெய்து சரியான முழுப் பெயரை உள்ளிடவும் (குறைந்தது 2 எழுத்துகள்).",
            "Unable to save your name.": "உங்கள் பெயரைச் சேமிக்க முடியவில்லை.",
            "Invalid time selection.": "தவறான நேரத் தேர்வு.",
            "Please choose one of the available slots:": "தயவுசெய்து கிடைக்கும் நேரங்களில் ஒன்றைத் தேர்ந்தெடுக்கவும்:",
            "Invalid selection.": "தவறான தேர்வு.",
            "Date selected:": "தேர்ந்தெடுக்கப்பட்ட தேதி:",
            "Appointment Reminder": "அப்பாயின்ட்மென்ட் நினைவூட்டல்",
            "Reminder: ": "நினைவூட்டல்: ",
            " before your appointment.": " உங்கள் அப்பாயின்ட்மென்டுக்கு முன்.",
            "Reply Hi to reschedule or cancel.": "மாற்றியமைக்க அல்லது ரத்து செய்ய Hi என பதிலளிக்கவும்.",
            "{{CLINIC_NAME}} is currently closed.": "{{CLINIC_NAME}} தற்போது மூடப்பட்டுள்ளது.",
            "Our hours:": "எங்கள் நேரம்:",
            "Please message us during clinic hours to book or manage appointments.": "அப்பாயின்ட்மென்ட் பதிவு செய்ய அல்லது நிர்வகிக்க கிளினிக் நேரத்தில் எங்களுக்கு செய்தி அனுப்பவும்.",
            "Reply Hi during open hours to get started.": "தொடங்க திறந்திருக்கும் நேரத்தில் Hi என பதிலளிக்கவும்.",
            "How can we help you today?": "இன்று நாங்கள் உங்களுக்கு எப்படி உதவலாம்?",
            "Choose your doctor.": "உங்கள் மருத்துவரைத் தேர்ந்தெடுக்கவும்.",
            "Choose an appointment date.": "அப்பாயின்ட்மென்ட் தேதியைத் தேர்ந்தெடுக்கவும்.",
            "Choose an available time.": "கிடைக்கும் நேரத்தைத் தேர்ந்தெடுக்கவும்.",
            "Choose a new time.": "புதிய நேரத்தைத் தேர்ந்தெடுக்கவும்.",
            "Choose your language.": "உங்கள் மொழியைத் தேர்ந்தெடுக்கவும்.",
            "Your appointments": "உங்கள் அப்பாயின்ட்மென்ட்கள்",
            "Select an appointment.": "அப்பாயின்ட்மென்டைத் தேர்ந்தெடுக்கவும்.",
            "Cancel appointment": "அப்பாயின்ட்மென்டை ரத்து செய்யவும்",
            "Select an appointment to cancel.": "ரத்து செய்ய அப்பாயின்ட்மென்டைத் தேர்ந்தெடுக்கவும்.",
            "Reschedule appointment": "அப்பாயின்ட்மென்டை மாற்றியமைக்கவும்",
            "Select an appointment to reschedule.": "மாற்றியமைக்க அப்பாயின்ட்மென்டைத் தேர்ந்தெடுக்கவும்.",
            "Choose a new appointment date.": "புதிய அப்பாயின்ட்மென்ட் தேதியைத் தேர்ந்தெடுக்கவும்.",
            "✅ Confirm appointment?": "✅ அப்பாயின்ட்மென்டை உறுதிப்படுத்தவா?",
            "⚠️ Cancel this appointment?": "⚠️ இந்த அப்பாயின்ட்மென்டை ரத்து செய்யவா?",
            "🔄 Confirm reschedule?": "🔄 மாற்றியமைப்பை உறுதிப்படுத்தவா?",
            "Please choose a valid doctor.": "தயவுசெய்து சரியான மருத்துவரைத் தேர்ந்தெடுக்கவும்.",
            "Please choose one of the available time slots.": "தயவுசெய்து கிடைக்கும் நேரங்களில் ஒன்றைத் தேர்ந்தெடுக்கவும்.",
            "That time slot is no longer available.": "அந்த நேரம் இனி கிடைக்கவில்லை.",
            "Please choose another time.": "தயவுசெய்து வேறு நேரத்தைத் தேர்ந்தெடுக்கவும்.",
            "📅 Enter the appointment date.": "📅 அப்பாயின்ட்மென்ட் தேதியை உள்ளிடவும்.",
            "📅 Enter the new appointment date.": "📅 புதிய அப்பாயின்ட்மென்ட் தேதியை உள்ளிடவும்.",
            "Format: YYYY-MM-DD": "வடிவம்: YYYY-MM-DD",
            "Page ": "பக்கம் ",
            " of ": " / ",
            "Other date": "வேறு தேதி",
            "Other time": "வேறு நேரம்",
            "Yes, cancel": "ஆம், ரத்து",
            "Earlier times": "முந்தைய நேரம்",
            "More times": "மேலும் நேரம்",
            "Reschedule": "மாற்றியமை",
            "Choose option": "விருப்பத்தைத் தேர்ந்தெடுக்கவும்",
            "Select appointment": "அப்பாயின்ட்மென்டைத் தேர்ந்தெடுக்கவும்",
            "Choose time": "நேரத்தைத் தேர்ந்தெடுக்கவும்",
            "Select doctor": "மருத்துவரைத் தேர்ந்தெடுக்கவும்",
            "Select language": "மொழியைத் தேர்ந்தெடுக்கவும்",
            "Choose language": "மொழியைத் தேர்ந்தெடுக்கவும்",
            "Invalid selection.": "தவறான தேர்வு.",
            "Options": "விருப்பங்கள்",
            "No, go back": "இல்லை, திரும்பிச் செல்லுங்கள்",
            "Previous page": "முந்தைய பக்கம்",
            "Next page": "அடுத்த பக்கம்",
            "More appointments": "மேலும் அப்பாயின்ட்மென்ட்கள்",
            "Earlier appointments": "முந்தைய அப்பாயின்ட்மென்ட்கள்",
            "Schedule a visit": "வருகையை திட்டமிடுங்கள்",
            "View upcoming": "வரவிருப்பவை பாருங்கள்",
            "Cancel a booking": "பதிவை ரத்து செய்யுங்கள்",
            "Change date or time": "தேதி அல்லது நேரத்தை மாற்றுங்கள்",
            "More": "மேலும்",
            "More options": "மேலும் விருப்பங்கள்"
        },

        ML: {
            "Welcome to {{CLINIC_NAME}}!": "{{CLINIC_NAME}} ലേക്ക് സ്വാഗതം!",
            "Please choose an option:": "ദയവായി ഒരു ഓപ്ഷൻ തിരഞ്ഞെടുക്കുക:",
            "Book Appointment": "അപ്പോയിന്റ്മെന്റ് ബുക്ക് ചെയ്യുക",
            "My Appointments": "എന്റെ അപ്പോയിന്റ്മെന്റുകൾ",
            "Cancel Appointment": "അപ്പോയിന്റ്മെന്റ് റദ്ദാക്കുക",
            "Reschedule Appointment": "അപ്പോയിന്റ്മെന്റ് പുനഃക്രമീകരിക്കുക",
            "Change Language": "ഭാഷ മാറ്റുക",
            "Select a doctor:": "ഒരു ഡോക്ടറെ തിരഞ്ഞെടുക്കുക:",
            "Reply with the doctor's number.": "ഡോക്ടറുടെ നമ്പർ ഉപയോഗിച്ച് മറുപടി നൽകുക.",
            "Please choose a date:": "ദയവായി ഒരു തീയതി തിരഞ്ഞെടുക്കുക:",
            "Today": "ഇന്ന്",
            "Tomorrow": "നാളെ",
            "Enter another date": "മറ്റൊരു തീയതി നൽകുക",
            "Available slots:": "ലഭ്യമായ സമയങ്ങൾ:",
            "Please choose a time.": "ദയവായി ഒരു സമയം തിരഞ്ഞെടുക്കുക.",
            "Confirm appointment?": "അപ്പോയിന്റ്മെന്റ് സ്ഥിരീകരിക്കണോ?",
            "Confirm": "സ്ഥിരീകരിക്കുക",
            "Choose another time": "മറ്റൊരു സമയം തിരഞ്ഞെടുക്കുക",
            "Cancel": "റദ്ദാക്കുക",
            "Back to Main Menu": "പ്രധാന മെനുവിലേക്ക് മടങ്ങുക",
            "Back to main menu.": "പ്രധാന മെനുവിലേക്ക് മടങ്ങി.",
            "Main Menu": "പ്രധാന മെനു",
            "Back": "തിരികെ",
            "Invalid option.": "അസാധുവായ ഓപ്ഷൻ.",
            "Please reply with:": "ദയവായി ഇതുപയോഗിച്ച് മറുപടി നൽകുക:",
            "Please enter the date in YYYY-MM-DD format.": "ദയവായി തീയതി YYYY-MM-DD ഫോർമാറ്റിൽ നൽകുക.",
            "Please enter the new date in YYYY-MM-DD format.": "ദയവായി പുതിയ തീയതി YYYY-MM-DD ഫോർമാറ്റിൽ നൽകുക.",
            "Example:": "ഉദാഹരണം:",
            "Your Appointments:": "നിങ്ങളുടെ അപ്പോയിന്റ്മെന്റുകൾ:",
            "Select the appointment to cancel:": "റദ്ദാക്കാനുള്ള അപ്പോയിന്റ്മെന്റ് തിരഞ്ഞെടുക്കുക:",
            "Select the appointment to reschedule:": "പുനഃക്രമീകരിക്കാനുള്ള അപ്പോയിന്റ്മെന്റ് തിരഞ്ഞെടുക്കുക:",
            "Yes, cancel it": "അതെ, റദ്ദാക്കുക",
            "No, go back": "ഇല്ല, തിരികെ പോകുക",
            "Doctor selected:": "തിരഞ്ഞെടുത്ത ഡോക്ടർ:",
            "Doctor:": "ഡോക്ടർ:",
            "Patient:": "രോഗി:",
            "Date:": "തീയതി:",
            "Time:": "സമയം:",
            "New Date:": "പുതിയ തീയതി:",
            "New Time:": "പുതിയ സമയം:",
            "Appointment ID:": "അപ്പോയിന്റ്മെന്റ് ഐഡി:",
            "Appointment confirmed!": "അപ്പോയിന്റ്മെന്റ് സ്ഥിരീകരിച്ചു!",
            "Appointment cancelled successfully.": "അപ്പോയിന്റ്മെന്റ് വിജയകരമായി റദ്ദാക്കി.",
            "Appointment booking cancelled.": "അപ്പോയിന്റ്മെന്റ് ബുക്കിംഗ് റദ്ദാക്കി.",
            "Reschedule cancelled.": "പുനഃക്രമീകരണം റദ്ദാക്കി.",
            "Confirm reschedule?": "പുനഃക്രമീകരണം സ്ഥിരീകരിക്കണോ?",
            "Please choose a new date:": "ദയവായി ഒരു പുതിയ തീയതി തിരഞ്ഞെടുക്കുക:",
            "Please choose a valid doctor number.": "ദയവായി സാധുവായ ഡോക്ടർ നമ്പർ തിരഞ്ഞെടുക്കുക.",
            "Sorry, there are no available slots on ": "ക്ഷമിക്കണം, ഈ തീയതിയിൽ സമയങ്ങളൊന്നും ലഭ്യമല്ല ",
            "Please choose another date.": "ദയവായി മറ്റൊരു തീയതി തിരഞ്ഞെടുക്കുക.",
            "No available slots remain for ": "ഇതിനായി സമയങ്ങളൊന്നും ബാക്കിയില്ല ",
            "Your booking session has expired.": "നിങ്ങളുടെ ബുക്കിംഗ് സെഷൻ കാലഹരണപ്പെട്ടു.",
            "Your reschedule session has expired.": "നിങ്ങളുടെ പുനഃക്രമീകരണ സെഷൻ കാലഹരണപ്പെട്ടു.",
            "Thank you for choosing {{CLINIC_NAME}}.": "{{CLINIC_NAME}} തിരഞ്ഞെടുത്തതിന് നന്ദി.",
            "Please send Hi to start again.": "വീണ്ടും തുടങ്ങാൻ ദയവായി Hi അയയ്ക്കുക.",
            "Sorry, I didn't understand that.": "ക്ഷമിക്കണം, എനിക്ക് അത് മനസ്സിലായില്ല.",
            "Language changed successfully.": "ഭാഷ വിജയകരമായി മാറ്റി.",
            "Please enter your full name to complete the booking.": "ബുക്കിംഗ് പൂർത്തിയാക്കാൻ ദയവായി നിങ്ങളുടെ പൂർണ്ണ നാമം നൽകുക.",
            "Please confirm your appointment:": "ദയവായി നിങ്ങളുടെ അപ്പോയിന്റ്മെന്റ് സ്ഥിരീകരിക്കുക:",
            "Please enter a valid full name (at least 2 characters).": "ദയവായി സാധുവായ പൂർണ്ണ നാമം നൽകുക (കുറഞ്ഞത് 2 അക്ഷരങ്ങൾ).",
            "Unable to save your name.": "നിങ്ങളുടെ പേര് സേവ് ചെയ്യാൻ കഴിഞ്ഞില്ല.",
            "Invalid time selection.": "അസാധുവായ സമയ തിരഞ്ഞെടുപ്പ്.",
            "Please choose one of the available slots:": "ദയവായി ലഭ്യമായ സമയങ്ങളിൽ ഒന്ന് തിരഞ്ഞെടുക്കുക:",
            "Invalid selection.": "അസാധുവായ തിരഞ്ഞെടുപ്പ്.",
            "Date selected:": "തിരഞ്ഞെടുത്ത തീയതി:",
            "Appointment Reminder": "അപ്പോയിന്റ്മെന്റ് ഓർമ്മപ്പെടുത്തൽ",
            "Reminder: ": "ഓർമ്മപ്പെടുത്തൽ: ",
            " before your appointment.": " നിങ്ങളുടെ അപ്പോയിന്റ്മെന്റിന് മുമ്പ്.",
            "Reply Hi to reschedule or cancel.": "പുനഃക്രമീകരിക്കാനോ റദ്ദാക്കാനോ Hi എന്ന് മറുപടി നൽകുക.",
            "{{CLINIC_NAME}} is currently closed.": "{{CLINIC_NAME}} നിലവിൽ അടച്ചിരിക്കുന്നു.",
            "Our hours:": "ഞങ്ങളുടെ സമയം:",
            "Please message us during clinic hours to book or manage appointments.": "അപ്പോയിന്റ്മെന്റ് ബുക്ക് ചെയ്യാനോ കൈകാര്യം ചെയ്യാനോ ക്ലിനിക് സമയത്ത് ഞങ്ങൾക്ക് സന്ദേശം അയയ്ക്കുക.",
            "Reply Hi during open hours to get started.": "തുടങ്ങാൻ തുറന്നിരിക്കുന്ന സമയത്ത് Hi എന്ന് മറുപടി നൽകുക.",
            "How can we help you today?": "ഇന്ന് ഞങ്ങൾക്ക് നിങ്ങളെ എങ്ങനെ സഹായിക്കാനാകും?",
            "Choose your doctor.": "നിങ്ങളുടെ ഡോക്ടറെ തിരഞ്ഞെടുക്കുക.",
            "Choose an appointment date.": "അപ്പോയിന്റ്മെന്റ് തീയതി തിരഞ്ഞെടുക്കുക.",
            "Choose an available time.": "ലഭ്യമായ സമയം തിരഞ്ഞെടുക്കുക.",
            "Choose a new time.": "പുതിയ സമയം തിരഞ്ഞെടുക്കുക.",
            "Choose your language.": "നിങ്ങളുടെ ഭാഷ തിരഞ്ഞെടുക്കുക.",
            "Your appointments": "നിങ്ങളുടെ അപ്പോയിന്റ്മെന്റുകൾ",
            "Select an appointment.": "അപ്പോയിന്റ്മെന്റ് തിരഞ്ഞെടുക്കുക.",
            "Cancel appointment": "അപ്പോയിന്റ്മെന്റ് റദ്ദാക്കുക",
            "Select an appointment to cancel.": "റദ്ദാക്കാൻ അപ്പോയിന്റ്മെന്റ് തിരഞ്ഞെടുക്കുക.",
            "Reschedule appointment": "അപ്പോയിന്റ്മെന്റ് പുനഃക്രമീകരിക്കുക",
            "Select an appointment to reschedule.": "പുനഃക്രമീകരിക്കാൻ അപ്പോയിന്റ്മെന്റ് തിരഞ്ഞെടുക്കുക.",
            "Choose a new appointment date.": "പുതിയ അപ്പോയിന്റ്മെന്റ് തീയതി തിരഞ്ഞെടുക്കുക.",
            "✅ Confirm appointment?": "✅ അപ്പോയിന്റ്മെന്റ് സ്ഥിരീകരിക്കണോ?",
            "⚠️ Cancel this appointment?": "⚠️ ഈ അപ്പോയിന്റ്മെന്റ് റദ്ദാക്കണോ?",
            "🔄 Confirm reschedule?": "🔄 പുനഃക്രമീകരണം സ്ഥിരീകരിക്കണോ?",
            "Please choose a valid doctor.": "ദയവായി സാധുവായ ഡോക്ടറെ തിരഞ്ഞെടുക്കുക.",
            "Please choose one of the available time slots.": "ദയവായി ലഭ്യമായ സമയങ്ങളിൽ ഒന്ന് തിരഞ്ഞെടുക്കുക.",
            "That time slot is no longer available.": "ആ സമയ സ്ലോട്ട് ഇനി ലഭ്യമല്ല.",
            "Please choose another time.": "ദയവായി മറ്റൊരു സമയം തിരഞ്ഞെടുക്കുക.",
            "📅 Enter the appointment date.": "📅 അപ്പോയിന്റ്മെന്റ് തീയതി നൽകുക.",
            "📅 Enter the new appointment date.": "📅 പുതിയ അപ്പോയിന്റ്മെന്റ് തീയതി നൽകുക.",
            "Format: YYYY-MM-DD": "ഫോർമാറ്റ്: YYYY-MM-DD",
            "Page ": "പേജ് ",
            " of ": " / ",
            "Other date": "മറ്റൊരു തീയതി",
            "Other time": "മറ്റൊരു സമയം",
            "Yes, cancel": "അതെ, റദ്ദാക്കുക",
            "Earlier times": "മുമ്പത്തെ സമയം",
            "More times": "കൂടുതൽ സമയം",
            "Reschedule": "പുനഃക്രമീകരിക്കുക",
            "Choose option": "ഓപ്ഷൻ തിരഞ്ഞെടുക്കുക",
            "Select appointment": "അപ്പോയിന്റ്മെന്റ് തിരഞ്ഞെടുക്കുക",
            "Choose time": "സമയം തിരഞ്ഞെടുക്കുക",
            "Select doctor": "ഡോക്ടറെ തിരഞ്ഞെടുക്കുക",
            "Select language": "ഭാഷ തിരഞ്ഞെടുക്കുക",
            "Choose language": "ഭാഷ തിരഞ്ഞെടുക്കുക",
            "Invalid selection.": "അസാധുവായ തിരഞ്ഞെടുപ്പ്.",
            "Options": "ഓപ്ഷനുകൾ",
            "No, go back": "ഇല്ല, തിരികെ പോകുക",
            "Previous page": "മുൻ പേജ്",
            "Next page": "അടുത്ത പേജ്",
            "More appointments": "കൂടുതൽ അപ്പോയിന്റ്മെന്റുകൾ",
            "Earlier appointments": "മുൻ അപ്പോയിന്റ്മെന്റുകൾ",
            "Schedule a visit": "സന്ദർശനം ഷെഡ്യൂൾ ചെയ്യുക",
            "View upcoming": "വരാനിരിക്കുന്നവ കാണുക",
            "Cancel a booking": "ബുക്കിംഗ് റദ്ദാക്കുക",
            "Change date or time": "തീയതി അല്ലെങ്കിൽ സമയം മാറ്റുക",
            "More": "കൂടുതൽ",
            "More options": "കൂടുതൽ ഓപ്ഷനുകൾ"
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

    return applyClinicNamePlaceholder(localizedMessage);
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
    if (!target) return null;

    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {

        const doctorId = String(data[i][0] || "").trim();
        const doctorName = String(data[i][1] || "").trim();
        const whatsappPhone = String(data[i][4] || "").trim();
        const active = String(data[i][6] || "").trim().toUpperCase();

        if (
            !doctorId ||
            !doctorName ||
            !whatsappPhone
        ) {
            continue;
        }

        if (active !== "YES") {
            continue;
        }

        if (
            normalizeWhatsAppPhone(whatsappPhone) === target
        ) {
            return {
                doctorId: doctorId,
                doctorName: doctorName
            };
        }
    }
    return null;
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

    sendDoctorWeekdayMenuReply(
        ss,
        phone,
        doctorId
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

    sendDoctorDayAvailabilityMenuReply(
        ss,
        phone,
        doctorId,
        dayName
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

    sendDoctorDayAvailabilityMenuReply(
        ss,
        phone,
        doctorId,
        dayName,
        prefix
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

    sendDoctorLeavesMenuReply(
        ss,
        phone
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

    const hints =
        buildWhatsAppNavigationHintText(session);

    if (!hints) {
        return message;
    }

    const text =
        String(message || "");

    if (
        text.indexOf("0️⃣ Main Menu") !== -1 ||
        text.indexOf("0️⃣ Doctor Portal") !== -1 ||
        text.indexOf("0️⃣ Back to Main Menu") !== -1
    ) {
        return message;
    }

    return text + "\n\n" + hints;
}


function buildCustomDateEntryPrompt(isReschedule) {

    const prefix =
        isReschedule
            ? "📅 Enter the new appointment date."
            : "📅 Enter the appointment date.";

    return (
        prefix +
        "\n\n" +
        "Format: YYYY-MM-DD\n" +
        "Example: 2026-08-25"
    );
}

function getISODateFromMenuChoice(normalizedMessage) {

    const choice =
        String(normalizedMessage || "")
            .trim()
            .toLowerCase();

    if (
        choice === "1" ||
        choice === "date_today"
    ) {

        return Utilities.formatDate(
            new Date(),
            TIMEZONE,
            "yyyy-MM-dd"
        );
    }

    if (
        choice === "2" ||
        choice === "date_tomorrow"
    ) {

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
            buildISODatetimeWithTimezone(
                Utilities.formatDate(
                    new Date(),
                    TIMEZONE,
                    "yyyy-MM-dd"
                ),
                "00:00"
            )
        );

    const requestedDate =
        new Date(
            buildISODatetimeWithTimezone(
                typedDate,
                "00:00"
            )
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
    isReschedule,
    mode
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

    if (
        normalizedMessage === "3" ||
        normalizedMessage === "date_custom"
    ) {

        saveWhatsAppSession(
            phone,
            { state: customDateState }
        );

        sendCustomDateEntryMenuReply(
            ss,
            phone,
            buildCustomDateEntryPrompt(isReschedule)
        );

        return;
    }

    sendDateMenuReply(
        ss,
        phone,
        "❌ Invalid option.\n\nChoose an appointment date.",
        mode
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

        sendCustomDateEntryMenuReply(
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

function sendCustomDateEntryMenuReply(
    ss,
    phone,
    bodyText
) {

    const text =
        String(bodyText || "");

    sendWhatsAppMenuReply(
        ss,
        phone,
        text,
        {
            fallbackText:
                text +
                "\n\n" +
                "0️⃣ Main Menu\n" +
                "9️⃣ Back",

            interactive:
                buildInteractiveButtonSpec([
                    {
                        id: "nav_main_menu",
                        title: "Main Menu"
                    },
                    {
                        id: "nav_back",
                        title: "Back"
                    }
                ])
        }
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


function showBookingDateSelection(ss, phone, session) {

    sendDateMenuReply(
        ss,
        phone,
        buildBookingDateSelectionIntro(session)
    );
}


function showRescheduleDateSelection(ss, phone, session) {

    sendDateMenuReply(
        ss,
        phone,
        buildRescheduleDateSelectionIntro(session)
    );
}


function showDoctorDateSelection(ss, phone) {

    sendDateMenuReply(
        ss,
        phone,
        "📅 Choose a date to view.",
        "doctor"
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
            appointmentId: "",
            location: ""
        }
    );

    sendPatientMainMenuReply(
        ss,
        phone,
        prefix || "👋 Back to main menu."
    );
}


function returnDoctorToMenu(ss, phone, doctorId, prefix) {

    saveWhatsAppSession(
        phone,
        {
            role: "DOCTOR",
            state: "DOCTOR_MENU",
            doctorId: doctorId,
            date: "",
            time: "",
            appointmentId: "",
            doctorMenuTier: ""
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

        case "PATIENT_MAIN_MORE":
            returnToMainMenu(
                ss,
                phone,
                ""
            );
            return;

        case "MY_APPOINTMENTS":
            returnToMainMenu(ss, phone);
            return;

        case "MY_APPOINTMENT_ACTION":
            returnToMainMenu(ss, phone);
            return;

        case "HOME_COLLECTION_LOCATION":
            saveWhatsAppSession(phone, {
                state: "PATIENT_MAIN_MORE",
                location: ""
            });
            sendPatientMainMoreMenuReply(
                ss,
                phone,
                ""
            );
            return;

        case "HOME_COLLECTION_DATE":
            saveWhatsAppSession(phone, {
                state: "HOME_COLLECTION_LOCATION",
                location: ""
            });
            sendCustomDateEntryMenuReply(
                ss,
                phone,
                "🩸 Home Sample Collection\n\n" +
                "Please share your location (tap 📎 Attach → Location in WhatsApp) " +
                "so we can confirm you're within " +
                getHomeCollectionRadiusKm() +
                " km of " +
                getClinicName() +
                "."
            );
            return;

        case "HOME_COLLECTION_DATE_CUSTOM":
        case "HOME_COLLECTION_TIME":
            saveWhatsAppSession(phone, {
                state: "HOME_COLLECTION_DATE"
            });
            sendDateMenuReply(
                ss,
                phone,
                "Choose a preferred date:",
                "patient"
            );
            return;

        case "BOOK_DATE":
            saveWhatsAppSession(phone, {
                state: "BOOK_DOCTOR",
                doctorId: "",
                listPage: 0
            });
            sendDoctorSelectionReply(
                ss,
                phone
            );
            return;

        case "BOOK_DATE_CUSTOM":
        case "BOOK_TIME":
            saveWhatsAppSession(
                phone,
                {
                    ...session,
                    state: "BOOK_DATE",
                    date: "",
                    time: "",
                    slotPage: 0
                }
            );
            showBookingDateSelection(ss, phone, session);
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
                appointmentId: "",
                apptPage: 0
            });
            sendPatientAppointmentListMenuReply(
                ss,
                phone,
                "cancel",
                getConfirmedAppointmentsForPhone(phone)
            );
            return;

        case "RESCHEDULE_DATE":
            saveWhatsAppSession(phone, {
                state: "RESCHEDULE_SELECT",
                appointmentId: "",
                doctorId: "",
                date: "",
                time: "",
                apptPage: 0
            });
            sendPatientAppointmentListMenuReply(
                ss,
                phone,
                "reschedule",
                getConfirmedAppointmentsForPhone(phone)
            );
            return;

        case "RESCHEDULE_DATE_CUSTOM":
        case "RESCHEDULE_TIME":
            saveWhatsAppSession(phone, {
                state: "RESCHEDULE_DATE",
                date: "",
                time: ""
            });
            showRescheduleDateSelection(ss, phone, session);
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

        case "DOCTOR_MENU_MORE":

            const menuTier =
                Number(session.doctorMenuTier) || 1;

            if (menuTier <= 1) {

                returnDoctorToMenu(
                    ss,
                    phone,
                    doctorId
                );

            } else {

                showDoctorMenuMoreTier(
                    ss,
                    phone,
                    doctorId,
                    menuTier - 1,
                    ""
                );
            }

            return;

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
                time: "",
                apptPage: 0
            });
            sendDoctorAppointmentListMenuReply(
                ss,
                phone,
                "🔄 Reschedule Patient Appointment",
                "Select the appointment to reschedule:",
                getDoctorConfirmedAppointments(
                    doctorId
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
            sendDateMenuReply(
                ss,
                phone,
                buildDoctorRescheduleDateIntro(doctorId),
                "doctor"
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
        "✅ Confirm appointment?\n\n" +
        "👤 " + patientName + "\n" +
        "👨‍⚕️ " +
        (
            findDoctorById(
                session.doctorId
            ) || "Unknown Doctor"
        ) +
        "\n" +
        "📅 " +
        formatWhatsAppDisplayDate(
            session.date
        ) +
        "\n" +
        "🕐 " + session.time
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

        const fallbackText =
            "1️⃣ Choose Another Date\n" +
            "0️⃣ Main Menu\n" +
            "9️⃣ Back";

        const interactive =
            buildInteractiveButtonSpec([
                {
                    id: "date_retry",
                    title: "Choose Another Date"
                },
                {
                    id: "nav_main_menu",
                    title: "Main Menu"
                },
                {
                    id: "nav_back",
                    title: "Back"
                }
            ]);

        sendWhatsAppMenuReply(
            ss,
            senderPhone,
            "❌ Sorry, there are no available slots on " +
            selectedDate +
            ".\n\n" +
            "Please choose another date.",
            {
                fallbackText: fallbackText,
                interactive: interactive
            }
        );

        return false;
    }

    saveWhatsAppSession(
        senderPhone,
        {
            state: nextState,
            date: selectedDate,
            slotPage: 0
        }
    );

    sendSlotSelectionMenuReply(
        ss,
        senderPhone,
        "",
        slots,
        0,
        {
            isoDate: selectedDate,
            isReschedule:
                nextState === "RESCHEDULE_TIME" ||
                nextState === "DOCTOR_RESCHEDULE_TIME"
        }
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
            ["EN", "TE", "HI", "KA", "TA", "ML"].indexOf(
                savedLanguage
            ) === -1
        ) {

            const patient =
                findPatientByPhone(
                    senderPhone
                );

            if (
                patient &&
                ["EN", "TE", "HI", "KA", "TA", "ML"].indexOf(
                    patient.language
                ) !== -1
            ) {
                savedLanguage =
                    patient.language;
            }
        }

        const hasSavedLanguage =
            ["EN", "TE", "HI", "KA", "TA", "ML"].indexOf(
                savedLanguage
            ) !== -1;

        // Logo is optional (only sent once HOSPITAL_LOGO_MEDIA_ID is set
        // in the Settings sheet — see uploadWhatsAppMediaFromDriveFile in
        // Setup.gs). When it does send, skip repeating the welcome line
        // in the text that follows.
        const logoSent =
            sendHospitalLogoGreeting(
                senderPhone
            );

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
                logoSent
                    ? ""
                    : "👋 Welcome to {{CLINIC_NAME}}!"
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
                senderPhone,
                logoSent
                    ? ""
                    : "👋 Welcome to {{CLINIC_NAME}}!"
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

// ======================================================
// NO-SLOTS: CHOOSE ANOTHER DATE
// ======================================================
if (
    session &&
    normalizedMessage === "date_retry"
) {

    // PATIENT BOOKING
    if (
        session.state === "BOOK_DATE" ||
        session.state === "BOOK_DATE_CUSTOM" ||
        session.state === "BOOK_TIME" ||
        session.state === "BOOK_NAME" ||
        session.state === "BOOK_CONFIRM"
    ) {

        saveWhatsAppSession(
            senderPhone,
            {
                state: "BOOK_DATE",
                date: "",
                time: ""
            }
        );

        showBookingDateSelection(
            ss,
            senderPhone,
            getWhatsAppSession(senderPhone)
        );

        return true;
    }


    // PATIENT RESCHEDULE
    if (
        session.state === "RESCHEDULE_DATE" ||
        session.state === "RESCHEDULE_DATE_CUSTOM" ||
        session.state === "RESCHEDULE_TIME" ||
        session.state === "RESCHEDULE_CONFIRM"
    ) {

        saveWhatsAppSession(
            senderPhone,
            {
                state: "RESCHEDULE_DATE",
                date: "",
                time: ""
            }
        );

        showRescheduleDateSelection(
            ss,
            senderPhone,
            getWhatsAppSession(senderPhone)
        );

        return true;
    }


    // DOCTOR RESCHEDULE
    if (
        session.state === "DOCTOR_RESCHEDULE_DATE" ||
        session.state === "DOCTOR_RESCHEDULE_DATE_CUSTOM" ||
        session.state === "DOCTOR_RESCHEDULE_TIME" ||
        session.state === "DOCTOR_RESCHEDULE_CONFIRM"
    ) {

        saveWhatsAppSession(
            senderPhone,
            {
                role: "DOCTOR",
                state: "DOCTOR_RESCHEDULE_DATE",
                doctorId: session.doctorId,
                appointmentId: session.appointmentId,
                patientName: session.patientName,
                date: "",
                time: ""
            }
        );

        sendDateMenuReply(
            ss,
            senderPhone,
            buildDoctorRescheduleDateIntro(
                session.doctorId
            ),
            "doctor"
        );

        return true;
    }


    // SAFE FALLBACK
    showBookingDateSelection(
        ss,
        senderPhone,
        getWhatsAppSession(senderPhone)
    );

    return true;
}

// UNIVERSAL NAVIGATION
// ======================================================

if (
    session &&
    session.state !== "MAIN_MENU" &&
    session.state !== "DOCTOR_MENU" &&
    session.state !== "LANGUAGE_SELECT" &&
    session.state !== "LANGUAGE_CHANGE" &&
    (
        normalizedMessage === "0" ||
        normalizedMessage === "nav_main_menu" ||
        normalizedMessage === "main_menu"
    )
) {

    // ========================================================
    // PREVENT NAVIGATION AWAY FROM PROTECTED BOOKING STATES
    // ========================================================
    // Users cannot abandon multi-step booking flows mid-process

    if (isStateProtectedFromNavigation(session.state)) {

        sendCustomDateEntryMenuReply(
            ss,
            senderPhone,
            "⚠️ You're in the middle of completing a request.\n\n" +
            "Please finish your booking or selection first, " +
            "then you can go back to the main menu."
        );

        return true;
    }

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

// States whose numbered list content can legitimately reach a 9th item
// reserve the literal digit "9" for that content instead of treating it
// as "back" — same reasoning as the DOCTOR_MENU_MORE tier-4 carve-out
// below. This includes every "flat" list state (see
// whatsAppNavigationShowsBack, which already treats this exact set of
// states as not having a meaningful "back" step) plus the doctor
// leave/session-remove pickers, which use the same numbered-list
// pattern. The "nav_back"/"back" aliases (typed word, or a tapped nav
// button) are never ambiguous with numbered content, so they always
// still work everywhere.
const WHATSAPP_NINTH_ITEM_LIST_STATES = [
    "BOOK_DOCTOR",
    "MY_APPOINTMENTS",
    "CANCEL_SELECT",
    "RESCHEDULE_SELECT",
    "DOCTOR_CANCEL_SELECT",
    "DOCTOR_RESCHEDULE_SELECT",
    "DOCTOR_STATUS_SELECT",
    "DOCTOR_LEAVE_CANCEL_PICK",
    "DOCTOR_AVAIL_REMOVE"
];

if (
    session &&
    session.state !== "MAIN_MENU" &&
    session.state !== "DOCTOR_MENU" &&
    session.state !== "LANGUAGE_SELECT" &&
    session.state !== "LANGUAGE_CHANGE" &&
    (
        normalizedMessage === "9" ||
        normalizedMessage === "nav_back" ||
        normalizedMessage === "back"
    ) &&
    !(
        session.state === "DOCTOR_MENU_MORE" &&
        Number(session.doctorMenuTier) === 4
    ) &&
    !(
        normalizedMessage === "9" &&
        WHATSAPP_NINTH_ITEM_LIST_STATES.indexOf(
            session.state
        ) !== -1
    )
) {

    // ========================================================
    // PREVENT GOING BACK FROM PROTECTED BOOKING STATES
    // ========================================================
    // Users cannot abandon multi-step booking flows by pressing back

    if (isStateProtectedFromNavigation(session.state)) {

        sendCustomDateEntryMenuReply(
            ss,
            senderPhone,
            "⚠️ You're in the middle of completing a request.\n\n" +
            "Please finish your booking or selection first, " +
            "then you can go back."
        );

        return true;
    }

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

    } else if (normalizedMessage === "0") {

        returnDoctorToMenu(
            ss,
            senderPhone,
            doctorId
        );

    } else if (
        normalizedMessage === "menu_more" ||
        normalizedMessage === "more" ||
        normalizedMessage === "3"
    ) {

        showDoctorMenuMoreTier(
            ss,
            senderPhone,
            doctorId,
            1,
            ""
        );

    } else if (
        handleDoctorPortalMenuChoice(
            ss,
            senderPhone,
            doctorId,
            normalizedMessage
        )
    ) {

        // handled

    } else {

        returnDoctorToMenu(
            ss,
            senderPhone,
            doctorId,
            "❌ Invalid option."
        );
    }

    return true;
}


// ======================================================
// DOCTOR MENU → MORE (button sub-menu tiers)
// ======================================================

if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_MENU_MORE"
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

    const tier =
        Number(session.doctorMenuTier) || 1;

    if (
        normalizedMessage === "menu_more_2" &&
        tier === 1
    ) {

        showDoctorMenuMoreTier(
            ss,
            senderPhone,
            doctorId,
            2,
            ""
        );

    } else if (
        normalizedMessage === "menu_more_3" &&
        tier === 2
    ) {

        showDoctorMenuMoreTier(
            ss,
            senderPhone,
            doctorId,
            3,
            ""
        );

    } else if (
        normalizedMessage === "menu_more_4" &&
        tier === 3
    ) {

        showDoctorMenuMoreTier(
            ss,
            senderPhone,
            doctorId,
            4,
            ""
        );

    } else if (
        isDoctorMenuChoiceAllowedForTier(
            normalizedMessage,
            tier
        ) &&
        handleDoctorPortalMenuChoice(
            ss,
            senderPhone,
            doctorId,
            normalizedMessage
        )
    ) {

        // handled

    } else {

        sendDoctorMainMenuMoreReply(
            ss,
            senderPhone,
            doctorId,
            tier,
            "❌ Invalid option."
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

        sendDoctorWeekdayMenuReply(
            ss,
            senderPhone,
            doctorId,
            "❌ Invalid day."
        );
    }

    return true;
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
                    appointmentId: "",
                    listPage: 0
                }
            );

            sendDoctorSessionRemoveMenuReply(
                ss,
                senderPhone,
                doctorId,
                dayName
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

    return true;
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

    if (
        normalizedMessage === "session_prev" ||
        normalizedMessage === "session_next"
    ) {

        const currentPage =
            Number(session.listPage) || 0;

        const nextPage =
            normalizedMessage === "session_prev"
                ? Math.max(currentPage - 1, 0)
                : currentPage + 1;

        saveWhatsAppSession(
            senderPhone,
            { listPage: nextPage }
        );

        sendDoctorSessionRemoveMenuReply(
            ss,
            senderPhone,
            doctorId,
            dayName,
            nextPage
        );

        return true;
    }

    const pick =
        Number(normalizedMessage);

    if (!Number.isInteger(pick) || pick < 1) {

        returnToDoctorDayAvailability(
            ss,
            senderPhone,
            doctorId,
            dayName,
            "❌ Invalid selection."
        );

        return true;
    }

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

    return true;
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

    return true;
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

    sendWhatsAppMenuReply(
        ss,
        senderPhone,
        buildDoctorAvailabilitySessionConfirmMessage(
            dayName,
            startTime,
            endTime
        ),
        getConfirmCancelSpec()
    );

    return true;
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

    if (isSimpleConfirmYesChoice(normalizedMessage)) {

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

    } else if (isSimpleConfirmCancelChoice(normalizedMessage)) {

        returnToDoctorDayAvailability(
            ss,
            senderPhone,
            doctorId,
            dayName,
            "❌ Session not saved."
        );

    } else {

        sendWhatsAppMenuReply(
            ss,
            senderPhone,
            "❌ Invalid option.\n\n" +
            buildDoctorAvailabilitySessionConfirmMessage(
                dayName,
                startTime,
                endTime
            ),
            getConfirmCancelSpec()
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
                    getYesNoConfirmSpec("doctor")
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

    if (isYesCancelConfirmChoice(normalizedMessage)) {

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

            sendWhatsAppMenuReply(
                ss,
                senderPhone,
                "❌ " + errorMessage,
                getYesNoConfirmSpec("doctor")
            );
        }

    } else if (isNoGoBackConfirmChoice(normalizedMessage)) {

        returnDoctorToMenu(
            ss,
            senderPhone,
            doctorId,
            "👍 Okay, appointment was not cancelled."
        );

    } else {

        sendWhatsAppMenuReply(
            ss,
            senderPhone,
            "❌ Invalid option.",
            getYesNoConfirmSpec("doctor")
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

    if (isStatusCompletedChoice(normalizedMessage)) {
        targetStatus =
            APPOINTMENT_STATUS.COMPLETED;
    } else if (isStatusNoShowChoice(normalizedMessage)) {
        targetStatus =
            APPOINTMENT_STATUS.NO_SHOW;
    } else {

        sendWhatsAppMenuReply(
            ss,
            senderPhone,
            "❌ Invalid option.",
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
            "❌ " + errorMessage,
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
        true,
        "doctor"
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

    if (
        normalizedMessage === "1" ||
        normalizedMessage === "confirm_yes"
    ) {

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
                "📅 " +
                result.date +
                "\n" +
                "🕐 " +
                result.time
            );

        } else {

            const errorMessage =
                result && result.message
                    ? result.message
                    : "Unable to reschedule the appointment.";

            sendWhatsAppMenuReply(
                ss,
                senderPhone,
                "❌ " + errorMessage,
                getRescheduleConfirmSpec("doctor")
            );
        }

    } else if (
        normalizedMessage === "2" ||
        normalizedMessage === "confirm_other_time"
    ) {

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

    } else if (
        normalizedMessage === "3" ||
        normalizedMessage === "confirm_cancel"
    ) {

        returnDoctorToMenu(
            ss,
            senderPhone,
            doctorId,
            "❌ Reschedule cancelled."
        );

    } else {

        sendWhatsAppMenuReply(
            ss,
            senderPhone,
            "❌ Invalid option.\n\n" +
            buildDoctorRescheduleSlotConfirmMessage(
                session,
                session.date,
                session.time
            ),
            getRescheduleConfirmSpec("doctor")
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

            sendDoctorLeaveCancelListMenuReply(
                ss,
                senderPhone,
                doctorId
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

        sendDoctorLeavesMenuReply(
            ss,
            senderPhone,
            "❌ Invalid option."
        );
    }

    return true;
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

    return true;
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

    sendWhatsAppMenuReply(
        ss,
        senderPhone,
        buildDoctorLeaveConfirmMessage(
            leaveDate,
            reason
        ),
        getConfirmCancelSpec()
    );

    return true;
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

    if (isSimpleConfirmYesChoice(normalizedMessage)) {

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

    } else if (isSimpleConfirmCancelChoice(normalizedMessage)) {

        returnDoctorToMenu(
            ss,
            senderPhone,
            doctorId,
            "❌ Leave not saved."
        );

    } else {

        sendWhatsAppMenuReply(
            ss,
            senderPhone,
            "❌ Invalid option.\n\n" +
            buildDoctorLeaveConfirmMessage(
                leaveDate,
                reason
            ),
            getConfirmCancelSpec()
        );
    }

    return true;
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

        sendDoctorLeaveCancelListMenuReply(
            ss,
            senderPhone,
            doctorId,
            "❌ Invalid selection."
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

    return true;
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

    return true;
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

    return true;
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

    sendWhatsAppMenuReply(
        ss,
        senderPhone,
        buildDoctorLeaveRangeConfirmMessage(
            startDate,
            endDate,
            reason
        ),
        getConfirmCancelSpec()
    );

    return true;
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

    if (isSimpleConfirmYesChoice(normalizedMessage)) {

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

    } else if (isSimpleConfirmCancelChoice(normalizedMessage)) {

        returnDoctorToMenu(
            ss,
            senderPhone,
            doctorId,
            "❌ Leave range not saved."
        );

    } else {

        sendWhatsAppMenuReply(
            ss,
            senderPhone,
            "❌ Invalid option.\n\n" +
            buildDoctorLeaveRangeConfirmMessage(
                startDate,
                endDate,
                reason
            ),
            getConfirmCancelSpec()
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
    }

    const selectedDate =
        getISODateFromMenuChoice(
            normalizedMessage
        );

    if (selectedDate) {

        showDoctorScheduleForDateAndReturn(
            ss,
            senderPhone,
            doctorId,
            selectedDate
        );

        return true;
    }

    if (
        normalizedMessage === "3" ||
        normalizedMessage === "date_custom"
    ) {

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

        sendCustomDateEntryMenuReply(
            ss,
            senderPhone,
            buildDoctorScheduleDateEntryPrompt()
        );

        return true;
    }

    sendDateMenuReply(
        ss,
        senderPhone,
        "❌ Invalid option.\n\nChoose a date to view.",
        "doctor"
    );

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

    }

    const dateCheck =
        validateScheduleViewISODate(typedDate);

    if (!dateCheck.valid) {

        sendCustomDateEntryMenuReply(
            ss,
            senderPhone,
            dateCheck.message
        );

    } else {

        showDoctorScheduleForDateAndReturn(
            ss,
            senderPhone,
            doctorId,
            dateCheck.date
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
    session,
    location
) {

    if (
        handleWhatsAppHomeCollectionMessage(
            ss,
            senderPhone,
            senderName,
            messageText,
            normalizedMessage,
            session,
            location
        )
    ) {
        return true;
    }

// LANGUAGE SELECTION
// ======================================================

if (
    session &&
    session.state === "LANGUAGE_SELECT"
) {

    const languageByChoice = {
        "1": "EN",
        "2": "TE",
        "3": "HI",
        "4": "KA",
        "5": "TA",
        "6": "ML"
    };

    const language =
        languageByChoice[normalizedMessage];

    if (!language) {

        sendLanguageMenuReply(
            ss,
            senderPhone,
            "❌ Invalid option."
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

        sendPatientMainMenuReply(
            ss,
            senderPhone,
            "👋 Welcome to {{CLINIC_NAME}}!"
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
        "3": "HI",
        "4": "KA",
        "5": "TA",
        "6": "ML"
    };

    const language =
        languageByChoice[normalizedMessage];

    if (!language) {

        sendLanguageMenuReply(
            ss,
            senderPhone,
            "❌ Invalid option."
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

            sendPatientMainMenuReply(
                ss,
                senderPhone,
                "✅ Language changed successfully."
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
            state: "BOOK_DOCTOR",
            listPage: 0
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
                // Same fix as getConfirmedAppointmentsForPhone: only
                // hide truly inactive appointments, so one with a
                // blank or non-standard status doesn't disappear here.
                return !isInactiveAppointmentStatus(
                    appt.status
                );
            }
        );

    if (
        !appointments ||
        appointments.length === 0
    ) {

        // No appointments: take the patient directly into the
        // normal booking flow so they can choose any available doctor.
        saveWhatsAppSession(
            senderPhone,
            {
                role: "PATIENT",
                state: "BOOK_DOCTOR",
                doctorId: "",
                date: "",
                time: "",
                appointmentId: "",
                listPage: 0
            }
        );

        sendDoctorSelectionReply(
            ss,
            senderPhone
        );

        return true;
    }

    saveWhatsAppSession(
        senderPhone,
        {
            role: "PATIENT",
            state: "MY_APPOINTMENTS",
            apptPage: 0
        }
    );

    sendPatientAppointmentListMenuReply(
        ss,
        senderPhone,
        "my_appointments",
        appointments
    );

    return true;
}


// ======================================================
// MAIN MENU → MORE (button sub-menu)
// ======================================================

if (
    session &&
    session.state === "MAIN_MENU" &&
    (
        normalizedMessage === "menu_more" ||
        normalizedMessage === "more" ||
        normalizedMessage === "3"
    )
) {

    saveWhatsAppSession(
        senderPhone,
        {
            role: "PATIENT",
            state: "PATIENT_MAIN_MORE"
        }
    );

    sendPatientMainMoreMenuReply(
        ss,
        senderPhone
    );

    return true;
}


// ======================================================
// MORE → CANCEL APPOINTMENT
// ======================================================

if (
    normalizedMessage === "3" &&
    session &&
    session.state === "PATIENT_MAIN_MORE"
) {

    beginWhatsAppCancelFlow(
        ss,
        senderPhone
    );
    return true;
}


// ======================================================
// MAIN MENU / MORE → RESCHEDULE APPOINTMENT
// ======================================================

if (
    normalizedMessage === "4" &&
    session &&
    (
        session.state === "MAIN_MENU" ||
        session.state === "PATIENT_MAIN_MORE"
    )
) {

    beginWhatsAppRescheduleFlow(
        ss,
        senderPhone
    );
    return true;
}


// ======================================================
// MAIN MENU / MORE → CHANGE LANGUAGE
// ======================================================

if (
    normalizedMessage === "5" &&
    session &&
    (
        session.state === "MAIN_MENU" ||
        session.state === "PATIENT_MAIN_MORE"
    )
) {

    saveWhatsAppSession(
        senderPhone,
        {
            role: "PATIENT",
            state: "LANGUAGE_CHANGE"
        }
    );

    sendLanguageMenuReply(
        ss,
        senderPhone
    );
    return true;
}


// ======================================================
// MORE → HOME SAMPLE COLLECTION
// ======================================================

if (
    normalizedMessage === "6" &&
    session &&
    session.state === "PATIENT_MAIN_MORE"
) {

    beginWhatsAppHomeCollectionFlow(
        ss,
        senderPhone
    );
    return true;
}


// ======================================================
// MAIN MORE → UNRECOGNIZED OPTION
// ======================================================

if (
    session &&
    session.state === "PATIENT_MAIN_MORE"
) {

    sendPatientMainMoreMenuReply(
        ss,
        senderPhone,
        "❌ Invalid option."
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

    sendPatientMainMenuReply(
        ss,
        senderPhone,
        "❌ Invalid option."
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

    if (
        normalizedMessage === "doctor_prev" ||
        normalizedMessage === "doctor_next"
    ) {

        const currentPage =
            Number(session.listPage) || 0;

        const nextPage =
            normalizedMessage === "doctor_prev"
                ? Math.max(currentPage - 1, 0)
                : currentPage + 1;

        saveWhatsAppSession(
            senderPhone,
            { listPage: nextPage }
        );

        sendDoctorSelectionReply(
            ss,
            senderPhone,
            nextPage
        );

        return true;
    }

    const selection =
        String(messageText || "").trim();

    const doctors =
        getDoctors();

    let doctor = null;

    // Interactive WhatsApp doctor selection uses the actual Doctor ID.
    if (
        selection.indexOf("doctor_select_") === 0
    ) {
        const encodedDoctorId =
            selection.substring(
                "doctor_select_".length
            );

        let selectedDoctorId = "";

        try {
            selectedDoctorId =
                decodeURIComponent(
                    encodedDoctorId
                );
        } catch (decodeError) {
            selectedDoctorId =
                encodedDoctorId;
        }

        doctor =
            doctors.find(
                function (item) {
                    return String(
                        item.doctorId
                    ).trim() === String(
                        selectedDoctorId
                    ).trim();
                }
            ) || null;

    } else {
        // Keep typed-number fallback working for users who type 1, 2, 3...
        const doctorNumber =
            Number(selection);

        doctor =
            Number.isInteger(doctorNumber) &&
            doctorNumber >= 1 &&
            doctorNumber <= doctors.length
                ? doctors[doctorNumber - 1]
                : null;
    }


    // ======================================================
    // DOCTOR NOT FOUND
    // ======================================================

    if (!doctor) {

        sendWhatsAppMenuReply(
            ss,
            senderPhone,
            buildDoctorSelectionBody(
                "❌ Please choose a valid doctor."
            ),
            getDoctorSelectionMenuSpec(
                Number(session.listPage) || 0
            )
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
            "👨‍⚕️ " +
            doctor.doctorName +
            "\n\nChoose an appointment date."
        );
    }

    return true;
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
        false,
        "patient"
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

    if (
        normalizedMessage === "1" ||
        normalizedMessage === "confirm_yes"
    ) {

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
                "👨‍⚕️ " +
                bookingResult.doctor +
                "\n" +
                "📅 " +
                bookingResult.date +
                "\n" +
                "🕐 " +
                bookingResult.time +
                "\n\n" +
                "Thank you for choosing {{CLINIC_NAME}}.";

            sendWhatsAppReply(
                ss,
                senderPhone,
                reply
            );

            // Send a shareable appointment receipt card after the
            // booking confirmation. The recipient can use WhatsApp's
            // native Forward action to share it with the patient.
            try {
                sendAppointmentReceiptCard(
                    senderPhone,
                    {
                        appointmentId:
                            bookingResult.appointmentId,
                        patientName: patientName,
                        doctorId:
                            session.doctorId,
                        doctor:
                            bookingResult.doctor,
                        date:
                            bookingResult.date,
                        time:
                            bookingResult.time
                    }
                );
            } catch (receiptError) {
                Logger.log(
                    "Appointment receipt failed; booking remains successful: " +
                    receiptError.message
                );
            }

        } else {

            const errorMessage =
                bookingResult &&
                bookingResult.message
                    ? bookingResult.message
                    : "Unable to book the appointment.";

            if (
                errorMessage ===
                "You already have an active appointment on this date."
            ) {

                const fallbackText =
                    "1️⃣ Choose Another Date\n" +
                    "0️⃣ Main Menu\n" +
                    "9️⃣ Back";

                const interactive =
                    buildInteractiveButtonSpec([
                        {
                            id: "date_retry",
                            title: "Choose Another Date"
                        },
                        {
                            id: "nav_main_menu",
                            title: "Main Menu"
                        },
                        {
                            id: "nav_back",
                            title: "Back"
                        }
                    ]);

                sendWhatsAppMenuReply(
                    ss,
                    senderPhone,
                    "❌ You already have an active appointment on this date." +
                    "\n\n" +
                    "Please choose another date.",
                    {
                        fallbackText: fallbackText,
                        interactive: interactive
                    }
                );

            } else {

                sendWhatsAppReply(
                    ss,
                    senderPhone,
                    "❌ " +
                    errorMessage +
                    "\n\n" +
                    "Please choose another time or send Hi to start again."
                );
            }
        }

    } else if (
        normalizedMessage === "2" ||
        normalizedMessage === "confirm_other_time"
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
                time: "",
                slotPage: 0
            }
        );

        sendSlotSelectionMenuReply(
            ss,
            senderPhone,
            "",
            slots,
            0,
            {
                isoDate: session.date,
                isReschedule: false
            }
        );

    } else if (
        normalizedMessage === "3" ||
        normalizedMessage === "confirm_cancel"
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

        sendPatientMainMenuReply(
            ss,
            senderPhone,
            "❌ Appointment booking cancelled."
        );

    } else {

        const patientName =
            resolvePatientNameForBooking(
                senderPhone,
                session,
                senderName
            );

        sendWhatsAppMenuReply(
            ss,
            senderPhone,
            "❌ Invalid option.\n\n" +
            buildBookingConfirmationMessage(
                session,
                patientName
            ),
            getBookingConfirmSpec()
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
// MY APPOINTMENTS STATE
// ======================================================

if (
    session &&
    session.state === "MY_APPOINTMENTS"
) {

    handleWhatsAppMyAppointmentsState(
        ss,
        senderPhone,
        session,
        normalizedMessage
    );
    return true;
}


// ======================================================
// MY APPOINTMENT ACTION STATE
// ======================================================

if (
    session &&
    session.state === "MY_APPOINTMENT_ACTION"
) {

    handleWhatsAppMyAppointmentActionState(
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
        session,
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

    if (isYesCancelConfirmChoice(normalizedMessage)) {

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

            sendPatientMainMenuReply(
                ss,
                senderPhone,
                "✅ " + result.message
            );

        } else {

            const errorMessage =
                result && result.message
                    ? result.message
                    : "Unable to cancel the appointment.";

            const chosen =
                findConfirmedAppointmentForPhone(
                    senderPhone,
                    session.appointmentId
                );

            sendCancelConfirmMenuReply(
                ss,
                senderPhone,
                chosen,
                "❌ " + errorMessage
            );
        }

    } else if (isNoGoBackConfirmChoice(normalizedMessage)) {

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

        sendPatientMainMenuReply(
            ss,
            senderPhone,
            "👍 Okay, appointment was not cancelled."
        );

    } else {

        const chosen =
            findConfirmedAppointmentForPhone(
                senderPhone,
                session.appointmentId
            );

        sendCancelConfirmMenuReply(
            ss,
            senderPhone,
            chosen,
            "❌ Invalid option."
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
        session,
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
        true,
        "patient"
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

    if (
        normalizedMessage === "1" ||
        normalizedMessage === "confirm_yes"
    ) {

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
                "👨‍⚕️ " +
                result.doctor +
                "\n" +
                "📅 " +
                result.date +
                "\n" +
                "🕐 " +
                result.time +
                "\n\n" +
                "Thank you for choosing {{CLINIC_NAME}}.";

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

            sendRescheduleConfirmMenuReply(
                ss,
                senderPhone,
                session,
                "❌ " + errorMessage
            );
        }

    } else if (
        normalizedMessage === "2" ||
        normalizedMessage === "confirm_other_time"
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
        normalizedMessage === "3" ||
        normalizedMessage === "confirm_cancel"
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

        sendPatientMainMenuReply(
            ss,
            senderPhone,
            "❌ Reschedule cancelled."
        );

    } else {

        sendRescheduleConfirmMenuReply(
            ss,
            senderPhone,
            session,
            "❌ Invalid option."
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
    messageText,
    location,
    messageType
) {

    const normalizedMessage =
        messageText
            .toLowerCase()
            .trim();

    const session =
        getWhatsAppSession(senderPhone);

    // ========================================================
    // ENFORCE TAPPABLE-ONLY OPTIONS
    // ========================================================
    // Reject plain text input if current state only accepts interactive options

    if (shouldRejectPlainTextInput(messageType, session)) {

        sendCustomDateEntryMenuReply(
            ss,
            senderPhone,
            "👆 Please use the tappable options (buttons/lists) to navigate. " +
            "Text input is not allowed in this menu."
        );

        return;
    }

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
            session,
            location
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

        // ========================================================
        // PERSISTENT IDEMPOTENCY CHECK
        // ========================================================
        // Use sheet-based deduplication instead of cache (which expires)
        // to prevent duplicate processing after 5+ minutes

        if (messageId) {
            const idempotencyCheck =
                checkMessageIdempotency(messageId);

            if (
                idempotencyCheck.isProcessed &&
                !idempotencyCheck.isExpired
            ) {
                // Message already processed recently
                Logger.log(
                    "Message " + messageId +
                    " already processed; ignoring duplicate"
                );
                return webhookOkResponse();
            }

            // Record that we're processing this message
            recordMessageProcessing(
                messageId,
                senderPhone
            );
            processingStarted = true;
        }

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

        const inboundLocation =
            messageType === "location"
                ? {
                    latitude: inbound.latitude,
                    longitude: inbound.longitude
                }
                : null;

        appendWhatsAppLogEntry(
            ss,
            {
                direction: "INBOUND",
                phone: senderPhone,
                name: senderName,
                status: messageType,
                message:
                    messageText ||
                    (
                        inboundLocation
                            ? "[location shared: " +
                            inboundLocation.latitude +
                            "," +
                            inboundLocation.longitude +
                            "]"
                            : ""
                    ),
                phoneNumberId: phoneNumberId
            }
        );


        // ========================================================
        // WHATSAPP CONVERSATION
        // ========================================================

        if (messageText || inboundLocation) {

            setWhatsAppInboundMessageContext(
                messageId
            );

            try {

                processWhatsAppTextMessage(
                    ss,
                    senderPhone,
                    senderName,
                    messageText,
                    inboundLocation,
                    messageType
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

            appendWhatsAppLogEntry(
                ss,
                {
                    direction: "WEBHOOK",
                    status: "ERROR",
                    message:
                        error.message +
                        "\n" +
                        error.stack
                }
            );

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

    // ========================================================
    // PERSISTENT DEDUPLICATION
    // ========================================================
    // Record successful processing in sheet instead of cache
    // to ensure dedup survives cache expiration (7-day window)

    markMessageProcessed(messageId, "SUCCESS");
}

function isWhatsAppMessageProcessing(messageId) {

    if (!messageId) {
        return false;
    }

    // Check persistent deduplication
    const idempotency = checkMessageIdempotency(messageId);
    return idempotency.isProcessed &&
           idempotency.status === "PROCESSING" &&
           !idempotency.isExpired;
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

    let acquired = false;

    for (
        let attempt = 0;
        attempt < 2 && !acquired;
        attempt++
    ) {
        acquired = lock.tryLock(5000);
    }

    if (!acquired) {

        Logger.log(
            "tryBeginWhatsAppMessageProcessing: could not acquire lock " +
            "for messageId=" + messageId + " after " + 2 + " retries; " +
            "rejecting message to prevent concurrent processing."
        );

        return false;
    }

    try {

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

    try {
        return JSON.parse(responseBody);
    } catch (parseError) {
        throw new Error(
            "Failed to parse WhatsApp API response: " +
            parseError.message +
            " | Response: " +
            responseBody.substring(0, 200)
        );
    }
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

        const rawBody =
            String(bodyText || "");

        const willSendInteractive =
            interactiveMenusEnabled() &&
            menuSpec &&
            menuSpec.interactive;

        const rawBodyWithNavigation =
            willSendInteractive
                ? rawBody
                : addWhatsAppNavigationOptions(
                    session,
                    rawBody
                );

        let localizedBody =
            localizeWhatsAppReply(
                language,
                rawBodyWithNavigation
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
                        localizeInteractiveMenuForSession(
                            session,
                            language,
                            menuSpec.interactive
                        )
                    );

            } catch (interactiveError) {

                Logger.log(
                    "Interactive menu failed; using text fallback: " +
                    interactiveError.message
                );

                sendResult = null;
            }
        }

        if (!sendResult) {

            const fallbackBody =
                willSendInteractive
                    ? localizeWhatsAppReply(
                        language,
                        addWhatsAppNavigationOptions(
                            session,
                            rawBody
                        )
                    )
                    : localizedBody;

            const localizedFallback =
                menuSpec &&
                menuSpec.fallbackText
                    ? localizeWhatsAppReply(
                        language,
                        menuSpec.fallbackText
                    )
                    : "";

            const fallbackText =
                localizedFallback
                    ? fallbackBody +
                    "\n\n" +
                    localizedFallback
                    : fallbackBody;

            sendResult =
                sendWhatsAppText(
                    phone,
                    fallbackText
                );
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

        return sendResult;

    } catch (error) {

        appendWhatsAppLogEntry(
            ss,
            {
                direction: "OUTBOUND",
                phone: phone,
                status: "ERROR",
                message: error.message
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

    // A caller can pass "" explicitly to omit the welcome line entirely
    // (e.g. when the hospital logo image already carried the welcome as
    // its caption) — only an omitted (undefined) prefix falls back to
    // the default. Any other non-empty string is used as-is.
    const line =
        prefix !== undefined
            ? String(prefix)
            : "👋 Welcome to {{CLINIC_NAME}}!";

    const body =
        (line ? line + "\n\n" : "") +
        "How can we help you today?";

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


function sendLanguageMenuReply(
    ss,
    phone,
    prefix
) {

    sendWhatsAppMenuReply(
        ss,
        phone,
        buildLanguageSelectionBody(prefix),
        getLanguageMenuSpec()
    );
}


function sendDateMenuReply(ss, phone, introText, mode) {

    sendWhatsAppMenuReply(
        ss,
        phone,
        String(introText || "Choose an appointment date."),
        getDateMenuSpec(mode)
    );
}


function sendDoctorSelectionReply(ss, phone, page) {

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
        getDoctorSelectionMenuSpec(page || 0);

    let body =
        buildDoctorSelectionBody();

    if (
        menuSpec &&
        menuSpec.totalPages > 1
    ) {
        body +=
            "\n\nPage " +
            (menuSpec.page + 1) +
            " of " +
            menuSpec.totalPages;
    }

    sendWhatsAppMenuReply(
        ss,
        phone,
        body,
        menuSpec
    );
}


function sendPatientAppointmentListMenuReply(
    ss,
    phone,
    listScreen,
    appointments,
    page,
    prefix
) {

    const menuSpec =
        getAppointmentListMenuSpec(
            appointments,
            "patient",
            page || 0
        );

    const pageInfo = {
        page: menuSpec.page || 0,
        totalPages:
            menuSpec.totalPages || 1
    };

    const body =
        buildPatientAppointmentListBodyForScreen(
            listScreen,
            pageInfo,
            prefix
        );

    sendWhatsAppMenuReply(
        ss,
        phone,
        body,
        menuSpec
    );
}


function sendDoctorAppointmentListMenuReply(
    ss,
    phone,
    title,
    selectLine,
    appointments,
    page
) {

    const menuSpec =
        getAppointmentListMenuSpec(
            appointments,
            "doctor",
            page || 0
        );

    let body =
        title +
        "\n\n" +
        selectLine;

    if (
        menuSpec &&
        menuSpec.totalPages > 1
    ) {
        body +=
            "\n\nPage " +
            (menuSpec.page + 1) +
            " of " +
            menuSpec.totalPages;
    }

    sendWhatsAppMenuReply(
        ss,
        phone,
        body,
        menuSpec
    );
}


function sendDoctorWeekdayMenuReply(
    ss,
    phone,
    doctorId,
    prefix
) {

    const body =
        (prefix
            ? String(prefix) + "\n\n"
            : "") +
        "📅 Manage Availability\n\n" +
        "Select a day to manage:";

    sendWhatsAppMenuReply(
        ss,
        phone,
        body,
        getDoctorWeekdayMenuSpec(doctorId)
    );
}


function sendDoctorDayAvailabilityMenuReply(
    ss,
    phone,
    doctorId,
    dayName,
    prefix
) {

    const body =
        (prefix
            ? String(prefix) + "\n\n"
            : "") +
        buildDoctorDayAvailabilityBody(
            doctorId,
            dayName
        ) +
        "\n\nChoose an action:";

    sendWhatsAppMenuReply(
        ss,
        phone,
        body,
        getDoctorDayAvailabilityActionSpec()
    );
}


function sendDoctorSessionRemoveMenuReply(
    ss,
    phone,
    doctorId,
    dayName,
    page
) {

    const sessions =
        getDoctorDayAvailabilitySessions(
            doctorId,
            dayName
        );

    const menuSpec =
        getDoctorSessionRemoveListSpec(
            sessions,
            page || 0
        );

    let body =
        "Select session to remove:\n\n" +
        buildDoctorDayAvailabilityBody(
            doctorId,
            dayName
        );

    if (
        menuSpec &&
        menuSpec.totalPages > 1
    ) {
        body +=
            "\n\nPage " +
            (menuSpec.page + 1) +
            " of " +
            menuSpec.totalPages;
    }

    sendWhatsAppMenuReply(
        ss,
        phone,
        body,
        menuSpec
    );
}


function sendDoctorLeavesMenuReply(
    ss,
    phone,
    prefix
) {

    const body =
        (prefix
            ? String(prefix) + "\n\n"
            : "") +
        "🏖 Manage Leaves\n\n" +
        "Choose an option:";

    sendWhatsAppMenuReply(
        ss,
        phone,
        body,
        getDoctorLeavesMenuSpec()
    );
}


function sendDoctorLeaveCancelListMenuReply(
    ss,
    phone,
    doctorId,
    prefix
) {

    const leaves =
        getDoctorUpcomingLeaves(doctorId);

    const body =
        (prefix
            ? String(prefix) + "\n\n"
            : "") +
        "Select leave to cancel:";

    sendWhatsAppMenuReply(
        ss,
        phone,
        body,
        getDoctorLeaveListMenuSpec(leaves)
    );
}


function sendSlotSelectionMenuReply(
    ss,
    phone,
    introText,
    slots,
    page,
    options
) {

    const opts = options || {};

    const session =
        getWhatsAppSession(phone);

    const menuSpec =
        getSlotSelectionMenuSpec(
            slots,
            page || 0,
            session && session.role === "DOCTOR"
                ? "doctor"
                : "patient"
        );

    let body =
        String(introText || "");

    if (
        !body &&
        opts.isoDate
    ) {
        body =
            buildSlotSelectionIntro(
                opts.isoDate,
                opts.isReschedule
            );
    }

    if (
        menuSpec &&
        menuSpec.totalPages > 1
    ) {
        body +=
            "\n\nPage " +
            (menuSpec.page + 1) +
            " of " +
            menuSpec.totalPages;
    }

    sendWhatsAppMenuReply(
        ss,
        phone,
        body,
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

        return sendResult;

    } catch (error) {

        appendWhatsAppLogEntry(
            ss,
            {
                direction: "OUTBOUND",
                phone: phone,
                status: "ERROR",
                message: error.message
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

    const cacheTtlSeconds = 1800; // 30 minutes
    const cacheNullSentinel = "__NULL__";

    const cache =
        CacheService.getScriptCache();

    const cacheKey =
        getWhatsAppSessionCacheKey(phone);

    const cached =
        cache.get(cacheKey);

    if (cached !== null) {

        if (cached === cacheNullSentinel) {
            return null;
        }

        try {
            return JSON.parse(cached);
        } catch (parseError) {
            // Corrupt/unexpected cache entry — fall through to a real read
            // rather than propagate the error.
        }
    }

    const session =
        readWhatsAppSessionFromSheet(phone);

    cache.put(
        cacheKey,
        session
            ? JSON.stringify(session)
            : cacheNullSentinel,
        cacheTtlSeconds
    );

    return session;
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


function resolveSlotSelectionPage(session) {

    if (
        !session ||
        session.slotPage === undefined ||
        session.slotPage === null ||
        session.slotPage === ""
    ) {
        return 0;
    }

    const page =
        parseInt(
            session.slotPage,
            10
        );

    if (
        isNaN(page) ||
        page < 0
    ) {
        return 0;
    }

    return page;
}


function ensureWhatsAppSessionSlotPageColumn(sheet) {

    if (!sheet.getRange(1, 11).getValue()) {
        sheet
            .getRange(1, 11)
            .setValue("Slot Page");
    }
}


function saveWhatsAppSession(
    phone,
    updates
) {

    const sheet =
        ensureWhatsAppSessionsSheet();

    ensureWhatsAppSessionLanguageColumn(sheet);
    ensureWhatsAppSessionPatientNameColumn(sheet);
    ensureWhatsAppSessionSlotPageColumn(sheet);
    ensureWhatsAppSessionAppointmentPageColumn(sheet);
    ensureWhatsAppSessionDoctorMenuTierColumn(sheet);
    ensureWhatsAppSessionListPageColumn(sheet);
    ensureWhatsAppSessionLocationColumn(sheet);

    try {

        const existing =
            getWhatsAppSession(phone);

        const now =
            new Date();

        if (existing) {

            const row =
                existing.row;

            const current =
                sheet
                    .getRange(row, 1, 1, 15)
                    .getValues()[0];

            sheet
                .getRange(row, 1, 1, 15)
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
                        : current[9],

                    updates.slotPage !== undefined
                        ? updates.slotPage
                        : (
                            current[10] === "" ||
                            current[10] === undefined ||
                            current[10] === null
                                ? 0
                                : current[10]
                        ),

                    updates.apptPage !== undefined
                        ? updates.apptPage
                        : (
                            current[11] === "" ||
                            current[11] === undefined ||
                            current[11] === null
                                ? 0
                                : current[11]
                        ),

                    updates.doctorMenuTier !== undefined
                        ? updates.doctorMenuTier
                        : current[12],

                    updates.listPage !== undefined
                        ? updates.listPage
                        : (
                            current[13] === "" ||
                            current[13] === undefined ||
                            current[13] === null
                                ? 0
                                : current[13]
                        ),

                    updates.location !== undefined
                        ? updates.location
                        : current[14]
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
                updates.patientName || "",
                updates.slotPage !== undefined
                    ? updates.slotPage
                    : 0,
                updates.apptPage !== undefined
                    ? updates.apptPage
                    : 0,
                updates.doctorMenuTier !== undefined
                    ? updates.doctorMenuTier
                    : "",
                updates.listPage !== undefined
                    ? updates.listPage
                    : 0,
                updates.location || ""
            ]);
        }

    } finally {

        // MUST run after every write so next read sees fresh data instead of
        // cached value. Placed in finally block to ensure cache invalidation
        // even if an exception occurs during save operation.
        invalidateWhatsAppSessionCache(phone);
    }
}

function clearWhatsAppSession(phone) {

    const session =
        getWhatsAppSession(phone);

    if (!session) {
        return;
    }

    const sheet =
        ensureWhatsAppSessionsSheet();

    sheet
        .getRange(
            session.row,
            2,
            1,
            7
        )
        .clearContent();

    invalidateWhatsAppSessionCache(phone);
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


// ============================================================
// Auto-inserted by scripts/sync-monolith-from-src.js
// ============================================================


function getClinicName() {

    const name =
        String(
            getSetting(
                "CLINIC_NAME",
                "ABC Clinic"
            ) || ""
        ).trim();

    return name || "ABC Clinic";
}


function getHospitalLocation() {

    const latText =
        String(
            getSetting("HOSPITAL_LATITUDE", "") || ""
        ).trim();

    const lngText =
        String(
            getSetting("HOSPITAL_LONGITUDE", "") || ""
        ).trim();

    // Check the raw setting text is non-empty before parsing — Number("")
    // is 0, which would otherwise be indistinguishable from a genuine
    // (0, 0) coordinate and silently treat "not configured" as "hospital
    // is at the equator".
    if (!latText || !lngText) {
        return null;
    }

    const lat =
        Number(latText);

    const lng =
        Number(lngText);

    if (
        !isFinite(lat) ||
        !isFinite(lng)
    ) {
        return null;
    }

    return {
        lat: lat,
        lng: lng
    };
}


function getHomeCollectionRadiusKm() {

    const radius =
        Number(
            getSetting("HOME_COLLECTION_RADIUS_KM", "5")
        );

    return (
        isFinite(radius) &&
        radius > 0
    )
        ? radius
        : 5;
}


function getTimezoneOffsetString() {

    const now = new Date();

    const utcDate =
        new Date(now.getTime() +
        now.getTimezoneOffset() * 60000);

    const tzDate =
        new Date(
            Utilities.formatDate(now, TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss")
        );

    const diffMs =
        tzDate.getTime() - utcDate.getTime();

    const diffMins = Math.round(diffMs / 60000);
    const hours = Math.floor(Math.abs(diffMins) / 60);
    const mins = Math.abs(diffMins) % 60;

    const sign = diffMins >= 0 ? "+" : "-";

    return (
        sign +
        String(hours).padStart(2, "0") + ":" +
        String(mins).padStart(2, "0")
    );
}


function buildISODatetimeWithTimezone(dateString, timeString) {

    if (!dateString) {
        return "";
    }

    const tzOffset = getTimezoneOffsetString();

    if (!timeString) {
        return dateString + "T00:00:00" + tzOffset;
    }

    return dateString + "T" + timeString + ":00" + tzOffset;
}


function haversineDistanceKm(
    lat1,
    lng1,
    lat2,
    lng2
) {

    const EARTH_RADIUS_KM = 6371;

    const toRadians =
        function (degrees) {
            return degrees * (Math.PI / 180);
        };

    const dLat =
        toRadians(lat2 - lat1);

    const dLng =
        toRadians(lng2 - lng1);

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRadians(lat1)) *
        Math.cos(toRadians(lat2)) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);

    const c =
        2 * Math.atan2(
            Math.sqrt(a),
            Math.sqrt(1 - a)
        );

    return EARTH_RADIUS_KM * c;
}


function isTextInputAllowedForState(state) {
    return TEXT_INPUT_ALLOWED_STATES.indexOf(state) !== -1;
}


function shouldRejectPlainTextInput(messageType, session) {
    // Allow text input only if:
    // 1. Message is interactive (button/list reply), OR
    // 2. Message is location (shared location), OR
    // 3. Session state explicitly allows text input

    if (messageType === "interactive" || messageType === "location") {
        return false;  // Allow interactive messages and locations
    }

    if (!session || !session.state) {
        return false;  // Allow if no session
    }

    // Reject plain text if state doesn't allow it
    return !isTextInputAllowedForState(session.state);
}


function isStateProtectedFromNavigation(state) {
    return PROTECTED_BOOKING_STATES.indexOf(state) !== -1;
}


function ensureIdempotencySheet() {

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName("Message_Deduplication");

    if (!sheet) {
        sheet = ss.insertSheet("Message_Deduplication");
        sheet.appendRow([
            "Message ID",
            "Phone",
            "Processed At",
            "Status",
            "Expires At"
        ]);
        // Hide this operational sheet
        sheet.hideSheet();
    }

    return sheet;
}


function checkMessageIdempotency(messageId) {

    if (!messageId) {
        return { isProcessed: false, isExpired: false };
    }

    const sheet = ensureIdempotencySheet();
    const data = sheet.getDataRange().getValues();
    const now = new Date();
    const retentionMs = 7 * 24 * 60 * 60 * 1000;  // 7 days retention

    for (let i = 1; i < data.length; i++) {
        const rowMessageId = String(data[i][0] || "").trim();

        if (rowMessageId !== String(messageId).trim()) {
            continue;
        }

        const processedAt = new Date(data[i][2]);
        const expiresAt = new Date(data[i][4]);
        const age = now - processedAt;

        return {
            isProcessed: true,
            isExpired: age > retentionMs,
            lastProcessedAt: processedAt,
            status: String(data[i][3] || ""),
            row: i + 1
        };
    }

    return { isProcessed: false, isExpired: false };
}


function recordMessageProcessing(messageId, phone) {

    if (!messageId) {
        return false;
    }

    const sheet = ensureIdempotencySheet();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));

    sheet.appendRow([
        String(messageId).trim(),
        String(phone || "").trim(),
        now,
        "PROCESSING",
        expiresAt
    ]);

    return true;
}


function markMessageProcessed(messageId, status) {

    if (!messageId) {
        return false;
    }

    const sheet = ensureIdempotencySheet();
    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
        const rowMessageId = String(data[i][0] || "").trim();

        if (rowMessageId === String(messageId).trim()) {
            sheet.getRange(i + 1, 4).setValue(status || "SUCCESS");
            return true;
        }
    }

    return false;
}


function cleanupExpiredDeduplicationRecords() {

    const sheet = ensureIdempotencySheet();
    const data = sheet.getDataRange().getValues();
    const now = new Date();
    const rowsToDelete = [];

    for (let i = data.length - 1; i >= 1; i--) {
        const expiresAt = new Date(data[i][4]);

        if (now > expiresAt) {
            rowsToDelete.push(i + 1);
        }
    }

    // Delete in reverse order to maintain row numbers
    for (const row of rowsToDelete) {
        sheet.deleteRow(row);
    }

    return rowsToDelete.length;
}


function ensureAppointmentHistorySheet() {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    let sheet =
        ss.getSheetByName("Appointment_History");

    if (!sheet) {

        sheet = ss.insertSheet("Appointment_History");

        sheet.appendRow([
            "Appointment ID",
            "Date",
            "Time",
            "Doctor ID",
            "Patient Name",
            "Phone",
            "Status",
            "Calendar Event ID",
            "Patient ID",
            "Archived At"
        ]);

        // Hide this operational/archive sheet
        sheet.hideSheet();
    }

    return sheet;
}


function archivePreviousDayAppointments() {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const appointmentSheet =
        ss.getSheetByName("Appointments");

    if (!appointmentSheet) {
        Logger.log(
            "archivePreviousDayAppointments: Appointments sheet not found"
        );
        return {
            success: false,
            message:
                "Appointments sheet not found"
        };
    }

    const historySheet =
        ensureAppointmentHistorySheet();

    // ========================================================
    // GET YESTERDAY'S DATE
    // ========================================================

    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    const yesterdayIso =
        Utilities.formatDate(
            yesterday,
            TIMEZONE,
            "yyyy-MM-dd"
        );

    Logger.log(
        "archivePreviousDayAppointments: Processing date " +
        yesterdayIso
    );

    // ========================================================
    // LOAD APPOINTMENTS
    // ========================================================

    const appointmentData =
        appointmentSheet.getDataRange().getValues();

    const rowsToArchive = [];
    const archivedAt = new Date();

    // Scan from end backwards to collect rows for yesterday
    for (
        let i = appointmentData.length - 1;
        i >= 1;
        i--
    ) {

        let appointmentDate = "";

        if (
            appointmentData[i][1] instanceof Date
        ) {

            appointmentDate =
                Utilities.formatDate(
                    appointmentData[i][1],
                    TIMEZONE,
                    "yyyy-MM-dd"
                );

        } else {

            appointmentDate =
                String(appointmentData[i][1] || "").trim();
        }

        if (appointmentDate === yesterdayIso) {

            // ====================================================
            // Archive this row
            // ====================================================

            const rowData = [
                appointmentData[i][0],  // Appointment ID
                appointmentData[i][1],  // Date
                appointmentData[i][2],  // Time
                appointmentData[i][3],  // Doctor ID
                appointmentData[i][4],  // Patient Name
                appointmentData[i][5],  // Phone
                appointmentData[i][6],  // Status
                appointmentData[i][7],  // Calendar Event ID
                appointmentData[i][8],  // Patient ID
                archivedAt              // Archived At
            ];

            historySheet.appendRow(rowData);
            rowsToArchive.push(i + 1);  // Store 1-indexed row numbers
        }
    }

    // ========================================================
    // DELETE ARCHIVED ROWS
    // ========================================================
    // Delete in reverse order to avoid row number shifts

    for (
        let j = 0;
        j < rowsToArchive.length;
        j++
    ) {

        appointmentSheet.deleteRow(
            rowsToArchive[j]
        );
    }

    // ========================================================
    // INVALIDATE CACHE
    // ========================================================
    // Clear any cached session state that references these appointments

    CacheService.getScriptCache().removeAll([
        "WA_APPOINTMENTS_CACHE",
        "WA_DOCTOR_SCHEDULE_CACHE"
    ]);

    Logger.log(
        "archivePreviousDayAppointments: " +
        "Archived " + rowsToArchive.length +
        " appointments from " + yesterdayIso
    );

    return {
        success: true,
        message:
            "Archived " + rowsToArchive.length +
            " appointments from " + yesterdayIso,
        archivedCount: rowsToArchive.length
    };
}


function createDailyArchiveTask(
    hourOfDay,
    minuteOfHour
) {

    // ========================================================
    // VALIDATION
    // ========================================================

    const hour = hourOfDay || 0;  // default: midnight
    const minute = minuteOfHour || 0;

    if (
        hour < 0 || hour > 23 ||
        minute < 0 || minute > 59
    ) {

        return {
            success: false,
            message:
                "Invalid time: hour must be 0-23, minute must be 0-59"
        };
    }

    // ========================================================
    // REMOVE EXISTING TRIGGER (if any)
    // ========================================================

    const existingTriggers =
        ScriptApp.getProjectTriggers();

    for (
        let i = 0;
        i < existingTriggers.length;
        i++
    ) {

        const trigger = existingTriggers[i];

        if (
            trigger.getHandlerFunction() ===
            "archivePreviousDayAppointments"
        ) {

            ScriptApp.deleteTrigger(trigger);
            Logger.log(
                "createDailyArchiveTask: Removed existing trigger"
            );
        }
    }

    // ========================================================
    // CREATE NEW TRIGGER
    // ========================================================
    // Time-based trigger that fires daily at specified time

    ScriptApp.newTrigger("archivePreviousDayAppointments")
        .timeBased()
        .atHour(hour)
        .everyDays(1)
        .create();

    Logger.log(
        "createDailyArchiveTask: Created daily trigger at " +
        String(hour).padStart(2, "0") + ":" +
        String(minute).padStart(2, "0")
    );

    return {
        success: true,
        message:
            "Daily archive task scheduled at " +
            String(hour).padStart(2, "0") + ":" +
            String(minute).padStart(2, "0")
    };
}


function removeDailyArchiveTask() {

    const existingTriggers =
        ScriptApp.getProjectTriggers();

    let removedCount = 0;

    for (
        let i = 0;
        i < existingTriggers.length;
        i++
    ) {

        const trigger = existingTriggers[i];

        if (
            trigger.getHandlerFunction() ===
            "archivePreviousDayAppointments"
        ) {

            ScriptApp.deleteTrigger(trigger);
            removedCount++;
        }
    }

    Logger.log(
        "removeDailyArchiveTask: Removed " +
        removedCount + " trigger(s)"
    );

    return {
        success: true,
        message:
            "Removed " + removedCount + " daily archive trigger(s)"
    };
}


function ensureSlotReservationSheet() {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    let sheet =
        ss.getSheetByName("Slot_Reservations");

    if (!sheet) {

        sheet = ss.insertSheet("Slot_Reservations");

        sheet.appendRow([
            "Doctor ID",
            "Date",
            "Time",
            "Patient Phone",
            "Reserved At",
            "Expires At"
        ]);

        // Hide this operational sheet
        sheet.hideSheet();
    }

    return sheet;
}


function reserveSlot(
    doctorId,
    dateString,
    timeString,
    patientPhone
) {

    if (
        !doctorId || !dateString ||
        !timeString || !patientPhone
    ) {

        return { reserved: false };
    }

    const sheet =
        ensureSlotReservationSheet();

    const now = new Date();
    const expiresAt =
        new Date(now.getTime() + (10 * 60 * 1000)); // 10-minute TTL

    sheet.appendRow([
        String(doctorId).trim(),
        String(dateString).trim(),
        String(timeString).trim(),
        String(patientPhone).trim(),
        now,
        expiresAt
    ]);

    return {
        reserved: true,
        expiresAt: expiresAt
    };
}


function isSlotReservedByOther(
    doctorId,
    dateString,
    timeString,
    patientPhone
) {

    if (
        !doctorId || !dateString ||
        !timeString || !patientPhone
    ) {

        return { isReserved: false };
    }

    const sheet =
        ensureSlotReservationSheet();

    const data = sheet.getDataRange().getValues();
    const now = new Date();
    const normalizedPhone =
        String(patientPhone).trim();
    const normalizedDoctor =
        String(doctorId).trim();
    const normalizedDate =
        String(dateString).trim();
    const normalizedTime =
        String(timeString).trim();

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        const reservedDoctor =
            String(data[i][0] || "").trim();

        const reservedDate =
            String(data[i][1] || "").trim();

        const reservedTime =
            String(data[i][2] || "").trim();

        const reservedPhone =
            String(data[i][3] || "").trim();

        const expiresAt =
            new Date(data[i][5]);

        // Skip expired reservations
        if (now > expiresAt) {
            continue;
        }

        // Check if this slot matches and belongs to someone else
        if (
            reservedDoctor === normalizedDoctor &&
            reservedDate === normalizedDate &&
            reservedTime === normalizedTime &&
            reservedPhone !== normalizedPhone
        ) {

            return {
                isReserved: true,
                reservedByPhone: reservedPhone
            };
        }
    }

    return { isReserved: false };
}


function clearSlotReservation(
    doctorId,
    dateString,
    timeString,
    patientPhone
) {

    if (
        !doctorId || !dateString ||
        !timeString || !patientPhone
    ) {

        return false;
    }

    const sheet =
        ensureSlotReservationSheet();

    const data = sheet.getDataRange().getValues();
    const normalizedPhone =
        String(patientPhone).trim();
    const normalizedDoctor =
        String(doctorId).trim();
    const normalizedDate =
        String(dateString).trim();
    const normalizedTime =
        String(timeString).trim();

    // Delete in reverse order to avoid row number shifts
    const rowsToDelete = [];

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        const reservedDoctor =
            String(data[i][0] || "").trim();

        const reservedDate =
            String(data[i][1] || "").trim();

        const reservedTime =
            String(data[i][2] || "").trim();

        const reservedPhone =
            String(data[i][3] || "").trim();

        if (
            reservedDoctor === normalizedDoctor &&
            reservedDate === normalizedDate &&
            reservedTime === normalizedTime &&
            reservedPhone === normalizedPhone
        ) {

            rowsToDelete.push(i + 1);
        }
    }

    for (
        let j = rowsToDelete.length - 1;
        j >= 0;
        j--
    ) {

        sheet.deleteRow(rowsToDelete[j]);
    }

    return rowsToDelete.length > 0;
}


function cleanupExpiredSlotReservations() {

    const sheet =
        ensureSlotReservationSheet();

    const data = sheet.getDataRange().getValues();
    const now = new Date();
    const rowsToDelete = [];

    for (
        let i = data.length - 1;
        i >= 1;
        i--
    ) {

        const expiresAt = new Date(data[i][5]);

        if (now > expiresAt) {
            rowsToDelete.push(i + 1);
        }
    }

    // Delete in reverse order
    for (const row of rowsToDelete) {
        sheet.deleteRow(row);
    }

    return rowsToDelete.length;
}


function validateDoctorClinicAccess(doctorId) {

    if (!doctorId) {
        return {
            authorized: false,
            reason: "Doctor ID is required"
        };
    }

    const doctor = getDoctorRecord(doctorId);

    if (!doctor) {
        return {
            authorized: false,
            reason: "Doctor not found"
        };
    }

    // Doctor exists (clinic isolation is per-sheet instance)
    // The Google Sheet itself is clinic-specific; all doctors in the
    // sheet belong to the same clinic. No clinic ID column needed.

    return {
        authorized: true,
        clinicName: doctor.clinicName || "",
        doctorName: doctor.doctorName || ""
    };
}


function validateAppointmentClinicAccess(appointmentId) {

    if (!appointmentId) {
        return {
            authorized: false,
            reason: "Appointment ID is required"
        };
    }

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Appointments");

    if (!sheet) {
        return {
            authorized: false,
            reason: "Appointments sheet not found"
        };
    }

    const data = sheet.getDataRange().getValues();

    // Find appointment (scan backwards for efficiency)
    for (let i = data.length - 1; i >= 1; i--) {

        const rowAppointmentId =
            String(data[i][0] || "").trim();

        if (rowAppointmentId !== String(appointmentId).trim()) {
            continue;
        }

        // Found appointment
        const doctorId =
            String(data[i][3] || "").trim();

        if (!doctorId) {
            return {
                authorized: false,
                reason: "Appointment has no doctor assigned"
            };
        }

        // Validate doctor belongs to clinic
        const doctorAccess =
            validateDoctorClinicAccess(doctorId);

        return {
            authorized: doctorAccess.authorized,
            doctorId: doctorId,
            clinicName: doctorAccess.clinicName,
            reason: doctorAccess.reason
        };
    }

    return {
        authorized: false,
        reason: "Appointment not found"
    };
}


function validatePatientDataAccess(appointmentId, patientPhone) {

    if (!appointmentId || !patientPhone) {
        return {
            authorized: false,
            reason: "Appointment ID and patient phone required"
        };
    }

    // Verify appointment exists and belongs to patient
    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Appointments");

    if (!sheet) {
        return {
            authorized: false,
            reason: "Appointments sheet not found"
        };
    }

    const data = sheet.getDataRange().getValues();

    for (let i = data.length - 1; i >= 1; i--) {

        const rowAppointmentId =
            String(data[i][0] || "").trim();

        if (
            rowAppointmentId !==
            String(appointmentId).trim()
        ) {
            continue;
        }

        // Found appointment — verify patient ownership
        const rowPhone =
            String(data[i][5] || "").trim();

        const authorized =
            phonesMatch(rowPhone, patientPhone);

        return {
            authorized: authorized,
            patientPhone: rowPhone,
            reason: authorized
                ? ""
                : "Patient phone does not match appointment"
        };
    }

    return {
        authorized: false,
        reason: "Appointment not found"
    };
}


function logRLSViolation(
    violationType,
    attemptedId,
    requestorType,
    requestorId,
    reason
) {

    try {

        const ss =
            SpreadsheetApp.getActiveSpreadsheet();

        let logSheet =
            ss.getSheetByName("RLS_Violations");

        if (!logSheet) {

            logSheet = ss.insertSheet("RLS_Violations");

            logSheet.appendRow([
                "Timestamp",
                "Violation Type",
                "Attempted ID",
                "Requestor Type",
                "Requestor ID",
                "Reason"
            ]);

            logSheet.hideSheet();
        }

        logSheet.appendRow([
            new Date(),
            violationType,
            attemptedId,
            requestorType,
            requestorId,
            reason
        ]);

    } catch (error) {

        Logger.log(
            "Failed to log RLS violation: " +
            error.message
        );
    }
}


function ensureAppointmentRemindersSheet() {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    let sheet =
        ss.getSheetByName("Reminder_Queue");

    if (!sheet) {

        sheet = ss.insertSheet("Reminder_Queue");

        sheet.appendRow([
            "Appointment ID",
            "Patient Phone",
            "Patient Name",
            "Doctor Name",
            "Appointment Date",
            "Appointment Time",
            "Reminder Type",
            "Scheduled For",
            "Sent At",
            "Status",
            "Message ID"
        ]);

        sheet.hideSheet();
    }

    return sheet;
}


function queueAppointmentReminder(
    appointmentId,
    patientPhone,
    patientName,
    doctorName,
    appointmentDate,
    appointmentTime,
    reminderType
) {

    if (
        !appointmentId || !patientPhone ||
        !patientName || !appointmentDate ||
        !appointmentTime || !reminderType
    ) {

        return false;
    }

    const sheet =
        ensureAppointmentRemindersSheet();

    let scheduledFor = null;

    if (reminderType === "24h") {

        // Schedule for 24 hours before appointment
        const appointmentDateTime =
            parseAppointmentSheetDateTime(
                appointmentDate,
                appointmentTime
            );

        scheduledFor =
            new Date(
                appointmentDateTime.getTime() -
                (24 * 60 * 60 * 1000)
            );

    } else if (reminderType === "1h") {

        // Schedule for 1 hour before appointment
        const appointmentDateTime =
            parseAppointmentSheetDateTime(
                appointmentDate,
                appointmentTime
            );

        scheduledFor =
            new Date(
                appointmentDateTime.getTime() -
                (60 * 60 * 1000)
            );

    } else {

        return false;
    }

    sheet.appendRow([
        String(appointmentId).trim(),
        String(patientPhone).trim(),
        String(patientName || "").trim(),
        String(doctorName || "").trim(),
        String(appointmentDate).trim(),
        String(appointmentTime).trim(),
        reminderType,
        scheduledFor,
        "",
        "PENDING",
        ""
    ]);

    return true;
}


function processDueReminders() {

    const sheet =
        ensureAppointmentRemindersSheet();

    if (!sheet) {

        return {
            processed: 0,
            sent: 0,
            failed: 0
        };
    }

    const data = sheet.getDataRange().getValues();
    const now = new Date();
    let sent = 0;
    let failed = 0;
    const rowsToUpdate = [];

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        const status =
            String(data[i][9] || "").trim();

        if (status !== "PENDING") {
            continue;
        }

        const scheduledFor =
            new Date(data[i][7]);

        if (now < scheduledFor) {
            continue;
        }

        // ====================================================
        // Send Reminder
        // ====================================================

        const appointmentId =
            String(data[i][0] || "").trim();

        const patientPhone =
            String(data[i][1] || "").trim();

        const patientName =
            String(data[i][2] || "").trim();

        const doctorName =
            String(data[i][3] || "").trim();

        const appointmentDate =
            String(data[i][4] || "").trim();

        const appointmentTime =
            String(data[i][5] || "").trim();

        const reminderType =
            String(data[i][6] || "").trim();

        const message =
            buildReminderMessage(
                patientName,
                doctorName,
                appointmentDate,
                appointmentTime,
                reminderType
            );

        try {

            const result =
                sendWhatsAppTextMessage(
                    patientPhone,
                    message
                );

            if (result && result.success) {

                rowsToUpdate.push({
                    row: i + 1,
                    status: "SENT",
                    messageId:
                        result.messageId || ""
                });

                sent++;

            } else {

                rowsToUpdate.push({
                    row: i + 1,
                    status: "FAILED",
                    messageId: ""
                });

                failed++;
            }

        } catch (error) {

            Logger.log(
                "Failed to send reminder for " +
                appointmentId + ": " +
                error.message
            );

            rowsToUpdate.push({
                row: i + 1,
                status: "ERROR",
                messageId: ""
            });

            failed++;
        }
    }

    // ====================================================
    // Update Sheet
    // ====================================================

    for (
        let j = 0;
        j < rowsToUpdate.length;
        j++
    ) {

        const update = rowsToUpdate[j];

        sheet.getRange(update.row, 9).setValue(
            new Date()
        );

        sheet.getRange(update.row, 10).setValue(
            update.status
        );

        if (update.messageId) {

            sheet.getRange(update.row, 11).setValue(
                update.messageId
            );
        }
    }

    Logger.log(
        "processDueReminders: Processed " +
        rowsToUpdate.length + " reminders (" +
        sent + " sent, " + failed + " failed)"
    );

    return {
        processed: rowsToUpdate.length,
        sent: sent,
        failed: failed
    };
}


function buildReminderMessage(
    patientName,
    doctorName,
    appointmentDate,
    appointmentTime,
    reminderType
) {

    const clinicName =
        getClinicName();

    const name = patientName || "Patient";

    if (reminderType === "24h") {

        return (
            "🔔 *Appointment Reminder*\n\n" +
            "Hi " + name + ",\n\n" +
            "This is a reminder about your " +
            "appointment with Dr. " + doctorName +
            " at " + clinicName + ".\n\n" +
            "📅 Date: " + appointmentDate + "\n" +
            "🕐 Time: " + appointmentTime + "\n\n" +
            "Please arrive 10 minutes early. " +
            "Reply with any questions.\n\n" +
            "Thank you!"
        );

    } else if (reminderType === "1h") {

        return (
            "⏰ *Appointment in 1 Hour*\n\n" +
            "Hi " + name + ",\n\n" +
            "Your appointment with Dr. " +
            doctorName + " is in 1 hour!\n\n" +
            "🕐 Time: " + appointmentTime + "\n" +
            "📍 Location: " + clinicName + "\n\n" +
            "If you need to reschedule, " +
            "please let us know now.\n\n" +
            "See you soon!"
        );

    } else {

        return (
            "Your appointment is scheduled for " +
            appointmentDate + " at " +
            appointmentTime + " with Dr. " +
            doctorName
        );
    }
}


function createRemindersSchedule(
    hourOfDay,
    minuteOfHour
) {

    const hour = hourOfDay || 0;
    const minute = minuteOfHour || 0;

    if (
        hour < 0 || hour > 23 ||
        minute < 0 || minute > 59
    ) {

        return {
            success: false,
            message:
                "Invalid time: hour 0-23, minute 0-59"
        };
    }

    // Remove existing trigger
    const existingTriggers =
        ScriptApp.getProjectTriggers();

    for (
        let i = 0;
        i < existingTriggers.length;
        i++
    ) {

        const trigger = existingTriggers[i];

        if (
            trigger.getHandlerFunction() ===
            "processDueReminders"
        ) {

            ScriptApp.deleteTrigger(trigger);
        }
    }

    // Create new trigger
    ScriptApp.newTrigger("processDueReminders")
        .timeBased()
        .atHour(hour)
        .everyDays(1)
        .create();

    Logger.log(
        "createRemindersSchedule: Trigger created at " +
        String(hour).padStart(2, "0") + ":" +
        String(minute).padStart(2, "0")
    );

    return {
        success: true,
        message:
            "Reminders scheduled at " +
            String(hour).padStart(2, "0") + ":" +
            String(minute).padStart(2, "0")
    };
}


function removeRemindersSchedule() {

    const existingTriggers =
        ScriptApp.getProjectTriggers();

    let removed = 0;

    for (
        let i = 0;
        i < existingTriggers.length;
        i++
    ) {

        const trigger = existingTriggers[i];

        if (
            trigger.getHandlerFunction() ===
            "processDueReminders"
        ) {

            ScriptApp.deleteTrigger(trigger);
            removed++;
        }
    }

    return {
        success: true,
        message:
            "Removed " + removed + " reminder trigger(s)"
    };
}


function exportAppointmentsToCSV(
    filterStatus,
    filterDoctorId,
    filterFromDate,
    filterToDate
) {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Appointments");

    if (!sheet) {

        return {
            success: false,
            message: "Appointments sheet not found"
        };
    }

    const data = sheet.getDataRange().getValues();
    const csvLines = [];

    // Header
    csvLines.push([
        "Appointment ID",
        "Date",
        "Time",
        "Doctor ID",
        "Patient Name",
        "Phone",
        "Status",
        "Calendar Event ID",
        "Patient ID"
    ].map(escapeCSVField).join(","));

    let exportedCount = 0;

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        const appointmentDate =
            String(data[i][1] || "").trim();

        const status =
            String(data[i][6] || "").trim();

        const doctorId =
            String(data[i][3] || "").trim();

        // ====================================================
        // Apply Filters
        // ====================================================

        if (
            filterStatus &&
            status.toUpperCase() !==
            String(filterStatus).toUpperCase()
        ) {
            continue;
        }

        if (
            filterDoctorId &&
            doctorId !== String(filterDoctorId).trim()
        ) {
            continue;
        }

        if (filterFromDate && appointmentDate) {

            if (appointmentDate < filterFromDate) {
                continue;
            }
        }

        if (filterToDate && appointmentDate) {

            if (appointmentDate > filterToDate) {
                continue;
            }
        }

        // ====================================================
        // Add Row
        // ====================================================

        csvLines.push([
            String(data[i][0] || ""),
            String(data[i][1] || ""),
            String(data[i][2] || ""),
            String(data[i][3] || ""),
            String(data[i][4] || ""),
            String(data[i][5] || ""),
            String(data[i][6] || ""),
            String(data[i][7] || ""),
            String(data[i][8] || "")
        ].map(escapeCSVField).join(","));

        exportedCount++;
    }

    const csv = csvLines.join("\n");

    return {
        success: true,
        csv: csv,
        rowCount: exportedCount,
        exportedAt: new Date()
    };
}


function createFullBackup() {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const timestamp =
        Utilities.formatDate(
            new Date(),
            TIMEZONE,
            "yyyy-MM-dd_HH-mm-ss"
        );

    const backupFolderName =
        "Clinic_Backup_" + timestamp;

    try {

        // Create backup folder
        const backupFolder =
            DriveApp.createFolder(backupFolderName);

        const fileCount = 0;

        // ====================================================
        // Export Appointments
        // ====================================================

        const appointmentsExport =
            exportAppointmentsToCSV();

        if (appointmentsExport.success) {

            backupFolder.createFile(
                "Appointments_" + timestamp + ".csv",
                appointmentsExport.csv,
                MimeType.PLAIN_TEXT
            );

            fileCount++;
        }

        // ====================================================
        // Export Doctors
        // ====================================================

        const doctorsExport =
            exportDoctorsToCSV();

        if (doctorsExport.success) {

            backupFolder.createFile(
                "Doctors_" + timestamp + ".csv",
                doctorsExport.csv,
                MimeType.PLAIN_TEXT
            );

            fileCount++;
        }

        // ====================================================
        // Export Patients
        // ====================================================

        const patientsExport =
            exportPatientsToCSV();

        if (patientsExport.success) {

            backupFolder.createFile(
                "Patients_" + timestamp + ".csv",
                patientsExport.csv,
                MimeType.PLAIN_TEXT
            );

            fileCount++;
        }

        Logger.log(
            "createFullBackup: Created backup with " +
            fileCount + " files in " +
            backupFolderName
        );

        return {
            success: true,
            folderId: backupFolder.getId(),
            folderName: backupFolderName,
            fileCount: fileCount,
            createdAt: new Date()
        };

    } catch (error) {

        Logger.log(
            "createFullBackup failed: " +
            error.message
        );

        return {
            success: false,
            message: error.message
        };
    }
}


function exportDoctorsToCSV() {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Doctors");

    if (!sheet) {

        return {
            success: false,
            message: "Doctors sheet not found"
        };
    }

    const data = sheet.getDataRange().getValues();
    const csvLines = [];

    // Use first row as header
    if (data.length > 0) {

        csvLines.push(
            data[0].map(escapeCSVField).join(",")
        );
    }

    for (let i = 1; i < data.length; i++) {

        csvLines.push(
            data[i].map(escapeCSVField).join(",")
        );
    }

    return {
        success: true,
        csv: csvLines.join("\n"),
        rowCount: data.length - 1
    };
}


function exportPatientsToCSV() {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Patients");

    if (!sheet) {

        return {
            success: false,
            message: "Patients sheet not found"
        };
    }

    const data = sheet.getDataRange().getValues();
    const csvLines = [];

    if (data.length > 0) {

        csvLines.push(
            data[0].map(escapeCSVField).join(",")
        );
    }

    for (let i = 1; i < data.length; i++) {

        csvLines.push(
            data[i].map(escapeCSVField).join(",")
        );
    }

    return {
        success: true,
        csv: csvLines.join("\n"),
        rowCount: data.length - 1
    };
}


function escapeCSVField(field) {

    const value = String(field || "");

    if (
        value.indexOf(",") > -1 ||
        value.indexOf("\"") > -1 ||
        value.indexOf("\n") > -1
    ) {

        return "\"" +
            value.replace(/"/g, "\"\"") +
            "\"";

    }

    return value;
}


function bulkRescheduleAppointments(
    filterDoctorId,
    filterFromDate,
    filterToDate,
    newDoctorId,
    newDate,
    updateReason
) {

    if (!newDoctorId && !newDate) {

        return {
            success: false,
            message:
                "Either newDoctorId or newDate is required"
        };
    }

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Appointments");

    if (!sheet) {

        return {
            success: false,
            message: "Appointments sheet not found"
        };
    }

    const appointmentData =
        sheet.getDataRange().getValues();

    const lock =
        LockService.getScriptLock();

    let lockAcquired = false;
    for (let attempt = 0; attempt < 3; attempt++) {
        if (lock.tryLock(5000)) {
            lockAcquired = true;
            break;
        }
    }

    if (!lockAcquired) {

        return {
            success: false,
            message: "Could not acquire lock"
        };
    }

    try {

        let updated = 0;
        let failed = 0;

        // ====================================================
        // Process Appointments
        // ====================================================

        for (
            let i = 1;
            i < appointmentData.length;
            i++
        ) {

            const appointmentId =
                String(appointmentData[i][0] || "");

            const doctorId =
                String(appointmentData[i][3] || "").trim();

            const appointmentDate =
                String(appointmentData[i][1] || "").trim();

            // ====================================================
            // Apply Filters
            // ====================================================

            if (
                filterDoctorId &&
                doctorId !==
                String(filterDoctorId).trim()
            ) {
                continue;
            }

            if (
                filterFromDate &&
                appointmentDate < filterFromDate
            ) {
                continue;
            }

            if (
                filterToDate &&
                appointmentDate > filterToDate
            ) {
                continue;
            }

            // ====================================================
            // Update Appointment
            // ====================================================

            try {

                const updateDoc = {};

                if (newDoctorId) {
                    updateDoc.doctorId = newDoctorId;
                }

                if (newDate) {
                    updateDoc.date = newDate;
                }

                // Note: This is a simplified update
                // Full implementation would handle calendar sync

                if (newDoctorId) {
                    sheet.getRange(i + 1, 4).setValue(
                        newDoctorId
                    );
                }

                if (newDate) {
                    sheet.getRange(i + 1, 2).setValue(
                        newDate
                    );
                }

                updated++;

            } catch (error) {

                Logger.log(
                    "Failed to update " + appointmentId +
                    ": " + error.message
                );

                failed++;
            }
        }

        Logger.log(
            "bulkRescheduleAppointments: " +
            updated + " updated, " + failed + " failed"
        );

        return {
            success: true,
            updated: updated,
            failed: failed
        };

    } finally {

        if (lock.hasLock()) {
            lock.releaseLock();
        }
    }
}


function bulkCancelAppointments(
    filterDoctorId,
    filterFromDate,
    filterToDate,
    cancelReason
) {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Appointments");

    if (!sheet) {

        return {
            success: false,
            message: "Appointments sheet not found"
        };
    }

    const appointmentData =
        sheet.getDataRange().getValues();

    const lock =
        LockService.getScriptLock();

    let lockAcquired = false;
    for (let attempt = 0; attempt < 3; attempt++) {
        if (lock.tryLock(5000)) {
            lockAcquired = true;
            break;
        }
    }

    if (!lockAcquired) {

        return {
            success: false,
            message: "Could not acquire lock"
        };
    }

    try {

        let cancelled = 0;
        const notificationQueue = [];

        // Scan backwards to collect matching appointments
        for (
            let i = appointmentData.length - 1;
            i >= 1;
            i--
        ) {

            const appointmentId =
                String(appointmentData[i][0] || "");

            const doctorId =
                String(appointmentData[i][3] || "").trim();

            const appointmentDate =
                String(appointmentData[i][1] || "").trim();

            const status =
                String(appointmentData[i][6] || "").trim();

            // Skip if already cancelled
            if (
                status.toUpperCase() ===
                "CANCELLED"
            ) {
                continue;
            }

            // Apply filters
            if (
                filterDoctorId &&
                doctorId !==
                String(filterDoctorId).trim()
            ) {
                continue;
            }

            if (
                filterFromDate &&
                appointmentDate < filterFromDate
            ) {
                continue;
            }

            if (
                filterToDate &&
                appointmentDate > filterToDate
            ) {
                continue;
            }

            // Cancel appointment
            sheet.getRange(i + 1, 7).setValue(
                "Cancelled"
            );

            cancelled++;

            // Queue notification
            notificationQueue.push({
                appointmentId: appointmentId,
                phone: appointmentData[i][5],
                patientName: appointmentData[i][4],
                reason: cancelReason || "Appointment cancelled"
            });
        }

        // Send notifications
        for (
            let j = 0;
            j < notificationQueue.length;
            j++
        ) {

            const notification = notificationQueue[j];

            try {

                sendWhatsAppTextMessage(
                    notification.phone,
                    "❌ *Appointment Cancelled*\n\n" +
                    "Hi " + notification.patientName + ",\n\n" +
                    "Your appointment has been cancelled.\n" +
                    "Reason: " + notification.reason + "\n\n" +
                    "Please contact us to reschedule.\n" +
                    "We apologize for the inconvenience."
                );

            } catch (error) {

                Logger.log(
                    "Failed to notify " +
                    notification.phone + ": " +
                    error.message
                );
            }
        }

        Logger.log(
            "bulkCancelAppointments: Cancelled " +
            cancelled + " appointments"
        );

        return {
            success: true,
            cancelled: cancelled,
            notificationsSent: notificationQueue.length
        };

    } finally {

        if (lock.hasLock()) {
            lock.releaseLock();
        }
    }
}


function deleteCompletedAppointments(
    olderThanDays
) {

    const daysAgo = olderThanDays || 90;

    if (daysAgo < 1) {

        return {
            success: false,
            message: "olderThanDays must be >= 1"
        };
    }

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Appointments");

    if (!sheet) {

        return {
            success: false,
            message: "Appointments sheet not found"
        };
    }

    const appointmentData =
        sheet.getDataRange().getValues();

    const cutoffDate = new Date();
    cutoffDate.setDate(
        cutoffDate.getDate() - daysAgo
    );

    const cutoffDateString =
        Utilities.formatDate(
            cutoffDate,
            TIMEZONE,
            "yyyy-MM-dd"
        );

    const lock =
        LockService.getScriptLock();

    let lockAcquired = false;
    for (let attempt = 0; attempt < 3; attempt++) {
        if (lock.tryLock(5000)) {
            lockAcquired = true;
            break;
        }
    }

    if (!lockAcquired) {

        return {
            success: false,
            message: "Could not acquire lock"
        };
    }

    try {

        let deleted = 0;
        const rowsToDelete = [];

        // Scan backwards
        for (
            let i = appointmentData.length - 1;
            i >= 1;
            i--
        ) {

            const appointmentDate =
                String(appointmentData[i][1] || "").trim();

            const status =
                String(appointmentData[i][6] || "").trim();

            // Only delete if completed/no-show
            if (
                status.toUpperCase() !== "COMPLETED" &&
                status.toUpperCase() !== "NO-SHOW" &&
                status.toUpperCase() !== "NOSHOW"
            ) {
                continue;
            }

            // Only delete if old enough
            if (appointmentDate >= cutoffDateString) {
                continue;
            }

            rowsToDelete.push(i + 1);
        }

        // Delete in reverse order
        for (const row of rowsToDelete) {

            sheet.deleteRow(row);
            deleted++;
        }

        Logger.log(
            "deleteCompletedAppointments: Deleted " +
            deleted + " appointments older than " +
            daysAgo + " days"
        );

        return {
            success: true,
            deleted: deleted
        };

    } finally {

        if (lock.hasLock()) {
            lock.releaseLock();
        }
    }
}


function cancelAppointmentWithRLSAudit(
    appointmentId,
    patientPhone,
    options,
    requestorType,
    requestorId
) {

    // ========================================================
    // RLS VALIDATION
    // ========================================================

    const rlsCheck =
        validateAppointmentClinicAccess(
            appointmentId
        );

    if (!rlsCheck.authorized) {

        logRLSViolation(
            "CANCEL_ATTEMPT",
            appointmentId,
            requestorType,
            requestorId,
            rlsCheck.reason
        );

        return {
            success: false,
            message:
                "Unauthorized: Unable to access appointment"
        };
    }

    // Verify patient if patient-initiated
    if (
        requestorType === "PATIENT"
    ) {

        const patientAccess =
            validatePatientDataAccess(
                appointmentId,
                patientPhone
            );

        if (!patientAccess.authorized) {

            logRLSViolation(
                "CANCEL_UNAUTHORIZED",
                appointmentId,
                requestorType,
                requestorId,
                patientAccess.reason
            );

            return {
                success: false,
                message:
                    "You can only cancel your own appointments"
            };
        }
    }

    // ========================================================
    // PROCEED WITH CANCELLATION
    // ========================================================

    const result =
        cancelAppointment(
            appointmentId,
            patientPhone,
            options
        );

    if (result.success) {

        Logger.log(
            "RLS Audit: Appointment " +
            appointmentId + " cancelled by " +
            requestorType + " (" + requestorId + ")"
        );
    }

    return result;
}


function rescheduleAppointmentWithRLSAudit(
    appointmentId,
    patientPhone,
    newDate,
    newTime,
    options,
    requestorType,
    requestorId
) {

    // ========================================================
    // RLS VALIDATION
    // ========================================================

    const rlsCheck =
        validateAppointmentClinicAccess(
            appointmentId
        );

    if (!rlsCheck.authorized) {

        logRLSViolation(
            "RESCHEDULE_ATTEMPT",
            appointmentId,
            requestorType,
            requestorId,
            rlsCheck.reason
        );

        return {
            success: false,
            message:
                "Unauthorized: Unable to access appointment"
        };
    }

    // Verify patient if patient-initiated
    if (
        requestorType === "PATIENT"
    ) {

        const patientAccess =
            validatePatientDataAccess(
                appointmentId,
                patientPhone
            );

        if (!patientAccess.authorized) {

            logRLSViolation(
                "RESCHEDULE_UNAUTHORIZED",
                appointmentId,
                requestorType,
                requestorId,
                patientAccess.reason
            );

            return {
                success: false,
                message:
                    "You can only reschedule your own appointments"
            };
        }
    }

    // ========================================================
    // PROCEED WITH RESCHEDULE
    // ========================================================

    const result =
        rescheduleAppointment(
            appointmentId,
            patientPhone,
            newDate,
            newTime,
            options
        );

    if (result.success) {

        Logger.log(
            "RLS Audit: Appointment " +
            appointmentId + " rescheduled by " +
            requestorType + " (" + requestorId + ")"
        );
    }

    return result;
}


function getPatientAppointmentsWithRLSAudit(
    patientPhone,
    requestorType,
    requestorId
) {

    // ========================================================
    // RLS VALIDATION
    // ========================================================

    // Patient can only view own appointments
    if (requestorType === "PATIENT") {

        // Patients can only see their own phone
        if (requestorId !== patientPhone) {

            logRLSViolation(
                "VIEW_APPOINTMENTS",
                "PATIENT:" + requestorId,
                requestorType,
                requestorId,
                "Attempted to view another patient's appointments"
            );

            return {
                success: false,
                message: "Unauthorized"
            };
        }
    }

    // Doctors can view any patient
    if (
        requestorType === "DOCTOR"
    ) {

        const doctorAccess =
            validateDoctorClinicAccess(
                requestorId
            );

        if (!doctorAccess.authorized) {

            logRLSViolation(
                "VIEW_APPOINTMENTS",
                "PATIENT:" + patientPhone,
                requestorType,
                requestorId,
                "Doctor not found in clinic"
            );

            return {
                success: false,
                message: "Unauthorized"
            };
        }
    }

    // ========================================================
    // PROCEED WITH VIEW
    // ========================================================

    try {

        const appointments =
            getMyAppointments(patientPhone);

        Logger.log(
            "RLS Audit: " + requestorType + " (" +
            requestorId + ") viewed appointments for " +
            patientPhone
        );

        return {
            success: true,
            appointments: appointments
        };

    } catch (error) {

        Logger.log(
            "Error retrieving appointments: " +
            error.message
        );

        return {
            success: false,
            message: "Unable to retrieve appointments"
        };
    }
}


function generateRLSAuditReport(
    fromDate,
    toDate
) {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("RLS_Violations");

    if (!sheet) {

        return {
            success: false,
            message: "No RLS violations recorded"
        };
    }

    const data = sheet.getDataRange().getValues();
    const report = [];

    report.push(
        "RLS Violation Audit Report"
    );

    report.push(
        "Generated: " +
        Utilities.formatDate(
            new Date(),
            TIMEZONE,
            "yyyy-MM-dd HH:mm:ss"
        )
    );

    report.push("");
    report.push("Total Violations: " + (data.length - 1));
    report.push("");
    report.push("Details:");
    report.push("");

    let filteredCount = 0;

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        const timestamp =
            String(data[i][0] || "");

        const violationType =
            String(data[i][1] || "");

        const attemptedId =
            String(data[i][2] || "");

        const requestorType =
            String(data[i][3] || "");

        const requestorId =
            String(data[i][4] || "");

        const reason =
            String(data[i][5] || "");

        // Apply date filters if provided
        if (fromDate && timestamp < fromDate) {
            continue;
        }

        if (toDate && timestamp > toDate) {
            continue;
        }

        filteredCount++;

        report.push(
            filteredCount + ". " +
            "[" + timestamp + "] " +
            violationType + " - " +
            requestorType + " (" + requestorId + ") " +
            "attempted " + attemptedId + ": " +
            reason
        );
    }

    report.push("");
    report.push("End of Report");

    return {
        success: true,
        report: report.join("\n"),
        violationCount: filteredCount
    };
}


function ensureDoctorProfileColumns() {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Doctors");

    if (!sheet) {
        return false;
    }

    const headers =
        sheet.getRange(1, 1, 1, 20).getValues()[0];

    const headerMap = {};
    for (let i = 0; i < headers.length; i++) {
        headerMap[String(headers[i]).trim().toLowerCase()] =
            i + 1;
    }

    // Ensure columns exist
    const columnsNeeded = {
        "specialty": 7,
        "qualifications": 8,
        "yearsexperience": 9,
        "languages": 10,
        "rating": 11,
        "reviewcount": 12
    };

    let maxCol = Math.max(...Object.values(columnsNeeded));

    // Add headers if missing
    if (!headerMap["specialty"]) {
        sheet.getRange(1, 7).setValue("Specialty");
    }

    if (!headerMap["qualifications"]) {
        sheet.getRange(1, 8).setValue("Qualifications");
    }

    if (!headerMap["yearsexperience"]) {
        sheet.getRange(1, 9).setValue("Years Experience");
    }

    if (!headerMap["languages"]) {
        sheet.getRange(1, 10).setValue("Languages");
    }

    if (!headerMap["rating"]) {
        sheet.getRange(1, 11).setValue("Rating");
    }

    if (!headerMap["reviewcount"]) {
        sheet.getRange(1, 12).setValue("Review Count");
    }

    return true;
}


function getDoctorProfile(doctorId) {

    const doctor = getDoctorRecord(doctorId);

    if (!doctor) {
        return null;
    }

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Doctors");

    if (!sheet) {
        return doctor;
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

            return {
                ...doctor,
                specialty:
                    String(data[i][6] || "").trim(),

                qualifications:
                    String(data[i][7] || "").trim(),

                yearsExperience:
                    Number(data[i][8] || 0),

                languages:
                    String(data[i][9] || "").trim(),

                rating:
                    Number(data[i][10] || 0),

                reviewCount:
                    Number(data[i][11] || 0)
            };
        }
    }

    return doctor;
}


function formatDoctorProfileMessage(doctorId, includeSlots) {

    const doctor = getDoctorProfile(doctorId);

    if (!doctor) {
        return "Doctor not found.";
    }

    let message =
        "👨‍⚕️ *" + doctor.doctorName + "*\n";

    if (doctor.specialty) {
        message += "📋 " + doctor.specialty + "\n";
    }

    if (doctor.qualifications) {
        message +=
            "🎓 " + doctor.qualifications + "\n";
    }

    if (doctor.yearsExperience > 0) {
        message +=
            "📅 " + doctor.yearsExperience +
            " years experience\n";
    }

    if (doctor.languages) {
        message +=
            "🗣️ " + doctor.languages + "\n";
    }

    if (
        doctor.rating > 0 &&
        doctor.reviewCount > 0
    ) {

        const stars =
            "⭐".repeat(
                Math.round(doctor.rating)
            );

        message +=
            stars + " " +
            doctor.rating.toFixed(1) +
            " (" + doctor.reviewCount +
            " reviews)\n";
    }

    if (includeSlots) {
        message += "\n📅 *Available Slots*\n";
    }

    return message;
}


function getAllDoctorProfiles() {

    const doctors = getDoctors();
    const profiles = [];

    for (
        let i = 0;
        i < doctors.length;
        i++
    ) {

        const profile =
            getDoctorProfile(doctors[i].doctorId);

        if (profile) {
            profiles.push(profile);
        }
    }

    return profiles;
}


function buildDoctorSelectionWithProfiles() {

    const doctors = getAllDoctorProfiles();

    if (doctors.length === 0) {
        return null;
    }

    const menuItems = [];

    for (
        let i = 0;
        i < doctors.length;
        i++
    ) {

        const doc = doctors[i];

        let title =
            doc.doctorName || "Unknown";

        if (doc.specialty) {
            title += " - " + doc.specialty;
        }

        let description =
            doc.qualifications || "";

        if (
            doc.yearsExperience > 0
        ) {

            if (description) {
                description += " | ";
            }

            description +=
                doc.yearsExperience +
                " years";
        }

        menuItems.push({
            id: String(doc.doctorId || i + 1),
            title: title,
            description: description
        });
    }

    return menuItems;
}


function getSlotsByDoctor(doctorId) {

    const slots = {};

    // Get current + next 7 days
    const today = new Date();

    for (
        let dayOffset = 0;
        dayOffset < 7;
        dayOffset++
    ) {

        const date = new Date(today);
        date.setDate(date.getDate() + dayOffset);

        const dateString =
            Utilities.formatDate(
                date,
                TIMEZONE,
                "yyyy-MM-dd"
            );

        const availableSlots =
            getAvailableSlots(
                doctorId,
                dateString
            );

        if (
            availableSlots &&
            availableSlots.length > 0
        ) {

            slots[dateString] =
                availableSlots;
        }
    }

    return slots;
}


function formatSlotsForWhatsApp(doctorId) {

    const slots = getSlotsByDoctor(doctorId);

    if (
        !slots ||
        Object.keys(slots).length === 0
    ) {

        return "No available slots.";
    }

    let message =
        "📅 *Available Slots* (Next 7 Days)\n\n";

    let slotCount = 1;
    const slotMap = {}; // id → {date, time}

    for (
        const dateString in slots
    ) {

        if (!slots.hasOwnProperty(dateString)) {
            continue;
        }

        const dayName =
            Utilities.formatDate(
                new Date(dateString + "T00:00:00"),
                TIMEZONE,
                "EEE, MMM d"
            );

        message += "*" + dayName + "*\n";

        const daySlots = slots[dateString];

        for (
            let i = 0;
            i < daySlots.length;
            i++
        ) {

            const slotId = String(slotCount);
            const time = daySlots[i];

            slotMap[slotId] = {
                date: dateString,
                time: time
            };

            message +=
                slotId + ". " + time + "\n";

            slotCount++;
        }

        message += "\n";
    }

    return {
        message: message,
        slotMap: slotMap,
        totalSlots: slotCount - 1
    };
}


function buildQuickBookingMenu(doctorId) {

    const slots = getSlotsByDoctor(doctorId);

    if (
        !slots ||
        Object.keys(slots).length === 0
    ) {

        return {
            success: false,
            message: "No available slots for this doctor."
        };
    }

    const menuRows = [];
    let rowId = 1;

    for (
        const dateString in slots
    ) {

        if (!slots.hasOwnProperty(dateString)) {
            continue;
        }

        const daySlots = slots[dateString];

        for (
            let i = 0;
            i < daySlots.length;
            i++
        ) {

            const time = daySlots[i];

            const dayName =
                Utilities.formatDate(
                    new Date(dateString + "T00:00:00"),
                    TIMEZONE,
                    "EEE, MMM d"
                );

            menuRows.push({
                id: String(rowId),
                title: dayName + " @ " + time,
                description: "Book this slot"
            });

            rowId++;
        }
    }

    return {
        success: true,
        rows: menuRows,
        rowCount: menuRows.length
    };
}


function quickBookAppointment(
    doctorId,
    patientPhone,
    patientName,
    patientLanguage,
    slotSelection
) {

    const slots = getSlotsByDoctor(doctorId);

    if (!slots) {

        return {
            success: false,
            message: "No available slots."
        };
    }

    // Find the selected slot
    let selectedSlotIndex = 0;
    let selectedDate = "";
    let selectedTime = "";
    let slotFound = false;

    for (
        const dateString in slots
    ) {

        if (!slots.hasOwnProperty(dateString)) {
            continue;
        }

        const daySlots = slots[dateString];

        for (
            let i = 0;
            i < daySlots.length;
            i++
        ) {

            selectedSlotIndex++;

            if (
                String(selectedSlotIndex) ===
                String(slotSelection).trim()
            ) {

                selectedDate = dateString;
                selectedTime = daySlots[i];
                slotFound = true;
                break;
            }
        }

        if (slotFound) {
            break;
        }
    }

    if (!slotFound) {

        return {
            success: false,
            message:
                "Invalid slot selection."
        };
    }

    // Book the appointment directly
    return bookAppointment(
        doctorId,
        selectedDate,
        selectedTime,
        patientName,
        patientPhone,
        patientLanguage
    );
}


function getPatientAppointmentHistory(patientPhone) {

    if (!patientPhone) {
        return {
            appointments: [],
            count: 0
        };
    }

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Appointments");

    if (!sheet) {

        return {
            appointments: [],
            count: 0
        };
    }

    const data = sheet.getDataRange().getValues();
    const history = [];

    // Scan backwards (most recent first)
    for (
        let i = data.length - 1;
        i >= 1;
        i--
    ) {

        const phone =
            String(data[i][5] || "").trim();

        const status =
            String(data[i][6] || "").trim();

        // Only include completed appointments
        if (
            !phonesMatch(phone, patientPhone) ||
            (
                status.toUpperCase() !== "COMPLETED" &&
                status.toUpperCase() !== "NO-SHOW"
            )
        ) {
            continue;
        }

        const appointmentDate =
            String(data[i][1] || "").trim();

        const appointmentTime =
            String(data[i][2] || "").trim();

        const doctorId =
            String(data[i][3] || "").trim();

        const doctor =
            getDoctorRecord(doctorId);

        const doctorName =
            doctor && doctor.doctorName
                ? doctor.doctorName
                : "Unknown Doctor";

        history.push({
            date: appointmentDate,
            time: appointmentTime,
            doctor: doctorName,
            doctorId: doctorId,
            status: status
        });

        // Limit to last 5 appointments
        if (history.length >= 5) {
            break;
        }
    }

    return {
        appointments: history,
        count: history.length
    };
}


function formatPatientHistoryMessage(patientPhone) {

    const history =
        getPatientAppointmentHistory(patientPhone);

    if (
        !history ||
        history.count === 0
    ) {

        return null;
    }

    let message =
        "📋 *Your Recent Appointments*\n\n";

    for (
        let i = 0;
        i < history.appointments.length;
        i++
    ) {

        const appt = history.appointments[i];

        message +=
            (i + 1) + ". " +
            appt.date + " @ " +
            appt.time + "\n" +
            "   Dr. " + appt.doctor + "\n" +
            "   Status: " + appt.status + "\n\n";
    }

    return message;
}


function getLastAppointmentSummary(
    patientPhone,
    doctorId
) {

    if (!patientPhone || !doctorId) {
        return null;
    }

    const history =
        getPatientAppointmentHistory(patientPhone);

    if (!history || history.count === 0) {
        return null;
    }

    // Find last appointment with this doctor
    for (
        let i = 0;
        i < history.appointments.length;
        i++
    ) {

        const appt = history.appointments[i];

        if (appt.doctorId === doctorId) {

            return {
                date: appt.date,
                time: appt.time,
                doctor: appt.doctor,
                status: appt.status,
                message:
                    "Last visit: " + appt.date +
                    " with Dr. " + appt.doctor
            };
        }
    }

    return null;
}


function showPatientHistoryBeforeBooking(
    patientPhone,
    doctorId
) {

    let message = "";

    // Show recent appointments
    const historyMsg =
        formatPatientHistoryMessage(patientPhone);

    if (historyMsg) {
        message += historyMsg + "\n";
    }

    // Show last visit with this doctor
    const lastVisit =
        getLastAppointmentSummary(
            patientPhone,
            doctorId
        );

    if (lastVisit) {

        message +=
            "📅 *Last Visit with this Doctor*\n" +
            lastVisit.date + " @ " +
            lastVisit.time + "\n";
    }

    return message || null;
}


function addAppointmentNotes(
    appointmentId,
    notes
) {

    if (!appointmentId || !notes) {
        return false;
    }

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    let notesSheet =
        ss.getSheetByName("Appointment_Notes");

    if (!notesSheet) {

        notesSheet = ss.insertSheet("Appointment_Notes");

        notesSheet.appendRow([
            "Appointment ID",
            "Date",
            "Doctor Notes",
            "Created At"
        ]);

        notesSheet.hideSheet();
    }

    const date = new Date();

    notesSheet.appendRow([
        String(appointmentId).trim(),
        Utilities.formatDate(date, TIMEZONE, "yyyy-MM-dd HH:mm:ss"),
        String(notes).trim(),
        date
    ]);

    return true;
}


function getAppointmentNotes(appointmentId) {

    if (!appointmentId) {
        return null;
    }

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Appointment_Notes");

    if (!sheet) {
        return null;
    }

    const data = sheet.getDataRange().getValues();

    for (
        let i = data.length - 1;
        i >= 1;
        i--
    ) {

        if (
            String(data[i][0] || "").trim() ===
            String(appointmentId).trim()
        ) {

            return {
                appointmentId: appointmentId,
                notes: String(data[i][2] || ""),
                createdAt: data[i][3]
            };
        }
    }

    return null;
}


function appendWhatsAppLogEntry(
    ss,
    entry
) {

    const settings =
        getLogSettings();

    if (
        entry.direction === "INBOUND" &&
        !settings.enableInboundLog
    ) {
        return;
    }

    if (
        entry.direction !== "INBOUND" &&
        entry.direction !== "WEBHOOK" &&
        !settings.enableDebugLog
    ) {
        return;
    }

    const sheet =
        ensureWhatsAppLogSheet(ss);

    sheet.appendRow([
        new Date(),
        entry.direction || "",
        entry.phone || "",
        truncateLogText(
            entry.name,
            100
        ),
        entry.status || "",
        truncateLogText(
            entry.message,
            settings.messageMaxChars
        ),
        "",
        "",
        entry.phoneNumberId || ""
    ]);

    cleanupLogSheet(
        sheet,
        settings
    );
}


function ensureDoctorSpecializationColumn(sheet) {

    if (!sheet.getRange(1, 8).getValue()) {
        sheet
            .getRange(1, 8)
            .setValue("Specialization");
    }
}


function generateUniqueAppointmentId(appointmentSheet) {

    const data =
        appointmentSheet.getDataRange().getValues();

    const existingIds = {};
    const maxRecentRows = 500;
    const startRow = Math.max(1, data.length - maxRecentRows);

    for (
        let i = startRow;
        i < data.length;
        i++
    ) {

        const id =
            String(data[i][0] || "").trim();

        if (id) {
            existingIds[id] = true;
        }
    }

    const maxAttempts = 5;

    for (
        let attempt = 0;
        attempt < maxAttempts;
        attempt++
    ) {

        const candidate =
            "A" +
            Utilities.getUuid()
                .replace(/-/g, "")
                .substring(0, 8)
                .toUpperCase();

        if (!existingIds[candidate]) {
            return candidate;
        }
    }

    throw new Error(
        "Unable to generate a unique appointment ID after " +
        maxAttempts +
        " attempts."
    );
}


function sendAppointmentReceiptCard(to, appointment) {

    const card =
        createAppointmentReceiptCardBlob(
            appointment
        );

    const mediaId =
        uploadWhatsAppImageBlob(card.blob);

    sendWhatsAppImageMessage(
        to,
        mediaId,
        "🎫 Appointment confirmation — please forward this card to the patient if you booked on their behalf."
    );

    return mediaId;
}


function createAppointmentReceiptCardBlob(appointment) {

    if (!appointment || !appointment.appointmentId) {
        throw new Error(
            "Appointment data is incomplete for receipt generation."
        );
    }

    let presentation = null;

    try {

        presentation =
            SlidesApp.create(
                getClinicName() + " Appointment Receipt"
            );

        const slide =
            presentation
                .getSlides()[0];

        // Use a clean white canvas.
        slide
            .getBackground()
            .setSolidFill("#FFFFFF");

        const pageWidth =
            presentation
                .getPageWidth();

        const pageHeight =
            presentation
                .getPageHeight();

        // ------------------------------------------------------
        // Top clinic/header area
        // ------------------------------------------------------

        const header =
            slide.insertShape(
                SlidesApp.ShapeType.RECTANGLE,
                0,
                0,
                pageWidth,
                105
            );

        header
            .getFill()
            .setSolidFill("#0B6E4F");

        header
            .getLine()
            .setTransparent();

        // ------------------------------------------------------
        // Hospital logo
        // ------------------------------------------------------

        const logoFileId =
            String(
                getSetting(
                    "APPOINTMENT_RECEIPT_LOGO_DRIVE_FILE_ID",
                    "1m5eZGBd_xSeXlVTjjpJBgMvlDYIqhWmx"
                ) || ""
            ).trim();

        if (logoFileId) {
            try {
                const logoFile =
                    DriveApp.getFileById(
                        logoFileId
                    );

                const logo =
                    slide.insertImage(
                        logoFile.getBlob()
                    );

                logo
                    .setLeft(22)
                    .setTop(17)
                    .setHeight(70);
            } catch (logoError) {
                Logger.log(
                    "Receipt logo could not be inserted: " +
                    logoError.message
                );
            }
        }

        const clinicName =
            getClinicName();

        const clinicText =
            slide.insertTextBox(
                String(clinicName || ""),
                105,
                22,
                pageWidth - 130,
                32
            );

        clinicText
            .getText()
            .getTextStyle()
            .setFontSize(22)
            .setBold(true)
            .setForegroundColor("#FFFFFF");

        const statusText =
            slide.insertTextBox(
                "APPOINTMENT CONFIRMED",
                105,
                56,
                pageWidth - 130,
                25
            );

        statusText
            .getText()
            .getTextStyle()
            .setFontSize(11)
            .setBold(true)
            .setForegroundColor("#FFFFFF");

        // ------------------------------------------------------
        // Appointment details
        // ------------------------------------------------------

        const doctorRecord =
            appointment.doctorId
                ? getDoctorRecord(
                    appointment.doctorId
                )
                : null;

        const specialization =
            doctorRecord &&
            doctorRecord.specialization
                ? doctorRecord.specialization
                : "";

        const doctorName =
            String(
                appointment.doctor ||
                (doctorRecord &&
                    doctorRecord.doctorName) ||
                "Doctor"
            );

        const details = [
            ["PATIENT", appointment.patientName || ""],
            ["DOCTOR", doctorName],
            ["SPECIALIZATION", specialization || ""],
            ["DATE", formatReceiptDate(appointment.date)],
            ["TIME", appointment.time || ""],
            ["APPOINTMENT ID", appointment.appointmentId],
            ["CLINIC", (doctorRecord && doctorRecord.clinicName) || clinicName || ""]
        ];

        let top = 125;

        details.forEach(function(row) {

            const label =
                slide.insertTextBox(
                    row[0],
                    35,
                    top,
                    135,
                    22
                );

            label
                .getText()
                .getTextStyle()
                .setFontSize(9)
                .setBold(true)
                .setForegroundColor("#777777");

            const value =
                slide.insertTextBox(
                    String(row[1] || ""),
                    175,
                    top - 2,
                    pageWidth - 210,
                    25
                );

            value
                .getText()
                .getTextStyle()
                .setFontSize(13)
                .setBold(row[0] === "APPOINTMENT ID")
                .setForegroundColor("#222222");

            top += 43;
        });

        // ------------------------------------------------------
        // Footer / sharing instruction
        // ------------------------------------------------------

        const footerTop =
            pageHeight - 70;

        const footerLine =
            slide.insertShape(
                SlidesApp.ShapeType.RECTANGLE,
                0,
                footerTop,
                pageWidth,
                1
            );

        footerLine
            .getFill()
            .setSolidFill("#DDDDDD");

        footerLine
            .getLine()
            .setTransparent();

        const footer =
            slide.insertTextBox(
                "Please show this confirmation at reception.\nYou can forward this card to the patient.",
                35,
                footerTop + 10,
                pageWidth - 70,
                45
            );

        footer
            .getText()
            .getTextStyle()
            .setFontSize(9)
            .setForegroundColor("#666666");

        presentation
            .saveAndClose();

        // ------------------------------------------------------
        // Export slide as PNG using Google Slides API.
        // This avoids any third-party image-generation service.
        // ------------------------------------------------------

        const presentationId =
            presentation.getId();

        const pageObjectId =
            slide.getObjectId();

        const thumbnailUrl =
            "https://slides.googleapis.com/v1/presentations/" +
            encodeURIComponent(presentationId) +
            "/pages/" +
            encodeURIComponent(pageObjectId) +
            "/thumbnail" +
            "?thumbnailProperties.mimeType=PNG" +
            "&thumbnailProperties.thumbnailSize=LARGE";

        const response =
            UrlFetchApp.fetch(
                thumbnailUrl,
                {
                    method: "get",
                    headers: {
                        Authorization:
                            "Bearer " +
                            ScriptApp.getOAuthToken()
                    },
                    muteHttpExceptions: true
                }
            );

        const code =
            response.getResponseCode();

        if (code < 200 || code >= 300) {
            throw new Error(
                "Google Slides thumbnail export failed (" +
                code + "): " +
                response.getContentText()
            );
        }

        const thumbnailInfo =
            JSON.parse(
                response.getContentText()
            );

        if (!thumbnailInfo.contentUrl) {
            throw new Error(
                "Google Slides did not return a thumbnail URL."
            );
        }

        const imageResponse =
            UrlFetchApp.fetch(
                thumbnailInfo.contentUrl,
                {
                    method: "get",
                    muteHttpExceptions: true
                }
            );

        if (
            imageResponse.getResponseCode() < 200 ||
            imageResponse.getResponseCode() >= 300
        ) {
            throw new Error(
                "Unable to download receipt PNG."
            );
        }

        const blob =
            imageResponse
                .getBlob()
                .setName(
                    "appointment-" +
                    appointment.appointmentId +
                    ".png"
                );

        return {
            blob: blob,
            presentationId: presentationId
        };

    } finally {

        if (presentation) {
            try {
                DriveApp
                    .getFileById(
                        presentation.getId()
                    )
                    .setTrashed(true);
            } catch (trashError) {
                Logger.log(
                    "Could not trash temporary receipt presentation: " +
                    trashError.message
                );
            }
        }
    }
}


function uploadWhatsAppImageBlob(blob) {

    if (!blob) {
        throw new Error(
            "Receipt image blob is missing."
        );
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
        "/media";

    const response =
        UrlFetchApp.fetch(
            url,
            {
                method: "post",
                headers: {
                    Authorization:
                        "Bearer " + accessToken
                },
                payload: {
                    messaging_product: "whatsapp",
                    type: "image/png",
                    file: blob
                },
                muteHttpExceptions: true
            }
        );

    const code =
        response.getResponseCode();

    const body =
        response.getContentText();

    if (code < 200 || code >= 300) {
        throw new Error(
            "WhatsApp receipt upload failed (" +
            code + "): " +
            body
        );
    }

    const parsed =
        JSON.parse(body);

    if (!parsed.id) {
        throw new Error(
            "WhatsApp receipt upload returned no media ID."
        );
    }

    return String(parsed.id);
}


function formatReceiptDate(isoDate) {

    const value =
        String(isoDate || "").trim();

    if (!value) {
        return "";
    }

    try {
        return Utilities.formatDate(
            new Date(
                buildISODatetimeWithTimezone(
                    value,
                    "00:00"
                )
            ),
            TIMEZONE,
            "EEEE, dd MMMM yyyy"
        );
    } catch (error) {
        return value;
    }
}


function ensureHomeCollectionSheet() {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    let sheet =
        ss.getSheetByName("Home_Collection_Requests");

    if (!sheet) {

        sheet =
            ss.insertSheet("Home_Collection_Requests");

        sheet.appendRow([
            "Request ID",
            "Phone",
            "Patient Name",
            "Latitude",
            "Longitude",
            "Distance (km)",
            "Preferred Date",
            "Time Window",
            "Status",
            "Created At"
        ]);
    }

    return sheet;
}


function generateHomeCollectionRequestId() {

    return (
        "HC" +
        Utilities.formatDate(
            new Date(),
            TIMEZONE,
            "yyMMddHHmmss"
        )
    );
}


function createHomeCollectionRequest(details) {

    const phone =
        String(details.phone || "").trim();

    if (!phone) {
        throw new Error(
            "Cannot create home collection request: phone number is missing"
        );
    }

    const sheet =
        ensureHomeCollectionSheet();

    const requestId =
        generateHomeCollectionRequestId();

    sheet.appendRow([
        requestId,
        phone,
        String(details.patientName || ""),
        details.latitude,
        details.longitude,
        details.distanceKm,
        String(details.date || ""),
        String(details.timeWindow || ""),
        "Pending",
        new Date()
    ]);

    return requestId;
}


function ensureWhatsAppSessionsSheet() {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    let sheet =
        ss.getSheetByName("WhatsApp_Sessions");

    if (!sheet) {

        sheet =
            ss.insertSheet("WhatsApp_Sessions");

        sheet.appendRow([
            "Phone",
            "Role",
            "State",
            "Doctor ID",
            "Date",
            "Time",
            "Appointment ID",
            "Updated At",
            "Language",
            "Patient Name",
            "Slot Page",
            "Appointment Page",
            "Doctor Menu Tier",
            "List Page",
            "Location"
        ]);
    }

    return sheet;
}


function getWhatsAppSessionCacheKey(phone) {
    return "WA_SESSION_" + normalizeWhatsAppPhone(phone);
}


function invalidateWhatsAppSessionCache(phone) {

    CacheService.getScriptCache().remove(
        getWhatsAppSessionCacheKey(phone)
    );
}


function readWhatsAppSessionFromSheet(phone) {

    const sheet =
        ensureWhatsAppSessionsSheet();

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
                String(data[i][9] || "").trim(),

            slotPage:
                data[i][10] === "" ||
                data[i][10] === undefined ||
                data[i][10] === null
                    ? 0
                    : parseInt(
                        data[i][10],
                        10
                    ) || 0,

            apptPage:
                data[i][11] === "" ||
                data[i][11] === undefined ||
                data[i][11] === null
                    ? 0
                    : parseInt(
                        data[i][11],
                        10
                    ) || 0,

            doctorMenuTier:
                data[i][12] === "" ||
                data[i][12] === undefined ||
                data[i][12] === null
                    ? ""
                    : String(data[i][12]).trim(),

            // Generic scroll-position field shared by any paginated list
            // menu that isn't the appointment list or the slot picker
            // (doctor selection, doctor's per-day session-remove list).
            // These states are mutually exclusive with each other and
            // with slot/appointment pagination, so one column covers all
            // of them the same way slotPage/apptPage already do for
            // their own flows.
            listPage:
                data[i][13] === "" ||
                data[i][13] === undefined ||
                data[i][13] === null
                    ? 0
                    : parseInt(
                        data[i][13],
                        10
                    ) || 0,

            // "lat,lng" string captured from a WhatsApp location share,
            // used by the home blood-sample-collection flow between the
            // location-check step and the final request being saved.
            location:
                String(data[i][14] || "").trim()
        };
    }

    return null;
}


function ensureWhatsAppSessionAppointmentPageColumn(sheet) {

    if (!sheet.getRange(1, 12).getValue()) {
        sheet
            .getRange(1, 12)
            .setValue("Appointment Page");
    }
}


function ensureWhatsAppSessionDoctorMenuTierColumn(sheet) {

    if (!sheet.getRange(1, 13).getValue()) {
        sheet
            .getRange(1, 13)
            .setValue("Doctor Menu Tier");
    }
}


function ensureWhatsAppSessionListPageColumn(sheet) {

    if (!sheet.getRange(1, 14).getValue()) {
        sheet
            .getRange(1, 14)
            .setValue("List Page");
    }
}


function ensureWhatsAppSessionLocationColumn(sheet) {

    if (!sheet.getRange(1, 15).getValue()) {
        sheet
            .getRange(1, 15)
            .setValue("Location");
    }
}


function ensureDoctorsSheet() {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    let sheet =
        ss.getSheetByName("Doctors");

    if (!sheet) {

        sheet =
            ss.insertSheet("Doctors");

        sheet.appendRow([
            "Doctor ID",
            "Doctor Name",
            "Clinic",
            "Calendar ID",
            "WhatsApp",
            "AppointmentDuration",
            "Active",
            "Specialization"
        ]);
    }

    return sheet;
}


function ensureAvailabilitySheet() {

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

    return sheet;
}


function ensureAppointmentsSheet() {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    let sheet =
        ss.getSheetByName("Appointments");

    if (!sheet) {

        sheet =
            ss.insertSheet("Appointments");

        sheet.appendRow([
            "Appointment ID",
            "Date",
            "Time",
            "Doctor ID",
            "Patient Name",
            "Phone",
            "Status",
            "Calendar Event ID",
            "Patient ID"
        ]);
    }

    return sheet;
}


function ensureDoctorLeavesSheet() {

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

    return sheet;
}


function initializeWhatsAppBotSheets() {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const results = [];

    function ensure(label, ensureFn) {

        const existedBefore =
            !!ss.getSheetByName(label);

        ensureFn();

        results.push({
            sheet: label,
            created: !existedBefore
        });
    }

    ensure(
        "Settings",
        ensureSettingsSheet
    );

    ensure(
        "WhatsApp_Log",
        function () {
            ensureWhatsAppLogSheet(ss);
        }
    );

    ensure(
        "Patients",
        ensurePatientsSheet
    );

    ensure(
        "WhatsApp_Sessions",
        ensureWhatsAppSessionsSheet
    );

    ensure(
        "Doctors",
        ensureDoctorsSheet
    );

    ensure(
        "Availability",
        ensureAvailabilitySheet
    );

    ensure(
        "Appointments",
        ensureAppointmentsSheet
    );

    ensure(
        "Doctor_Leaves",
        ensureDoctorLeavesSheet
    );

    ensure(
        "Home_Collection_Requests",
        ensureHomeCollectionSheet
    );

    Logger.log(
        "initializeWhatsAppBotSheets: " +
        JSON.stringify(results)
    );

    return {
        success: true,
        sheets: results
    };
}


function uploadWhatsAppMediaFromDriveFile(driveFileId) {

    requireDebugMode(
        "uploadWhatsAppMediaFromDriveFile"
    );

    const file =
        DriveApp.getFileById(driveFileId);

    const blob =
        file.getBlob();

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
        "/media";

    const response =
        UrlFetchApp.fetch(
            url,
            {
                method: "post",
                headers: {
                    Authorization:
                        "Bearer " + accessToken
                },
                payload: {
                    messaging_product: "whatsapp",
                    type: blob.getContentType(),
                    file: blob
                },
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
            "WhatsApp media upload error: " +
            responseBody
        );
    }

    let result;
    try {
        result =
            JSON.parse(responseBody);
    } catch (parseError) {
        throw new Error(
            "Failed to parse WhatsApp media upload response: " +
            parseError.message +
            " | Response: " +
            responseBody.substring(0, 200)
        );
    }

    Logger.log(
        "Uploaded '" +
        file.getName() +
        "' to WhatsApp. Media ID: " +
        result.id +
        " -- add this to the Settings sheet as HOSPITAL_LOGO_MEDIA_ID."
    );

    return result;
}


function getPatientMainMoreMenuSpec() {

    const fallbackText =
        "3️⃣ Cancel Appointment\n" +
        "4️⃣ Reschedule Appointment\n" +
        "5️⃣ Change Language\n" +
        "6️⃣ Home Sample Collection";

    const rows = [
        {
            id: "3",
            title: "Cancel Appointment"
        },
        {
            id: "4",
            title: "Reschedule"
        },
        {
            id: "5",
            title: "Change Language"
        },
        {
            id: "6",
            title: "Home Sample Collection",
            description: "Blood sample pickup at your home"
        }
    ];

    appendWhatsAppHomeNavRow(
        rows,
        "patient"
    );

    const interactive =
        buildInteractiveListSpec(
            rows,
            "Choose"
        );

    return {
        fallbackText: fallbackText,
        interactive: interactive
    };
}


function getDoctorMainMenuMoreSpec(tier) {

    const t =
        Number(tier) || 1;

    if (t === 1) {

        const fallbackText =
            "3️⃣ This Week\n" +
            "4️⃣ Schedule by Date\n" +
            "More → next page";

        const rows = [
            {
                id: "3",
                title: "This Week"
            },
            {
                id: "4",
                title: "Schedule by Date"
            },
            {
                id: "menu_more_2",
                title: "More"
            }
        ];

        appendWhatsAppHomeNavRow(
            rows,
            "doctor"
        );

        const interactive =
            buildInteractiveListSpec(
                rows,
                "Choose"
            );

        return {
            fallbackText: fallbackText,
            interactive: interactive
        };
    }

    if (t === 2) {

        const fallbackText =
            "5️⃣ Manage Availability\n" +
            "6️⃣ Manage Leaves\n" +
            "More → next page";

        const rows = [
            {
                id: "5",
                title: "Manage Availability"
            },
            {
                id: "6",
                title: "Manage Leaves"
            },
            {
                id: "menu_more_3",
                title: "More"
            }
        ];

        appendWhatsAppHomeNavRow(
            rows,
            "doctor"
        );

        const interactive =
            buildInteractiveListSpec(
                rows,
                "Choose"
            );

        return {
            fallbackText: fallbackText,
            interactive: interactive
        };
    }

    if (t === 3) {

        const fallbackText =
            "7️⃣ My Patients\n" +
            "8️⃣ Cancel Patient Appt\n" +
            "More → next page";

        const rows = [
            {
                id: "7",
                title: "My Patients"
            },
            {
                id: "8",
                title: "Cancel Patient"
            },
            {
                id: "menu_more_4",
                title: "More"
            }
        ];

        appendWhatsAppHomeNavRow(
            rows,
            "doctor"
        );

        const interactive =
            buildInteractiveListSpec(
                rows,
                "Choose"
            );

        return {
            fallbackText: fallbackText,
            interactive: interactive
        };
    }

    const fallbackText =
        "9️⃣ Reschedule Patient Appt\n" +
        "🔟 Mark Visit Status";

    const interactive =
        buildInteractiveButtonSpec([
            {
                id: "doctor_reschedule",
                title: "Reschedule Patient"
            },
            {
                id: "doctor_status",
                title: "Mark Visit Status"
            },
            {
                id: "nav_main_menu",
                title: "Doctor Portal"
            }
        ]);

    return {
        fallbackText: fallbackText,
        interactive: interactive
    };
}


function getHomeCollectionTimeWindowSpec() {

    const fallbackText =
        "1️⃣ Morning (8 AM - 12 PM)\n" +
        "2️⃣ Afternoon (12 PM - 4 PM)\n" +
        "3️⃣ Evening (4 PM - 8 PM)";

    const rows = [
        {
            id: "1",
            title: "Morning",
            description: "8 AM - 12 PM"
        },
        {
            id: "2",
            title: "Afternoon",
            description: "12 PM - 4 PM"
        },
        {
            id: "3",
            title: "Evening",
            description: "4 PM - 8 PM"
        }
    ];

    appendWhatsAppHomeNavRow(
        rows,
        "patient"
    );

    const interactive =
        buildInteractiveListSpec(
            rows,
            "Choose"
        );

    return {
        fallbackText: fallbackText,
        interactive: interactive
    };
}


function getMyAppointmentActionSpec() {

    const fallbackText =
        "1️⃣ Cancel Appointment\n" +
        "2️⃣ Reschedule\n" +
        "3️⃣ Main Menu";

    const interactive =
        buildInteractiveButtonSpec([
            {
                id: "appointment_action_cancel",
                title: "Cancel Appointment"
            },
            {
                id: "appointment_action_reschedule",
                title: "Reschedule"
            },
            {
                id: "nav_main_menu",
                title: "Main Menu"
            }
        ]);

    return {
        fallbackText: fallbackText,
        interactive: interactive
    };
}


function appendWhatsAppHomeNavRow(
    rows,
    listMode
) {

    if (
        !rows ||
        rows.length >= 10
    ) {
        return rows;
    }

    rows.push({
        id: "nav_main_menu",
        title:
            listMode === "doctor"
                ? "Doctor Portal"
                : "Main Menu",
        description: "Return to home"
    });

    return rows;
}


function buildAppointmentDetailMessage(appt) {

    const doctorName =
        findDoctorById(
            appt.doctorId
        ) || "Unknown Doctor";

    return (
        "👨‍⚕️ " + doctorName + "\n" +
        "📅 " +
        formatWhatsAppDisplayDate(
            appt.date
        ) +
        "\n" +
        "🕐 " + appt.time +
        "\n\n" +
        "What would you like to do with this appointment?"
    );
}


function formatAppointmentListRowDescription(appt) {

    return (
        formatWhatsAppDisplayDate(
            appt.date
        ) +
        " · " +
        (appt.time || "")
    );
}


function buildPatientAppointmentListBody(
    title,
    selectLine,
    pageInfo,
    prefix
) {

    let body =
        (prefix
            ? String(prefix) + "\n\n"
            : "") +
        title +
        "\n\n" +
        selectLine;

    if (
        pageInfo &&
        pageInfo.totalPages > 1
    ) {
        body +=
            "\n\nPage " +
            (pageInfo.page + 1) +
            " of " +
            pageInfo.totalPages;
    }

    return body;
}


function buildMyAppointmentsListBody(
    pageInfo,
    prefix
) {

    return buildPatientAppointmentListBody(
        "📋 Your appointments",
        "Select an appointment.",
        pageInfo,
        prefix
    );
}


function buildCancelAppointmentListBody(
    pageInfo,
    prefix
) {

    return buildPatientAppointmentListBody(
        "❌ Cancel appointment",
        "Select an appointment to cancel.",
        pageInfo,
        prefix
    );
}


function buildRescheduleAppointmentListBody(
    pageInfo,
    prefix
) {

    return buildPatientAppointmentListBody(
        "🔄 Reschedule appointment",
        "Select an appointment to reschedule.",
        pageInfo,
        prefix
    );
}


function buildPatientAppointmentListBodyForScreen(
    listScreen,
    pageInfo,
    prefix
) {

    if (listScreen === "my_appointments") {
        return buildMyAppointmentsListBody(
            pageInfo,
            prefix
        );
    }

    if (listScreen === "cancel") {
        return buildCancelAppointmentListBody(
            pageInfo,
            prefix
        );
    }

    if (listScreen === "reschedule") {
        return buildRescheduleAppointmentListBody(
            pageInfo,
            prefix
        );
    }

    return buildPatientAppointmentListBody(
        "Select an appointment",
        "Choose one:",
        pageInfo,
        prefix
    );
}


function buildCancelConfirmRetryBody(
    chosen,
    prefix
) {

    return (
        String(
            prefix || "❌ Invalid option."
        ) +
        "\n\n" +
        buildCancelConfirmMessage(chosen)
    );
}


function buildRescheduleConfirmRetryBody(
    session,
    prefix
) {

    return (
        String(
            prefix || "❌ Invalid option."
        ) +
        "\n\n" +
        buildRescheduleSlotConfirmMessage(
            session,
            session.date,
            session.time
        )
    );
}


function buildDoctorSelectionBody(prefix) {

    return (
        (prefix
            ? String(prefix) + "\n\n"
            : "") +
        "📅 Book Appointment\n\n" +
        "Choose your doctor."
    );
}


function buildDoctorSelectionFallbackText(
    doctors
) {

    if (
        !doctors ||
        doctors.length === 0
    ) {
        return "";
    }

    return doctors
        .map(
            function (doctor, index) {

                let line =
                    (index + 1) +
                    ". " +
                    doctor.doctorName;

                if (doctor.specialization) {
                    line +=
                        " — " +
                        doctor.specialization;
                }

                if (doctor.clinicName) {
                    line +=
                        " (" +
                        doctor.clinicName +
                        ")";
                }

                return line;
            }
        )
        .join("\n");
}


function buildLanguageSelectionBody(prefix) {

    return (
        (prefix
            ? String(prefix) + "\n\n"
            : "") +
        buildLanguageSelectionIntro()
    );
}


function buildDoctorAvailabilitySessionConfirmMessage(
    dayName,
    startTime,
    endTime
) {

    return (
        "Please confirm new session:\n\n" +
        "📅 " + dayName + "\n" +
        "🕐 " + startTime + " - " + endTime
    );
}


function buildDoctorLeaveConfirmMessage(
    leaveDate,
    reason
) {

    return (
        "Confirm leave:\n\n" +
        "📅 " + leaveDate + "\n" +
        (
            reason
                ? "📝 " + reason + "\n"
                : ""
        )
    );
}


function buildDoctorLeaveRangeConfirmMessage(
    startDate,
    endDate,
    reason
) {

    return (
        "Confirm leave range:\n\n" +
        "📅 " + startDate +
        " to " + endDate + "\n" +
        (
            reason
                ? "📝 " + reason + "\n"
                : ""
        )
    );
}


function applyClinicNamePlaceholder(message) {

    return String(message)
        .split("{{CLINIC_NAME}}")
        .join(getClinicName());
}


function isSimpleConfirmYesChoice(normalizedMessage) {

    const choice =
        String(normalizedMessage || "")
            .trim()
            .toLowerCase();

    return (
        choice === "1" ||
        choice === "confirm_yes"
    );
}


function isSimpleConfirmCancelChoice(normalizedMessage) {

    const choice =
        String(normalizedMessage || "")
            .trim()
            .toLowerCase();

    return (
        choice === "2" ||
        choice === "confirm_cancel"
    );
}


function isStatusCompletedChoice(normalizedMessage) {

    const choice =
        String(normalizedMessage || "")
            .trim()
            .toLowerCase();

    return (
        choice === "1" ||
        choice === "status_completed"
    );
}


function isStatusNoShowChoice(normalizedMessage) {

    const choice =
        String(normalizedMessage || "")
            .trim()
            .toLowerCase();

    return (
        choice === "2" ||
        choice === "status_no_show"
    );
}


function findConfirmedAppointmentForPhone(
    phone,
    appointmentId
) {

    const appointments =
        getConfirmedAppointmentsForPhone(phone);

    const target =
        String(appointmentId || "")
            .trim();

    for (
        let i = 0;
        i < appointments.length;
        i++
    ) {

        if (
            String(
                appointments[i].appointmentId
            ).trim() === target
        ) {
            return appointments[i];
        }
    }

    return null;
}


function handleWhatsAppMyAppointmentsState(
    ss,
    phone,
    session,
    normalizedMessage
) {

    handleWhatsAppAppointmentListSelection(
        ss,
        phone,
        session,
        normalizedMessage,
        {
            listScreen: "my_appointments",
            onChosen: function (chosen) {

                saveWhatsAppSession(phone, {
                    role: "PATIENT",
                    state: "MY_APPOINTMENT_ACTION",
                    doctorId: chosen.doctorId || "",
                    date: chosen.date || "",
                    time: chosen.time || "",
                    appointmentId:
                        chosen.appointmentId || "",
                    apptPage: 0
                });

                sendWhatsAppMenuReply(
                    ss,
                    phone,
                    buildAppointmentDetailMessage(
                        chosen
                    ),
                    getMyAppointmentActionSpec()
                );
            }
        }
    );
}


function handleWhatsAppMyAppointmentActionState(
    ss,
    phone,
    session,
    normalizedMessage
) {

    const choice =
        String(normalizedMessage || "")
            .trim()
            .toLowerCase();

    if (
        choice === "nav_main_menu" ||
        choice === "main_menu" ||
        choice === "3"
    ) {
        returnToMainMenu(ss, phone);
        return;
    }

    if (
        choice === "appointment_action_cancel" ||
        choice === "1"
    ) {

        saveWhatsAppSession(phone, {
            role: "PATIENT",
            state: "CANCEL_CONFIRM",
            appointmentId:
                session.appointmentId || ""
        });

        const chosen =
            findConfirmedAppointmentForPhone(
                phone,
                session.appointmentId
            );

        if (!chosen) {
            saveWhatsAppSession(phone, {
                role: "PATIENT",
                state: "MAIN_MENU",
                appointmentId: ""
            });

            sendPatientMainMenuReply(
                ss,
                phone,
                "❌ That appointment is no longer active."
            );
            return;
        }

        sendCancelConfirmMenuReply(
            ss,
            phone,
            chosen
        );
        return;
    }

    if (
        choice === "appointment_action_reschedule" ||
        choice === "2"
    ) {

        const chosen =
            findConfirmedAppointmentForPhone(
                phone,
                session.appointmentId
            );

        if (!chosen) {
            saveWhatsAppSession(phone, {
                role: "PATIENT",
                state: "MAIN_MENU",
                appointmentId: ""
            });

            sendPatientMainMenuReply(
                ss,
                phone,
                "❌ That appointment is no longer active."
            );
            return;
        }

        beginRescheduleDateSelection(
            ss,
            phone,
            chosen
        );
        return;
    }

    sendWhatsAppMenuReply(
        ss,
        phone,
        "❌ Invalid option.\n\n" +
            buildAppointmentDetailMessage({
                doctorId: session.doctorId,
                date: session.date,
                time: session.time
            }),
        getMyAppointmentActionSpec()
    );
}


function classifyWhatsAppAppointmentListChoice(
    normalizedMessage,
    appointmentsLength
) {

    const choice =
        String(normalizedMessage || "")
            .trim()
            .toLowerCase();

    if (
        choice === "nav_main_menu" ||
        choice === "main_menu" ||
        normalizedMessage === "0"
    ) {
        return { type: "main_menu" };
    }

    if (
        choice === "nav_back" ||
        choice === "back"
    ) {
        return { type: "back" };
    }

    if (
        choice === "appt_prev" ||
        choice === "prev"
    ) {
        return { type: "prev" };
    }

    if (
        choice === "appt_next" ||
        choice === "next"
    ) {
        return { type: "next" };
    }

    let selection = NaN;

    if (choice.indexOf("appt_") === 0) {

        selection =
            parseInt(
                choice.substring(5),
                10
            );

    } else {

        selection =
            parseInt(
                choice,
                10
            );
    }

    if (
        isNaN(selection) ||
        selection < 1 ||
        selection > appointmentsLength
    ) {
        return { type: "invalid" };
    }

    return {
        type: "selection",
        index: selection - 1
    };
}


function whatsAppNavigationShowsBack(session) {

    if (
        !session ||
        !session.state
    ) {
        return false;
    }

    const state =
        session.state;

    const role =
        session.role || "PATIENT";

    if (role === "DOCTOR") {

        const doctorFlatHome = [
            "DOCTOR_DATE",
            "DOCTOR_DATE_CUSTOM",
            "DOCTOR_AVAIL_MENU",
            "DOCTOR_LEAVE_MENU",
            "DOCTOR_CANCEL_SELECT",
            "DOCTOR_RESCHEDULE_SELECT",
            "DOCTOR_STATUS_SELECT"
        ];

        return (
            doctorFlatHome.indexOf(state) === -1
        );
    }

    const patientFlatHome = [
        "BOOK_DOCTOR",
        "MY_APPOINTMENTS",
        "MY_APPOINTMENT_ACTION",
        "CANCEL_SELECT",
        "RESCHEDULE_SELECT"
    ];

    return (
        patientFlatHome.indexOf(state) === -1
    );
}


function buildWhatsAppNavigationHintText(session) {

    if (
        !session ||
        !session.state ||
        session.state === "MAIN_MENU" ||
        session.state === "DOCTOR_MENU" ||
        session.state === "DOCTOR_MENU_MORE" ||
        session.state === "LANGUAGE_SELECT" ||
        session.state === "LANGUAGE_CHANGE"
    ) {
        return "";
    }

    const homeLabel =
        session.role === "DOCTOR"
            ? "0️⃣ Doctor Portal"
            : "0️⃣ Main Menu";

    const hints = [homeLabel];

    if (whatsAppNavigationShowsBack(session)) {
        hints.push("9️⃣ Back");
    }

    return hints.join("\n");
}


function normalizeDoctorMenuChoice(normalizedMessage) {

    const c =
        String(normalizedMessage || "")
            .trim()
            .toLowerCase();

    if (c === "doctor_reschedule") {
        return "9";
    }

    if (c === "doctor_status") {
        return "10";
    }

    return c;
}


function showDoctorMenuMoreTier(
    ss,
    phone,
    doctorId,
    tier,
    prefix
) {

    saveWhatsAppSession(
        phone,
        {
            role: "DOCTOR",
            state: "DOCTOR_MENU_MORE",
            doctorId: doctorId,
            doctorMenuTier: Number(tier) || 1
        }
    );

    sendDoctorMainMenuMoreReply(
        ss,
        phone,
        doctorId,
        tier,
        prefix
    );
}


function isDoctorMenuChoiceAllowedForTier(
    normalizedMessage,
    tier
) {

    const choice =
        normalizeDoctorMenuChoice(
            normalizedMessage
        );

    const t =
        Number(tier) || 1;

    if (t === 1) {
        return choice === "3" || choice === "4";
    }

    if (t === 2) {
        return choice === "5" || choice === "6";
    }

    if (t === 3) {
        return choice === "7" || choice === "8";
    }

    if (t === 4) {
        return choice === "9" || choice === "10";
    }

    return false;
}


function handleDoctorPortalMenuChoice(
    ss,
    phone,
    doctorId,
    normalizedMessage
) {

    const choice =
        normalizeDoctorMenuChoice(
            normalizedMessage
        );

    if (choice === "1") {

        returnDoctorToMenu(
            ss,
            phone,
            doctorId,
            formatDoctorSchedule(
                getDoctorTodaySchedule(
                    doctorId
                ),
                "Today's Schedule"
            )
        );

        return true;
    }

    if (choice === "2") {

        returnDoctorToMenu(
            ss,
            phone,
            doctorId,
            formatDoctorNext(
                getDoctorNextAppointment(
                    doctorId
                )
            )
        );

        return true;
    }

    if (choice === "3") {

        returnDoctorToMenu(
            ss,
            phone,
            doctorId,
            formatDoctorWeek(
                getDoctorWeeklySchedule(
                    doctorId
                )
            )
        );

        return true;
    }

    if (choice === "4") {

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

        showDoctorDateSelection(
            ss,
            phone
        );

        return true;
    }

    if (choice === "5") {

        showDoctorAvailabilityMenu(
            ss,
            phone,
            doctorId
        );

        return true;
    }

    if (choice === "6") {

        showDoctorLeavesMenu(
            ss,
            phone,
            doctorId
        );

        return true;
    }

    if (choice === "7") {

        returnDoctorToMenu(
            ss,
            phone,
            doctorId,
            formatDoctorPatientsList(
                doctorId
            )
        );

        return true;
    }

    if (choice === "8") {

        beginDoctorCancelFlow(
            ss,
            phone,
            doctorId
        );

        return true;
    }

    if (choice === "9") {

        beginDoctorRescheduleFlow(
            ss,
            phone,
            doctorId
        );

        return true;
    }

    if (choice === "10") {

        beginDoctorStatusFlow(
            ss,
            phone,
            doctorId
        );

        return true;
    }

    return false;
}


function beginWhatsAppHomeCollectionFlow(
    ss,
    senderPhone
) {

    if (!getHospitalLocation()) {

        sendPatientMainMoreMenuReply(
            ss,
            senderPhone,
            "❌ Home sample collection isn't set up yet. Please call the clinic directly."
        );

        return;
    }

    saveWhatsAppSession(
        senderPhone,
        {
            role: "PATIENT",
            state: "HOME_COLLECTION_LOCATION",
            doctorId: "",
            date: "",
            time: "",
            appointmentId: "",
            location: ""
        }
    );

    sendCustomDateEntryMenuReply(
        ss,
        senderPhone,
        "🩸 Home Sample Collection\n\n" +
        "Please share your location (tap 📎 Attach → Location in WhatsApp) " +
        "so we can confirm you're within " +
        getHomeCollectionRadiusKm() +
        " km of " +
        getClinicName() +
        "."
    );
}


function handleWhatsAppHomeCollectionMessage(
    ss,
    senderPhone,
    senderName,
    messageText,
    normalizedMessage,
    session,
    location
) {

    const homeCollectionStates = [
        "HOME_COLLECTION_LOCATION",
        "HOME_COLLECTION_DATE",
        "HOME_COLLECTION_DATE_CUSTOM",
        "HOME_COLLECTION_TIME"
    ];

    if (
        !session ||
        homeCollectionStates.indexOf(session.state) === -1
    ) {
        return false;
    }


    // ======================================================
    // WAITING FOR LOCATION SHARE
    // ======================================================

    if (session.state === "HOME_COLLECTION_LOCATION") {

        if (
            !location ||
            typeof location.latitude !== "number" ||
            typeof location.longitude !== "number" ||
            !Number.isFinite(location.latitude) ||
            !Number.isFinite(location.longitude)
        ) {

            sendCustomDateEntryMenuReply(
                ss,
                senderPhone,
                "📍 Please use WhatsApp's Location attachment to share where " +
                "the sample should be collected — I can't use typed text for this."
            );

            return true;
        }

        const hospital =
            getHospitalLocation();

        if (!hospital) {

            saveWhatsAppSession(
                senderPhone,
                { state: "PATIENT_MAIN_MORE" }
            );

            sendPatientMainMoreMenuReply(
                ss,
                senderPhone,
                "❌ Home sample collection isn't set up yet. Please call the clinic directly."
            );

            return true;
        }

        const radiusKm =
            getHomeCollectionRadiusKm();

        const distanceKm =
            haversineDistanceKm(
                location.latitude,
                location.longitude,
                hospital.lat,
                hospital.lng
            );

        if (distanceKm > radiusKm) {

            saveWhatsAppSession(
                senderPhone,
                {
                    state: "PATIENT_MAIN_MORE",
                    location: ""
                }
            );

            sendPatientMainMoreMenuReply(
                ss,
                senderPhone,
                "❌ Sorry, home sample collection is only available within " +
                radiusKm +
                " km of " +
                getClinicName() +
                ".\n\n" +
                "Your shared location is about " +
                distanceKm.toFixed(1) +
                " km away."
            );

            return true;
        }

        saveWhatsAppSession(
            senderPhone,
            {
                state: "HOME_COLLECTION_DATE",
                location:
                    location.latitude +
                    "," +
                    location.longitude
            }
        );

        sendDateMenuReply(
            ss,
            senderPhone,
            "✅ You're within " +
            radiusKm +
            " km — home sample collection is available!\n\n" +
            "Choose a preferred date:",
            "patient"
        );

        return true;
    }


    // ======================================================
    // WAITING FOR A PREFERRED DATE (Today / Tomorrow / Other)
    // ======================================================

    if (session.state === "HOME_COLLECTION_DATE") {

        const selectedDate =
            getISODateFromMenuChoice(
                normalizedMessage
            );

        if (selectedDate) {

            saveWhatsAppSession(
                senderPhone,
                {
                    state: "HOME_COLLECTION_TIME",
                    date: selectedDate
                }
            );

            sendWhatsAppMenuReply(
                ss,
                senderPhone,
                "🕐 Choose a preferred time window:",
                getHomeCollectionTimeWindowSpec()
            );

            return true;
        }

        if (
            normalizedMessage === "3" ||
            normalizedMessage === "date_custom"
        ) {

            saveWhatsAppSession(
                senderPhone,
                { state: "HOME_COLLECTION_DATE_CUSTOM" }
            );

            sendCustomDateEntryMenuReply(
                ss,
                senderPhone,
                "Please enter the preferred date in YYYY-MM-DD format.\n\n" +
                "Example:\n" +
                Utilities.formatDate(
                    new Date(),
                    TIMEZONE,
                    "yyyy-MM-dd"
                )
            );

            return true;
        }

        sendDateMenuReply(
            ss,
            senderPhone,
            "❌ Invalid option.\n\nChoose a preferred date:",
            "patient"
        );

        return true;
    }


    // ======================================================
    // WAITING FOR A TYPED CUSTOM DATE
    // ======================================================

    if (session.state === "HOME_COLLECTION_DATE_CUSTOM") {

        const validation =
            validateFutureISODate(
                String(messageText || "").trim()
            );

        if (!validation.valid) {

            sendCustomDateEntryMenuReply(
                ss,
                senderPhone,
                validation.message
            );

            return true;
        }

        saveWhatsAppSession(
            senderPhone,
            {
                state: "HOME_COLLECTION_TIME",
                date: validation.date
            }
        );

        sendWhatsAppMenuReply(
            ss,
            senderPhone,
            "🕐 Choose a preferred time window:",
            getHomeCollectionTimeWindowSpec()
        );

        return true;
    }


    // ======================================================
    // WAITING FOR A TIME WINDOW → SAVE THE REQUEST
    // ======================================================

    if (session.state === "HOME_COLLECTION_TIME") {

        const timeWindows = {
            "1": "Morning (8 AM - 12 PM)",
            "2": "Afternoon (12 PM - 4 PM)",
            "3": "Evening (4 PM - 8 PM)"
        };

        const timeWindow =
            timeWindows[normalizedMessage];

        if (!timeWindow) {

            sendWhatsAppMenuReply(
                ss,
                senderPhone,
                "❌ Invalid option.\n\nChoose a preferred time window:",
                getHomeCollectionTimeWindowSpec()
            );

            return true;
        }

        const locationParts =
            String(session.location || "").split(",");

        const latitude =
            locationParts.length > 0
                ? Number(locationParts[0])
                : "";

        const longitude =
            locationParts.length > 1
                ? Number(locationParts[1])
                : "";

        const hospital =
            getHospitalLocation();

        const distanceKm =
            hospital &&
            isFinite(latitude) &&
            isFinite(longitude)
                ? haversineDistanceKm(
                    latitude,
                    longitude,
                    hospital.lat,
                    hospital.lng
                )
                : 0;

        const patientName =
            resolveKnownPatientName(senderPhone) ||
            senderName ||
            "";

        createHomeCollectionRequest({
            phone: senderPhone,
            patientName: patientName,
            latitude: latitude,
            longitude: longitude,
            distanceKm: distanceKm,
            date: session.date,
            timeWindow: timeWindow
        });

        saveWhatsAppSession(
            senderPhone,
            {
                role: "PATIENT",
                state: "MAIN_MENU",
                doctorId: "",
                date: "",
                time: "",
                appointmentId: "",
                location: ""
            }
        );

        sendPatientMainMenuReply(
            ss,
            senderPhone,
            "✅ Home sample collection requested for " +
            session.date +
            " (" +
            timeWindow +
            ").\n\n" +
            "Our team will call you shortly to confirm the exact time."
        );

        return true;
    }

    return false;
}


function sendPatientMainMoreMenuReply(
    ss,
    phone,
    prefix
) {

    const body =
        (prefix
            ? String(prefix) + "\n\n"
            : "") +
        "More options";

    sendWhatsAppMenuReply(
        ss,
        phone,
        body,
        getPatientMainMoreMenuSpec()
    );
}


function sendDoctorMainMenuMoreReply(
    ss,
    phone,
    doctorId,
    tier,
    prefix
) {

    const body =
        (prefix
            ? String(prefix) + "\n\n"
            : "") +
        "More options";

    sendWhatsAppMenuReply(
        ss,
        phone,
        body,
        getDoctorMainMenuMoreSpec(
            Number(tier) || 1
        )
    );
}


function sendCancelConfirmMenuReply(
    ss,
    phone,
    chosen,
    prefix
) {

    let body;

    if (chosen) {
        body =
            prefix
                ? buildCancelConfirmRetryBody(
                    chosen,
                    prefix
                )
                : buildCancelConfirmMessage(
                    chosen
                );
    } else {
        body =
            String(
                prefix || "❌ Invalid option."
            ) +
            "\n\n⚠️ Cancel this appointment?";
    }

    sendWhatsAppMenuReply(
        ss,
        phone,
        body,
        getYesNoConfirmSpec()
    );
}


function sendRescheduleConfirmMenuReply(
    ss,
    phone,
    session,
    prefix
) {

    const mode =
        session && session.role === "DOCTOR"
            ? "doctor"
            : "patient";

    sendWhatsAppMenuReply(
        ss,
        phone,
        prefix
            ? buildRescheduleConfirmRetryBody(
                session,
                prefix
            )
            : buildRescheduleSlotConfirmMessage(
                session,
                session.date,
                session.time
            ),
        getRescheduleConfirmSpec(mode)
    );
}


function sendWhatsAppImageMessage(
    to,
    mediaId,
    caption
) {

    if (shouldSkipOutboundWhatsApp()) {
        return {
            skipped: true,
            to: to,
            mediaId: mediaId
        };
    }

    const image = {
        id: String(mediaId)
    };

    if (caption) {
        image.caption = String(caption);
    }

    return sendWhatsAppGraphPayload(
        to,
        {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: String(to),
            type: "image",
            image: image
        }
    );
}


function sendHospitalLogoGreeting(phone) {

    const mediaId =
        String(
            getSetting(
                "HOSPITAL_LOGO_MEDIA_ID",
                ""
            ) || ""
        ).trim();

    if (!mediaId) {
        return false;
    }

    try {

        sendWhatsAppImageMessage(
            phone,
            mediaId,
            "👋 Welcome to " +
            getClinicName() +
            "!"
        );

        return true;

    } catch (error) {

        Logger.log(
            "Failed to send hospital logo greeting: " +
            error.message
        );

        return false;
    }
}
