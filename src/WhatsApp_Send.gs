// ============================================================
// WhatsApp_Send — part of the ABC Clinic WhatsApp bot
// Low-level WhatsApp Cloud API senders (text, interactive, template).
// See src/Config.gs for the full file-layout map and Script Properties.
// ============================================================



function sendWhatsAppGraphPayload(to, payload) {

    if (shouldSkipOutboundWhatsApp()) {
        return {
            skipped: true,
            to: to,
            payload: payload
        };
    }

    const properties =
        PropertiesService.getScriptProperties();

    const accessToken =
        properties.getProperty(
            "WHATSAPP_ACCESS_TOKEN"
        );

    const phoneNumberId =
        properties.getProperty(
            "WHATSAPP_PHONE_NUMBER_ID"
        );

    if (!accessToken) {
        throw new Error(
            "WHATSAPP_ACCESS_TOKEN is missing."
        );
    }

    if (!phoneNumberId) {
        throw new Error(
            "WHATSAPP_PHONE_NUMBER_ID is missing."
        );
    }

    const url =
        "https://graph.facebook.com/v26.0/" +
        phoneNumberId +
        "/messages";

    const response =
        UrlFetchApp.fetch(
            url,
            {
                method: "post",
                contentType: "application/json",
                headers: {
                    Authorization:
                        "Bearer " + accessToken
                },
                payload: JSON.stringify(payload),
                muteHttpExceptions: true
            }
        );

    const responseCode =
        response.getResponseCode();

    const responseBody =
        response.getContentText();

    if (
        responseCode < 200 ||
        responseCode >= 300
    ) {
        throw new Error(
            "WhatsApp API error: " +
            responseBody
        );
    }

    return JSON.parse(responseBody);
}



function sendWhatsAppInteractiveMessage(
    to,
    bodyText,
    spec
) {

    let interactive = null;

    if (spec.type === "list") {

        interactive = {
            type: "list",
            body: {
                text: String(bodyText)
            },
            action: {
                button: spec.buttonLabel,
                sections: spec.sections
            }
        };

    } else if (spec.type === "button") {

        interactive = {
            type: "button",
            body: {
                text: String(bodyText)
            },
            action: {
                buttons: spec.buttons.map(
                    function (button) {
                        return {
                            type: "reply",
                            reply: {
                                id: button.id,
                                title: button.title
                            }
                        };
                    }
                )
            }
        };
    }

    if (!interactive) {
        throw new Error(
            "Invalid interactive menu spec."
        );
    }

    return sendWhatsAppGraphPayload(
        to,
        {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: String(to),
            type: "interactive",
            interactive: interactive
        }
    );
}



function sendWhatsAppMenuReply(
    ss,
    phone,
    bodyText,
    menuSpec
) {

    try {

        const session =
            getWhatsAppSession(phone);

        const language =
            resolvePatientLanguage(
                phone,
                session
            );

        let localizedBody =
            localizeWhatsAppReply(
                language,
                String(bodyText || "")
            );

        const willSendInteractive =
            interactiveMenusEnabled() &&
            menuSpec &&
            menuSpec.interactive;

        if (!willSendInteractive) {
            localizedBody =
                addWhatsAppNavigationOptions(
                    session,
                    localizedBody
                );
        }

        const inboundMessageId =
            getWhatsAppInboundMessageId();

        if (
            inboundMessageId &&
            hasWhatsAppOutboundBeenSent(
                inboundMessageId
            )
        ) {
            return {
                skipped: true,
                reason: "duplicate_outbound",
                messageId: inboundMessageId,
                to: phone
            };
        }

        let sendResult = null;
        let outboundLog =
            localizedBody;

        if (
            interactiveMenusEnabled() &&
            menuSpec &&
            menuSpec.interactive
        ) {

            try {

                sendResult =
                    sendWhatsAppInteractiveMessage(
                        phone,
                        localizedBody,
                        localizeInteractiveMenuForSession(
                            session,
                            language,
                            menuSpec.interactive
                        )
                    );

                outboundLog =
                    "[interactive:" +
                    menuSpec.interactive.type +
                    "] " +
                    localizedBody;

            } catch (interactiveError) {

                Logger.log(
                    "Interactive menu failed; using text fallback: " +
                    interactiveError.message
                );

                sendResult = null;
            }
        }

        if (!sendResult) {

            const fallbackBody =
                addWhatsAppNavigationOptions(
                    session,
                    localizedBody
                );

            const localizedFallback =
                menuSpec &&
                menuSpec.fallbackText
                    ? localizeWhatsAppReply(
                        language,
                        menuSpec.fallbackText
                    )
                    : "";

            const fallbackText =
                localizedFallback
                    ? fallbackBody +
                    "\n\n" +
                    localizedFallback
                    : fallbackBody;

            sendResult =
                sendWhatsAppText(
                    phone,
                    fallbackText
                );

            outboundLog = fallbackText;
        }

        if (
            inboundMessageId &&
            sendResult &&
            !sendResult.skipped
        ) {
            markWhatsAppOutboundSent(
                inboundMessageId
            );
        }

        appendWhatsAppDebugLog(
            ss,
            {
                direction: "OUTBOUND",
                phone: phone,
                status: "SUCCESS",
                response: outboundLog
            }
        );

        return sendResult;

    } catch (error) {

        appendWhatsAppDebugLog(
            ss,
            {
                direction: "OUTBOUND",
                phone: phone,
                status: "ERROR",
                response: error.message
            }
        );

        throw error;
    }
}



