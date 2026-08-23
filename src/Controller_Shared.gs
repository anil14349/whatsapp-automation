// ============================================================
// Controller_Shared — part of the ABC Clinic WhatsApp bot
// Flow helpers shared by both the patient and doctor conversation state machines.
// See src/Config.gs for the full file-layout map and Script Properties.
// ============================================================



function isYesCancelConfirmChoice(normalizedMessage) {

    const choice =
        String(normalizedMessage || "")
            .trim()
            .toLowerCase();

    return (
        choice === "1" ||
        choice === "confirm_yes_cancel"
    );
}



function isNoGoBackConfirmChoice(normalizedMessage) {

    const choice =
        String(normalizedMessage || "")
            .trim()
            .toLowerCase();

    return (
        choice === "2" ||
        choice === "confirm_no_back"
    );
}



function isSimpleConfirmYesChoice(normalizedMessage) {

    const choice =
        String(normalizedMessage || "")
            .trim()
            .toLowerCase();

    return (
        choice === "1" ||
        choice === "confirm_yes"
    );
}



function isSimpleConfirmCancelChoice(normalizedMessage) {

    const choice =
        String(normalizedMessage || "")
            .trim()
            .toLowerCase();

    return (
        choice === "2" ||
        choice === "confirm_cancel"
    );
}



function isStatusCompletedChoice(normalizedMessage) {

    const choice =
        String(normalizedMessage || "")
            .trim()
            .toLowerCase();

    return (
        choice === "1" ||
        choice === "status_completed"
    );
}



