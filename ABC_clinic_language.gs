// ============================================================
// DOCTOR APPOINTMENT SYSTEM
// Google Sheets + Google Calendar
// ============================================================
//
// SHEETS REQUIRED:
//
// Doctors
//   Doctor ID | Doctor Name | Clinic | Calendar ID
//
// Availability
//   Doctor ID | Day | Start | End | Slot Minutes
//
// Appointments
//   Appointment ID | Date | Time | Doctor ID | Patient Name |
//   Phone | Status | Calendar Event ID
//
// ============================================================

const TIMEZONE = "Asia/Kolkata";
const APPOINTMENT_DURATION_MINUTES = 30;



// ============================================================
// TIME HELPERS
// ============================================================

function convert12HourTo24Hour(timeString) {

    const value =
        String(timeString || "").trim();

    // Already normalized 24-hour format: 10:00
    if (/^\d{1,2}:\d{2}$/.test(value)) {

        const parts = value.split(":");
        const hour = Number(parts[0]);
        const minute = Number(parts[1]);

        if (
            hour >= 0 &&
            hour <= 23 &&
            minute >= 0 &&
            minute <= 59
        ) {
            return (
                String(hour).padStart(2, "0") +
                ":" +
                String(minute).padStart(2, "0")
            );
        }
    }

    // User-facing format: 10:00 AM
    const match =
        value.match(
            /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i
        );

    if (!match) {
        return null;
    }

    let hour = Number(match[1]);
    const minute = Number(match[2]);
    const period = match[3].toUpperCase();

    if (
        hour < 1 ||
        hour > 12 ||
        minute < 0 ||
        minute > 59
    ) {
        return null;
    }

    if (period === "AM") {
        if (hour === 12) {
            hour = 0;
        }
    } else {
        if (hour !== 12) {
            hour += 12;
        }
    }

    return (
        String(hour).padStart(2, "0") +
        ":" +
        String(minute).padStart(2, "0")
    );
}



function isValidISODate(dateString) {

    const value =
        String(dateString || "").trim();

    if (
        !/^\d{4}-\d{2}-\d{2}$/.test(value)
    ) {
        return false;
    }

    const parts = value.split("-");
    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const day = Number(parts[2]);

    const date =
        new Date(
            `${value}T00:00:00+05:30`
        );

    if (isNaN(date.getTime())) {
        return false;
    }

    return (
        date.getFullYear() === year &&
        date.getMonth() + 1 === month &&
        date.getDate() === day
    );
}


