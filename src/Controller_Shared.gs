// ============================================================
// Controller_Shared — part of the ABC Clinic WhatsApp bot
// Flow helpers shared by both the patient and doctor conversation state machines.
// See src/Config.gs for the full file-layout map and Script Properties.
// ============================================================



function beginWhatsAppCancelFlow(
    ss,
    phone
) {

    const appointments =
        getConfirmedAppointmentsForPhone(phone);

    if (
        !appointments ||
        appointments.length === 0
    ) {

        saveWhatsAppSession(phone, {
            role: "PATIENT",
            state: "MAIN_MENU"
        });

        sendWhatsAppReply(
            ss,
            phone,
            buildMainMenuMessage(
                "❌ You have no active appointments to cancel."
            )
        );

        return false;
    }

    saveWhatsAppSession(phone, {
        role: "PATIENT",
        state: "CANCEL_SELECT"
    });

    sendWhatsAppReply(
        ss,
        phone,
        buildAppointmentPickerPrompt(
            "❌ Cancel Appointment",
            "Select the appointment to cancel:",
            appointments
        )
    );

    return true;
}



function beginWhatsAppRescheduleFlow(
    ss,
    phone
) {

    const appointments =
        getConfirmedAppointmentsForPhone(phone);

    if (
        !appointments ||
        appointments.length === 0
    ) {

        saveWhatsAppSession(phone, {
            role: "PATIENT",
            state: "MAIN_MENU"
        });

        sendWhatsAppReply(
            ss,
            phone,
            buildMainMenuMessage(
                "❌ You have no active appointments to reschedule."
            )
        );

        return false;
    }

    saveWhatsAppSession(phone, {
        role: "PATIENT",
        state: "RESCHEDULE_SELECT"
    });

    sendWhatsAppReply(
        ss,
        phone,
        buildAppointmentPickerPrompt(
            "🔄 Reschedule Appointment",
            "Select the appointment to reschedule:",
            appointments
        )
    );

    return true;
}



function notifyPatientOfDoctorCancellation(
    appointment
) {

    try {

        const recipient =
            formatWhatsAppRecipientPhone(
                appointment.phone
            );

        if (!recipient) {
            return;
        }

        sendWhatsAppText(
            recipient,
            "ABC Clinic: Your appointment on " +
            appointment.date +
            " at " +
            appointment.time +
            " has been cancelled by the clinic.\n\n" +
            "Reply Hi to book again."
        );

    } catch (error) {

        Logger.log(
            "Patient cancel notify failed: " +
            error.message
        );
    }
}



function notifyPatientOfDoctorReschedule(
    appointment,
    result
) {

    try {

        const recipient =
            formatWhatsAppRecipientPhone(
                appointment.phone
            );

        if (!recipient) {
            return;
        }

        sendWhatsAppText(
            recipient,
            "ABC Clinic: Your appointment has been rescheduled by the clinic.\n\n" +
            "📅 New Date: " +
            result.date +
            "\n" +
            "🕐 New Time: " +
            result.time +
            "\n" +
            "🆔 Appointment ID: " +
            result.appointmentId +
            "\n\n" +
            "Reply Hi if you need to make changes."
        );

    } catch (error) {

        Logger.log(
            "Patient reschedule notify failed: " +
            error.message
        );
    }
}



function handleDoctorWhatsAppAppointmentListSelection(
    ss,
    phone,
    session,
    normalizedMessage,
    options
) {

    const opts = options || {};
    const doctorId =
        session &&
        session.doctorId
            ? session.doctorId
            : "";

    if (normalizedMessage === "0") {

        returnDoctorToMenu(
            ss,
            phone,
            doctorId
        );

        return;
    }

    const appointments =
        typeof opts.getAppointments === "function"
            ? opts.getAppointments()
            : getDoctorConfirmedAppointments(
                doctorId
            );

    const selection =
        parseInt(
            normalizedMessage,
            10
        );

    if (
        isNaN(selection) ||
        selection < 1 ||
        selection > appointments.length
    ) {

        sendWhatsAppReply(
            ss,
            phone,
            "❌ Invalid selection.\n\n" +
            opts.selectLine +
            "\n\n" +
            formatDoctorPatientAppointmentsListForWhatsApp(
                appointments
            ) +
            "0️⃣ Doctor Portal"
        );

        return;
    }

    opts.onChosen(
        appointments[selection - 1]
    );
}



