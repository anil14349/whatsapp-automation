// ============================================================
// Model_Appointments — part of the ABC Clinic WhatsApp bot
// Book / cancel / reschedule appointments; appointment lookups by phone or doctor.
// See src/Config.gs for the full file-layout map and Script Properties.
// ============================================================



// ============================================================
// 3. BOOK APPOINTMENT
// ============================================================

// Appointment IDs are an 8-hex-char UUID prefix — short for readability,
// but not collision-proof on its own over a long-lived, high-volume
// sheet. Checked against every existing ID (retrying on the rare
// collision) so cancelAppointment/rescheduleAppointment's "find the row
// whose ID matches" lookups can never land on the wrong appointment.
// Must be called while bookAppointment's lock is held, so two concurrent
// bookings can't both pick the same candidate before either is written.
function generateUniqueAppointmentId(appointmentSheet) {

    const data =
        appointmentSheet.getDataRange().getValues();

    const existingIds = {};

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        const id =
            String(data[i][0] || "").trim();

        if (id) {
            existingIds[id] = true;
        }
    }

    const maxAttempts = 5;

    for (
        let attempt = 0;
        attempt < maxAttempts;
        attempt++
    ) {

        const candidate =
            "A" +
            Utilities.getUuid()
                .replace(/-/g, "")
                .substring(0, 8)
                .toUpperCase();

        if (!existingIds[candidate]) {
            return candidate;
        }
    }

    throw new Error(
        "Unable to generate a unique appointment ID after " +
        maxAttempts +
        " attempts."
    );
}



