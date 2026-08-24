// ============================================================
// ABC CLINIC — TEST SUITE
// ============================================================
//
// Bind this file together with ABC_Clinic_WhatsApp_Complete.gs
// in the same Apps Script project.
//
// Script Properties (optional):
//   DEBUG_MODE=true
//   TEST_SKIP_WHATSAPP_SEND=true  — skips real WhatsApp sends
//
// Run from Apps Script editor:
//   runAllTests()  — runs every test* function below
//
// Smoke tests (no live data):
//   testLogSettings, testAppointmentReminders, testDoctorCancelReschedule,
//   testAfterHoursReply, testInteractiveMenus, testLocalizationUiCleanup,
//   testAppointmentSheetFormatting, testWhatsAppRouterStructure,
//   testDoctorPortalHelpers, testWhatsAppFlowHelpers, testWhatsAppReliability,
//   testPatientRegistry, testWhatsAppSession
//
// Integration tests (may touch live sheets/calendar):
//   testBooking, testRealBooking, testCancellation, testReschedule,
//   testAPI, testDoctor*Schedule*, testSendWhatsApp*
//
// ============================================================

function runAllTests() {

    requireDebugMode("runAllTests");

    const tests = [
        ["testBooking", testBooking],
        ["testRealBooking", testRealBooking],
        ["testCancellation", testCancellation],
        ["testReschedule", testReschedule],
        ["testAPI", testAPI],
        ["testGetMyAppointments", testGetMyAppointments],
        ["testPatientAPI", testPatientAPI],
        ["testSecureCancelAPI", testSecureCancelAPI],
        ["testSecureRescheduleAPI", testSecureRescheduleAPI],
        ["testDoctorTodaySchedule", testDoctorTodaySchedule],
        ["testDoctorScheduleForDate", testDoctorScheduleForDate],
        ["testDoctorWeeklySchedule", testDoctorWeeklySchedule],
        ["testDoctorNextAppointment", testDoctorNextAppointment],
        ["testSendWhatsAppMessage", testSendWhatsAppMessage],
        ["testSendWhatsAppTemplate", testSendWhatsAppTemplate],
        ["testWhatsAppSession", testWhatsAppSession],
        ["testPatientRegistry", testPatientRegistry],
        ["testDoctorPortalHelpers", testDoctorPortalHelpers],
        ["testWhatsAppFlowHelpers", testWhatsAppFlowHelpers],
        ["testWhatsAppReliability", testWhatsAppReliability],
        ["testLogSettings", testLogSettings],
        ["testAppointmentReminders", testAppointmentReminders],
        ["testOwnerDailyDigest", testOwnerDailyDigest],
        ["testReminderActionButtons", testReminderActionButtons],
        ["testClinicBranding", testClinicBranding],
        ["testWaitlist", testWaitlist],
        ["testPostVisitFeedback", testPostVisitFeedback],
        ["testDoctorCancelReschedule", testDoctorCancelReschedule],
        ["testAppointmentStatus", testAppointmentStatus],
        ["testAfterHoursReply", testAfterHoursReply],
        ["testInteractiveMenus", testInteractiveMenus],
        ["testLocalizationUiCleanup", testLocalizationUiCleanup],
        ["testAppointmentSheetFormatting", testAppointmentSheetFormatting],
        ["testWhatsAppRouterStructure", testWhatsAppRouterStructure]
    ];

    let passed = 0;
    let failed = 0;

    tests.forEach(function (entry) {

        const name = entry[0];
        const run = entry[1];

        Logger.log("▶ " + name);

        try {
            run();
            Logger.log("  ✅ PASS");
            passed++;
        } catch (error) {
            Logger.log("  ❌ FAIL: " + error.message);
            failed++;
        }
    });

    Logger.log("");
    Logger.log("Results: " + passed + " passed, " + failed + " failed");
}


// ============================================================

function testBooking() {

    const doctorId = "D001";
    const doctorName = "Dr Ravi";
    const patientName = "Test Patient";
    const patientPhone = "9999999999";

    const startTime =
        new Date("2026-08-18T10:30:00+05:30");

    const endTime =
        new Date("2026-08-18T11:00:00+05:30");

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Appointments");

    const calendarId =
        "224ebd1dca8017ef8726914436e4f196e2f4a98da24b8a650a7532b6741823ae@group.calendar.google.com";

    const calendar =
        CalendarApp.getCalendarById(calendarId);

    if (!calendar) {
        throw new Error(
            "Calendar not found. Check your Calendar ID."
        );
    }

    const appointmentId =
        "A" +
        Utilities.formatDate(
            startTime,
            TIMEZONE,
            "yyyyMMddHHmm"
        );

    const event =
        calendar.createEvent(
            `Appointment - ${patientName}`,
            startTime,
            endTime,
            {
                description:
                    `Appointment ID: ${appointmentId}\n` +
                    `Doctor: ${doctorName}\n` +
                    `Patient: ${patientName}\n` +
                    `Doctor ID: ${doctorId}`,

                location: "ABC Clinic"
            }
        );

    sheet.appendRow([
        appointmentId,

        Utilities.formatDate(
            startTime,
            TIMEZONE,
            "dd-MMM-yyyy"
        ),

        Utilities.formatDate(
            startTime,
            TIMEZONE,
            "HH:mm"
        ),

        doctorId,
        patientName,
        patientPhone,
        "Confirmed",
        event.getId()
    ]);

    Logger.log(
        "Appointment created: " +
        appointmentId
    );
}


// ============================================================

function testRealBooking() {

    const result =
        bookAppointment(
            "D001",
            "2026-08-18",
            "11:00",
            "Anil Test",
            "9999999999"
        );

    Logger.log(
        JSON.stringify(
            result,
            null,
            2
        )
    );
}


// ============================================================

function testCancellation() {

    const appointmentId =
        "AE7AD7F3B";

    const patientPhone =
        "9999999999";

    const result =
        cancelAppointment(
            appointmentId,
            patientPhone
        );

    Logger.log(
        JSON.stringify(
            result,
            null,
            2
        )
    );
}


// ============================================================

function testReschedule() {

    const appointmentId = "AE7AD7F3B";

    const patientPhone = "1234";

    const result =
        rescheduleAppointment(
            appointmentId,
            patientPhone,
            "2026-08-18",
            "12:30"
        );

    Logger.log(
        JSON.stringify(
            result,
            null,
            2
        )
    );
}


// ============================================================

