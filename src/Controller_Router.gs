// ============================================================
// Controller_Router — part of the ABC Clinic WhatsApp bot
// Top-level message dispatch: greeting, universal navigation, processWhatsAppTextMessage.
// See src/Config.gs for the full file-layout map and Script Properties.
// ============================================================



// ============================================================
// WHATSAPP MESSAGE ROUTER
// ============================================================


function handleWhatsAppGreeting(
    ss,
    senderPhone,
    session,
    normalizedMessage
) {

// HI / HELLO / HEY
// ======================================================

if (
    normalizedMessage === "hi" ||
    normalizedMessage === "hello" ||
    normalizedMessage === "hey" ||
    normalizedMessage === "హాయ్" ||
    normalizedMessage === "హలో" ||
    normalizedMessage === "नमस्ते" ||
    normalizedMessage === "हेलो"
) {

    const doctor =
        findDoctorByWhatsAppPhone(senderPhone);

    if (doctor) {

        returnDoctorToMenu(
            ss,
            senderPhone,
            doctor.doctorId
        );

    } else {

        let savedLanguage =
            session &&
            String(session.language || "")
                .trim()
                .toUpperCase();

        if (
            ["EN", "TE", "HI", "KA", "TA", "ML"].indexOf(
                savedLanguage
            ) === -1
        ) {

            const patient =
                findPatientByPhone(
                    senderPhone
                );

            if (
                patient &&
                ["EN", "TE", "HI", "KA", "TA", "ML"].indexOf(
                    patient.language
                ) !== -1
            ) {
                savedLanguage =
                    patient.language;
            }
        }

        const hasSavedLanguage =
            ["EN", "TE", "HI", "KA", "TA", "ML"].indexOf(
                savedLanguage
            ) !== -1;

        if (hasSavedLanguage) {

            saveWhatsAppSession(
                senderPhone,
                {
                    role: "PATIENT",
                    state: "MAIN_MENU",
                    language: savedLanguage,
                    doctorId: "",
                    date: "",
                    time: "",
                    appointmentId: ""
                }
            );

            sendPatientMainMenuReply(
                ss,
                senderPhone,
                "👋 Welcome to ABC Clinic!"
            );

        } else {

            // First-time users choose their preferred language.
            saveWhatsAppSession(
                senderPhone,
                {
                    role: "PATIENT",
                    language: "",
                    state: "LANGUAGE_SELECT",
                    doctorId: "",
                    date: "",
                    time: "",
                    appointmentId: ""
                }
            );

            sendClinicWelcomeImageReply(
                ss,
                senderPhone,
                "👋 Welcome to ABC Clinic!"
            );

            sendLanguageMenuReply(
                ss,
                senderPhone
            );
        }
    }

    return true;
}


// ======================================================

    return false;
}


function handleWhatsAppUniversalNavigation(
    ss,
    senderPhone,
    session,
    normalizedMessage
) {

// UNIVERSAL NAVIGATION
// ======================================================

if (
    session &&
    session.state !== "MAIN_MENU" &&
    session.state !== "DOCTOR_MENU" &&
    session.state !== "LANGUAGE_SELECT" &&
    session.state !== "LANGUAGE_CHANGE" &&
    normalizedMessage === "0"
) {

    if (session.role === "DOCTOR") {

        returnDoctorToMenu(
            ss,
            senderPhone,
            resolveDoctorIdFromSession(
                senderPhone,
                session
            )
        );

    } else {

        returnToMainMenu(ss, senderPhone);
    }

    return true;
}

if (
    session &&
    session.state !== "MAIN_MENU" &&
    session.state !== "DOCTOR_MENU" &&
    session.state !== "LANGUAGE_SELECT" &&
    session.state !== "LANGUAGE_CHANGE" &&
    normalizedMessage === "9"
) {

    if (session.role === "DOCTOR") {

        goBackInDoctorWhatsAppFlow(
            ss,
            senderPhone,
            session
        );

    } else {

        goBackInWhatsAppFlow(
            ss,
            senderPhone,
            session
        );
    }

    return true;
}


// ======================================================

    return false;
}


function processWhatsAppTextMessage(
    ss,
    senderPhone,
    senderName,
    messageText
) {

    const normalizedMessage =
        messageText
            .toLowerCase()
            .trim();

    const session =
        getWhatsAppSession(senderPhone);

    if (
        handleAfterHoursPatientGate(
            ss,
            senderPhone,
            session
        )
    ) {
        return;
    }

    if (
        handleWhatsAppGreeting(
            ss,
            senderPhone,
            session,
            normalizedMessage
        )
    ) {
        return;
    }

    if (
        handleWhatsAppUniversalNavigation(
            ss,
            senderPhone,
            session,
            normalizedMessage
        )
    ) {
        return;
    }

    if (
        handleWhatsAppDoctorMessage(
            ss,
            senderPhone,
            senderName,
            messageText,
            normalizedMessage,
            session
        )
    ) {
        return;
    }

    if (
        handleWhatsAppPatientMessage(
            ss,
            senderPhone,
            senderName,
            messageText,
            normalizedMessage,
            session
        )
    ) {
        return;
    }

// FALLBACK - unrecognized message / no active session
// ======================================================

if (
    session &&
    session.role === "DOCTOR"
) {

    const doctorId =
        resolveDoctorIdFromSession(
            senderPhone,
            session
        );

    returnDoctorToMenu(
        ss,
        senderPhone,
        doctorId,
        "🤔 Sorry, I didn't understand that."
    );
}

else {

    sendWhatsAppReply(
        ss,
        senderPhone,
        "🤔 Sorry, I didn't understand that.\n\n" +
        "Please send Hi to start."
    );
}



}