// ============================================================
// 1. TEST BOOKING - OLD SIMPLE TEST
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

    const event =
        calendar.createEvent(
            `Appointment - ${patientName}`,
            startTime,
            endTime,
            {
                description:
                    `Doctor: ${doctorName}\n` +
                    `Patient: ${patientName}\n` +
                    `Phone: ${patientPhone}\n` +
                    `Doctor ID: ${doctorId}`,

                location: "ABC Clinic"
            }
        );

    const appointmentId =
        "A" +
        Utilities.formatDate(
            startTime,
            TIMEZONE,
            "yyyyMMddHHmm"
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
// 2. GET AVAILABLE SLOTS
// ============================================================

function getAvailableSlots(
    doctorId,
    dateString
) {

    const date =
        new Date(
            `${dateString}T00:00:00+05:30`
        );

    if (!isValidISODate(dateString)) {
        throw new Error(
            "Invalid date. Use YYYY-MM-DD."
        );
    }

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const doctorSheet =
        ss.getSheetByName("Doctors");

    const availabilitySheet =
        ss.getSheetByName("Availability");

    const doctorData =
        doctorSheet.getDataRange().getValues();

    const availabilityData =
        availabilitySheet.getDataRange().getValues();

    let calendarId = "";
    let doctorName = "";

    // ----------------------------------------------------------
    // Find doctor
    // ----------------------------------------------------------

    for (
        let i = 1;
        i < doctorData.length;
        i++
    ) {

        if (
            String(doctorData[i][0]) ===
            String(doctorId)
        ) {

            doctorName =
                doctorData[i][1];

            calendarId =
                doctorData[i][3];

            break;
        }
    }

    if (!calendarId) {

        throw new Error(
            "Doctor or Calendar ID not found."
        );
    }

    // ----------------------------------------------------------
    // Find day of week
    // ----------------------------------------------------------

    const dayName =
        Utilities.formatDate(
            date,
            TIMEZONE,
            "EEEE"
        );

    let startTime = null;
    let endTime = null;
    let slotMinutes = null;

    // ----------------------------------------------------------
    // Find doctor's availability
    // ----------------------------------------------------------

    for (
        let i = 1;
        i < availabilityData.length;
        i++
    ) {

        const rowDoctorId =
            availabilityData[i][0];

        const rowDay =
            availabilityData[i][1];

        if (
            String(rowDoctorId) ===
            String(doctorId) &&
            String(rowDay) ===
            String(dayName)
        ) {

            startTime =
                availabilityData[i][2];

            endTime =
                availabilityData[i][3];

            slotMinutes =
                Number(availabilityData[i][4]);

            break;
        }
    }

    if (
        !startTime ||
        !endTime ||
        !slotMinutes
    ) {

        return [];
    }

    // ----------------------------------------------------------
    // Create starting time
    // ----------------------------------------------------------

    let current =
        new Date(date);

    current.setHours(
        startTime.getHours(),
        startTime.getMinutes(),
        0,
        0
    );

    // ----------------------------------------------------------
    // Create closing time
    // ----------------------------------------------------------

    const closingTime =
        new Date(date);

    closingTime.setHours(
        endTime.getHours(),
        endTime.getMinutes(),
        0,
        0
    );

    // ----------------------------------------------------------
    // Calendar
    // ----------------------------------------------------------

    const calendar =
        CalendarApp.getCalendarById(
            calendarId
        );

    if (!calendar) {

        throw new Error(
            "Calendar not found."
        );
    }

    const slots = [];
    const now = new Date();

    // ----------------------------------------------------------
    // Check every slot
    // ----------------------------------------------------------

    while (
        current.getTime() +
        slotMinutes * 60000 <=
        closingTime.getTime()
    ) {

        const slotEnd =
            new Date(
                current.getTime() +
                slotMinutes * 60000
            );

        const events =
            calendar.getEvents(
                current,
                slotEnd
            );

        // Do not offer slots that have already started today.
        if (
            current.getTime() > now.getTime() &&
            events.length === 0
        ) {

            slots.push(
                Utilities.formatDate(
                    current,
                    TIMEZONE,
                    "hh:mm a"
                )
            );
        }

        current =
            new Date(
                current.getTime() +
                slotMinutes * 60000
            );
    }

    Logger.log(
        "Available slots for " +
        doctorName +
        " on " +
        dayName +
        ": " +
        slots.join(", ")
    );

    return slots;
}


// ============================================================
// 3. BOOK APPOINTMENT
// ============================================================

function bookAppointment(
    doctorId,
    dateString,
    timeString,
    patientName,
    patientPhone
) {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const doctorSheet =
        ss.getSheetByName("Doctors");

    const appointmentSheet =
        ss.getSheetByName("Appointments");

    const doctorData =
        doctorSheet.getDataRange().getValues();

    let doctorName = "";
    let clinicName = "";
    let calendarId = "";

    // ----------------------------------------------------------
    // Find doctor
    // ----------------------------------------------------------

    for (
        let i = 1;
        i < doctorData.length;
        i++
    ) {

        if (
            String(doctorData[i][0]) ===
            String(doctorId)
        ) {

            doctorName =
                doctorData[i][1];

            clinicName =
                doctorData[i][2];

            calendarId =
                doctorData[i][3];

            break;
        }
    }

    if (!calendarId) {

        return {
            success: false,
            message: "Doctor not found."
        };
    }

    // ----------------------------------------------------------
    // Create date/time
    // ----------------------------------------------------------

    if (
        !isValidISODate(
            dateString
        )
    ) {

        return {
            success: false,
            message:
                "Invalid appointment date."
        };
    }

    const time24 =
        convert12HourTo24Hour(
            timeString
        );

    if (!time24) {

        return {
            success: false,
            message:
                "Invalid appointment time."
        };
    }

    const startTime =
        new Date(
            `${dateString}T${time24}:00+05:30`
        );

    if (isNaN(startTime.getTime())) {

        return {
            success: false,
            message:
                "Invalid date or time."
        };
    }

    const endTime =
        new Date(
            startTime.getTime() +
            APPOINTMENT_DURATION_MINUTES *
            60000
        );

    // ----------------------------------------------------------
    // Calendar
    // ----------------------------------------------------------

    const calendar =
        CalendarApp.getCalendarById(
            calendarId
        );

    if (!calendar) {

        return {
            success: false,
            message:
                "Google Calendar not found."
        };
    }

    // Do not allow a direct caller to create an appointment in the past.
    if (startTime.getTime() <= new Date().getTime()) {

        return {
            success: false,
            message:
                "Appointment time must be in the future."
        };
    }

    // ----------------------------------------------------------
    // Generate appointment ID
    // ----------------------------------------------------------

    const appointmentId =
        "A" +
        Utilities.getUuid()
            .replace(/-/g, "")
            .substring(0, 8)
            .toUpperCase();

    // ----------------------------------------------------------
    // Create Calendar event
    // ----------------------------------------------------------

    // Serialize the final conflict check and Calendar write so two
    // simultaneous WhatsApp requests cannot book the same slot.
    const lock =
        LockService.getScriptLock();

    let event;

    try {

        if (!lock.tryLock(30000)) {

            return {
                success: false,
                message:
                    "Booking is busy. Please try again."
            };
        }

        if (
            hasActiveAppointmentOnDate(
                patientPhone,
                dateString
            )
        ) {

            return {
                success: false,
                message:
                    "You already have an active appointment on this date."
            };
        }

        const existingEvents =
            calendar.getEvents(
                startTime,
                endTime
            );

        if (existingEvents.length > 0) {

            return {
                success: false,
                message:
                    "This appointment slot is already booked."
            };
        }

        event =
            calendar.createEvent(
                `Appointment - ${patientName}`,
                startTime,
                endTime,
                {
                    description:
                        `Appointment ID: ${appointmentId}\n` +
                        `Doctor: ${doctorName}\n` +
                        `Patient: ${patientName}\n` +
                        `Phone: ${patientPhone}`,

                    location: clinicName
                }
            );

    // ----------------------------------------------------------
    // Save appointment
    // ----------------------------------------------------------

        appointmentSheet.appendRow([

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

    } finally {

        if (lock.hasLock()) {
            lock.releaseLock();
        }
    }

    // ----------------------------------------------------------
    // Return result
    // ----------------------------------------------------------

    return {

        success: true,

        appointmentId:
            appointmentId,

        doctor:
            doctorName,

        patient:
            patientName,

        date:
            Utilities.formatDate(
                startTime,
                TIMEZONE,
                "dd-MMM-yyyy"
            ),

        time:
            Utilities.formatDate(
                startTime,
                TIMEZONE,
                "hh:mm a"
            )
    };
}


// ============================================================
// 4. TEST REAL BOOKING
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
// 5. CANCEL APPOINTMENT - SECURE
// ============================================================

function cancelAppointment(
    appointmentId,
    patientPhone
) {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const appointmentSheet =
        ss.getSheetByName("Appointments");

    const doctorSheet =
        ss.getSheetByName("Doctors");

    const appointmentData =
        appointmentSheet
            .getDataRange()
            .getValues();

    const doctorData =
        doctorSheet
            .getDataRange()
            .getValues();

    // ----------------------------------------------------------
    // Find appointment
    // ----------------------------------------------------------

    for (
        let i = 1;
        i < appointmentData.length;
        i++
    ) {

        const rowAppointmentId =
            String(appointmentData[i][0]);

        if (
            rowAppointmentId ===
            String(appointmentId)
        ) {

            const rowPhone =
                String(appointmentData[i][5]);

            const status =
                String(appointmentData[i][6]);

            const calendarEventId =
                appointmentData[i][7];

            // ------------------------------------------------------
            // SECURITY CHECK
            // ------------------------------------------------------

            if (
                rowPhone !==
                String(patientPhone)
            ) {

                return {
                    success: false,
                    message:
                        "Appointment does not belong to this phone number."
                };
            }

            // ------------------------------------------------------
            // Already cancelled
            // ------------------------------------------------------

            if (
                status === "Cancelled"
            ) {

                return {
                    success: false,
                    message:
                        "Appointment is already cancelled."
                };
            }

            // ------------------------------------------------------
            // Find doctor's calendar
            // ------------------------------------------------------

            const doctorId =
                appointmentData[i][3];

            let calendarId = "";

            for (
                let j = 1;
                j < doctorData.length;
                j++
            ) {

                if (
                    String(doctorData[j][0]) ===
                    String(doctorId)
                ) {

                    calendarId =
                        doctorData[j][3];

                    break;
                }
            }

            // ------------------------------------------------------
            // Delete Calendar event
            // ------------------------------------------------------

            if (!calendarId) {

                return {
                    success: false,
                    message:
                        "Doctor calendar is not configured; appointment was not cancelled."
                };
            }

            const calendar =
                CalendarApp.getCalendarById(
                    String(calendarId).trim()
                );

            if (!calendar) {

                return {
                    success: false,
                    message:
                        "Doctor calendar was not found; appointment was not cancelled."
                };
            }

            let event = null;

            if (calendarEventId) {

                try {

                    event =
                        calendar.getEventById(
                            String(calendarEventId).trim()
                        );

                } catch (error) {

                    Logger.log(
                        "Could not look up Calendar event " +
                        calendarEventId + ": " +
                        error.message
                    );
                }
            }

            // Older records may have a missing or stale Calendar Event ID.
            // Fall back to the appointment ID stored in the event description.
            if (!event) {

                const appointmentDate =
                    appointmentData[i][1] instanceof Date
                        ? appointmentData[i][1]
                        : parseAppointmentDateTime(
                            appointmentData[i][1],
                            appointmentData[i][2]
                        );

                if (appointmentDate) {

                    const dayEvents =
                        calendar.getEventsForDay(
                            appointmentDate
                        );

                    event =
                        dayEvents.find(
                            function (candidate) {
                                return candidate
                                    .getDescription()
                                    .indexOf(
                                        "Appointment ID: " +
                                        rowAppointmentId
                                    ) !== -1;
                            }
                        ) || null;
                }
            }

            if (!event) {

                return {
                    success: false,
                    message:
                        "Calendar event was not found; appointment was not cancelled."
                };
            }

            try {

                event.deleteEvent();

            } catch (error) {

                Logger.log(
                    "Could not delete Calendar event " +
                    rowAppointmentId + ": " +
                    error.message
                );

                return {
                    success: false,
                    message:
                        "Could not remove the Google Calendar event; appointment was not cancelled."
                };
            }

            // ------------------------------------------------------
            // Update Sheet
            // ------------------------------------------------------

            appointmentSheet
                .getRange(i + 1, 7)
                .setValue("Cancelled");

            return {

                success: true,

                appointmentId:
                    appointmentId,

                message:
                    "Appointment cancelled successfully."
            };
        }
    }

    return {

        success: false,

        message:
            "Appointment not found."
    };
}


// ============================================================
// 6. TEST SECURE CANCELLATION
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
// 7. RESCHEDULE APPOINTMENT - SECURE
// ============================================================

function rescheduleAppointment(
    appointmentId,
    patientPhoneInput,
    newDateString,
    newTimeString
) {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const appointmentSheet =
        ss.getSheetByName("Appointments");

    const doctorSheet =
        ss.getSheetByName("Doctors");

    const appointmentData =
        appointmentSheet
            .getDataRange()
            .getValues();

    const doctorData =
        doctorSheet
            .getDataRange()
            .getValues();

    // ----------------------------------------------------------
    // Variables
    // ----------------------------------------------------------

    let appointmentRow = -1;

    let doctorId = "";
    let patientName = "";
    let storedPatientPhone = "";
    let calendarEventId = "";
    let status = "";

    // ----------------------------------------------------------
    // Find appointment
    // ----------------------------------------------------------

    for (
        let i = 1;
        i < appointmentData.length;
        i++
    ) {

        if (
            String(appointmentData[i][0]) ===
            String(appointmentId)
        ) {

            appointmentRow =
                i + 1;

            doctorId =
                appointmentData[i][3];

            patientName =
                appointmentData[i][4];

            storedPatientPhone =
                String(appointmentData[i][5]);

            status =
                String(appointmentData[i][6]);

            calendarEventId =
                appointmentData[i][7];

            break;
        }
    }

    // ----------------------------------------------------------
    // Appointment not found
    // ----------------------------------------------------------

    if (
        appointmentRow === -1
    ) {

        return {

            success: false,

            message:
                "Appointment ID not found."
        };
    }

    // ----------------------------------------------------------
    // SECURITY CHECK
    // ----------------------------------------------------------

    if (
        storedPatientPhone !==
        String(patientPhoneInput)
    ) {

        return {

            success: false,

            message:
                "Appointment does not belong to this phone number."
        };
    }

    // ----------------------------------------------------------
    // Check status
    // ----------------------------------------------------------

    if (
        status === "Cancelled"
    ) {

        return {

            success: false,

            message:
                "Cancelled appointments cannot be rescheduled."
        };
    }

    // ----------------------------------------------------------
    // Find doctor
    // ----------------------------------------------------------

    let doctorName = "";
    let clinicName = "";
    let calendarId = "";

    for (
        let i = 1;
        i < doctorData.length;
        i++
    ) {

        if (
            String(doctorData[i][0]) ===
            String(doctorId)
        ) {

            doctorName =
                doctorData[i][1];

            clinicName =
                doctorData[i][2];

            calendarId =
                doctorData[i][3];

            break;
        }
    }

    if (!calendarId) {

        return {

            success: false,

            message:
                "Doctor calendar not found."
        };
    }

    const calendar =
        CalendarApp.getCalendarById(
            calendarId
        );

    if (!calendar) {

        return {

            success: false,

            message:
                "Google Calendar not found."
        };
    }

    // ----------------------------------------------------------
    // Create new date/time
    // ----------------------------------------------------------

    const newTime24 =
        convert12HourTo24Hour(
            newTimeString
        );

    if (!newTime24) {

        return {
            success: false,
            message:
                "Invalid new appointment time."
        };
    }

    const newStartTime =
        new Date(
            `${newDateString}T${newTime24}:00+05:30`
        );

    if (
        isNaN(
            newStartTime.getTime()
        )
    ) {

        return {
            success: false,
            message:
                "Invalid new date or time."
        };
    }

    const newEndTime =
        new Date(
            newStartTime.getTime() +
            APPOINTMENT_DURATION_MINUTES *
            60000
        );

    if (
        hasActiveAppointmentOnDate(
            patientPhoneInput,
            newDateString,
            appointmentId
        )
    ) {

        return {
            success: false,
            message:
                "You already have an active appointment on this date."
        };
    }

    // ----------------------------------------------------------
    // Check new slot
    // ----------------------------------------------------------

    const existingEvents =
        calendar.getEvents(
            newStartTime,
            newEndTime
        );

    // ----------------------------------------------------------
    // Ignore the current appointment's
    // own calendar event.
    // ----------------------------------------------------------

    const conflictingEvents =
        existingEvents.filter(
            event =>
                event.getId() !==
                calendarEventId
        );

    if (
        conflictingEvents.length > 0
    ) {

        return {

            success: false,

            message:
                "The new appointment slot is already booked."
        };
    }

    // ----------------------------------------------------------
    // Delete old Calendar event
    // ----------------------------------------------------------

    if (calendarEventId) {

        const oldEvent =
            calendar.getEventById(
                calendarEventId
            );

        if (oldEvent) {
            oldEvent.deleteEvent();
        }
    }

    // ----------------------------------------------------------
    // Create new Calendar event
    // ----------------------------------------------------------

    const newEvent =
        calendar.createEvent(
            `Appointment - ${patientName}`,
            newStartTime,
            newEndTime,
            {

                description:
                    `Appointment ID: ${appointmentId}\n` +
                    `Doctor: ${doctorName}\n` +
                    `Patient: ${patientName}\n` +
                    `Phone: ${storedPatientPhone}`,

                location:
                    clinicName
            }
        );

    // ----------------------------------------------------------
    // Update Sheet
    // ----------------------------------------------------------

    appointmentSheet
        .getRange(
            appointmentRow,
            2
        )
        .setValue(
            Utilities.formatDate(
                newStartTime,
                TIMEZONE,
                "dd-MMM-yyyy"
            )
        );

    appointmentSheet
        .getRange(
            appointmentRow,
            3
        )
        .setValue(
            Utilities.formatDate(
                newStartTime,
                TIMEZONE,
                "HH:mm"
            )
        );

    appointmentSheet
        .getRange(
            appointmentRow,
            7
        )
        .setValue(
            "Confirmed"
        );

    appointmentSheet
        .getRange(
            appointmentRow,
            8
        )
        .setValue(
            newEvent.getId()
        );

    // ----------------------------------------------------------
    // Return result
    // ----------------------------------------------------------

    return {

        success: true,

        appointmentId:
            appointmentId,

        doctor:
            doctorName,

        patient:
            patientName,

        date:
            Utilities.formatDate(
                newStartTime,
                TIMEZONE,
                "dd-MMM-yyyy"
            ),

        time:
            Utilities.formatDate(
                newStartTime,
                TIMEZONE,
                "hh:mm a"
            ),

        message:
            "Appointment rescheduled successfully."
    };
}


// ============================================================
// 8. TEST RESCHEDULE
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
// 9. GET DOCTORS
// ============================================================

function getDoctors() {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Doctors");

    const data =
        sheet.getDataRange().getValues();

    const doctors = [];

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        if (!data[i][0]) {
            continue;
        }

        doctors.push({

            doctorId:
                data[i][0],

            doctorName:
                data[i][1],

            clinicName:
                data[i][2]
        });
    }

    return doctors;
}


function buildDoctorSelectionMessage() {

    const doctors = getDoctors();

    if (doctors.length === 0) {
        return "❌ No doctors are currently available.";
    }

    let message =
        "📅 Book Appointment\n\n" +
        "Select a doctor:\n\n";

    for (
        let i = 0;
        i < doctors.length;
        i++
    ) {

        message +=
            (i + 1) + ". " +
            doctors[i].doctorName +
            (doctors[i].clinicName
                ? " — " + doctors[i].clinicName
                : "") +
            "\n";
    }

    return message +
        "\nReply with the doctor's number.";
}


function hasActiveAppointmentOnDate(
    patientPhone,
    dateString,
    excludedAppointmentId
) {

    const requestedDate =
        new Date(
            `${dateString}T00:00:00+05:30`
        );

    if (isNaN(requestedDate.getTime())) {
        return false;
    }

    const targetDate =
        Utilities.formatDate(
            requestedDate,
            TIMEZONE,
            "dd-MMM-yyyy"
        );

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Appointments");

    if (!sheet) {
        throw new Error(
            "Appointments sheet not found."
        );
    }

    const data =
        sheet.getDataRange().getDisplayValues();

    const normalizedPhone =
        String(patientPhone || "").trim();

    const excludedId =
        String(excludedAppointmentId || "").trim();

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        const status =
            String(data[i][6] || "")
                .trim()
                .toLowerCase();

        const isInactive =
            status === "cancelled" ||
            status === "completed";

        if (
            String(data[i][0] || "").trim() !== excludedId &&
            String(data[i][5] || "").trim() === normalizedPhone &&
            String(data[i][1] || "").trim() === targetDate &&
            !isInactive
        ) {
            return true;
        }
    }

    return false;
}


// ============================================================
// 10. GET PATIENT APPOINTMENTS
// ============================================================

function getMyAppointments(
    patientPhone
) {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Appointments");

    const data =
        sheet.getDataRange().getValues();

    const appointments = [];

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        const appointmentId =
            data[i][0];

        const date =
            data[i][1];

        const time =
            data[i][2];

        const doctorId =
            data[i][3];

        const patientName =
            data[i][4];

        const phone =
            data[i][5];

        const status =
            data[i][6];

        if (
            String(phone) ===
            String(patientPhone)
        ) {

            // -------------------------------------------------------
            // Format appointment time
            // -------------------------------------------------------

            let appointmentTime = "";

            if (data[i][2] instanceof Date) {

                appointmentTime =
                    Utilities.formatDate(
                        data[i][2],
                        TIMEZONE,
                        "hh:mm a"
                    );

            } else {

                appointmentTime =
                    String(data[i][2]).trim();

            }


            // -------------------------------------------------------
            // Add appointment
            // -------------------------------------------------------

            appointments.push({

                appointmentId:
                    String(appointmentId).trim(),

                date:
                    data[i][1] instanceof Date
                        ? Utilities.formatDate(
                            data[i][1],
                            TIMEZONE,
                            "dd-MMM-yyyy"
                        )
                        : String(date).trim(),

                time:
                    appointmentTime,

                doctorId:
                    String(doctorId).trim(),

                patientName:
                    String(patientName).trim(),

                phone:
                    String(phone).trim(),

                status:
                    String(status).trim()

            });
        }
    }

    return appointments;
}