function beginDoctorCancelFlow(
    ss,
    phone,
    doctorId
) {

    const appointments =
        getDoctorConfirmedAppointments(
            doctorId
        );

    if (appointments.length === 0) {

        returnDoctorToMenu(
            ss,
            phone,
            doctorId,
            "❌ You have no confirmed patient appointments to cancel."
        );

        return false;
    }

    saveWhatsAppSession(phone, {
        role: "DOCTOR",
        state: "DOCTOR_CANCEL_SELECT",
        doctorId: doctorId,
        date: "",
        time: "",
        appointmentId: ""
    });

    sendWhatsAppReply(
        ss,
        phone,
        buildDoctorPatientAppointmentPickerPrompt(
            "❌ Cancel Patient Appointment",
            "Select the appointment to cancel:",
            appointments
        )
    );

    return true;
}



function beginDoctorRescheduleFlow(
    ss,
    phone,
    doctorId
) {

    const appointments =
        getDoctorConfirmedAppointments(
            doctorId
        );

    if (appointments.length === 0) {

        returnDoctorToMenu(
            ss,
            phone,
            doctorId,
            "❌ You have no confirmed patient appointments to reschedule."
        );

        return false;
    }

    saveWhatsAppSession(phone, {
        role: "DOCTOR",
        state: "DOCTOR_RESCHEDULE_SELECT",
        doctorId: doctorId,
        date: "",
        time: "",
        appointmentId: ""
    });

    sendWhatsAppReply(
        ss,
        phone,
        buildDoctorPatientAppointmentPickerPrompt(
            "🔄 Reschedule Patient Appointment",
            "Select the appointment to reschedule:",
            appointments
        )
    );

    return true;
}



function beginDoctorStatusFlow(
    ss,
    phone,
    doctorId
) {

    const appointments =
        getDoctorStatusEligibleAppointments(
            doctorId
        );

    if (appointments.length === 0) {

        returnDoctorToMenu(
            ss,
            phone,
            doctorId,
            "❌ No confirmed appointments are ready to mark yet.\n\n" +
            "You can mark Completed or No-Show after the appointment time has started."
        );

        return false;
    }

    saveWhatsAppSession(phone, {
        role: "DOCTOR",
        state: "DOCTOR_STATUS_SELECT",
        doctorId: doctorId,
        date: "",
        time: "",
        appointmentId: ""
    });

    sendWhatsAppReply(
        ss,
        phone,
        buildDoctorPatientAppointmentPickerPrompt(
            "✅ Mark Visit Status",
            "Select the appointment to update:",
            appointments
        )
    );

    return true;
}



function beginDoctorRescheduleDateSelection(
    ss,
    phone,
    doctorId,
    chosen
) {

    saveWhatsAppSession(phone, {
        role: "DOCTOR",
        state: "DOCTOR_RESCHEDULE_DATE",
        doctorId: doctorId,
        appointmentId:
            chosen.appointmentId,
        patientName:
            chosen.patientName,
        date: "",
        time: ""
    });

    sendDateMenuReply(
        ss,
        phone,
        "🔄 Rescheduling " +
        chosen.patientName +
        "'s appointment (currently " +
        chosen.date +
        " " +
        chosen.time +
        ").\n\nPlease choose a new date:"
    );
}



function handleDoctorWhatsAppRescheduleTimeState(
    ss,
    senderPhone,
    session,
    normalizedMessage
) {

    handleWhatsAppSlotSelection(
        ss,
        senderPhone,
        session,
        normalizedMessage,
        {
            expiredMessage:
                "❌ Doctor session expired.\n\n" +
                "Please send Hi to open the Doctor Portal again.",
            invalidDateMessage:
                "❌ The selected date is invalid.\n\n" +
                "Please send Hi to open the Doctor Portal again.",
            onValidSlot: function (
                selectedTime,
                isoDate
            ) {
                saveWhatsAppSession(
                    senderPhone,
                    {
                        role: "DOCTOR",
                        state: "DOCTOR_RESCHEDULE_CONFIRM",
                        time: selectedTime
                    }
                );

                sendWhatsAppMenuReply(
                    ss,
                    senderPhone,
                    buildDoctorRescheduleSlotConfirmMessage(
                        session,
                        isoDate,
                        selectedTime
                    ),
                    getRescheduleConfirmSpec()
                );
            }
        }
    );
}



