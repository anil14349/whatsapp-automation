// ============================================================
// Model_Doctors — part of the ABC Clinic WhatsApp bot
// Doctor records, weekly availability, leave management, and schedule views.
// See src/Config.gs for the full file-layout map and Script Properties.
// ============================================================



// ============================================================
// 2. GET AVAILABLE SLOTS
// ============================================================

function getDoctorAppointmentDuration(doctorId) {

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

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        if (
            String(data[i][0]).trim() ===
            String(doctorId).trim()
        ) {

            const duration =
                Number(data[i][5]);

            if (
                !duration ||
                duration <= 0
            ) {
                throw new Error(
                    "Invalid AppointmentDuration for doctor " +
                    doctorId
                );
            }

            return duration;
        }
    }

    throw new Error(
        "Doctor not found: " +
        doctorId
    );
}


function isDoctorOnLeave(
    doctorId,
    dateString
) {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Doctor_Leaves");

    if (!sheet) {
        return false;
    }

    const data =
        sheet.getDataRange().getValues();

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        const rowDoctorId =
            String(data[i][0] || "").trim();

        let rowDate = "";

        if (
            data[i][1] instanceof Date
        ) {

            rowDate =
                Utilities.formatDate(
                    data[i][1],
                    TIMEZONE,
                    "yyyy-MM-dd"
                );

        } else {

            rowDate =
                String(data[i][1] || "").trim();
        }

        const active =
            String(data[i][3] || "")
                .toUpperCase() === "TRUE";

        if (
            rowDoctorId ===
            String(doctorId).trim() &&
            rowDate ===
            String(dateString).trim() &&
            active
        ) {
            return true;
        }
    }

    return false;
}


function doctorWeekdayIndexToName(index) {

    const value = Number(index);

    if (
        !Number.isInteger(value) ||
        value < 1 ||
        value > 7
    ) {
        return null;
    }

    return DOCTOR_WEEKDAYS[value - 1];
}


function formatAvailabilityTimeForDisplay(value) {

    if (value instanceof Date) {
        return Utilities.formatDate(
            value,
            TIMEZONE,
            "hh:mm a"
        );
    }

    const normalized =
        normalizeAvailabilityTimeInput(
            String(value)
        );

    return normalized ||
        String(value || "").trim();
}


function normalizeAvailabilityTimeInput(timeString) {

    const time24 =
        convert12HourTo24Hour(timeString);

    if (!time24) {
        return null;
    }

    const parts =
        time24.split(":");

    let hour =
        Number(parts[0]);

    const minute =
        Number(parts[1]);

    const period =
        hour >= 12 ? "PM" : "AM";

    if (hour === 0) {
        hour = 12;
    } else if (hour > 12) {
        hour -= 12;
    }

    return (
        hour +
        ":" +
        String(minute).padStart(2, "0") +
        " " +
        period
    );
}


function compareAvailabilityTimes(
    startTime,
    endTime
) {

    const sampleDate =
        new Date(
            buildISODatetimeWithTimezone(
                "2026-01-01",
                "00:00"
            )
        );

    const start =
        parseAvailabilityTimeValue(
            startTime,
            sampleDate
        );

    const end =
        parseAvailabilityTimeValue(
            endTime,
            sampleDate
        );

    if (
        !start ||
        !end ||
        start.getTime() >= end.getTime()
    ) {
        return false;
    }

    return true;
}


function getDoctorWeeklyAvailability(doctorId) {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Availability");

    const availability = {};

    DOCTOR_WEEKDAYS.forEach(function (day) {
        availability[day] = [];
    });

    if (!sheet) {
        return availability;
    }

    const data =
        sheet.getDataRange().getValues();

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        if (
            String(data[i][0] || "").trim() !==
            String(doctorId).trim()
        ) {
            continue;
        }

        const day =
            String(data[i][1] || "").trim();

        if (
            DOCTOR_WEEKDAYS.indexOf(day) === -1
        ) {
            continue;
        }

        availability[day].push({
            start:
                formatAvailabilityTimeForDisplay(
                    data[i][2]
                ),
            end:
                formatAvailabilityTimeForDisplay(
                    data[i][3]
                ),
            row: i + 1
        });
    }

    return availability;
}


function getDoctorDayAvailabilitySessions(
    doctorId,
    dayName
) {

    const weekly =
        getDoctorWeeklyAvailability(doctorId);

    return weekly[dayName] || [];
}


