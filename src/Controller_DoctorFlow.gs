// ============================================================
// Controller_DoctorFlow — part of the ABC Clinic WhatsApp bot
// Doctor-portal conversation state machine (handleWhatsAppDoctorMessage).
// See src/Config.gs for the full file-layout map and Script Properties.
// ============================================================


function handleWhatsAppDoctorMessage(
    ss,
    senderPhone,
    senderName,
    messageText,
    normalizedMessage,
    session
) {

    if (
        !session ||
        session.role !== "DOCTOR"
    ) {
        return false;
    }

// DOCTOR MENU
// ======================================================

if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_MENU"
) {

    const doctorId =
        requireDoctorId(
            ss,
            senderPhone,
            session
        );

    if (!doctorId) {

        return true;

    } else if (
        normalizedMessage === "0" ||
        normalizedMessage === "9"
    ) {

        returnDoctorToMenu(
            ss,
            senderPhone,
            doctorId
        );

    } else if (normalizedMessage === "1") {

        returnDoctorToMenu(
            ss,
            senderPhone,
            doctorId,
            formatDoctorSchedule(
                getDoctorTodaySchedule(
                    doctorId
                ),
                "Today's Schedule"
            )
        );

    } else if (normalizedMessage === "2") {

        returnDoctorToMenu(
            ss,
            senderPhone,
            doctorId,
            formatDoctorNext(
                getDoctorNextAppointment(
                    doctorId
                )
            )
        );

    } else if (normalizedMessage === "3") {

        returnDoctorToMenu(
            ss,
            senderPhone,
            doctorId,
            formatDoctorWeek(
                getDoctorWeeklySchedule(
                    doctorId
                )
            )
        );

    } else if (normalizedMessage === "4") {

        saveWhatsAppSession(
            senderPhone,
            {
                role: "DOCTOR",
                state: "DOCTOR_DATE",
                doctorId: doctorId,
                date: "",
                time: "",
                appointmentId: ""
            }
        );

        showDoctorDateSelection(
            ss,
            senderPhone
        );

    } else if (normalizedMessage === "5") {

        showDoctorAvailabilityMenu(
            ss,
            senderPhone,
            doctorId
        );

    } else if (normalizedMessage === "6") {

        showDoctorLeavesMenu(
            ss,
            senderPhone,
            doctorId
        );

    } else if (normalizedMessage === "7") {

        returnDoctorToMenu(
            ss,
            senderPhone,
            doctorId,
            formatDoctorPatientsList(
                doctorId
            )
        );

    } else if (normalizedMessage === "8") {

        beginDoctorCancelFlow(
            ss,
            senderPhone,
            doctorId
        );

    } else if (normalizedMessage === "9") {

        beginDoctorRescheduleFlow(
            ss,
            senderPhone,
            doctorId
        );

    } else if (normalizedMessage === "10") {

        beginDoctorStatusFlow(
            ss,
            senderPhone,
            doctorId
        );

    } else {

        returnDoctorToMenu(
            ss,
            senderPhone,
            doctorId,
            "❌ Invalid option. Please choose 1, 2, 3, 4, 5, 6, 7, 8, 9, or 10."
        );
    }
    return true;
}


// ======================================================
// DOCTOR — MANAGE AVAILABILITY
// ======================================================

if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_AVAIL_MENU"
) {

    const doctorId =
        requireDoctorId(
            ss,
            senderPhone,
            session
        );

    if (!doctorId) {
        return true;
    }

    const dayName =
        doctorWeekdayIndexToName(
            normalizedMessage
        );

    if (dayName) {

        showDoctorDayAvailabilityMenu(
            ss,
            senderPhone,
            doctorId,
            dayName
        );

    } else {

        sendWhatsAppReply(
            ss,
            senderPhone,
            "❌ Invalid day.\n\n" +
            formatDoctorAvailabilityMenu(
                doctorId
            )
        );
    }

    return true;
}