function beginRescheduleDateSelection(
    ss,
    phone,
    chosen
) {

    saveWhatsAppSession(phone, {
        state: "RESCHEDULE_DATE",
        appointmentId:
            chosen.appointmentId,
        doctorId:
            chosen.doctorId,
        date: "",
        time: ""
    });

    const doctorName =
        findDoctorById(
            chosen.doctorId
        ) || "Unknown Doctor";

    sendDateMenuReply(
        ss,
        phone,
        "🔄 Rescheduling appointment with " +
        doctorName +
        " (currently " +
        chosen.date +
        " " +
        chosen.time +
        ").\n\nPlease choose a new date:"
    );
}



function handleWhatsAppSlotSelection(
    ss,
    phone,
    session,
    normalizedMessage,
    options
) {

    const opts = options || {};

    if (
        !session.doctorId ||
        !session.date
    ) {

        sendWhatsAppReply(
            ss,
            phone,
            opts.expiredMessage ||
                "❌ Your session has expired.\n\n" +
                "Please send Hi to start again."
        );

        return;
    }

    const isoDate =
        String(session.date).trim();

    if (!isValidISODate(isoDate)) {

        sendWhatsAppReply(
            ss,
            phone,
            opts.invalidDateMessage ||
                "❌ The selected date is invalid.\n\n" +
                "Please send Hi to start again."
        );

        return;
    }

    const slotNumber =
        parseInt(
            normalizedMessage,
            10
        );

    const slots =
        getAvailableSlots(
            session.doctorId,
            isoDate
        );

    if (
        isNaN(slotNumber) ||
        slotNumber < 1 ||
        slotNumber > slots.length
    ) {

        sendWhatsAppReply(
            ss,
            phone,
            buildInvalidSlotSelectionReply(slots)
        );

        return;
    }

    opts.onValidSlot(
        slots[slotNumber - 1],
        isoDate,
        slots
    );
}



function handleWhatsAppAppointmentListSelection(
    ss,
    phone,
    normalizedMessage,
    options
) {

    const opts = options || {};

    if (normalizedMessage === "0") {

        saveWhatsAppSession(phone, {
            role: "PATIENT",
            state: "MAIN_MENU",
            doctorId: "",
            date: "",
            time: "",
            appointmentId: ""
        });

        sendWhatsAppReply(
            ss,
            phone,
            buildMainMenuMessage(
                "👋 Back to main menu."
            )
        );

        return;
    }

    const appointments =
        getConfirmedAppointmentsForPhone(phone);

    const selection =
        parseInt(
            normalizedMessage,
            10
        );

    const selectLine =
        opts.selectLine;

    if (
        isNaN(selection) ||
        selection < 1 ||
        selection > appointments.length
    ) {

        sendWhatsAppReply(
            ss,
            phone,
            "❌ Invalid selection.\n\n" +
            selectLine +
            "\n\n" +
            formatAppointmentsListForWhatsApp(
                appointments
            ) +
            "0️⃣ Back to Main Menu"
        );

        return;
    }

    opts.onChosen(
        appointments[selection - 1]
    );
}



function handleWhatsAppBookTimeState(
    ss,
    senderPhone,
    session,
    normalizedMessage
) {

    handleWhatsAppSlotSelection(
        ss,
        senderPhone,
        session,
        normalizedMessage,
        {
            expiredMessage:
                "❌ Your booking session has expired.\n\n" +
                "Please send Hi to start again.",
            invalidDateMessage:
                "❌ The booking date is invalid.\n\n" +
                "Please send Hi to start again.",
            onValidSlot: function (
                selectedTime
            ) {
                proceedAfterBookingSlotSelected(
                    ss,
                    senderPhone,
                    session,
                    selectedTime
                );
            }
        }
    );
}



function handleWhatsAppRescheduleTimeState(
    ss,
    senderPhone,
    session,
    normalizedMessage
) {

    handleWhatsAppSlotSelection(
        ss,
        senderPhone,
        session,
        normalizedMessage,
        {
            expiredMessage:
                "❌ Your reschedule session has expired.\n\n" +
                "Please send Hi to start again.",
            invalidDateMessage:
                "❌ The selected date is invalid.\n\n" +
                "Please send Hi to start again.",
            onValidSlot: function (
                selectedTime,
                isoDate
            ) {
                saveWhatsAppSession(
                    senderPhone,
                    {
                        state: "RESCHEDULE_CONFIRM",
                        time: selectedTime
                    }
                );

                sendWhatsAppMenuReply(
                    ss,
                    senderPhone,
                    buildRescheduleSlotConfirmMessage(
                        session,
                        isoDate,
                        selectedTime
                    ),
                    getRescheduleConfirmSpec()
                );
            }
        }
    );
}



