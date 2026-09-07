// ============================================================
// View_Messages — part of the ABC Clinic WhatsApp bot
// WhatsApp reply text builders and EN/TE/HI localization.
// See src/Config.gs for the full file-layout map and Script Properties.
// ============================================================



function formatAppointmentsListForWhatsApp(appointments) {

    let text = "";

    for (
        let i = 0;
        i < appointments.length;
        i++
    ) {

        const appt =
            appointments[i];

        const doctorName =
            findDoctorById(appt.doctorId) ||
            "Unknown Doctor";

        text +=
            (i + 1) + "️⃣ " +
            "👨‍⚕️ " + doctorName + "\n" +
            "   📅 " + appt.date +
            "   🕐 " + appt.time +
            "\n\n";
    }

    return text;
}



function formatAvailableSlotsForWhatsApp(slots) {

    let text = "";

    for (
        let i = 0;
        i < slots.length;
        i++
    ) {

        text +=
            (i + 1) + "️⃣ " +
            slots[i] + "\n";
    }

    return text;
}




function buildAppointmentDetailMessage(appt) {

    const doctorName =
        findDoctorById(
            appt.doctorId
        ) || "Unknown Doctor";

    return (
        "👨‍⚕️ " + doctorName + "\n" +
        "📅 " +
        formatWhatsAppDisplayDate(
            appt.date
        ) +
        "\n" +
        "🕐 " + appt.time +
        "\n\n" +
        "What would you like to do with this appointment?"
    );
}



function formatAppointmentListRowDescription(appt) {

    return (
        formatWhatsAppDisplayDate(
            appt.date
        ) +
        " · " +
        (appt.time || "")
    );
}



function buildPatientAppointmentListBody(
    title,
    selectLine,
    pageInfo,
    prefix
) {

    let body =
        (prefix
            ? String(prefix) + "\n\n"
            : "") +
        title +
        "\n\n" +
        selectLine;

    if (
        pageInfo &&
        pageInfo.totalPages > 1
    ) {
        body +=
            "\n\nPage " +
            (pageInfo.page + 1) +
            " of " +
            pageInfo.totalPages;
    }

    return body;
}



function buildMyAppointmentsListBody(
    pageInfo,
    prefix
) {

    return buildPatientAppointmentListBody(
        "📋 Your appointments",
        "Select an appointment.",
        pageInfo,
        prefix
    );
}



function buildCancelAppointmentListBody(
    pageInfo,
    prefix
) {

    return buildPatientAppointmentListBody(
        "❌ Cancel appointment",
        "Select an appointment to cancel.",
        pageInfo,
        prefix
    );
}



function buildRescheduleAppointmentListBody(
    pageInfo,
    prefix
) {

    return buildPatientAppointmentListBody(
        "🔄 Reschedule appointment",
        "Select an appointment to reschedule.",
        pageInfo,
        prefix
    );
}



function buildPatientAppointmentListBodyForScreen(
    listScreen,
    pageInfo,
    prefix
) {

    if (listScreen === "my_appointments") {
        return buildMyAppointmentsListBody(
            pageInfo,
            prefix
        );
    }

    if (listScreen === "cancel") {
        return buildCancelAppointmentListBody(
            pageInfo,
            prefix
        );
    }

    if (listScreen === "reschedule") {
        return buildRescheduleAppointmentListBody(
            pageInfo,
            prefix
        );
    }

    return buildPatientAppointmentListBody(
        "Select an appointment",
        "Choose one:",
        pageInfo,
        prefix
    );
}



function buildCancelConfirmRetryBody(
    chosen,
    prefix
) {

    return (
        String(
            prefix || "❌ Invalid option."
        ) +
        "\n\n" +
        buildCancelConfirmMessage(chosen)
    );
}



function buildRescheduleConfirmRetryBody(
    session,
    prefix
) {

    return (
        String(
            prefix || "❌ Invalid option."
        ) +
        "\n\n" +
        buildRescheduleSlotConfirmMessage(
            session,
            session.date,
            session.time
        )
    );
}



function buildDoctorSelectionBody(prefix) {

    return (
        (prefix
            ? String(prefix) + "\n\n"
            : "") +
        "📅 Book Appointment\n\n" +
        "Choose your doctor."
    );
}



function buildDoctorSelectionFallbackText(
    doctors
) {

    if (
        !doctors ||
        doctors.length === 0
    ) {
        return "";
    }

    return doctors
        .map(
            function (doctor, index) {

                let line =
                    (index + 1) +
                    ". " +
                    doctor.doctorName;

                if (doctor.specialization) {
                    line +=
                        " — " +
                        doctor.specialization;
                }

                if (doctor.clinicName) {
                    line +=
                        " (" +
                        doctor.clinicName +
                        ")";
                }

                return line;
            }
        )
        .join("\n");
}



function buildLanguageSelectionBody(prefix) {

    return (
        (prefix
            ? String(prefix) + "\n\n"
            : "") +
        buildLanguageSelectionIntro()
    );
}



function buildCancelConfirmMessage(chosen) {

    const doctorName =
        findDoctorById(
            chosen.doctorId
        ) || "Unknown Doctor";

    return (
        "⚠️ Cancel this appointment?\n\n" +
        "👨‍⚕️ " + doctorName + "\n" +
        "📅 " +
        formatWhatsAppDisplayDate(
            chosen.date
        ) +
        "\n" +
        "🕐 " + chosen.time
    );
}



function buildRescheduleSlotConfirmMessage(
    session,
    newDate,
    selectedTime
) {

    return (
        "🔄 Confirm reschedule?\n\n" +
        "👨‍⚕️ " +
        (
            findDoctorById(
                session.doctorId
            ) || "Unknown Doctor"
        ) +
        "\n" +
        "📅 " +
        formatWhatsAppDisplayDate(newDate) +
        "\n" +
        "🕐 " + selectedTime
    );
}



function formatDoctorPatientAppointmentsListForWhatsApp(
    appointments
) {

    let text = "";

    for (
        let i = 0;
        i < appointments.length;
        i++
    ) {

        const appt =
            appointments[i];

        text +=
            (i + 1) + "️⃣ " +
            "👤 " + appt.patientName + "\n" +
            "   📅 " + appt.date +
            "   🕐 " + appt.time +
            "\n\n";
    }

    return text;
}



function buildDoctorCancelConfirmMessage(chosen) {

    return (
        "❌ Cancel this patient appointment?\n\n" +
        "👤 Patient: " +
        chosen.patientName +
        "\n" +
        "📅 Date: " +
        chosen.date +
        "\n" +
        "🕐 Time: " +
        chosen.time
    );
}



function buildDoctorAvailabilitySessionConfirmMessage(
    dayName,
    startTime,
    endTime
) {

    return (
        "Please confirm new session:\n\n" +
        "📅 " + dayName + "\n" +
        "🕐 " + startTime + " - " + endTime
    );
}



function buildDoctorLeaveConfirmMessage(
    leaveDate,
    reason
) {

    return (
        "Confirm leave:\n\n" +
        "📅 " + leaveDate + "\n" +
        (
            reason
                ? "📝 " + reason + "\n"
                : ""
        )
    );
}



function buildDoctorLeaveRangeConfirmMessage(
    startDate,
    endDate,
    reason
) {

    return (
        "Confirm leave range:\n\n" +
        "📅 " + startDate +
        " to " + endDate + "\n" +
        (
            reason
                ? "📝 " + reason + "\n"
                : ""
        )
    );
}



function buildDoctorRescheduleSlotConfirmMessage(
    session,
    newDate,
    selectedTime
) {

    const patientLine =
        session &&
        session.patientName
            ? "👤 Patient: " +
            session.patientName +
            "\n"
            : "";

    return (
        "🔄 Confirm reschedule?\n\n" +
        patientLine +
        "👨‍⚕️ " +
        (
            findDoctorById(
                session.doctorId
            ) || "Unknown Doctor"
        ) +
        "\n" +
        "📅 " +
        formatWhatsAppDisplayDate(newDate) +
        "\n" +
        "🕐 " + selectedTime
    );
}



function buildDoctorStatusActionMessage(chosen) {

    return (
        "✅ Mark visit status\n\n" +
        "👤 Patient: " +
        chosen.patientName +
        "\n" +
        "📅 Date: " +
        chosen.date +
        "\n" +
        "🕐 Time: " +
        chosen.time
    );
}



function formatWhatsAppDisplayDate(isoDate) {

    if (!isValidISODate(isoDate)) {
        return String(isoDate || "").trim();
    }

    return Utilities.formatDate(
        new Date(
            isoDate + "T00:00:00+05:30"
        ),
        TIMEZONE,
        "dd-MMM-yyyy"
    );
}



function buildSlotSelectionIntro(
    isoDate,
    isReschedule
) {

    const formatted =
        formatWhatsAppDisplayDate(isoDate);

    const line =
        isReschedule
            ? "Choose a new time."
            : "Choose an available time.";

    return (
        "📅 " +
        formatted +
        "\n\n" +
        line
    );
}



function buildLanguageSelectionIntro() {

    return "🌐 Choose your language.";
}