if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_AVAIL_DAY_MENU"
) {

    const doctorId =
        requireDoctorId(
            ss,
            senderPhone,
            session
        );

    const dayName =
        session.date;

    if (
        !doctorId ||
        !dayName
    ) {
        return true;
    }

    if (normalizedMessage === "1") {

        saveWhatsAppSession(
            senderPhone,
            {
                role: "DOCTOR",
                state: "DOCTOR_AVAIL_START",
                doctorId: doctorId,
                date: dayName,
                time: "",
                appointmentId: ""
            }
        );

        sendWhatsAppReply(
            ss,
            senderPhone,
            "🕐 Enter start time for " +
            dayName +
            " (Example: 10:00 AM):"
        );

    } else if (normalizedMessage === "2") {

        const sessions =
            getDoctorDayAvailabilitySessions(
                doctorId,
                dayName
            );

        if (sessions.length === 0) {

            returnToDoctorDayAvailability(
                ss,
                senderPhone,
                doctorId,
                dayName,
                "❌ No sessions to remove."
            );

        } else {

            saveWhatsAppSession(
                senderPhone,
                {
                    role: "DOCTOR",
                    state: "DOCTOR_AVAIL_REMOVE",
                    doctorId: doctorId,
                    date: dayName,
                    time: "",
                    appointmentId: ""
                }
            );

            sendWhatsAppReply(
                ss,
                senderPhone,
                "Select session to remove:\n\n" +
                formatDoctorDayAvailabilityMenu(
                    doctorId,
                    dayName
                )
            );
        }

    } else if (normalizedMessage === "3") {

        const result =
            clearDoctorDayAvailability(
                doctorId,
                dayName
            );

        returnToDoctorDayAvailability(
            ss,
            senderPhone,
            doctorId,
            dayName,
            (result.success ? "✅ " : "❌ ") +
            result.message
        );

    } else {

        returnToDoctorDayAvailability(
            ss,
            senderPhone,
            doctorId,
            dayName,
            "❌ Invalid option."
        );
    }

    return true;
}

if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_AVAIL_REMOVE"
) {

    const doctorId =
        requireDoctorId(
            ss,
            senderPhone,
            session
        );

    const dayName =
        session.date;

    if (
        !doctorId ||
        !dayName
    ) {
        return true;
    }

    const pick =
        Number(normalizedMessage);

    if (!Number.isInteger(pick) || pick < 1) {

        returnToDoctorDayAvailability(
            ss,
            senderPhone,
            doctorId,
            dayName,
            "❌ Invalid selection."
        );

        return true;
    }

    const result =
        removeDoctorAvailabilitySession(
            doctorId,
            dayName,
            pick
        );

    returnToDoctorDayAvailability(
        ss,
        senderPhone,
        doctorId,
        dayName,
        (result.success ? "✅ " : "❌ ") +
        result.message
    );

    return true;
}

if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_AVAIL_START"
) {

    const doctorId =
        requireDoctorId(
            ss,
            senderPhone,
            session
        );

    const dayName =
        session.date;

    if (
        !doctorId ||
        !dayName
    ) {
        return true;
    }

    const startTime =
        normalizeAvailabilityTimeInput(
            messageText.trim()
        );

    if (!startTime) {

        sendWhatsAppReply(
            ss,
            senderPhone,
            "❌ Invalid time format.\n\n" +
            "Example: 10:00 AM"
        );

        return true;
    }

    saveWhatsAppSession(
        senderPhone,
        {
            role: "DOCTOR",
            state: "DOCTOR_AVAIL_END",
            doctorId: doctorId,
            date: dayName,
            time: startTime,
            appointmentId: ""
        }
    );

    sendWhatsAppReply(
        ss,
        senderPhone,
        "🕐 Enter end time for " +
        dayName +
        " (Example: 2:00 PM):"
    );

    return true;
}

