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
            message: "Appointments sheet not found"
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
    // LOAD APPOINTMENTS + EXISTING HISTORY IDS
    // ========================================================

    const appointmentData =
        appointmentSheet.getDataRange().getValues();

    const historyData =
        historySheet.getDataRange().getValues();

    const archivedAppointmentIds = {};

    for (let i = 1; i < historyData.length; i++) {
        const id = String(historyData[i][0] || "").trim();
        if (id) {
            archivedAppointmentIds[id] = true;
        }
    }

    const rowsToArchive = [];
    const archiveRows = [];
    const skippedNonFinal = [];
    const skippedAlreadyArchived = [];
    const archivedAt = new Date();

    // Scan from end backwards to collect yesterday's rows.
    // Only terminal statuses are eligible for movement.
    for (
        let i = appointmentData.length - 1;
        i >= 1;
        i--
    ) {

        let appointmentDate = "";

        if (appointmentData[i][1] instanceof Date) {

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

        if (appointmentDate !== yesterdayIso) {
            continue;
        }

        const appointmentId =
            String(appointmentData[i][0] || "").trim();

        const status =
            normalizeAppointmentStatus(appointmentData[i][6]);

        if (!isArchiveEligibleAppointmentStatus(status)) {
            skippedNonFinal.push({
                appointmentId: appointmentId,
                row: i + 1,
                status: status
            });
            continue;
        }

        if (
            appointmentId &&
            archivedAppointmentIds[appointmentId]
        ) {
            skippedAlreadyArchived.push({
                appointmentId: appointmentId,
                row: i + 1
            });
            continue;
        }

        archiveRows.push([
            appointmentData[i][0],  // Appointment ID
            appointmentData[i][1],  // Date
            appointmentData[i][2],  // Time
            appointmentData[i][3],  // Doctor ID
            appointmentData[i][4],  // Patient Name
            appointmentData[i][5],  // Phone
            status,                  // Normalized Status
            appointmentData[i][7],  // Calendar Event ID
            appointmentData[i][8],  // Patient ID
            archivedAt              // Archived At
        ]);

        rowsToArchive.push(i + 1);

        if (appointmentId) {
            archivedAppointmentIds[appointmentId] = true;
        }
    }

    // ========================================================
    // WRITE ARCHIVE IN ONE BATCH
    // ========================================================

    if (archiveRows.length > 0) {
        const firstRow =
            Math.max(historySheet.getLastRow() + 1, 2);

        historySheet
            .getRange(
                firstRow,
                1,
                archiveRows.length,
                archiveRows[0].length
            )
            .setValues(archiveRows);
    }

    // ========================================================
    // DELETE ONLY SUCCESSFULLY ARCHIVED ROWS
    // ========================================================

    // rowsToArchive was collected from bottom to top, so deleting in
    // this same order keeps all row numbers valid.
    for (const row of rowsToArchive) {
        appointmentSheet.deleteRow(row);
    }

    // ========================================================
    // INVALIDATE CACHE ONLY WHEN ACTIVE DATA CHANGED
    // ========================================================

    if (rowsToArchive.length > 0) {
        CacheService.getScriptCache().removeAll([
            "WA_APPOINTMENTS_CACHE",
            "WA_DOCTOR_SCHEDULE_CACHE"
        ]);
    }

    Logger.log(
        "archivePreviousDayAppointments: " +
        "Archived " + rowsToArchive.length +
        ", skipped non-final " + skippedNonFinal.length +
        ", already archived " + skippedAlreadyArchived.length +
        " appointments from " + yesterdayIso
    );

    return {
        success: true,
        message:
            "Archived " + rowsToArchive.length +
            " finalized appointments from " + yesterdayIso,
        archivedCount: rowsToArchive.length,
        skippedNonFinalCount: skippedNonFinal.length,
        skippedAlreadyArchivedCount: skippedAlreadyArchived.length,
        skippedNonFinal: skippedNonFinal,
        skippedAlreadyArchived: skippedAlreadyArchived
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
    // Apps Script time-driven triggers run approximately within the
    // selected hour. The minute parameter is retained for backwards
    // compatibility/documentation but cannot be enforced by atHour().

    ScriptApp.newTrigger("archivePreviousDayAppointments")
        .timeBased()
        .atHour(hour)
        .everyDays(1)
        .create();

    Logger.log(
        "createDailyArchiveTask: Created daily trigger around " +
        String(hour).padStart(2, "0") + ":00 (minute " +
        String(minute).padStart(2, "0") + " advisory)"
    );

    return {
        success: true,
        message:
            "Daily archive task scheduled around " +
            String(hour).padStart(2, "0") + ":00 (minute " +
            String(minute).padStart(2, "0") + " is advisory)"
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


// Ported from ABC_Clinic_WhatsApp_Complete.gs (monolith is the source of truth).
function deleteTriggersByHandler(handlerNames) {

    const names = {};
    (handlerNames || []).forEach(function(name) {
        names[String(name)] = true;
    });

    let removed = 0;

    ScriptApp.getProjectTriggers().forEach(function(trigger) {
        if (names[trigger.getHandlerFunction()]) {
            ScriptApp.deleteTrigger(trigger);
            removed++;
        }
    });

    return removed;
}


// Ported from ABC_Clinic_WhatsApp_Complete.gs (monolith is the source of truth).
function installProductionAutomationTriggers() {

    const results = [];

    results.push(installProductionLogCleanupTrigger());
    results.push(installAppointmentReminderTrigger());
    results.push(installAutoCompletePastAppointmentsTrigger());
    results.push(setupDailyMetricsLogging());
    results.push(createAutoCleanupTriggers());
    results.push(createDailyArchiveTask(1, 0));
    results.push(createDailyHomeCollectionArchiveTask(1, 0));

    return {
        success: results.every(function(result) {
            return result && result.success !== false;
        }),
        message:
            "Production automation triggers installed. " +
            "Appointment archive and home collection history run daily around 01:00; " +
            "appointment reminders run every 30 minutes. Legacy Reminder_Queue processing is not " +
            "installed because the current reminder engine does not use it.",
        results: results,
        registry: getProductionTriggerRegistry()
    };
}


// Ported from ABC_Clinic_WhatsApp_Complete.gs (monolith is the source of truth).
function getProductionTriggerStatus() {

    const active = {};

    ScriptApp.getProjectTriggers().forEach(function(trigger) {
        const handler = trigger.getHandlerFunction();
        if (!active[handler]) {
            active[handler] = 0;
        }
        active[handler]++;
    });

    return PRODUCTION_TRIGGER_REGISTRY.map(function(item) {
        return {
            handler: item.handler,
            schedule: item.schedule,
            purpose: item.purpose,
            activeCount: active[item.handler] || 0,
            healthy: (active[item.handler] || 0) === 1
        };
    });
}


// Ported from ABC_Clinic_WhatsApp_Complete.gs (monolith is the source of truth).
function getProductionTriggerRegistry() {
    return PRODUCTION_TRIGGER_REGISTRY.map(function(item) {
        return {
            handler: item.handler,
            schedule: item.schedule,
            purpose: item.purpose
        };
    });
}


// Ported from ABC_Clinic_WhatsApp_Complete.gs (monolith is the source of truth).
function installProductionLogCleanupTrigger() {

    // Production-safe variant: log retention is an operational safeguard,
    // so it must not depend on DEBUG_MODE being enabled.
    deleteTriggersByHandler([
        "cleanupAllWhatsAppLogs"
    ]);

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
            "WhatsApp log cleanup trigger installed (daily around 3 AM)."
    };
}