function localizeWhatsAppReply(language, message) {

    const selectedLanguage =
        String(language || "EN").toUpperCase();

    // {{CLINIC_NAME}} is substituted unconditionally further down —
    // both branches below funnel through it, so a source message built
    // with the placeholder (see buildAfterHoursMessage, for example)
    // localizes correctly in every language including English.
    if (selectedLanguage === "EN") {
        return applyClinicNamePlaceholder(
            String(message)
        );
    }

    const translations = {
        TE: {
            "Welcome to {{CLINIC_NAME}}!": "{{CLINIC_NAME}} కు స్వాగతం!",
            "Please choose an option:": "దయచేసి ఒక ఎంపికను ఎంచుకోండి:",
            "Book Appointment": "అపాయింట్‌మెంట్ బుక్ చేయండి",
            "My Appointments": "నా అపాయింట్‌మెంట్‌లు",
            "Cancel Appointment": "అపాయింట్‌మెంట్ రద్దు చేయండి",
            "Reschedule Appointment": "అపాయింట్‌మెంట్ సమయాన్ని మార్చండి",
            "Change Language": "భాషను మార్చండి",
            "Select a doctor:": "డాక్టర్‌ను ఎంచుకోండి:",
            "Reply with the doctor's number.": "డాక్టర్ నంబర్‌తో సమాధానం ఇవ్వండి.",
            "Please choose a date:": "తేదీని ఎంచుకోండి:",
            "Today": "ఈరోజు",
            "Tomorrow": "రేపు",
            "Enter another date": "వేరే తేదీని నమోదు చేయండి",
            "Available slots:": "అందుబాటులో ఉన్న సమయాలు:",
            "Please choose a time.": "సమయాన్ని ఎంచుకోండి.",
            "Confirm appointment?": "అపాయింట్‌మెంట్‌ను నిర్ధారించాలా?",
            "Confirm": "నిర్ధారించండి",
            "Choose another time": "వేరే సమయం ఎంచుకోండి",
            "Cancel": "రద్దు చేయండి",
            "Back to Main Menu": "ప్రధాన మెనూకు తిరిగి వెళ్ళండి",
            "Back to main menu.": "ప్రధాన మెనూకు తిరిగి వచ్చారు.",
            "Main Menu": "ప్రధాన మెను",
            "Back": "వెనక్కి",
            "Invalid option.": "చెల్లని ఎంపిక.",
            "Please reply with:": "దయచేసి ఇలా సమాధానం ఇవ్వండి:",
            "Please enter the date in YYYY-MM-DD format.": "దయచేసి తేదీని YYYY-MM-DD ఫార్మాట్‌లో నమోదు చేయండి.",
            "Please enter the new date in YYYY-MM-DD format.": "దయచేసి కొత్త తేదీని YYYY-MM-DD ఫార్మాట్‌లో నమోదు చేయండి.",
            "Example:": "ఉదాహరణ:",
            "Your Appointments:": "మీ అపాయింట్‌మెంట్‌లు:",
            "Select the appointment to cancel:": "రద్దు చేయాల్సిన అపాయింట్‌మెంట్‌ను ఎంచుకోండి:",
            "Select the appointment to reschedule:": "మార్చాల్సిన అపాయింట్‌మెంట్‌ను ఎంచుకోండి:",
            "Yes, cancel it": "అవును, రద్దు చేయండి",
            "No, go back": "లేదు, వెనక్కి వెళ్ళండి",
            "Doctor selected:": "ఎంచుకున్న డాక్టర్:",
            "Doctor:": "డాక్టర్:",
            "Patient:": "రోగి:",
            "Date:": "తేదీ:",
            "Time:": "సమయం:",
            "New Date:": "కొత్త తేదీ:",
            "New Time:": "కొత్త సమయం:",
            "Appointment ID:": "అపాయింట్‌మెంట్ ఐడి:",
            "Appointment confirmed!": "అపాయింట్‌మెంట్ నిర్ధారించబడింది!",
            "Appointment cancelled successfully.": "అపాయింట్‌మెంట్ విజయవంతంగా రద్దు చేయబడింది.",
            "Appointment booking cancelled.": "అపాయింట్‌మెంట్ బుకింగ్ రద్దు చేయబడింది.",
            "Reschedule cancelled.": "సమయం మార్పు రద్దు చేయబడింది.",
            "Confirm reschedule?": "సమయం మార్పును నిర్ధారించాలా?",
            "Please choose a new date:": "కొత్త తేదీని ఎంచుకోండి:",
            "Please choose a valid doctor number.": "దయచేసి సరైన డాక్టర్ నంబర్‌ను ఎంచుకోండి.",
            "Sorry, there are no available slots on ": "క్షమించండి, ఈ తేదీన అందుబాటులో సమయాలు లేవు: ",
            "Please choose another date.": "దయచేసి వేరే తేదీని ఎంచుకోండి.",
            "No available slots remain for ": "ఈ తేదీకి అందుబాటులో సమయాలు లేవు: ",
            "Your booking session has expired.": "మీ బుకింగ్ సెషన్ గడువు ముగిసింది.",
            "Your reschedule session has expired.": "మీ సమయం మార్పు సెషన్ గడువు ముగిసింది.",
            "Thank you for choosing {{CLINIC_NAME}}.": "{{CLINIC_NAME}} ను ఎంచుకున్నందుకు ధన్యవాదాలు.",
            "Please send Hi to start again.": "మళ్లీ ప్రారంభించడానికి Hi పంపండి.",
            "Sorry, I didn't understand that.": "క్షమించండి, నాకు అర్థం కాలేదు.",
            "Language changed successfully.": "భాష విజయవంతంగా మార్చబడింది.",
            "Please enter your full name to complete the booking.": "బుకింగ్ పూర్తి చేయడానికి దయచేసి మీ పూర్తి పేరు నమోదు చేయండి.",
            "Please confirm your appointment:": "దయచేసి మీ అపాయింట్‌మెంట్‌ను నిర్ధారించండి:",
            "Please enter a valid full name (at least 2 characters).": "దయచేసి సరైన పూర్తి పేరు నమోదు చేయండి (కనీసం 2 అక్షరాలు).",
            "Unable to save your name.": "మీ పేరును సేవ్ చేయలేకపోయాం.",
            "Invalid time selection.": "చెల్లని సమయ ఎంపిక.",
            "Please choose one of the available slots:": "దయచేసి అందుబాటులో ఉన్న సమయాలలో ఒకదాన్ని ఎంచుకోండి:",
            "Invalid selection.": "చెల్లని ఎంపిక.",
            "Date selected:": "ఎంచుకున్న తేదీ:",
            "Appointment Reminder": "అపాయింట్‌మెంట్ రిమైండర్",
            "Reminder: ": "రిమైండర్: ",
            " before your appointment.": " మీ అపాయింట్‌మెంట్‌కు ముందు.",
            "Reply Hi to reschedule or cancel.": "మార్చడానికి లేదా రద్దు చేయడానికి Hi పంపండి.",
            "{{CLINIC_NAME}} is currently closed.": "{{CLINIC_NAME}} ప్రస్తుతం మూసివేయబడింది.",
            "Our hours:": "మా సమయాలు:",
            "Please message us during clinic hours to book or manage appointments.": "అపాయింట్‌మెంట్‌లు బుక్ చేయడానికి లేదా నిర్వహించడానికి క్లినిక్ సమయంలో మాకు సందేశం పంపండి.",
            "Reply Hi during open hours to get started.": "ప్రారంభించడానికి తెరిచి ఉన్న సమయంలో Hi పంపండి.",
            "How can we help you today?": "ఈరోజు మేము మీకు ఎలా సహాయం చేయగలం?",
            "Choose your doctor.": "మీ డాక్టర్‌ను ఎంచుకోండి.",
            "Choose an appointment date.": "అపాయింట్‌మెంట్ తేదీని ఎంచుకోండి.",
            "Choose an available time.": "అందుబాటులో ఉన్న సమయాన్ని ఎంచుకోండి.",
            "Choose a new time.": "కొత్త సమయాన్ని ఎంచుకోండి.",
            "Choose your language.": "మీ భాషను ఎంచుకోండి.",
            "Your appointments": "మీ అపాయింట్‌మెంట్‌లు",
            "Select an appointment.": "అపాయింట్‌మెంట్‌ను ఎంచుకోండి.",
            "Cancel appointment": "అపాయింట్‌మెంట్ రద్దు",
            "Select an appointment to cancel.": "రద్దు చేయడానికి అపాయింట్‌మెంట్‌ను ఎంచుకోండి.",
            "Reschedule appointment": "అపాయింట్‌మెంట్ సమయం మార్చండి",
            "Select an appointment to reschedule.": "మార్చడానికి అపాయింట్‌మెంట్‌ను ఎంచుకోండి.",
            "Choose a new appointment date.": "కొత్త అపాయింట్‌మెంట్ తేదీని ఎంచుకోండి.",
            "✅ Confirm appointment?": "✅ అపాయింట్‌మెంట్‌ను నిర్ధారించాలా?",
            "⚠️ Cancel this appointment?": "⚠️ ఈ అపాయింట్‌మెంట్‌ను రద్దు చేయాలా?",
            "🔄 Confirm reschedule?": "🔄 సమయం మార్పును నిర్ధారించాలా?",
            "Please choose a valid doctor.": "దయచేసి సరైన డాక్టర్‌ను ఎంచుకోండి.",
            "Please choose one of the available time slots.": "దయచేసి అందుబాటులో ఉన్న సమయాలలో ఒకదాన్ని ఎంచుకోండి.",
            "That time slot is no longer available.": "ఆ సమయ స్లాట్ ఇకపై అందుబాటులో లేదు.",
            "Please choose another time.": "దయచేసి వేరే సమయం ఎంచుకోండి.",
            "📅 Enter the appointment date.": "📅 అపాయింట్‌మెంట్ తేదీని నమోదు చేయండి.",
            "📅 Enter the new appointment date.": "📅 కొత్త అపాయింట్‌మెంట్ తేదీని నమోదు చేయండి.",
            "Format: YYYY-MM-DD": "ఫార్మాట్: YYYY-MM-DD",
            "Page ": "పేజీ ",
            " of ": " / ",
            "Other date": "వేరే తేదీ",
            "Other time": "వేరే సమయం",
            "Yes, cancel": "అవును, రద్దు",
            "Earlier times": "మునుపటి సమయాలు",
            "More times": "మరిన్ని సమయాలు",
            "Reschedule": "సమయం మార్చండి",
            "Choose option": "ఎంపికను ఎంచుకోండి",
            "Select appointment": "అపాయింట్‌మెంట్‌ను ఎంచుకోండి",
            "Choose time": "సమయాన్ని ఎంచుకోండి",
            "Select doctor": "డాక్టర్‌ను ఎంచుకోండి",
            "Select language": "భాషను ఎంచుకోండి",
            "Choose language": "భాష ఎంచుకోండి",
            "Invalid selection.": "చెల్లని ఎంపిక.",
            "Options": "ఎంపికలు",
            "No, go back": "లేదు, వెనక్కి",
            "Previous page": "మునుపటి పేజీ",
            "Next page": "తదుపరి పేజీ",
            "More appointments": "మరిన్ని అపాయింట్‌మెంట్‌లు",
            "Earlier appointments": "మునుపటి అపాయింట్‌మెంట్‌లు",
            "Schedule a visit": "సందర్శన షెడ్యూల్ చేయండి",
            "View upcoming": "రాబోయేవి చూడండి",
            "Cancel a booking": "బుకింగ్‌ను రద్దు చేయండి",
            "Change date or time": "తేదీ లేదా సమయం మార్చండి",
            "More": "మరిన్ని",
            "More options": "మరిన్ని ఎంపికలు"
        },
        HI: {
            "Welcome to {{CLINIC_NAME}}!": "{{CLINIC_NAME}} में आपका स्वागत है!",
            "Please choose an option:": "कृपया एक विकल्प चुनें:",
            "Book Appointment": "अपॉइंटमेंट बुक करें",
            "My Appointments": "मेरे अपॉइंटमेंट",
            "Cancel Appointment": "अपॉइंटमेंट रद्द करें",
            "Reschedule Appointment": "अपॉइंटमेंट का समय बदलें",
            "Change Language": "भाषा बदलें",
            "Select a doctor:": "डॉक्टर चुनें:",
            "Reply with the doctor's number.": "डॉक्टर के नंबर से उत्तर दें।",
            "Please choose a date:": "तारीख चुनें:",
            "Today": "आज",
            "Tomorrow": "कल",
            "Enter another date": "दूसरी तारीख दर्ज करें",
            "Available slots:": "उपलब्ध समय:",
            "Please choose a time.": "समय चुनें।",
            "Confirm appointment?": "अपॉइंटमेंट की पुष्टि करें?",
            "Confirm": "पुष्टि करें",
            "Choose another time": "दूसरा समय चुनें",
            "Cancel": "रद्द करें",
            "Back to Main Menu": "मुख्य मेनू पर वापस जाएं",
            "Back to main menu.": "मुख्य मेनू पर वापस आ गए हैं।",
            "Main Menu": "मुख्य मेनू",
            "Back": "वापस",
            "Invalid option.": "अमान्य विकल्प।",
            "Please reply with:": "कृपया इस तरह उत्तर दें:",
            "Please enter the date in YYYY-MM-DD format.": "कृपया तारीख YYYY-MM-DD प्रारूप में दर्ज करें।",
            "Please enter the new date in YYYY-MM-DD format.": "कृपया नई तारीख YYYY-MM-DD प्रारूप में दर्ज करें।",
            "Example:": "उदाहरण:",
            "Your Appointments:": "आपके अपॉइंटमेंट:",
            "Select the appointment to cancel:": "रद्द करने के लिए अपॉइंटमेंट चुनें:",
            "Select the appointment to reschedule:": "बदलने के लिए अपॉइंटमेंट चुनें:",
            "Yes, cancel it": "हां, रद्द करें",
            "No, go back": "नहीं, वापस जाएं",
            "Doctor selected:": "चुना गया डॉक्टर:",
            "Doctor:": "डॉक्टर:",
            "Patient:": "मरीज़:",
            "Date:": "तारीख:",
            "Time:": "समय:",
            "New Date:": "नई तारीख:",
            "New Time:": "नया समय:",
            "Appointment ID:": "अपॉइंटमेंट आईडी:",
            "Appointment confirmed!": "अपॉइंटमेंट की पुष्टि हो गई!",
            "Appointment cancelled successfully.": "अपॉइंटमेंट सफलतापूर्वक रद्द कर दिया गया।",
            "Appointment booking cancelled.": "अपॉइंटमेंट बुकिंग रद्द कर दी गई।",
            "Reschedule cancelled.": "समय परिवर्तन रद्द कर दिया गया।",
            "Confirm reschedule?": "समय परिवर्तन की पुष्टि करें?",
            "Please choose a new date:": "नई तारीख चुनें:",
            "Please choose a valid doctor number.": "कृपया सही डॉक्टर नंबर चुनें।",
            "Sorry, there are no available slots on ": "क्षमा करें, इस तारीख पर कोई समय उपलब्ध नहीं है: ",
            "Please choose another date.": "कृपया दूसरी तारीख चुनें।",
            "No available slots remain for ": "इस तारीख के लिए कोई समय उपलब्ध नहीं है: ",
            "Your booking session has expired.": "आपका बुकिंग सत्र समाप्त हो गया है।",
            "Your reschedule session has expired.": "आपका समय परिवर्तन सत्र समाप्त हो गया है।",
            "Thank you for choosing {{CLINIC_NAME}}.": "{{CLINIC_NAME}} चुनने के लिए धन्यवाद।",
            "Please send Hi to start again.": "फिर से शुरू करने के लिए Hi भेजें।",
            "Sorry, I didn't understand that.": "क्षमा करें, मैं समझ नहीं पाया।",
            "Language changed successfully.": "भाषा सफलतापूर्वक बदल दी गई है।",
            "Please enter your full name to complete the booking.": "बुकिंग पूरी करने के लिए कृपया अपना पूरा नाम दर्ज करें।",
            "Please confirm your appointment:": "कृपया अपने अपॉइंटमेंट की पुष्टि करें:",
            "Please enter a valid full name (at least 2 characters).": "कृपया एक मान्य पूरा नाम दर्ज करें (कम से कम 2 अक्षर)।",
            "Unable to save your name.": "आपका नाम सहेज नहीं सके।",
            "Invalid time selection.": "अमान्य समय चयन।",
            "Please choose one of the available slots:": "कृपया उपलब्ध समयों में से एक चुनें:",
            "Invalid selection.": "अमान्य चयन।",
            "Date selected:": "चुनी गई तारीख:",
            "Appointment Reminder": "अपॉइंटमेंट रिमाइंडर",
            "Reminder: ": "रिमाइंडर: ",
            " before your appointment.": " आपके अपॉइंटमेंट से पहले।",
            "Reply Hi to reschedule or cancel.": "बदलने या रद्द करने के लिए Hi भेजें।",
            "{{CLINIC_NAME}} is currently closed.": "{{CLINIC_NAME}} अभी बंद है।",
            "Our hours:": "हमारे समय:",
            "Please message us during clinic hours to book or manage appointments.": "अपॉइंटमेंट बुक या प्रबंधित करने के लिए कृपया क्लिनिक के समय में संदेश भेजें।",
            "Reply Hi during open hours to get started.": "शुरू करने के लिए खुले समय में Hi भेजें।",
            "How can we help you today?": "आज हम आपकी कैसे मदद कर सकते हैं?",
            "Choose your doctor.": "अपना डॉक्टर चुनें।",
            "Choose an appointment date.": "अपॉइंटमेंट की तारीख चुनें।",
            "Choose an available time.": "उपलब्ध समय चुनें।",
            "Choose a new time.": "नया समय चुनें।",
            "Choose your language.": "अपनी भाषा चुनें।",
            "Your appointments": "आपके अपॉइंटमेंट",
            "Select an appointment.": "अपॉइंटमेंट चुनें।",
            "Cancel appointment": "अपॉइंटमेंट रद्द करें",
            "Select an appointment to cancel.": "रद्द करने के लिए अपॉइंटमेंट चुनें।",
            "Reschedule appointment": "अपॉइंटमेंट का समय बदलें",
            "Select an appointment to reschedule.": "बदलने के लिए अपॉइंटमेंट चुनें।",
            "Choose a new appointment date.": "नई अपॉइंटमेंट तारीख चुनें।",
            "✅ Confirm appointment?": "✅ अपॉइंटमेंट की पुष्टि करें?",
            "⚠️ Cancel this appointment?": "⚠️ यह अपॉइंटमेंट रद्द करें?",
            "🔄 Confirm reschedule?": "🔄 समय परिवर्तन की पुष्टि करें?",
            "Please choose a valid doctor.": "कृपया सही डॉक्टर चुनें।",
            "Please choose one of the available time slots.": "कृपया उपलब्ध समयों में से एक चुनें।",
            "That time slot is no longer available.": "वह समय अब उपलब्ध नहीं है।",
            "Please choose another time.": "कृपया दूसरा समय चुनें।",
            "📅 Enter the appointment date.": "📅 अपॉइंटमेंट की तारीख दर्ज करें।",
            "📅 Enter the new appointment date.": "📅 नई अपॉइंटमेंट तारीख दर्ज करें।",
            "Format: YYYY-MM-DD": "प्रारूप: YYYY-MM-DD",
            "Page ": "पृष्ठ ",
            " of ": " / ",
            "Other date": "दूसरी तारीख",
            "Other time": "दूसरा समय",
            "Yes, cancel": "हां, रद्द करें",
            "Earlier times": "पिछले समय",
            "More times": "और समय",
            "Reschedule": "समय बदलें",
            "Choose option": "विकल्प चुनें",
            "Select appointment": "अपॉइंटमेंट चुनें",
            "Choose time": "समय चुनें",
            "Select doctor": "डॉक्टर चुनें",
            "Select language": "भाषा चुनें",
            "Choose language": "भाषा चुनें",
            "Invalid selection.": "अमान्य चयन।",
            "Options": "विकल्प",
            "No, go back": "नहीं, वापस जाएं",
            "Previous page": "पिछला पृष्ठ",
            "Next page": "अगला पृष्ठ",
            "More appointments": "और अपॉइंटमेंट",
            "Earlier appointments": "पिछले अपॉइंटमेंट",
            "Schedule a visit": "विज़िट शेड्यूल करें",
            "View upcoming": "आगामी देखें",
            "Cancel a booking": "बुकिंग रद्द करें",
            "Change date or time": "तारीख या समय बदलें",
            "More": "और",
            "More options": "और विकल्प"
        },

        // NOTE: KA/TA/ML translations below are an initial AI-assisted pass,
        // not yet reviewed by a native speaker. Treat as a starting point —
        // verify against real clinic usage before relying on them in
        // production, especially for time/date-sensitive phrases.
        KA: {
            "Welcome to {{CLINIC_NAME}}!": "{{CLINIC_NAME}} ಗೆ ಸ್ವಾಗತ!",
            "Please choose an option:": "ದಯವಿಟ್ಟು ಒಂದು ಆಯ್ಕೆಯನ್ನು ಆರಿಸಿ:",
            "Book Appointment": "ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಬುಕ್ ಮಾಡಿ",
            "My Appointments": "ನನ್ನ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್‌ಗಳು",
            "Cancel Appointment": "ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ರದ್ದುಗೊಳಿಸಿ",
            "Reschedule Appointment": "ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಮರುಹೊಂದಿಸಿ",
            "Change Language": "ಭಾಷೆ ಬದಲಾಯಿಸಿ",
            "Select a doctor:": "ವೈದ್ಯರನ್ನು ಆಯ್ಕೆಮಾಡಿ:",
            "Reply with the doctor's number.": "ವೈದ್ಯರ ಸಂಖ್ಯೆಯೊಂದಿಗೆ ಉತ್ತರಿಸಿ.",
            "Please choose a date:": "ದಯವಿಟ್ಟು ದಿನಾಂಕವನ್ನು ಆರಿಸಿ:",
            "Today": "ಇಂದು",
            "Tomorrow": "ನಾಳೆ",
            "Enter another date": "ಬೇರೆ ದಿನಾಂಕವನ್ನು ನಮೂದಿಸಿ",
            "Available slots:": "ಲಭ್ಯವಿರುವ ಸಮಯಗಳು:",
            "Please choose a time.": "ದಯವಿಟ್ಟು ಸಮಯವನ್ನು ಆರಿಸಿ.",
            "Confirm appointment?": "ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ದೃಢೀಕರಿಸುವುದೇ?",
            "Confirm": "ದೃಢೀಕರಿಸಿ",
            "Choose another time": "ಬೇರೆ ಸಮಯ ಆರಿಸಿ",
            "Cancel": "ರದ್ದುಗೊಳಿಸಿ",
            "Back to Main Menu": "ಮುಖ್ಯ ಮೆನುಗೆ ಹಿಂತಿರುಗಿ",
            "Back to main menu.": "ಮುಖ್ಯ ಮೆನುಗೆ ಹಿಂತಿರುಗಿದ್ದೀರಿ.",
            "Main Menu": "ಮುಖ್ಯ ಮೆನು",
            "Back": "ಹಿಂದೆ",
            "Invalid option.": "ಅಮಾನ್ಯ ಆಯ್ಕೆ.",
            "Please reply with:": "ದಯವಿಟ್ಟು ಇದರೊಂದಿಗೆ ಉತ್ತರಿಸಿ:",
            "Please enter the date in YYYY-MM-DD format.": "ದಯವಿಟ್ಟು ದಿನಾಂಕವನ್ನು YYYY-MM-DD ಸ್ವರೂಪದಲ್ಲಿ ನಮೂದಿಸಿ.",
            "Please enter the new date in YYYY-MM-DD format.": "ದಯವಿಟ್ಟು ಹೊಸ ದಿನಾಂಕವನ್ನು YYYY-MM-DD ಸ್ವರೂಪದಲ್ಲಿ ನಮೂದಿಸಿ.",
            "Example:": "ಉದಾಹರಣೆ:",
            "Your Appointments:": "ನಿಮ್ಮ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್‌ಗಳು:",
            "Select the appointment to cancel:": "ರದ್ದುಗೊಳಿಸಲು ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಆಯ್ಕೆಮಾಡಿ:",
            "Select the appointment to reschedule:": "ಮರುಹೊಂದಿಸಲು ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಆಯ್ಕೆಮಾಡಿ:",
            "Yes, cancel it": "ಹೌದು, ರದ್ದುಗೊಳಿಸಿ",
            "No, go back": "ಇಲ್ಲ, ಹಿಂದೆ ಹೋಗಿ",
            "Doctor selected:": "ಆಯ್ಕೆಮಾಡಿದ ವೈದ್ಯರು:",
            "Doctor:": "ವೈದ್ಯರು:",
            "Patient:": "ರೋಗಿ:",
            "Date:": "ದಿನಾಂಕ:",
            "Time:": "ಸಮಯ:",
            "New Date:": "ಹೊಸ ದಿನಾಂಕ:",
            "New Time:": "ಹೊಸ ಸಮಯ:",
            "Appointment ID:": "ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಐಡಿ:",
            "Appointment confirmed!": "ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ದೃಢೀಕರಿಸಲಾಗಿದೆ!",
            "Appointment cancelled successfully.": "ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಯಶಸ್ವಿಯಾಗಿ ರದ್ದುಗೊಳಿಸಲಾಗಿದೆ.",
            "Appointment booking cancelled.": "ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಬುಕಿಂಗ್ ರದ್ದುಗೊಳಿಸಲಾಗಿದೆ.",
            "Reschedule cancelled.": "ಮರುಹೊಂದಿಕೆ ರದ್ದುಗೊಳಿಸಲಾಗಿದೆ.",
            "Confirm reschedule?": "ಮರುಹೊಂದಿಕೆ ದೃಢೀಕರಿಸುವುದೇ?",
            "Please choose a new date:": "ದಯವಿಟ್ಟು ಹೊಸ ದಿನಾಂಕವನ್ನು ಆರಿಸಿ:",
            "Please choose a valid doctor number.": "ದಯವಿಟ್ಟು ಮಾನ್ಯ ವೈದ್ಯರ ಸಂಖ್ಯೆಯನ್ನು ಆರಿಸಿ.",
            "Sorry, there are no available slots on ": "ಕ್ಷಮಿಸಿ, ಈ ದಿನಾಂಕದಂದು ಯಾವುದೇ ಸಮಯಗಳು ಲಭ್ಯವಿಲ್ಲ ",
            "Please choose another date.": "ದಯವಿಟ್ಟು ಬೇರೆ ದಿನಾಂಕವನ್ನು ಆರಿಸಿ.",
            "No available slots remain for ": "ಇದಕ್ಕೆ ಯಾವುದೇ ಸಮಯಗಳು ಉಳಿದಿಲ್ಲ ",
            "Your booking session has expired.": "ನಿಮ್ಮ ಬುಕಿಂಗ್ ಅವಧಿ ಮುಕ್ತಾಯಗೊಂಡಿದೆ.",
            "Your reschedule session has expired.": "ನಿಮ್ಮ ಮರುಹೊಂದಿಕೆ ಅವಧಿ ಮುಕ್ತಾಯಗೊಂಡಿದೆ.",
            "Thank you for choosing {{CLINIC_NAME}}.": "{{CLINIC_NAME}} ಆಯ್ಕೆ ಮಾಡಿದ್ದಕ್ಕೆ ಧನ್ಯವಾದಗಳು.",
            "Please send Hi to start again.": "ಮತ್ತೆ ಪ್ರಾರಂಭಿಸಲು ದಯವಿಟ್ಟು Hi ಕಳುಹಿಸಿ.",
            "Sorry, I didn't understand that.": "ಕ್ಷಮಿಸಿ, ನನಗೆ ಅರ್ಥವಾಗಲಿಲ್ಲ.",
            "Language changed successfully.": "ಭಾಷೆ ಯಶಸ್ವಿಯಾಗಿ ಬದಲಾಯಿಸಲಾಗಿದೆ.",
            "Please enter your full name to complete the booking.": "ಬುಕಿಂಗ್ ಪೂರ್ಣಗೊಳಿಸಲು ದಯವಿಟ್ಟು ನಿಮ್ಮ ಪೂರ್ಣ ಹೆಸರನ್ನು ನಮೂದಿಸಿ.",
            "Please confirm your appointment:": "ದಯವಿಟ್ಟು ನಿಮ್ಮ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ದೃಢೀಕರಿಸಿ:",
            "Please enter a valid full name (at least 2 characters).": "ದಯವಿಟ್ಟು ಮಾನ್ಯ ಪೂರ್ಣ ಹೆಸರನ್ನು ನಮೂದಿಸಿ (ಕನಿಷ್ಠ 2 ಅಕ್ಷರಗಳು).",
            "Unable to save your name.": "ನಿಮ್ಮ ಹೆಸರನ್ನು ಉಳಿಸಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ.",
            "Invalid time selection.": "ಅಮಾನ್ಯ ಸಮಯ ಆಯ್ಕೆ.",
            "Please choose one of the available slots:": "ದಯವಿಟ್ಟು ಲಭ್ಯವಿರುವ ಸಮಯಗಳಲ್ಲಿ ಒಂದನ್ನು ಆರಿಸಿ:",
            "Invalid selection.": "ಅಮಾನ್ಯ ಆಯ್ಕೆ.",
            "Date selected:": "ಆಯ್ಕೆಮಾಡಿದ ದಿನಾಂಕ:",
            "Appointment Reminder": "ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಜ್ಞಾಪನೆ",
            "Reminder: ": "ಜ್ಞಾಪನೆ: ",
            " before your appointment.": " ನಿಮ್ಮ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್‌ಗೆ ಮೊದಲು.",
            "Reply Hi to reschedule or cancel.": "ಮರುಹೊಂದಿಸಲು ಅಥವಾ ರದ್ದುಗೊಳಿಸಲು Hi ಎಂದು ಉತ್ತರಿಸಿ.",
            "{{CLINIC_NAME}} is currently closed.": "{{CLINIC_NAME}} ಪ್ರಸ್ತುತ ಮುಚ್ಚಿದೆ.",
            "Our hours:": "ನಮ್ಮ ಸಮಯ:",
            "Please message us during clinic hours to book or manage appointments.": "ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಬುಕ್ ಮಾಡಲು ಅಥವಾ ನಿರ್ವಹಿಸಲು ದಯವಿಟ್ಟು ಕ್ಲಿನಿಕ್ ಸಮಯದಲ್ಲಿ ನಮಗೆ ಸಂದೇಶ ಕಳುಹಿಸಿ.",
            "Reply Hi during open hours to get started.": "ಪ್ರಾರಂಭಿಸಲು ತೆರೆದಿರುವ ಸಮಯದಲ್ಲಿ Hi ಎಂದು ಉತ್ತರಿಸಿ.",
            "How can we help you today?": "ಇಂದು ನಾವು ನಿಮಗೆ ಹೇಗೆ ಸಹಾಯ ಮಾಡಬಹುದು?",
            "Choose your doctor.": "ನಿಮ್ಮ ವೈದ್ಯರನ್ನು ಆರಿಸಿ.",
            "Choose an appointment date.": "ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ದಿನಾಂಕವನ್ನು ಆರಿಸಿ.",
            "Choose an available time.": "ಲಭ್ಯವಿರುವ ಸಮಯವನ್ನು ಆರಿಸಿ.",
            "Choose a new time.": "ಹೊಸ ಸಮಯವನ್ನು ಆರಿಸಿ.",
            "Choose your language.": "ನಿಮ್ಮ ಭಾಷೆಯನ್ನು ಆರಿಸಿ.",
            "Your appointments": "ನಿಮ್ಮ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್‌ಗಳು",
            "Select an appointment.": "ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಆಯ್ಕೆಮಾಡಿ.",
            "Cancel appointment": "ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ರದ್ದುಗೊಳಿಸಿ",
            "Select an appointment to cancel.": "ರದ್ದುಗೊಳಿಸಲು ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಆಯ್ಕೆಮಾಡಿ.",
            "Reschedule appointment": "ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಮರುಹೊಂದಿಸಿ",
            "Select an appointment to reschedule.": "ಮರುಹೊಂದಿಸಲು ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಆಯ್ಕೆಮಾಡಿ.",
            "Choose a new appointment date.": "ಹೊಸ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ದಿನಾಂಕವನ್ನು ಆರಿಸಿ.",
            "✅ Confirm appointment?": "✅ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ದೃಢೀಕರಿಸುವುದೇ?",
            "⚠️ Cancel this appointment?": "⚠️ ಈ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ರದ್ದುಗೊಳಿಸುವುದೇ?",
            "🔄 Confirm reschedule?": "🔄 ಮರುಹೊಂದಿಕೆ ದೃಢೀಕರಿಸುವುದೇ?",
            "Please choose a valid doctor.": "ದಯವಿಟ್ಟು ಮಾನ್ಯ ವೈದ್ಯರನ್ನು ಆರಿಸಿ.",
            "Please choose one of the available time slots.": "ದಯವಿಟ್ಟು ಲಭ್ಯವಿರುವ ಸಮಯಗಳಲ್ಲಿ ಒಂದನ್ನು ಆರಿಸಿ.",
            "That time slot is no longer available.": "ಆ ಸಮಯ ಸ್ಲಾಟ್ ಇನ್ನು ಲಭ್ಯವಿಲ್ಲ.",
            "Please choose another time.": "ದಯವಿಟ್ಟು ಬೇರೆ ಸಮಯ ಆರಿಸಿ.",
            "📅 Enter the appointment date.": "📅 ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ದಿನಾಂಕವನ್ನು ನಮೂದಿಸಿ.",
            "📅 Enter the new appointment date.": "📅 ಹೊಸ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ದಿನಾಂಕವನ್ನು ನಮೂದಿಸಿ.",
            "Format: YYYY-MM-DD": "ಸ್ವರೂಪ: YYYY-MM-DD",
            "Page ": "ಪುಟ ",
            " of ": " / ",
            "Other date": "ಬೇರೆ ದಿನಾಂಕ",
            "Other time": "ಬೇರೆ ಸಮಯ",
            "Yes, cancel": "ಹೌದು, ರದ್ದು",
            "Earlier times": "ಹಿಂದಿನ ಸಮಯ",
            "More times": "ಹೆಚ್ಚು ಸಮಯ",
            "Reschedule": "ಮರುಹೊಂದಿಸಿ",
            "Choose option": "ಆಯ್ಕೆಯನ್ನು ಆರಿಸಿ",
            "Select appointment": "ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಆರಿಸಿ",
            "Choose time": "ಸಮಯ ಆರಿಸಿ",
            "Select doctor": "ವೈದ್ಯರನ್ನು ಆರಿಸಿ",
            "Select language": "ಭಾಷೆ ಆರಿಸಿ",
            "Choose language": "ಭಾಷೆ ಆರಿಸಿ",
            "Invalid selection.": "ಅಮಾನ್ಯ ಆಯ್ಕೆ.",
            "Options": "ಆಯ್ಕೆಗಳು",
            "No, go back": "ಇಲ್ಲ, ಹಿಂದೆ ಹೋಗಿ",
            "Previous page": "ಹಿಂದಿನ ಪುಟ",
            "Next page": "ಮುಂದಿನ ಪುಟ",
            "More appointments": "ಹೆಚ್ಚು ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್‌ಗಳು",
            "Earlier appointments": "ಹಿಂದಿನ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್‌ಗಳು",
            "Schedule a visit": "ಭೇಟಿ ನಿಗದಿಪಡಿಸಿ",
            "View upcoming": "ಮುಂದಿನವುಗಳನ್ನು ನೋಡಿ",
            "Cancel a booking": "ಬುಕಿಂಗ್ ರದ್ದುಗೊಳಿಸಿ",
            "Change date or time": "ದಿನಾಂಕ ಅಥವಾ ಸಮಯ ಬದಲಾಯಿಸಿ",
            "More": "ಇನ್ನಷ್ಟು",
            "More options": "ಹೆಚ್ಚಿನ ಆಯ್ಕೆಗಳು"
        },

        TA: {
            "Welcome to {{CLINIC_NAME}}!": "{{CLINIC_NAME}}க்கு வரவேற்கிறோம்!",
            "Please choose an option:": "தயவுசெய்து ஒரு விருப்பத்தைத் தேர்ந்தெடுக்கவும்:",
            "Book Appointment": "அப்பாயின்ட்மென்ட் பதிவு செய்யவும்",
            "My Appointments": "எனது அப்பாயின்ட்மென்ட்கள்",
            "Cancel Appointment": "அப்பாயின்ட்மென்டை ரத்து செய்யவும்",
            "Reschedule Appointment": "அப்பாயின்ட்மென்டை மாற்றியமைக்கவும்",
            "Change Language": "மொழியை மாற்றவும்",
            "Select a doctor:": "மருத்துவரைத் தேர்ந்தெடுக்கவும்:",
            "Reply with the doctor's number.": "மருத்துவரின் எண்ணுடன் பதிலளிக்கவும்.",
            "Please choose a date:": "தயவுசெய்து தேதியைத் தேர்ந்தெடுக்கவும்:",
            "Today": "இன்று",
            "Tomorrow": "நாளை",
            "Enter another date": "வேறு தேதியை உள்ளிடவும்",
            "Available slots:": "கிடைக்கும் நேரங்கள்:",
            "Please choose a time.": "தயவுசெய்து நேரத்தைத் தேர்ந்தெடுக்கவும்.",
            "Confirm appointment?": "அப்பாயின்ட்மென்டை உறுதிப்படுத்தவா?",
            "Confirm": "உறுதிப்படுத்து",
            "Choose another time": "வேறு நேரத்தைத் தேர்ந்தெடு",
            "Cancel": "ரத்து செய்",
            "Back to Main Menu": "முதன்மை மெனுவிற்குத் திரும்பு",
            "Back to main menu.": "முதன்மை மெனுவிற்குத் திரும்பியுள்ளீர்கள்.",
            "Main Menu": "முதன்மை மெனு",
            "Back": "பின்செல்",
            "Invalid option.": "தவறான விருப்பம்.",
            "Please reply with:": "தயவுசெய்து இதனுடன் பதிலளிக்கவும்:",
            "Please enter the date in YYYY-MM-DD format.": "தயவுசெய்து தேதியை YYYY-MM-DD வடிவத்தில் உள்ளிடவும்.",
            "Please enter the new date in YYYY-MM-DD format.": "தயவுசெய்து புதிய தேதியை YYYY-MM-DD வடிவத்தில் உள்ளிடவும்.",
            "Example:": "எடுத்துக்காட்டு:",
            "Your Appointments:": "உங்கள் அப்பாயின்ட்மென்ட்கள்:",
            "Select the appointment to cancel:": "ரத்து செய்ய அப்பாயின்ட்மென்டைத் தேர்ந்தெடுக்கவும்:",
            "Select the appointment to reschedule:": "மாற்றியமைக்க அப்பாயின்ட்மென்டைத் தேர்ந்தெடுக்கவும்:",
            "Yes, cancel it": "ஆம், ரத்து செய்யவும்",
            "No, go back": "இல்லை, திரும்பிச் செல்",
            "Doctor selected:": "தேர்ந்தெடுக்கப்பட்ட மருத்துவர்:",
            "Doctor:": "மருத்துவர்:",
            "Patient:": "நோயாளி:",
            "Date:": "தேதி:",
            "Time:": "நேரம்:",
            "New Date:": "புதிய தேதி:",
            "New Time:": "புதிய நேரம்:",
            "Appointment ID:": "அப்பாயின்ட்மென்ட் ஐடி:",
            "Appointment confirmed!": "அப்பாயின்ட்மென்ட் உறுதிசெய்யப்பட்டது!",
            "Appointment cancelled successfully.": "அப்பாயின்ட்மென்ட் வெற்றிகரமாக ரத்து செய்யப்பட்டது.",
            "Appointment booking cancelled.": "அப்பாயின்ட்மென்ட் பதிவு ரத்து செய்யப்பட்டது.",
            "Reschedule cancelled.": "மாற்றியமைத்தல் ரத்து செய்யப்பட்டது.",
            "Confirm reschedule?": "மாற்றியமைப்பதை உறுதிப்படுத்தவா?",
            "Please choose a new date:": "தயவுசெய்து புதிய தேதியைத் தேர்ந்தெடுக்கவும்:",
            "Please choose a valid doctor number.": "தயவுசெய்து சரியான மருத்துவர் எண்ணைத் தேர்ந்தெடுக்கவும்.",
            "Sorry, there are no available slots on ": "மன்னிக்கவும், இந்த தேதியில் நேரங்கள் எதுவும் இல்லை ",
            "Please choose another date.": "தயவுசெய்து வேறு தேதியைத் தேர்ந்தெடுக்கவும்.",
            "No available slots remain for ": "இதற்கு நேரங்கள் எதுவும் மீதமில்லை ",
            "Your booking session has expired.": "உங்கள் பதிவு அமர்வு காலாவதியானது.",
            "Your reschedule session has expired.": "உங்கள் மாற்றியமைப்பு அமர்வு காலாவதியானது.",
            "Thank you for choosing {{CLINIC_NAME}}.": "{{CLINIC_NAME}}-ஐத் தேர்ந்தெடுத்ததற்கு நன்றி.",
            "Please send Hi to start again.": "மீண்டும் தொடங்க தயவுசெய்து Hi அனுப்பவும்.",
            "Sorry, I didn't understand that.": "மன்னிக்கவும், எனக்கு அது புரியவில்லை.",
            "Language changed successfully.": "மொழி வெற்றிகரமாக மாற்றப்பட்டது.",
            "Please enter your full name to complete the booking.": "பதிவை முடிக்க தயவுசெய்து உங்கள் முழுப் பெயரை உள்ளிடவும்.",
            "Please confirm your appointment:": "தயவுசெய்து உங்கள் அப்பாயின்ட்மென்டை உறுதிப்படுத்தவும்:",
            "Please enter a valid full name (at least 2 characters).": "தயவுசெய்து சரியான முழுப் பெயரை உள்ளிடவும் (குறைந்தது 2 எழுத்துகள்).",
            "Unable to save your name.": "உங்கள் பெயரைச் சேமிக்க முடியவில்லை.",
            "Invalid time selection.": "தவறான நேரத் தேர்வு.",
            "Please choose one of the available slots:": "தயவுசெய்து கிடைக்கும் நேரங்களில் ஒன்றைத் தேர்ந்தெடுக்கவும்:",
            "Invalid selection.": "தவறான தேர்வு.",
            "Date selected:": "தேர்ந்தெடுக்கப்பட்ட தேதி:",
            "Appointment Reminder": "அப்பாயின்ட்மென்ட் நினைவூட்டல்",
            "Reminder: ": "நினைவூட்டல்: ",
            " before your appointment.": " உங்கள் அப்பாயின்ட்மென்டுக்கு முன்.",
            "Reply Hi to reschedule or cancel.": "மாற்றியமைக்க அல்லது ரத்து செய்ய Hi என பதிலளிக்கவும்.",
            "{{CLINIC_NAME}} is currently closed.": "{{CLINIC_NAME}} தற்போது மூடப்பட்டுள்ளது.",
            "Our hours:": "எங்கள் நேரம்:",
            "Please message us during clinic hours to book or manage appointments.": "அப்பாயின்ட்மென்ட் பதிவு செய்ய அல்லது நிர்வகிக்க கிளினிக் நேரத்தில் எங்களுக்கு செய்தி அனுப்பவும்.",
            "Reply Hi during open hours to get started.": "தொடங்க திறந்திருக்கும் நேரத்தில் Hi என பதிலளிக்கவும்.",
            "How can we help you today?": "இன்று நாங்கள் உங்களுக்கு எப்படி உதவலாம்?",
            "Choose your doctor.": "உங்கள் மருத்துவரைத் தேர்ந்தெடுக்கவும்.",
            "Choose an appointment date.": "அப்பாயின்ட்மென்ட் தேதியைத் தேர்ந்தெடுக்கவும்.",
            "Choose an available time.": "கிடைக்கும் நேரத்தைத் தேர்ந்தெடுக்கவும்.",
            "Choose a new time.": "புதிய நேரத்தைத் தேர்ந்தெடுக்கவும்.",
            "Choose your language.": "உங்கள் மொழியைத் தேர்ந்தெடுக்கவும்.",
            "Your appointments": "உங்கள் அப்பாயின்ட்மென்ட்கள்",
            "Select an appointment.": "அப்பாயின்ட்மென்டைத் தேர்ந்தெடுக்கவும்.",
            "Cancel appointment": "அப்பாயின்ட்மென்டை ரத்து செய்யவும்",
            "Select an appointment to cancel.": "ரத்து செய்ய அப்பாயின்ட்மென்டைத் தேர்ந்தெடுக்கவும்.",
            "Reschedule appointment": "அப்பாயின்ட்மென்டை மாற்றியமைக்கவும்",
            "Select an appointment to reschedule.": "மாற்றியமைக்க அப்பாயின்ட்மென்டைத் தேர்ந்தெடுக்கவும்.",
            "Choose a new appointment date.": "புதிய அப்பாயின்ட்மென்ட் தேதியைத் தேர்ந்தெடுக்கவும்.",
            "✅ Confirm appointment?": "✅ அப்பாயின்ட்மென்டை உறுதிப்படுத்தவா?",
            "⚠️ Cancel this appointment?": "⚠️ இந்த அப்பாயின்ட்மென்டை ரத்து செய்யவா?",
            "🔄 Confirm reschedule?": "🔄 மாற்றியமைப்பை உறுதிப்படுத்தவா?",
            "Please choose a valid doctor.": "தயவுசெய்து சரியான மருத்துவரைத் தேர்ந்தெடுக்கவும்.",
            "Please choose one of the available time slots.": "தயவுசெய்து கிடைக்கும் நேரங்களில் ஒன்றைத் தேர்ந்தெடுக்கவும்.",
            "That time slot is no longer available.": "அந்த நேரம் இனி கிடைக்கவில்லை.",
            "Please choose another time.": "தயவுசெய்து வேறு நேரத்தைத் தேர்ந்தெடுக்கவும்.",
            "📅 Enter the appointment date.": "📅 அப்பாயின்ட்மென்ட் தேதியை உள்ளிடவும்.",
            "📅 Enter the new appointment date.": "📅 புதிய அப்பாயின்ட்மென்ட் தேதியை உள்ளிடவும்.",
            "Format: YYYY-MM-DD": "வடிவம்: YYYY-MM-DD",
            "Page ": "பக்கம் ",
            " of ": " / ",
            "Other date": "வேறு தேதி",
            "Other time": "வேறு நேரம்",
            "Yes, cancel": "ஆம், ரத்து",
            "Earlier times": "முந்தைய நேரம்",
            "More times": "மேலும் நேரம்",
            "Reschedule": "மாற்றியமை",
            "Choose option": "விருப்பத்தைத் தேர்ந்தெடுக்கவும்",
            "Select appointment": "அப்பாயின்ட்மென்டைத் தேர்ந்தெடுக்கவும்",
            "Choose time": "நேரத்தைத் தேர்ந்தெடுக்கவும்",
            "Select doctor": "மருத்துவரைத் தேர்ந்தெடுக்கவும்",
            "Select language": "மொழியைத் தேர்ந்தெடுக்கவும்",
            "Choose language": "மொழியைத் தேர்ந்தெடுக்கவும்",
            "Invalid selection.": "தவறான தேர்வு.",
            "Options": "விருப்பங்கள்",
            "No, go back": "இல்லை, திரும்பிச் செல்லுங்கள்",
            "Previous page": "முந்தைய பக்கம்",
            "Next page": "அடுத்த பக்கம்",
            "More appointments": "மேலும் அப்பாயின்ட்மென்ட்கள்",
            "Earlier appointments": "முந்தைய அப்பாயின்ட்மென்ட்கள்",
            "Schedule a visit": "வருகையை திட்டமிடுங்கள்",
            "View upcoming": "வரவிருப்பவை பாருங்கள்",
            "Cancel a booking": "பதிவை ரத்து செய்யுங்கள்",
            "Change date or time": "தேதி அல்லது நேரத்தை மாற்றுங்கள்",
            "More": "மேலும்",
            "More options": "மேலும் விருப்பங்கள்"
        },

        ML: {
            "Welcome to {{CLINIC_NAME}}!": "{{CLINIC_NAME}} ലേക്ക് സ്വാഗതം!",
            "Please choose an option:": "ദയവായി ഒരു ഓപ്ഷൻ തിരഞ്ഞെടുക്കുക:",
            "Book Appointment": "അപ്പോയിന്റ്മെന്റ് ബുക്ക് ചെയ്യുക",
            "My Appointments": "എന്റെ അപ്പോയിന്റ്മെന്റുകൾ",
            "Cancel Appointment": "അപ്പോയിന്റ്മെന്റ് റദ്ദാക്കുക",
            "Reschedule Appointment": "അപ്പോയിന്റ്മെന്റ് പുനഃക്രമീകരിക്കുക",
            "Change Language": "ഭാഷ മാറ്റുക",
            "Select a doctor:": "ഒരു ഡോക്ടറെ തിരഞ്ഞെടുക്കുക:",
            "Reply with the doctor's number.": "ഡോക്ടറുടെ നമ്പർ ഉപയോഗിച്ച് മറുപടി നൽകുക.",
            "Please choose a date:": "ദയവായി ഒരു തീയതി തിരഞ്ഞെടുക്കുക:",
            "Today": "ഇന്ന്",
            "Tomorrow": "നാളെ",
            "Enter another date": "മറ്റൊരു തീയതി നൽകുക",
            "Available slots:": "ലഭ്യമായ സമയങ്ങൾ:",
            "Please choose a time.": "ദയവായി ഒരു സമയം തിരഞ്ഞെടുക്കുക.",
            "Confirm appointment?": "അപ്പോയിന്റ്മെന്റ് സ്ഥിരീകരിക്കണോ?",
            "Confirm": "സ്ഥിരീകരിക്കുക",
            "Choose another time": "മറ്റൊരു സമയം തിരഞ്ഞെടുക്കുക",
            "Cancel": "റദ്ദാക്കുക",
            "Back to Main Menu": "പ്രധാന മെനുവിലേക്ക് മടങ്ങുക",
            "Back to main menu.": "പ്രധാന മെനുവിലേക്ക് മടങ്ങി.",
            "Main Menu": "പ്രധാന മെനു",
            "Back": "തിരികെ",
            "Invalid option.": "അസാധുവായ ഓപ്ഷൻ.",
            "Please reply with:": "ദയവായി ഇതുപയോഗിച്ച് മറുപടി നൽകുക:",
            "Please enter the date in YYYY-MM-DD format.": "ദയവായി തീയതി YYYY-MM-DD ഫോർമാറ്റിൽ നൽകുക.",
            "Please enter the new date in YYYY-MM-DD format.": "ദയവായി പുതിയ തീയതി YYYY-MM-DD ഫോർമാറ്റിൽ നൽകുക.",
            "Example:": "ഉദാഹരണം:",
            "Your Appointments:": "നിങ്ങളുടെ അപ്പോയിന്റ്മെന്റുകൾ:",
            "Select the appointment to cancel:": "റദ്ദാക്കാനുള്ള അപ്പോയിന്റ്മെന്റ് തിരഞ്ഞെടുക്കുക:",
            "Select the appointment to reschedule:": "പുനഃക്രമീകരിക്കാനുള്ള അപ്പോയിന്റ്മെന്റ് തിരഞ്ഞെടുക്കുക:",
            "Yes, cancel it": "അതെ, റദ്ദാക്കുക",
            "No, go back": "ഇല്ല, തിരികെ പോകുക",
            "Doctor selected:": "തിരഞ്ഞെടുത്ത ഡോക്ടർ:",
            "Doctor:": "ഡോക്ടർ:",
            "Patient:": "രോഗി:",
            "Date:": "തീയതി:",
            "Time:": "സമയം:",
            "New Date:": "പുതിയ തീയതി:",
            "New Time:": "പുതിയ സമയം:",
            "Appointment ID:": "അപ്പോയിന്റ്മെന്റ് ഐഡി:",
            "Appointment confirmed!": "അപ്പോയിന്റ്മെന്റ് സ്ഥിരീകരിച്ചു!",
            "Appointment cancelled successfully.": "അപ്പോയിന്റ്മെന്റ് വിജയകരമായി റദ്ദാക്കി.",
            "Appointment booking cancelled.": "അപ്പോയിന്റ്മെന്റ് ബുക്കിംഗ് റദ്ദാക്കി.",
            "Reschedule cancelled.": "പുനഃക്രമീകരണം റദ്ദാക്കി.",
            "Confirm reschedule?": "പുനഃക്രമീകരണം സ്ഥിരീകരിക്കണോ?",
            "Please choose a new date:": "ദയവായി ഒരു പുതിയ തീയതി തിരഞ്ഞെടുക്കുക:",
            "Please choose a valid doctor number.": "ദയവായി സാധുവായ ഡോക്ടർ നമ്പർ തിരഞ്ഞെടുക്കുക.",
            "Sorry, there are no available slots on ": "ക്ഷമിക്കണം, ഈ തീയതിയിൽ സമയങ്ങളൊന്നും ലഭ്യമല്ല ",
            "Please choose another date.": "ദയവായി മറ്റൊരു തീയതി തിരഞ്ഞെടുക്കുക.",
            "No available slots remain for ": "ഇതിനായി സമയങ്ങളൊന്നും ബാക്കിയില്ല ",
            "Your booking session has expired.": "നിങ്ങളുടെ ബുക്കിംഗ് സെഷൻ കാലഹരണപ്പെട്ടു.",
            "Your reschedule session has expired.": "നിങ്ങളുടെ പുനഃക്രമീകരണ സെഷൻ കാലഹരണപ്പെട്ടു.",
            "Thank you for choosing {{CLINIC_NAME}}.": "{{CLINIC_NAME}} തിരഞ്ഞെടുത്തതിന് നന്ദി.",
            "Please send Hi to start again.": "വീണ്ടും തുടങ്ങാൻ ദയവായി Hi അയയ്ക്കുക.",
            "Sorry, I didn't understand that.": "ക്ഷമിക്കണം, എനിക്ക് അത് മനസ്സിലായില്ല.",
            "Language changed successfully.": "ഭാഷ വിജയകരമായി മാറ്റി.",
            "Please enter your full name to complete the booking.": "ബുക്കിംഗ് പൂർത്തിയാക്കാൻ ദയവായി നിങ്ങളുടെ പൂർണ്ണ നാമം നൽകുക.",
            "Please confirm your appointment:": "ദയവായി നിങ്ങളുടെ അപ്പോയിന്റ്മെന്റ് സ്ഥിരീകരിക്കുക:",
            "Please enter a valid full name (at least 2 characters).": "ദയവായി സാധുവായ പൂർണ്ണ നാമം നൽകുക (കുറഞ്ഞത് 2 അക്ഷരങ്ങൾ).",
            "Unable to save your name.": "നിങ്ങളുടെ പേര് സേവ് ചെയ്യാൻ കഴിഞ്ഞില്ല.",
            "Invalid time selection.": "അസാധുവായ സമയ തിരഞ്ഞെടുപ്പ്.",
            "Please choose one of the available slots:": "ദയവായി ലഭ്യമായ സമയങ്ങളിൽ ഒന്ന് തിരഞ്ഞെടുക്കുക:",
            "Invalid selection.": "അസാധുവായ തിരഞ്ഞെടുപ്പ്.",
            "Date selected:": "തിരഞ്ഞെടുത്ത തീയതി:",
            "Appointment Reminder": "അപ്പോയിന്റ്മെന്റ് ഓർമ്മപ്പെടുത്തൽ",
            "Reminder: ": "ഓർമ്മപ്പെടുത്തൽ: ",
            " before your appointment.": " നിങ്ങളുടെ അപ്പോയിന്റ്മെന്റിന് മുമ്പ്.",
            "Reply Hi to reschedule or cancel.": "പുനഃക്രമീകരിക്കാനോ റദ്ദാക്കാനോ Hi എന്ന് മറുപടി നൽകുക.",
            "{{CLINIC_NAME}} is currently closed.": "{{CLINIC_NAME}} നിലവിൽ അടച്ചിരിക്കുന്നു.",
            "Our hours:": "ഞങ്ങളുടെ സമയം:",
            "Please message us during clinic hours to book or manage appointments.": "അപ്പോയിന്റ്മെന്റ് ബുക്ക് ചെയ്യാനോ കൈകാര്യം ചെയ്യാനോ ക്ലിനിക് സമയത്ത് ഞങ്ങൾക്ക് സന്ദേശം അയയ്ക്കുക.",
            "Reply Hi during open hours to get started.": "തുടങ്ങാൻ തുറന്നിരിക്കുന്ന സമയത്ത് Hi എന്ന് മറുപടി നൽകുക.",
            "How can we help you today?": "ഇന്ന് ഞങ്ങൾക്ക് നിങ്ങളെ എങ്ങനെ സഹായിക്കാനാകും?",
            "Choose your doctor.": "നിങ്ങളുടെ ഡോക്ടറെ തിരഞ്ഞെടുക്കുക.",
            "Choose an appointment date.": "അപ്പോയിന്റ്മെന്റ് തീയതി തിരഞ്ഞെടുക്കുക.",
            "Choose an available time.": "ലഭ്യമായ സമയം തിരഞ്ഞെടുക്കുക.",
            "Choose a new time.": "പുതിയ സമയം തിരഞ്ഞെടുക്കുക.",
            "Choose your language.": "നിങ്ങളുടെ ഭാഷ തിരഞ്ഞെടുക്കുക.",
            "Your appointments": "നിങ്ങളുടെ അപ്പോയിന്റ്മെന്റുകൾ",
            "Select an appointment.": "അപ്പോയിന്റ്മെന്റ് തിരഞ്ഞെടുക്കുക.",
            "Cancel appointment": "അപ്പോയിന്റ്മെന്റ് റദ്ദാക്കുക",
            "Select an appointment to cancel.": "റദ്ദാക്കാൻ അപ്പോയിന്റ്മെന്റ് തിരഞ്ഞെടുക്കുക.",
            "Reschedule appointment": "അപ്പോയിന്റ്മെന്റ് പുനഃക്രമീകരിക്കുക",
            "Select an appointment to reschedule.": "പുനഃക്രമീകരിക്കാൻ അപ്പോയിന്റ്മെന്റ് തിരഞ്ഞെടുക്കുക.",
            "Choose a new appointment date.": "പുതിയ അപ്പോയിന്റ്മെന്റ് തീയതി തിരഞ്ഞെടുക്കുക.",
            "✅ Confirm appointment?": "✅ അപ്പോയിന്റ്മെന്റ് സ്ഥിരീകരിക്കണോ?",
            "⚠️ Cancel this appointment?": "⚠️ ഈ അപ്പോയിന്റ്മെന്റ് റദ്ദാക്കണോ?",
            "🔄 Confirm reschedule?": "🔄 പുനഃക്രമീകരണം സ്ഥിരീകരിക്കണോ?",
            "Please choose a valid doctor.": "ദയവായി സാധുവായ ഡോക്ടറെ തിരഞ്ഞെടുക്കുക.",
            "Please choose one of the available time slots.": "ദയവായി ലഭ്യമായ സമയങ്ങളിൽ ഒന്ന് തിരഞ്ഞെടുക്കുക.",
            "That time slot is no longer available.": "ആ സമയ സ്ലോട്ട് ഇനി ലഭ്യമല്ല.",
            "Please choose another time.": "ദയവായി മറ്റൊരു സമയം തിരഞ്ഞെടുക്കുക.",
            "📅 Enter the appointment date.": "📅 അപ്പോയിന്റ്മെന്റ് തീയതി നൽകുക.",
            "📅 Enter the new appointment date.": "📅 പുതിയ അപ്പോയിന്റ്മെന്റ് തീയതി നൽകുക.",
            "Format: YYYY-MM-DD": "ഫോർമാറ്റ്: YYYY-MM-DD",
            "Page ": "പേജ് ",
            " of ": " / ",
            "Other date": "മറ്റൊരു തീയതി",
            "Other time": "മറ്റൊരു സമയം",
            "Yes, cancel": "അതെ, റദ്ദാക്കുക",
            "Earlier times": "മുമ്പത്തെ സമയം",
            "More times": "കൂടുതൽ സമയം",
            "Reschedule": "പുനഃക്രമീകരിക്കുക",
            "Choose option": "ഓപ്ഷൻ തിരഞ്ഞെടുക്കുക",
            "Select appointment": "അപ്പോയിന്റ്മെന്റ് തിരഞ്ഞെടുക്കുക",
            "Choose time": "സമയം തിരഞ്ഞെടുക്കുക",
            "Select doctor": "ഡോക്ടറെ തിരഞ്ഞെടുക്കുക",
            "Select language": "ഭാഷ തിരഞ്ഞെടുക്കുക",
            "Choose language": "ഭാഷ തിരഞ്ഞെടുക്കുക",
            "Invalid selection.": "അസാധുവായ തിരഞ്ഞെടുപ്പ്.",
            "Options": "ഓപ്ഷനുകൾ",
            "No, go back": "ഇല്ല, തിരികെ പോകുക",
            "Previous page": "മുൻ പേജ്",
            "Next page": "അടുത്ത പേജ്",
            "More appointments": "കൂടുതൽ അപ്പോയിന്റ്മെന്റുകൾ",
            "Earlier appointments": "മുൻ അപ്പോയിന്റ്മെന്റുകൾ",
            "Schedule a visit": "സന്ദർശനം ഷെഡ്യൂൾ ചെയ്യുക",
            "View upcoming": "വരാനിരിക്കുന്നവ കാണുക",
            "Cancel a booking": "ബുക്കിംഗ് റദ്ദാക്കുക",
            "Change date or time": "തീയതി അല്ലെങ്കിൽ സമയം മാറ്റുക",
            "More": "കൂടുതൽ",
            "More options": "കൂടുതൽ ഓപ്ഷനുകൾ"
        }
    };

    const dictionary = translations[selectedLanguage] || {};
    let localizedMessage = String(message);

    Object.keys(dictionary)
        .sort(function (a, b) {
            return b.length - a.length;
        })
        .forEach(function (englishText) {
            localizedMessage = localizedMessage
                .split(englishText)
                .join(dictionary[englishText]);
        });

    return applyClinicNamePlaceholder(localizedMessage);
}