if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_AVAIL_END"
) {

    const doctorId =
        requireDoctorId(
            ss,
            senderPhone,
            session
        );

    const dayName =
        session.date;

    const startTime =
        session.time;

    if (
        !doctorId ||
        !dayName ||
        !startTime
    ) {
        return true;
    }

    const endTime =
        normalizeAvailabilityTimeInput(
            messageText.trim()
        );

    if (!endTime) {

        sendWhatsAppReply(
            ss,
            senderPhone,
            "❌ Invalid time format.\n\n" +
            "Example: 2:00 PM"
        );

        return true;
    }

    saveWhatsAppSession(
        senderPhone,
        {
            role: "DOCTOR",
            state: "DOCTOR_AVAIL_CONFIRM",
            doctorId: doctorId,
            date: dayName,
            time: startTime,
            appointmentId: endTime
        }
    );

    sendWhatsAppReply(
        ss,
        senderPhone,
        "Please confirm new session:\n\n" +
        "📅 " + dayName + "\n" +
        "🕐 " + startTime + " - " + endTime + "\n\n" +
        "1️⃣ Confirm\n" +
        "2️⃣ Cancel"
    );

    return true;
}

if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_AVAIL_CONFIRM"
) {

    const doctorId =
        requireDoctorId(
            ss,
            senderPhone,
            session
        );

    const dayName =
        session.date;

    const startTime =
        session.time;

    const endTime =
        session.appointmentId;

    if (
        !doctorId ||
        !dayName ||
        !startTime ||
        !endTime
    ) {
        return true;
    }

    if (normalizedMessage === "1") {

        const result =
            addDoctorAvailabilitySession(
                doctorId,
                dayName,
                startTime,
                endTime
            );

        returnToDoctorDayAvailability(
            ss,
            senderPhone,
            doctorId,
            dayName,
            (result.success ? "✅ " : "❌ ") +
            result.message
        );

    } else if (normalizedMessage === "2") {

        returnToDoctorDayAvailability(
            ss,
            senderPhone,
            doctorId,
            dayName,
            "❌ Session not saved."
        );

    } else {

        sendWhatsAppReply(
            ss,
            senderPhone,
            "❌ Invalid option.\n\n" +
            "1️⃣ Confirm\n" +
            "2️⃣ Cancel"
        );
    }
    return true;
}


// ======================================================
// DOCTOR — CANCEL / RESCHEDULE PATIENT APPOINTMENTS
// ======================================================

if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_CANCEL_SELECT"
) {

    const doctorId =
        requireDoctorId(
            ss,
            senderPhone,
            session
        );

    if (!doctorId) {
        return true;
    }

    handleDoctorWhatsAppAppointmentListSelection(
        ss,
        senderPhone,
        session,
        normalizedMessage,
        {
            selectLine:
                "Select the appointment to cancel:",
            onChosen: function (chosen) {

                saveWhatsAppSession(
                    senderPhone,
                    {
                        role: "DOCTOR",
                        state: "DOCTOR_CANCEL_CONFIRM",
                        doctorId: doctorId,
                        appointmentId:
                            chosen.appointmentId,
                        patientName:
                            chosen.patientName
                    }
                );

                sendWhatsAppMenuReply(
                    ss,
                    senderPhone,
                    buildDoctorCancelConfirmMessage(
                        chosen
                    ),
                    getYesNoConfirmSpec()
                );
            }
        }
    );

    return true;
}


