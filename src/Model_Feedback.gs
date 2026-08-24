// ============================================================
// Model_Feedback — part of the ABC Clinic WhatsApp bot
// Post-visit star ratings and Google review link follow-up.
// See src/Config.gs for the full file-layout map and Script Properties.
// ============================================================



function getFeedbackSettings() {

    ensureSettingsSheet();

    const enabled =
        parseSettingsBoolean(
            getSetting(
                "ENABLE_POST_VISIT_FEEDBACK",
                "TRUE"
            ),
            true
        );

    let hoursAfter =
        Number(
            getSetting(
                "FEEDBACK_HOURS_AFTER",
                "2"
            )
        );

    if (
        isNaN(hoursAfter) ||
        hoursAfter < 0
    ) {
        hoursAfter = 2;
    }

    let windowMinutes =
        Number(
            getSetting(
                "FEEDBACK_WINDOW_MINUTES",
                "45"
            )
        );

    if (
        isNaN(windowMinutes) ||
        windowMinutes < 1
    ) {
        windowMinutes = 45;
    }

    let minRatingForReview =
        Number(
            getSetting(
                "FEEDBACK_MIN_RATING_FOR_REVIEW",
                "4"
            )
        );

    if (
        isNaN(minRatingForReview) ||
        minRatingForReview < 1
    ) {
        minRatingForReview = 4;
    }

    if (minRatingForReview > 5) {
        minRatingForReview = 5;
    }

    const reviewUrl =
        String(
            getSetting(
                "CLINIC_REVIEW_URL",
                ""
            ) || ""
        ).trim();

    return {
        enabled: enabled,
        hoursAfter: hoursAfter,
        windowMinutes: windowMinutes,
        minRatingForReview:
            minRatingForReview,
        reviewUrl: reviewUrl
    };
}



function ensureFeedbackSentLogSheet() {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    let sheet =
        ss.getSheetByName(
            "Feedback_Sent_Log"
        );

    if (!sheet) {

        sheet =
            ss.insertSheet(
                "Feedback_Sent_Log"
            );

        sheet.appendRow([
            "Sent At",
            "Appointment ID",
            "Phone",
            "Status"
        ]);
    }

    return sheet;
}



function ensureFeedbackResponseLogSheet() {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    let sheet =
        ss.getSheetByName(
            "Feedback_Responses"
        );

    if (!sheet) {

        sheet =
            ss.insertSheet(
                "Feedback_Responses"
            );

        sheet.appendRow([
            "Responded At",
            "Appointment ID",
            "Phone",
            "Rating",
            "Status"
        ]);
    }

    return sheet;
}



function hasFeedbackRequestBeenSent(
    appointmentId
) {

    const sheet =
        ensureFeedbackSentLogSheet();

    const data =
        sheet.getDataRange().getValues();

    const target =
        String(appointmentId || "")
            .trim()
            .toUpperCase();

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        if (
            String(data[i][1] || "")
                .trim()
                .toUpperCase() ===
            target &&
            String(data[i][3] || "")
                .trim()
                .toUpperCase() ===
            "SUCCESS"
        ) {
            return true;
        }
    }

    return false;
}



function markFeedbackRequestSent(
    appointmentId,
    phone,
    status
) {

    const sheet =
        ensureFeedbackSentLogSheet();

    sheet.appendRow([
        new Date(),
        String(appointmentId || "").trim(),
        String(phone || "").trim(),
        String(status || "SUCCESS").trim()
    ]);
}



function hasFeedbackResponse(
    appointmentId
) {

    const sheet =
        ensureFeedbackResponseLogSheet();

    const data =
        sheet.getDataRange().getValues();

    const target =
        String(appointmentId || "")
            .trim()
            .toUpperCase();

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        if (
            String(data[i][1] || "")
                .trim()
                .toUpperCase() ===
            target
        ) {
            return true;
        }
    }

    return false;
}



function logFeedbackResponse(
    appointmentId,
    phone,
    rating,
    status
) {

    const sheet =
        ensureFeedbackResponseLogSheet();

    sheet.appendRow([
        new Date(),
        String(appointmentId || "").trim(),
        String(phone || "").trim(),
        Number(rating) || 0,
        String(status || "SUCCESS").trim()
    ]);
}



function getAppointmentEndDateTime(
    date,
    time,
    doctorId
) {

    const start =
        parseAppointmentSheetDateTime(
            date,
            time
        );

    if (!start) {
        return null;
    }

    const doctor =
        getDoctorRecord(doctorId);

    let durationMinutes = 30;

    if (
        doctor &&
        doctor.appointmentDuration
    ) {

        const parsed =
            Number(
                doctor.appointmentDuration
            );

        if (
            !isNaN(parsed) &&
            parsed > 0
        ) {
            durationMinutes = parsed;
        }
    }

    return new Date(
        start.getTime() +
        durationMinutes *
        60 *
        1000
    );
}