// Always substitutes {{CLINIC_NAME}} with the clinic's configured name,
// regardless of the patient's selected language. Both the English
// early-return and the translated path in localizeWhatsAppReply() above
// funnel through this, so a source message can use the placeholder
// once and localize correctly in every language.
function applyClinicNamePlaceholder(message) {

    return String(message)
        .split("{{CLINIC_NAME}}")
        .join(getClinicName());
}



function localizeInteractiveMenu(
    language,
    interactive
) {

    if (
        !interactive ||
        String(language || "EN").toUpperCase() === "EN"
    ) {
        return interactive;
    }

    const copy =
        JSON.parse(
            JSON.stringify(interactive)
        );

    if (
        copy.type === "button" &&
        copy.buttons
    ) {

        copy.buttons =
            copy.buttons.map(
                function (button) {

                    return {
                        id: button.id,
                        title:
                            truncateInteractiveLabel(
                                localizeWhatsAppReply(
                                    language,
                                    button.title
                                ),
                                20
                            )
                    };
                }
            );
    }

    if (
        copy.type === "list"
    ) {

        if (copy.buttonLabel) {

            copy.buttonLabel =
                truncateInteractiveLabel(
                    localizeWhatsAppReply(
                        language,
                        copy.buttonLabel
                    ),
                    20
                );
        }

        if (copy.sections) {

            copy.sections =
                copy.sections.map(
                    function (section) {

                        return {
                            title:
                                truncateInteractiveLabel(
                                    localizeWhatsAppReply(
                                        language,
                                        section.title || ""
                                    ),
                                    24
                                ),
                            rows:
                                (section.rows || [])
                                    .map(
                                        function (row) {

                                            return {
                                                id: row.id,
                                                title:
                                                    truncateInteractiveLabel(
                                                        localizeWhatsAppReply(
                                                            language,
                                                            row.title
                                                        ),
                                                        24
                                                    ),
                                                description:
                                                    truncateInteractiveLabel(
                                                        localizeWhatsAppReply(
                                                            language,
                                                            row.description || ""
                                                        ),
                                                        72
                                                    )
                                            };
                                        }
                                    )
                        };
                    }
                );
        }
    }

    return copy;
}



