// ============================================================
// Webhook — part of the ABC Clinic WhatsApp bot
// doGet/doPost webhook entry points, signature/token verification, inbound idempotency.
// See src/Config.gs for the full file-layout map and Script Properties.
// ============================================================



function extractInboundWhatsAppMessage(message) {

    const messageType =
        String(message.type || "");

    if (
        messageType === "text" &&
        message.text &&
        message.text.body !== undefined
    ) {

        return {
            type: "text",
            text: String(message.text.body).trim()
        };
    }

    if (
        messageType === "interactive" &&
        message.interactive
    ) {

        const interactive =
            message.interactive;

        if (
            interactive.type === "button_reply" &&
            interactive.button_reply
        ) {

            return {
                type: "interactive",
                text: String(
                    interactive.button_reply.id ||
                    ""
                ).trim()
            };
        }

        if (
            interactive.type === "list_reply" &&
            interactive.list_reply
        ) {

            return {
                type: "interactive",
                text: String(
                    interactive.list_reply.id ||
                    ""
                ).trim()
            };
        }
    }

    return {
        type: messageType,
        text: ""
    };
}



function webhookOkResponse() {

    return ContentService
        .createTextOutput("EVENT_RECEIVED")
        .setMimeType(
            ContentService.MimeType.TEXT
        );
}


function verifyWhatsAppWebhookRequest(e, rawBody) {

    const expectedToken =
        getScriptProperty(
            "WHATSAPP_WEBHOOK_POST_TOKEN",
            ""
        );

    // Fail closed: an unconfigured token must NOT be treated as
    // "verification disabled". Without this, the POST webhook would
    // silently accept any unauthenticated request whenever the
    // script property is missing.
    if (!expectedToken) {

        Logger.log(
            "verifyWhatsAppWebhookRequest: WHATSAPP_WEBHOOK_POST_TOKEN " +
            "is not configured — rejecting request."
        );

        return false;
    }

    const token =
        e &&
        e.parameter &&
        e.parameter.token
            ? String(e.parameter.token)
            : "";

    return token === expectedToken;
}



function doGet(e) {

    const params = e.parameter;

    const mode =
        params["hub.mode"];

    const token =
        params["hub.verify_token"];

    const challenge =
        params["hub.challenge"];

    const verifyToken =
        getScriptProperty(
            "WHATSAPP_VERIFY_TOKEN",
            ""
        );

    // Fail closed: never fall back to a hardcoded, publicly-visible
    // verify token. If the property isn't configured, verification
    // must fail rather than succeed against a guessable default.
    if (!verifyToken) {

        Logger.log(
            "doGet: WHATSAPP_VERIFY_TOKEN is not configured — " +
            "rejecting webhook verification."
        );

        return ContentService
            .createTextOutput("Verification failed")
            .setMimeType(
                ContentService.MimeType.TEXT
            );
    }

    if (
        mode === "subscribe" &&
        token === verifyToken
    ) {

        return ContentService
            .createTextOutput(challenge)
            .setMimeType(
                ContentService.MimeType.TEXT
            );
    }

    return ContentService
        .createTextOutput("Verification failed")
        .setMimeType(
            ContentService.MimeType.TEXT
        );
}


