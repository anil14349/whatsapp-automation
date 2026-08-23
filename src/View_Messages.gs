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
            "   🕐 " + appt.time + "\n" +
            "   🆔 " + appt.appointmentId +
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



function buildAppointmentPickerPrompt(
    title,
    selectLine,
    appointments
) {

    return (
        title +
        "\n\n" +
        selectLine +
        "\n\n" +
        formatAppointmentsListForWhatsApp(
            appointments
        ) +
        "0️⃣ Back to Main Menu"
    );
}



function buildInvalidSlotSelectionReply(slots) {

    return (
        "❌ Invalid time selection.\n\n" +
        "Please choose one of the available slots:\n\n" +
        formatAvailableSlotsForWhatsApp(slots)
    );
}



function buildCancelConfirmMessage(chosen) {

    const doctorName =
        findDoctorById(
            chosen.doctorId
        ) || "Unknown Doctor";

    return (
        "❌ Cancel this appointment?\n\n" +
        "👨‍⚕️ Doctor: " + doctorName + "\n" +
        "📅 Date: " + chosen.date + "\n" +
        "🕐 Time: " + chosen.time + "\n" +
        "🆔 " + chosen.appointmentId +
        "\n\n" +
        "1️⃣ Yes, cancel it\n" +
        "2️⃣ No, go back"
    );
}



function buildRescheduleSlotConfirmMessage(
    session,
    newDate,
    selectedTime
) {

    return (
        "🕐 New time selected: " +
        selectedTime +
        "\n\n" +
        "👨‍⚕️ Doctor: " +
        (
            findDoctorById(
                session.doctorId
            ) || "Unknown Doctor"
        ) +
        "\n" +
        "📅 New Date: " +
        newDate +
        "\n" +
        "🕐 New Time: " +
        selectedTime +
        "\n\n" +
        "Confirm reschedule?\n\n" +
        "1️⃣ Confirm\n" +
        "2️⃣ Choose another time\n" +
        "3️⃣ Cancel"
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
            "   🕐 " + appt.time + "\n" +
            "   🆔 " + appt.appointmentId +
            "\n\n";
    }

    return text;
}



function buildDoctorPatientAppointmentPickerPrompt(
    title,
    selectLine,
    appointments
) {

    return (
        title +
        "\n\n" +
        selectLine +
        "\n\n" +
        formatDoctorPatientAppointmentsListForWhatsApp(
            appointments
        ) +
        "0️⃣ Doctor Portal"
    );
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
        chosen.time +
        "\n" +
        "🆔 " +
        chosen.appointmentId +
        "\n\n" +
        "1️⃣ Yes, cancel it\n" +
        "2️⃣ No, go back"
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
        "🕐 New time selected: " +
        selectedTime +
        "\n\n" +
        patientLine +
        "📅 New Date: " +
        newDate +
        "\n" +
        "🕐 New Time: " +
        selectedTime +
        "\n\n" +
        "Confirm reschedule?\n\n" +
        "1️⃣ Confirm\n" +
        "2️⃣ Choose another time\n" +
        "3️⃣ Cancel"
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
        chosen.time +
        "\n" +
        "🆔 " +
        chosen.appointmentId +
        "\n\n" +
        "1️⃣ Completed\n" +
        "2️⃣ No-Show\n" +
        "0️⃣ Doctor Portal"
    );
}



function buildLanguageSelectionMessage() {

    return (
        "🌐 Please select your language:\n\n" +
        "1️⃣ English\n" +
        "2️⃣ తెలుగు\n" +
        "3️⃣ हिन्दी\n" +
        "4️⃣ ಕನ್ನಡ\n" +
        "5️⃣ தமிழ்\n" +
        "6️⃣ മലയാളം"
    );
}