// ============================================================
// 11. UNIFIED API
// ============================================================

function api(
    action,
    data
) {

    switch (action) {

        // --------------------------------------------------------
        // GET DOCTORS
        // --------------------------------------------------------

        case "getDoctors":

            return getDoctors();


        // --------------------------------------------------------
        // GET AVAILABLE SLOTS
        // --------------------------------------------------------

        case "getAvailableSlots":

            return getAvailableSlots(
                data.doctorId,
                data.date
            );


        // --------------------------------------------------------
        // BOOK
        // --------------------------------------------------------

        case "book":

            return bookAppointment(

                data.doctorId,

                data.date,

                data.time,

                data.patientName,

                data.patientPhone
            );


        // --------------------------------------------------------
        // GET PATIENT APPOINTMENTS
        // --------------------------------------------------------

        case "getMyAppointments":

            return getMyAppointments(
                data.patientPhone
            );


        // --------------------------------------------------------
        // CANCEL - SECURE
        // --------------------------------------------------------

        case "cancel":

            return cancelAppointment(

                data.appointmentId,

                data.patientPhone
            );


        // --------------------------------------------------------
        // RESCHEDULE - SECURE
        // --------------------------------------------------------

        case "reschedule":

            return rescheduleAppointment(

                data.appointmentId,

                data.patientPhone,

                data.newDate,

                data.newTime
            );


        case "doctorToday":

            return getDoctorTodaySchedule(
                data.doctorId
            );

        case "doctorWeek":

            return getDoctorWeeklySchedule(
                data.doctorId
            );

        case "doctorNext":

            return getDoctorNextAppointment(
                data.doctorId
            );

        // --------------------------------------------------------
        // UNKNOWN ACTION
        // --------------------------------------------------------

        default:

            return {

                success: false,

                message:
                    "Unknown action."
            };
    }
}


// ============================================================
// 12. TEST API
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
// 13. TEST PATIENT APPOINTMENT LOOKUP
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
// 14. TEST PATIENT API
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
// 15. TEST SECURE CANCEL THROUGH API
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
// 16. TEST SECURE RESCHEDULE THROUGH API
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


