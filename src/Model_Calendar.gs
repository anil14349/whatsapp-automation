// ============================================================
// Model_Calendar — part of the ABC Clinic WhatsApp bot
// Calendar event lookups and the slot-availability engine (getAvailableSlots).
// See src/Config.gs for the full file-layout map and Script Properties.
// ============================================================


function parseAvailabilityTimeValue(value, date) {

    if (value instanceof Date) {
        return new Date(value.getTime());
    }

    const text =
        String(value || "").trim();

    if (!text) {
        return null;
    }

    const timeValue =
        convert12HourTo24Hour(text);

    if (timeValue) {

        const parsed =
            new Date(date);

        const parts =
            timeValue.split(":");

        parsed.setHours(
            Number(parts[0]),
            Number(parts[1]),
            0,
            0
        );

        return parsed;
    }

    const match =
        text.match(/^\d{1,2}:\d{2}$/);

    if (!match) {
        return null;
    }

    const parsed =
        new Date(date);
    const parts =
        text.split(":");

    parsed.setHours(
        Number(parts[0]),
        Number(parts[1]),
        0,
        0
    );

    return parsed;
}


function calendarEventExists(
    calendar,
    eventId
) {

    if (!calendar || !eventId) {
        return false;
    }

    try {

        const event =
            calendar.getEventById(
                String(eventId).trim()
            );

        return !!event;

    } catch (error) {

        return false;
    }
}


function findCalendarEventForAppointment(
    calendar,
    appointmentId,
    calendarEventId,
    appointmentDate,
    appointmentTime
) {

    if (!calendar) {
        return null;
    }

    if (calendarEventId) {

        try {

            const event =
                calendar.getEventById(
                    String(calendarEventId).trim()
                );

            if (event) {
                return event;
            }

        } catch (error) {

            Logger.log(
                "Could not look up Calendar event " +
                calendarEventId + ": " +
                error.message
            );
        }
    }

    const parsedDate =
        appointmentDate instanceof Date
            ? appointmentDate
            : parseAppointmentDateTime(
                appointmentDate,
                appointmentTime
            );

    if (!parsedDate) {
        return null;
    }

    const dayEvents =
        calendar.getEventsForDay(parsedDate);

    const targetId =
        String(appointmentId);

    for (
        let i = 0;
        i < dayEvents.length;
        i++
    ) {

        if (
            dayEvents[i]
                .getDescription()
                .indexOf(
                    "Appointment ID: " +
                    targetId
                ) !== -1
        ) {
            return dayEvents[i];
        }
    }

    return null;
}


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

    const availabilitySheet =
        ss.getSheetByName("Availability");

    if (!availabilitySheet) {
        throw new Error(
            "Availability sheet not found."
        );
    }

    const doctor =
        getDoctorRecord(doctorId);

    if (
        !doctor ||
        !doctor.calendarId
    ) {

        throw new Error(
            "Doctor or Calendar ID not found."
        );
    }

    const calendarId = doctor.calendarId;
    const doctorName = doctor.doctorName;

    if (
        isDoctorOnLeave(
            doctorId,
            dateString
        )
    ) {
        return [];
    }

    let appointmentDuration;

    try {

        appointmentDuration =
            getDoctorAppointmentDuration(
                doctorId
            );

    } catch (durationError) {

        Logger.log(
            "getAvailableSlots: could not resolve appointment duration for " +
            doctorId +
            ": " +
            durationError
        );

        return [];
    }

    const availabilityData =
        availabilitySheet.getDataRange().getValues();

    const dayName =
        Utilities.formatDate(
            date,
            TIMEZONE,
            "EEEE"
        );

    const availabilityWindows = [];

    for (
        let i = 1;
        i < availabilityData.length;
        i++
    ) {

        const rowDoctorId =
            String(availabilityData[i][0] || "").trim();

        const rowDay =
            String(availabilityData[i][1] || "").trim();

        if (
            rowDoctorId ===
            String(doctorId).trim() &&
            rowDay ===
            String(dayName)
        ) {

            const startTime =
                parseAvailabilityTimeValue(
                    availabilityData[i][2],
                    date
                );

            const endTime =
                parseAvailabilityTimeValue(
                    availabilityData[i][3],
                    date
                );

            if (startTime && endTime) {
                availabilityWindows.push({
                    start: startTime,
                    end: endTime
                });
            }
        }
    }

    if (availabilityWindows.length === 0) {
        return [];
    }

    let calendar;
    let dayEvents;

    try {

        calendar =
            CalendarApp.getCalendarById(
                calendarId
            );

        if (!calendar) {

            throw new Error(
                "Calendar not found."
            );
        }

        // Fetch the whole day's events once instead of calling
        // calendar.getEvents() per candidate slot — the previous
        // per-slot approach made one Calendar API call per slot
        // (potentially dozens per doctor per day), which is both
        // slow and at risk of hitting CalendarApp quotas.
        dayEvents =
            calendar.getEventsForDay(date);

    } catch (calendarError) {

        Logger.log(
            "getAvailableSlots: Calendar lookup failed for " +
            doctorId +
            " on " +
            dateString +
            ": " +
            calendarError
        );

        return [];
    }

    const slots = [];
    const now = new Date();

    for (
        let w = 0;
        w < availabilityWindows.length;
        w++
    ) {

        const window =
            availabilityWindows[w];

        let current =
            new Date(date);

        current.setHours(
            window.start.getHours(),
            window.start.getMinutes(),
            0,
            0
        );

        const closingTime =
            new Date(date);

        closingTime.setHours(
            window.end.getHours(),
            window.end.getMinutes(),
            0,
            0
        );

        while (
            current.getTime() +
            appointmentDuration * 60000 <=
            closingTime.getTime()
        ) {

            const slotEnd =
                new Date(
                    current.getTime() +
                    appointmentDuration * 60000
                );

            const hasConflict =
                dayEvents.some(
                    function (event) {
                        return (
                            event.getStartTime().getTime() < slotEnd.getTime() &&
                            event.getEndTime().getTime() > current.getTime()
                        );
                    }
                );

            const sameDay =
                Utilities.formatDate(
                    date,
                    TIMEZONE,
                    "yyyy-MM-dd"
                ) ===
                Utilities.formatDate(
                    now,
                    TIMEZONE,
                    "yyyy-MM-dd"
                );

            if (
                (
                    current.getTime() > now.getTime() ||
                    !sameDay
                ) &&
                !hasConflict
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
                    appointmentDuration * 60000
                );
        }
    }

    Logger.log(
        "Available slots for " +
        doctorName +
        " on " +
        dayName +
        ": " +
        slots.join(", ")
    );

    const uniqueSlots = [];
    const seen = {};

    for (
        let i = 0;
        i < slots.length;
        i++
    ) {

        if (!seen[slots[i]]) {
            seen[slots[i]] = true;
            uniqueSlots.push(slots[i]);
        }
    }

    return uniqueSlots;
}