function sendPatientMainMenuReply(
    ss,
    phone,
    prefix
) {

    const body =
        String(prefix || "👋 Welcome to ABC Clinic!") +
        "\n\nHow can we help you today?";

    sendWhatsAppMenuReply(
        ss,
        phone,
        body,
        getPatientMainMenuSpec()
    );
}



function sendPatientMainMoreMenuReply(
    ss,
    phone,
    prefix
) {

    const body =
        (prefix
            ? String(prefix) + "\n\n"
            : "") +
        "More options";

    sendWhatsAppMenuReply(
        ss,
        phone,
        body,
        getPatientMainMoreMenuSpec()
    );
}



function sendDoctorMainMenuReply(
    ss,
    phone,
    doctorId,
    prefix
) {

    const doctorName =
        findDoctorById(doctorId) || "";

    const body =
        (prefix
            ? String(prefix) + "\n\n"
            : "") +
        "👨‍⚕️ Doctor Portal" +
        (doctorName
            ? " — " + doctorName
            : "") +
        "\n\nPlease choose an option:";

    sendWhatsAppMenuReply(
        ss,
        phone,
        body,
        getDoctorMainMenuSpec()
    );
}



function sendDoctorMainMenuMoreReply(
    ss,
    phone,
    doctorId,
    tier,
    prefix
) {

    const body =
        (prefix
            ? String(prefix) + "\n\n"
            : "") +
        "More options";

    sendWhatsAppMenuReply(
        ss,
        phone,
        body,
        getDoctorMainMenuMoreSpec(
            Number(tier) || 1
        )
    );
}



function sendLanguageMenuReply(
    ss,
    phone,
    prefix
) {

    sendWhatsAppMenuReply(
        ss,
        phone,
        buildLanguageSelectionBody(prefix),
        getLanguageMenuSpec()
    );
}



function sendPatientAppointmentListMenuReply(
    ss,
    phone,
    listScreen,
    appointments,
    page,
    prefix
) {

    const menuSpec =
        getAppointmentListMenuSpec(
            appointments,
            "patient",
            page || 0
        );

    const pageInfo = {
        page: menuSpec.page || 0,
        totalPages:
            menuSpec.totalPages || 1
    };

    const body =
        buildPatientAppointmentListBodyForScreen(
            listScreen,
            pageInfo,
            prefix
        );

    sendWhatsAppMenuReply(
        ss,
        phone,
        body,
        menuSpec
    );
}



function sendCancelConfirmMenuReply(
    ss,
    phone,
    chosen,
    prefix
) {

    let body;

    if (chosen) {
        body =
            prefix
                ? buildCancelConfirmRetryBody(
                    chosen,
                    prefix
                )
                : buildCancelConfirmMessage(
                    chosen
                );
    } else {
        body =
            String(
                prefix || "❌ Invalid option."
            ) +
            "\n\n⚠️ Cancel this appointment?";
    }

    sendWhatsAppMenuReply(
        ss,
        phone,
        body,
        getYesNoConfirmSpec()
    );
}



