// ============================================================
// Util_Migration — part of the ABC Clinic WhatsApp bot
// Bulk appointment operations: migration, bulk updates, cleanup
// ============================================================



// Bulk reschedule appointments (migrate to new doctor or date)
// Returns: {success: bool, updated: number, failed: number}
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



// Bulk cancel appointments (e.g., doctor on leave)
// Returns: {success: bool, cancelled: number}
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



// Delete old/completed appointments (archive cleanup)
// Returns: {success: bool, deleted: number}
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