function getDoctorTodaySchedule(doctorId) {

    const ss = SpreadsheetApp.getActiveSpreadsheet();

    const appointmentSheet =
        ss.getSheetByName("Appointments");

    const doctorSheet =
        ss.getSheetByName("Doctors");

    const data =
        appointmentSheet.getDataRange().getValues();

    const doctorData =
        doctorSheet.getDataRange().getValues();

    // ----------------------------------------------------------
    // Find doctor
    // ----------------------------------------------------------

    let doctorName = "";
    let clinicName = "";

    for (let i = 1; i < doctorData.length; i++) {

        if (
            String(doctorData[i][0]).trim() ===
            String(doctorId).trim()
        ) {

            doctorName = doctorData[i][1];
            clinicName = doctorData[i][2];

            break;
        }
    }

    if (!doctorName) {

        return {
            success: false,
            message: "Doctor not found."
        };
    }

    // ----------------------------------------------------------
    // Today's date
    // ----------------------------------------------------------

    const today =
        Utilities.formatDate(
            new Date(),
            TIMEZONE,
            "dd-MMM-yyyy"
        );

    const appointments = [];

    // ----------------------------------------------------------
    // Find today's appointments
    // ----------------------------------------------------------

    for (let i = 1; i < data.length; i++) {

        const rowDate =
            String(data[i][1]).trim();

        const rowDoctorId =
            String(data[i][3]).trim();

        const status =
            String(data[i][6]).trim();

        // Only this doctor
        if (rowDoctorId !== String(doctorId).trim()) {
            continue;
        }

        // Only today
        if (rowDate !== today) {
            continue;
        }

        // Don't show cancelled appointments
        if (status === "Cancelled") {
            continue;
        }

        appointments.push({

            appointmentId:
                data[i][0],

            time:
                data[i][2],

            patientName:
                data[i][4],

            phone:
                data[i][5],

            status:
                status
        });
    }

    // ----------------------------------------------------------
    // Sort by time
    // ----------------------------------------------------------

    appointments.sort(function (a, b) {

        return String(a.time)
            .localeCompare(String(b.time));

    });

    // ----------------------------------------------------------
    // Return
    // ----------------------------------------------------------

    return {

        success: true,

        doctorId:
            doctorId,

        doctorName:
            doctorName,

        clinicName:
            clinicName,

        date:
            today,

        totalAppointments:
            appointments.length,

        appointments:
            appointments
    };
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

function getDoctorScheduleForDate(
    doctorId,
    dateString
) {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const appointmentSheet =
        ss.getSheetByName("Appointments");

    const doctorSheet =
        ss.getSheetByName("Doctors");

    const range =
        appointmentSheet.getDataRange();

    const data =
        range.getValues();

    const displayData =
        range.getDisplayValues();

    const doctorData =
        doctorSheet
            .getDataRange()
            .getValues();


    // =========================================================
    // FIND DOCTOR
    // =========================================================

    let doctorName = "";
    let clinicName = "";

    for (
        let i = 1;
        i < doctorData.length;
        i++
    ) {

        if (
            String(doctorData[i][0]).trim() ===
            String(doctorId).trim()
        ) {

            doctorName =
                doctorData[i][1];

            clinicName =
                doctorData[i][2];

            break;
        }
    }


    if (!doctorName) {

        return {
            success: false,
            message: "Doctor not found."
        };
    }


    // =========================================================
    // NORMALIZE TARGET DATE
    // =========================================================

    const targetDate =
        Utilities.formatDate(
            new Date(
                `${dateString}T00:00:00+05:30`
            ),
            TIMEZONE,
            "dd-MMM-yyyy"
        );


    const appointments = [];


    // =========================================================
    // FIND APPOINTMENTS
    // =========================================================

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        const rowDoctorId =
            String(data[i][3]).trim();

        const rowStatus =
            String(data[i][6]).trim();


        // Doctor filter

        if (
            rowDoctorId !==
            String(doctorId).trim()
        ) {

            continue;
        }


        // Ignore cancelled

        if (
            rowStatus === "Cancelled"
        ) {

            continue;
        }


        // =======================================================
        // NORMALIZE DATE
        // =======================================================

        let rowDate = "";

        if (
            data[i][1] instanceof Date
        ) {

            rowDate =
                Utilities.formatDate(
                    data[i][1],
                    TIMEZONE,
                    "dd-MMM-yyyy"
                );

        } else {

            rowDate =
                String(data[i][1]).trim();
        }


        // Date comparison

        if (
            rowDate !==
            targetDate
        ) {

            continue;
        }


        // =======================================================
        // FORMAT TIME
        // =======================================================

        let appointmentTime = "";

        if (
            data[i][2] instanceof Date
        ) {

            appointmentTime =
                Utilities.formatDate(
                    data[i][2],
                    TIMEZONE,
                    "hh:mm a"
                );

        } else {

            appointmentTime =
                String(data[i][2]).trim();
        }


        // =======================================================
        // ADD APPOINTMENT
        // =======================================================

        appointments.push({

            appointmentId:
                String(data[i][0]).trim(),

            time:
                appointmentTime,

            patientName:
                String(data[i][4]).trim(),

            phone:
                String(data[i][5]).trim(),

            status:
                rowStatus

        });
    }


    // =========================================================
    // SORT BY TIME
    // =========================================================

    appointments.sort(
        function (a, b) {

            return String(a.time)
                .localeCompare(
                    String(b.time)
                );

        }
    );


    // =========================================================
    // RETURN RESULT
    // =========================================================

    return {

        success: true,

        doctorId:
            doctorId,

        doctorName:
            doctorName,

        clinicName:
            clinicName,

        date:
            targetDate,

        totalAppointments:
            appointments.length,

        appointments:
            appointments

    };
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


function getDoctorWeeklySchedule(
    doctorId,
    weekStartString
) {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const appointmentSheet =
        ss.getSheetByName("Appointments");

    const doctorSheet =
        ss.getSheetByName("Doctors");

    const range =
        appointmentSheet.getDataRange();

    const data =
        range.getValues();

    const displayData =
        range.getDisplayValues();

    const doctorData =
        doctorSheet
            .getDataRange()
            .getValues();


    // =========================================================
    // FIND DOCTOR
    // =========================================================

    let doctorName = "";
    let clinicName = "";

    for (
        let i = 1;
        i < doctorData.length;
        i++
    ) {

        if (
            String(doctorData[i][0]).trim() ===
            String(doctorId).trim()
        ) {

            doctorName =
                doctorData[i][1];

            clinicName =
                doctorData[i][2];

            break;
        }
    }


    if (!doctorName) {

        return {
            success: false,
            message: "Doctor not found."
        };
    }


    // =========================================================
    // CURRENT WEEK
    // Monday → Sunday
    // =========================================================

    let monday;

    if (weekStartString) {

        // Explicit Monday supplied
        monday =
            new Date(
                `${weekStartString}T00:00:00+05:30`
            );

    } else {

        // Current week's Monday
        const today = new Date();

        const dayOfWeek =
            Number(
                Utilities.formatDate(
                    today,
                    TIMEZONE,
                    "u"
                )
            );

        monday =
            new Date(today);

        monday.setDate(
            today.getDate() -
            (dayOfWeek - 1)
        );

        monday.setHours(
            0, 0, 0, 0
        );
    }

    monday.setHours(
        0, 0, 0, 0
    );


    const sunday =
        new Date(monday);

    sunday.setDate(
        monday.getDate() + 6
    );

    sunday.setHours(
        23, 59, 59, 999
    );


    // =========================================================
    // CREATE WEEK STRUCTURE
    // =========================================================

    const week = {};

    for (
        let i = 0;
        i < 7;
        i++
    ) {

        const currentDate =
            new Date(monday);

        currentDate.setDate(
            monday.getDate() + i
        );

        const dateKey =
            Utilities.formatDate(
                currentDate,
                TIMEZONE,
                "dd-MMM-yyyy"
            );

        const dayName =
            Utilities.formatDate(
                currentDate,
                TIMEZONE,
                "EEEE"
            );

        week[dateKey] = {

            day:
                dayName,

            date:
                dateKey,

            appointments: []

        };
    }


    // =========================================================
    // FIND APPOINTMENTS
    // =========================================================

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        const rowDoctorId =
            String(data[i][3]).trim();

        const status =
            String(data[i][6]).trim();


        // Doctor filter

        if (
            rowDoctorId !==
            String(doctorId).trim()
        ) {

            continue;
        }


        // Ignore cancelled

        if (
            status === "Cancelled"
        ) {

            continue;
        }


        // -------------------------------------------------------
        // Normalize date
        // -------------------------------------------------------

        let rowDate = "";

        if (
            data[i][1] instanceof Date
        ) {

            rowDate =
                Utilities.formatDate(
                    data[i][1],
                    TIMEZONE,
                    "dd-MMM-yyyy"
                );

        } else {

            rowDate =
                String(data[i][1]).trim();
        }


        // -------------------------------------------------------
        // Only current week
        // -------------------------------------------------------

        if (
            !week[rowDate]
        ) {

            continue;
        }


        // -------------------------------------------------------
        // Format appointment time
        // -------------------------------------------------------

        let appointmentTime = "";

        if (data[i][2] instanceof Date) {

            appointmentTime =
                Utilities.formatDate(
                    data[i][2],
                    TIMEZONE,
                    "hh:mm a"
                );

        } else {

            appointmentTime =
                String(data[i][2]).trim();

        }


        // -------------------------------------------------------
        // Add appointment
        // -------------------------------------------------------

        week[rowDate]
            .appointments
            .push({

                appointmentId:
                    String(data[i][0]).trim(),

                time:
                    appointmentTime,

                patientName:
                    String(data[i][4]).trim(),

                phone:
                    String(data[i][5]).trim(),

                status:
                    status

            });

    }
    // =========================================================
    // SORT EACH DAY
    // =========================================================

    Object.keys(week).forEach(
        function (dateKey) {

            week[dateKey]
                .appointments
                .sort(
                    function (a, b) {

                        return String(a.time)
                            .localeCompare(
                                String(b.time)
                            );

                    }
                );

        }
    );


    // =========================================================
    // TOTAL APPOINTMENTS
    // =========================================================

    let totalAppointments = 0;

    Object.keys(week).forEach(
        function (dateKey) {

            totalAppointments +=
                week[dateKey]
                    .appointments
                    .length;

        }
    );


    // =========================================================
    // RETURN
    // =========================================================

    return {

        success: true,

        doctorId:
            doctorId,

        doctorName:
            doctorName,

        clinicName:
            clinicName,

        weekStart:
            Utilities.formatDate(
                monday,
                TIMEZONE,
                "dd-MMM-yyyy"
            ),

        weekEnd:
            Utilities.formatDate(
                sunday,
                TIMEZONE,
                "dd-MMM-yyyy"
            ),

        totalAppointments:
            totalAppointments,

        week:
            week

    };
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


function getDoctorNextAppointment(doctorId) {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const appointmentSheet =
        ss.getSheetByName("Appointments");

    const doctorSheet =
        ss.getSheetByName("Doctors");

    const range =
        appointmentSheet.getDataRange();

    const data =
        range.getValues();

    const displayData =
        range.getDisplayValues();

    const doctorData =
        doctorSheet
            .getDataRange()
            .getValues();


    // =========================================================
    // FIND DOCTOR
    // =========================================================

    let doctorName = "";
    let clinicName = "";

    for (
        let i = 1;
        i < doctorData.length;
        i++
    ) {

        if (
            String(doctorData[i][0]).trim() ===
            String(doctorId).trim()
        ) {

            doctorName =
                doctorData[i][1];

            clinicName =
                doctorData[i][2];

            break;
        }
    }


    if (!doctorName) {

        return {
            success: false,
            message: "Doctor not found."
        };
    }


    // =========================================================
    // CURRENT TIME
    // =========================================================

    const now =
        new Date();

    let nextAppointment = null;
    let nextDateTime = null;


    // =========================================================
    // CHECK APPOINTMENTS
    // =========================================================

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        const rowDoctorId =
            String(data[i][3]).trim();

        const status =
            String(data[i][6]).trim();


        // Doctor filter

        if (
            rowDoctorId !==
            String(doctorId).trim()
        ) {

            continue;
        }


        // Ignore cancelled

        if (
            status === "Cancelled"
        ) {

            continue;
        }


        // =======================================================
        // DATE
        // =======================================================

        let appointmentDate;

        if (
            data[i][1] instanceof Date
        ) {

            appointmentDate =
                new Date(data[i][1]);

        } else {

            const dateText =
                String(data[i][1]).trim();

            appointmentDate =
                new Date(
                    `${dateText} 00:00:00`
                );
        }


        // =======================================================
        // TIME
        // =======================================================

        let appointmentDateTime =
            new Date(appointmentDate);


        if (
            data[i][2] instanceof Date
        ) {

            appointmentDateTime.setHours(
                data[i][2].getHours(),
                data[i][2].getMinutes(),
                data[i][2].getSeconds(),
                0
            );

        } else {

            const timeText =
                String(data[i][2]).trim();

            const parts =
                timeText.split(":");

            appointmentDateTime.setHours(
                Number(parts[0]),
                Number(parts[1]),
                0,
                0
            );
        }


        // =======================================================
        // ONLY FUTURE APPOINTMENTS
        // =======================================================

        if (
            appointmentDateTime <= now
        ) {

            continue;
        }


        // =======================================================
        // FIND EARLIEST
        // =======================================================

        if (
            nextDateTime === null ||
            appointmentDateTime < nextDateTime
        ) {

            nextDateTime =
                appointmentDateTime;

            nextAppointment = {

                appointmentId:
                    String(data[i][0]).trim(),

                date:
                    Utilities.formatDate(
                        appointmentDateTime,
                        TIMEZONE,
                        "dd-MMM-yyyy"
                    ),

                time:
                    Utilities.formatDate(
                        appointmentDateTime,
                        TIMEZONE,
                        "hh:mm a"
                    ),

                patientName:
                    String(data[i][4]).trim(),

                phone:
                    String(data[i][5]).trim(),

                status:
                    status

            };
        }
    }


    // =========================================================
    // NO UPCOMING APPOINTMENT
    // =========================================================

    if (!nextAppointment) {

        return {

            success: true,

            doctorId:
                doctorId,

            doctorName:
                doctorName,

            clinicName:
                clinicName,

            message:
                "No upcoming appointments.",

            appointment:
                null

        };
    }


    // =========================================================
    // RETURN
    // =========================================================

    return {

        success: true,

        doctorId:
            doctorId,

        doctorName:
            doctorName,

        clinicName:
            clinicName,

        appointment:
            nextAppointment

    };
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

const WHATSAPP_VERIFY_TOKEN = "ABC_CLINIC_VERIFY_2026";


function doGet(e) {

    const params = e.parameter;

    const mode =
        params["hub.mode"];

    const token =
        params["hub.verify_token"];

    const challenge =
        params["hub.challenge"];

    if (
        mode === "subscribe" &&
        token === WHATSAPP_VERIFY_TOKEN
    ) {

        return ContentService
            .createTextOutput(challenge)
            .setMimeType(
                ContentService.MimeType.TEXT
            );
    }

    return ContentService
        .createTextOutput("Verification failed")
        .setMimeType(
            ContentService.MimeType.TEXT
        );
}


// ============================================================
// WHATSAPP HELPERS - APPOINTMENT LISTS & SLOT FORMATTING
// ============================================================
//
// These support the "My Appointments", "Cancel Appointment",
// and "Reschedule Appointment" WhatsApp conversation flows.
//
// ============================================================

function parseAppointmentDateTime(
    dateString,
    timeString
) {

    const MONTHS = {
        Jan: 0, Feb: 1, Mar: 2, Apr: 3,
        May: 4, Jun: 5, Jul: 6, Aug: 7,
        Sep: 8, Oct: 9, Nov: 10, Dec: 11
    };

    const dateParts =
        String(dateString || "")
            .trim()
            .split("-");

    if (dateParts.length !== 3) {
        return null;
    }

    const day = Number(dateParts[0]);
    const month = MONTHS[dateParts[1]];
    const year = Number(dateParts[2]);

    if (
        isNaN(day) ||
        month === undefined ||
        isNaN(year)
    ) {
        return null;
    }

    const time24 =
        convert12HourTo24Hour(timeString);

    if (!time24) {
        return null;
    }

    const timeParts =
        time24.split(":");

    return new Date(
        year,
        month,
        day,
        Number(timeParts[0]),
        Number(timeParts[1]),
        0,
        0
    );
}


function getConfirmedAppointmentsForPhone(phone) {

    const appointments =
        getMyAppointments(phone);

    const confirmed =
        appointments.filter(
            function (appt) {
                return appt.status === "Confirmed";
            }
        );

    confirmed.sort(
        function (a, b) {

            const dateA =
                parseAppointmentDateTime(
                    a.date,
                    a.time
                );

            const dateB =
                parseAppointmentDateTime(
                    b.date,
                    b.time
                );

            const timeA =
                dateA ? dateA.getTime() : 0;

            const timeB =
                dateB ? dateB.getTime() : 0;

            return timeA - timeB;
        }
    );

    return confirmed;
}


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


function buildLanguageSelectionMessage() {

    return (
        "👋 Welcome to ABC Clinic!\n" +
        "ABC క్లినిక్‌కు స్వాగతం!\n" +
        "एबीसी क्लिनिक में आपका स्वागत है!\n\n" +
        "Please select your language / భాషను ఎంచుకోండి / अपनी भाषा चुनें:\n\n" +
        "1️⃣ English\n" +
        "2️⃣ తెలుగు\n" +
        "3️⃣ हिन्दी"
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
            "Sorry, I didn't understand that.": "క్షమించండి, నాకు అర్థం కాలేదు."
        },
        HI: {
            "Welcome to ABC Clinic!": "एबीसी क्लिनिक में आपका स्वागत है!",
            "Please choose an option:": "कृपया एक विकल्प चुनें:",
            "Book Appointment": "अपॉइंटमेंट बुक करें",
            "My Appointments": "मेरे अपॉइंटमेंट",
            "Cancel Appointment": "अपॉइंटमेंट रद्द करें",
            "Reschedule Appointment": "अपॉइंटमेंट का समय बदलें",
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
            "Sorry, I didn't understand that.": "क्षमा करें, मैं समझ नहीं पाया।"
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
        "4️⃣ Reschedule Appointment"
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

    const reply =
        "📅 Date selected: " +
        selectedDate +
        "\n\n" +
        "Available slots:\n\n" +
        formatAvailableSlotsForWhatsApp(slots) +
        "\nPlease choose a time.";

    sendWhatsAppReply(
        ss,
        senderPhone,
        reply
    );

    return true;
}


function doPost(e) {

    try {

        if (
            !e ||
            !e.postData ||
            !e.postData.contents
        ) {
            return ContentService
                .createTextOutput("EVENT_RECEIVED")
                .setMimeType(
                    ContentService.MimeType.TEXT
                );
        }

        const body =
            JSON.parse(
                e.postData.contents
            );

        const value =
            body &&
            body.entry &&
            body.entry[0] &&
            body.entry[0].changes &&
            body.entry[0].changes[0] &&
            body.entry[0].changes[0].value
                ? body.entry[0].changes[0].value
                : null;

        const message =
            value &&
            value.messages &&
            value.messages[0];

        // Ignore non-message webhook events
        if (!message) {

            return ContentService
                .createTextOutput("EVENT_RECEIVED")
                .setMimeType(
                    ContentService.MimeType.TEXT
                );
        }

        // Now it is safe to read message.id
        const messageId =
            String(message.id || "");


        // ========================================================
        // IGNORE DUPLICATE WHATSAPP WEBHOOK EVENTS
        // ========================================================

        if (
            isWhatsAppMessageProcessed(
                messageId
            )
        ) {

            return ContentService
                .createTextOutput(
                    "EVENT_RECEIVED"
                )
                .setMimeType(
                    ContentService.MimeType.TEXT
                );
        }

        const senderPhone =
            String(message.from);

        const messageType =
            String(message.type);

        let messageText = "";

        if (
            messageType === "text" &&
            message.text &&
            message.text.body !== undefined
        ) {

            messageText =
                String(message.text.body)
                    .trim();

        }


        // ========================================================
        // GOOGLE SHEET
        // ========================================================

        const ss =
            SpreadsheetApp
                .getActiveSpreadsheet();


        // ========================================================
        // LOG INCOMING MESSAGE
        // ========================================================

        let sheet =
            ss.getSheetByName(
                "WhatsApp_Log"
            );

        if (!sheet) {

            sheet =
                ss.insertSheet(
                    "WhatsApp_Log"
                );

            sheet.appendRow([
                "Timestamp",
                "Phone",
                "Name",
                "Type",
                "Message",
                "Phone Number ID"
            ]);
        }

        const senderName =
            value.contacts &&
                value.contacts[0] &&
                value.contacts[0].profile
                ? value.contacts[0].profile.name
                : "";

        const phoneNumberId =
            value.metadata
                ? value.metadata.phone_number_id
                : "";

        sheet.appendRow([

            new Date(),

            senderPhone,

            senderName,

            messageType,

            messageText,

            phoneNumberId

        ]);


        // ========================================================
        // WHATSAPP CONVERSATION
        // ========================================================

        if (
            messageType === "text" &&
            messageText
        ) {

            const normalizedMessage =
                messageText
                    .toLowerCase()
                    .trim();


            // ======================================================
            // GET CURRENT SESSION
            // ======================================================

            let session =
                getWhatsAppSession(
                    senderPhone
                );


            // ======================================================
            // HI / HELLO / HEY
            // ======================================================

            if (
                normalizedMessage === "hi" ||
                normalizedMessage === "hello" ||
                normalizedMessage === "hey" ||
                normalizedMessage === "హాయ్" ||
                normalizedMessage === "హలో" ||
                normalizedMessage === "नमस्ते" ||
                normalizedMessage === "हेलो"
            ) {

                // Start/reset patient session
                saveWhatsAppSession(
                    senderPhone,
                    {
                        role: "PATIENT",
                        state: "LANGUAGE_SELECT",
                        doctorId: "",
                        date: "",
                        time: "",
                        appointmentId: ""
                    }
                );

                const reply =
                    buildLanguageSelectionMessage();

                sendWhatsAppReply(
                    ss,
                    senderPhone,
                    reply
                );

            }


            // ======================================================
            // LANGUAGE SELECTION
            // ======================================================

            else if (
                session &&
                session.state === "LANGUAGE_SELECT"
            ) {

                const languageByChoice = {
                    "1": "EN",
                    "2": "TE",
                    "3": "HI"
                };

                const language =
                    languageByChoice[normalizedMessage];

                if (!language) {

                    sendWhatsAppReply(
                        ss,
                        senderPhone,
                        buildLanguageSelectionMessage()
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

                    sendWhatsAppReply(
                        ss,
                        senderPhone,
                        buildMainMenuMessage(
                            "👋 Welcome to ABC Clinic!"
                        )
                    );
                }
            }


            // ======================================================
            // MAIN MENU → BOOK APPOINTMENT
            // ======================================================

            else if (
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

                const reply =
                    buildDoctorSelectionMessage();

                sendWhatsAppReply(
                    ss,
                    senderPhone,
                    reply
                );

            }


            // ======================================================
            // MAIN MENU → MY APPOINTMENTS
            // ======================================================

            else if (
                normalizedMessage === "2" &&
                session &&
                session.state === "MAIN_MENU"
            ) {

                const appointments =
                    getMyAppointments(
                        senderPhone
                    ).filter(
                        function (appt) {
                            return appt.status === "Confirmed";
                        }
                    );

                let reply;

                if (
                    !appointments ||
                    appointments.length === 0
                ) {

                    reply =
                        buildMainMenuMessage(
                            "📋 You have no upcoming appointments."
                        );

                } else {

                    reply =
                        "📋 Your Appointments:\n\n" +
                        formatAppointmentsListForWhatsApp(
                            appointments
                        ) +
                        "Reply with:\n" +
                        "1️⃣ Book Appointment\n" +
                        "2️⃣ My Appointments\n" +
                        "3️⃣ Cancel Appointment\n" +
                        "4️⃣ Reschedule Appointment";
                }

                saveWhatsAppSession(
                    senderPhone,
                    {
                        role: "PATIENT",
                        state: "MAIN_MENU"
                    }
                );

                sendWhatsAppReply(
                    ss,
                    senderPhone,
                    reply
                );

            }


            // ======================================================
            // MAIN MENU → CANCEL APPOINTMENT
            // ======================================================

            else if (
                normalizedMessage === "3" &&
                session &&
                session.state === "MAIN_MENU"
            ) {

                const appointments =
                    getConfirmedAppointmentsForPhone(
                        senderPhone
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

                    sendWhatsAppReply(
                        ss,
                        senderPhone,
                        buildMainMenuMessage(
                            "❌ You have no active appointments to cancel."
                        )
                    );

                } else {

                    saveWhatsAppSession(
                        senderPhone,
                        {
                            role: "PATIENT",
                            state: "CANCEL_SELECT"
                        }
                    );

                    const reply =
                        "❌ Cancel Appointment\n\n" +
                        "Select the appointment to cancel:\n\n" +
                        formatAppointmentsListForWhatsApp(
                            appointments
                        ) +
                        "0️⃣ Back to Main Menu";

                    sendWhatsAppReply(
                        ss,
                        senderPhone,
                        reply
                    );
                }
            }


            // ======================================================
            // MAIN MENU → RESCHEDULE APPOINTMENT
            // ======================================================

            else if (
                normalizedMessage === "4" &&
                session &&
                session.state === "MAIN_MENU"
            ) {

                const appointments =
                    getConfirmedAppointmentsForPhone(
                        senderPhone
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

                    sendWhatsAppReply(
                        ss,
                        senderPhone,
                        buildMainMenuMessage(
                            "❌ You have no active appointments to reschedule."
                        )
                    );

                } else {

                    saveWhatsAppSession(
                        senderPhone,
                        {
                            role: "PATIENT",
                            state: "RESCHEDULE_SELECT"
                        }
                    );

                    const reply =
                        "🔄 Reschedule Appointment\n\n" +
                        "Select the appointment to reschedule:\n\n" +
                        formatAppointmentsListForWhatsApp(
                            appointments
                        ) +
                        "0️⃣ Back to Main Menu";

                    sendWhatsAppReply(
                        ss,
                        senderPhone,
                        reply
                    );
                }
            }


            // ======================================================
            // MAIN MENU → UNRECOGNIZED OPTION
            // ======================================================

            else if (
                session &&
                session.state === "MAIN_MENU"
            ) {

                sendWhatsAppReply(
                    ss,
                    senderPhone,
                    buildMainMenuMessage(
                        "❌ Invalid option."
                    )
                );
            }


            // ======================================================
            // BOOK_DOCTOR STATE
            // ======================================================

            else if (
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

                    const reply =
                        "❌ Please choose a valid doctor number.\n\n" +
                        buildDoctorSelectionMessage();

                    sendWhatsAppReply(
                        ss,
                        senderPhone,
                        reply
                    );

                }


                // ======================================================
                // DOCTOR FOUND
                // ======================================================

                else {

                    saveWhatsAppSession(
                        senderPhone,
                        {
                            role: "PATIENT",
                            state: "BOOK_DATE",
                            doctorId:
                                doctor.doctorId
                        }
                    );


                    const reply =
                        "👨‍⚕️ Doctor selected: " +
                        doctor.doctorName +
                        "\n\n" +
                        "Please choose a date:\n\n" +
                        "1️⃣ Today\n" +
                        "2️⃣ Tomorrow\n" +
                        "3️⃣ Enter another date";

                    sendWhatsAppReply(
                        ss,
                        senderPhone,
                        reply
                    );
                }
            }

            // ======================================================
            // BOOK_DATE STATE
            // ======================================================

            else if (
                session &&
                session.state === "BOOK_DATE"
            ) {

                let selectedDate = null;

                // -----------------------------
                // OPTION 1 → TODAY
                // -----------------------------

                if (normalizedMessage === "1") {

                    selectedDate =
                        Utilities.formatDate(
                            new Date(),
                            TIMEZONE,
                            "yyyy-MM-dd"
                        );
                }

                // -----------------------------
                // OPTION 2 → TOMORROW
                // -----------------------------

                else if (normalizedMessage === "2") {

                    const tomorrow =
                        new Date();

                    tomorrow.setDate(
                        tomorrow.getDate() + 1
                    );

                    selectedDate =
                        Utilities.formatDate(
                            tomorrow,
                            TIMEZONE,
                            "yyyy-MM-dd"
                        );
                }

                // -----------------------------
                // OPTION 3 → ENTER ANOTHER DATE
                // -----------------------------

                else if (normalizedMessage === "3") {

                    saveWhatsAppSession(
                        senderPhone,
                        {
                            state: "BOOK_DATE_CUSTOM"
                        }
                    );

                    sendWhatsAppReply(
                        ss,
                        senderPhone,
                        "📅 Please enter the date in YYYY-MM-DD format.\n\n" +
                        "Example:\n" +
                        "2026-08-25"
                    );

                    return ContentService
                        .createTextOutput(
                            "EVENT_RECEIVED"
                        )
                        .setMimeType(
                            ContentService.MimeType.TEXT
                        );
                }

                // -----------------------------
                // INVALID OPTION
                // -----------------------------

                else {

                    sendWhatsAppReply(
                        ss,
                        senderPhone,
                        "❌ Invalid option.\n\n" +
                        "Please reply with:\n\n" +
                        "1️⃣ Today\n" +
                        "2️⃣ Tomorrow\n" +
                        "3️⃣ Enter another date"
                    );

                    return ContentService
                        .createTextOutput(
                            "EVENT_RECEIVED"
                        )
                        .setMimeType(
                            ContentService.MimeType.TEXT
                        );
                }


                // ======================================================
                // GET AVAILABLE SLOTS
                // ======================================================

                const slots =
                    getAvailableSlots(
                        session.doctorId,
                        selectedDate
                    );


                // ======================================================
                // NO AVAILABLE SLOTS
                // ======================================================

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

                    return ContentService
                        .createTextOutput(
                            "EVENT_RECEIVED"
                        )
                        .setMimeType(
                            ContentService.MimeType.TEXT
                        );
                }


                // ======================================================
                // SAVE SELECTED DATE
                // ======================================================

                saveWhatsAppSession(
                    senderPhone,
                    {
                        state: "BOOK_TIME",
                        date: selectedDate
                    }
                );


                // ======================================================
                // BUILD SLOT MESSAGE
                // ======================================================

                let reply =
                    "📅 Date selected: " +
                    selectedDate +
                    "\n\n" +
                    "Available slots:\n\n";


                for (
                    let i = 0;
                    i < slots.length;
                    i++
                ) {

                    reply +=
                        (i + 1) +
                        "️⃣ " +
                        slots[i] +
                        "\n";
                }


                reply +=
                    "\nPlease choose a time.";


                sendWhatsAppReply(
                    ss,
                    senderPhone,
                    reply
                );
            }


            // ======================================================
            // BOOK_DATE_CUSTOM STATE (manually typed date)
            // ======================================================

            else if (
                session &&
                session.state === "BOOK_DATE_CUSTOM"
            ) {

                const typedDate =
                    messageText.trim();

                if (
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

                    return ContentService
                        .createTextOutput(
                            "EVENT_RECEIVED"
                        )
                        .setMimeType(
                            ContentService.MimeType.TEXT
                        );
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

                    sendWhatsAppReply(
                        ss,
                        senderPhone,
                        "❌ That date is in the past.\n\n" +
                        "Please enter a valid future date (YYYY-MM-DD)."
                    );

                    return ContentService
                        .createTextOutput(
                            "EVENT_RECEIVED"
                        )
                        .setMimeType(
                            ContentService.MimeType.TEXT
                        );
                }

                whatsAppShowSlotsForDate(
                    ss,
                    senderPhone,
                    session.doctorId,
                    typedDate,
                    "BOOK_TIME"
                );
            }



            // ======================================================
            // BOOK_CONFIRM STATE
            // ======================================================

            else if (
                session &&
                session.state === "BOOK_CONFIRM"
            ) {

                if (normalizedMessage === "1") {

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

                        return ContentService
                            .createTextOutput(
                                "EVENT_RECEIVED"
                            )
                            .setMimeType(
                                ContentService.MimeType.TEXT
                            );
                    }

                    const bookingResult =
                        bookAppointment(
                            session.doctorId,
                            session.date,
                            session.time,
                            senderName ||
                                "WhatsApp Patient",
                            senderPhone
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

                        const reply =
                            "✅ Appointment confirmed!\n\n" +
                            "🆔 Appointment ID: " +
                            bookingResult.appointmentId +
                            "\n" +
                            "👨‍⚕️ Doctor: " +
                            bookingResult.doctor +
                            "\n" +
                            "📅 Date: " +
                            bookingResult.date +
                            "\n" +
                            "🕐 Time: " +
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
                    normalizedMessage === "2"
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

                        return ContentService
                            .createTextOutput(
                                "EVENT_RECEIVED"
                            )
                            .setMimeType(
                                ContentService.MimeType.TEXT
                            );
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

                        return ContentService
                            .createTextOutput(
                                "EVENT_RECEIVED"
                            )
                            .setMimeType(
                                ContentService.MimeType.TEXT
                            );
                    }

                    saveWhatsAppSession(
                        senderPhone,
                        {
                            state: "BOOK_TIME",
                            time: ""
                        }
                    );

                    let reply =
                        "📅 Date: " +
                        session.date +
                        "\n\n" +
                        "Available slots:\n\n";

                    for (
                        let i = 0;
                        i < slots.length;
                        i++
                    ) {

                        reply +=
                            (i + 1) +
                            "️⃣ " +
                            slots[i] +
                            "\n";
                    }

                    reply +=
                        "\nPlease choose a time.";

                    sendWhatsAppReply(
                        ss,
                        senderPhone,
                        reply
                    );

                } else if (
                    normalizedMessage === "3"
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

                    sendWhatsAppReply(
                        ss,
                        senderPhone,
                        "❌ Appointment booking cancelled.\n\n" +
                        "Please choose an option:\n\n" +
                        "1️⃣ Book Appointment\n" +
                        "2️⃣ My Appointments\n" +
                        "3️⃣ Cancel Appointment\n" +
                        "4️⃣ Reschedule Appointment"
                    );

                } else {

                    sendWhatsAppReply(
                        ss,
                        senderPhone,
                        "❌ Invalid option.\n\n" +
                        "Please reply with:\n\n" +
                        "1️⃣ Confirm\n" +
                        "2️⃣ Choose another time\n" +
                        "3️⃣ Cancel"
                    );
                }
            }


            // ======================================================
            // BOOK_TIME STATE
            // ======================================================

            else if (
                session &&
                session.state === "BOOK_TIME"
            ) {

                // --------------------------------------------------
                // Validate session data
                // --------------------------------------------------

                if (
                    !session.doctorId ||
                    !session.date
                ) {

                    sendWhatsAppReply(
                        ss,
                        senderPhone,
                        "❌ Your booking session has expired.\n\n" +
                        "Please send Hi to start again."
                    );

                    return ContentService
                        .createTextOutput(
                            "EVENT_RECEIVED"
                        )
                        .setMimeType(
                            ContentService.MimeType.TEXT
                        );
                }

                // Make sure date is YYYY-MM-DD
                const bookingDate =
                    String(session.date).trim();

                if (
                    !isValidISODate(
                        bookingDate
                    )
                ) {

                    sendWhatsAppReply(
                        ss,
                        senderPhone,
                        "❌ The booking date is invalid.\n\n" +
                        "Please send Hi to start again."
                    );

                    return ContentService
                        .createTextOutput(
                            "EVENT_RECEIVED"
                        )
                        .setMimeType(
                            ContentService.MimeType.TEXT
                        );
                }

                const slotNumber =
                    parseInt(
                        normalizedMessage,
                        10
                    );

                // --------------------------------------------------
                // Get available slots
                // --------------------------------------------------

                const slots =
                    getAvailableSlots(
                        session.doctorId,
                        bookingDate
                    );

                // --------------------------------------------------
                // Validate slot number
                // --------------------------------------------------

                if (
                    isNaN(slotNumber) ||
                    slotNumber < 1 ||
                    slotNumber > slots.length
                ) {

                    let reply =
                        "❌ Invalid time selection.\n\n" +
                        "Please choose one of the available slots:\n\n";

                    for (
                        let i = 0;
                        i < slots.length;
                        i++
                    ) {

                        reply +=
                            (i + 1) +
                            "️⃣ " +
                            slots[i] +
                            "\n";
                    }

                    sendWhatsAppReply(
                        ss,
                        senderPhone,
                        reply
                    );

                    return ContentService
                        .createTextOutput(
                            "EVENT_RECEIVED"
                        )
                        .setMimeType(
                            ContentService.MimeType.TEXT
                        );
                }

                // --------------------------------------------------
                // Select time
                // --------------------------------------------------

                const selectedTime =
                    slots[slotNumber - 1];

                // --------------------------------------------------
                // Save time + move to confirmation
                // --------------------------------------------------

                saveWhatsAppSession(
                    senderPhone,
                    {
                        state: "BOOK_CONFIRM",
                        time: selectedTime
                    }
                );

                // --------------------------------------------------
                // Confirmation
                // --------------------------------------------------

                const reply =
                    "🕐 Time selected: " +
                    selectedTime +
                    "\n\n" +

                    "👨‍⚕️ Doctor: " +
                    (
                        findDoctorById(
                            session.doctorId
                        ) || "Unknown Doctor"
                    ) +
                    "\n" +
                    "📅 Date: " +
                    bookingDate +
                    "\n" +
                    "🕐 Time: " +
                    selectedTime +
                    "\n\n" +

                    "Confirm appointment?\n\n" +
                    "1️⃣ Confirm\n" +
                    "2️⃣ Choose another time\n" +
                    "3️⃣ Cancel";

                sendWhatsAppReply(
                    ss,
                    senderPhone,
                    reply
                );
            }


            // ======================================================
            // CANCEL_SELECT STATE
            // ======================================================

            else if (
                session &&
                session.state === "CANCEL_SELECT"
            ) {

                if (normalizedMessage === "0") {

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

                    sendWhatsAppReply(
                        ss,
                        senderPhone,
                        buildMainMenuMessage(
                            "👋 Back to main menu."
                        )
                    );

                    return ContentService
                        .createTextOutput(
                            "EVENT_RECEIVED"
                        )
                        .setMimeType(
                            ContentService.MimeType.TEXT
                        );
                }

                const appointments =
                    getConfirmedAppointmentsForPhone(
                        senderPhone
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

                    const reply =
                        "❌ Invalid selection.\n\n" +
                        "Select the appointment to cancel:\n\n" +
                        formatAppointmentsListForWhatsApp(
                            appointments
                        ) +
                        "0️⃣ Back to Main Menu";

                    sendWhatsAppReply(
                        ss,
                        senderPhone,
                        reply
                    );

                    return ContentService
                        .createTextOutput(
                            "EVENT_RECEIVED"
                        )
                        .setMimeType(
                            ContentService.MimeType.TEXT
                        );
                }

                const chosen =
                    appointments[selection - 1];

                saveWhatsAppSession(
                    senderPhone,
                    {
                        state: "CANCEL_CONFIRM",
                        appointmentId:
                            chosen.appointmentId
                    }
                );

                const doctorName =
                    findDoctorById(
                        chosen.doctorId
                    ) || "Unknown Doctor";

                const reply =
                    "❌ Cancel this appointment?\n\n" +
                    "👨‍⚕️ Doctor: " + doctorName + "\n" +
                    "📅 Date: " + chosen.date + "\n" +
                    "🕐 Time: " + chosen.time + "\n" +
                    "🆔 " + chosen.appointmentId +
                    "\n\n" +
                    "1️⃣ Yes, cancel it\n" +
                    "2️⃣ No, go back";

                sendWhatsAppReply(
                    ss,
                    senderPhone,
                    reply
                );
            }


            // ======================================================
            // CANCEL_CONFIRM STATE
            // ======================================================

            else if (
                session &&
                session.state === "CANCEL_CONFIRM"
            ) {

                if (normalizedMessage === "1") {

                    const result =
                        cancelAppointment(
                            session.appointmentId,
                            senderPhone
                        );

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

                    const prefix =
                        result && result.success
                            ? "✅ " + result.message
                            : "❌ " +
                              (
                                  result && result.message
                                      ? result.message
                                      : "Unable to cancel the appointment."
                              );

                    sendWhatsAppReply(
                        ss,
                        senderPhone,
                        buildMainMenuMessage(prefix)
                    );

                } else {

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

                    sendWhatsAppReply(
                        ss,
                        senderPhone,
                        buildMainMenuMessage(
                            "👍 Okay, appointment was not cancelled."
                        )
                    );
                }
            }


            // ======================================================
            // RESCHEDULE_SELECT STATE
            // ======================================================

            else if (
                session &&
                session.state === "RESCHEDULE_SELECT"
            ) {

                if (normalizedMessage === "0") {

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

                    sendWhatsAppReply(
                        ss,
                        senderPhone,
                        buildMainMenuMessage(
                            "👋 Back to main menu."
                        )
                    );

                    return ContentService
                        .createTextOutput(
                            "EVENT_RECEIVED"
                        )
                        .setMimeType(
                            ContentService.MimeType.TEXT
                        );
                }

                const appointments =
                    getConfirmedAppointmentsForPhone(
                        senderPhone
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

                    const reply =
                        "❌ Invalid selection.\n\n" +
                        "Select the appointment to reschedule:\n\n" +
                        formatAppointmentsListForWhatsApp(
                            appointments
                        ) +
                        "0️⃣ Back to Main Menu";

                    sendWhatsAppReply(
                        ss,
                        senderPhone,
                        reply
                    );

                    return ContentService
                        .createTextOutput(
                            "EVENT_RECEIVED"
                        )
                        .setMimeType(
                            ContentService.MimeType.TEXT
                        );
                }

                const chosen =
                    appointments[selection - 1];

                saveWhatsAppSession(
                    senderPhone,
                    {
                        state: "RESCHEDULE_DATE",
                        appointmentId:
                            chosen.appointmentId,
                        doctorId:
                            chosen.doctorId,
                        date: "",
                        time: ""
                    }
                );

                const doctorName =
                    findDoctorById(
                        chosen.doctorId
                    ) || "Unknown Doctor";

                const reply =
                    "🔄 Rescheduling appointment with " +
                    doctorName +
                    " (currently " +
                    chosen.date + " " + chosen.time +
                    ").\n\n" +
                    "Please choose a new date:\n\n" +
                    "1️⃣ Today\n" +
                    "2️⃣ Tomorrow\n" +
                    "3️⃣ Enter another date";

                sendWhatsAppReply(
                    ss,
                    senderPhone,
                    reply
                );
            }


            // ======================================================
            // RESCHEDULE_DATE STATE
            // ======================================================

            else if (
                session &&
                session.state === "RESCHEDULE_DATE"
            ) {

                let selectedDate = null;

                if (normalizedMessage === "1") {

                    selectedDate =
                        Utilities.formatDate(
                            new Date(),
                            TIMEZONE,
                            "yyyy-MM-dd"
                        );

                } else if (normalizedMessage === "2") {

                    const tomorrow =
                        new Date();

                    tomorrow.setDate(
                        tomorrow.getDate() + 1
                    );

                    selectedDate =
                        Utilities.formatDate(
                            tomorrow,
                            TIMEZONE,
                            "yyyy-MM-dd"
                        );

                } else if (normalizedMessage === "3") {

                    saveWhatsAppSession(
                        senderPhone,
                        {
                            state: "RESCHEDULE_DATE_CUSTOM"
                        }
                    );

                    sendWhatsAppReply(
                        ss,
                        senderPhone,
                        "📅 Please enter the new date in YYYY-MM-DD format.\n\n" +
                        "Example:\n" +
                        "2026-08-25"
                    );

                    return ContentService
                        .createTextOutput(
                            "EVENT_RECEIVED"
                        )
                        .setMimeType(
                            ContentService.MimeType.TEXT
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

                    return ContentService
                        .createTextOutput(
                            "EVENT_RECEIVED"
                        )
                        .setMimeType(
                            ContentService.MimeType.TEXT
                        );
                }

                whatsAppShowSlotsForDate(
                    ss,
                    senderPhone,
                    session.doctorId,
                    selectedDate,
                    "RESCHEDULE_TIME"
                );
            }


            // ======================================================
            // RESCHEDULE_DATE_CUSTOM STATE (manually typed date)
            // ======================================================

            else if (
                session &&
                session.state === "RESCHEDULE_DATE_CUSTOM"
            ) {

                const typedDate =
                    messageText.trim();

                if (
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

                    return ContentService
                        .createTextOutput(
                            "EVENT_RECEIVED"
                        )
                        .setMimeType(
                            ContentService.MimeType.TEXT
                        );
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

                    sendWhatsAppReply(
                        ss,
                        senderPhone,
                        "❌ That date is in the past.\n\n" +
                        "Please enter a valid future date (YYYY-MM-DD)."
                    );

                    return ContentService
                        .createTextOutput(
                            "EVENT_RECEIVED"
                        )
                        .setMimeType(
                            ContentService.MimeType.TEXT
                        );
                }

                whatsAppShowSlotsForDate(
                    ss,
                    senderPhone,
                    session.doctorId,
                    typedDate,
                    "RESCHEDULE_TIME"
                );
            }


            // ======================================================
            // RESCHEDULE_TIME STATE
            // ======================================================

            else if (
                session &&
                session.state === "RESCHEDULE_TIME"
            ) {

                if (
                    !session.doctorId ||
                    !session.date
                ) {

                    sendWhatsAppReply(
                        ss,
                        senderPhone,
                        "❌ Your reschedule session has expired.\n\n" +
                        "Please send Hi to start again."
                    );

                    return ContentService
                        .createTextOutput(
                            "EVENT_RECEIVED"
                        )
                        .setMimeType(
                            ContentService.MimeType.TEXT
                        );
                }

                const newDate =
                    String(session.date).trim();

                if (
                    !isValidISODate(newDate)
                ) {

                    sendWhatsAppReply(
                        ss,
                        senderPhone,
                        "❌ The selected date is invalid.\n\n" +
                        "Please send Hi to start again."
                    );

                    return ContentService
                        .createTextOutput(
                            "EVENT_RECEIVED"
                        )
                        .setMimeType(
                            ContentService.MimeType.TEXT
                        );
                }

                const slotNumber =
                    parseInt(
                        normalizedMessage,
                        10
                    );

                const slots =
                    getAvailableSlots(
                        session.doctorId,
                        newDate
                    );

                if (
                    isNaN(slotNumber) ||
                    slotNumber < 1 ||
                    slotNumber > slots.length
                ) {

                    const reply =
                        "❌ Invalid time selection.\n\n" +
                        "Please choose one of the available slots:\n\n" +
                        formatAvailableSlotsForWhatsApp(slots);

                    sendWhatsAppReply(
                        ss,
                        senderPhone,
                        reply
                    );

                    return ContentService
                        .createTextOutput(
                            "EVENT_RECEIVED"
                        )
                        .setMimeType(
                            ContentService.MimeType.TEXT
                        );
                }

                const selectedTime =
                    slots[slotNumber - 1];

                saveWhatsAppSession(
                    senderPhone,
                    {
                        state: "RESCHEDULE_CONFIRM",
                        time: selectedTime
                    }
                );

                const reply =
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
                    "3️⃣ Cancel";

                sendWhatsAppReply(
                    ss,
                    senderPhone,
                    reply
                );
            }


            // ======================================================
            // RESCHEDULE_CONFIRM STATE
            // ======================================================

            else if (
                session &&
                session.state === "RESCHEDULE_CONFIRM"
            ) {

                if (normalizedMessage === "1") {

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

                        return ContentService
                            .createTextOutput(
                                "EVENT_RECEIVED"
                            )
                            .setMimeType(
                                ContentService.MimeType.TEXT
                            );
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
                            "🆔 Appointment ID: " +
                            result.appointmentId +
                            "\n" +
                            "👨‍⚕️ Doctor: " +
                            result.doctor +
                            "\n" +
                            "📅 New Date: " +
                            result.date +
                            "\n" +
                            "🕐 New Time: " +
                            result.time +
                            "\n\n" +
                            "Thank you for choosing ABC Clinic.";

                        sendWhatsAppReply(
                            ss,
                            senderPhone,
                            reply
                        );

                    } else {

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

                        const errorMessage =
                            result && result.message
                                ? result.message
                                : "Unable to reschedule the appointment.";

                        sendWhatsAppReply(
                            ss,
                            senderPhone,
                            buildMainMenuMessage(
                                "❌ " + errorMessage
                            )
                        );
                    }

                } else if (
                    normalizedMessage === "2"
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

                        return ContentService
                            .createTextOutput(
                                "EVENT_RECEIVED"
                            )
                            .setMimeType(
                                ContentService.MimeType.TEXT
                            );
                    }

                    whatsAppShowSlotsForDate(
                        ss,
                        senderPhone,
                        session.doctorId,
                        session.date,
                        "RESCHEDULE_TIME"
                    );

                } else if (
                    normalizedMessage === "3"
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

                    sendWhatsAppReply(
                        ss,
                        senderPhone,
                        buildMainMenuMessage(
                            "❌ Reschedule cancelled."
                        )
                    );

                } else {

                    sendWhatsAppReply(
                        ss,
                        senderPhone,
                        "❌ Invalid option.\n\n" +
                        "Please reply with:\n\n" +
                        "1️⃣ Confirm\n" +
                        "2️⃣ Choose another time\n" +
                        "3️⃣ Cancel"
                    );
                }
            }


            // ======================================================
            // FALLBACK - unrecognized message / no active session
            // ======================================================

            else {

                sendWhatsAppReply(
                    ss,
                    senderPhone,
                    "🤔 Sorry, I didn't understand that.\n\n" +
                    "Please send Hi to start."
                );
            }

        }


        // ========================================================
        // WEBHOOK RESPONSE
        // ========================================================

        return ContentService
            .createTextOutput(
                "EVENT_RECEIVED"
            )
            .setMimeType(
                ContentService.MimeType.TEXT
            );


    } catch (error) {

        Logger.log(
            "Webhook error: " +
            error.message
        );

        Logger.log(
            error.stack
        );

        try {

            const ss =
                SpreadsheetApp
                    .getActiveSpreadsheet();

            let debugSheet =
                ss.getSheetByName(
                    "WhatsApp_Debug"
                );

            if (!debugSheet) {

                debugSheet =
                    ss.insertSheet(
                        "WhatsApp_Debug"
                    );

                debugSheet.appendRow([
                    "Timestamp",
                    "Direction",
                    "Phone",
                    "Status",
                    "Response"
                ]);
            }

            debugSheet.appendRow([
                new Date(),
                "WEBHOOK",
                "",
                "ERROR",
                error.message +
                "\n" +
                error.stack
            ]);

        } catch (debugError) {

            Logger.log(
                "Could not write debug error: " +
                debugError.message
            );
        }

        return ContentService
            .createTextOutput(
                "ERROR"
            )
            .setMimeType(
                ContentService.MimeType.TEXT
            );
    }
}