function handleWhatsAppCancelSelectState(
    ss,
    senderPhone,
    normalizedMessage
) {

    handleWhatsAppAppointmentListSelection(
        ss,
        senderPhone,
        normalizedMessage,
        {
            title:
                "❌ Cancel Appointment",
            selectLine:
                "Select the appointment to cancel:",
            onChosen: function (chosen) {
                saveWhatsAppSession(
                    senderPhone,
                    {
                        state: "CANCEL_CONFIRM",
                        appointmentId:
                            chosen.appointmentId
                    }
                );

                sendWhatsAppMenuReply(
                    ss,
                    senderPhone,
                    buildCancelConfirmMessage(
                        chosen
                    ),
                    getYesNoConfirmSpec()
                );
            }
        }
    );
}



function handleWhatsAppRescheduleSelectState(
    ss,
    senderPhone,
    normalizedMessage
) {

    handleWhatsAppAppointmentListSelection(
        ss,
        senderPhone,
        normalizedMessage,
        {
            title:
                "🔄 Reschedule Appointment",
            selectLine:
                "Select the appointment to reschedule:",
            onChosen: function (chosen) {
                beginRescheduleDateSelection(
                    ss,
                    senderPhone,
                    chosen
                );
            }
        }
    );
}


function showDoctorAvailabilityMenu(
    ss,
    phone,
    doctorId
) {

    saveWhatsAppSession(phone, {
        role: "DOCTOR",
        state: "DOCTOR_AVAIL_MENU",
        doctorId: doctorId,
        date: "",
        time: "",
        appointmentId: ""
    });

    sendWhatsAppReply(
        ss,
        phone,
        formatDoctorAvailabilityMenu(
            doctorId
        )
    );
}


function showDoctorDayAvailabilityMenu(
    ss,
    phone,
    doctorId,
    dayName
) {

    saveWhatsAppSession(phone, {
        role: "DOCTOR",
        state: "DOCTOR_AVAIL_DAY_MENU",
        doctorId: doctorId,
        date: dayName,
        time: "",
        appointmentId: ""
    });

    sendWhatsAppReply(
        ss,
        phone,
        formatDoctorDayAvailabilityMenu(
            doctorId,
            dayName
        )
    );
}


function returnToDoctorDayAvailability(
    ss,
    phone,
    doctorId,
    dayName,
    prefix
) {

    saveWhatsAppSession(phone, {
        role: "DOCTOR",
        state: "DOCTOR_AVAIL_DAY_MENU",
        doctorId: doctorId,
        date: dayName,
        time: "",
        appointmentId: ""
    });

    const menu =
        formatDoctorDayAvailabilityMenu(
            doctorId,
            dayName
        );

    sendWhatsAppReply(
        ss,
        phone,
        prefix
            ? String(prefix) + "\n\n" + menu
            : menu
    );
}


function showDoctorLeavesMenu(
    ss,
    phone,
    doctorId
) {

    saveWhatsAppSession(phone, {
        role: "DOCTOR",
        state: "DOCTOR_LEAVE_MENU",
        doctorId: doctorId,
        date: "",
        time: "",
        appointmentId: ""
    });

    sendWhatsAppReply(
        ss,
        phone,
        formatDoctorLeavesMenu()
    );
}



function addWhatsAppNavigationOptions(session, message) {

    if (
        !session ||
        !session.state ||
        session.state === "MAIN_MENU" ||
        session.state === "DOCTOR_MENU" ||
        session.state === "LANGUAGE_SELECT" ||
        session.state === "LANGUAGE_CHANGE"
    ) {
        return message;
    }

    const options = [];
    const homeLabel =
        session.role === "DOCTOR"
            ? "0️⃣ Doctor Portal"
            : "0️⃣ Main Menu";

    if (
        String(message).indexOf("0️⃣ Back to Main Menu") === -1 &&
        String(message).indexOf("0️⃣ Doctor Portal") === -1
    ) {
        options.push(homeLabel);
    }

    options.push("9️⃣ Back");

    return String(message) +
        "\n\n" +
        options.join("\n");
}