function formatDoctorLeavesMenu() {

    return (
        "🏖 Manage Leaves\n\n" +
        "1️⃣ Add single-day leave\n" +
        "2️⃣ View upcoming leaves\n" +
        "3️⃣ Cancel a leave\n" +
        "4️⃣ Add leave range"
    );
}


function formatDoctorUpcomingLeaves(doctorId) {

    const leaves =
        getDoctorUpcomingLeaves(doctorId);

    if (leaves.length === 0) {
        return "No upcoming leaves.";
    }

    let text =
        "Upcoming leaves:\n\n";

    leaves.forEach(
        function (leave, index) {
            text +=
                (index + 1) +
                ". " +
                leave.date +
                (
                    leave.reason
                        ? " — " + leave.reason
                        : ""
                ) +
                "\n";
        }
    );

    return text;
}


function formatDoctorPatientsList(doctorId) {

    const patients =
        getDoctorPatientsSeen(doctorId);

    if (patients.length === 0) {
        return (
            "👥 My Patients\n\n" +
            "No patients found yet."
        );
    }

    let text =
        "👥 My Patients (" +
        patients.length +
        ")\n\n";

    const limit =
        Math.min(patients.length, 20);

    for (let i = 0; i < limit; i++) {

        const patient =
            patients[i];

        text +=
            (i + 1) +
            ". " +
            patient.name +
            " • 📞 " +
            maskPhone(patient.phone) +
            " • " +
            patient.visitCount +
            " visit(s)";

        if (patient.lastVisit) {
            text +=
                " • last " +
                patient.lastVisit;
        }

        text += "\n";
    }

    if (patients.length > 20) {
        text +=
            "\n(Showing first 20 patients)";
    }

    return text;
}