function localizeWhatsAppReply(language, message) {

    const selectedLanguage =
        String(language || "EN").toUpperCase();

    if (selectedLanguage === "EN") {
        return String(message);
    }

    const translations = {
        TE: {
            "Welcome to ABC Clinic!": "ABC క్లినిక్‌కు స్వాగతం!",
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
            "Thank you for choosing ABC Clinic.": "ABC క్లినిక్‌ను ఎంచుకున్నందుకు ధన్యవాదాలు.",
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
            "ABC Clinic is currently closed.": "ABC క్లినిక్ ప్రస్తుతం మూసివేయబడింది.",
            "Our hours:": "మా సమయాలు:",
            "Please message us during clinic hours to book or manage appointments.": "అపాయింట్‌మెంట్‌లు బుక్ చేయడానికి లేదా నిర్వహించడానికి క్లినిక్ సమయంలో మాకు సందేశం పంపండి.",
            "Reply Hi during open hours to get started.": "ప్రారంభించడానికి తెరిచి ఉన్న సమయంలో Hi పంపండి."
        },
        HI: {
            "Welcome to ABC Clinic!": "एबीसी क्लिनिक में आपका स्वागत है!",
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
            "Thank you for choosing ABC Clinic.": "एबीसी क्लिनिक चुनने के लिए धन्यवाद।",
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
            "ABC Clinic is currently closed.": "एबीसी क्लिनिक अभी बंद है।",
            "Our hours:": "हमारे समय:",
            "Please message us during clinic hours to book or manage appointments.": "अपॉइंटमेंट बुक या प्रबंधित करने के लिए कृपया क्लिनिक के समय में संदेश भेजें।",
            "Reply Hi during open hours to get started.": "शुरू करने के लिए खुले समय में Hi भेजें।"
        },

        // NOTE: KA/TA/ML translations below are an initial AI-assisted pass,
        // not yet reviewed by a native speaker. Treat as a starting point —
        // verify against real clinic usage before relying on them in
        // production, especially for time/date-sensitive phrases.
        KA: {
            "Welcome to ABC Clinic!": "ABC ಕ್ಲಿನಿಕ್‌ಗೆ ಸ್ವಾಗತ!",
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
            "Thank you for choosing ABC Clinic.": "ABC ಕ್ಲಿನಿಕ್ ಆಯ್ಕೆ ಮಾಡಿದ್ದಕ್ಕೆ ಧನ್ಯವಾದಗಳು.",
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
            "ABC Clinic is currently closed.": "ABC ಕ್ಲಿನಿಕ್ ಪ್ರಸ್ತುತ ಮುಚ್ಚಿದೆ.",
            "Our hours:": "ನಮ್ಮ ಸಮಯ:",
            "Please message us during clinic hours to book or manage appointments.": "ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಬುಕ್ ಮಾಡಲು ಅಥವಾ ನಿರ್ವಹಿಸಲು ದಯವಿಟ್ಟು ಕ್ಲಿನಿಕ್ ಸಮಯದಲ್ಲಿ ನಮಗೆ ಸಂದೇಶ ಕಳುಹಿಸಿ.",
            "Reply Hi during open hours to get started.": "ಪ್ರಾರಂಭಿಸಲು ತೆರೆದಿರುವ ಸಮಯದಲ್ಲಿ Hi ಎಂದು ಉತ್ತರಿಸಿ."
        },

        TA: {
            "Welcome to ABC Clinic!": "ABC கிளினிக்கிற்கு வரவேற்கிறோம்!",
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
            "Thank you for choosing ABC Clinic.": "ABC கிளினிக்கைத் தேர்ந்தெடுத்ததற்கு நன்றி.",
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
            "ABC Clinic is currently closed.": "ABC கிளினிக் தற்போது மூடப்பட்டுள்ளது.",
            "Our hours:": "எங்கள் நேரம்:",
            "Please message us during clinic hours to book or manage appointments.": "அப்பாயின்ட்மென்ட் பதிவு செய்ய அல்லது நிர்வகிக்க கிளினிக் நேரத்தில் எங்களுக்கு செய்தி அனுப்பவும்.",
            "Reply Hi during open hours to get started.": "தொடங்க திறந்திருக்கும் நேரத்தில் Hi என பதிலளிக்கவும்."
        },

        ML: {
            "Welcome to ABC Clinic!": "ABC ക്ലിനിക്കിലേക്ക് സ്വാഗതം!",
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
            "Thank you for choosing ABC Clinic.": "ABC ക്ലിനിക്ക് തിരഞ്ഞെടുത്തതിന് നന്ദി.",
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
            "ABC Clinic is currently closed.": "ABC ക്ലിനിക്ക് നിലവിൽ അടച്ചിരിക്കുന്നു.",
            "Our hours:": "ഞങ്ങളുടെ സമയം:",
            "Please message us during clinic hours to book or manage appointments.": "അപ്പോയിന്റ്മെന്റ് ബുക്ക് ചെയ്യാനോ കൈകാര്യം ചെയ്യാനോ ക്ലിനിക് സമയത്ത് ഞങ്ങൾക്ക് സന്ദേശം അയയ്ക്കുക.",
            "Reply Hi during open hours to get started.": "തുടങ്ങാൻ തുറന്നിരിക്കുന്ന സമയത്ത് Hi എന്ന് മറുപടി നൽകുക."
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

    return localizedMessage;
}



function buildMainMenuMessage(prefix) {

    return (
        prefix +
        "\n\n" +
        "Please choose an option:\n\n" +
        "1️⃣ Book Appointment\n" +
        "2️⃣ My Appointments\n" +
        "3️⃣ Cancel Appointment\n" +
        "4️⃣ Reschedule Appointment\n" +
        "5️⃣ Change Language"
    );
}


function buildDoctorMenu(doctorName) {
    return "👨‍⚕️ Doctor Portal" +
        (doctorName ? " — " + doctorName : "") +
        "\n\n1️⃣ Today's Schedule\n" +
        "2️⃣ Next Appointment\n" +
        "3️⃣ This Week's Schedule\n" +
        "4️⃣ Schedule for a Date\n" +
        "5️⃣ Manage Availability\n" +
        "6️⃣ Manage Leaves\n" +
        "7️⃣ My Patients\n" +
        "8️⃣ Cancel Patient Appointment\n" +
        "9️⃣ Reschedule Patient Appointment\n" +
        "🔟 Mark Visit Status (Completed / No-Show)";
}


function formatDoctorAvailabilityMenu(doctorId) {

    const availability =
        getDoctorWeeklyAvailability(
            doctorId
        );

    let text =
        "📅 Manage Availability\n\n";

    DOCTOR_WEEKDAYS.forEach(
        function (day, index) {

            const sessions =
                availability[day];

            let summary =
                "Not set";

            if (sessions.length > 0) {
                summary =
                    sessions.length +
                    " session(s) (" +
                    sessions.map(function (session) {
                        return (
                            session.start +
                            " - " +
                            session.end
                        );
                    }).join(", ") +
                    ")";
            }

            text +=
                (index + 1) +
                ". " +
                day +
                ": " +
                summary +
                "\n";
        }
    );

    text +=
        "\nReply with day number (1-7) to manage that day.";

    return text;
}


function formatDoctorDayAvailabilityMenu(
    doctorId,
    dayName
) {

    const sessions =
        getDoctorDayAvailabilitySessions(
            doctorId,
            dayName
        );

    let text =
        "📅 " +
        dayName +
        " Availability\n\n";

    if (sessions.length === 0) {
        text += "No sessions set.\n\n";
    } else {
        sessions.forEach(
            function (session, index) {
                text +=
                    (index + 1) +
                    ". " +
                    session.start +
                    " - " +
                    session.end +
                    "\n";
            }
        );
        text += "\n";
    }

    text +=
        "1️⃣ Add session\n" +
        "2️⃣ Remove session\n" +
        "3️⃣ Clear entire day";

    return text;
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



function buildDateMenuOptionsText() {

    return (
        "1️⃣ Today\n" +
        "2️⃣ Tomorrow\n" +
        "3️⃣ Enter another date"
    );
}


function buildDateMenuPrompt(introText) {

    return (
        String(introText || "Please choose a date:") +
        "\n\n" +
        buildDateMenuOptionsText()
    );
}


function buildInvalidDateMenuReply() {

    return (
        "❌ Invalid option.\n\n" +
        "Please reply with:\n\n" +
        buildDateMenuOptionsText()
    );
}


function buildCustomDateEntryPrompt(isReschedule) {

    const prefix =
        isReschedule
            ? "📅 Please enter the new date"
            : "📅 Please enter the date";

    return (
        prefix +
        " in YYYY-MM-DD format.\n\n" +
        "Example:\n" +
        "2026-08-25"
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
        "Please confirm your appointment:\n\n" +
        "👤 Patient: " + patientName + "\n" +
        "👨‍⚕️ Doctor: " +
        (
            findDoctorById(
                session.doctorId
            ) || "Unknown Doctor"
        ) +
        "\n" +
        "📅 Date: " + session.date + "\n" +
        "🕐 Time: " + session.time + "\n\n" +
        "1️⃣ Confirm\n" +
        "2️⃣ Choose another time\n" +
        "3️⃣ Cancel"
    );
}