function getISODateFromMenuChoice(normalizedMessage) {

    if (normalizedMessage === "1") {

        return Utilities.formatDate(
            new Date(),
            TIMEZONE,
            "yyyy-MM-dd"
        );
    }

    if (normalizedMessage === "2") {

        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);

        return Utilities.formatDate(
            tomorrow,
            TIMEZONE,
            "yyyy-MM-dd"
        );
    }

    return null;
}


function validateFutureISODate(typedDate) {

    if (!isValidISODate(typedDate)) {

        return {
            valid: false,
            message:
                "❌ That doesn't look like a valid date.\n\n" +
                "Please enter the date in YYYY-MM-DD format.\n\n" +
                "Example:\n" +
                "2026-08-25"
        };
    }

    const todayStart =
        new Date(
            Utilities.formatDate(
                new Date(),
                TIMEZONE,
                "yyyy-MM-dd"
            ) + "T00:00:00+05:30"
        );

    const requestedDate =
        new Date(
            typedDate + "T00:00:00+05:30"
        );

    if (
        requestedDate.getTime() <
        todayStart.getTime()
    ) {

        return {
            valid: false,
            message:
                "❌ That date is in the past.\n\n" +
                "Please enter a valid future date (YYYY-MM-DD)."
        };
    }

    return {
        valid: true,
        date: typedDate
    };
}



function handleWhatsAppDateMenuInput(
    ss,
    phone,
    doctorId,
    normalizedMessage,
    nextSlotState,
    customDateState,
    isReschedule
) {

    const selectedDate =
        getISODateFromMenuChoice(
            normalizedMessage
        );

    if (selectedDate) {

        whatsAppShowSlotsForDate(
            ss,
            phone,
            doctorId,
            selectedDate,
            nextSlotState
        );

        return;
    }

    if (normalizedMessage === "3") {

        saveWhatsAppSession(
            phone,
            { state: customDateState }
        );

        sendWhatsAppReply(
            ss,
            phone,
            buildCustomDateEntryPrompt(isReschedule)
        );

        return;
    }

    sendWhatsAppReply(
        ss,
        phone,
        buildInvalidDateMenuReply()
    );
}



function handleWhatsAppCustomDateInput(
    ss,
    phone,
    doctorId,
    messageText,
    nextSlotState
) {

    const validation =
        validateFutureISODate(
            messageText.trim()
        );

    if (!validation.valid) {

        sendWhatsAppReply(
            ss,
            phone,
            validation.message
        );

        return;
    }

    whatsAppShowSlotsForDate(
        ss,
        phone,
        doctorId,
        validation.date,
        nextSlotState
    );
}



function requireDoctorId(ss, phone, session) {

    const doctorId =
        resolveDoctorIdFromSession(
            phone,
            session
        );

    if (!doctorId) {

        sendWhatsAppReply(
            ss,
            phone,
            "❌ Doctor session expired.\n\n" +
            "Please send Hi to start again."
        );

        return null;
    }

    return doctorId;
}



function showBookingDateSelection(ss, phone) {

    sendDateMenuReply(
        ss,
        phone,
        "Please choose a date:"
    );
}



function showRescheduleDateSelection(ss, phone) {

    sendDateMenuReply(
        ss,
        phone,
        "Please choose a new date:"
    );
}



function showDoctorDateSelection(ss, phone) {

    sendDateMenuReply(
        ss,
        phone,
        "Please choose a date:"
    );
}



function resolveDoctorIdFromSession(phone, session) {

    if (
        session &&
        session.doctorId
    ) {
        return String(session.doctorId).trim();
    }

    const doctor =
        findDoctorByWhatsAppPhone(phone);

    return doctor
        ? doctor.doctorId
        : "";
}



function returnDoctorToDateSelection(ss, phone, doctorId) {

    saveWhatsAppSession(
        phone,
        {
            role: "DOCTOR",
            state: "DOCTOR_DATE",
            doctorId: doctorId,
            date: "",
            time: "",
            appointmentId: ""
        }
    );

    showDoctorDateSelection(ss, phone);
}