function testAPI() {

    // ----------------------------------------------------------
    // 1. Get doctors
    // ----------------------------------------------------------

    const doctors =
        api(
            "getDoctors",
            {}
        );

    Logger.log(
        "DOCTORS:\n" +
        JSON.stringify(
            doctors,
            null,
            2
        )
    );


    // ----------------------------------------------------------
    // 2. Get available slots
    // ----------------------------------------------------------

    const slots =
        api(

            "getAvailableSlots",

            {
                doctorId: "D001",
                date: "2026-08-18"
            }
        );

    Logger.log(
        "AVAILABLE SLOTS:\n" +
        JSON.stringify(
            slots,
            null,
            2
        )
    );
}


// ============================================================

function testGetMyAppointments() {

    const appointments =
        getMyAppointments(
            "9999999999"
        );

    Logger.log(
        JSON.stringify(
            appointments,
            null,
            2
        )
    );
}


// ============================================================

function testPatientAPI() {

    const result =
        api(

            "getMyAppointments",

            {
                patientPhone:
                    "9999999999"
            }
        );

    Logger.log(
        JSON.stringify(
            result,
            null,
            2
        )
    );
}


// ============================================================

function testSecureCancelAPI() {

    const result = api(
        "cancel",
        {
            appointmentId: "AE7AD7F3B",
            patientPhone: "1234"
        }
    );

    Logger.log(
        JSON.stringify(
            result,
            null,
            2
        )
    );
}


// ============================================================

function testSecureRescheduleAPI() {

    const result = api(
        "reschedule",
        {
            appointmentId: "AE7AD7F3B",
            patientPhone: "1234",
            newDate: "2026-08-18",
            newTime: "13:00"
        }
    );

    Logger.log(
        JSON.stringify(
            result,
            null,
            2
        )
    );
}


function testDoctorTodaySchedule() {

    const result =
        api(
            "doctorToday",
            {
                doctorId: "D001"
            }
        );

    Logger.log(
        JSON.stringify(
            result,
            null,
            2
        )
    );
}


function testDoctorScheduleForDate() {

    const result =
        getDoctorScheduleForDate(
            "D001",
            "2026-08-18"
        );

    Logger.log(
        JSON.stringify(
            result,
            null,
            2
        )
    );
}


function testDoctorWeeklySchedule() {

    const result =
        getDoctorWeeklySchedule(
            "D001",
            "2026-08-17"
        );

    Logger.log(
        JSON.stringify(
            result,
            null,
            2
        )
    );
}


function testDoctorNextAppointment() {

    const result =
        api(
            "doctorNext",
            {
                doctorId: "D001"
            }
        );

    Logger.log(
        JSON.stringify(
            result,
            null,
            2
        )
    );
}


function testSendWhatsAppMessage() {

    const recipient =
        "919700060850";

    const result =
        sendWhatsAppText(
            recipient,
            "👋 Hello! Your ABC Clinic WhatsApp appointment system is connected successfully."
        );

    Logger.log(
        JSON.stringify(
            result,
            null,
            2
        )
    );
}


function testSendWhatsAppTemplate() {

    const result =
        sendWhatsAppTemplate(
            "919700060850"
        );

    Logger.log(
        JSON.stringify(
            result,
            null,
            2
        )
    );
}


function testWhatsAppSession() {

    const phone =
        "919700060850";

    saveWhatsAppSession(
        phone,
        {
            role: "PATIENT",
            state: "MAIN_MENU",
            patientName: "Session Test Patient"
        }
    );

    const session =
        getWhatsAppSession(phone);

    if (
        session.patientName !==
        "Session Test Patient"
    ) {
        throw new Error(
            "patientName not persisted in session column 10"
        );
    }

    Logger.log(
        JSON.stringify(
            session,
            null,
            2
        )
    );
}


function testPatientRegistry() {

    requireDebugMode("testPatientRegistry");

    if (!isValidPatientName("Ravi Kumar")) {
        throw new Error(
            "valid patient name rejected"
        );
    }

    if (isValidPatientName("1")) {
        throw new Error(
            "numeric-only name accepted"
        );
    }

    const defaultLang =
        resolvePatientLanguage(
            "9999999999",
            null
        );

    if (defaultLang !== "EN") {
        throw new Error(
            "expected EN default language"
        );
    }

    Logger.log(
        "resolveKnownPatientName (sample): " +
        resolveKnownPatientName("9999999999")
    );
}


function testDoctorPortalHelpers() {

    requireDebugMode("testDoctorPortalHelpers");

    const day =
        doctorWeekdayIndexToName(1);

    if (day !== "Monday") {
        throw new Error(
            "doctorWeekdayIndexToName failed"
        );
    }

    const time =
        normalizeAvailabilityTimeInput(
            "10:30 AM"
        );

    if (time !== "10:30 AM") {
        throw new Error(
            "normalizeAvailabilityTimeInput failed: " +
            time
        );
    }

    if (
        !compareAvailabilityTimes(
            "10:00 AM",
            "2:00 PM"
        )
    ) {
        throw new Error(
            "compareAvailabilityTimes rejected valid range"
        );
    }

    const doctorMenu =
        buildDoctorMenu("Dr Test");

    if (
        doctorMenu.indexOf("Mark Visit Status") === -1 ||
        doctorMenu.indexOf("Cancel Patient Appointment") === -1
    ) {
        throw new Error(
            "buildDoctorMenu missing expected options"
        );
    }

    const doctorSpec =
        getDoctorMainMenuSpec();

    if (
        !doctorSpec.interactive ||
        doctorSpec.interactive.type !== "button" ||
        doctorSpec.interactive.buttons.length !== 3
    ) {
        throw new Error(
            "doctor main menu spec should have 3 buttons"
        );
    }

    Logger.log(
        "Doctor portal helper smoke tests passed"
    );
}