function sendRescheduleConfirmMenuReply(
    ss,
    phone,
    session,
    prefix
) {

    sendWhatsAppMenuReply(
        ss,
        phone,
        prefix
            ? buildRescheduleConfirmRetryBody(
                session,
                prefix
            )
            : buildRescheduleSlotConfirmMessage(
                session,
                session.date,
                session.time
            ),
        getRescheduleConfirmSpec()
    );
}



function sendDoctorAppointmentListMenuReply(
    ss,
    phone,
    title,
    selectLine,
    appointments,
    page
) {

    const menuSpec =
        getAppointmentListMenuSpec(
            appointments,
            "doctor",
            page || 0
        );

    let body =
        title +
        "\n\n" +
        selectLine;

    if (
        menuSpec &&
        menuSpec.totalPages > 1
    ) {
        body +=
            "\n\nPage " +
            (menuSpec.page + 1) +
            " of " +
            menuSpec.totalPages;
    }

    sendWhatsAppMenuReply(
        ss,
        phone,
        body,
        menuSpec
    );
}



function sendDoctorWeekdayMenuReply(
    ss,
    phone,
    doctorId,
    prefix
) {

    const body =
        (prefix
            ? String(prefix) + "\n\n"
            : "") +
        "📅 Manage Availability\n\n" +
        "Select a day to manage:";

    sendWhatsAppMenuReply(
        ss,
        phone,
        body,
        getDoctorWeekdayMenuSpec(doctorId)
    );
}



function sendDoctorDayAvailabilityMenuReply(
    ss,
    phone,
    doctorId,
    dayName,
    prefix
) {

    const body =
        (prefix
            ? String(prefix) + "\n\n"
            : "") +
        buildDoctorDayAvailabilityBody(
            doctorId,
            dayName
        ) +
        "\n\nChoose an action:";

    sendWhatsAppMenuReply(
        ss,
        phone,
        body,
        getDoctorDayAvailabilityActionSpec()
    );
}



function sendDoctorSessionRemoveMenuReply(
    ss,
    phone,
    doctorId,
    dayName
) {

    const sessions =
        getDoctorDayAvailabilitySessions(
            doctorId,
            dayName
        );

    sendWhatsAppMenuReply(
        ss,
        phone,
        "Select session to remove:\n\n" +
        buildDoctorDayAvailabilityBody(
            doctorId,
            dayName
        ),
        getDoctorSessionRemoveListSpec(
            sessions
        )
    );
}



function sendDoctorLeavesMenuReply(
    ss,
    phone,
    prefix
) {

    const body =
        (prefix
            ? String(prefix) + "\n\n"
            : "") +
        "🏖 Manage Leaves\n\n" +
        "Choose an option:";

    sendWhatsAppMenuReply(
        ss,
        phone,
        body,
        getDoctorLeavesMenuSpec()
    );
}



function sendDoctorLeaveCancelListMenuReply(
    ss,
    phone,
    doctorId,
    prefix
) {

    const leaves =
        getDoctorUpcomingLeaves(doctorId);

    const body =
        (prefix
            ? String(prefix) + "\n\n"
            : "") +
        "Select leave to cancel:";

    sendWhatsAppMenuReply(
        ss,
        phone,
        body,
        getDoctorLeaveListMenuSpec(leaves)
    );
}



function sendSlotSelectionMenuReply(
    ss,
    phone,
    introText,
    slots,
    page,
    options
) {

    const opts = options || {};
    const menuSpec =
        getSlotSelectionMenuSpec(
            slots,
            page || 0
        );

    let body =
        String(introText || "");

    if (
        !body &&
        opts.isoDate
    ) {
        body =
            buildSlotSelectionIntro(
                opts.isoDate,
                opts.isReschedule
            );
    }

    if (
        menuSpec &&
        menuSpec.totalPages > 1
    ) {
        body +=
            "\n\nPage " +
            (menuSpec.page + 1) +
            " of " +
            menuSpec.totalPages;
    }

    sendWhatsAppMenuReply(
        ss,
        phone,
        body,
        menuSpec
    );
}