function addDoctorAvailabilitySession(
    doctorId,
    dayName,
    startTime,
    endTime
) {

    const start =
        normalizeAvailabilityTimeInput(
            startTime
        );

    const end =
        normalizeAvailabilityTimeInput(
            endTime
        );

    if (
        !start ||
        !end
    ) {
        return {
            success: false,
            message:
                "Invalid time format. Use Example: 10:00 AM"
        };
    }

    if (
        !compareAvailabilityTimes(
            start,
            end
        )
    ) {
        return {
            success: false,
            message:
                "End time must be after start time."
        };
    }

    const lock = LockService.getScriptLock();

    if (!lock.tryLock(10000)) {
        return {
            success: false,
            message:
                "Unable to save availability. Please try again."
        };
    }

    try {

        const sheet =
            ensureAvailabilitySheet();

        sheet.appendRow([
            String(doctorId).trim(),
            dayName,
            start,
            end
        ]);

        return {
            success: true,
            message:
                "Availability saved: " +
                start +
                " - " +
                end +
                " on " +
                dayName +
                "."
        };

    } finally {
        lock.releaseLock();
    }
}


function removeDoctorAvailabilitySession(
    doctorId,
    dayName,
    sessionIndex
) {

    const lock = LockService.getScriptLock();

    if (!lock.tryLock(10000)) {
        return {
            success: false,
            message:
                "Unable to remove availability. Please try again."
        };
    }

    try {

        const sessions =
            getDoctorDayAvailabilitySessions(
                doctorId,
                dayName
            );

        const pick =
            Number(sessionIndex);

        if (
            !Number.isInteger(pick) ||
            pick < 1 ||
            pick > sessions.length
        ) {
            return {
                success: false,
                message:
                    "Invalid session number."
            };
        }

        const ss =
            SpreadsheetApp.getActiveSpreadsheet();

        const sheet =
            ss.getSheetByName("Availability");

        if (!sheet) {
            return {
                success: false,
                message:
                    "Availability sheet not found."
            };
        }

        sheet.deleteRow(
            sessions[pick - 1].row
        );

        return {
            success: true,
            message:
                "Removed session " +
                pick +
                " for " +
                dayName +
                "."
        };

    } finally {
        lock.releaseLock();
    }
}


function clearDoctorDayAvailability(
    doctorId,
    dayName
) {

    const lock = LockService.getScriptLock();

    if (!lock.tryLock(10000)) {
        return {
            success: false,
            message:
                "Unable to clear availability. Please try again."
        };
    }

    try {

        const sessions =
            getDoctorDayAvailabilitySessions(
                doctorId,
                dayName
            );

        if (sessions.length === 0) {
            return {
                success: true,
                message:
                    dayName +
                    " already has no sessions."
            };
        }

        const ss =
            SpreadsheetApp.getActiveSpreadsheet();

        const sheet =
            ss.getSheetByName("Availability");

        if (!sheet) {
            return {
                success: false,
                message:
                    "Availability sheet not found."
            };
        }

        const rows =
            sessions
                .map(function (session) {
                    return session.row;
                })
                .sort(function (a, b) {
                    return b - a;
                });

        rows.forEach(function (row) {
            sheet.deleteRow(row);
        });

        return {
            success: true,
            message:
                "Cleared all sessions for " +
                dayName +
                "."
        };

    } finally {
        lock.releaseLock();
    }
}


function normalizeLeaveSheetDate(value) {

    if (value instanceof Date) {
        return Utilities.formatDate(
            value,
            TIMEZONE,
            "yyyy-MM-dd"
        );
    }

    return String(value || "").trim();
}


function getDoctorUpcomingLeaves(doctorId) {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Doctor_Leaves");

    if (!sheet) {
        return [];
    }

    const data =
        sheet.getDataRange().getValues();

    const today =
        Utilities.formatDate(
            new Date(),
            TIMEZONE,
            "yyyy-MM-dd"
        );

    const leaves = [];

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        if (
            String(data[i][0] || "").trim() !==
            String(doctorId).trim()
        ) {
            continue;
        }

        const dateString =
            normalizeLeaveSheetDate(
                data[i][1]
            );

        const active =
            String(data[i][3] || "")
                .toUpperCase() === "TRUE";

        if (
            !active ||
            !dateString ||
            dateString < today
        ) {
            continue;
        }

        leaves.push({
            date: dateString,
            reason:
                String(data[i][2] || "").trim(),
            row: i + 1
        });
    }

    leaves.sort(function (a, b) {
        return a.date.localeCompare(b.date);
    });

    return leaves;
}


