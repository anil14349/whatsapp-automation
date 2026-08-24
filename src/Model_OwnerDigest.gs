// ============================================================
// Model_OwnerDigest — part of the ABC Clinic WhatsApp bot
// Daily owner summary via WhatsApp (scheduled trigger).
// See src/Config.gs for the full file-layout map and Script Properties.
// ============================================================



function parseOwnerDigestHour(value) {

    const hour =
        parseInt(
            String(value || "8").trim(),
            10
        );

    if (
        isNaN(hour) ||
        hour < 0 ||
        hour > 23
    ) {
        return 8;
    }

    return hour;
}



function getOwnerDigestSettings() {

    ensureSettingsSheet();

    const enabled =
        parseSettingsBoolean(
            getSetting(
                "ENABLE_OWNER_DAILY_DIGEST",
                "FALSE"
            ),
            false
        );

    const ownerPhone =
        String(
            getSetting(
                "CLINIC_OWNER_PHONE",
                ""
            ) || ""
        ).trim();

    const clinicName =
        String(
            getSetting(
                "CLINIC_NAME",
                "ABC Clinic"
            ) || "ABC Clinic"
        ).trim();

    return {
        enabled: enabled,
        ownerPhone: ownerPhone,
        digestHour:
            parseOwnerDigestHour(
                getSetting(
                    "OWNER_DIGEST_HOUR",
                    "8"
                )
            ),
        clinicName: clinicName
    };
}



function getClinicDisplayDateOffset(
    daysOffset
) {

    const base =
        new Date();

    base.setDate(
        base.getDate() +
        (Number(daysOffset) || 0)
    );

    return Utilities.formatDate(
        base,
        TIMEZONE,
        "dd-MMM-yyyy"
    );
}



function getClinicDisplayDateHeading() {

    return Utilities.formatDate(
        new Date(),
        TIMEZONE,
        "EEEE, dd-MMM-yyyy"
    );
}



function ensureOwnerDigestLogSheet() {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    let sheet =
        ss.getSheetByName(
            "Owner_Digest_Log"
        );

    if (!sheet) {

        sheet =
            ss.insertSheet(
                "Owner_Digest_Log"
            );

        sheet.appendRow([
            "Summary Date",
            "Sent At",
            "Recipient",
            "Status"
        ]);
    }

    return sheet;
}



function hasOwnerDigestBeenSent(
    summaryDate
) {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName(
            "Owner_Digest_Log"
        );

    if (!sheet) {
        return false;
    }

    const data =
        sheet.getDataRange().getValues();

    const target =
        String(summaryDate || "").trim();

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        if (
            String(data[i][0] || "").trim() ===
            target
        ) {
            return true;
        }
    }

    return false;
}



function markOwnerDigestSent(
    summaryDate,
    recipient,
    status
) {

    const sheet =
        ensureOwnerDigestLogSheet();

    sheet.appendRow([
        String(summaryDate || "").trim(),
        new Date(),
        String(recipient || "").trim(),
        String(status || "SUCCESS").trim()
    ]);
}



function collectOwnerDigestStats() {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Appointments");

    const settings =
        getOwnerDigestSettings();

    const stats = {
        clinicName:
            settings.clinicName,
        summaryDate:
            getClinicDisplayDateHeading(),
        todayDate:
            getClinicDisplayDateOffset(0),
        tomorrowDate:
            getClinicDisplayDateOffset(1),
        todayScheduled: 0,
        todayCompleted: 0,
        todayNoShow: 0,
        todayCancelled: 0,
        tomorrowScheduled: 0
    };

    if (!sheet) {
        return stats;
    }

    const data =
        sheet.getDataRange().getValues();

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        const rowDate =
            formatAppointmentDisplayDate(
                data[i][1]
            );

        const status =
            normalizeAppointmentStatus(
                data[i][6]
            );

        if (rowDate === stats.todayDate) {

            if (
                isConfirmedAppointmentStatus(
                    status
                )
            ) {
                stats.todayScheduled++;
            } else if (
                status ===
                APPOINTMENT_STATUS.COMPLETED
            ) {
                stats.todayCompleted++;
            } else if (
                status ===
                APPOINTMENT_STATUS.NO_SHOW
            ) {
                stats.todayNoShow++;
            } else if (
                status ===
                APPOINTMENT_STATUS.CANCELLED
            ) {
                stats.todayCancelled++;
            }
        }

        if (
            rowDate === stats.tomorrowDate &&
            isConfirmedAppointmentStatus(status)
        ) {
            stats.tomorrowScheduled++;
        }
    }

    return stats;
}



function previewOwnerDailyDigest() {

    const stats =
        collectOwnerDigestStats();

    const message =
        buildOwnerDailyDigestMessage(
            stats
        );

    Logger.log(message);

    return {
        stats: stats,
        message: message
    };
}



function sendOwnerDailyDigest() {

    const settings =
        getOwnerDigestSettings();

    if (!settings.enabled) {
        return {
            skipped: true,
            reason: "disabled"
        };
    }

    if (!settings.ownerPhone) {
        return {
            skipped: true,
            reason: "missing_owner_phone"
        };
    }

    const currentHour =
        Number(
            Utilities.formatDate(
                new Date(),
                TIMEZONE,
                "H"
            )
        );

    if (
        currentHour !==
        settings.digestHour
    ) {
        return {
            skipped: true,
            reason: "outside_digest_hour",
            hour: currentHour,
            expectedHour:
                settings.digestHour
        };
    }

    const summaryDate =
        getClinicDisplayDateOffset(0);

    if (
        hasOwnerDigestBeenSent(
            summaryDate
        )
    ) {
        return {
            skipped: true,
            reason: "already_sent",
            summaryDate: summaryDate
        };
    }

    const stats =
        collectOwnerDigestStats();

    const message =
        buildOwnerDailyDigestMessage(
            stats
        );

    const recipient =
        formatWhatsAppRecipientPhone(
            settings.ownerPhone
        );

    if (!recipient) {
        return {
            skipped: true,
            reason: "invalid_owner_phone"
        };
    }

    try {

        const sendResult =
            sendWhatsAppText(
                recipient,
                message
            );

        if (
            sendResult &&
            sendResult.skipped
        ) {
            return sendResult;
        }

        markOwnerDigestSent(
            summaryDate,
            recipient,
            "SUCCESS"
        );

        return {
            success: true,
            summaryDate: summaryDate,
            recipient: recipient,
            stats: stats
        };

    } catch (error) {

        markOwnerDigestSent(
            summaryDate,
            recipient,
            "ERROR: " + error.message
        );

        throw error;
    }
}



function installOwnerDailyDigestTrigger() {

    ScriptApp.getProjectTriggers()
        .forEach(function (trigger) {

            if (
                trigger.getHandlerFunction() ===
                "sendOwnerDailyDigest"
            ) {
                ScriptApp.deleteTrigger(
                    trigger
                );
            }
        });

    const settings =
        getOwnerDigestSettings();

    ScriptApp.newTrigger(
        "sendOwnerDailyDigest"
    )
        .timeBased()
        .atHour(settings.digestHour)
        .everyDays(1)
        .create();

    return {
        success: true,
        message:
            "Daily owner digest trigger installed for hour " +
            settings.digestHour +
            " (" +
            TIMEZONE +
            ")."
    };
}