if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_CANCEL_CONFIRM"
) {

    const doctorId =
        requireDoctorId(
            ss,
            senderPhone,
            session
        );

    if (!doctorId) {
        return true;
    }

    if (normalizedMessage === "1") {

        const appointments =
            getDoctorConfirmedAppointments(
                doctorId
            );

        let chosen = null;

        appointments.forEach(
            function (appt) {

                if (
                    appt.appointmentId ===
                    session.appointmentId
                ) {
                    chosen = appt;
                }
            }
        );

        const result =
            cancelAppointment(
                session.appointmentId,
                "",
                {
                    authorizedDoctorId:
                        doctorId
                }
            );

        if (
            result &&
            result.success
        ) {

            if (chosen) {
                notifyPatientOfDoctorCancellation(
                    chosen
                );
            }

            returnDoctorToMenu(
                ss,
                senderPhone,
                doctorId,
                "✅ " + result.message
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

        returnDoctorToMenu(
            ss,
            senderPhone,
            doctorId,
            "👍 Okay, appointment was not cancelled."
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


if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_STATUS_SELECT"
) {

    const doctorId =
        requireDoctorId(
            ss,
            senderPhone,
            session
        );

    if (!doctorId) {
        return true;
    }

    handleDoctorWhatsAppAppointmentListSelection(
        ss,
        senderPhone,
        session,
        normalizedMessage,
        {
            selectLine:
                "Select the appointment to update:",
            getAppointments: function () {
                return getDoctorStatusEligibleAppointments(
                    doctorId
                );
            },
            onChosen: function (chosen) {

                saveWhatsAppSession(
                    senderPhone,
                    {
                        role: "DOCTOR",
                        state: "DOCTOR_STATUS_ACTION",
                        doctorId: doctorId,
                        appointmentId:
                            chosen.appointmentId,
                        patientName:
                            chosen.patientName,
                        date: chosen.date,
                        time: chosen.time
                    }
                );

                sendWhatsAppMenuReply(
                    ss,
                    senderPhone,
                    buildDoctorStatusActionMessage(
                        chosen
                    ),
                    getDoctorStatusActionSpec()
                );
            }
        }
    );

    return true;
}


if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_STATUS_ACTION"
) {

    const doctorId =
        requireDoctorId(
            ss,
            senderPhone,
            session
        );

    if (!doctorId) {
        return true;
    }

    if (normalizedMessage === "0") {

        returnDoctorToMenu(
            ss,
            senderPhone,
            doctorId
        );

        return true;
    }

    let targetStatus = "";

    if (normalizedMessage === "1") {
        targetStatus =
            APPOINTMENT_STATUS.COMPLETED;
    } else if (normalizedMessage === "2") {
        targetStatus =
            APPOINTMENT_STATUS.NO_SHOW;
    } else {

        sendWhatsAppMenuReply(
            ss,
            senderPhone,
            "❌ Invalid option.\n\n" +
            "1️⃣ Completed\n" +
            "2️⃣ No-Show",
            getDoctorStatusActionSpec()
        );

        return true;
    }

    const result =
        updateAppointmentStatus(
            session.appointmentId,
            targetStatus,
            {
                authorizedDoctorId:
                    doctorId
            }
        );

    if (
        result &&
        result.success
    ) {

        returnDoctorToMenu(
            ss,
            senderPhone,
            doctorId,
            "✅ " + result.message
        );

    } else {

        const errorMessage =
            result && result.message
                ? result.message
                : "Unable to update appointment status.";

        sendWhatsAppMenuReply(
            ss,
            senderPhone,
            "❌ " + errorMessage + "\n\n" +
            "1️⃣ Completed\n" +
            "2️⃣ No-Show",
            getDoctorStatusActionSpec()
        );
    }

    return true;
}


if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_RESCHEDULE_SELECT"
) {

    const doctorId =
        requireDoctorId(
            ss,
            senderPhone,
            session
        );

    if (!doctorId) {
        return true;
    }

    handleDoctorWhatsAppAppointmentListSelection(
        ss,
        senderPhone,
        session,
        normalizedMessage,
        {
            selectLine:
                "Select the appointment to reschedule:",
            onChosen: function (chosen) {

                beginDoctorRescheduleDateSelection(
                    ss,
                    senderPhone,
                    doctorId,
                    chosen
                );
            }
        }
    );

    return true;
}


if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_RESCHEDULE_DATE"
) {

    handleWhatsAppDateMenuInput(
        ss,
        senderPhone,
        session.doctorId,
        normalizedMessage,
        "DOCTOR_RESCHEDULE_TIME",
        "DOCTOR_RESCHEDULE_DATE_CUSTOM",
        true
    );

    return true;
}


if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_RESCHEDULE_DATE_CUSTOM"
) {

    handleWhatsAppCustomDateInput(
        ss,
        senderPhone,
        session.doctorId,
        messageText,
        "DOCTOR_RESCHEDULE_TIME"
    );

    return true;
}