function testWhatsAppFlowHelpers() {

    requireDebugMode("testWhatsAppFlowHelpers");

    const prompt =
        buildAppointmentPickerPrompt(
            "Test Title",
            "Pick one:",
            [
                {
                    doctorId: "D001",
                    date: "2026-08-20",
                    time: "10:00 AM",
                    appointmentId: "APT-1"
                }
            ]
        );

    if (
        prompt.indexOf("Test Title") === -1 ||
        prompt.indexOf("0️⃣ Main Menu") === -1
    ) {
        throw new Error(
            "buildAppointmentPickerPrompt missing expected text"
        );
    }

    const invalidSlots =
        buildInvalidSlotSelectionReply([
            "10:00 AM",
            "10:30 AM"
        ]);

    if (
        invalidSlots.indexOf("Invalid time selection") === -1 ||
        invalidSlots.indexOf("1️⃣ 10:00 AM") !== -1
    ) {
        throw new Error(
            "buildInvalidSlotSelectionReply should not duplicate slot list"
        );
    }

    if (
        whatsAppNavigationShowsBack({
            role: "PATIENT",
            state: "CANCEL_SELECT"
        })
    ) {
        throw new Error(
            "flat patient list should not show Back hint"
        );
    }

    if (
        !whatsAppNavigationShowsBack({
            role: "PATIENT",
            state: "BOOK_TIME"
        })
    ) {
        throw new Error(
            "book time should show Back hint"
        );
    }

    const flatHints =
        buildWhatsAppNavigationHintText({
            role: "PATIENT",
            state: "MY_APPOINTMENTS"
        });

    if (
        flatHints.indexOf("Main Menu") === -1 ||
        flatHints.indexOf("Back") !== -1
    ) {
        throw new Error(
            "my appointments nav should be Main Menu only"
        );
    }

    const deepHints =
        buildWhatsAppNavigationHintText({
            role: "PATIENT",
            state: "RESCHEDULE_CONFIRM"
        });

    if (
        deepHints.indexOf("Main Menu") === -1 ||
        deepHints.indexOf("Back") === -1
    ) {
        throw new Error(
            "reschedule confirm nav should include Back"
        );
    }

    const myApptBody =
        buildMyAppointmentsListBody({
            page: 0,
            totalPages: 1
        });

    if (
        myApptBody.indexOf("📋 Your appointments") === -1 ||
        myApptBody.indexOf("Select an appointment.") === -1
    ) {
        throw new Error(
            "my appointments list body invalid"
        );
    }

    const cancelBody =
        buildCancelAppointmentListBody(
            { page: 0, totalPages: 1 },
            "❌ Invalid selection."
        );

    if (
        cancelBody.indexOf("Cancel appointment") === -1 ||
        cancelBody.indexOf("Invalid selection") === -1
    ) {
        throw new Error(
            "cancel list retry body invalid"
        );
    }

    const languageRetry =
        buildLanguageSelectionBody(
            "❌ Invalid option."
        );

    if (
        languageRetry.indexOf("Choose your language") === -1 ||
        languageRetry.indexOf("Invalid option") === -1
    ) {
        throw new Error(
            "language selection retry body invalid"
        );
    }

    Logger.log(
        "WhatsApp flow helper smoke tests passed"
    );
}


function testWhatsAppReliability() {

    requireDebugMode("testWhatsAppReliability");

    const messageId =
        "wamid.TEST_" +
        Utilities.getUuid().substring(0, 8);

    if (hasWhatsAppOutboundBeenSent(messageId)) {
        throw new Error(
            "outbound should not exist yet"
        );
    }

    markWhatsAppOutboundSent(messageId);

    if (!hasWhatsAppOutboundBeenSent(messageId)) {
        throw new Error(
            "outbound mark not persisted"
        );
    }

    const tePrompt =
        localizeWhatsAppReply(
            "TE",
            buildBookNamePrompt()
        );

    if (
        tePrompt.indexOf("బుకింగ్") === -1
    ) {
        throw new Error(
            "TE book name prompt not localized"
        );
    }

    const hiConfirm =
        localizeWhatsAppReply(
            "HI",
            buildBookingConfirmationMessage(
                {
                    doctorId: "D001",
                    date: "2026-08-20",
                    time: "10:00 AM"
                },
                "Test Patient"
            )
        );

    if (
        hiConfirm.indexOf("पुष्टि") === -1
    ) {
        throw new Error(
            "HI booking confirmation not localized"
        );
    }

    Logger.log(
        "WhatsApp reliability smoke tests passed"
    );
}


function testLocalizationUiCleanup() {

    requireDebugMode("testLocalizationUiCleanup");

    function assertLocalized(
        language,
        english,
        marker,
        label
    ) {

        const localized =
            localizeWhatsAppReply(
                language,
                english
            );

        if (
            language !== "EN" &&
            localized === english
        ) {
            throw new Error(
                label +
                " not localized for " +
                language
            );
        }

        if (
            localized.indexOf(marker) === -1
        ) {
            throw new Error(
                label +
                " missing marker \"" +
                marker +
                "\" for " +
                language +
                ": " +
                localized
            );
        }
    }

    const enMainMenu =
        localizeWhatsAppReply(
            "EN",
            "How can we help you today?"
        );

    if (
        enMainMenu !==
        "How can we help you today?"
    ) {
        throw new Error(
            "EN should pass through unchanged"
        );
    }

    assertLocalized(
        "TE",
        "How can we help you today?",
        "ఈరోజు",
        "main menu body"
    );

    assertLocalized(
        "HI",
        "How can we help you today?",
        "आज",
        "main menu body"
    );

    assertLocalized(
        "TE",
        buildDoctorSelectionBody(),
        "డాక్టర్",
        "doctor selection body"
    );

    assertLocalized(
        "HI",
        buildDoctorSelectionBody(),
        "डॉक्टर",
        "doctor selection body"
    );

    const doctorFallback =
        buildDoctorSelectionFallbackText([
            {
                doctorName: "Dr Anil",
                clinicName: "ABC Clinic"
            }
        ]);

    if (
        doctorFallback.indexOf("Dr Anil") === -1 ||
        doctorFallback.indexOf(
            "Reply with the doctor"
        ) !== -1
    ) {
        throw new Error(
            "doctor selection fallback should be compact numbered list"
        );
    }

    assertLocalized(
        "TE",
        "👨‍⚕️ Dr Anil\n\nChoose an appointment date.",
        "తేదీ",
        "date selection body"
    );

    assertLocalized(
        "HI",
        "👨‍⚕️ Dr Anil\n\nChoose an appointment date.",
        "तारीख",
        "date selection body"
    );

    assertLocalized(
        "TE",
        buildSlotSelectionIntro(
            "2026-08-24",
            false
        ),
        "అందుబాటు",
        "slot selection intro"
    );

    assertLocalized(
        "HI",
        buildSlotSelectionIntro(
            "2026-08-24",
            true
        ),
        "समय",
        "reschedule slot intro"
    );

    assertLocalized(
        "TE",
        "📋 Your appointments",
        "మీ అపాయింట్",
        "my appointments body"
    );

    assertLocalized(
        "HI",
        "❌ Cancel appointment\n\nSelect an appointment to cancel.",
        "रद्द",
        "cancel selection body"
    );

    assertLocalized(
        "TE",
        "Select an appointment.",
        "ఎంచుకోండి",
        "my appointments select line"
    );

    assertLocalized(
        "TE",
        buildBookingConfirmationMessage(
            {
                doctorId: "D001",
                date: "2026-08-20",
                time: "10:00 AM"
            },
            "Test Patient"
        ),
        "నిర్ధారించ",
        "booking confirmation body"
    );

    assertLocalized(
        "HI",
        buildCancelConfirmMessage({
            doctorId: "D001",
            date: "2026-08-20",
            time: "10:00 AM",
            appointmentId: "APT001"
        }),
        "रद्द",
        "cancel confirmation body"
    );

    assertLocalized(
        "TE",
        buildRescheduleSlotConfirmMessage(
            {
                doctorId: "D001"
            },
            "2026-08-20",
            "11:00 AM"
        ),
        "మార్పు",
        "reschedule confirmation body"
    );

    assertLocalized(
        "HI",
        buildCustomDateEntryPrompt(false),
        "तारीख",
        "custom date prompt"
    );

    assertLocalized(
        "TE",
        buildLanguageSelectionIntro(),
        "భాష",
        "language selection intro"
    );

    assertLocalized(
        "TE",
        buildSlotSelectionIntro(
            "2026-08-24",
            false
        ) +
        "\n\nPage 1 of 2",
        "పేజీ",
        "slot pagination body"
    );

    const dateMenuFallback =
        getDateMenuSpec().fallbackText;

    assertLocalized(
        "TE",
        dateMenuFallback,
        "ఈరోజు",
        "date menu fallback"
    );

    assertLocalized(
        "HI",
        getBookingConfirmSpec().fallbackText,
        "पुष्टि",
        "booking confirm fallback"
    );

    const localizedPatientMenu =
        localizeInteractiveMenu(
            "TE",
            getPatientMainMenuSpec().interactive
        );

    if (
        localizedPatientMenu.buttons[0].title.indexOf(
            "Book"
        ) !== -1
    ) {
        throw new Error(
            "patient main menu tap labels not localized for TE"
        );
    }

    const localizedMoreMenu =
        localizeInteractiveMenu(
            "TE",
            getPatientMainMoreMenuSpec().interactive
        );

    if (
        localizedMoreMenu.sections[0].rows[0].title.indexOf(
            "Cancel"
        ) !== -1
    ) {
        throw new Error(
            "patient main more menu not localized for TE"
        );
    }

    Logger.log(
        "Localization UI cleanup smoke tests passed"
    );
}