function bookAppointment(
    doctorId,
    dateString,
    timeString,
    patientName,
    patientPhone,
    patientLanguage
) {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const appointmentSheet =
        ss.getSheetByName("Appointments");

    const doctor =
        getDoctorRecord(doctorId);

    if (
        !doctor ||
        !doctor.calendarId
    ) {

        return {
            success: false,
            message: "Doctor not found."
        };
    }

    const doctorName = doctor.doctorName;
    const clinicName = doctor.clinicName;
    const calendarId = doctor.calendarId;

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

    const appointmentDuration =
        getDoctorAppointmentDuration(
            doctorId
        );

    const endTime =
        new Date(
            startTime.getTime() +
            appointmentDuration * 60000
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
    // Validate against working hours
    // ----------------------------------------------------------

    const availableSlots =
        getAvailableSlots(
            doctorId,
            dateString
        );

    const formattedRequestedTime =
        Utilities.formatDate(
            startTime,
            TIMEZONE,
            "hh:mm a"
        );

    if (
        !availableSlots.includes(
            formattedRequestedTime
        )
    ) {

        return {
            success: false,
            message:
                "The selected appointment time is not available."
        };
    }

    // ----------------------------------------------------------
    // Create Calendar event
    // ----------------------------------------------------------

    const lock =
        LockService.getScriptLock();

    let event = null;
    let appointmentId = null;

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

        // Generated (and checked for uniqueness) only after the lock is
        // held, so two concurrent bookings can never race on the same ID.
        appointmentId =
            generateUniqueAppointmentId(
                appointmentSheet
            );

        event =
            calendar.createEvent(
                `Appointment - ${patientName}`,
                startTime,
                endTime,
                {
                    description:
                        `Appointment ID: ${appointmentId}\n` +
                        `Doctor: ${doctorName}\n` +
                        `Patient: ${patientName}`,

                    location: clinicName
                }
            );

        // ----------------------------------------------------------
        // Save appointment
        // ----------------------------------------------------------

        const patientRecord =
            registerPatientForBooking(
                patientPhone,
                patientName,
                patientLanguage
            );

        const patientId =
            patientRecord.success
                ? patientRecord.patientId
                : "";

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

            event.getId(),

            patientId

        ]);

    } catch (error) {

        if (event) {
            try {
                event.deleteEvent();
            } catch (deleteError) {
                console.error(
                    "Failed to roll back appointment event after booking failure.",
                    deleteError
                );
            }
        }

        console.error(
            "Booking failed; calendar event was rolled back.",
            error
        );

        return {
            success: false,
            message:
                "Unable to save appointment. No booking was created."
        };

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
// 5. CANCEL APPOINTMENT - SECURE
// ============================================================

function cancelAppointment(
    appointmentId,
    patientPhone,
    options
) {

    const opts = options || {};

    const lock =
        LockService.getScriptLock();

    if (!lock.tryLock(30000)) {

        return {
            success: false,
            message:
                "Cancellation is busy. Please try again."
        };
    }

    try {

        const ss =
            SpreadsheetApp.getActiveSpreadsheet();

        const appointmentSheet =
            ss.getSheetByName("Appointments");

        const appointmentData =
            appointmentSheet
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

                const rowDoctorId =
                    String(
                        appointmentData[i][3] || ""
                    ).trim();

                const authorizedDoctorId =
                    String(
                        opts.authorizedDoctorId || ""
                    ).trim();

                // ------------------------------------------------------
                // SECURITY CHECK
                // ------------------------------------------------------

                if (authorizedDoctorId) {

                    if (
                        rowDoctorId !==
                        authorizedDoctorId
                    ) {

                        return {
                            success: false,
                            message:
                                "Appointment does not belong to this doctor."
                        };
                    }

                } else if (
                    !phonesMatch(
                        rowPhone,
                        patientPhone
                    )
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
                    normalizeAppointmentStatus(
                        status
                    ) ===
                    APPOINTMENT_STATUS.CANCELLED
                ) {

                    return {
                        success: false,
                        message:
                            "Appointment is already cancelled."
                    };
                }

                const normalizedStatus =
                    normalizeAppointmentStatus(
                        status
                    );

                if (
                    normalizedStatus ===
                    APPOINTMENT_STATUS.COMPLETED ||
                    normalizedStatus ===
                    APPOINTMENT_STATUS.NO_SHOW
                ) {

                    return {
                        success: false,
                        message:
                            "Appointment is already marked as " +
                            normalizedStatus +
                            "."
                    };
                }

                // ------------------------------------------------------
                // Find doctor's calendar
                // ------------------------------------------------------

                const doctorId =
                    appointmentData[i][3];

                const doctor =
                    getDoctorRecord(doctorId);

                if (
                    !doctor ||
                    !doctor.calendarId
                ) {

                    return {
                        success: false,
                        message:
                            "Doctor calendar is not configured; appointment was not cancelled."
                    };
                }

                const calendar =
                    CalendarApp.getCalendarById(
                        String(doctor.calendarId).trim()
                    );

                if (!calendar) {

                    return {
                        success: false,
                        message:
                            "Doctor calendar was not found; appointment was not cancelled."
                    };
                }

                const event =
                    findCalendarEventForAppointment(
                        calendar,
                        rowAppointmentId,
                        calendarEventId,
                        appointmentData[i][1],
                        appointmentData[i][2]
                    );

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

    } finally {

        if (lock.hasLock()) {
            lock.releaseLock();
        }
    }
}



// ============================================================
// 7. RESCHEDULE APPOINTMENT - SECURE
// ============================================================

function rescheduleAppointment(
    appointmentId,
    patientPhoneInput,
    newDateString,
    newTimeString,
    options
) {

    const opts = options || {};

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const appointmentSheet =
        ss.getSheetByName("Appointments");

    const appointmentData =
        appointmentSheet
            .getDataRange()
            .getValues();

    // Acquire the lock before any validation runs (not just around the
    // final write). Locking only around the write left the lookup,
    // authorization, status, and slot-availability checks above free
    // to race against a concurrent reschedule/cancel on the same
    // appointment; those checks read a snapshot that could be stale
    // by the time the write happens.
    const rescheduleLock =
        LockService.getScriptLock();

    if (!rescheduleLock.tryLock(30000)) {

        return {
            success: false,
            message:
                "Reschedule is busy. Please try again."
        };
    }

    try {

    // ----------------------------------------------------------
    // Variables
    // ----------------------------------------------------------

    let appointmentRow = -1;
    let appointmentIndex = -1;

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
            appointmentIndex = i;

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

    const authorizedDoctorId =
        String(
            opts.authorizedDoctorId || ""
        ).trim();

    if (authorizedDoctorId) {

        if (
            String(doctorId || "").trim() !==
            authorizedDoctorId
        ) {

            return {

                success: false,

                message:
                    "Appointment does not belong to this doctor."
            };
        }

    } else if (
        !phonesMatch(
            storedPatientPhone,
            patientPhoneInput
        )
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

    const normalizedStatus =
        normalizeAppointmentStatus(status);

    if (
        normalizedStatus ===
        APPOINTMENT_STATUS.CANCELLED
    ) {

        return {

            success: false,

            message:
                "Cancelled appointments cannot be rescheduled."
        };
    }

    if (
        normalizedStatus ===
        APPOINTMENT_STATUS.COMPLETED ||
        normalizedStatus ===
        APPOINTMENT_STATUS.NO_SHOW
    ) {

        return {

            success: false,

            message:
                "Appointments marked as " +
                normalizedStatus +
                " cannot be rescheduled."
        };
    }

    // ----------------------------------------------------------
    // Find doctor
    // ----------------------------------------------------------

    const doctor =
        getDoctorRecord(doctorId);

    if (
        !doctor ||
        !doctor.calendarId
    ) {

        return {

            success: false,

            message:
                "Doctor calendar not found."
        };
    }

    const doctorName = doctor.doctorName;
    const clinicName = doctor.clinicName;
    const calendarId = doctor.calendarId;

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

    if (
        !isValidISODate(
            newDateString
        )
    ) {

        return {
            success: false,
            message:
                "Invalid new appointment date."
        };
    }

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

    const appointmentDuration =
        getDoctorAppointmentDuration(
            doctorId
        );

    const newEndTime =
        new Date(
            newStartTime.getTime() +
            appointmentDuration * 60000
        );

    let oldEvent = null;
    let newEvent = null;

    const originalSnapshot =
        captureAppointmentSheetSnapshot(
            appointmentData[appointmentIndex]
        );

    const originalStartTime =
        parseAppointmentSheetDateTime(
            originalSnapshot.date,
            originalSnapshot.time
        );

    const originalFormattedTime =
        originalStartTime
            ? Utilities.formatDate(
                originalStartTime,
                TIMEZONE,
                "hh:mm a"
            )
            : "";

    // ----------------------------------------------------------
    // Validate against working hours
    // ----------------------------------------------------------

    const availableSlots =
        getAvailableSlots(
            doctorId,
            newDateString
        );

    const formattedRequestedTime =
        Utilities.formatDate(
            newStartTime,
            TIMEZONE,
            "hh:mm a"
        );

    // Check if trying to reschedule to same date/time
    const normalizedOriginalDate =
        normalizeAppointmentDate(
            originalSnapshot.date
        );

    const isSameDateAndTime =
        !!originalStartTime &&
        newDateString === normalizedOriginalDate &&
        formattedRequestedTime ===
            originalFormattedTime;

    if (
        !availableSlots.includes(formattedRequestedTime) &&
        !isSameDateAndTime
    ) {

        return {
            success: false,
            message:
                "The selected time is not available."
        };
    }

    try {

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

        oldEvent =
            findCalendarEventForAppointment(
                calendar,
                appointmentId,
                calendarEventId,
                appointmentData[appointmentIndex][1],
                appointmentData[appointmentIndex][2]
            );

        // ----------------------------------------------------------
        // Create new Calendar event first
        // ----------------------------------------------------------

        newEvent =
            calendar.createEvent(
                `Appointment - ${patientName}`,
                newStartTime,
                newEndTime,
                {

                    description:
                        `Appointment ID: ${appointmentId}\n` +
                        `Doctor: ${doctorName}\n` +
                        `Patient: ${patientName}`,

                    location:
                        clinicName
                }
            );

        // ----------------------------------------------------------
        // Update Sheet
        // ----------------------------------------------------------

        writeAppointmentSheetSchedule(
            appointmentSheet,
            appointmentRow,
            newStartTime,
            "Confirmed",
            newEvent.getId()
        );

        // ----------------------------------------------------------
        // Delete old event only after the sheet has been updated.
        // ----------------------------------------------------------

        if (oldEvent) {
            oldEvent.deleteEvent();
        }

    } catch (error) {

        if (newEvent) {
            try {
                newEvent.deleteEvent();
            } catch (deleteError) {
                console.error(
                    "Failed to roll back newly created reschedule event.",
                    deleteError
                );
            }
        }

        if (appointmentRow > 0) {
            restoreAppointmentSheetSchedule(
                appointmentSheet,
                appointmentRow,
                originalSnapshot
            );
        }

        if (
            oldEvent &&
            oldEvent.getId() &&
            !calendarEventExists(
                calendar,
                oldEvent.getId()
            )
        ) {
            try {
                const oldStartTime =
                    parseAppointmentSheetDateTime(
                        originalSnapshot.date,
                        originalSnapshot.time
                    );

                if (oldStartTime) {
                    const oldEndTime =
                        new Date(
                            oldStartTime.getTime() +
                            appointmentDuration *
                            60000
                        );

                    const restoredOldEvent =
                        calendar.createEvent(
                            `Appointment - ${patientName}`,
                            oldStartTime,
                            oldEndTime,
                            {
                                description:
                                    `Appointment ID: ${appointmentId}\n` +
                                    `Doctor: ${doctorName}\n` +
                                    `Patient: ${patientName}`,

                                location: clinicName
                            }
                        );

                    appointmentSheet
                        .getRange(
                            appointmentRow,
                            8
                        )
                        .setValue(
                            restoredOldEvent.getId()
                        );
                }
            } catch (restoreError) {
                console.error(
                    "Failed to restore original event during reschedule rollback.",
                    restoreError
                );
            }
        }

        console.error(
            "Reschedule failed; original appointment was restored.",
            error
        );

        return {
            success: false,
            message:
                "Unable to complete reschedule. The original appointment was restored."
        };
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

    } finally {

        if (rescheduleLock.hasLock()) {
            rescheduleLock.releaseLock();
        }
    }
}



function buildDoctorSelectionMessage() {

    const doctors = getDoctors();

    if (doctors.length === 0) {
        return "❌ No doctors are currently available.";
    }

    let message =
        buildDoctorSelectionBody();

    message +=
        "\n\n" +
        buildDoctorSelectionFallbackText(
            doctors
        );

    return message;
}



function hasActiveAppointmentOnDate(
    patientPhone,
    dateString,
    excludedAppointmentId
) {

    const targetDateIso =
        normalizeAppointmentDate(dateString);

    if (!targetDateIso) {
        return false;
    }

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
        sheet.getDataRange().getValues();

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
            status === "completed" ||
            status === "no-show" ||
            status === "noshow" ||
            status === "no show";

        const rowDateIso =
            normalizeAppointmentDate(
                data[i][1]
            );

        if (
            String(data[i][0] || "").trim() !== excludedId &&
            phonesMatch(
                data[i][5],
                patientPhone
            ) &&
            rowDateIso === targetDateIso &&
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
            phonesMatch(
                phone,
                patientPhone
            )
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



function getConfirmedAppointmentsForPhone(phone) {

    const appointments =
        getMyAppointments(phone);

    const confirmed =
        appointments.filter(
            function (appt) {
                return isConfirmedAppointmentStatus(
                    appt.status
                );
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



function getDoctorConfirmedAppointments(doctorId) {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Appointments");

    if (!sheet) {
        return [];
    }

    const data =
        sheet.getDataRange().getValues();

    const appointments = [];
    const targetDoctor =
        String(doctorId || "").trim();

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        if (
            String(data[i][3] || "").trim() !==
            targetDoctor
        ) {
            continue;
        }

        const status =
            String(data[i][6] || "").trim();

        if (
            !isConfirmedAppointmentStatus(
                status
            )
        ) {
            continue;
        }

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
                String(data[i][2] || "").trim();
        }

        appointments.push({

            appointmentId:
                String(data[i][0] || "").trim(),

            date:
                data[i][1] instanceof Date
                    ? Utilities.formatDate(
                        data[i][1],
                        TIMEZONE,
                        "dd-MMM-yyyy"
                    )
                    : String(data[i][1] || "").trim(),

            time: appointmentTime,

            doctorId: targetDoctor,

            patientName:
                String(data[i][4] || "").trim(),

            phone:
                String(data[i][5] || "").trim(),

            status: status
        });
    }

    appointments.sort(
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

    return appointments;
}
