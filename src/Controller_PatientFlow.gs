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
    session,
    location
) {

    if (
        handleWhatsAppHomeCollectionMessage(
            ss,
            senderPhone,
            senderName,
            messageText,
            normalizedMessage,
            session,
            location
        )
    ) {
        return true;
    }

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
            "👋 Welcome to {{CLINIC_NAME}}!"
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
            state: "BOOK_DOCTOR",
            listPage: 0
        }
    );

    sendDoctorSelectionReply(
        ss,
        senderPhone
    );

    return true;
}


// ======================================================
// MAIN MENU → HOME SAMPLE COLLECTION
// ======================================================

if (
    normalizedMessage === "home_collection" &&
    session &&
    session.state === "MAIN_MENU"
) {

    beginWhatsAppHomeCollectionFlow(
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
    (
        session.state === "MAIN_MENU" ||
        session.state === "PATIENT_MAIN_MORE"
    )
) {

    const appointments =
        getMyAppointments(
            senderPhone
        ).filter(
            function (appt) {
                // Same fix as getConfirmedAppointmentsForPhone: only
                // hide truly inactive appointments, so one with a
                // blank or non-standard status doesn't disappear here.
                return !isInactiveAppointmentStatus(
                    appt.status
                );
            }
        );

    if (
        !appointments ||
        appointments.length === 0
    ) {

        // No appointments: take the patient directly into the
        // normal booking flow so they can choose any available doctor.
        saveWhatsAppSession(
            senderPhone,
            {
                role: "PATIENT",
                state: "BOOK_DOCTOR",
                doctorId: "",
                date: "",
                time: "",
                appointmentId: "",
                listPage: 0
            }
        );

        sendDoctorSelectionReply(
            ss,
            senderPhone
        );

        return true;
    }

    saveWhatsAppSession(
        senderPhone,
        {
            role: "PATIENT",
            state: "MY_APPOINTMENTS",
            apptPage: 0
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
        normalizedMessage === "more" ||
        normalizedMessage === "3"
    )
) {

    saveWhatsAppSession(
        senderPhone,
        {
            role: "PATIENT",
            state: "PATIENT_MAIN_MORE",
            patientMenuTier: 1
        }
    );

    sendPatientMainMoreMenuReply(
        ss,
        senderPhone,
        ""
    );

    return true;
}


// ======================================================
// MORE → CANCEL APPOINTMENT
// ======================================================

if (
    normalizedMessage === "3" &&
    session &&
    session.state === "PATIENT_MAIN_MORE"
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
// ======================================================
// BOOK_DOCTOR_MORE STATE
// ======================================================

if (
    session &&
    session.state === "BOOK_DOCTOR_MORE"
) {

    if (
        normalizedMessage === "doctor_more_prev" ||
        normalizedMessage === "doctor_more_next"
    ) {
        const currentPage = Number(session.listPage) || 0;
        const nextPage =
            normalizedMessage === "doctor_more_prev"
                ? Math.max(currentPage - 1, 0)
                : currentPage + 1;

        saveWhatsAppSession(
            senderPhone,
            { listPage: nextPage }
        );

        sendDoctorMoreSelectionReply(
            ss,
            senderPhone,
            nextPage
        );
        return true;
    }

    if (
        normalizedMessage === "nav_main_menu"
    ) {
        returnToMainMenu(ss, senderPhone);
        return true;
    }

    const selection = String(messageText || "").trim();
    const doctors = getDoctors();
    const remaining = doctors.slice(2);
    const page = Number(session.listPage) || 0;
    const pageSize = 8;
    const startIndex = page * pageSize;

    let doctor = null;

    if (selection.indexOf("doctor_select_") === 0) {
        const encodedDoctorId = selection.substring(
            "doctor_select_".length
        );
        let selectedDoctorId = encodedDoctorId;

        try {
            selectedDoctorId = decodeURIComponent(encodedDoctorId);
        } catch (decodeError) {}

        doctor = doctors.find(function (item) {
            return String(item.doctorId).trim() ===
                String(selectedDoctorId).trim();
        }) || null;
    } else {
        const doctorNumber = Number(selection);
        if (
            Number.isInteger(doctorNumber) &&
            doctorNumber >= 1 &&
            doctorNumber <= Math.min(
                pageSize,
                remaining.length - startIndex
            )
        ) {
            doctor = remaining[startIndex + doctorNumber - 1] || null;
        }
    }

    if (!doctor) {
        sendDoctorMoreSelectionReply(
            ss,
            senderPhone,
            page
        );
        return true;
    }

    saveWhatsAppSession(
        senderPhone,
        {
            role: "PATIENT",
            state: "BOOK_DATE",
            doctorId: doctor.doctorId,
            date: "",
            time: "",
            appointmentId: "",
            listPage: 0
        }
    );

    showBookingDateSelection(
        ss,
        senderPhone,
        {
            doctorId: doctor.doctorId
        }
    );

    return true;
}


// BOOK_DOCTOR STATE
// ======================================================

if (
    session &&
    session.state === "BOOK_DOCTOR"
) {
    // Pagination stays inside the same "Choose doctor" list.
    if (
        normalizedMessage === "doctor_more_prev" ||
        normalizedMessage === "doctor_more_next"
    ) {
        const currentPage =
            Number(session.listPage) || 0;

        const nextPage =
            normalizedMessage === "doctor_more_prev"
                ? Math.max(currentPage - 1, 0)
                : currentPage + 1;

        saveWhatsAppSession(
            senderPhone,
            { listPage: nextPage }
        );

        sendDoctorSelectionReply(
            ss,
            senderPhone,
            nextPage
        );

        return true;
    }

    if (normalizedMessage === "nav_main_menu") {
        returnToMainMenu(ss, senderPhone);
        return true;
    }

    const selection =
        String(messageText || "").trim();

    const doctors =
        getDoctors();

    let doctor = null;

    // Interactive list selection uses the actual Doctor ID.
    if (
        selection.indexOf("doctor_select_") === 0
    ) {
        const encodedDoctorId =
            selection.substring(
                "doctor_select_".length
            );

        let selectedDoctorId =
            encodedDoctorId;

        try {
            selectedDoctorId =
                decodeURIComponent(
                    encodedDoctorId
                );
        } catch (decodeError) {}

        doctor =
            doctors.find(function (item) {
                return String(
                    item.doctorId
                ).trim() === String(
                    selectedDoctorId
                ).trim();
            }) || null;
    } else {
        // Typed-number fallback refers to the current list page.
        const doctorNumber =
            Number(selection);

        const page =
            Number(session.listPage) || 0;

        const pageSize = 8;
        const startIndex =
            page * pageSize;

        const visibleCount =
            Math.min(
                pageSize,
                doctors.length - startIndex
            );

        if (
            Number.isInteger(doctorNumber) &&
            doctorNumber >= 1 &&
            doctorNumber <= visibleCount
        ) {
            doctor =
                doctors[
                    startIndex +
                    doctorNumber -
                    1
                ] || null;
        }
    }

    if (!doctor) {
        sendWhatsAppMenuReply(
            ss,
            senderPhone,
            buildDoctorSelectionBody(
                "❌ Please choose a valid doctor."
            ),
            getDoctorSelectionMenuSpec(
                Number(session.listPage) || 0
            )
        );
        return true;
    }

    saveWhatsAppSession(
        senderPhone,
        {
            role: "PATIENT",
            state: "BOOK_DATE",
            doctorId:
                doctor.doctorId,
            date: "",
            time: "",
            appointmentId: "",
            listPage: 0
        }
    );

    showBookingDateSelection(
        ss,
        senderPhone,
        {
            doctorId:
                doctor.doctorId
        }
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
        false,
        "patient"
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
// UPCOMING APPOINTMENT CONFLICT ACTIONS
// ======================================================
// A patient may have only one upcoming active appointment.
// When a new booking hits that rule, offer direct actions on the existing
// appointment instead of forcing the patient to navigate manually.

if (
    session &&
    session.state === "BOOK_CONFIRM" &&
    (
        normalizedMessage === "same_day_reschedule" ||
        normalizedMessage === "same_day_cancel"
    )
) {

    const existingAppointment =
        findActiveAppointmentOnDate(
            senderPhone,
            session.date
        );

    if (!existingAppointment) {
        sendWhatsAppReply(
            ss,
            senderPhone,
            "ℹ️ Your existing appointment could not be found.\n\nPlease send Hi to start again."
        );
        return true;
    }

    if (normalizedMessage === "same_day_reschedule") {
        beginRescheduleDateSelection(
            ss,
            senderPhone,
            existingAppointment
        );
        return true;
    }

    saveWhatsAppSession(
        senderPhone,
        {
            role: "PATIENT",
            state: "CANCEL_CONFIRM",
            appointmentId: existingAppointment.appointmentId,
            doctorId: existingAppointment.doctorId || "",
            date: existingAppointment.date || "",
            time: existingAppointment.time || ""
        }
    );

    sendCancelConfirmMenuReply(
        ss,
        senderPhone,
        existingAppointment
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

            // -------------------------------------------------------
            // Appointment confirmation
            // -------------------------------------------------------
            // First try the visual PNG confirmation. If image generation,
            // Google Slides export, WhatsApp media upload, or image delivery
            // fails, DO NOT leave the patient without confirmation.
            // Send a normal text confirmation as a guaranteed fallback.
            const receiptAppointment = {
                appointmentId:
                    bookingResult.appointmentId,
                patientName: patientName,
                doctorId:
                    session.doctorId,
                doctor:
                    bookingResult.doctor,
                date:
                    bookingResult.date,
                time:
                    bookingResult.time
            };

            let receiptSent = false;

            try {

                sendAppointmentReceiptCard(
                    senderPhone,
                    receiptAppointment
                );

                receiptSent = true;

            } catch (receiptError) {

                Logger.log(
                    "Appointment receipt image failed: " +
                    receiptError.message +
                    " | appointmentId=" +
                    bookingResult.appointmentId
                );

                // IMPORTANT:
                // Booking is already saved in the sheet and calendar.
                // Never silently finish the conversation here.
                try {

                    sendWhatsAppReply(
                        ss,
                        senderPhone,
                        "✅ Appointment confirmed!\n\n" +
                        "👤 " +
                        patientName +
                        "\n" +
                        "👨‍⚕️ " +
                        (bookingResult.doctor || "Doctor") +
                        "\n" +
                        "📅 " +
                        bookingResult.date +
                        "\n" +
                        "🕐 " +
                        bookingResult.time +
                        "\n" +
                        "🆔 " +
                        bookingResult.appointmentId
                    );

                } catch (fallbackError) {

                    Logger.log(
                        "Appointment text fallback also failed: " +
                        fallbackError.message +
                        " | appointmentId=" +
                        bookingResult.appointmentId
                    );
                }
            }

        } else {

            const errorMessage =
                bookingResult &&
                bookingResult.message
                    ? bookingResult.message
                    : "Unable to book the appointment.";

            if (
                errorMessage ===
                "You already have an upcoming active appointment."
            ) {

                const existingAppointment =
                    findUpcomingActiveAppointmentByPhone(
                        senderPhone
                    );

                const existingSummary =
                    existingAppointment
                        ? "\n\nYour existing appointment:\n" +
                          "👨‍⚕️ " +
                          (findDoctorById(existingAppointment.doctorId) || "Doctor") +
                          "\n" +
                          "📅 " +
                          formatWhatsAppDisplayDate(existingAppointment.date) +
                          "\n" +
                          "🕐 " +
                          String(existingAppointment.time || "")
                        : "";

                const fallbackText =
                    "Reschedule Existing\n" +
                    "Cancel Existing\n" +
                    "Choose Another Date";

                const interactive =
                    buildInteractiveButtonSpec([
                        {
                            id: "same_day_reschedule",
                            title: "Reschedule Existing"
                        },
                        {
                            id: "same_day_cancel",
                            title: "Cancel Existing"
                        },
                        {
                            id: "date_retry",
                            title: "Choose Another Date"
                        }
                    ]);

                sendWhatsAppMenuReply(
                    ss,
                    senderPhone,
                    "❌ You already have an upcoming active appointment." +
                    existingSummary +
                    "\n\nYou can reschedule or cancel that appointment.",
                    {
                        fallbackText: fallbackText,
                        interactive: interactive
                    }
                );

            } else {

                sendWhatsAppReply(
                    ss,
                    senderPhone,
                    "❌ " +
                    errorMessage +
                    "\n\n" +
                    "Please choose another time or send Hi to start again."
                );
            }
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
// MY APPOINTMENT ACTION STATE
// ======================================================

if (
    session &&
    session.state === "MY_APPOINTMENT_ACTION"
) {

    handleWhatsAppMyAppointmentActionState(
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

            const chosen =
                findConfirmedAppointmentForPhone(
                    senderPhone,
                    session.appointmentId
                );

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
        true,
        "patient"
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
                "Thank you for choosing {{CLINIC_NAME}}.";

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