function addDoctorLeave(
    doctorId,
    dateString,
    reason
) {

    if (!isValidISODate(dateString)) {
        return {
            success: false,
            message:
                "Invalid date. Use YYYY-MM-DD."
        };
    }

    const lock = LockService.getScriptLock();

    if (!lock.tryLock(10000)) {
        return {
            success: false,
            message:
                "Unable to save leave. Please try again."
        };
    }

    try {

        // Re-check under the lock — the check above (before acquiring
        // the lock) is only an early exit; without re-checking here,
        // two concurrent calls could both pass the earlier check and
        // both append a duplicate leave row.
        if (
            isDoctorOnLeave(
                doctorId,
                dateString
            )
        ) {
            return {
                success: false,
                message:
                    "Leave already active on " +
                    dateString +
                    "."
            };
        }

        const sheet =
            ensureDoctorLeavesSheet();

        sheet.appendRow([
            String(doctorId).trim(),
            dateString,
            String(reason || "").trim(),
            "TRUE"
        ]);

        return {
            success: true,
            message:
                "Leave added for " +
                dateString +
                "."
        };

    } finally {
        lock.releaseLock();
    }
}


function addDoctorLeaveRange(
    doctorId,
    startDate,
    endDate,
    reason
) {

    if (
        !isValidISODate(startDate) ||
        !isValidISODate(endDate)
    ) {
        return {
            success: false,
            message:
                "Invalid date range. Use YYYY-MM-DD."
        };
    }

    if (startDate > endDate) {
        return {
            success: false,
            message:
                "Start date must be on or before end date."
        };
    }

    let added = 0;
    let skipped = 0;

    const cursor =
        new Date(
            buildISODatetimeWithTimezone(
                startDate,
                "00:00"
            )
        );

    const end =
        new Date(
            buildISODatetimeWithTimezone(
                endDate,
                "00:00"
            )
        );

    while (cursor.getTime() <= end.getTime()) {

        const iso =
            Utilities.formatDate(
                cursor,
                TIMEZONE,
                "yyyy-MM-dd"
            );

        const result =
            addDoctorLeave(
                doctorId,
                iso,
                reason
            );

        if (result.success) {
            added++;
        } else {
            skipped++;
        }

        cursor.setDate(
            cursor.getDate() + 1
        );
    }

    return {
        success: added > 0,
        message:
            "Leave range processed: " +
            added +
            " day(s) added" +
            (
                skipped
                    ? ", " + skipped + " skipped"
                    : ""
            ) +
            "."
    };
}


function deactivateDoctorLeave(
    doctorId,
    dateString
) {

    const lock = LockService.getScriptLock();

    if (!lock.tryLock(10000)) {
        return {
            success: false,
            message:
                "Unable to cancel leave. Please try again."
        };
    }

    try {

        const ss =
            SpreadsheetApp.getActiveSpreadsheet();

        const sheet =
            ss.getSheetByName("Doctor_Leaves");

        if (!sheet) {
            return {
                success: false,
                message:
                    "Doctor_Leaves sheet not found."
            };
        }

        const data =
            sheet.getDataRange().getValues();

        for (
            let i = 1;
            i < data.length;
            i++
        ) {

            if (
                String(data[i][0] || "").trim() !==
                String(doctorId).trim()
            ) {
                continue;
            }

            const rowDate =
                normalizeLeaveSheetDate(
                    data[i][1]
                );

            const active =
                String(data[i][3] || "")
                    .toUpperCase() === "TRUE";

            if (
                rowDate === dateString &&
                active
            ) {

                sheet
                    .getRange(i + 1, 4)
                    .setValue("FALSE");

                return {
                    success: true,
                    message:
                        "Leave cancelled for " +
                        dateString +
                        "."
                };
            }
        }

        return {
            success: false,
            message:
                "Active leave not found for " +
                dateString +
                "."
        };

    } finally {
        lock.releaseLock();
    }
}


