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

        sendLanguageMenuReply(
            ss,
            senderPhone,
            "❌ Invalid option."
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

        sendPatientMainMenuReply(
            ss,
            senderPhone,
            "👋 Welcome to ABC Clinic!",
            {
                skipWelcomeImage: true
            }
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

        sendLanguageMenuReply(
            ss,
            senderPhone,
            "❌ Invalid option."
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

            sendPatientMainMenuReply(
                ss,
                senderPhone,
                "✅ Language changed successfully."
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

    if (
        !appointments ||
        appointments.length === 0
    ) {

        saveWhatsAppSession(
            senderPhone,
            {
                role: "PATIENT",
                state: "MAIN_MENU"
            }
        );

        sendPatientMainMenuReply(
            ss,
            senderPhone,
            "📋 You have no upcoming appointments."
        );

        return true;
    }

    saveWhatsAppSession(
        senderPhone,
        {
            role: "PATIENT",
            state: "MY_APPOINTMENTS",
            slotPage: 0
        }
    );

    sendPatientAppointmentListMenuReply(
        ss,
        senderPhone,
        "my_appointments",
        appointments
    );

    return true;
}


// ======================================================
// MAIN MENU → MORE (button sub-menu)
// ======================================================

if (
    session &&
    session.state === "MAIN_MENU" &&
    (
        normalizedMessage === "menu_more" ||
        normalizedMessage === "more"
    )
) {

    saveWhatsAppSession(
        senderPhone,
        {
            role: "PATIENT",
            state: "PATIENT_MAIN_MORE"
        }
    );

    sendPatientMainMoreMenuReply(
        ss,
        senderPhone
    );

    return true;
}


// ======================================================
// MAIN MENU / MORE → CANCEL APPOINTMENT
// ======================================================

if (
    normalizedMessage === "3" &&
    session &&
    (
        session.state === "MAIN_MENU" ||
        session.state === "PATIENT_MAIN_MORE"
    )
) {

    beginWhatsAppCancelFlow(
        ss,
        senderPhone
    );
    return true;
}


// ======================================================
// MAIN MENU / MORE → RESCHEDULE APPOINTMENT
// ======================================================

if (
    normalizedMessage === "4" &&
    session &&
    (
        session.state === "MAIN_MENU" ||
        session.state === "PATIENT_MAIN_MORE"
    )
) {

    beginWhatsAppRescheduleFlow(
        ss,
        senderPhone
    );
    return true;
}


// ======================================================
// MAIN MENU / MORE → CHANGE LANGUAGE
// ======================================================

if (
    normalizedMessage === "5" &&
    session &&
    (
        session.state === "MAIN_MENU" ||
        session.state === "PATIENT_MAIN_MORE"
    )
) {

    saveWhatsAppSession(
        senderPhone,
        {
            role: "PATIENT",
            state: "LANGUAGE_CHANGE"
        }
    );

    sendLanguageMenuReply(
        ss,
        senderPhone
    );
    return true;
}


// ======================================================
// MAIN MENU / MORE → CONTACT & LOCATION
// ======================================================

if (
    (
        normalizedMessage === "menu_contact" ||
        normalizedMessage === "6"
    ) &&
    session &&
    (
        session.state === "MAIN_MENU" ||
        session.state === "PATIENT_MAIN_MORE"
    )
) {

    if (
        session.state === "MAIN_MENU"
    ) {

        saveWhatsAppSession(
            senderPhone,
            {
                role: "PATIENT",
                state: "PATIENT_MAIN_MORE"
            }
        );
    }

    sendClinicContactReply(
        ss,
        senderPhone
    );

    return true;
}


// ======================================================
// MAIN MENU / MORE → SLOT ALERTS (WAITLIST)
// ======================================================

if (
    (
        normalizedMessage === "menu_waitlist" ||
        normalizedMessage === "7"
    ) &&
    session &&
    (
        session.state === "MAIN_MENU" ||
        session.state === "PATIENT_MAIN_MORE"
    )
) {

    saveWhatsAppSession(
        senderPhone,
        {
            role: "PATIENT",
            state: "WAITLIST_DOCTOR",
            slotPage: 0
        }
    );

    sendWhatsAppMenuReply(
        ss,
        senderPhone,
        buildWaitlistJoinIntro(),
        getDoctorSelectionMenuSpec()
    );

    return true;
}


// ======================================================
// MAIN MORE → UNRECOGNIZED OPTION
// ======================================================

if (
    session &&
    session.state === "PATIENT_MAIN_MORE"
) {

    sendPatientMainMoreMenuReply(
        ss,
        senderPhone,
        "❌ Invalid option."
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

    sendPatientMainMenuReply(
        ss,
        senderPhone,
        "❌ Invalid option."
    );
    return true;
}


// ======================================================
// WAITLIST_DOCTOR STATE
// ======================================================

if (
    session &&
    session.state === "WAITLIST_DOCTOR"
) {

    const doctors =
        getDoctors();

    let doctor = null;

    const doctorNumber =
        Number(messageText.trim());

    if (
        Number.isInteger(doctorNumber) &&
        doctorNumber >= 1 &&
        doctorNumber <= doctors.length
    ) {
        doctor =
            doctors[doctorNumber - 1];
    }

    if (!doctor) {

        sendWhatsAppMenuReply(
            ss,
            senderPhone,
            buildWaitlistJoinIntro() +
            "\n\n❌ Please choose a valid doctor.",
            getDoctorSelectionMenuSpec()
        );

        return true;
    }

    const patient =
        findPatientByPhone(senderPhone);

    const result =
        addPatientToWaitlist(
            senderPhone,
            doctor.doctorId,
            patient &&
            patient.name
                ? patient.name
                : senderName || "Patient"
        );

    saveWhatsAppSession(
        senderPhone,
        {
            role: "PATIENT",
            state: "PATIENT_MAIN_MORE",
            doctorId: "",
            slotPage: 0
        }
    );

    sendPatientMainMoreMenuReply(
        ss,
        senderPhone,
        result.success
            ? "✅ " + result.message
            : "ℹ️ " + result.message
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
            buildDoctorSelectionBody(
                "❌ Please choose a valid doctor."
            ),
            getDoctorSelectionMenuSpec()
        );

    }


    // ======================================================
    // DOCTOR FOUND
    // ======================================================

    else {

        const autoServiceId =
            getAutoSelectedServiceId();

        if (
            shouldOfferVisitTypeSelection()
        ) {

            saveWhatsAppSession(
                senderPhone,
                {
                    role: "PATIENT",
                    state: "BOOK_SERVICE",
                    doctorId:
                        doctor.doctorId,
                    serviceId: "",
                    slotPage: 0
                }
            );

            sendVisitTypeSelectionReply(
                ss,
                senderPhone,
                doctor.doctorName
            );

        } else {

            saveWhatsAppSession(
                senderPhone,
                {
                    role: "PATIENT",
                    state: "BOOK_DATE",
                    doctorId:
                        doctor.doctorId,
                    serviceId:
                        autoServiceId,
                    slotPage: 0
                }
            );

            sendDateMenuReply(
                ss,
                senderPhone,
                "👨‍⚕️ " +
                doctor.doctorName +
                "\n\nChoose an appointment date."
            );
        }
    }

    return true;
}

// ======================================================
// BOOK_SERVICE STATE (visit type)
// ======================================================

if (
    session &&
    session.state === "BOOK_SERVICE"
) {

    const services =
        getActiveServices();

    let service = null;

    const serviceNumber =
        Number(messageText.trim());

    if (
        Number.isInteger(serviceNumber) &&
        serviceNumber >= 1 &&
        serviceNumber <= services.length
    ) {
        service =
            services[serviceNumber - 1];
    }

    const doctorName =
        findDoctorById(
            session.doctorId
        ) || "your doctor";

    if (!service) {

        sendWhatsAppMenuReply(
            ss,
            senderPhone,
            buildVisitTypeSelectionBody(
                doctorName,
                "❌ Please choose a valid visit type."
            ),
            getVisitTypeSelectionMenuSpec()
        );

        return true;
    }

    saveWhatsAppSession(
        senderPhone,
        {
            role: "PATIENT",
            state: "BOOK_DATE",
            serviceId:
                service.serviceId,
            slotPage: 0
        }
    );

    sendDateMenuReply(
        ss,
        senderPhone,
        "👨‍⚕️ " +
        doctorName +
        "\n" +
        "🩺 " +
        service.name +
        "\n\nChoose an appointment date."
    );

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

    if (
        normalizedMessage === "1" ||
        normalizedMessage === "confirm_yes"
    ) {

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
                    ),
                session.serviceId || ""
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

            const visitType =
                getServiceDisplayName(
                    session.serviceId
                );

            const reply =
                "✅ Appointment confirmed!\n\n" +
                "👨‍⚕️ " +
                bookingResult.doctor +
                (
                    visitType
                        ? "\n🩺 " + visitType
                        : ""
                ) +
                "\n" +
                "📅 " +
                bookingResult.date +
                "\n" +
                "🕐 " +
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
        normalizedMessage === "2" ||
        normalizedMessage === "confirm_other_time"
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
            getAvailableSlotsForBooking(
                session.doctorId,
                session.date,
                session.serviceId
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
                time: "",
                slotPage: 0
            }
        );

        sendSlotSelectionMenuReply(
            ss,
            senderPhone,
            "",
            slots,
            0,
            {
                isoDate: session.date,
                isReschedule: false
            }
        );

    } else if (
        normalizedMessage === "3" ||
        normalizedMessage === "confirm_cancel"
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

        sendPatientMainMenuReply(
            ss,
            senderPhone,
            "❌ Appointment booking cancelled."
        );

    } else {

        const patientName =
            resolvePatientNameForBooking(
                senderPhone,
                session,
                senderName
            );

        sendWhatsAppMenuReply(
            ss,
            senderPhone,
            "❌ Invalid option.\n\n" +
            buildBookingConfirmationMessage(
                session,
                patientName
            ),
            getBookingConfirmSpec()
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
// MY APPOINTMENTS STATE
// ======================================================

if (
    session &&
    session.state === "MY_APPOINTMENTS"
) {

    handleWhatsAppMyAppointmentsState(
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
        session,
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

    if (isYesCancelConfirmChoice(normalizedMessage)) {

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

            sendPatientMainMenuReply(
                ss,
                senderPhone,
                "✅ " + result.message
            );

        } else {

            const errorMessage =
                result && result.message
                    ? result.message
                    : "Unable to cancel the appointment.";

            sendCancelConfirmMenuReply(
                ss,
                senderPhone,
                chosen,
                "❌ " + errorMessage
            );
        }

    } else if (isNoGoBackConfirmChoice(normalizedMessage)) {

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

        sendPatientMainMenuReply(
            ss,
            senderPhone,
            "👍 Okay, appointment was not cancelled."
        );

    } else {

        const chosen =
            findConfirmedAppointmentForPhone(
                senderPhone,
                session.appointmentId
            );

        sendCancelConfirmMenuReply(
            ss,
            senderPhone,
            chosen,
            "❌ Invalid option."
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
        session,
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

    if (
        normalizedMessage === "1" ||
        normalizedMessage === "confirm_yes"
    ) {

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
                "👨‍⚕️ " +
                result.doctor +
                "\n" +
                "📅 " +
                result.date +
                "\n" +
                "🕐 " +
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

            sendRescheduleConfirmMenuReply(
                ss,
                senderPhone,
                session,
                "❌ " + errorMessage
            );
        }

    } else if (
        normalizedMessage === "2" ||
        normalizedMessage === "confirm_other_time"
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
        normalizedMessage === "3" ||
        normalizedMessage === "confirm_cancel"
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

        sendPatientMainMenuReply(
            ss,
            senderPhone,
            "❌ Reschedule cancelled."
        );

    } else {

        sendRescheduleConfirmMenuReply(
            ss,
            senderPhone,
            session,
            "❌ Invalid option."
        );
    }
    return true;
}


// ======================================================

    return false;
}
