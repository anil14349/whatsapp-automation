// ============================================================
// Controller_PatientFlow — part of the ABC Clinic WhatsApp bot
// Patient conversation state machine (handleWhatsAppPatientMessage).
// See src/Config.gs for the full file-layout map and Script Properties.
// ============================================================


function handleWhatsAppPatientMessage(
    ss,
    senderPhone,
    senderName,
    messageText,
    normalizedMessage,
    session
) {

// LANGUAGE SELECTION
// ======================================================

if (
    session &&
    session.state === "LANGUAGE_SELECT"
) {

    const languageByChoice = {
        "1": "EN",
        "2": "TE",
        "3": "HI",
        "4": "KA",
        "5": "TA",
        "6": "ML"
    };

    const language =
        languageByChoice[normalizedMessage];

    if (!language) {

        sendWhatsAppReply(
            ss,
            senderPhone,
            buildLanguageSelectionMessage()
        );

    } else {

        saveWhatsAppSession(
            senderPhone,
            {
                role: "PATIENT",
                language: language,
                state: "MAIN_MENU",
                doctorId: "",
                date: "",
                time: "",
                appointmentId: ""
            }
        );

        syncPatientLanguagePreference(
            senderPhone,
            language
        );

        sendWhatsAppReply(
            ss,
            senderPhone,
            buildMainMenuMessage(
                "👋 Welcome to ABC Clinic!"
            )
        );
    }
    return true;
}


// ======================================================
// LANGUAGE CHANGE
// ======================================================

if (
    session &&
    session.state === "LANGUAGE_CHANGE"
) {

    const languageByChoice = {
        "1": "EN",
        "2": "TE",
        "3": "HI",
        "4": "KA",
        "5": "TA",
        "6": "ML"
    };

    const language =
        languageByChoice[normalizedMessage];

    if (!language) {

        sendWhatsAppReply(
            ss,
            senderPhone,
            buildLanguageSelectionMessage()
        );

    } else {

        const currentSession =
            session || {};

        if (
            currentSession.role ===
            "DOCTOR"
        ) {

            const doctorId =
                resolveDoctorIdFromSession(
                    senderPhone,
                    currentSession
                );

            saveWhatsAppSession(
                senderPhone,
                {
                    role: "DOCTOR",
                    language: language,
                    state: "DOCTOR_MENU",
                    doctorId: doctorId,
                    date: "",
                    time: "",
                    appointmentId: ""
                }
            );

            returnDoctorToMenu(
                ss,
                senderPhone,
                doctorId,
                "✅ Language changed successfully."
            );

        } else {

            saveWhatsAppSession(
                senderPhone,
                {
                    role: "PATIENT",
                    language: language,
                    state: "MAIN_MENU",
                    doctorId: "",
                    date: "",
                    time: "",
                    appointmentId: ""
                }
            );

            syncPatientLanguagePreference(
                senderPhone,
                language
            );

            sendWhatsAppReply(
                ss,
                senderPhone,
                buildMainMenuMessage(
                    "✅ Language changed successfully."
                )
            );
        }
    }
    return true;
}


// ======================================================
// MAIN MENU → BOOK APPOINTMENT
// ======================================================

if (
    normalizedMessage === "1" &&
    session &&
    session.state === "MAIN_MENU"
) {

    saveWhatsAppSession(
        senderPhone,
        {
            role: "PATIENT",
            state: "BOOK_DOCTOR"
        }
    );

    sendDoctorSelectionReply(
        ss,
        senderPhone
    );

    return true;
}


// ======================================================
// MAIN MENU → MY APPOINTMENTS
// ======================================================

if (
    normalizedMessage === "2" &&
    session &&
    session.state === "MAIN_MENU"
) {

    const appointments =
        getMyAppointments(
            senderPhone
        ).filter(
            function (appt) {
                return isConfirmedAppointmentStatus(
                    appt.status
                );
            }
        );

    let reply;

    if (
        !appointments ||
        appointments.length === 0
    ) {

        reply =
            buildMainMenuMessage(
                "📋 You have no upcoming appointments."
            );

    } else {

        reply =
            "📋 Your Appointments:\n\n" +
            formatAppointmentsListForWhatsApp(
                appointments
            ) +
            "Reply with:\n\n" +
            "1️⃣ Book Appointment\n" +
            "2️⃣ My Appointments\n" +
            "3️⃣ Cancel Appointment\n" +
            "4️⃣ Reschedule Appointment\n" +
            "5️⃣ Change Language";
    }

    saveWhatsAppSession(
        senderPhone,
        {
            role: "PATIENT",
            state: "MAIN_MENU"
        }
    );

    sendWhatsAppReply(
        ss,
        senderPhone,
        reply
    );

    return true;
}


// ======================================================
// MAIN MENU → CANCEL APPOINTMENT
// ======================================================

if (
    normalizedMessage === "3" &&
    session &&
    session.state === "MAIN_MENU"
) {

    beginWhatsAppCancelFlow(
        ss,
        senderPhone
    );
    return true;
}


// ======================================================
// MAIN MENU → RESCHEDULE APPOINTMENT
// ======================================================

if (
    normalizedMessage === "4" &&
    session &&
    session.state === "MAIN_MENU"
) {

    beginWhatsAppRescheduleFlow(
        ss,
        senderPhone
    );
    return true;
}


// ======================================================
// MAIN MENU → CHANGE LANGUAGE
// ======================================================

if (
    normalizedMessage === "5" &&
    session &&
    session.state === "MAIN_MENU"
) {

    saveWhatsAppSession(
        senderPhone,
        {
            role: "PATIENT",
            state: "LANGUAGE_CHANGE"
        }
    );

    sendWhatsAppReply(
        ss,
        senderPhone,
        buildLanguageSelectionMessage()
    );
    return true;
}


// ======================================================
// MAIN MENU → UNRECOGNIZED OPTION
// ======================================================

if (
    session &&
    session.state === "MAIN_MENU"
) {

    sendWhatsAppReply(
        ss,
        senderPhone,
        buildMainMenuMessage(
            "❌ Invalid option."
        )
    );
    return true;
}


// ======================================================
// BOOK_DOCTOR STATE
// ======================================================

if (
    session &&
    session.state === "BOOK_DOCTOR"
) {

    const doctorNumber =
        Number(messageText.trim());

    const doctors =
        getDoctors();

    const doctor =
        Number.isInteger(doctorNumber) &&
        doctorNumber >= 1 &&
        doctorNumber <= doctors.length
            ? doctors[doctorNumber - 1]
            : null;


    // ======================================================
    // DOCTOR NOT FOUND
    // ======================================================

    if (!doctor) {

        sendWhatsAppMenuReply(
            ss,
            senderPhone,
            "❌ Please choose a valid doctor number.\n\n" +
            "📅 Book Appointment\n\nSelect a doctor:",
            getDoctorSelectionMenuSpec()
        );

    }


    // ======================================================
    // DOCTOR FOUND
    // ======================================================

    else {

        saveWhatsAppSession(
            senderPhone,
            {
                role: "PATIENT",
                state: "BOOK_DATE",
                doctorId:
                    doctor.doctorId
            }
        );


        sendDateMenuReply(
            ss,
            senderPhone,
            "👨‍⚕️ Doctor selected: " +
            doctor.doctorName +
            ".\n\nPlease choose a date:"
        );
    }

    return true;
}

// ======================================================
// BOOK_DATE STATE
// ======================================================

if (
    session &&
    session.state === "BOOK_DATE"
) {

    handleWhatsAppDateMenuInput(
        ss,
        senderPhone,
        session.doctorId,
        normalizedMessage,
        "BOOK_TIME",
        "BOOK_DATE_CUSTOM",
        false
    );
    return true;
}


// ======================================================
// BOOK_DATE_CUSTOM STATE (manually typed date)
// ======================================================

if (
    session &&
    session.state === "BOOK_DATE_CUSTOM"
) {

    handleWhatsAppCustomDateInput(
        ss,
        senderPhone,
        session.doctorId,
        messageText,
        "BOOK_TIME"
    );
    return true;
}


// ======================================================
// BOOK_NAME STATE (first-time patient name)
// ======================================================

if (
    session &&
    session.state === "BOOK_NAME"
) {

    if (
        !session.doctorId ||
        !session.date ||
        !session.time
    ) {

        sendWhatsAppReply(
            ss,
            senderPhone,
            "❌ Your booking session has expired.\n\n" +
            "Please send Hi to start again."
        );

        return true;
    }

    const enteredName =
        messageText.trim();

    if (!isValidPatientName(enteredName)) {

        sendWhatsAppReply(
            ss,
            senderPhone,
            buildInvalidPatientNameReply()
        );

        return true;
    }

    const language =
        session.language || "EN";

    const registration =
        upsertPatient(
            senderPhone,
            enteredName,
            language,
            { updateLastVisit: false }
        );

    if (!registration.success) {

        sendWhatsAppReply(
            ss,
            senderPhone,
            "❌ " +
            (registration.message ||
                "Unable to save your name.")
        );

        return true;
    }

    saveWhatsAppSession(
        senderPhone,
        {
            state: "BOOK_CONFIRM",
            patientName: enteredName
        }
    );

    sendWhatsAppMenuReply(
        ss,
        senderPhone,
        buildBookingConfirmationMessage(
            session,
            enteredName
        ),
        getBookingConfirmSpec()
    );
    return true;
}


// ======================================================
// BOOK_CONFIRM STATE
// ======================================================

if (
    session &&
    session.state === "BOOK_CONFIRM"
) {

    if (normalizedMessage === "1") {

        if (
            !session.doctorId ||
            !session.date ||
            !session.time
        ) {

            clearWhatsAppSession(
                senderPhone
            );

            sendWhatsAppReply(
                ss,
                senderPhone,
                "❌ Your booking session has expired.\n\n" +
                "Please send Hi to start again."
            );

            return true;
        }

        const patientName =
            resolvePatientNameForBooking(
                senderPhone,
                session,
                senderName
            );

        const bookingResult =
            bookAppointment(
                session.doctorId,
                session.date,
                session.time,
                patientName,
                senderPhone,
                session.language ||
                    resolvePatientLanguage(
                        senderPhone,
                        session
                    )
            );

        if (
            bookingResult &&
            bookingResult.success
        ) {

            saveWhatsAppSession(
                senderPhone,
                {
                    role: "PATIENT",
                    state: "MAIN_MENU",
                    doctorId: "",
                    date: "",
                    time: "",
                    appointmentId:
                        bookingResult.appointmentId
                }
            );

            const reply =
                "✅ Appointment confirmed!\n\n" +
                "🆔 Appointment ID: " +
                bookingResult.appointmentId +
                "\n" +
                "👨‍⚕️ Doctor: " +
                bookingResult.doctor +
                "\n" +
                "📅 Date: " +
                bookingResult.date +
                "\n" +
                "🕐 Time: " +
                bookingResult.time +
                "\n\n" +
                "Thank you for choosing ABC Clinic.";

            sendWhatsAppReply(
                ss,
                senderPhone,
                reply
            );

        } else {

            const errorMessage =
                bookingResult &&
                bookingResult.message
                    ? bookingResult.message
                    : "Unable to book the appointment.";

            sendWhatsAppReply(
                ss,
                senderPhone,
                "❌ " +
                errorMessage +
                "\n\n" +
                "Please choose another time or send Hi to start again."
            );
        }

    } else if (
        normalizedMessage === "2"
    ) {

        if (
            !session.doctorId ||
            !session.date
        ) {

            clearWhatsAppSession(
                senderPhone
            );

            sendWhatsAppReply(
                ss,
                senderPhone,
                "❌ Your booking session has expired.\n\n" +
                "Please send Hi to start again."
            );

            return true;
        }

        const slots =
            getAvailableSlots(
                session.doctorId,
                session.date
            );

        if (
            !slots ||
            slots.length === 0
        ) {

            clearWhatsAppSession(
                senderPhone
            );

            sendWhatsAppReply(
                ss,
                senderPhone,
                "❌ No available slots remain for " +
                session.date +
                ".\n\n" +
                "Please send Hi to start again."
            );

            return true;
        }

        saveWhatsAppSession(
            senderPhone,
            {
                state: "BOOK_TIME",
                time: ""
            }
        );

        let reply =
            "📅 Date: " +
            session.date +
            "\n\n" +
            "Available slots:\n\n";

        for (
            let i = 0;
            i < slots.length;
            i++
        ) {

            reply +=
                (i + 1) +
                "️⃣ " +
                slots[i] +
                "\n";
        }

        reply +=
            "\nPlease choose a time.";

        sendWhatsAppReply(
            ss,
            senderPhone,
            reply
        );

    } else if (
        normalizedMessage === "3"
    ) {

        saveWhatsAppSession(
            senderPhone,
            {
                role: "PATIENT",
                state: "MAIN_MENU",
                doctorId: "",
                date: "",
                time: "",
                appointmentId: ""
            }
        );

        sendWhatsAppReply(
            ss,
            senderPhone,
            "❌ Appointment booking cancelled.\n\n" +
            "Please choose an option:\n\n" +
            "1️⃣ Book Appointment\n" +
            "2️⃣ My Appointments\n" +
            "3️⃣ Cancel Appointment\n" +
            "4️⃣ Reschedule Appointment\n" +
            "5️⃣ Change Language"
        );

    } else {

        sendWhatsAppReply(
            ss,
            senderPhone,
            "❌ Invalid option.\n\n" +
            "Please reply with:\n\n" +
            "1️⃣ Confirm\n" +
            "2️⃣ Choose another time\n" +
            "3️⃣ Cancel"
        );
    }
    return true;
}


// ======================================================
// BOOK_TIME STATE
// ======================================================

if (
    session &&
    session.state === "BOOK_TIME"
) {

    handleWhatsAppBookTimeState(
        ss,
        senderPhone,
        session,
        normalizedMessage
    );
    return true;
}


// ======================================================
// CANCEL_SELECT STATE
// ======================================================

if (
    session &&
    session.state === "CANCEL_SELECT"
) {

    handleWhatsAppCancelSelectState(
        ss,
        senderPhone,
        normalizedMessage
    );
    return true;
}


// ======================================================
// CANCEL_CONFIRM STATE
// ======================================================

if (
    session &&
    session.state === "CANCEL_CONFIRM"
) {

    if (normalizedMessage === "1") {

        const result =
            cancelAppointment(
                session.appointmentId,
                senderPhone
            );

        if (
            result &&
            result.success
        ) {

            saveWhatsAppSession(
                senderPhone,
                {
                    role: "PATIENT",
                    state: "MAIN_MENU",
                    doctorId: "",
                    date: "",
                    time: "",
                    appointmentId: ""
                }
            );

            sendWhatsAppReply(
                ss,
                senderPhone,
                buildMainMenuMessage(
                    "✅ " + result.message
                )
            );

        } else {

            const errorMessage =
                result && result.message
                    ? result.message
                    : "Unable to cancel the appointment.";

            sendWhatsAppReply(
                ss,
                senderPhone,
                "❌ " + errorMessage + "\n\n" +
                "1️⃣ Yes, cancel it\n" +
                "2️⃣ No, go back"
            );
        }

    } else if (normalizedMessage === "2") {

        saveWhatsAppSession(
            senderPhone,
            {
                role: "PATIENT",
                state: "MAIN_MENU",
                doctorId: "",
                date: "",
                time: "",
                appointmentId: ""
            }
        );

        sendWhatsAppReply(
            ss,
            senderPhone,
            buildMainMenuMessage(
                "👍 Okay, appointment was not cancelled."
            )
        );

    } else {

        sendWhatsAppReply(
            ss,
            senderPhone,
            "❌ Invalid option.\n\n" +
            "1️⃣ Yes, cancel it\n" +
            "2️⃣ No, go back"
        );
    }
    return true;
}


// ======================================================
// RESCHEDULE_SELECT STATE
// ======================================================

if (
    session &&
    session.state === "RESCHEDULE_SELECT"
) {

    handleWhatsAppRescheduleSelectState(
        ss,
        senderPhone,
        normalizedMessage
    );
    return true;
}


// ======================================================
// RESCHEDULE_DATE STATE
// ======================================================

if (
    session &&
    session.state === "RESCHEDULE_DATE"
) {

    handleWhatsAppDateMenuInput(
        ss,
        senderPhone,
        session.doctorId,
        normalizedMessage,
        "RESCHEDULE_TIME",
        "RESCHEDULE_DATE_CUSTOM",
        true
    );
    return true;
}


// ======================================================
// RESCHEDULE_DATE_CUSTOM STATE (manually typed date)
// ======================================================

if (
    session &&
    session.state === "RESCHEDULE_DATE_CUSTOM"
) {

    handleWhatsAppCustomDateInput(
        ss,
        senderPhone,
        session.doctorId,
        messageText,
        "RESCHEDULE_TIME"
    );
    return true;
}


// ======================================================
// RESCHEDULE_TIME STATE
// ======================================================

if (
    session &&
    session.state === "RESCHEDULE_TIME"
) {

    handleWhatsAppRescheduleTimeState(
        ss,
        senderPhone,
        session,
        normalizedMessage
    );
    return true;
}


// ======================================================
// RESCHEDULE_CONFIRM STATE
// ======================================================

if (
    session &&
    session.state === "RESCHEDULE_CONFIRM"
) {

    if (normalizedMessage === "1") {

        if (
            !session.appointmentId ||
            !session.date ||
            !session.time
        ) {

            clearWhatsAppSession(
                senderPhone
            );

            sendWhatsAppReply(
                ss,
                senderPhone,
                "❌ Your reschedule session has expired.\n\n" +
                "Please send Hi to start again."
            );

            return true;
        }

        const result =
            rescheduleAppointment(
                session.appointmentId,
                senderPhone,
                session.date,
                session.time
            );

        if (
            result &&
            result.success
        ) {

            saveWhatsAppSession(
                senderPhone,
                {
                    role: "PATIENT",
                    state: "MAIN_MENU",
                    doctorId: "",
                    date: "",
                    time: "",
                    appointmentId:
                        result.appointmentId
                }
            );

            const reply =
                "✅ Appointment rescheduled!\n\n" +
                "🆔 Appointment ID: " +
                result.appointmentId +
                "\n" +
                "👨‍⚕️ Doctor: " +
                result.doctor +
                "\n" +
                "📅 New Date: " +
                result.date +
                "\n" +
                "🕐 New Time: " +
                result.time +
                "\n\n" +
                "Thank you for choosing ABC Clinic.";

            sendWhatsAppReply(
                ss,
                senderPhone,
                reply
            );

        } else {

            const errorMessage =
                result && result.message
                    ? result.message
                    : "Unable to reschedule the appointment.";

            sendWhatsAppReply(
                ss,
                senderPhone,
                "❌ " + errorMessage + "\n\n" +
                "Please reply with:\n\n" +
                "1️⃣ Confirm\n" +
                "2️⃣ Choose another time\n" +
                "3️⃣ Cancel"
            );
        }

    } else if (
        normalizedMessage === "2"
    ) {

        if (
            !session.doctorId ||
            !session.date
        ) {

            clearWhatsAppSession(
                senderPhone
            );

            sendWhatsAppReply(
                ss,
                senderPhone,
                "❌ Your reschedule session has expired.\n\n" +
                "Please send Hi to start again."
            );

            return true;
        }

        whatsAppShowSlotsForDate(
            ss,
            senderPhone,
            session.doctorId,
            session.date,
            "RESCHEDULE_TIME"
        );

    } else if (
        normalizedMessage === "3"
    ) {

        saveWhatsAppSession(
            senderPhone,
            {
                role: "PATIENT",
                state: "MAIN_MENU",
                doctorId: "",
                date: "",
                time: "",
                appointmentId: ""
            }
        );

        sendWhatsAppReply(
            ss,
            senderPhone,
            buildMainMenuMessage(
                "❌ Reschedule cancelled."
            )
        );

    } else {

        sendWhatsAppReply(
            ss,
            senderPhone,
            "❌ Invalid option.\n\n" +
            "Please reply with:\n\n" +
            "1️⃣ Confirm\n" +
            "2️⃣ Choose another time\n" +
            "3️⃣ Cancel"
        );
    }
    return true;
}


// ======================================================

    return false;
}