function testLogSettings() {

    requireDebugMode("testLogSettings");

    const cases = [
        ["week", 7],
        ["month", 30],
        ["quarter", 90],
        ["quarterly", 90],
        ["halfyear", 182],
        ["half-yearly", 182],
        ["year", 365],
        ["yearly", 365],
        ["none", 0],
        ["forever", 0]
    ];

    cases.forEach(function (entry) {

        const key =
            normalizeLogRetention(entry[0]);

        const days =
            getLogRetentionDays(key);

        if (days !== entry[1]) {
            throw new Error(
                "retention mismatch for " +
                entry[0] +
                ": got " +
                days
            );
        }
    });

    ensureSettingsSheet();

    const settings =
        loadLogSettingsFromSheet();

    if (
        !settings.retentionKey ||
        settings.maxRows <= 0
    ) {
        throw new Error(
            "default log settings invalid"
        );
    }

    const afterHours =
        getAfterHoursSettings();

    if (
        !afterHours.openTimeDisplay ||
        !afterHours.closeTimeDisplay ||
        afterHours.workingDays.length === 0
    ) {
        throw new Error(
            "default after-hours settings invalid"
        );
    }

    const autoComplete =
        getAutoCompleteSettings();

    if (
        typeof autoComplete.enabled !== "boolean" ||
        autoComplete.hoursAfter <= 0
    ) {
        throw new Error(
            "default auto-complete settings invalid"
        );
    }

    const truncated =
        truncateLogText(
            "abcdefghijklmnopqrstuvwxyz",
            10
        );

    if (
        truncated !== "abcdefghij…"
    ) {
        throw new Error(
            "truncateLogText failed"
        );
    }

    Logger.log(
        "Log settings smoke tests passed"
    );
}


function testAppointmentReminders() {

    requireDebugMode("testAppointmentReminders");

    const parsed =
        parseReminderHoursBefore("24,2");

    if (
        parsed.length !== 2 ||
        parsed[0] !== 24 ||
        parsed[1] !== 2
    ) {
        throw new Error(
            "parseReminderHoursBefore failed"
        );
    }

    const empty =
        parseReminderHoursBefore("");

    if (
        empty.length !== 1 ||
        empty[0] !== 24
    ) {
        throw new Error(
            "parseReminderHoursBefore default failed"
        );
    }

    const message =
        buildAppointmentReminderMessage(
            {
                appointmentId: "A202608181000",
                date: "18-Aug-2026",
                time: "10:00"
            },
            "Dr Ravi",
            24,
            true
        );

    if (
        message.indexOf("Appointment Reminder") === -1 ||
        message.indexOf("Dr Ravi") === -1 ||
        message.indexOf("24 hours") === -1 ||
        message.indexOf("Appointment ID") !== -1 ||
        message.indexOf("tap a button") === -1
    ) {
        throw new Error(
            "buildAppointmentReminderMessage failed"
        );
    }

    const phone91 =
        formatWhatsAppRecipientPhone(
            "9876543210"
        );

    if (phone91 !== "919876543210") {
        throw new Error(
            "formatWhatsAppRecipientPhone failed"
        );
    }

    ensureSettingsSheet();

    const settings =
        getReminderSettings();

    if (
        !settings.enabled ||
        settings.hoursBeforeList.length === 0
    ) {
        throw new Error(
            "default reminder settings invalid"
        );
    }

    if (
        !isInactiveAppointmentStatus("Completed") ||
        !isInactiveAppointmentStatus("No-Show")
    ) {
        throw new Error(
            "reminders should treat Completed/No-Show as inactive"
        );
    }

    Logger.log(
        "Appointment reminder smoke tests passed"
    );
}



