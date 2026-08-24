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
                : 45,
        actionButtons:
            parseSettingsBoolean(
                getSetting(
                    "ENABLE_REMINDER_ACTION_BUTTONS",
                    "TRUE"
                ),
                true
            )
    };
}



function ensureReminderLogSheet() {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    let sheet =
        ss.getSheetByName("Reminder_Log");

    if (!sheet) {

        sheet =
            ss.insertSheet("Reminder_Log");

        sheet.appendRow([
            "Sent At",
            "Appointment ID",
            "Hours Before",
            "Phone",
            "Status"
        ]);
    }

    return sheet;
}



function ensureReminderResponseLogSheet() {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    let sheet =
        ss.getSheetByName(
            "Reminder_Responses"
        );

    if (!sheet) {

        sheet =
            ss.insertSheet(
                "Reminder_Responses"
            );

        sheet.appendRow([
            "Responded At",
            "Appointment ID",
            "Phone",
            "Action",
            "Status"
        ]);
    }

    return sheet;
}



function logReminderPatientResponse(
    appointmentId,
    phone,
    action,
    status
) {

    const sheet =
        ensureReminderResponseLogSheet();

    sheet.appendRow([
        new Date(),
        String(appointmentId || "").trim(),
        String(phone || "").trim(),
        String(action || "").trim(),
        String(status || "SUCCESS").trim()
    ]);
}



function hasReminderBeenSent(
    appointmentId,
    hoursBefore
) {

    const sheet =
        ensureReminderLogSheet();

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
            String(data[i][1] || "").trim() ===
            targetId &&
            Number(data[i][2]) === targetHours &&
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

    const sheet =
        ensureReminderLogSheet();

    sheet.appendRow([
        new Date(),
        appointmentId,
        hoursBefore,
        phone,
        status
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
    hoursBefore,
    useActionButtons
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

    const footer =
        useActionButtons
            ? "Please tap a button below."
            : "Reply Hi to reschedule or cancel.";

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
        "\n\n" +
        footer
    );
}



function buildReminderConfirmAckMessage(
    appointment,
    doctorName
) {

    const displayDate =
        formatAppointmentDisplayDate(
            appointment.date
        );

    const displayTime =
        formatAppointmentDisplayTime(
            appointment.time
        );

    return (
        "✅ Thank you for confirming!\n\n" +
        "See you on " +
        displayDate +
        " at " +
        displayTime +
        " with " +
        String(doctorName || "your doctor").trim() +
        "."
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

    const settings =
        getReminderSettings();

    const useActionButtons =
        settings.actionButtons &&
        interactiveMenusEnabled();

    const message =
        localizeWhatsAppReply(
            language,
            buildAppointmentReminderMessage(
                appointment,
                doctorName,
                hoursBefore,
                useActionButtons
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

    let sendResult = null;
    let outboundLog = message;

    if (useActionButtons) {

        const menuSpec =
            getAppointmentReminderButtonSpec(
                appointment.appointmentId
            );

        if (
            menuSpec &&
            menuSpec.interactive
        ) {

            try {

                sendResult =
                    sendWhatsAppInteractiveMessage(
                        recipient,
                        message,
                        menuSpec.interactive
                    );

                outboundLog =
                    "[interactive:button] " +
                    message;

            } catch (interactiveError) {

                Logger.log(
                    "Reminder buttons failed; using text fallback: " +
                    interactiveError.message
                );

                sendResult = null;
            }
        }
    }

    if (!sendResult) {

        const fallbackMessage =
            localizeWhatsAppReply(
                language,
                buildAppointmentReminderMessage(
                    appointment,
                    doctorName,
                    hoursBefore,
                    false
                )
            );

        sendResult =
            sendWhatsAppText(
                recipient,
                fallbackMessage
            );

        outboundLog = fallbackMessage;
    }

    appendWhatsAppDebugLog(
        ss,
        {
            direction: "REMINDER",
            phone: recipient,
            status: "SUCCESS",
            response: outboundLog
        }
    );

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

    ScriptApp.newTrigger(
        "sendAppointmentReminders"
    )
        .timeBased()
        .everyHours(1)
        .create();

    return {
        success: true,
        message:
            "Hourly appointment reminder trigger installed."
    };
}