function showDoctorScheduleForDateAndReturn(
    ss,
    phone,
    doctorId,
    isoDate
) {

    returnDoctorToMenu(
        ss,
        phone,
        doctorId,
        formatDoctorSchedule(
            getDoctorScheduleForDate(
                doctorId,
                isoDate
            ),
            "Schedule for " + isoDate
        )
    );
}



function returnToMainMenu(ss, phone, prefix) {

    saveWhatsAppSession(
        phone,
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
        phone,
        prefix || "👋 Back to main menu."
    );
}



function returnDoctorToMenu(ss, phone, doctorId, prefix) {

    const doctorName =
        findDoctorById(doctorId) || "";

    saveWhatsAppSession(
        phone,
        {
            role: "DOCTOR",
            state: "DOCTOR_MENU",
            doctorId: doctorId,
            date: "",
            time: "",
            appointmentId: ""
        }
    );

    sendDoctorMainMenuReply(
        ss,
        phone,
        doctorId,
        prefix
    );
}



function goBackInWhatsAppFlow(ss, phone, session) {

    switch (session.state) {

        case "BOOK_DOCTOR":
            returnToMainMenu(ss, phone);
            return;

        case "BOOK_DATE":
            saveWhatsAppSession(phone, {
                state: "BOOK_DOCTOR",
                doctorId: ""
            });
            sendDoctorSelectionReply(
                ss,
                phone
            );
            return;

        case "BOOK_DATE_CUSTOM":
        case "BOOK_TIME":
            saveWhatsAppSession(phone, {
                state: "BOOK_DATE",
                date: "",
                time: ""
            });
            showBookingDateSelection(ss, phone);
            return;

        case "BOOK_NAME":
            if (session.doctorId && session.date) {
                whatsAppShowSlotsForDate(
                    ss,
                    phone,
                    session.doctorId,
                    session.date,
                    "BOOK_TIME"
                );
                return;
            }
            returnToMainMenu(ss, phone);
            return;

        case "BOOK_CONFIRM":
            if (session.doctorId && session.date) {
                whatsAppShowSlotsForDate(
                    ss,
                    phone,
                    session.doctorId,
                    session.date,
                    "BOOK_TIME"
                );
                return;
            }
            returnToMainMenu(ss, phone);
            return;

        case "CANCEL_CONFIRM":
            saveWhatsAppSession(phone, {
                state: "CANCEL_SELECT",
                appointmentId: ""
            });
            sendWhatsAppReply(
                ss,
                phone,
                buildAppointmentPickerPrompt(
                    "❌ Cancel Appointment",
                    "Select the appointment to cancel:",
                    getConfirmedAppointmentsForPhone(phone)
                )
            );
            return;

        case "RESCHEDULE_DATE":
            saveWhatsAppSession(phone, {
                state: "RESCHEDULE_SELECT",
                appointmentId: "",
                doctorId: "",
                date: "",
                time: ""
            });
            sendWhatsAppReply(
                ss,
                phone,
                buildAppointmentPickerPrompt(
                    "🔄 Reschedule Appointment",
                    "Select the appointment to reschedule:",
                    getConfirmedAppointmentsForPhone(phone)
                )
            );
            return;

        case "RESCHEDULE_DATE_CUSTOM":
        case "RESCHEDULE_TIME":
            saveWhatsAppSession(phone, {
                state: "RESCHEDULE_DATE",
                date: "",
                time: ""
            });
            showRescheduleDateSelection(ss, phone);
            return;

        case "RESCHEDULE_CONFIRM":
            if (session.doctorId && session.date) {
                whatsAppShowSlotsForDate(
                    ss,
                    phone,
                    session.doctorId,
                    session.date,
                    "RESCHEDULE_TIME"
                );
                return;
            }
            returnToMainMenu(ss, phone);
            return;

        default:
            returnToMainMenu(ss, phone);
    }
}



