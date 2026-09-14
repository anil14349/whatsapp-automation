// ============================================================
// Util_DataBackup — part of the ABC Clinic WhatsApp bot
// Data export and backup functions for clinic records
// ============================================================



// Export appointments to CSV format
// Returns: {success: bool, csv: string, rowCount: number}
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



// Export all clinic data to Google Drive as backup
// Creates timestamped folder with CSV exports
// Returns: {success: bool, folderId: string, fileCount: number}
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



// Export doctors to CSV
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



// Export patients to CSV
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



// Helper: Escape CSV field values (handle quotes, commas, newlines)
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
