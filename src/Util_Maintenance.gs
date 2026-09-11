// ============================================================
// Util_Maintenance — part of the ABC Clinic WhatsApp bot
// Daily maintenance tasks: archive previous day's appointments
// ============================================================



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
    // Delete in forward order (HIGH to LOW row numbers)
    // rowsToArchive is in descending order from backward collection loop:
    // if rows 7, 12, 17 matched → array is [17, 12, 7]
    // Forward iteration: delete 17 (highest), then 12, then 7 (lowest)
    // This avoids row number shifts when deleting

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