function goBackInDoctorWhatsAppFlow(
    ss,
    phone,
    session
) {

    const doctorId =
        resolveDoctorIdFromSession(
            phone,
            session
        );

    switch (session.state) {

        case "DOCTOR_DATE":
        case "DOCTOR_DATE_CUSTOM":
            returnDoctorToMenu(
                ss,
                phone,
                doctorId
            );
            return;

        case "DOCTOR_AVAIL_MENU":
            returnDoctorToMenu(
                ss,
                phone,
                doctorId
            );
            return;

        case "DOCTOR_AVAIL_DAY_MENU":
            showDoctorAvailabilityMenu(
                ss,
                phone,
                doctorId
            );
            return;

        case "DOCTOR_AVAIL_REMOVE":
            returnToDoctorDayAvailability(
                ss,
                phone,
                doctorId,
                session.date
            );
            return;

        case "DOCTOR_AVAIL_START":
            returnToDoctorDayAvailability(
                ss,
                phone,
                doctorId,
                session.date
            );
            return;

        case "DOCTOR_AVAIL_END":
            saveWhatsAppSession(phone, {
                role: "DOCTOR",
                state: "DOCTOR_AVAIL_START",
                doctorId: doctorId,
                date: session.date,
                time: "",
                appointmentId: ""
            });
            sendWhatsAppReply(
                ss,
                phone,
                "🕐 Enter start time for " +
                session.date +
                " (Example: 10:00 AM):"
            );
            return;

        case "DOCTOR_AVAIL_CONFIRM":
            saveWhatsAppSession(phone, {
                role: "DOCTOR",
                state: "DOCTOR_AVAIL_END",
                doctorId: doctorId,
                date: session.date,
                time: session.time,
                appointmentId: ""
            });
            sendWhatsAppReply(
                ss,
                phone,
                "🕐 Enter end time for " +
                session.date +
                " (Example: 2:00 PM):"
            );
            return;

        case "DOCTOR_LEAVE_MENU":
            returnDoctorToMenu(
                ss,
                phone,
                doctorId
            );
            return;

        case "DOCTOR_CANCEL_SELECT":
        case "DOCTOR_CANCEL_CONFIRM":
            beginDoctorCancelFlow(
                ss,
                phone,
                doctorId
            );
            return;

        case "DOCTOR_RESCHEDULE_SELECT":
            beginDoctorRescheduleFlow(
                ss,
                phone,
                doctorId
            );
            return;

        case "DOCTOR_STATUS_SELECT":
        case "DOCTOR_STATUS_ACTION":
            beginDoctorStatusFlow(
                ss,
                phone,
                doctorId
            );
            return;

        case "DOCTOR_RESCHEDULE_DATE":
        case "DOCTOR_RESCHEDULE_DATE_CUSTOM":
            saveWhatsAppSession(phone, {
                role: "DOCTOR",
                state: "DOCTOR_RESCHEDULE_SELECT",
                doctorId: doctorId,
                appointmentId: "",
                patientName: "",
                date: "",
                time: ""
            });
            sendWhatsAppReply(
                ss,
                phone,
                buildDoctorPatientAppointmentPickerPrompt(
                    "🔄 Reschedule Patient Appointment",
                    "Select the appointment to reschedule:",
                    getDoctorConfirmedAppointments(
                        doctorId
                    )
                )
            );
            return;

        case "DOCTOR_RESCHEDULE_TIME":
            saveWhatsAppSession(phone, {
                role: "DOCTOR",
                state: "DOCTOR_RESCHEDULE_DATE",
                date: "",
                time: ""
            });
            sendWhatsAppReply(
                ss,
                phone,
                buildDateMenuPrompt(
                    "Please choose a new date:"
                )
            );
            return;

        case "DOCTOR_RESCHEDULE_CONFIRM":
            if (
                session.doctorId &&
                session.date
            ) {
                whatsAppShowSlotsForDate(
                    ss,
                    phone,
                    session.doctorId,
                    session.date,
                    "DOCTOR_RESCHEDULE_TIME"
                );
                return;
            }
            returnDoctorToMenu(
                ss,
                phone,
                doctorId
            );
            return;

        case "DOCTOR_LEAVE_DATE":
        case "DOCTOR_LEAVE_LIST":
            showDoctorLeavesMenu(
                ss,
                phone,
                doctorId
            );
            return;

        case "DOCTOR_LEAVE_REASON":
            saveWhatsAppSession(phone, {
                role: "DOCTOR",
                state: "DOCTOR_LEAVE_DATE",
                doctorId: doctorId,
                date: "",
                time: "",
                appointmentId: ""
            });
            sendWhatsAppReply(
                ss,
                phone,
                "📅 Enter leave date (YYYY-MM-DD):\n\n" +
                "Example:\n2026-08-25"
            );
            return;

        case "DOCTOR_LEAVE_CONFIRM":
            saveWhatsAppSession(phone, {
                role: "DOCTOR",
                state: "DOCTOR_LEAVE_REASON",
                doctorId: doctorId,
                date: session.date,
                time: "",
                appointmentId: ""
            });
            sendWhatsAppReply(
                ss,
                phone,
                "📝 Enter reason for leave (optional).\n\n" +
                "Reply with text or send - to skip."
            );
            return;

        case "DOCTOR_LEAVE_CANCEL_PICK":
            showDoctorLeavesMenu(
                ss,
                phone,
                doctorId
            );
            return;

        case "DOCTOR_LEAVE_RANGE_START":
            showDoctorLeavesMenu(
                ss,
                phone,
                doctorId
            );
            return;

        case "DOCTOR_LEAVE_RANGE_END":
            saveWhatsAppSession(phone, {
                role: "DOCTOR",
                state: "DOCTOR_LEAVE_RANGE_START",
                doctorId: doctorId,
                date: "",
                time: "",
                appointmentId: ""
            });
            sendWhatsAppReply(
                ss,
                phone,
                "📅 Enter range start date (YYYY-MM-DD):"
            );
            return;

        case "DOCTOR_LEAVE_RANGE_REASON":
            saveWhatsAppSession(phone, {
                role: "DOCTOR",
                state: "DOCTOR_LEAVE_RANGE_END",
                doctorId: doctorId,
                date: session.date,
                time: "",
                appointmentId: ""
            });
            sendWhatsAppReply(
                ss,
                phone,
                "📅 Enter range end date (YYYY-MM-DD):"
            );
            return;

        case "DOCTOR_LEAVE_RANGE_CONFIRM":
            saveWhatsAppSession(phone, {
                role: "DOCTOR",
                state: "DOCTOR_LEAVE_RANGE_REASON",
                doctorId: doctorId,
                date: session.date,
                time: session.time,
                appointmentId: ""
            });
            sendWhatsAppReply(
                ss,
                phone,
                "📝 Enter reason for leave range (optional).\n\n" +
                "Reply with text or send - to skip."
            );
            return;

        default:
            returnDoctorToMenu(
                ss,
                phone,
                doctorId
            );
    }
}



