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
//   testAppointmentStatus, testAfterHoursReply, testInteractiveMenus,
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
        ["testDoctorCancelReschedule", testDoctorCancelReschedule],
        ["testAppointmentStatus", testAppointmentStatus],
        ["testAfterHoursReply", testAfterHoursReply],
        ["testInteractiveMenus", testInteractiveMenus],
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
        doctorSpec.interactive.type !== "list" ||
        doctorSpec.interactive.sections[0].rows.length !== 10
    ) {
        throw new Error(
            "doctor main menu spec should have 10 list rows"
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
        prompt.indexOf("0️⃣ Back to Main Menu") === -1
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
        invalidSlots.indexOf("1️⃣ 10:00 AM") === -1 ||
        invalidSlots.indexOf("2️⃣ 10:30 AM") === -1
    ) {
        throw new Error(
            "buildInvalidSlotSelectionReply missing slot list"
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
            24
        );

    if (
        message.indexOf("Appointment Reminder") === -1 ||
        message.indexOf("Dr Ravi") === -1 ||
        message.indexOf("24 hours") === -1
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
        spec.interactive.buttons.length !== 2
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
        patientSpec.interactive.type !== "list"
    ) {
        throw new Error(
            "patient main menu spec invalid"
        );
    }

    const doctorSpec =
        getDoctorMainMenuSpec();

    if (
        !doctorSpec.interactive ||
        doctorSpec.interactive.type !== "list" ||
        doctorSpec.interactive.sections[0].rows.length !== 10
    ) {
        throw new Error(
            "doctor main menu spec invalid"
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
