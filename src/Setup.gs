// ============================================================
// Setup — part of the ABC Clinic WhatsApp bot
// One-time, idempotent sheet initialization for a fresh spreadsheet.
// Run initializeWhatsAppBotSheets() once from the Apps Script editor after
// binding this project to a new Google Sheet, before the first webhook
// call arrives. Safe to re-run — every ensure function below no-ops if
// its sheet already exists, so running this on an already-set-up sheet
// just confirms everything is in place.
//
// Doctors / Availability / Appointments / Doctor_Leaves are still
// fundamentally admin-managed data (you still need to add doctor rows,
// availability hours, etc.) — this only guarantees the sheet and header
// row exist, so nothing crashes with "<Sheet> not found" on a fresh
// spreadsheet before that data is entered.
// See src/Config.gs for the full file-layout map and Script Properties.
// ============================================================



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
        "Home_Collection_Persons",
        ensureHomeCollectionPersonsSheet
    );

    ensure(
        "Home_Collection_Requests",
        ensureHomeCollectionSheet
    );

    ensure(
        "Home_Collection_History",
        ensureHomeCollectionHistorySheet
    );

    ensure(
        "Doctor_Leaves",
        ensureDoctorLeavesSheet
    );

    // Non-destructive schema migrations for existing sheets.
    // These functions only add missing header/structure columns;
    // they do not delete existing rows or clear existing data.
    ensureDoctorProfileColumns();
    ensureDoctorSpecializationColumn(
        ss.getSheetByName("Doctors")
    );
    ensureNotificationPrefColumns();

    const sessionSheet =
        ss.getSheetByName("WhatsApp_Sessions");

    if (sessionSheet) {
        ensureWhatsAppSessionLanguageColumn(sessionSheet);
        ensureWhatsAppSessionPatientNameColumn(sessionSheet);
        ensureWhatsAppSessionSlotPageColumn(sessionSheet);
        ensureWhatsAppSessionAppointmentPageColumn(sessionSheet);
        ensureWhatsAppSessionDoctorMenuTierColumn(sessionSheet);
        ensureWhatsAppSessionListPageColumn(sessionSheet);
        ensureWhatsAppSessionLocationColumn(sessionSheet);
    }

    // Operational/history sheets used by the booking, reminder,
    // deduplication, waitlist, feedback, and reporting workflows.
    // Each ensure function only creates the sheet when it is missing;
    // existing sheet data is not deleted.
    ensure(
        "Message_Deduplication",
        ensureIdempotencySheet
    );

    ensure(
        "Appointment_History",
        ensureAppointmentHistorySheet
    );

    ensure(
        "Slot_Reservations",
        ensureSlotReservationSheet
    );

    ensure(
        "Reminder_Queue",
        ensureAppointmentRemindersSheet
    );

    ensure(
        "Waitlist",
        ensureWaitlistSheet
    );

    ensure(
        "Feedback",
        ensureFeedbackSheet
    );

    // Report/dashboard sheets.
    // Existing dashboard data is preserved; only missing sheets are created.
    // createVisualDashboard() is intentionally NOT called here because that
    // function clears an existing Dashboard before rebuilding it.

    // Reporting sheets: initializeMonitoringDashboard() creates
    // Cost_Dashboard only when it is missing and does not clear
    // an existing Cost_Dashboard sheet.
    const costDashboardExisted =
        !!ss.getSheetByName("Cost_Dashboard");
    initializeMonitoringDashboard();
    results.push({
        sheet: "Cost_Dashboard",
        created: !costDashboardExisted
    });

    // Create the visual Dashboard only if it does not already exist.
    // IMPORTANT: createVisualDashboard() clears an existing Dashboard,
    // so it must NOT be called during non-destructive initialization.
    const dashboardExisted =
        !!ss.getSheetByName("Dashboard");

    if (!dashboardExisted) {
        ss.insertSheet("Dashboard");
    }

    results.push({
        sheet: "Dashboard",
        created: !dashboardExisted
    });

    // Populate/refresh monitoring data without duplicating a daily metrics
    // row when initialization is run again.
    ensureMonitoringDashboardPopulated();

    Logger.log(
        "initializeWhatsAppBotSheets: " +
        JSON.stringify(results)
    );

    return {
        success: true,
        sheets: results
    };
}



// ============================================================
// HOSPITAL LOGO SETUP (one-time, run manually from the Apps Script editor)
// ============================================================
//
// 1. Upload the logo image to Google Drive.
// 2. Right-click the file → "Share" → set to "Anyone with the link" (only
//    needed for this upload step — the file does not need to stay public
//    afterward, since WhatsApp stores its own permanent copy).
// 3. Copy the file ID out of its URL:
//      https://drive.google.com/file/d/<FILE_ID>/view
// 4. In the Apps Script editor, select uploadWhatsAppMediaFromDriveFile
//    from the function dropdown, run it once (paste the file ID in when
//    prompted, or edit the call below), and check the execution log for
//    the returned media ID.
// 5. Add a row to the Settings sheet: HOSPITAL_LOGO_MEDIA_ID = <that ID>.
//    The greeting will start sending the logo automatically — no other
//    code change needed. Add CLINIC_NAME to the Settings sheet too if you
//    want the welcome caption to say something other than "ABC Clinic".
//
// Media IDs don't expire from normal use, but Meta does eventually garbage
// -collect media that hasn't been referenced in a long time — if sends
// ever start failing with a "media not found" error, just re-run this
// function and update the Settings row with the new ID.

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



// ============================================================
// AUTOMATIC CLEANUP TRIGGERS
// ============================================================
// Run once to set up periodic cleanup jobs

function createAutoCleanupTriggers() {

    // This function remains the public cleanup-trigger setup entry point.
    // It now reports the actual schedules that it creates.
    deleteTriggersByHandler([
        "cleanupExpiredDeduplicationRecordsAuto",
        "cleanupExpiredWaitlistEntries",
        "cleanupExpiredSlotReservationsAuto"
    ]);

    ScriptApp.newTrigger(
        "cleanupExpiredDeduplicationRecordsAuto"
    )
        .timeBased()
        .atHour(2)
        .everyDays(1)
        .create();

    ScriptApp.newTrigger(
        "cleanupExpiredWaitlistEntries"
    )
        .timeBased()
        .atHour(4)
        .everyDays(1)
        .create();

    ScriptApp.newTrigger(
        "cleanupExpiredSlotReservationsAuto"
    )
        .timeBased()
        .everyHours(1)
        .create();

    Logger.log(
        "Auto-cleanup triggers created: dedup daily ~02:00, " +
        "waitlist daily ~04:00, slot reservations hourly"
    );

    return {
        success: true,
        triggers: [
            "cleanupExpiredDeduplicationRecordsAuto (daily around 2 AM)",
            "cleanupExpiredWaitlistEntries (daily around 4 AM)",
            "cleanupExpiredSlotReservationsAuto (every hour)"
        ]
    };
}



// Wrapper for hourly/daily trigger execution
function cleanupExpiredDeduplicationRecordsAuto() {
    return cleanupExpiredDeduplicationRecords();
}



function cleanupExpiredSlotReservationsAuto() {
    return cleanupExpiredSlotReservations();
}