function isStatusNoShowChoice(normalizedMessage) {

    const choice =
        String(normalizedMessage || "")
            .trim()
            .toLowerCase();

    return (
        choice === "2" ||
        choice === "status_no_show"
    );
}



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

        sendPatientMainMenuReply(
            ss,
            phone,
            "❌ You have no active appointments to cancel."
        );

        return false;
    }

    saveWhatsAppSession(phone, {
        role: "PATIENT",
        state: "CANCEL_SELECT",
        apptPage: 0
    });

    sendPatientAppointmentListMenuReply(
        ss,
        phone,
        "cancel",
        appointments
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

        sendPatientMainMenuReply(
            ss,
            phone,
            "❌ You have no active appointments to reschedule."
        );

        return false;
    }

    saveWhatsAppSession(phone, {
        role: "PATIENT",
        state: "RESCHEDULE_SELECT",
        apptPage: 0
    });

    sendPatientAppointmentListMenuReply(
        ss,
        phone,
        "reschedule",
        appointments
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



function findConfirmedAppointmentForPhone(
    phone,
    appointmentId
) {

    const appointments =
        getConfirmedAppointmentsForPhone(phone);

    const target =
        String(appointmentId || "")
            .trim();

    for (
        let i = 0;
        i < appointments.length;
        i++
    ) {

        if (
            String(
                appointments[i].appointmentId
            ).trim() === target
        ) {
            return appointments[i];
        }
    }

    return null;
}



function handleWhatsAppMyAppointmentsState(
    ss,
    phone,
    session,
    normalizedMessage
) {

    handleWhatsAppAppointmentListSelection(
        ss,
        phone,
        session,
        normalizedMessage,
        {
            listScreen: "my_appointments",
            onChosen: function (chosen) {

                saveWhatsAppSession(phone, {
                    role: "PATIENT",
                    state: "MAIN_MENU",
                    doctorId: "",
                    date: "",
                    time: "",
                    appointmentId: "",
                    apptPage: 0
                });

                sendPatientMainMenuReply(
                    ss,
                    phone,
                    buildAppointmentDetailMessage(
                        chosen
                    )
                );
            }
        }
    );
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

    if (!doctorId) {
        return;
    }

    const choice =
        String(normalizedMessage || "")
            .trim()
            .toLowerCase();

    if (
        choice === "nav_main_menu" ||
        choice === "main_menu" ||
        normalizedMessage === "0"
    ) {

        returnDoctorToMenu(
            ss,
            phone,
            doctorId
        );

        return;
    }

    if (
        choice === "nav_back" ||
        choice === "back"
    ) {

        goBackInDoctorWhatsAppFlow(
            ss,
            phone,
            session
        );

        return;
    }

    const appointments =
        typeof opts.getAppointments === "function"
            ? opts.getAppointments()
            : getDoctorConfirmedAppointments(
                doctorId
            );

    const currentPage =
        Number(session.apptPage) || 0;

    const pageInfo =
        getSlotSelectionPageInfo(
            appointments.length,
            currentPage
        );

    if (
        choice === "appt_prev" ||
        choice === "prev"
    ) {

        if (!pageInfo.hasPrev) {

            sendDoctorAppointmentListMenuReply(
                ss,
                phone,
                "❌ Invalid selection.",
                opts.selectLine,
                appointments,
                currentPage
            );

            return;
        }

        const previousPage =
            currentPage - 1;

        saveWhatsAppSession(phone, {
            apptPage: previousPage
        });

        sendDoctorAppointmentListMenuReply(
            ss,
            phone,
            "",
            opts.selectLine,
            appointments,
            previousPage
        );

        return;
    }

    if (
        choice === "appt_next" ||
        choice === "next"
    ) {

        if (!pageInfo.hasNext) {

            sendDoctorAppointmentListMenuReply(
                ss,
                phone,
                "❌ Invalid selection.",
                opts.selectLine,
                appointments,
                currentPage
            );

            return;
        }

        const nextPage =
            currentPage + 1;

        saveWhatsAppSession(phone, {
            apptPage: nextPage
        });

        sendDoctorAppointmentListMenuReply(
            ss,
            phone,
            "",
            opts.selectLine,
            appointments,
            nextPage
        );

        return;
    }

    let selection = NaN;

    if (
        choice.indexOf("appt_") === 0
    ) {

        selection =
            parseInt(
                choice.substring(5),
                10
            );

    } else {

        selection =
            parseInt(
                choice,
                10
            );
    }

    if (
        isNaN(selection) ||
        selection < 1 ||
        selection > appointments.length
    ) {

        sendDoctorAppointmentListMenuReply(
            ss,
            phone,
            "❌ Invalid selection.",
            opts.selectLine,
            appointments,
            currentPage
        );

        return;
    }

    saveWhatsAppSession(phone, {
        apptPage: 0
    });

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
        appointmentId: "",
        apptPage: 0
    });

    sendDoctorAppointmentListMenuReply(
        ss,
        phone,
        "❌ Cancel Patient Appointment",
        "Select the appointment to cancel:",
        appointments
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
        appointmentId: "",
        apptPage: 0
    });

    sendDoctorAppointmentListMenuReply(
        ss,
        phone,
        "🔄 Reschedule Patient Appointment",
        "Select the appointment to reschedule:",
        appointments
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

    sendDoctorAppointmentListMenuReply(
        ss,
        phone,
        "✅ Mark Visit Status",
        "Select the appointment to update:",
        appointments
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
        buildDoctorRescheduleDateIntro(doctorId)
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

    sendDateMenuReply(
        ss,
        phone,
        buildRescheduleDateSelectionIntro({
            doctorId: chosen.doctorId
        })
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

    if (!session) {

        sendWhatsAppReply(
            ss,
            phone,
            opts.expiredMessage ||
                "❌ Your booking session has expired.\n\n" +
                "Please send Hi to start again."
        );

        return;
    }

    const isoDate =
        String(session.date || "").trim();

    if (
        !isoDate ||
        !isValidISODate(isoDate)
    ) {

        sendWhatsAppReply(
            ss,
            phone,
            opts.invalidDateMessage ||
                "❌ The selected date is invalid.\n\n" +
                "Please send Hi to start again."
        );

        return;
    }

    const choice =
        String(normalizedMessage || "")
            .trim()
            .toLowerCase();

    const slotReplyOptions = {
        isoDate: isoDate,
        isReschedule:
            session.state === "RESCHEDULE_TIME" ||
            session.state === "DOCTOR_RESCHEDULE_TIME"
    };

    if (
        choice === "slot_prev" ||
        choice === "prev"
    ) {

        const slots =
            getAvailableSlots(
                session.doctorId,
                isoDate
            );

        const currentPage =
            Number(session.slotPage) || 0;

        const pageInfo =
            getSlotSelectionPageInfo(
                slots.length,
                currentPage
            );

        if (!pageInfo.hasPrev) {

            sendSlotSelectionMenuReply(
                ss,
                phone,
                "❌ Invalid time selection.\n\n" +
                "Please choose one of the available time slots.",
                slots,
                currentPage,
                slotReplyOptions
            );

            return;
        }

        const previousPage =
            currentPage - 1;

        saveWhatsAppSession(
            phone,
            {
                slotPage: previousPage
            }
        );

        sendSlotSelectionMenuReply(
            ss,
            phone,
            "",
            slots,
            previousPage,
            slotReplyOptions
        );

        return;
    }

    if (
        choice === "slot_next" ||
        choice === "next"
    ) {

        const slots =
            getAvailableSlots(
                session.doctorId,
                isoDate
            );

        const currentPage =
            Number(session.slotPage) || 0;

        const pageInfo =
            getSlotSelectionPageInfo(
                slots.length,
                currentPage
            );

        if (!pageInfo.hasNext) {

            sendSlotSelectionMenuReply(
                ss,
                phone,
                "❌ Invalid time selection.\n\n" +
                "Please choose one of the available time slots.",
                slots,
                currentPage,
                slotReplyOptions
            );

            return;
        }

        const nextPage =
            currentPage + 1;

        saveWhatsAppSession(
            phone,
            {
                slotPage: nextPage
            }
        );

        sendSlotSelectionMenuReply(
            ss,
            phone,
            "",
            slots,
            nextPage,
            slotReplyOptions
        );

        return;
    }

    let slotNumber = NaN;

    if (
        choice.indexOf("slot_") === 0
    ) {

        slotNumber =
            parseInt(
                choice.substring(5),
                10
            );

    } else {

        slotNumber =
            parseInt(
                choice,
                10
            );
    }

    const slots =
        getAvailableSlots(
            session.doctorId,
            isoDate
        );

    if (
        !Number.isInteger(slotNumber) ||
        slotNumber < 1 ||
        slotNumber > slots.length
    ) {

        sendSlotSelectionMenuReply(
            ss,
            phone,
            "❌ Invalid time selection.\n\n" +
            "Please choose one of the available time slots.",
            slots,
            Number(session.slotPage) || 0,
            slotReplyOptions
        );

        return;
    }

    const selectedTime =
        slots[slotNumber - 1];

    if (!selectedTime) {

        sendSlotSelectionMenuReply(
            ss,
            phone,
            "❌ That time slot is no longer available.\n\n" +
            "Please choose another time.",
            slots,
            Number(session.slotPage) || 0,
            slotReplyOptions
        );

        return;
    }

    saveWhatsAppSession(phone, {
        slotPage: 0
    });

    if (
        typeof opts.onValidSlot ===
        "function"
    ) {

        opts.onValidSlot(
            selectedTime,
            isoDate
        );

        return;
    }

    sendWhatsAppReply(
        ss,
        phone,
        "❌ Unable to process that time selection.\n\n" +
        "Please try again."
    );
}



function handleWhatsAppAppointmentListSelection(
    ss,
    phone,
    session,
    normalizedMessage,
    options
) {

    const opts = options || {};

    const choice =
        String(normalizedMessage || "")
            .trim()
            .toLowerCase();

    if (
        choice === "nav_main_menu" ||
        choice === "main_menu" ||
        normalizedMessage === "0"
    ) {

        saveWhatsAppSession(phone, {
            role: "PATIENT",
            state: "MAIN_MENU",
            doctorId: "",
            date: "",
            time: "",
            appointmentId: "",
            apptPage: 0
        });

        sendPatientMainMenuReply(
            ss,
            phone,
            "👋 Back to main menu."
        );

        return;
    }

    if (
        choice === "nav_back" ||
        choice === "back"
    ) {

        goBackInWhatsAppFlow(
            ss,
            phone,
            session
        );

        return;
    }

    const appointments =
        typeof opts.getAppointments === "function"
            ? opts.getAppointments()
            : getConfirmedAppointmentsForPhone(phone);

    const currentPage =
        session
            ? Number(session.apptPage) || 0
            : 0;

    const pageInfo =
        getSlotSelectionPageInfo(
            appointments.length,
            currentPage
        );

    const listScreen =
        opts.listScreen || "";

    if (
        choice === "appt_prev" ||
        choice === "prev"
    ) {

        if (!pageInfo.hasPrev) {

            sendPatientAppointmentListMenuReply(
                ss,
                phone,
                listScreen,
                appointments,
                currentPage,
                "❌ Invalid selection."
            );

            return;
        }

        const previousPage =
            currentPage - 1;

        saveWhatsAppSession(phone, {
            apptPage: previousPage
        });

        sendPatientAppointmentListMenuReply(
            ss,
            phone,
            listScreen,
            appointments,
            previousPage
        );

        return;
    }

    if (
        choice === "appt_next" ||
        choice === "next"
    ) {

        if (!pageInfo.hasNext) {

            sendPatientAppointmentListMenuReply(
                ss,
                phone,
                listScreen,
                appointments,
                currentPage,
                "❌ Invalid selection."
            );

            return;
        }

        const nextPage =
            currentPage + 1;

        saveWhatsAppSession(phone, {
            apptPage: nextPage
        });

        sendPatientAppointmentListMenuReply(
            ss,
            phone,
            listScreen,
            appointments,
            nextPage
        );

        return;
    }

    let selection = NaN;

    if (
        choice.indexOf("appt_") === 0
    ) {

        selection =
            parseInt(
                choice.substring(5),
                10
            );

    } else {

        selection =
            parseInt(
                choice,
                10
            );
    }

    if (
        isNaN(selection) ||
        selection < 1 ||
        selection > appointments.length
    ) {

        sendPatientAppointmentListMenuReply(
            ss,
            phone,
            listScreen,
            appointments,
            currentPage,
            "❌ Invalid selection."
        );

        return;
    }

    saveWhatsAppSession(phone, {
        apptPage: 0
    });

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
    session,
    normalizedMessage
) {

    handleWhatsAppAppointmentListSelection(
        ss,
        senderPhone,
        session,
        normalizedMessage,
        {
            listScreen: "cancel",
            onChosen: function (chosen) {
                saveWhatsAppSession(
                    senderPhone,
                    {
                        state: "CANCEL_CONFIRM",
                        appointmentId:
                            chosen.appointmentId
                    }
                );

                sendCancelConfirmMenuReply(
                    ss,
                    senderPhone,
                    chosen
                );
            }
        }
    );
}



function handleWhatsAppRescheduleSelectState(
    ss,
    senderPhone,
    session,
    normalizedMessage
) {

    handleWhatsAppAppointmentListSelection(
        ss,
        senderPhone,
        session,
        normalizedMessage,
        {
            listScreen: "reschedule",
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

    sendDoctorWeekdayMenuReply(
        ss,
        phone,
        doctorId
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

    sendDoctorDayAvailabilityMenuReply(
        ss,
        phone,
        doctorId,
        dayName
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

    sendDoctorDayAvailabilityMenuReply(
        ss,
        phone,
        doctorId,
        dayName,
        prefix
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

    sendDoctorLeavesMenuReply(
        ss,
        phone
    );
}



function whatsAppNavigationShowsBack(session) {

    if (
        !session ||
        !session.state
    ) {
        return false;
    }

    const state =
        session.state;

    const role =
        session.role || "PATIENT";

    if (role === "DOCTOR") {

        const doctorFlatHome = [
            "DOCTOR_DATE",
            "DOCTOR_DATE_CUSTOM",
            "DOCTOR_AVAIL_MENU",
            "DOCTOR_LEAVE_MENU",
            "DOCTOR_CANCEL_SELECT",
            "DOCTOR_RESCHEDULE_SELECT",
            "DOCTOR_STATUS_SELECT"
        ];

        return (
            doctorFlatHome.indexOf(state) === -1
        );
    }

    const patientFlatHome = [
        "BOOK_DOCTOR",
        "MY_APPOINTMENTS",
        "CANCEL_SELECT",
        "RESCHEDULE_SELECT"
    ];

    return (
        patientFlatHome.indexOf(state) === -1
    );
}



function buildWhatsAppNavigationHintText(session) {

    if (
        !session ||
        !session.state ||
        session.state === "MAIN_MENU" ||
        session.state === "DOCTOR_MENU" ||
        session.state === "DOCTOR_MENU_MORE" ||
        session.state === "LANGUAGE_SELECT" ||
        session.state === "LANGUAGE_CHANGE"
    ) {
        return "";
    }

    const homeLabel =
        session.role === "DOCTOR"
            ? "0️⃣ Doctor Portal"
            : "0️⃣ Main Menu";

    const hints = [homeLabel];

    if (whatsAppNavigationShowsBack(session)) {
        hints.push("9️⃣ Back");
    }

    return hints.join("\n");
}



function addWhatsAppNavigationOptions(session, message) {

    const hints =
        buildWhatsAppNavigationHintText(session);

    if (!hints) {
        return message;
    }

    const text =
        String(message || "");

    if (
        text.indexOf("0️⃣ Main Menu") !== -1 ||
        text.indexOf("0️⃣ Doctor Portal") !== -1 ||
        text.indexOf("0️⃣ Back to Main Menu") !== -1
    ) {
        return message;
    }

    return text + "\n\n" + hints;
}


function getISODateFromMenuChoice(normalizedMessage) {

    const choice =
        String(normalizedMessage || "")
            .trim()
            .toLowerCase();

    if (
        choice === "1" ||
        choice === "date_today"
    ) {

        return Utilities.formatDate(
            new Date(),
            TIMEZONE,
            "yyyy-MM-dd"
        );
    }

    if (
        choice === "2" ||
        choice === "date_tomorrow"
    ) {

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

    if (
        normalizedMessage === "3" ||
        normalizedMessage === "date_custom"
    ) {

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

    sendDateMenuReply(
        ss,
        phone,
        "❌ Invalid option.\n\nChoose an appointment date."
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



function showBookingDateSelection(ss, phone, session) {

    sendDateMenuReply(
        ss,
        phone,
        buildBookingDateSelectionIntro(session)
    );
}



function showRescheduleDateSelection(ss, phone, session) {

    sendDateMenuReply(
        ss,
        phone,
        buildRescheduleDateSelectionIntro(session)
    );
}



function showDoctorDateSelection(ss, phone) {

    sendDateMenuReply(
        ss,
        phone,
        "📅 Choose a date to view."
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



function normalizeDoctorMenuChoice(normalizedMessage) {

    const c =
        String(normalizedMessage || "")
            .trim()
            .toLowerCase();

    if (c === "doctor_reschedule") {
        return "9";
    }

    if (c === "doctor_status") {
        return "10";
    }

    return c;
}



function showDoctorMenuMoreTier(
    ss,
    phone,
    doctorId,
    tier,
    prefix
) {

    saveWhatsAppSession(
        phone,
        {
            role: "DOCTOR",
            state: "DOCTOR_MENU_MORE",
            doctorId: doctorId,
            doctorMenuTier: Number(tier) || 1
        }
    );

    sendDoctorMainMenuMoreReply(
        ss,
        phone,
        doctorId,
        tier,
        prefix
    );
}



function isDoctorMenuChoiceAllowedForTier(
    normalizedMessage,
    tier
) {

    const choice =
        normalizeDoctorMenuChoice(
            normalizedMessage
        );

    const t =
        Number(tier) || 1;

    if (t === 1) {
        return choice === "3" || choice === "4";
    }

    if (t === 2) {
        return choice === "5" || choice === "6";
    }

    if (t === 3) {
        return choice === "7" || choice === "8";
    }

    if (t === 4) {
        return choice === "9" || choice === "10";
    }

    return false;
}



function handleDoctorPortalMenuChoice(
    ss,
    phone,
    doctorId,
    normalizedMessage
) {

    const choice =
        normalizeDoctorMenuChoice(
            normalizedMessage
        );

    if (choice === "1") {

        returnDoctorToMenu(
            ss,
            phone,
            doctorId,
            formatDoctorSchedule(
                getDoctorTodaySchedule(
                    doctorId
                ),
                "Today's Schedule"
            )
        );

        return true;
    }

    if (choice === "2") {

        returnDoctorToMenu(
            ss,
            phone,
            doctorId,
            formatDoctorNext(
                getDoctorNextAppointment(
                    doctorId
                )
            )
        );

        return true;
    }

    if (choice === "3") {

        returnDoctorToMenu(
            ss,
            phone,
            doctorId,
            formatDoctorWeek(
                getDoctorWeeklySchedule(
                    doctorId
                )
            )
        );

        return true;
    }

    if (choice === "4") {

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

        showDoctorDateSelection(
            ss,
            phone
        );

        return true;
    }

    if (choice === "5") {

        showDoctorAvailabilityMenu(
            ss,
            phone,
            doctorId
        );

        return true;
    }

    if (choice === "6") {

        showDoctorLeavesMenu(
            ss,
            phone,
            doctorId
        );

        return true;
    }

    if (choice === "7") {

        returnDoctorToMenu(
            ss,
            phone,
            doctorId,
            formatDoctorPatientsList(
                doctorId
            )
        );

        return true;
    }

    if (choice === "8") {

        beginDoctorCancelFlow(
            ss,
            phone,
            doctorId
        );

        return true;
    }

    if (choice === "9") {

        beginDoctorRescheduleFlow(
            ss,
            phone,
            doctorId
        );

        return true;
    }

    if (choice === "10") {

        beginDoctorStatusFlow(
            ss,
            phone,
            doctorId
        );

        return true;
    }

    return false;
}



function returnDoctorToMenu(ss, phone, doctorId, prefix) {

    saveWhatsAppSession(
        phone,
        {
            role: "DOCTOR",
            state: "DOCTOR_MENU",
            doctorId: doctorId,
            date: "",
            time: "",
            appointmentId: "",
            doctorMenuTier: ""
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

        case "PATIENT_MAIN_MORE":
            returnToMainMenu(
                ss,
                phone,
                ""
            );
            return;

        case "MY_APPOINTMENTS":
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
            showBookingDateSelection(ss, phone, session);
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
                appointmentId: "",
                apptPage: 0
            });
            sendPatientAppointmentListMenuReply(
                ss,
                phone,
                "cancel",
                getConfirmedAppointmentsForPhone(phone)
            );
            return;

        case "RESCHEDULE_DATE":
            saveWhatsAppSession(phone, {
                state: "RESCHEDULE_SELECT",
                appointmentId: "",
                doctorId: "",
                date: "",
                time: "",
                apptPage: 0
            });
            sendPatientAppointmentListMenuReply(
                ss,
                phone,
                "reschedule",
                getConfirmedAppointmentsForPhone(phone)
            );
            return;

        case "RESCHEDULE_DATE_CUSTOM":
        case "RESCHEDULE_TIME":
            saveWhatsAppSession(phone, {
                state: "RESCHEDULE_DATE",
                date: "",
                time: ""
            });
            showRescheduleDateSelection(ss, phone, session);
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

        case "DOCTOR_MENU_MORE":

            const menuTier =
                Number(session.doctorMenuTier) || 1;

            if (menuTier <= 1) {

                returnDoctorToMenu(
                    ss,
                    phone,
                    doctorId
                );

            } else {

                showDoctorMenuMoreTier(
                    ss,
                    phone,
                    doctorId,
                    menuTier - 1,
                    ""
                );
            }

            return;

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
                time: "",
                apptPage: 0
            });
            sendDoctorAppointmentListMenuReply(
                ss,
                phone,
                "🔄 Reschedule Patient Appointment",
                "Select the appointment to reschedule:",
                getDoctorConfirmedAppointments(
                    doctorId
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
            sendDateMenuReply(
                ss,
                phone,
                buildDoctorRescheduleDateIntro(doctorId)
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
            date: selectedDate,
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
            isoDate: selectedDate,
            isReschedule:
                nextState === "RESCHEDULE_TIME" ||
                nextState === "DOCTOR_RESCHEDULE_TIME"
        }
    );

    return true;
}