if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_RESCHEDULE_TIME"
) {

    handleDoctorWhatsAppRescheduleTimeState(
        ss,
        senderPhone,
        session,
        normalizedMessage
    );

    return true;
}


if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_RESCHEDULE_CONFIRM"
) {

    const doctorId =
        requireDoctorId(
            ss,
            senderPhone,
            session
        );

    if (!doctorId) {
        return true;
    }

    if (normalizedMessage === "1") {

        if (
            !session.appointmentId ||
            !session.date ||
            !session.time
        ) {

            returnDoctorToMenu(
                ss,
                senderPhone,
                doctorId,
                "❌ Doctor session expired.\n\n" +
                "Please send Hi to open the Doctor Portal again."
            );

            return true;
        }

        const appointments =
            getDoctorConfirmedAppointments(
                doctorId
            );

        let chosen = null;

        appointments.forEach(
            function (appt) {

                if (
                    appt.appointmentId ===
                    session.appointmentId
                ) {
                    chosen = appt;
                }
            }
        );

        const result =
            rescheduleAppointment(
                session.appointmentId,
                "",
                session.date,
                session.time,
                {
                    authorizedDoctorId:
                        doctorId
                }
            );

        if (
            result &&
            result.success
        ) {

            if (chosen) {
                notifyPatientOfDoctorReschedule(
                    chosen,
                    result
                );
            }

            returnDoctorToMenu(
                ss,
                senderPhone,
                doctorId,
                "✅ Appointment rescheduled!\n\n" +
                "👤 Patient: " +
                (
                    session.patientName ||
                    chosen &&
                    chosen.patientName ||
                    ""
                ) +
                "\n" +
                "🆔 Appointment ID: " +
                result.appointmentId +
                "\n" +
                "📅 New Date: " +
                result.date +
                "\n" +
                "🕐 New Time: " +
                result.time
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

    } else if (normalizedMessage === "2") {

        if (
            !session.doctorId ||
            !session.date
        ) {

            returnDoctorToMenu(
                ss,
                senderPhone,
                doctorId,
                "❌ Doctor session expired.\n\n" +
                "Please send Hi to open the Doctor Portal again."
            );

            return true;
        }

        whatsAppShowSlotsForDate(
            ss,
            senderPhone,
            session.doctorId,
            session.date,
            "DOCTOR_RESCHEDULE_TIME"
        );

    } else if (normalizedMessage === "3") {

        returnDoctorToMenu(
            ss,
            senderPhone,
            doctorId,
            "❌ Reschedule cancelled."
        );

    } else {

        sendWhatsAppReply(
            ss,
            senderPhone,
            "❌ Invalid option.\n\n" +
            "1️⃣ Confirm\n" +
            "2️⃣ Choose another time\n" +
            "3️⃣ Cancel"
        );
    }

    return true;
}


// ======================================================
// DOCTOR — MANAGE LEAVES
// ======================================================

if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_LEAVE_MENU"
) {

    const doctorId =
        requireDoctorId(
            ss,
            senderPhone,
            session
        );

    if (!doctorId) {
        return true;
    }

    if (normalizedMessage === "1") {

        saveWhatsAppSession(
            senderPhone,
            {
                role: "DOCTOR",
                state: "DOCTOR_LEAVE_DATE",
                doctorId: doctorId,
                date: "",
                time: "",
                appointmentId: ""
            }
        );

        sendWhatsAppReply(
            ss,
            senderPhone,
            "📅 Enter leave date (YYYY-MM-DD):\n\n" +
            "Example:\n2026-08-25"
        );

    } else if (normalizedMessage === "2") {

        saveWhatsAppSession(
            senderPhone,
            {
                role: "DOCTOR",
                state: "DOCTOR_LEAVE_LIST",
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
            formatDoctorUpcomingLeaves(
                doctorId
            )
        );

    } else if (normalizedMessage === "3") {

        const leaves =
            getDoctorUpcomingLeaves(
                doctorId
            );

        if (leaves.length === 0) {

            returnDoctorToMenu(
                ss,
                senderPhone,
                doctorId,
                "No upcoming leaves to cancel."
            );

        } else {

            saveWhatsAppSession(
                senderPhone,
                {
                    role: "DOCTOR",
                    state: "DOCTOR_LEAVE_CANCEL_PICK",
                    doctorId: doctorId,
                    date: "",
                    time: "",
                    appointmentId: ""
                }
            );

            sendWhatsAppReply(
                ss,
                senderPhone,
                "Select leave to cancel:\n\n" +
                formatDoctorUpcomingLeaves(
                    doctorId
                )
            );
        }

    } else if (normalizedMessage === "4") {

        saveWhatsAppSession(
            senderPhone,
            {
                role: "DOCTOR",
                state: "DOCTOR_LEAVE_RANGE_START",
                doctorId: doctorId,
                date: "",
                time: "",
                appointmentId: ""
            }
        );

        sendWhatsAppReply(
            ss,
            senderPhone,
            "📅 Enter range start date (YYYY-MM-DD):"
        );

    } else {

        sendWhatsAppReply(
            ss,
            senderPhone,
            "❌ Invalid option.\n\n" +
            formatDoctorLeavesMenu()
        );
    }

    return true;
}

if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_LEAVE_DATE"
) {

    const doctorId =
        requireDoctorId(
            ss,
            senderPhone,
            session
        );

    const leaveDate =
        messageText.trim();

    if (!doctorId) {
        return true;
    }

    if (!isValidISODate(leaveDate)) {

        sendWhatsAppReply(
            ss,
            senderPhone,
            "❌ Invalid date.\n\n" +
            "Use YYYY-MM-DD format."
        );

        return true;
    }

    saveWhatsAppSession(
        senderPhone,
        {
            role: "DOCTOR",
            state: "DOCTOR_LEAVE_REASON",
            doctorId: doctorId,
            date: leaveDate,
            time: "",
            appointmentId: ""
        }
    );

    sendWhatsAppReply(
        ss,
        senderPhone,
        "📝 Enter reason for leave (optional).\n\n" +
        "Reply with text or send - to skip."
    );

    return true;
}

if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_LEAVE_REASON"
) {

    const doctorId =
        requireDoctorId(
            ss,
            senderPhone,
            session
        );

    const leaveDate =
        session.date;

    if (
        !doctorId ||
        !leaveDate
    ) {
        return true;
    }

    const reason =
        normalizedMessage === "-"
            ? ""
            : messageText.trim();

    saveWhatsAppSession(
        senderPhone,
        {
            role: "DOCTOR",
            state: "DOCTOR_LEAVE_CONFIRM",
            doctorId: doctorId,
            date: leaveDate,
            time: reason,
            appointmentId: ""
        }
    );

    sendWhatsAppReply(
        ss,
        senderPhone,
        "Confirm leave:\n\n" +
        "📅 " + leaveDate + "\n" +
        (
            reason
                ? "📝 " + reason + "\n"
                : ""
        ) +
        "\n1️⃣ Confirm\n" +
        "2️⃣ Cancel"
    );

    return true;
}

