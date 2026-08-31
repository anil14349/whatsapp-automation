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
            "Active"
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

    Logger.log(
        "initializeWhatsAppBotSheets: " +
        JSON.stringify(results)
    );

    return {
        success: true,
        sheets: results
    };
}