function testOwnerDailyDigest() {

    requireDebugMode("testOwnerDailyDigest");

    const hour =
        parseOwnerDigestHour("8");

    if (hour !== 8) {
        throw new Error(
            "parseOwnerDigestHour failed"
        );
    }

    const invalidHour =
        parseOwnerDigestHour("99");

    if (invalidHour !== 8) {
        throw new Error(
            "parseOwnerDigestHour default failed"
        );
    }

    const message =
        buildOwnerDailyDigestMessage({
            clinicName: "ABC Clinic",
            summaryDate: "Monday, 24-Aug-2026",
            todayScheduled: 5,
            todayCompleted: 2,
            todayNoShow: 1,
            todayCancelled: 1,
            tomorrowScheduled: 8
        });

    if (
        message.indexOf("Daily Summary") === -1 ||
        message.indexOf("5 scheduled") === -1 ||
        message.indexOf("8 scheduled") === -1 ||
        message.indexOf("1 cancelled") === -1
    ) {
        throw new Error(
            "buildOwnerDailyDigestMessage failed"
        );
    }

    ensureSettingsSheet();

    const settings =
        getOwnerDigestSettings();

    if (
        settings.clinicName !== "ABC Clinic" ||
        settings.digestHour !== 8
    ) {
        throw new Error(
            "default owner digest settings invalid"
        );
    }

    Logger.log(
        "Owner daily digest smoke tests passed"
    );
}



function testReminderActionButtons() {

    requireDebugMode("testReminderActionButtons");

    const parsedConfirm =
        parseReminderButtonChoice(
            "reminder_confirm_a202608181000"
        );

    if (
        !parsedConfirm ||
        parsedConfirm.action !== "confirm" ||
        parsedConfirm.appointmentId !==
            "a202608181000"
    ) {
        throw new Error(
            "parseReminderButtonChoice confirm failed"
        );
    }

    const parsedCancel =
        parseReminderButtonChoice(
            "reminder_cancel_apt001"
        );

    if (
        !parsedCancel ||
        parsedCancel.action !== "cancel"
    ) {
        throw new Error(
            "parseReminderButtonChoice cancel failed"
        );
    }

    const menuSpec =
        getAppointmentReminderButtonSpec(
            "APT001"
        );

    if (
        !menuSpec.interactive ||
        menuSpec.interactive.buttons.length !== 3 ||
        menuSpec.interactive.buttons[0].id !==
            "reminder_confirm_APT001" ||
        menuSpec.interactive.buttons[2].id !==
            "reminder_cancel_APT001"
    ) {
        throw new Error(
            "getAppointmentReminderButtonSpec failed"
        );
    }

    const ack =
        buildReminderConfirmAckMessage(
            {
                date: "18-Aug-2026",
                time: "10:00 AM"
            },
            "Dr Ravi"
        );

    if (
        ack.indexOf("Thank you for confirming") === -1 ||
        ack.indexOf("Dr Ravi") === -1
    ) {
        throw new Error(
            "buildReminderConfirmAckMessage failed"
        );
    }

    ensureSettingsSheet();

    const settings =
        getReminderSettings();

    if (!settings.actionButtons) {
        throw new Error(
            "default reminder action buttons disabled"
        );
    }

    Logger.log(
        "Reminder action button smoke tests passed"
    );
}



function testClinicBranding() {

    requireDebugMode("testClinicBranding");

    ensureSettingsSheet();

    const message =
        buildClinicContactMessage();

    if (
        message.indexOf("🏥") === -1 ||
        message.indexOf("Send Hi anytime") === -1 ||
        message.indexOf("🕐") === -1
    ) {
        throw new Error(
            "buildClinicContactMessage failed"
        );
    }

    const branding =
        getClinicBrandingSettings();

    if (
        !branding.name ||
        !branding.workingDaysDisplay ||
        !branding.openTimeDisplay
    ) {
        throw new Error(
            "getClinicBrandingSettings failed"
        );
    }

    const moreSpec =
        getPatientMainMoreMenuSpec();

    if (
        !moreSpec.interactive ||
        moreSpec.interactive.type !== "list"
    ) {
        throw new Error(
            "patient more menu should be list"
        );
    }

    Logger.log(
        "Clinic branding smoke tests passed"
    );
}


function testWaitlist() {

    requireDebugMode("testWaitlist");

    ensureSettingsSheet();

    const settings =
        getWaitlistSettings();

    if (
        !settings.enabled ||
        settings.notifyCount < 1
    ) {
        throw new Error(
            "default waitlist settings invalid"
        );
    }

    const parsed =
        parseWaitlistOfferChoice(
            "waitlist_accept_w202608241030001"
        );

    if (
        !parsed ||
        parsed.offerId !==
            "w202608241030001"
    ) {
        throw new Error(
            "parseWaitlistOfferChoice failed"
        );
    }

    const menuSpec =
        getWaitlistOfferButtonSpec(
            "w202608241030001"
        );

    if (
        !menuSpec.interactive ||
        menuSpec.interactive.buttons.length !== 1 ||
        menuSpec.interactive.buttons[0].id !==
            "waitlist_accept_w202608241030001"
    ) {
        throw new Error(
            "getWaitlistOfferButtonSpec failed"
        );
    }

    const intro =
        buildWaitlistJoinIntro();

    if (
        intro.indexOf("Slot alerts") === -1 ||
        intro.indexOf("Choose a doctor") === -1
    ) {
        throw new Error(
            "buildWaitlistJoinIntro failed"
        );
    }

    const offerMessage =
        buildWaitlistOfferMessage(
            {
                displayDate: "24-Aug-2026",
                time: "10:30 AM"
            },
            "Dr Ravi"
        );

    if (
        offerMessage.indexOf("Dr Ravi") === -1 ||
        offerMessage.indexOf("First come, first served") === -1
    ) {
        throw new Error(
            "buildWaitlistOfferMessage failed"
        );
    }

    ensureWaitlistSheet();
    ensureSlotOfferSheet();

    Logger.log(
        "Waitlist smoke tests passed"
    );
}