if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_LEAVE_CONFIRM"
) {

    const doctorId =
        requireDoctorId(
            ss,
            senderPhone,
            session
        );

    const leaveDate =
        session.date;

    const reason =
        session.time;

    if (
        !doctorId ||
        !leaveDate
    ) {
        return true;
    }

    if (normalizedMessage === "1") {

        const result =
            addDoctorLeave(
                doctorId,
                leaveDate,
                reason
            );

        returnDoctorToMenu(
            ss,
            senderPhone,
            doctorId,
            (result.success ? "✅ " : "❌ ") +
            result.message
        );

    } else if (normalizedMessage === "2") {

        returnDoctorToMenu(
            ss,
            senderPhone,
            doctorId,
            "❌ Leave not saved."
        );

    } else {

        sendWhatsAppReply(
            ss,
            senderPhone,
            "❌ Invalid option.\n\n" +
            "1️⃣ Confirm\n" +
            "2️⃣ Cancel"
        );
    }

    return true;
}

if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_LEAVE_CANCEL_PICK"
) {

    const doctorId =
        requireDoctorId(
            ss,
            senderPhone,
            session
        );

    if (!doctorId) {
        return true;
    }

    const leaves =
        getDoctorUpcomingLeaves(
            doctorId
        );

    const pick =
        Number(normalizedMessage);

    if (
        !Number.isInteger(pick) ||
        pick < 1 ||
        pick > leaves.length
    ) {

        sendWhatsAppReply(
            ss,
            senderPhone,
            "❌ Invalid selection.\n\n" +
            formatDoctorUpcomingLeaves(
                doctorId
            )
        );

        return true;
    }

    const result =
        deactivateDoctorLeave(
            doctorId,
            leaves[pick - 1].date
        );

    returnDoctorToMenu(
        ss,
        senderPhone,
        doctorId,
        (result.success ? "✅ " : "❌ ") +
        result.message
    );

    return true;
}

