// ============================================================
// Model_Reminders — part of the ABC Clinic WhatsApp bot
// Appointment reminder scheduling, dedup log, and hourly trigger.
// See src/Config.gs for the full file-layout map and Script Properties.
// ============================================================



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



// The reminder dedup ledger lives in the shared WhatsApp_Log sheet as rows
// with Direction="REMINDER" (columns: Appointment ID, Hours Before, Status
// in the shared schema — see Logging.gs). This always writes/reads
// regardless of ENABLE_DEBUG_LOG: it's functional state the reminder
// scheduler depends on to avoid double-sending, not just diagnostics.
function hasReminderBeenSent(
    appointmentId,
    hoursBefore,
    logData
) {

    // OPTIMIZATION: If logData provided, use cached data instead of reloading
    let data = logData;

    if (!data) {
        const ss =
            SpreadsheetApp.getActiveSpreadsheet();

        const sheet =
            ensureWhatsAppLogSheet(ss);

        data = sheet.getDataRange().getValues();
    }

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

    // OPTIMIZATION: Load log data ONCE instead of reloading in hasReminderBeenSent loop
    const logSheet =
        ensureWhatsAppLogSheet(ss);

    const logData =
        logSheet.getDataRange().getValues();

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

                // OPTIMIZATION: Pass cached logData instead of reloading
                if (
                    hasReminderBeenSent(
                        appointmentId,
                        hoursBefore,
                        logData
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