function testPostVisitFeedback() {

    requireDebugMode("testPostVisitFeedback");

    ensureSettingsSheet();

    const settings =
        getFeedbackSettings();

    if (
        !settings.enabled ||
        settings.hoursAfter < 0
    ) {
        throw new Error(
            "default feedback settings invalid"
        );
    }

    const parsed =
        parseFeedbackRatingChoice(
            "feedback_rate_5_a202608181000"
        );

    if (
        !parsed ||
        parsed.rating !== 5 ||
        parsed.appointmentId !==
            "a202608181000"
    ) {
        throw new Error(
            "parseFeedbackRatingChoice failed"
        );
    }

    const menuSpec =
        getPostVisitFeedbackRatingSpec(
            "A202608181000"
        );

    if (
        !menuSpec.interactive ||
        menuSpec.interactive.sections[0].rows.length !==
            5 ||
        menuSpec.interactive.sections[0].rows[0].id !==
            "feedback_rate_5_A202608181000"
    ) {
        throw new Error(
            "getPostVisitFeedbackRatingSpec failed"
        );
    }

    const requestMessage =
        buildPostVisitFeedbackMessage(
            {
                date: "18-Aug-2026",
                time: "10:00 AM"
            },
            "Dr Ravi",
            true
        );

    if (
        requestMessage.indexOf("How was your visit") === -1 ||
        requestMessage.indexOf("Dr Ravi") === -1
    ) {
        throw new Error(
            "buildPostVisitFeedbackMessage failed"
        );
    }

    const thankYou =
        buildFeedbackThankYouMessage(
            5,
            "https://g.page/example/review",
            4
        );

    if (
        thankYou.indexOf("Google review") === -1 ||
        thankYou.indexOf("https://g.page/example/review") === -1
    ) {
        throw new Error(
            "buildFeedbackThankYouMessage failed"
        );
    }

    ensureFeedbackSentLogSheet();
    ensureFeedbackResponseLogSheet();

    Logger.log(
        "Post-visit feedback smoke tests passed"
    );
}



function testDoctorCancelReschedule() {

    requireDebugMode("testDoctorCancelReschedule");

    const message =
        buildDoctorCancelConfirmMessage({
            patientName: "Test Patient",
            date: "18-Aug-2026",
            time: "10:00 AM",
            appointmentId: "A202608181000"
        });

    if (
        message.indexOf("Test Patient") === -1 ||
        message.indexOf("cancel") === -1
    ) {
        throw new Error(
            "buildDoctorCancelConfirmMessage failed"
        );
    }

    const list =
        getDoctorConfirmedAppointments("D001");

    if (!Array.isArray(list)) {
        throw new Error(
            "getDoctorConfirmedAppointments should return array"
        );
    }

    const picker =
        buildDoctorPatientAppointmentPickerPrompt(
            "Title",
            "Pick one:",
            []
        );

    if (
        picker.indexOf("Doctor Portal") === -1
    ) {
        throw new Error(
            "buildDoctorPatientAppointmentPickerPrompt failed"
        );
    }

    Logger.log(
        "Doctor cancel/reschedule smoke tests passed"
    );
}


function testAppointmentStatus() {

    requireDebugMode("testAppointmentStatus");

    ensureSettingsSheet();

    if (
        normalizeAppointmentStatus("completed") !==
        APPOINTMENT_STATUS.COMPLETED
    ) {
        throw new Error(
            "normalizeAppointmentStatus completed failed"
        );
    }

    if (
        normalizeAppointmentStatus("no-show") !==
        APPOINTMENT_STATUS.NO_SHOW
    ) {
        throw new Error(
            "normalizeAppointmentStatus no-show failed"
        );
    }

    if (
        !isInactiveAppointmentStatus("No-Show") ||
        !isInactiveAppointmentStatus("Cancelled")
    ) {
        throw new Error(
            "isInactiveAppointmentStatus failed"
        );
    }

    if (
        isInactiveAppointmentStatus("Confirmed")
    ) {
        throw new Error(
            "Confirmed should be active"
        );
    }

    const actionMessage =
        buildDoctorStatusActionMessage({
            patientName: "Test Patient",
            date: "18-Aug-2026",
            time: "10:00 AM",
            appointmentId: "A202608181000"
        });

    if (
        actionMessage.indexOf("Completed") === -1 ||
        actionMessage.indexOf("No-Show") === -1
    ) {
        throw new Error(
            "buildDoctorStatusActionMessage failed"
        );
    }

    const spec =
        getDoctorStatusActionSpec();

    if (
        !spec.interactive ||
        spec.interactive.buttons.length !== 2 ||
        spec.interactive.buttons[0].id !==
            "status_completed"
    ) {
        throw new Error(
            "getDoctorStatusActionSpec invalid"
        );
    }

    const menu =
        buildDoctorMenu("Dr Test");

    if (
        menu.indexOf("Mark Visit Status") === -1
    ) {
        throw new Error(
            "buildDoctorMenu missing status option"
        );
    }

    const autoSettings =
        getAutoCompleteSettings();

    if (
        typeof autoSettings.enabled !== "boolean" ||
        autoSettings.hoursAfter <= 0
    ) {
        throw new Error(
            "getAutoCompleteSettings invalid"
        );
    }

    const eligible =
        getDoctorStatusEligibleAppointments("D001");

    if (!Array.isArray(eligible)) {
        throw new Error(
            "getDoctorStatusEligibleAppointments should return array"
        );
    }

    Logger.log(
        "Appointment status smoke tests passed"
    );
}


