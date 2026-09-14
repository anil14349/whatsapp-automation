// ============================================================
// Model_AppointmentStatus — part of the ABC Clinic WhatsApp bot
// Completed / No-Show status workflow and auto-complete trigger.
// See src/Config.gs for the full file-layout map and Script Properties.
// ============================================================



// ============================================================
// APPOINTMENT STATUS (COMPLETED / NO-SHOW)
// ============================================================

function getAutoCompleteSettings() {

    ensureSettingsSheet();

    const enabled =
        parseSettingsBoolean(
            getSetting(
                "AUTO_COMPLETE_PAST_APPOINTMENTS",
                "FALSE"
            ),
            false
        );

    const hoursAfter =
        Number(
            getSetting(
                "AUTO_COMPLETE_HOURS_AFTER",
                "4"
            )
        );

    return {
        enabled: enabled,
        hoursAfter:
            hoursAfter > 0
                ? hoursAfter
                : 4
    };
}



function updateAppointmentStatus(
    appointmentId,
    newStatus,
    options
) {

    const opts = options || {};
    const targetStatus =
        normalizeAppointmentStatus(newStatus);

    if (
        targetStatus !== APPOINTMENT_STATUS.COMPLETED &&
        targetStatus !== APPOINTMENT_STATUS.NO_SHOW
    ) {

        return {
            success: false,
            message:
                "Status must be Completed or No-Show."
        };
    }

    // Fail closed: every caller must prove ownership via either an
    // authorized doctor ID or a matching patient phone number. Without
    // one of these, refuse the update rather than allowing an
    // unauthenticated status change.
    if (
        !String(opts.authorizedDoctorId || "").trim() &&
        !String(opts.patientPhone || "").trim()
    ) {

        return {
            success: false,
            message:
                "Not authorized to update this appointment."
        };
    }

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Appointments");

    if (!sheet) {

        return {
            success: false,
            message:
                "Appointments sheet not found."
        };
    }

    const data =
        sheet.getDataRange().getValues();

    const targetId =
        String(appointmentId || "").trim();

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        const rowAppointmentId =
            String(data[i][0] || "").trim();

        if (rowAppointmentId !== targetId) {
            continue;
        }

        const currentStatus =
            normalizeAppointmentStatus(
                data[i][6]
            );

        const rowDoctorId =
            String(data[i][3] || "").trim();

        const authorizedDoctorId =
            String(
                opts.authorizedDoctorId || ""
            ).trim();

        if (authorizedDoctorId) {

            if (
                rowDoctorId !==
                authorizedDoctorId
            ) {

                return {
                    success: false,
                    message:
                        "Appointment does not belong to this doctor."
                };
            }

        } else if (
            opts.patientPhone &&
            !phonesMatch(
                data[i][5],
                opts.patientPhone
            )
        ) {

            return {
                success: false,
                message:
                    "Appointment does not belong to this phone number."
            };
        }

        if (
            currentStatus ===
            APPOINTMENT_STATUS.CANCELLED
        ) {

            return {
                success: false,
                message:
                    "Cancelled appointments cannot be updated."
            };
        }

        if (
            currentStatus ===
            APPOINTMENT_STATUS.COMPLETED ||
            currentStatus ===
            APPOINTMENT_STATUS.NO_SHOW
        ) {

            return {
                success: false,
                message:
                    "Appointment is already marked as " +
                    currentStatus +
                    "."
            };
        }

        if (
            currentStatus !==
            APPOINTMENT_STATUS.CONFIRMED
        ) {

            return {
                success: false,
                message:
                    "Only confirmed appointments can be marked Completed or No-Show."
            };
        }

        sheet
            .getRange(i + 1, 7)
            .setValue(targetStatus);

        return {
            success: true,
            message:
                "Appointment marked as " +
                targetStatus +
                ".",
            appointmentId: targetId,
            status: targetStatus,
            patientName:
                String(data[i][4] || "").trim(),
            date:
                formatAppointmentDisplayDate(
                    data[i][1]
                ),
            time:
                formatAppointmentDisplayTime(
                    data[i][2]
                )
        };
    }

    return {
        success: false,
        message:
            "Appointment not found."
    };
}



function getDoctorStatusEligibleAppointments(
    doctorId
) {

    const appointments =
        getDoctorConfirmedAppointments(
            doctorId
        );

    const now = new Date();
    const graceMs =
        15 * 60 * 1000;

    return appointments.filter(
        function (appt) {

            const dt =
                parseAppointmentDateTime(
                    appt.date,
                    appt.time
                );

            if (!dt) {
                return true;
            }

            return (
                dt.getTime() <=
                now.getTime() + graceMs
            );
        }
    );
}



function autoCompletePastAppointments() {

    const settings =
        getAutoCompleteSettings();

    if (!settings.enabled) {
        return {
            enabled: false,
            updated: 0,
            skipped: 0
        };
    }

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Appointments");

    if (!sheet) {
        return {
            enabled: true,
            updated: 0,
            skipped: 0,
            message:
                "Appointments sheet not found."
        };
    }

    const now = new Date();
    const cutoffMs =
        settings.hoursAfter *
        60 *
        60 *
        1000;

    const data =
        sheet.getDataRange().getValues();

    let updated = 0;
    let skipped = 0;

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

        if (
            !isConfirmedAppointmentStatus(
                data[i][6]
            )
        ) {
            skipped++;
            continue;
        }

        const appointmentStart =
            parseAppointmentSheetDateTime(
                data[i][1],
                data[i][2]
            );

        if (
            !appointmentStart ||
            now.getTime() <
            appointmentStart.getTime() + cutoffMs
        ) {
            skipped++;
            continue;
        }

        sheet
            .getRange(i + 1, 7)
            .setValue(
                APPOINTMENT_STATUS.COMPLETED
            );

        updated++;
    }

    Logger.log(
        "autoCompletePastAppointments: updated=" +
        updated +
        " skipped=" +
        skipped
    );

    return {
        enabled: true,
        updated: updated,
        skipped: skipped,
        settings: settings
    };
}



function installAutoCompletePastAppointmentsTrigger() {

    ScriptApp.getProjectTriggers()
        .forEach(function (trigger) {

            if (
                trigger.getHandlerFunction() ===
                "autoCompletePastAppointments"
            ) {
                ScriptApp.deleteTrigger(
                    trigger
                );
            }
        });

    ScriptApp.newTrigger(
        "autoCompletePastAppointments"
    )
        .timeBased()
        .everyDays(1)
        .atHour(23)
        .create();

    return {
        success: true,
        message:
            "Daily auto-complete trigger installed (11 PM)."
    };
}