function formatDoctorSchedule(result, title) {
    if (!result || !result.success) {
        return "❌ " + (result && result.message || "Unable to load schedule.");
    }
    let text = "📋 " + title + "\n\n";
    if (!result.appointments || result.appointments.length === 0) {
        return text + "No appointments found.";
    }
    result.appointments.forEach(function (appointment, index) {
        const phoneText = appointment.phone ?
            " • 📞 " + maskPhone(appointment.phone) :
            "";
        text += (index + 1) + ". " + appointment.time + " — " +
            appointment.patientName + phoneText + "\n";
    });
    return text;
}


function formatDoctorWeek(result) {
    if (!result || !result.success) return "❌ Unable to load weekly schedule.";
    let text = "📅 Weekly Schedule\n\n";
    Object.keys(result.week).forEach(function (date) {
        const day = result.week[date];
        text += day.day + ", " + date + ": " +
            (day.appointments.length || "No") + " appointment(s)\n";
    });
    return text;
}


function formatDoctorNext(result) {
    if (!result || !result.success) {
        return "❌ " + (result && result.message || "Unable to load next appointment.");
    }
    if (!result.appointment) {
        return "📌 Next Appointment\n\n" +
            (result.message || "No upcoming appointments.");
    }
    const appointment = result.appointment;
    const phoneText = appointment.phone ?
        " • 📞 " + maskPhone(appointment.phone) :
        "";
    return "📌 Next Appointment\n\n" +
        appointment.date + " " + appointment.time + " — " +
        appointment.patientName + phoneText;
}