function isWhatsAppMessageProcessed(messageId) {

    if (!messageId) {
        return false;
    }

    const cache =
        CacheService.getScriptCache();

    const key =
        "WA_PROCESSED_" + messageId;

    if (cache.get(key)) {
        return true;
    }

    cache.put(
        key,
        "1",
        21600
    );

    return false;
}


function sendWhatsAppReply(
    ss,
    phone,
    reply
) {

    try {

        const session =
            getWhatsAppSession(phone);

        const language =
            session && session.state === "LANGUAGE_SELECT"
                ? "EN"
                : session && session.language;

        const localizedReply =
            localizeWhatsAppReply(
                language,
                reply
            );

        const sendResult =
            sendWhatsAppText(
                phone,
                localizedReply
            );


        // ======================================================
        // DEBUG SHEET
        // ======================================================

        let debugSheet =
            ss.getSheetByName(
                "WhatsApp_Debug"
            );

        if (!debugSheet) {

            debugSheet =
                ss.insertSheet(
                    "WhatsApp_Debug"
                );

            debugSheet.appendRow([
                "Timestamp",
                "Direction",
                "Phone",
                "Status",
                "Response"
            ]);
        }

        debugSheet.appendRow([
            new Date(),
            "OUTBOUND",
            phone,
            "SUCCESS",
            JSON.stringify(
                sendResult
            )
        ]);

        return sendResult;

    } catch (error) {

        let debugSheet =
            ss.getSheetByName(
                "WhatsApp_Debug"
            );

        if (!debugSheet) {

            debugSheet =
                ss.insertSheet(
                    "WhatsApp_Debug"
                );

            debugSheet.appendRow([
                "Timestamp",
                "Direction",
                "Phone",
                "Status",
                "Response"
            ]);
        }

        debugSheet.appendRow([
            new Date(),
            "OUTBOUND",
            phone,
            "ERROR",
            error.message
        ]);

        throw error;
    }
}

