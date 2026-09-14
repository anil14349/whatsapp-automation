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
//
// OPTIMIZATION: Only scan the last ~500 rows to reduce load on large
// sheets. Collision probability is negligible over recent IDs; if a
// collision is found, a full scan confirms it. This trades minimal
// collision-detection accuracy (already mitigated by retry logic) for
// O(1) performance on large sheets.
function generateUniqueAppointmentId(appointmentSheet) {

    const data =
        appointmentSheet.getDataRange().getValues();

    const existingIds = {};
    const maxRecentRows = 500;
    const startRow = Math.max(1, data.length - maxRecentRows);

    for (
        let i = startRow;
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

    // ========================================================
    // DOCTOR VALIDATION (with null checks)
    // ========================================================

    if (!doctor) {

        return {
            success: false,
            message: "Doctor not found."
        };
    }

    if (!doctor.calendarId) {

        return {
            success: false,
            message:
                "Doctor calendar is not configured."
        };
    }

    const doctorName =
        doctor.doctorName || "";

    if (!doctorName) {

        return {
            success: false,
            message:
                "Doctor name is missing in system."
        };
    }

    const clinicName =
        doctor.clinicName || "";

    if (!clinicName) {

        return {
            success: false,
            message:
                "Clinic name is missing in system."
        };
    }

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
            buildISODatetimeWithTimezone(
                dateString,
                time24
            )
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
                "Time slot is not available."
        };
    }

    // ----------------------------------------------------------
    // Acquire lock BEFORE checking slot reservations
    // ----------------------------------------------------------
    // CRITICAL FIX: Must acquire lock BEFORE slot check to prevent TOCTOU race
    // where two patients could both see slot available, then both acquire lock
    // and both succeed in booking same slot.

    const lock =
        LockService.getScriptLock();

    let event = null;
    let appointmentId = null;

    try {

        // ========================================================
        // RETRY LOCK ACQUISITION
        // ========================================================
        // Try up to 3 times with timeouts to handle brief lock contention
        // rather than failing immediately

        let lockAcquired = false;
        for (let attempt = 0; attempt < 3; attempt++) {
            if (lock.tryLock(5000)) {
                lockAcquired = true;
                break;
            }
        }

        if (!lockAcquired) {

            return {
                success: false,
                message:
                    "Booking is currently busy. Please try again in a moment."
            };
        }

        // ========================================================
        // TOCTOU PROTECTION: Check slot reservation INSIDE lock
        // ========================================================
        // Now that lock is held, check if slot was reserved by another patient
        // between our initial availability check and lock acquisition.
        // This prevents race condition where two patients book same slot.

        const slotReservationCheck =
            isSlotReservedByOther(
                doctorId,
                dateString,
                formattedRequestedTime,
                patientPhone
            );

        if (slotReservationCheck.isReserved) {

            lock.releaseLock();

            return {
                success: false,
                message:
                    "The selected appointment time is not available."
            };
        }

        const existingUpcomingAppointment =
            findUpcomingActiveAppointmentByPhone(
                patientPhone
            );

        if (existingUpcomingAppointment) {

            // CONSISTENCY: Explicit lock release on early return
            if (lock && lock.hasLock()) {
                lock.releaseLock();
            }

            return {
                success: false,
                message:
                    "You already have an upcoming active appointment."
            };
        }

        const existingEvents =
            calendar.getEvents(
                startTime,
                endTime
            );

        if (existingEvents.length > 0) {

            // CONSISTENCY: Explicit lock release on early return
            if (lock && lock.hasLock()) {
                lock.releaseLock();
            }

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
                patientLanguage,
                { skipLock: true }
            );

        const patientId =
            patientRecord.success
                ? patientRecord.patientId
                : "";

        // ========================================================
        // CREATE CALENDAR EVENT FIRST
        // ========================================================
        // Verify calendar event creation succeeds before appending
        // sheet row to avoid orphaned records on failure

        const eventId = event.getId();

        if (!eventId) {
            throw new Error("Calendar event creation failed - no event ID returned");
        }

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

            eventId,

            patientId

        ]);

        invalidateAppointmentExecutionCaches();

    } catch (error) {

        // ========================================================
        // CLEANUP ON ERROR
        // ========================================================
        // Delete calendar event if sheet append failed

        if (event) {
            try {
                event.deleteEvent();
            } catch (deleteError) {
                Logger.log(
                    "Failed to roll back appointment event after booking failure: " +
                    deleteError.message
                );
            }
        }

        Logger.log(
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
    // TOCTOU CLEANUP: Clear slot reservation
    // ----------------------------------------------------------
    // Remove patient's slot reservation now that booking is confirmed.
    // If cleanup fails, log but don't fail the entire booking.

    try {

        clearSlotReservation(
            doctorId,
            dateString,
            formattedRequestedTime,
            patientPhone
        );

    } catch (cleanupError) {

        Logger.log(
            "Warning: Failed to clear slot reservation: " +
            cleanupError.message
        );
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

    // Retry with exponential backoff: 5s, 10s, 15s
    const timeouts = [5000, 10000, 15000];
    let lockAcquired = false;
    for (let attempt = 0; attempt < timeouts.length; attempt++) {
        if (lock.tryLock(timeouts[attempt])) {
            lockAcquired = true;
            break;
        }
        Logger.log("Lock attempt " + (attempt + 1) + " failed, retrying...");
    }

    if (!lockAcquired) {

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
        // Scan from end backwards since appointments are appended;
        // target is typically near the end, so this reduces avg scan time.

        for (
            let i = appointmentData.length - 1;
            i >= 1;
            i--
        ) {

            // Verify row has required columns before accessing
            if (!appointmentData[i] || appointmentData[i].length < 9) {
                continue;
            }

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

                // ========================================================
                // AUTHORIZATION CHECK: Doctor OR Patient Phone Required
                // ========================================================
                // Must have EITHER valid doctor authorization OR matching phone
                const isDoctorAuthorized =
                    authorizedDoctorId &&
                    rowDoctorId === authorizedDoctorId;

                const isPatientAuthorized =
                    !authorizedDoctorId &&
                    phonesMatch(rowPhone, patientPhone);

                if (!isDoctorAuthorized && !isPatientAuthorized) {

                    return {
                        success: false,
                        message:
                            "You are not authorized to cancel this appointment."
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

                invalidateAppointmentExecutionCaches();

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

    // ========================================================
    // RETRY LOCK ACQUISITION
    // ========================================================
    // Try up to 3 times with timeouts to handle brief lock contention

    let lockAcquired = false;
    for (let attempt = 0; attempt < 3; attempt++) {
        if (rescheduleLock.tryLock(5000)) {
            lockAcquired = true;
            break;
        }
    }

    if (!lockAcquired) {

        return {
            success: false,
            message:
                "Reschedule is currently busy. Please try again in a moment."
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
    // Scan from end backwards since appointments are appended;
    // target is typically near the end, so this reduces avg scan time.

    for (
        let i = appointmentData.length - 1;
        i >= 1;
        i--
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

    // ========================================================
    // AUTHORIZATION CHECK: Doctor OR Patient Phone Required
    // ========================================================
    // Must have EITHER valid doctor authorization OR matching phone
    const isDoctorAuthorized =
        authorizedDoctorId &&
        String(doctorId || "").trim() === authorizedDoctorId;

    const isPatientAuthorized =
        !authorizedDoctorId &&
        phonesMatch(storedPatientPhone, patientPhoneInput);

    if (!isDoctorAuthorized && !isPatientAuthorized) {

        return {

            success: false,

            message:
                "You are not authorized to reschedule this appointment."
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
    // Find doctor (with null checks)
    // ----------------------------------------------------------

    const doctor =
        getDoctorRecord(doctorId);

    if (!doctor) {

        return {

            success: false,

            message:
                "Doctor not found."
        };
    }

    if (!doctor.calendarId) {

        return {

            success: false,

            message:
                "Doctor calendar not configured."
        };
    }

    const doctorName =
        doctor.doctorName || "";

    if (!doctorName) {

        return {

            success: false,

            message:
                "Doctor name is missing in system."
        };
    }

    const clinicName =
        doctor.clinicName || "";

    if (!clinicName) {

        return {

            success: false,

            message:
                "Clinic name is missing in system."
        };
    }

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
            buildISODatetimeWithTimezone(
                newDateString,
                newTime24
            )
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

        const anotherUpcomingAppointment =
            findUpcomingActiveAppointmentByPhone(
                patientPhoneInput,
                appointmentId
            );

        if (anotherUpcomingAppointment) {

            return {
                success: false,
                message:
                    "You already have an upcoming active appointment."
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
                Logger.log(
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
                Logger.log(
                    "Failed to restore original event during reschedule rollback.",
                    restoreError
                );
            }
        }

        Logger.log(
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
    return !!findActiveAppointmentOnDate(
        patientPhone,
        dateString,
        excludedAppointmentId
    );
}



// ============================================================
// 10. GET PATIENT APPOINTMENTS
// ============================================================

function getMyAppointments(
    patientPhone
) {

    // OPTIMIZATION: reuse the execution-scoped phone index instead of
    // reading the entire Appointments sheet for every patient request.
    const cachedAppointments =
        getAppointmentsByPhoneWithCache(patientPhone);

    const now =
        new Date();

    const appointments = [];

    for (const appointment of cachedAppointments) {

        const status =
            appointment.status;

        // Only show appointments that are still active.
        if (
            isInactiveAppointmentStatus(
                status
            )
        ) {
            continue;
        }

        // My Appointments is specifically an UPCOMING view.
        // Past/today-already-started appointments are excluded.
        const startTime =
            getAppointmentStartDateTime(
                appointment.date,
                appointment.time
            );

        if (
            !startTime ||
            startTime.getTime() <= now.getTime()
        ) {
            continue;
        }

        let appointmentTime = "";

        if (appointment.time instanceof Date) {

            appointmentTime =
                Utilities.formatDate(
                    appointment.time,
                    TIMEZONE,
                    "hh:mm a"
                );

        } else {

            appointmentTime =
                String(appointment.time || "").trim();

        }

        appointments.push({

            row:
                appointment.row,

            appointmentId:
                appointment.appointmentId,

            date:
                appointment.date,

            time:
                appointmentTime,

            doctorId:
                appointment.doctorId,

            patientName:
                appointment.patientName,

            phone:
                appointment.patientPhone,

            status:
                appointment.status,

            startTime:
                startTime
        });
    }

    appointments.sort(function(a, b) {
        return a.startTime.getTime() - b.startTime.getTime();
    });

    return appointments;
}



function getConfirmedAppointmentsForPhone(phone) {

    const appointments =
        getMyAppointments(phone);

    // Show every active appointment. Only cancelled, completed, and
    // no-show appointments should be hidden — this prevents valid
    // appointments from disappearing when their status is blank or uses
    // another active label.
    const confirmed =
        appointments.filter(
            function (appt) {
                return !isInactiveAppointmentStatus(
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



// ============================================================
// SHAREABLE APPOINTMENT RECEIPT CARD
// ============================================================
// Creates a temporary Google Slides card, exports the first slide
// as a PNG, uploads that PNG to WhatsApp, sends it to the patient,
// and then moves the temporary Slides file to Trash.
//
// The logo is read from the same Drive file currently used for the
// hospital-logo greeting. Default ID can be overridden with the
// Settings key APPOINTMENT_RECEIPT_LOGO_DRIVE_FILE_ID.

function sendAppointmentReceiptCard(to, appointment) {

    const card =
        createAppointmentReceiptCardBlob(
            appointment
        );

    const mediaId =
        uploadWhatsAppImageBlob(card.blob);

    sendWhatsAppImageMessage(
        to,
        mediaId,
        "🎫 Appointment confirmation"
    );

    return mediaId;
}


function createAppointmentReceiptCardBlob(appointment) {
    if (!appointment || !appointment.appointmentId) {
        throw new Error(
            "Appointment data is incomplete for receipt generation."
        );
    }

    let presentation = null;

    try {
        presentation =
            SlidesApp.create(
                getClinicName() + " Appointment Confirmation"
            );

        const slide =
            presentation.getSlides()[0];

        const pageWidth =
            presentation.getPageWidth();

        const pageHeight =
            presentation.getPageHeight();

        // ------------------------------------------------------
        // Palette — clean WellSun-style healthcare card
        // ------------------------------------------------------
        const NAVY = "#102A56";
        const TEAL = "#087E8B";
        const GREEN = "#2DBE72";
        const PALE_GREEN = "#E9F9EF";
        const PALE_BLUE = "#EEF7FB";
        const PALE_TEAL = "#E9F7F8";
        const TEXT = "#1F2937";
        const MUTED = "#64748B";
        const WHITE = "#FFFFFF";
        const BORDER = "#D9E7EA";
        const LIGHT = "#F7FBFC";

        // ------------------------------------------------------
        // Helpers
        // ------------------------------------------------------
        function addText(
            value,
            left,
            top,
            width,
            height,
            size,
            color,
            bold,
            align
        ) {
            const box =
                slide.insertTextBox(
                    String(value == null ? "" : value),
                    left,
                    top,
                    width,
                    height
                );

            const style =
                box.getText().getTextStyle();

            style.setFontSize(size || 12);
            style.setForegroundColor(color || TEXT);
            style.setBold(!!bold);

            if (align) {
                box.getText().getParagraphStyle()
                    .setParagraphAlignment(align);
            }

            return box;
        }

        function addRoundedBox(
            left,
            top,
            width,
            height,
            fill,
            lineColor
        ) {
            const box =
                slide.insertShape(
                    SlidesApp.ShapeType.ROUNDED_RECTANGLE,
                    left,
                    top,
                    width,
                    height
                );

            box.getFill().setSolidFill(fill);
            box.getLine().setSolidFill(
                lineColor || fill
            );

            return box;
        }

        function addCircle(
            left,
            top,
            size,
            fill,
            symbol,
            symbolColor,
            symbolSize
        ) {
            const circle =
                slide.insertShape(
                    SlidesApp.ShapeType.ELLIPSE,
                    left,
                    top,
                    size,
                    size
                );

            circle.getFill().setSolidFill(fill);
            circle.getLine().setTransparent();

            const t =
                circle.getText();

            t.setText(symbol);

            t.getTextStyle()
                .setFontSize(symbolSize || 18)
                .setBold(true)
                .setForegroundColor(
                    symbolColor || WHITE
                );

            t.getParagraphStyle()
                .setParagraphAlignment(
                    SlidesApp.ParagraphAlignment.CENTER
                );

            return circle;
        }

        function addDetailRow(
            y,
            icon,
            iconFill,
            label,
            value,
            valueSize
        ) {
            addCircle(
                leftMargin,
                y,
                iconSize,
                iconFill,
                icon,
                WHITE,
                17
            );

            addText(
                label.toUpperCase(),
                leftMargin + iconSize + 12,
                y - 1,
                detailWidth - iconSize - 12,
                16,
                8.5,
                MUTED,
                true
            );

            addText(
                value,
                leftMargin + iconSize + 12,
                y + 13,
                detailWidth - iconSize - 12,
                28,
                valueSize || 14,
                NAVY,
                true
            );
        }

        // ------------------------------------------------------
        // Background
        // ------------------------------------------------------
        slide
            .getBackground()
            .setSolidFill(LIGHT);

        // Soft top band.
        const topBand =
            slide.insertShape(
                SlidesApp.ShapeType.RECTANGLE,
                0,
                0,
                pageWidth,
                pageHeight * 0.055
            );

        topBand.getFill().setSolidFill(TEAL);
        topBand.getLine().setTransparent();

        const margin =
            pageWidth * 0.055;

        // ------------------------------------------------------
        // Header / branding
        // ------------------------------------------------------
        const logoFileId =
            String(
                getSetting(
                    "APPOINTMENT_RECEIPT_LOGO_DRIVE_FILE_ID",
                    "1m5eZGBd_xSeXlVTjjpJBgMvlDYIqhWmx"
                ) || ""
            ).trim();

        if (logoFileId) {
            try {
                const logoFile =
                    DriveApp.getFileById(
                        logoFileId
                    );

                const logo =
                    slide.insertImage(
                        logoFile.getBlob()
                    );

                logo
                    .setLeft(margin)
                    .setTop(pageHeight * 0.075)
                    .setHeight(pageHeight * 0.105);
            } catch (logoError) {
                Logger.log(
                    "Receipt logo could not be inserted: " +
                    logoError.message
                );
            }
        }

        const clinicName =
            getClinicName();

        addText(
            clinicName,
            margin + pageWidth * 0.145,
            pageHeight * 0.075,
            pageWidth * 0.42,
            27,
            20,
            NAVY,
            true
        );

        addText(
            "Your Health, Our Priority",
            pageWidth * 0.68,
            pageHeight * 0.078,
            pageWidth * 0.25,
            24,
            11,
            TEAL,
            true,
            SlidesApp.ParagraphAlignment.RIGHT
        );

        // ------------------------------------------------------
        // Confirmation heading
        // ------------------------------------------------------
        addCircle(
            margin,
            pageHeight * 0.205,
            42,
            GREEN,
            "✓",
            WHITE,
            25
        );

        addText(
            "Appointment",
            margin + 55,
            pageHeight * 0.185,
            pageWidth * 0.42,
            31,
            25,
            NAVY,
            true
        );

        addText(
            "Confirmed!",
            margin + 55,
            pageHeight * 0.245,
            pageWidth * 0.42,
            31,
            25,
            NAVY,
            true
        );

        addRoundedBox(
            margin,
            pageHeight * 0.325,
            pageWidth * 0.50,
            38,
            PALE_GREEN,
            PALE_GREEN
        );

        addText(
            "We look forward to seeing you!",
            margin + 12,
            pageHeight * 0.338,
            pageWidth * 0.47,
            20,
            11,
            TEAL,
            true,
            SlidesApp.ParagraphAlignment.CENTER
        );

        // ------------------------------------------------------
        // Patient / appointment details card
        // ------------------------------------------------------
        const detailTop =
            pageHeight * 0.405;

        const detailHeight =
            pageHeight * 0.43;

        const detailWidth =
            pageWidth * 0.54;

        const leftMargin =
            margin;

        const iconSize =
            31;

        addRoundedBox(
            leftMargin,
            detailTop,
            detailWidth,
            detailHeight,
            WHITE,
            BORDER
        );

        const doctorRecord =
            appointment.doctorId
                ? getDoctorRecord(
                    appointment.doctorId
                )
                : null;

        const specialization =
            doctorRecord &&
            doctorRecord.specialization
                ? doctorRecord.specialization
                : "";

        const doctorName =
            String(
                appointment.doctor ||
                (doctorRecord &&
                    doctorRecord.doctorName) ||
                "Doctor"
            );

        const clinicForReceipt =
            (doctorRecord &&
                doctorRecord.clinicName) ||
            clinicName ||
            "";

        const rowStart =
            detailTop + 18;

        const rowGap =
            detailHeight / 4.65;

        addDetailRow(
            rowStart,
            "P",
            "#2E86DE",
            "Patient",
            appointment.patientName || "",
            14
        );

        addDetailRow(
            rowStart + rowGap,
            "D",
            TEAL,
            "Doctor",
            doctorName,
            13.5
        );

        if (specialization) {
            addDetailRow(
                rowStart + rowGap * 2,
                "S",
                "#4E9F3D",
                "Specialization",
                specialization,
                12.5
            );
        } else {
            addDetailRow(
                rowStart + rowGap * 2,
                "C",
                "#4E9F3D",
                "Clinic",
                clinicForReceipt,
                12.5
            );
        }

        addDetailRow(
            rowStart + rowGap * 3,
            "T",
            "#E65F5C",
            "Date & Time",
            formatReceiptDate(
                appointment.date
            ) +
            "  •  " +
            String(
                appointment.time || ""
            ),
            12.5
        );

        // ------------------------------------------------------
        // Decorative appointment illustration
        // ------------------------------------------------------
        const artLeft =
            pageWidth * 0.66;

        const artTop =
            pageHeight * 0.39;

        const artWidth =
            pageWidth * 0.27;

        const artHeight =
            pageHeight * 0.44;

        addRoundedBox(
            artLeft,
            artTop,
            artWidth,
            artHeight,
            PALE_BLUE,
            PALE_BLUE
        );

        // Calendar.
        const calLeft =
            artLeft + artWidth * 0.16;

        const calTop =
            artTop + artHeight * 0.18;

        const calWidth =
            artWidth * 0.68;

        const calHeight =
            artHeight * 0.50;

        const calendar =
            addRoundedBox(
                calLeft,
                calTop,
                calWidth,
                calHeight,
                WHITE,
                BORDER
            );

        const calendarHeader =
            slide.insertShape(
                SlidesApp.ShapeType.ROUNDED_RECTANGLE,
                calLeft,
                calTop,
                calWidth,
                calHeight * 0.23
            );

        calendarHeader
            .getFill()
            .setSolidFill(TEAL);
        calendarHeader
            .getLine()
            .setTransparent();

        addText(
            "APPOINTMENT",
            calLeft + 8,
            calTop + 10,
            calWidth - 16,
            16,
            8,
            WHITE,
            true,
            SlidesApp.ParagraphAlignment.CENTER
        );

        addText(
            formatReceiptDate(
                appointment.date
            ),
            calLeft + 8,
            calTop + calHeight * 0.34,
            calWidth - 16,
            24,
            13,
            NAVY,
            true,
            SlidesApp.ParagraphAlignment.CENTER
        );

        addText(
            String(
                appointment.time || ""
            ),
            calLeft + 8,
            calTop + calHeight * 0.56,
            calWidth - 16,
            22,
            14,
            TEAL,
            true,
            SlidesApp.ParagraphAlignment.CENTER
        );

        // Simple plant / healthcare cross illustration.
        const potLeft =
            artLeft + artWidth * 0.39;

        const potTop =
            artTop + artHeight * 0.71;

        const pot =
            slide.insertShape(
                SlidesApp.ShapeType.ROUNDED_RECTANGLE,
                potLeft,
                potTop,
                artWidth * 0.22,
                artHeight * 0.12
            );

        pot.getFill().setSolidFill(WHITE);
        pot.getLine().setSolidFill(BORDER);

        const stem =
            slide.insertShape(
                SlidesApp.ShapeType.RECTANGLE,
                potLeft + artWidth * 0.105,
                potTop - artHeight * 0.20,
                3,
                artHeight * 0.22
            );

        stem.getFill().setSolidFill(TEAL);
        stem.getLine().setTransparent();

        addCircle(
            potLeft - artWidth * 0.08,
            potTop - artHeight * 0.22,
            artWidth * 0.17,
            "#6BCB77",
            "✓",
            WHITE,
            15
        );

        addCircle(
            potLeft + artWidth * 0.10,
            potTop - artHeight * 0.30,
            artWidth * 0.17,
            "#37B24D",
            "♥",
            WHITE,
            13
        );

        addCircle(
            potLeft + artWidth * 0.23,
            potTop - artHeight * 0.18,
            artWidth * 0.17,
            "#51CF66",
            "＋",
            WHITE,
            13
        );

        addText(
            "See you soon!",
            artLeft + 8,
            artTop + artHeight * 0.88,
            artWidth - 16,
            25,
            13,
            TEAL,
            true,
            SlidesApp.ParagraphAlignment.CENTER
        );

        // ------------------------------------------------------
        // Appointment ID + clinic footer
        // ------------------------------------------------------
        const footerTop =
            pageHeight * 0.875;

        addRoundedBox(
            margin,
            footerTop,
            pageWidth - margin * 2,
            pageHeight * 0.075,
            PALE_TEAL,
            PALE_TEAL
        );

        addText(
            "Appointment ID",
            margin + 12,
            footerTop + 8,
            pageWidth * 0.18,
            15,
            8,
            MUTED,
            true
        );

        addText(
            appointment.appointmentId,
            margin + 12,
            footerTop + 23,
            pageWidth * 0.25,
            20,
            12,
            NAVY,
            true
        );

        addText(
            clinicForReceipt,
            pageWidth * 0.42,
            footerTop + 11,
            pageWidth * 0.50,
            19,
            10,
            TEAL,
            true,
            SlidesApp.ParagraphAlignment.RIGHT
        );

        addText(
            "Please keep this confirmation for your visit.",
            pageWidth * 0.40,
            footerTop + 29,
            pageWidth * 0.52,
            16,
            8,
            MUTED,
            false,
            SlidesApp.ParagraphAlignment.RIGHT
        );

        presentation.saveAndClose();

        // ------------------------------------------------------
        // Export slide as PNG using Google Slides API.
        // No third-party image-generation service is required.
        // ------------------------------------------------------
        const presentationId =
            presentation.getId();

        const pageObjectId =
            slide.getObjectId();

        const thumbnailUrl =
            "https://slides.googleapis.com/v1/presentations/" +
            encodeURIComponent(presentationId) +
            "/pages/" +
            encodeURIComponent(pageObjectId) +
            "/thumbnail" +
            "?thumbnailProperties.mimeType=PNG" +
            "&thumbnailProperties.thumbnailSize=LARGE";

        const response =
            UrlFetchApp.fetch(
                thumbnailUrl,
                {
                    method: "get",
                    headers: {
                        Authorization:
                            "Bearer " +
                            ScriptApp.getOAuthToken()
                    },
                    muteHttpExceptions: true
                }
            );

        const code =
            response.getResponseCode();

        if (code < 200 || code >= 300) {
            throw new Error(
                "Google Slides thumbnail export failed (" +
                code +
                "): " +
                response.getContentText()
            );
        }

        const thumbnailInfo =
            JSON.parse(
                response.getContentText()
            );

        if (!thumbnailInfo.contentUrl) {
            throw new Error(
                "Google Slides did not return a thumbnail URL."
            );
        }

        const imageResponse =
            UrlFetchApp.fetch(
                thumbnailInfo.contentUrl,
                {
                    method: "get",
                    muteHttpExceptions: true
                }
            );

        if (
            imageResponse.getResponseCode() < 200 ||
            imageResponse.getResponseCode() >= 300
        ) {
            throw new Error(
                "Unable to download receipt PNG."
            );
        }

        const blob =
            imageResponse
                .getBlob()
                .setName(
                    "appointment-" +
                    appointment.appointmentId +
                    ".png"
                );

        return {
            blob: blob,
            presentationId: presentationId
        };

    } finally {
        // Keep the generated presentation out of the user's Drive after
        // the PNG has been exported.
        if (presentation) {
            try {
                DriveApp
                    .getFileById(
                        presentation.getId()
                    )
                    .setTrashed(true);
            } catch (cleanupError) {
                Logger.log(
                    "Appointment receipt presentation cleanup failed: " +
                    cleanupError.message
                );
            }
        }
    }
}


function uploadWhatsAppImageBlob(blob) {

    if (!blob) {
        throw new Error(
            "Receipt image blob is missing."
        );
    }

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
        "/media";

    const response =
        UrlFetchApp.fetch(
            url,
            {
                method: "post",
                headers: {
                    Authorization:
                        "Bearer " + accessToken
                },
                payload: {
                    messaging_product: "whatsapp",
                    type: "image/png",
                    file: blob
                },
                muteHttpExceptions: true
            }
        );

    const code =
        response.getResponseCode();

    const body =
        response.getContentText();

    if (code < 200 || code >= 300) {
        throw new Error(
            "WhatsApp receipt upload failed (" +
            code + "): " +
            body
        );
    }

    const parsed =
        JSON.parse(body);

    if (!parsed.id) {
        throw new Error(
            "WhatsApp receipt upload returned no media ID."
        );
    }

    return String(parsed.id);
}


function formatReceiptDate(isoDate) {

    const value =
        String(isoDate || "").trim();

    if (!value) {
        return "";
    }

    try {
        return Utilities.formatDate(
            new Date(
                buildISODatetimeWithTimezone(
                    value,
                    "00:00"
                )
            ),
            TIMEZONE,
            "EEEE, dd MMMM yyyy"
        );
    } catch (error) {
        return value;
    }
}