function testAfterHoursReply() {

    requireDebugMode("testAfterHoursReply");

    ensureSettingsSheet();

    const days =
        parseClinicWorkingDays(
            "Mon,Tue,Wed,Thu,Fri,Sat"
        );

    if (
        days.length !== 6 ||
        days[0] !== "Monday"
    ) {
        throw new Error(
            "parseClinicWorkingDays failed"
        );
    }

    const settings =
        getAfterHoursSettings();

    if (
        typeof settings.enabled !== "boolean" ||
        !settings.openTimeDisplay ||
        !settings.closeTimeDisplay
    ) {
        throw new Error(
            "getAfterHoursSettings invalid"
        );
    }

    const message =
        buildAfterHoursMessage(
            "EN",
            settings
        );

    if (
        message.indexOf("closed") === -1 ||
        message.indexOf("Our hours:") === -1
    ) {
        throw new Error(
            "buildAfterHoursMessage failed"
        );
    }

    const telugu =
        buildAfterHoursMessage(
            "TE",
            settings
        );

    if (
        telugu === message
    ) {
        throw new Error(
            "TE after-hours message not localized"
        );
    }

    if (
        !isActivePatientFlowSession({
            state: "BOOK_DOCTOR"
        })
    ) {
        throw new Error(
            "BOOK_DOCTOR should count as active flow"
        );
    }

    if (
        isActivePatientFlowSession({
            state: "MAIN_MENU"
        })
    ) {
        throw new Error(
            "MAIN_MENU should not count as active flow"
        );
    }

    const sampleDate =
        new Date("2026-08-18T10:00:00+05:30");

    if (
        !isWithinClinicHours(
            sampleDate,
            {
                enabled: true,
                openTime: "09:00",
                closeTime: "18:00",
                workingDays: [
                    "Monday",
                    "Tuesday",
                    "Wednesday",
                    "Thursday",
                    "Friday",
                    "Saturday"
                ]
            }
        )
    ) {
        throw new Error(
            "10 AM Tuesday should be within clinic hours"
        );
    }

    const afterClose =
        new Date("2026-08-18T20:00:00+05:30");

    if (
        isWithinClinicHours(
            afterClose,
            {
                enabled: true,
                openTime: "09:00",
                closeTime: "18:00",
                workingDays: [
                    "Monday",
                    "Tuesday",
                    "Wednesday",
                    "Thursday",
                    "Friday",
                    "Saturday"
                ]
            }
        )
    ) {
        throw new Error(
            "8 PM should be outside clinic hours"
        );
    }

    if (
        shouldBlockPatientForAfterHours(
            "9999999999",
            { state: "MAIN_MENU", role: "PATIENT" }
        )
    ) {
        throw new Error(
            "after-hours gate should be off by default"
        );
    }

    const sundayClosed =
        new Date("2026-08-23T10:00:00+05:30");

    if (
        isWithinClinicHours(
            sundayClosed,
            {
                openTime: "09:00",
                closeTime: "18:00",
                workingDays: [
                    "Monday",
                    "Tuesday",
                    "Wednesday",
                    "Thursday",
                    "Friday",
                    "Saturday"
                ]
            }
        )
    ) {
        throw new Error(
            "Sunday should be outside working days"
        );
    }

    Logger.log(
        "After-hours reply smoke tests passed"
    );
}