function buildCustomDateEntryPrompt(isReschedule) {

    const prefix =
        isReschedule
            ? "📅 Enter the new appointment date."
            : "📅 Enter the appointment date.";

    return (
        prefix +
        "\n\n" +
        "Format: YYYY-MM-DD\n" +
        "Example: 2026-08-25"
    );
}


function buildDoctorScheduleDateEntryPrompt() {

    return (
        "📅 Enter the date to view.\n\n" +
        "Format: YYYY-MM-DD\n" +
        "Example: 2026-08-25"
    );
}


function validateScheduleViewISODate(typedDate) {

    const trimmed =
        String(typedDate || "").trim();

    if (!isValidISODate(trimmed)) {

        return {
            valid: false,
            message:
                "❌ That doesn't look like a valid date.\n\n" +
                buildDoctorScheduleDateEntryPrompt()
        };
    }

    return {
        valid: true,
        date: trimmed
    };
}


function buildBookingDateSelectionIntro(session) {

    const doctorName =
        session &&
        session.doctorId
            ? findDoctorById(session.doctorId)
            : "";

    if (doctorName) {

        return (
            "👨‍⚕️ " +
            doctorName +
            "\n\nChoose an appointment date."
        );
    }

    return "Choose an appointment date.";
}


function buildRescheduleDateSelectionIntro(session) {

    const doctorName =
        session &&
        session.doctorId
            ? findDoctorById(session.doctorId)
            : "Doctor";

    return (
        "🔄 " +
        (doctorName || "Doctor") +
        "\n\nChoose a new appointment date."
    );
}


function buildDoctorRescheduleDateIntro(doctorId) {

    return (
        "🔄 " +
        (findDoctorById(doctorId) || "Doctor") +
        "\n\nChoose a new appointment date."
    );
}



function buildBookNamePrompt() {

    return (
        "👤 Please enter your full name to complete the booking.\n\n" +
        "Example: Ravi Kumar"
    );
}



function buildInvalidPatientNameReply() {

    return (
        "❌ Please enter a valid full name (at least 2 characters).\n\n" +
        "Example: Ravi Kumar"
    );
}



function buildBookingConfirmationMessage(
    session,
    patientName
) {

    return (
        "✅ Confirm appointment?\n\n" +
        "👤 " + patientName + "\n" +
        "👨‍⚕️ " +
        (
            findDoctorById(
                session.doctorId
            ) || "Unknown Doctor"
        ) +
        "\n" +
        "📅 " +
        formatWhatsAppDisplayDate(
            session.date
        ) +
        "\n" +
        "🕐 " + session.time
    );
}
