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

        // Logo is optional (only sent once HOSPITAL_LOGO_MEDIA_ID is set
        // in the Settings sheet — see uploadWhatsAppMediaFromDriveFile in
        // Setup.gs). When it does send, skip repeating the welcome line
        // in the text that follows.
        const logoSent =
            sendHospitalLogoGreeting(
                senderPhone
            );

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
                logoSent
                    ? ""
                    : "👋 Welcome to {{CLINIC_NAME}}!"
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

            sendLanguageMenuReply(
                ss,
                senderPhone,
                logoSent
                    ? ""
                    : "👋 Welcome to {{CLINIC_NAME}}!"
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

// ======================================================
// NO-SLOTS: CHOOSE ANOTHER DATE
// ======================================================
if (
    session &&
    normalizedMessage === "date_retry"
) {

    // PATIENT BOOKING
    if (
        session.state === "BOOK_DATE" ||
        session.state === "BOOK_DATE_CUSTOM" ||
        session.state === "BOOK_TIME" ||
        session.state === "BOOK_NAME" ||
        session.state === "BOOK_CONFIRM"
    ) {

        saveWhatsAppSession(
            senderPhone,
            {
                state: "BOOK_DATE",
                date: "",
                time: ""
            }
        );

        showBookingDateSelection(
            ss,
            senderPhone,
            getWhatsAppSession(senderPhone)
        );

        return true;
    }


    // PATIENT RESCHEDULE
    if (
        session.state === "RESCHEDULE_DATE" ||
        session.state === "RESCHEDULE_DATE_CUSTOM" ||
        session.state === "RESCHEDULE_TIME" ||
        session.state === "RESCHEDULE_CONFIRM"
    ) {

        saveWhatsAppSession(
            senderPhone,
            {
                state: "RESCHEDULE_DATE",
                date: "",
                time: ""
            }
        );

        showRescheduleDateSelection(
            ss,
            senderPhone,
            getWhatsAppSession(senderPhone)
        );

        return true;
    }


    // DOCTOR RESCHEDULE
    if (
        session.state === "DOCTOR_RESCHEDULE_DATE" ||
        session.state === "DOCTOR_RESCHEDULE_DATE_CUSTOM" ||
        session.state === "DOCTOR_RESCHEDULE_TIME" ||
        session.state === "DOCTOR_RESCHEDULE_CONFIRM"
    ) {

        saveWhatsAppSession(
            senderPhone,
            {
                role: "DOCTOR",
                state: "DOCTOR_RESCHEDULE_DATE",
                doctorId: session.doctorId,
                appointmentId: session.appointmentId,
                patientName: session.patientName,
                date: "",
                time: ""
            }
        );

        sendDateMenuReply(
            ss,
            senderPhone,
            buildDoctorRescheduleDateIntro(
                session.doctorId
            ),
            "doctor"
        );

        return true;
    }


    // SAFE FALLBACK
    showBookingDateSelection(
        ss,
        senderPhone,
        getWhatsAppSession(senderPhone)
    );

    return true;
}

// UNIVERSAL NAVIGATION
// ======================================================

if (
    session &&
    session.state !== "MAIN_MENU" &&
    session.state !== "DOCTOR_MENU" &&
    session.state !== "LANGUAGE_SELECT" &&
    session.state !== "LANGUAGE_CHANGE" &&
    (
        normalizedMessage === "0" ||
        normalizedMessage === "nav_main_menu" ||
        normalizedMessage === "main_menu"
    )
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

// States whose numbered list content can legitimately reach a 9th item
// reserve the literal digit "9" for that content instead of treating it
// as "back" — same reasoning as the DOCTOR_MENU_MORE tier-4 carve-out
// below. This includes every "flat" list state (see
// whatsAppNavigationShowsBack, which already treats this exact set of
// states as not having a meaningful "back" step) plus the doctor
// leave/session-remove pickers, which use the same numbered-list
// pattern. The "nav_back"/"back" aliases (typed word, or a tapped nav
// button) are never ambiguous with numbered content, so they always
// still work everywhere.
const WHATSAPP_NINTH_ITEM_LIST_STATES = [
    "BOOK_DOCTOR",
    "MY_APPOINTMENTS",
    "CANCEL_SELECT",
    "RESCHEDULE_SELECT",
    "DOCTOR_CANCEL_SELECT",
    "DOCTOR_RESCHEDULE_SELECT",
    "DOCTOR_STATUS_SELECT",
    "DOCTOR_LEAVE_CANCEL_PICK",
    "DOCTOR_AVAIL_REMOVE"
];

if (
    session &&
    session.state !== "MAIN_MENU" &&
    session.state !== "DOCTOR_MENU" &&
    session.state !== "LANGUAGE_SELECT" &&
    session.state !== "LANGUAGE_CHANGE" &&
    (
        normalizedMessage === "9" ||
        normalizedMessage === "nav_back" ||
        normalizedMessage === "back"
    ) &&
    !(
        session.state === "DOCTOR_MENU_MORE" &&
        Number(session.doctorMenuTier) === 4
    ) &&
    !(
        normalizedMessage === "9" &&
        WHATSAPP_NINTH_ITEM_LIST_STATES.indexOf(
            session.state
        ) !== -1
    )
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