function sendDateMenuReply(ss, phone, introText) {

    sendWhatsAppMenuReply(
        ss,
        phone,
        String(introText || "Choose an appointment date."),
        getDateMenuSpec()
    );
}



function sendDoctorSelectionReply(ss, phone) {

    const doctors = getDoctors();

    if (doctors.length === 0) {

        sendWhatsAppReply(
            ss,
            phone,
            "❌ No doctors are currently available."
        );

        return;
    }

    const menuSpec =
        getDoctorSelectionMenuSpec();

    sendWhatsAppMenuReply(
        ss,
        phone,
        buildDoctorSelectionBody(),
        menuSpec
    );
}



function sendWhatsAppReply(
    ss,
    phone,
    reply
) {

    try {

        const session =
            getWhatsAppSession(phone);

        const language =
            resolvePatientLanguage(
                phone,
                session
            );

        const replyWithNavigation =
            addWhatsAppNavigationOptions(
                session,
                reply
            );

        const localizedReply =
            localizeWhatsAppReply(
                language,
                replyWithNavigation
            );

        const inboundMessageId =
            getWhatsAppInboundMessageId();

        if (
            inboundMessageId &&
            hasWhatsAppOutboundBeenSent(
                inboundMessageId
            )
        ) {

            return {
                skipped: true,
                reason: "duplicate_outbound",
                messageId: inboundMessageId,
                to: phone
            };
        }

        const sendResult =
            sendWhatsAppText(
                phone,
                localizedReply
            );

        if (
            inboundMessageId &&
            sendResult &&
            !sendResult.skipped
        ) {
            markWhatsAppOutboundSent(
                inboundMessageId
            );
        }


        appendWhatsAppDebugLog(
            ss,
            {
                direction: "OUTBOUND",
                phone: phone,
                status: "SUCCESS",
                response: JSON.stringify(
                    sendResult
                )
            }
        );

        return sendResult;

    } catch (error) {

        appendWhatsAppDebugLog(
            ss,
            {
                direction: "OUTBOUND",
                phone: phone,
                status: "ERROR",
                response: error.message
            }
        );

        throw error;
    }
}


function sendWhatsAppText(to, messageText) {

    if (shouldSkipOutboundWhatsApp()) {
        return {
            skipped: true,
            to: to,
            message: messageText
        };
    }

    return sendWhatsAppGraphPayload(
        to,
        {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: String(to),
            type: "text",
            text: {
                preview_url: false,
                body: String(messageText)
            }
        }
    );
}



function sendWhatsAppTemplate(to) {

    const properties =
        PropertiesService.getScriptProperties();

    const accessToken =
        properties.getProperty(
            "WHATSAPP_ACCESS_TOKEN"
        );

    const phoneNumberId =
        properties.getProperty(
            "WHATSAPP_PHONE_NUMBER_ID"
        );

    if (!accessToken) {
        throw new Error(
            "WHATSAPP_ACCESS_TOKEN is missing."
        );
    }

    if (!phoneNumberId) {
        throw new Error(
            "WHATSAPP_PHONE_NUMBER_ID is missing."
        );
    }

    const url =
        "https://graph.facebook.com/v26.0/" +
        phoneNumberId +
        "/messages";

    const payload = {

        messaging_product:
            "whatsapp",

        to:
            String(to),

        type:
            "template",

        template: {

            name:
                "hello_world",

            language: {
                code: "en_US"
            }

        }
    };

    const response =
        UrlFetchApp.fetch(
            url,
            {
                method: "post",

                contentType:
                    "application/json",

                headers: {
                    Authorization:
                        "Bearer " +
                        accessToken
                },

                payload:
                    JSON.stringify(payload),

                muteHttpExceptions:
                    true
            }
        );

    const code =
        response.getResponseCode();

    const body =
        response.getContentText();

    Logger.log(
        "HTTP: " + code
    );

    Logger.log(
        body
    );

    if (
        code < 200 ||
        code >= 300
    ) {
        throw new Error(
            "WhatsApp API error: " +
            body
        );
    }

    return JSON.parse(body);
}



function localizeInteractiveMenuForSession(
    session,
    language,
    interactive
) {

    if (
        session &&
        session.role === "DOCTOR"
    ) {
        return interactive;
    }

    return localizeInteractiveMenu(
        language,
        interactive
    );
}