if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_LEAVE_RANGE_START"
) {

    const doctorId =
        requireDoctorId(
            ss,
            senderPhone,
            session
        );

    const startDate =
        messageText.trim();

    if (!doctorId) {
        return true;
    }

    if (!isValidISODate(startDate)) {

        sendWhatsAppReply(
            ss,
            senderPhone,
            "❌ Invalid date.\n\n" +
            "Use YYYY-MM-DD format."
        );

        return true;
    }

    saveWhatsAppSession(
        senderPhone,
        {
            role: "DOCTOR",
            state: "DOCTOR_LEAVE_RANGE_END",
            doctorId: doctorId,
            date: startDate,
            time: "",
            appointmentId: ""
        }
    );

    sendWhatsAppReply(
        ss,
        senderPhone,
        "📅 Enter range end date (YYYY-MM-DD):"
    );

    return true;
}

if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_LEAVE_RANGE_END"
) {

    const doctorId =
        requireDoctorId(
            ss,
            senderPhone,
            session
        );

    const startDate =
        session.date;

    const endDate =
        messageText.trim();

    if (
        !doctorId ||
        !startDate
    ) {
        return true;
    }

    if (!isValidISODate(endDate)) {

        sendWhatsAppReply(
            ss,
            senderPhone,
            "❌ Invalid date.\n\n" +
            "Use YYYY-MM-DD format."
        );

        return true;
    }

    if (endDate < startDate) {

        sendWhatsAppReply(
            ss,
            senderPhone,
            "❌ End date must be on or after start date."
        );

        return true;
    }

    saveWhatsAppSession(
        senderPhone,
        {
            role: "DOCTOR",
            state: "DOCTOR_LEAVE_RANGE_REASON",
            doctorId: doctorId,
            date: startDate,
            time: endDate,
            appointmentId: ""
        }
    );

    sendWhatsAppReply(
        ss,
        senderPhone,
        "📝 Enter reason for leave range (optional).\n\n" +
        "Reply with text or send - to skip."
    );

    return true;
}

if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_LEAVE_RANGE_REASON"
) {

    const doctorId =
        requireDoctorId(
            ss,
            senderPhone,
            session
        );

    const startDate =
        session.date;

    const endDate =
        session.time;

    if (
        !doctorId ||
        !startDate ||
        !endDate
    ) {
        return true;
    }

    const reason =
        normalizedMessage === "-"
            ? ""
            : messageText.trim();

    saveWhatsAppSession(
        senderPhone,
        {
            role: "DOCTOR",
            state: "DOCTOR_LEAVE_RANGE_CONFIRM",
            doctorId: doctorId,
            date: startDate,
            time: endDate,
            appointmentId: reason
        }
    );

    sendWhatsAppReply(
        ss,
        senderPhone,
        "Confirm leave range:\n\n" +
        "📅 " + startDate +
        " to " + endDate + "\n" +
        (
            reason
                ? "📝 " + reason + "\n"
                : ""
        ) +
        "\n1️⃣ Confirm\n" +
        "2️⃣ Cancel"
    );

    return true;
}

