// ============================================================
// Util_Reminders — part of the ABC Clinic WhatsApp bot
// Automated appointment reminders via WhatsApp (24h before, 1h before)
// ============================================================



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



// Queue a reminder for an appointment
// reminderType: "24h" or "1h"
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



// Process due reminders (call via time-based trigger)
// Returns: {processed: number, sent: number, failed: number}
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



// Build reminder message text
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



// Create time-based triggers for reminders
// Runs at specified time daily
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



// Remove reminders schedule
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
