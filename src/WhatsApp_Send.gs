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

        localizedBody =
            addWhatsAppNavigationOptions(
                session,
                localizedBody
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
                        menuSpec.interactive
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

            const fallbackText =
                menuSpec &&
                menuSpec.fallbackText
                    ? localizedBody +
                    "\n\n" +
                    menuSpec.fallbackText
                    : localizedBody;

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
        "\n\nPlease choose an option:";

    sendWhatsAppMenuReply(
        ss,
        phone,
        body,
        getPatientMainMenuSpec()
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



function sendLanguageMenuReply(ss, phone) {

    sendWhatsAppMenuReply(
        ss,
        phone,
        buildLanguageSelectionMessage(),
        getLanguageMenuSpec()
    );
}



function sendDateMenuReply(ss, phone, introText) {

    sendWhatsAppMenuReply(
        ss,
        phone,
        buildDateMenuPrompt(introText),
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
        "📅 Book Appointment\n\nSelect a doctor:",
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