function doPost(e) {

    let messageId = "";
    let processingStarted = false;

    try {

        if (
            !e ||
            !e.postData ||
            !e.postData.contents
        ) {
            return webhookOkResponse();
        }

        const rawBody =
            e.postData.contents;

        if (
            !verifyWhatsAppWebhookRequest(
                e,
                rawBody
            )
        ) {
            Logger.log(
                "Rejected WhatsApp webhook request."
            );
            return webhookOkResponse();
        }

        const body =
            JSON.parse(rawBody);

        const value =
            body &&
            body.entry &&
            body.entry[0] &&
            body.entry[0].changes &&
            body.entry[0].changes[0] &&
            body.entry[0].changes[0].value
                ? body.entry[0].changes[0].value
                : null;

        const message =
            value &&
            value.messages &&
            value.messages[0];

        // Ignore non-message webhook events
        if (!message) {

            return webhookOkResponse();
        }

        messageId =
            String(message.id || "");

        if (
            messageId &&
            !tryBeginWhatsAppMessageProcessing(
                messageId
            )
        ) {
            return webhookOkResponse();
        }

        processingStarted = !!messageId;

        const senderPhone =
            String(message.from);

        const inbound =
            extractInboundWhatsAppMessage(
                message
            );

        const messageType =
            inbound.type ||
            String(message.type);

        const messageText =
            inbound.text || "";


        // ========================================================
        // GOOGLE SHEET
        // ========================================================

        const ss =
            SpreadsheetApp
                .getActiveSpreadsheet();


        // ========================================================
        // LOG INCOMING MESSAGE
        // ========================================================

        const senderName =
            value.contacts &&
                value.contacts[0] &&
                value.contacts[0].profile
                ? value.contacts[0].profile.name
                : "";

        const phoneNumberId =
            value.metadata
                ? value.metadata.phone_number_id
                : "";

        appendInboundWhatsAppLog(
            ss,
            {
                phone: senderPhone,
                name: senderName,
                type: messageType,
                message: messageText,
                phoneNumberId: phoneNumberId
            }
        );


        // ========================================================
        // WHATSAPP CONVERSATION
        // ========================================================

        if (messageText) {

            setWhatsAppInboundMessageContext(
                messageId
            );

            try {

                processWhatsAppTextMessage(
                    ss,
                    senderPhone,
                    senderName,
                    messageText
                );

            } finally {

                clearWhatsAppInboundMessageContext();
            }
        }


        finishWhatsAppMessageProcessing(
            messageId,
            true
        );
        processingStarted = false;

        return webhookOkResponse();


    } catch (error) {

        if (processingStarted && messageId) {
            clearWhatsAppMessageProcessing(
                messageId
            );
        }
        processingStarted = false;

        Logger.log(
            "Webhook error: " +
            error.message
        );

        Logger.log(
            error.stack
        );

        try {

            const ss =
                SpreadsheetApp
                    .getActiveSpreadsheet();

            let debugSheet =
                ss.getSheetByName(
                    "WhatsApp_Debug"
                );

            if (!debugSheet) {

                debugSheet =
                    ss.insertSheet(
                        "WhatsApp_Debug"
                    );

                debugSheet.appendRow([
                    "Timestamp",
                    "Direction",
                    "Phone",
                    "Status",
                    "Response"
                ]);
            }

            debugSheet.appendRow([
                new Date(),
                "WEBHOOK",
                "",
                "ERROR",
                error.message +
                "\n" +
                error.stack
            ]);

        } catch (debugError) {

            Logger.log(
                "Could not write debug error: " +
                debugError.message
            );
        }

        return ContentService
            .createTextOutput(
                "ERROR"
            )
            .setMimeType(
                ContentService.MimeType.TEXT
            );
    }
}



function getWhatsAppOutboundCacheKey(messageId) {

    return WA_OUTBOUND_PREFIX + messageId;
}



function hasWhatsAppOutboundBeenSent(messageId) {

    if (!messageId) {
        return false;
    }

    return !!CacheService.getScriptCache().get(
        getWhatsAppOutboundCacheKey(messageId)
    );
}



function markWhatsAppOutboundSent(messageId) {

    if (!messageId) {
        return;
    }

    CacheService.getScriptCache().put(
        getWhatsAppOutboundCacheKey(messageId),
        "1",
        21600
    );
}



function setWhatsAppInboundMessageContext(messageId) {

    CacheService.getScriptCache().put(
        WA_CURRENT_MESSAGE_ID_KEY,
        String(messageId || ""),
        300
    );
}



function getWhatsAppInboundMessageId() {

    return (
        CacheService.getScriptCache().get(
            WA_CURRENT_MESSAGE_ID_KEY
        ) || ""
    );
}



function clearWhatsAppInboundMessageContext() {

    CacheService.getScriptCache().remove(
        WA_CURRENT_MESSAGE_ID_KEY
    );
}



function isWhatsAppMessageProcessed(messageId) {

    if (!messageId) {
        return false;
    }

    const cache =
        CacheService.getScriptCache();

    const key =
        "WA_PROCESSED_" + messageId;

    return !!cache.get(key);
}


function markWhatsAppMessageProcessed(messageId) {

    if (!messageId) {
        return;
    }

    const cache =
        CacheService.getScriptCache();

    const key =
        "WA_PROCESSED_" + messageId;

    cache.put(
        key,
        "1",
        21600
    );
}


function isWhatsAppMessageProcessing(messageId) {

    if (!messageId) {
        return false;
    }

    return !!CacheService.getScriptCache().get(
        "WA_PROCESSING_" + messageId
    );
}


function tryBeginWhatsAppMessageProcessing(messageId) {

    if (!messageId) {
        return true;
    }

    if (isWhatsAppMessageProcessed(messageId)) {
        return false;
    }

    if (hasWhatsAppOutboundBeenSent(messageId)) {
        return false;
    }

    const lock =
        LockService.getScriptLock();

    try {

        if (!lock.tryLock(5000)) {
            return false;
        }

        if (isWhatsAppMessageProcessed(messageId)) {
            return false;
        }

        if (hasWhatsAppOutboundBeenSent(messageId)) {
            return false;
        }

        if (isWhatsAppMessageProcessing(messageId)) {
            return false;
        }

        CacheService.getScriptCache().put(
            "WA_PROCESSING_" + messageId,
            "1",
            300
        );

        return true;

    } finally {
        lock.releaseLock();
    }
}


function clearWhatsAppMessageProcessing(messageId) {

    if (!messageId) {
        return;
    }

    CacheService.getScriptCache().remove(
        "WA_PROCESSING_" + messageId
    );
}


function finishWhatsAppMessageProcessing(
    messageId,
    success
) {

    if (!messageId) {
        return;
    }

    clearWhatsAppMessageProcessing(messageId);

    if (success) {
        markWhatsAppMessageProcessed(messageId);
    }
}