function testInteractiveMenus() {

    requireDebugMode("testInteractiveMenus");

    ensureSettingsSheet();

    if (!interactiveMenusEnabled()) {
        throw new Error(
            "interactive menus should be enabled by default"
        );
    }

    const patientSpec =
        getPatientMainMenuSpec();

    if (
        !patientSpec.interactive ||
        patientSpec.interactive.type !== "button" ||
        patientSpec.interactive.buttons.length !== 3 ||
        patientSpec.interactive.buttons[2].id !==
            "menu_more"
    ) {
        throw new Error(
            "patient main menu spec invalid"
        );
    }

    const patientMoreSpec =
        getPatientMainMoreMenuSpec();

    if (
        !patientMoreSpec.interactive ||
        patientMoreSpec.interactive.type !==
            "list" ||
        patientMoreSpec.interactive.sections[0].rows.length !==
            5 ||
        patientMoreSpec.interactive.sections[0].rows[3].id !==
            "menu_contact" ||
        patientMoreSpec.interactive.sections[0].rows[4].id !==
            "menu_waitlist"
    ) {
        throw new Error(
            "patient main more menu spec invalid"
        );
    }

    const doctorSpec =
        getDoctorMainMenuSpec();

    if (
        !doctorSpec.interactive ||
        doctorSpec.interactive.type !== "button" ||
        doctorSpec.interactive.buttons.length !== 3 ||
        doctorSpec.interactive.buttons[2].id !==
            "menu_more"
    ) {
        throw new Error(
            "doctor main menu spec should be 3-button menu"
        );
    }

    const doctorMoreSpec =
        getDoctorMainMenuMoreSpec(1);

    if (
        !doctorMoreSpec.interactive ||
        doctorMoreSpec.interactive.type !== "button" ||
        doctorMoreSpec.interactive.buttons.length !== 3
    ) {
        throw new Error(
            "doctor main more menu tier 1 spec invalid"
        );
    }

    const doctorMoreTier4 =
        getDoctorMainMenuMoreSpec(4);

    if (
        !doctorMoreTier4.interactive ||
        doctorMoreTier4.interactive.buttons.length !== 2 ||
        doctorMoreTier4.interactive.buttons[0].id !==
            "doctor_reschedule" ||
        doctorMoreTier4.interactive.buttons[1].id !==
            "doctor_status"
    ) {
        throw new Error(
            "doctor main more menu tier 4 spec invalid"
        );
    }

    if (
        normalizeDoctorMenuChoice(
            "doctor_reschedule"
        ) !== "9" ||
        normalizeDoctorMenuChoice(
            "doctor_status"
        ) !== "10"
    ) {
        throw new Error(
            "doctor semantic menu ids not mapped"
        );
    }

    const exactlyTen =
        buildInteractiveListSpec(
            [
                { id: "1", title: "One" },
                { id: "2", title: "Two" },
                { id: "3", title: "Three" },
                { id: "4", title: "Four" },
                { id: "5", title: "Five" },
                { id: "6", title: "Six" },
                { id: "7", title: "Seven" },
                { id: "8", title: "Eight" },
                { id: "9", title: "Nine" },
                { id: "10", title: "Ten" }
            ],
            "Choose"
        );

    if (
        !exactlyTen ||
        exactlyTen.sections[0].rows.length !== 10
    ) {
        throw new Error(
            "list spec should accept exactly 10 rows"
        );
    }

    const buttonSpec =
        buildInteractiveButtonSpec([
            { id: "1", title: "Confirm" },
            { id: "2", title: "Cancel" }
        ]);

    if (
        !buttonSpec ||
        buttonSpec.buttons.length !== 2
    ) {
        throw new Error(
            "button spec invalid"
        );
    }

    const tooMany =
        buildInteractiveListSpec(
            [
                { id: "1", title: "One" },
                { id: "2", title: "Two" },
                { id: "3", title: "Three" },
                { id: "4", title: "Four" },
                { id: "5", title: "Five" },
                { id: "6", title: "Six" },
                { id: "7", title: "Seven" },
                { id: "8", title: "Eight" },
                { id: "9", title: "Nine" },
                { id: "10", title: "Ten" },
                { id: "11", title: "Eleven" }
            ],
            "Choose"
        );

    if (tooMany !== null) {
        throw new Error(
            "list spec should reject >10 rows"
        );
    }

    const confirmCancel =
        getConfirmCancelSpec();

    if (
        !confirmCancel.interactive ||
        confirmCancel.interactive.buttons.length !== 2 ||
        confirmCancel.interactive.buttons[0].id !==
            "confirm_yes" ||
        confirmCancel.interactive.buttons[1].id !==
            "confirm_cancel"
    ) {
        throw new Error(
            "confirm/cancel spec invalid"
        );
    }

    const statusSpec =
        getDoctorStatusActionSpec();

    if (
        !statusSpec.interactive ||
        statusSpec.interactive.buttons[0].id !==
            "status_completed" ||
        statusSpec.interactive.buttons[1].id !==
            "status_no_show"
    ) {
        throw new Error(
            "doctor status action spec invalid"
        );
    }

    if (
        !isSimpleConfirmYesChoice("confirm_yes") ||
        !isSimpleConfirmCancelChoice("confirm_cancel") ||
        !isStatusCompletedChoice("status_completed")
    ) {
        throw new Error(
            "confirm choice helpers failed"
        );
    }

    const sampleAppointments = [
        {
            patientName: "Test Patient",
            doctorId: "DR001",
            date: "2026-08-25",
            time: "10:00 AM",
            appointmentId: "APT001"
        }
    ];

    const appointmentList =
        getAppointmentListMenuSpec(
            sampleAppointments,
            "patient"
        );

    if (
        !appointmentList.interactive ||
        appointmentList.interactive.sections[0].rows.length !== 2 ||
        appointmentList.interactive.sections[0].rows[1].id !==
            "nav_main_menu"
    ) {
        throw new Error(
            "appointment list menu spec invalid"
        );
    }

    const leavesMenu =
        getDoctorLeavesMenuSpec();

    if (
        !leavesMenu.interactive ||
        leavesMenu.interactive.sections[0].rows.length !== 4
    ) {
        throw new Error(
            "doctor leaves menu spec invalid"
        );
    }

    const manySlots = [];

    for (let i = 0; i < 20; i++) {
        manySlots.push(
            (10 + i) + ":00 AM"
        );
    }

    const slotPage0 =
        getSlotSelectionMenuSpec(
            manySlots,
            0
        );

    if (
        !slotPage0.interactive ||
        slotPage0.interactive.sections[0].rows.length !== 10 ||
        slotPage0.totalPages !== 3
    ) {
        throw new Error(
            "slot page 0 spec invalid"
        );
    }

    const slotPage1 =
        getSlotSelectionMenuSpec(
            manySlots,
            1
        );

    if (
        !slotPage1.interactive ||
        slotPage1.interactive.sections[0].rows.length !== 10
    ) {
        throw new Error(
            "slot page 1 spec invalid"
        );
    }

    const slotPage2 =
        getSlotSelectionMenuSpec(
            manySlots,
            2
        );

    if (
        !slotPage2.interactive ||
        slotPage2.interactive.sections[0].rows.length !== 4
    ) {
        throw new Error(
            "slot page 2 spec invalid"
        );
    }

    const mockButtonMessage = {
        type: "interactive",
        interactive: {
            type: "button_reply",
            button_reply: {
                id: "2",
                title: "Cancel"
            }
        }
    };

    const parsed =
        extractInboundWhatsAppMessage(
            mockButtonMessage
        );

    if (
        parsed.type !== "interactive" ||
        parsed.text !== "2"
    ) {
        throw new Error(
            "extractInboundWhatsAppMessage failed"
        );
    }

    const yesNoSpec =
        getYesNoConfirmSpec();

    if (
        !yesNoSpec.interactive ||
        yesNoSpec.interactive.buttons[0].id !==
            "confirm_yes_cancel" ||
        yesNoSpec.interactive.buttons[1].id !==
            "confirm_no_back"
    ) {
        throw new Error(
            "yes/no confirm spec should use semantic ids"
        );
    }

    if (
        !isYesCancelConfirmChoice(
            "confirm_yes_cancel"
        ) ||
        !isNoGoBackConfirmChoice(
            "confirm_no_back"
        )
    ) {
        throw new Error(
            "yes/no confirm choice helpers failed"
        );
    }

    const manyAppts = [];

    for (let j = 0; j < 15; j++) {
        manyAppts.push({
            patientName: "Patient " + j,
            doctorId: "DR001",
            date: "2026-08-25",
            time: "10:00 AM",
            appointmentId: "APT" + j
        });
    }

    const apptPage0 =
        getAppointmentListMenuSpec(
            manyAppts,
            "patient",
            0
        );

    if (
        !apptPage0.interactive ||
        apptPage0.interactive.sections[0].rows.length !==
            10 ||
        apptPage0.totalPages !== 2 ||
        apptPage0.interactive.sections[0].rows[9].id !==
            "nav_main_menu"
    ) {
        throw new Error(
            "appointment page 0 spec invalid"
        );
    }

    const apptPage1 =
        getAppointmentListMenuSpec(
            manyAppts,
            "patient",
            1
        );

    if (
        !apptPage1.interactive ||
        apptPage1.interactive.sections[0].rows.length !==
            9 ||
        apptPage1.interactive.sections[0].rows[8].id !==
            "nav_main_menu"
    ) {
        throw new Error(
            "appointment page 1 spec invalid"
        );
    }

    Logger.log(
        "Interactive menu smoke tests passed"
    );
}


function testAppointmentSheetFormatting() {

    requireDebugMode("testAppointmentSheetFormatting");

    const isoDate =
        formatAppointmentSheetDate("2026-08-18");

    if (isoDate !== "18-Aug-2026") {
        throw new Error(
            "ISO date formatting failed: " + isoDate
        );
    }

    const sheetTime =
        formatAppointmentSheetTime("10:30 AM");

    if (sheetTime !== "10:30") {
        throw new Error(
            "time formatting failed: " + sheetTime
        );
    }

    const parsed =
        parseAppointmentSheetDateTime(
            "18-Aug-2026",
            "10:30"
        );

    if (
        !parsed ||
        Utilities.formatDate(
            parsed,
            TIMEZONE,
            "hh:mm a"
        ) !== "10:30 AM"
    ) {
        throw new Error(
            "parseAppointmentSheetDateTime failed"
        );
    }

    Logger.log(
        "Appointment sheet formatting tests passed"
    );
}


function testWhatsAppRouterStructure() {

    requireDebugMode("testWhatsAppRouterStructure");

    const handlers = [
        handleWhatsAppGreeting,
        handleWhatsAppUniversalNavigation,
        handleAfterHoursPatientGate,
        handleWhatsAppDoctorMessage,
        handleWhatsAppPatientMessage,
        processWhatsAppTextMessage
    ];

    handlers.forEach(function (handler) {
        if (typeof handler !== "function") {
            throw new Error(
                "Missing WhatsApp router handler"
            );
        }
    });

    Logger.log(
        "WhatsApp router structure tests passed"
    );
}
