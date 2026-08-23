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

    } else if (normalizedMessage === "0") {

        returnDoctorToMenu(
            ss,
            senderPhone,
            doctorId
        );

    } else if (
        normalizedMessage === "menu_more" ||
        normalizedMessage === "more"
    ) {

        showDoctorMenuMoreTier(
            ss,
            senderPhone,
            doctorId,
            1,
            ""
        );

    } else if (
        handleDoctorPortalMenuChoice(
            ss,
            senderPhone,
            doctorId,
            normalizedMessage
        )
    ) {

        // handled

    } else {

        returnDoctorToMenu(
            ss,
            senderPhone,
            doctorId,
            "❌ Invalid option."
        );
    }

    return true;
}


// ======================================================
// DOCTOR MENU → MORE (button sub-menu tiers)
// ======================================================

if (
    session &&
    session.role === "DOCTOR" &&
    session.state === "DOCTOR_MENU_MORE"
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

    const tier =
        Number(session.doctorMenuTier) || 1;

    if (
        normalizedMessage === "menu_more_2" &&
        tier === 1
    ) {

        showDoctorMenuMoreTier(
            ss,
            senderPhone,
            doctorId,
            2,
            ""
        );

    } else if (
        normalizedMessage === "menu_more_3" &&
        tier === 2
    ) {

        showDoctorMenuMoreTier(
            ss,
            senderPhone,
            doctorId,
            3,
            ""
        );

    } else if (
        normalizedMessage === "menu_more_4" &&
        tier === 3
    ) {

        showDoctorMenuMoreTier(
            ss,
            senderPhone,
            doctorId,
            4,
            ""
        );

    } else if (
        isDoctorMenuChoiceAllowedForTier(
            normalizedMessage,
            tier
        ) &&
        handleDoctorPortalMenuChoice(
            ss,
            senderPhone,
            doctorId,
            normalizedMessage
        )
    ) {

        // handled

    } else {

        sendDoctorMainMenuMoreReply(
            ss,
            senderPhone,
            doctorId,
            tier,
            "❌ Invalid option."
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

        sendDoctorWeekdayMenuReply(
            ss,
            senderPhone,
            doctorId,
            "❌ Invalid day."
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

            sendDoctorSessionRemoveMenuReply(
                ss,
                senderPhone,
                doctorId,
                dayName
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

    sendWhatsAppMenuReply(
        ss,
        senderPhone,
        buildDoctorAvailabilitySessionConfirmMessage(
            dayName,
            startTime,
            endTime
        ),
        getConfirmCancelSpec()
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

    if (isSimpleConfirmYesChoice(normalizedMessage)) {

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

    } else if (isSimpleConfirmCancelChoice(normalizedMessage)) {

        returnToDoctorDayAvailability(
            ss,
            senderPhone,
            doctorId,
            dayName,
            "❌ Session not saved."
        );

    } else {

        sendWhatsAppMenuReply(
            ss,
            senderPhone,
            "❌ Invalid option.\n\n" +
            buildDoctorAvailabilitySessionConfirmMessage(
                dayName,
                startTime,
                endTime
            ),
            getConfirmCancelSpec()
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

    if (isYesCancelConfirmChoice(normalizedMessage)) {

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

            sendWhatsAppMenuReply(
                ss,
                senderPhone,
                "❌ " + errorMessage,
                getYesNoConfirmSpec()
            );
        }

    } else if (isNoGoBackConfirmChoice(normalizedMessage)) {

        returnDoctorToMenu(
            ss,
            senderPhone,
            doctorId,
            "👍 Okay, appointment was not cancelled."
        );

    } else {

        sendWhatsAppMenuReply(
            ss,
            senderPhone,
            "❌ Invalid option.",
            getYesNoConfirmSpec()
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

    if (isStatusCompletedChoice(normalizedMessage)) {
        targetStatus =
            APPOINTMENT_STATUS.COMPLETED;
    } else if (isStatusNoShowChoice(normalizedMessage)) {
        targetStatus =
            APPOINTMENT_STATUS.NO_SHOW;
    } else {

        sendWhatsAppMenuReply(
            ss,
            senderPhone,
            "❌ Invalid option.",
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
            "❌ " + errorMessage,
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

    if (
        normalizedMessage === "1" ||
        normalizedMessage === "confirm_yes"
    ) {

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
                "📅 " +
                result.date +
                "\n" +
                "🕐 " +
                result.time
            );

        } else {

            const errorMessage =
                result && result.message
                    ? result.message
                    : "Unable to reschedule the appointment.";

            sendWhatsAppMenuReply(
                ss,
                senderPhone,
                "❌ " + errorMessage,
                getRescheduleConfirmSpec()
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

    } else if (
        normalizedMessage === "3" ||
        normalizedMessage === "confirm_cancel"
    ) {

        returnDoctorToMenu(
            ss,
            senderPhone,
            doctorId,
            "❌ Reschedule cancelled."
        );

    } else {

        sendWhatsAppMenuReply(
            ss,
            senderPhone,
            "❌ Invalid option.\n\n" +
            buildDoctorRescheduleSlotConfirmMessage(
                session,
                session.date,
                session.time
            ),
            getRescheduleConfirmSpec()
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

            sendDoctorLeaveCancelListMenuReply(
                ss,
                senderPhone,
                doctorId
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

        sendDoctorLeavesMenuReply(
            ss,
            senderPhone,
            "❌ Invalid option."
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

    sendWhatsAppMenuReply(
        ss,
        senderPhone,
        buildDoctorLeaveConfirmMessage(
            leaveDate,
            reason
        ),
        getConfirmCancelSpec()
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

    if (isSimpleConfirmYesChoice(normalizedMessage)) {

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

    } else if (isSimpleConfirmCancelChoice(normalizedMessage)) {

        returnDoctorToMenu(
            ss,
            senderPhone,
            doctorId,
            "❌ Leave not saved."
        );

    } else {

        sendWhatsAppMenuReply(
            ss,
            senderPhone,
            "❌ Invalid option.\n\n" +
            buildDoctorLeaveConfirmMessage(
                leaveDate,
                reason
            ),
            getConfirmCancelSpec()
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

        sendDoctorLeaveCancelListMenuReply(
            ss,
            senderPhone,
            doctorId,
            "❌ Invalid selection."
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

    sendWhatsAppMenuReply(
        ss,
        senderPhone,
        buildDoctorLeaveRangeConfirmMessage(
            startDate,
            endDate,
            reason
        ),
        getConfirmCancelSpec()
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

    if (isSimpleConfirmYesChoice(normalizedMessage)) {

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

    } else if (isSimpleConfirmCancelChoice(normalizedMessage)) {

        returnDoctorToMenu(
            ss,
            senderPhone,
            doctorId,
            "❌ Leave range not saved."
        );

    } else {

        sendWhatsAppMenuReply(
            ss,
            senderPhone,
            "❌ Invalid option.\n\n" +
            buildDoctorLeaveRangeConfirmMessage(
                startDate,
                endDate,
                reason
            ),
            getConfirmCancelSpec()
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
    }

    const selectedDate =
        getISODateFromMenuChoice(
            normalizedMessage
        );

    if (selectedDate) {

        showDoctorScheduleForDateAndReturn(
            ss,
            senderPhone,
            doctorId,
            selectedDate
        );

        return true;
    }

    if (
        normalizedMessage === "3" ||
        normalizedMessage === "date_custom"
    ) {

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
            buildDoctorScheduleDateEntryPrompt()
        );

        return true;
    }

    sendDateMenuReply(
        ss,
        senderPhone,
        "❌ Invalid option.\n\nChoose a date to view."
    );

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

    }

    const dateCheck =
        validateScheduleViewISODate(typedDate);

    if (!dateCheck.valid) {

        sendWhatsAppReply(
            ss,
            senderPhone,
            dateCheck.message
        );

    } else {

        showDoctorScheduleForDateAndReturn(
            ss,
            senderPhone,
            doctorId,
            dateCheck.date
        );
    }
    return true;
}


// ======================================================

    return false;
}