if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_LEAVE_RANGE_CONFIRM"
) {

    const doctorId =
        requireDoctorId(
            ss,
            senderPhone,
            session
        );

    const startDate =
        session.date;

    const endDate =
        session.time;

    const reason =
        session.appointmentId;

    if (
        !doctorId ||
        !startDate ||
        !endDate
    ) {
        return true;
    }

    if (normalizedMessage === "1") {

        const result =
            addDoctorLeaveRange(
                doctorId,
                startDate,
                endDate,
                reason
            );

        returnDoctorToMenu(
            ss,
            senderPhone,
            doctorId,
            (result.success ? "✅ " : "❌ ") +
            result.message
        );

    } else if (normalizedMessage === "2") {

        returnDoctorToMenu(
            ss,
            senderPhone,
            doctorId,
            "❌ Leave range not saved."
        );

    } else {

        sendWhatsAppReply(
            ss,
            senderPhone,
            "❌ Invalid option.\n\n" +
            "1️⃣ Confirm\n" +
            "2️⃣ Cancel"
        );
    }
    return true;
}


// ======================================================
// DOCTOR DATE
// ======================================================

if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_DATE"
) {

    const doctorId =
        requireDoctorId(
            ss,
            senderPhone,
            session
        );

    if (!doctorId) {

        return true;

    } else if (normalizedMessage === "1") {

        showDoctorScheduleForDateAndReturn(
            ss,
            senderPhone,
            doctorId,
            Utilities.formatDate(
                new Date(),
                TIMEZONE,
                "yyyy-MM-dd"
            )
        );

    } else if (normalizedMessage === "2") {

        const tomorrow =
            new Date();

        tomorrow.setDate(
            tomorrow.getDate() + 1
        );

        showDoctorScheduleForDateAndReturn(
            ss,
            senderPhone,
            doctorId,
            Utilities.formatDate(
                tomorrow,
                TIMEZONE,
                "yyyy-MM-dd"
            )
        );

    } else if (normalizedMessage === "3") {

        saveWhatsAppSession(
            senderPhone,
            {
                role: "DOCTOR",
                state: "DOCTOR_DATE_CUSTOM",
                doctorId: doctorId,
                date: "",
                time: "",
                appointmentId: ""
            }
        );

        sendWhatsAppReply(
            ss,
            senderPhone,
            "📅 Please enter the date in YYYY-MM-DD format.\n\n" +
            "Example:\n" +
            "2026-08-25"
        );

    } else {

        sendWhatsAppReply(
            ss,
            senderPhone,
            "❌ Invalid option.\n\n" +
            "Please reply with:\n\n" +
            "1️⃣ Today\n" +
            "2️⃣ Tomorrow\n" +
            "3️⃣ Enter another date"
        );
    }
    return true;
}


// ======================================================
// DOCTOR DATE CUSTOM (manually typed date)
// ======================================================

if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_DATE_CUSTOM"
) {

    const doctorId =
        requireDoctorId(
            ss,
            senderPhone,
            session
        );

    const typedDate =
        messageText.trim();

    if (!doctorId) {

        return true;

    } else if (
        !isValidISODate(typedDate)
    ) {

        sendWhatsAppReply(
            ss,
            senderPhone,
            "❌ That doesn't look like a valid date.\n\n" +
            "Please enter the date in YYYY-MM-DD format.\n\n" +
            "Example:\n" +
            "2026-08-25"
        );

    } else {

        showDoctorScheduleForDateAndReturn(
            ss,
            senderPhone,
            doctorId,
            typedDate
        );
    }
    return true;
}


// ======================================================

    return false;
}