function findCompletedAppointmentForPhone(
    phone,
    appointmentId
) {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Appointments");

    if (!sheet) {
        return null;
    }

    const data =
        sheet.getDataRange().getValues();

    const targetId =
        String(appointmentId || "")
            .trim()
            .toUpperCase();

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        if (
            String(data[i][0] || "")
                .trim()
                .toUpperCase() !==
            targetId
        ) {
            continue;
        }

        if (
            normalizeAppointmentStatus(
                data[i][6]
            ) !==
            APPOINTMENT_STATUS.COMPLETED
        ) {
            return null;
        }

        if (
            !phonesMatch(
                data[i][5],
                phone
            )
        ) {
            return null;
        }

        return {
            appointmentId:
                String(data[i][0] || "").trim(),
            date: data[i][1],
            time: data[i][2],
            doctorId:
                String(data[i][3] || "").trim(),
            patientName:
                String(data[i][4] || "").trim(),
            phone:
                String(data[i][5] || "").trim()
        };
    }

    return null;
}



function sendOnePostVisitFeedbackRequest(
    ss,
    appointment
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

    const useInteractive =
        interactiveMenusEnabled();

    const message =
        localizeWhatsAppReply(
            language,
            buildPostVisitFeedbackMessage(
                appointment,
                doctorName,
                useInteractive
            )
        );

    const recipient =
        formatWhatsAppRecipientPhone(
            appointment.phone
        );

    if (!recipient) {
        throw new Error(
            "Missing patient phone for feedback request."
        );
    }

    let sendResult = null;
    let outboundLog = message;

    if (useInteractive) {

        const menuSpec =
            getPostVisitFeedbackRatingSpec(
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
                    "[interactive:list] " +
                    message;

            } catch (interactiveError) {

                Logger.log(
                    "Feedback list failed; using text fallback: " +
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
                buildPostVisitFeedbackMessage(
                    appointment,
                    doctorName,
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
            direction: "FEEDBACK_REQUEST",
            phone: recipient,
            status: "SUCCESS",
            response: outboundLog
        }
    );

    return sendResult;
}



function sendPostVisitFeedbackRequests() {

    const settings =
        getFeedbackSettings();

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

    const delayMs =
        settings.hoursAfter *
        60 *
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

        if (
            normalizeAppointmentStatus(
                data[i][6]
            ) !==
            APPOINTMENT_STATUS.COMPLETED
        ) {
            continue;
        }

        const appointmentEnd =
            getAppointmentEndDateTime(
                data[i][1],
                data[i][2],
                data[i][3]
            );

        if (!appointmentEnd) {
            continue;
        }

        const feedbackTarget =
            new Date(
                appointmentEnd.getTime() +
                delayMs
            );

        const elapsed =
            now.getTime() -
            feedbackTarget.getTime();

        if (
            elapsed < 0 ||
            elapsed > windowMs
        ) {
            continue;
        }

        results.checked++;

        if (
            hasFeedbackRequestBeenSent(
                appointmentId
            )
        ) {
            results.skipped++;
            continue;
        }

        if (
            hasFeedbackResponse(
                appointmentId
            )
        ) {
            results.skipped++;
            continue;
        }

        const appointment = {
            appointmentId: appointmentId,
            doctorId: data[i][3],
            patientName: data[i][4],
            phone: data[i][5],
            date: data[i][1],
            time: data[i][2]
        };

        try {

            sendOnePostVisitFeedbackRequest(
                ss,
                appointment
            );

            markFeedbackRequestSent(
                appointmentId,
                appointment.phone,
                "SUCCESS"
            );

            results.sent++;

        } catch (error) {

            markFeedbackRequestSent(
                appointmentId,
                appointment.phone,
                "ERROR: " +
                error.message
            );

            results.errors++;

            Logger.log(
                "Feedback request failed for " +
                appointmentId +
                ": " +
                error.message
            );
        }
    }

    Logger.log(
        "sendPostVisitFeedbackRequests: " +
        JSON.stringify(results)
    );

    return results;
}



function installPostVisitFeedbackTrigger() {

    ScriptApp.getProjectTriggers()
        .forEach(function (trigger) {

            if (
                trigger.getHandlerFunction() ===
                "sendPostVisitFeedbackRequests"
            ) {
                ScriptApp.deleteTrigger(
                    trigger
                );
            }
        });

    ScriptApp.newTrigger(
        "sendPostVisitFeedbackRequests"
    )
        .timeBased()
        .everyHours(1)
        .create();

    return {
        success: true,
        message:
            "Hourly post-visit feedback trigger installed."
    };
}



function previewPostVisitFeedback() {

    const settings =
        getFeedbackSettings();

    return {
        settings: settings,
        results:
            sendPostVisitFeedbackRequests()
    };
}
