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

    // Delete existing triggers to avoid duplicates
    const triggers = ScriptApp.getProjectTriggers();

    for (const trigger of triggers) {

        if (
            trigger.getHandlerFunction() ===
            "cleanupExpiredDeduplicationRecordsAuto" ||
            trigger.getHandlerFunction() ===
            "cleanupExpiredWaitlistEntries" ||
            trigger.getHandlerFunction() ===
            "cleanupExpiredSlotReservationsAuto"
        ) {

            ScriptApp.deleteTrigger(trigger);
        }
    }

    // Create new triggers for auto-cleanup

    // 1. Message deduplication: Daily at 2 AM (UTC)
    ScriptApp.newTrigger(
        "cleanupExpiredDeduplicationRecordsAuto"
    )
        .timeBased()
        .atHour(2)
        .everyDays(1)
        .create();

    // 2. Waitlist cleanup: Weekly on Sunday at 3 AM (UTC)
    ScriptApp.newTrigger(
        "cleanupExpiredWaitlistEntries"
    )
        .timeBased()
        .onWeekDay(
            ScriptApp.WeekDay.SUNDAY
        )
        .atHour(3)
        .create();

    // 3. Slot reservations: Every 6 hours
    ScriptApp.newTrigger(
        "cleanupExpiredSlotReservationsAuto"
    )
        .timeBased()
        .everyHours(6)
        .create();

    Logger.log(
        "Auto-cleanup triggers created successfully"
    );

    return {
        success: true,
        triggers: [
            "cleanupExpiredDeduplicationRecordsAuto (daily at 2 AM UTC)",
            "cleanupExpiredWaitlistEntries (weekly on Sunday at 3 AM UTC)",
            "cleanupExpiredSlotReservationsAuto (every 6 hours)"
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