function proceedAfterBookingSlotSelected(
    ss,
    senderPhone,
    session,
    selectedTime
) {

    if (patientNeedsNameCapture(senderPhone)) {

        saveWhatsAppSession(
            senderPhone,
            {
                state: "BOOK_NAME",
                time: selectedTime
            }
        );

        sendWhatsAppReply(
            ss,
            senderPhone,
            buildBookNamePrompt()
        );

        return;
    }

    const knownName =
        resolveKnownPatientName(senderPhone);

    ensurePatientRecordFromHistory(
        senderPhone,
        session.language || "EN"
    );

    saveWhatsAppSession(
        senderPhone,
        {
            state: "BOOK_CONFIRM",
            time: selectedTime,
            patientName: knownName
        }
    );

    sendWhatsAppMenuReply(
        ss,
        senderPhone,
        buildBookingConfirmationMessage(
            Object.assign({}, session, {
                time: selectedTime
            }),
            knownName
        ),
        getBookingConfirmSpec()
    );
}



// ------------------------------------------------------------
// Shows available slots for a date and moves the session into
// the given "time selection" state. Returns true if slots were
// found and shown, false if no slots were available (in which
// case an error reply has already been sent).
// ------------------------------------------------------------

function whatsAppShowSlotsForDate(
    ss,
    senderPhone,
    doctorId,
    selectedDate,
    nextState
) {

    const slots =
        getAvailableSlots(
            doctorId,
            selectedDate
        );

    if (
        !slots ||
        slots.length === 0
    ) {

        sendWhatsAppReply(
            ss,
            senderPhone,
            "❌ Sorry, there are no available slots on " +
            selectedDate +
            ".\n\n" +
            "Please choose another date."
        );

        return false;
    }

    saveWhatsAppSession(
        senderPhone,
        {
            state: nextState,
            date: selectedDate
        }
    );

    sendWhatsAppMenuReply(
        ss,
        senderPhone,
        "📅 Date selected: " +
        selectedDate +
        "\n\nAvailable slots:\nPlease choose a time.",
        getSlotSelectionMenuSpec(slots)
    );

    return true;
}