function sendWhatsAppText(to, messageText) {

    const properties =
        PropertiesService.getScriptProperties();

    const accessToken =
        properties.getProperty(
            "WHATSAPP_ACCESS_TOKEN"
        );

    const phoneNumberId =
        properties.getProperty(
            "WHATSAPP_PHONE_NUMBER_ID"
        );

    if (!accessToken) {
        throw new Error(
            "WHATSAPP_ACCESS_TOKEN is missing."
        );
    }

    if (!phoneNumberId) {
        throw new Error(
            "WHATSAPP_PHONE_NUMBER_ID is missing."
        );
    }


    const url =
        "https://graph.facebook.com/v26.0/" +
        phoneNumberId +
        "/messages";


    const payload = {

        messaging_product:
            "whatsapp",

        recipient_type:
            "individual",

        to:
            String(to),

        type:
            "text",

        text: {

            preview_url:
                false,

            body:
                String(messageText)

        }

    };


    const response =
        UrlFetchApp.fetch(
            url,
            {

                method:
                    "post",

                contentType:
                    "application/json",

                headers: {

                    Authorization:
                        "Bearer " +
                        accessToken

                },

                payload:
                    JSON.stringify(payload),

                muteHttpExceptions:
                    true

            }
        );


    const responseCode =
        response.getResponseCode();

    const responseBody =
        response.getContentText();


    Logger.log(
        "WhatsApp HTTP status: " +
        responseCode
    );

    Logger.log(
        "WhatsApp response: " +
        responseBody
    );


    if (
        responseCode < 200 ||
        responseCode >= 300
    ) {

        throw new Error(
            "WhatsApp API error: " +
            responseBody
        );
    }


    return JSON.parse(
        responseBody
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


function sendWhatsAppTemplate(to) {

    const properties =
        PropertiesService.getScriptProperties();

    const accessToken =
        properties.getProperty(
            "WHATSAPP_ACCESS_TOKEN"
        );

    const phoneNumberId =
        properties.getProperty(
            "WHATSAPP_PHONE_NUMBER_ID"
        );

    const url =
        "https://graph.facebook.com/v25.0/" +
        phoneNumberId +
        "/messages";

    const payload = {

        messaging_product:
            "whatsapp",

        to:
            String(to),

        type:
            "template",

        template: {

            name:
                "hello_world",

            language: {
                code: "en_US"
            }

        }
    };

    const response =
        UrlFetchApp.fetch(
            url,
            {
                method: "post",

                contentType:
                    "application/json",

                headers: {
                    Authorization:
                        "Bearer " +
                        accessToken
                },

                payload:
                    JSON.stringify(payload),

                muteHttpExceptions:
                    true
            }
        );

    const code =
        response.getResponseCode();

    const body =
        response.getContentText();

    Logger.log(
        "HTTP: " + code
    );

    Logger.log(
        body
    );

    if (
        code < 200 ||
        code >= 300
    ) {
        throw new Error(
            "WhatsApp API error: " +
            body
        );
    }

    return JSON.parse(body);
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


function getWhatsAppSession(phone) {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("WhatsApp_Sessions");

    if (!sheet) {
        throw new Error(
            "WhatsApp_Sessions sheet not found."
        );
    }

    const range =
        sheet.getDataRange();

    const data =
        range.getValues();

    const normalizedPhone =
        String(phone).trim();

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        if (
            String(data[i][0]).trim() !==
            normalizedPhone
        ) {
            continue;
        }

        // ----------------------------------------------------------
        // IMPORTANT:
        // Google Sheets may automatically convert:
        //   "2026-08-18" -> Date object
        //   "10:00 AM"  -> Date object
        //
        // Never use String(Date) for these fields because it produces
        // values such as:
        //   "Tue Aug 18 2026 00:00:00 GMT+0530..."
        //
        // Normalize them back to the values used by the application.
        // ----------------------------------------------------------

        let sessionDate = "";

        if (
            data[i][4] instanceof Date &&
            !isNaN(data[i][4].getTime())
        ) {

            sessionDate =
                Utilities.formatDate(
                    data[i][4],
                    TIMEZONE,
                    "yyyy-MM-dd"
                );

        } else {

            sessionDate =
                String(data[i][4] || "").trim();
        }

        let sessionTime = "";

        if (
            data[i][5] instanceof Date &&
            !isNaN(data[i][5].getTime())
        ) {

            sessionTime =
                Utilities.formatDate(
                    data[i][5],
                    TIMEZONE,
                    "hh:mm a"
                );

        } else {

            sessionTime =
                String(data[i][5] || "").trim();
        }

        return {

            row:
                i + 1,

            phone:
                String(data[i][0]).trim(),

            role:
                String(data[i][1] || "").trim(),

            state:
                String(data[i][2] || "").trim(),

            doctorId:
                String(data[i][3] || "").trim(),

            date:
                sessionDate,

            time:
                sessionTime,

            appointmentId:
                String(data[i][6] || "").trim(),

            updatedAt:
                data[i][7],

            language:
                String(data[i][8] || "EN")
                    .trim()
                    .toUpperCase()
        };
    }

    return null;
}


function ensureWhatsAppSessionLanguageColumn(sheet) {

    if (!sheet.getRange(1, 9).getValue()) {
        sheet
            .getRange(1, 9)
            .setValue("Language");
    }
}


function saveWhatsAppSession(
    phone,
    updates
) {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName(
            "WhatsApp_Sessions"
        );

    if (!sheet) {
        throw new Error(
            "WhatsApp_Sessions sheet not found."
        );
    }

    ensureWhatsAppSessionLanguageColumn(sheet);

    const existing =
        getWhatsAppSession(phone);

    const now =
        new Date();

    if (existing) {

        const row =
            existing.row;

        const current =
            sheet
                .getRange(row, 1, 1, 9)
                .getValues()[0];

        sheet
            .getRange(row, 1, 1, 9)
            .setValues([[
                phone,

                updates.role !== undefined
                    ? updates.role
                    : current[1],

                updates.state !== undefined
                    ? updates.state
                    : current[2],

                updates.doctorId !== undefined
                    ? updates.doctorId
                    : current[3],

                updates.date !== undefined
                    ? updates.date
                    : current[4],

                updates.time !== undefined
                    ? updates.time
                    : current[5],

                updates.appointmentId !== undefined
                    ? updates.appointmentId
                    : current[6],

                now,

                updates.language !== undefined
                    ? updates.language
                    : current[8]
            ]]);

    } else {

        sheet.appendRow([
            phone,
            updates.role || "",
            updates.state || "",
            updates.doctorId || "",
            updates.date || "",
            updates.time || "",
            updates.appointmentId || "",
            now,
            updates.language || "EN"
        ]);
    }
}

function clearWhatsAppSession(phone) {

    const session =
        getWhatsAppSession(phone);

    if (!session) {
        return;
    }

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName(
            "WhatsApp_Sessions"
        );

    sheet
        .getRange(
            session.row,
            2,
            1,
            7
        )
        .clearContent();
}

function testWhatsAppSession() {

    const phone =
        "919700060850";

    saveWhatsAppSession(
        phone,
        {
            role: "PATIENT",
            state: "MAIN_MENU"
        }
    );

    const session =
        getWhatsAppSession(phone);

    Logger.log(
        JSON.stringify(
            session,
            null,
            2
        )
    );
}



function findDoctorById(doctorId) {

    const ss =
        SpreadsheetApp
            .getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Doctors");

    if (!sheet) {
        return null;
    }

    const data =
        sheet.getDataRange().getValues();

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        if (
            String(data[i][0]).trim() ===
            String(doctorId).trim()
        ) {

            return String(
                data[i][1]
            ).trim();
        }
    }

    return null;
}


function findDoctorByName(doctorName) {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Doctors");

    if (!sheet) {
        throw new Error(
            "Doctors sheet not found."
        );
    }

    const data =
        sheet.getDataRange().getValues();

    const searchName =
        String(doctorName)
            .trim()
            .toLowerCase();

    for (let i = 1; i < data.length; i++) {

        const doctorId =
            String(data[i][0]).trim();

        const name =
            String(data[i][1]).trim();

        if (
            name.toLowerCase() ===
            searchName
        ) {

            return {
                doctorId: doctorId,
                doctorName: name,
                clinicName:
                    String(data[i][2]).trim()
            };
        }
    }

    return null;
}