function getDoctorPatientsSeen(doctorId) {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Appointments");

    if (!sheet) {
        return [];
    }

    const data =
        sheet.getDataRange().getValues();

    const byPhone = {};

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        if (
            String(data[i][3] || "").trim() !==
            String(doctorId).trim()
        ) {
            continue;
        }

        const status =
            String(data[i][6] || "")
                .trim()
                .toLowerCase();

        if (status === "cancelled") {
            continue;
        }

        const phone =
            String(data[i][5] || "").trim();

        if (!phone) {
            continue;
        }

        const name =
            String(data[i][4] || "").trim() ||
            "Unknown";

        const dateValue =
            data[i][1] instanceof Date
                ? Utilities.formatDate(
                    data[i][1],
                    TIMEZONE,
                    "dd-MMM-yyyy"
                )
                : data[i][1];

        const timeValue =
            data[i][2] instanceof Date
                ? Utilities.formatDate(
                    data[i][2],
                    TIMEZONE,
                    "hh:mm a"
                )
                : data[i][2];

        const appointmentDate =
            parseAppointmentDateTime(
                dateValue,
                timeValue
            );

        const sortKey =
            appointmentDate
                ? appointmentDate.getTime()
                : 0;

        const key =
            normalizeWhatsAppPhone(phone) ||
            phone;

        if (!byPhone[key]) {

            byPhone[key] = {
                name: name,
                phone: phone,
                lastVisit:
                    appointmentDate
                        ? Utilities.formatDate(
                            appointmentDate,
                            TIMEZONE,
                            "yyyy-MM-dd"
                        )
                        : "",
                lastVisitTime: sortKey,
                visitCount: 1
            };

        } else {

            byPhone[key].visitCount++;

            if (sortKey >= byPhone[key].lastVisitTime) {
                byPhone[key].lastVisitTime =
                    sortKey;
                byPhone[key].lastVisit =
                    appointmentDate
                        ? Utilities.formatDate(
                            appointmentDate,
                            TIMEZONE,
                            "yyyy-MM-dd"
                        )
                        : byPhone[key].lastVisit;
                byPhone[key].name = name;
            }
        }
    }

    return Object.keys(byPhone)
        .map(function (key) {
            return byPhone[key];
        })
        .sort(function (a, b) {
            return b.lastVisitTime -
                a.lastVisitTime;
        });
}



// ============================================================
// 9. GET DOCTORS
// ============================================================

// Doctors sheet historically had 7 columns (through Active). Existing
// spreadsheets won't have an 8th "Specialization" column yet — this
// self-heals the header the same way the WhatsApp_Sessions sheet grew
// its Language/Patient Name/Slot Page columns, so nothing needs manual
// sheet surgery on upgrade. New sheets already get it from
// ensureDoctorsSheet (Setup.gs).
function ensureDoctorSpecializationColumn(sheet) {

    if (!sheet.getRange(1, 8).getValue()) {
        sheet
            .getRange(1, 8)
            .setValue("Specialization");
    }
}



function getDoctors() {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Doctors");

    ensureDoctorSpecializationColumn(sheet);

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
                data[i][2],

            specialization:
                String(data[i][7] || "").trim()
        });
    }

    return doctors;
}



function getDoctorRecord(doctorId) {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Doctors");

    if (!sheet) {
        return null;
    }

    const data =
        sheet.getDataRange().getValues();

    const target =
        String(doctorId || "").trim();

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        if (
            String(data[i][0]).trim() ===
            target
        ) {

            return {
                doctorId:
                    String(data[i][0]).trim(),
                doctorName:
                    String(data[i][1] || "").trim(),
                clinicName:
                    String(data[i][2] || "").trim(),
                calendarId:
                    String(data[i][3] || "").trim(),
                whatsApp:
                    String(data[i][4] || "").trim(),
                appointmentDuration:
                    Number(data[i][5]) || 30,
                specialization:
                    String(data[i][7] || "").trim()
            };
        }
    }

    return null;
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

        // Don't show inactive appointments
        if (
            isHiddenAppointmentStatus(status)
        ) {
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
                buildISODatetimeWithTimezone(
                    dateString,
                    "00:00"
                )
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


        // Ignore inactive statuses

        if (
            isHiddenAppointmentStatus(
                rowStatus
            )
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
                buildISODatetimeWithTimezone(
                    weekStartString,
                    "00:00"
                )
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


        // Ignore inactive statuses

        if (
            isHiddenAppointmentStatus(status)
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


        // Ignore inactive statuses

        if (
            isHiddenAppointmentStatus(status)
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


function findDoctorByWhatsAppPhone(phone) {
    const sheet = SpreadsheetApp.getActiveSpreadsheet()
        .getSheetByName("Doctors");
    if (!sheet) return null;

    const target = normalizeWhatsAppPhone(phone);
    if (!target) return null;

    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {

        const doctorId = String(data[i][0] || "").trim();
        const doctorName = String(data[i][1] || "").trim();
        const whatsappPhone = String(data[i][4] || "").trim();
        const active = String(data[i][6] || "").trim().toUpperCase();

        if (
            !doctorId ||
            !doctorName ||
            !whatsappPhone
        ) {
            continue;
        }

        if (active !== "YES") {
            continue;
        }

        if (
            normalizeWhatsAppPhone(whatsappPhone) === target
        ) {
            return {
                doctorId: doctorId,
                doctorName: doctorName
            };
        }
    }
    return null;
}



function findDoctorById(doctorId) {

    const doctor =
        getDoctorRecord(doctorId);

    return doctor
        ? doctor.doctorName
        : null;
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
