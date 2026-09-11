// ============================================================
// Util_Waitlist — part of the ABC Clinic WhatsApp bot
// Waitlist management: auto-notify when slots become available
// ============================================================



function ensureWaitlistSheet() {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    let sheet =
        ss.getSheetByName("Waitlist");

    if (!sheet) {

        sheet = ss.insertSheet("Waitlist");

        sheet.appendRow([
            "Waitlist ID",
            "Doctor ID",
            "Preferred Date",
            "Preferred Time",
            "Patient Phone",
            "Patient Name",
            "Added On",
            "Status",
            "Notified At",
            "Booked Appointment ID"
        ]);

        sheet.hideSheet();
    }

    return sheet;
}



// Add patient to waitlist
// Returns: {success: bool, waitlistId: string}
function addToWaitlist(
    doctorId,
    preferredDate,
    preferredTime,
    patientPhone,
    patientName
) {

    if (
        !doctorId || !preferredDate ||
        !preferredTime || !patientPhone
    ) {

        return {
            success: false,
            message: "Missing required fields"
        };
    }

    const sheet = ensureWaitlistSheet();

    const waitlistId =
        "WL_" +
        Utilities.getUuid()
            .substring(0, 8)
            .toUpperCase();

    sheet.appendRow([
        waitlistId,
        String(doctorId).trim(),
        String(preferredDate).trim(),
        String(preferredTime).trim(),
        String(patientPhone).trim(),
        String(patientName || "").trim(),
        new Date(),
        "WAITING",
        "",
        ""
    ]);

    return {
        success: true,
        waitlistId: waitlistId,
        message:
            "Added to waitlist. We'll notify you when " +
            preferredTime + " becomes available."
    };
}



// Get waitlist entries for a doctor/date/time
// Returns: ordered by date added (FIFO)
function getWaitlistForSlot(
    doctorId,
    date,
    time
) {

    if (!doctorId || !date || !time) {
        return [];
    }

    const sheet = ensureWaitlistSheet();

    const data = sheet.getDataRange().getValues();

    const waiting = [];

    const normalizedDoctor =
        String(doctorId).trim();

    const normalizedDate =
        String(date).trim();

    const normalizedTime =
        String(time).trim();

    // ========================================================
    // SCAN FORWARD FOR FIFO ORDER
    // ========================================================
    // Must scan forward to maintain FIFO (first in queue first)
    // but exit early once we have >0 matches (likely only 1-3 people)

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        const wlDoctor =
            String(data[i][1] || "").trim();

        const wlDate =
            String(data[i][2] || "").trim();

        const wlTime =
            String(data[i][3] || "").trim();

        const wlStatus =
            String(data[i][7] || "").trim();

        if (
            wlDoctor === normalizedDoctor &&
            wlDate === normalizedDate &&
            wlTime === normalizedTime &&
            wlStatus === "WAITING"
        ) {

            waiting.push({
                row: i + 1,
                waitlistId: data[i][0],
                phone: data[i][4],
                name: data[i][5],
                addedOn: data[i][6]
            });
        }
    }

    return waiting;
}



// Notify next waitlisted patient when slot becomes available
// Called when appointment is cancelled
// Returns: {notified: bool, patientPhone: string}
function notifyNextWaitlistedPatient(
    doctorId,
    date,
    time
) {

    if (!doctorId || !date || !time) {

        return {
            notified: false,
            message: "Invalid slot information"
        };
    }

    // Get waitlist (FIFO order)
    const waiting = getWaitlistForSlot(
        doctorId,
        date,
        time
    );

    if (waiting.length === 0) {

        return {
            notified: false,
            message: "No one on waitlist for this slot"
        };
    }

    // Get first person on waitlist
    const nextPatient = waiting[0];

    const doctor = getDoctorRecord(doctorId);

    const doctorName =
        doctor && doctor.doctorName
            ? doctor.doctorName
            : "Our doctor";

    const message =
        "🎉 *Great News!*\n\n" +
        "A slot with Dr. " + doctorName + " is " +
        "now available!\n\n" +
        "📅 " + date + "\n" +
        "🕐 " + time + "\n\n" +
        "Reply *YES* to book this appointment " +
        "or *NO* to stay on waitlist.";

    try {

        sendWhatsAppTextMessage(
            nextPatient.phone,
            message
        );

        // Mark as notified
        const sheet = ensureWaitlistSheet();

        sheet.getRange(nextPatient.row, 8).setValue(
            "NOTIFIED"
        );

        sheet.getRange(nextPatient.row, 9).setValue(
            new Date()
        );

        Logger.log(
            "Notified waitlist patient: " +
            nextPatient.phone
        );

        return {
            notified: true,
            patientPhone: nextPatient.phone,
            patientName: nextPatient.name,
            message: "Notification sent to: " +
                nextPatient.name
        };

    } catch (error) {

        Logger.log(
            "Failed to notify waitlist patient: " +
            error.message
        );

        return {
            notified: false,
            message: "Failed to send notification"
        };
    }
}



// Record that waitlist patient booked the slot
function recordWaitlistBooking(
    waitlistId,
    appointmentId
) {

    if (!waitlistId || !appointmentId) {
        return false;
    }

    const sheet = ensureWaitlistSheet();

    const data = sheet.getDataRange().getValues();

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        if (
            String(data[i][0] || "").trim() ===
            String(waitlistId).trim()
        ) {

            sheet.getRange(i + 1, 8).setValue("BOOKED");
            sheet.getRange(i + 1, 10).setValue(
                String(appointmentId).trim()
            );

            return true;
        }
    }

    return false;
}



// Remove patient from waitlist
function removeFromWaitlist(waitlistId) {

    if (!waitlistId) {
        return false;
    }

    const sheet = ensureWaitlistSheet();

    const data = sheet.getDataRange().getValues();

    // Delete in reverse to preserve row numbers
    for (
        let i = data.length - 1;
        i >= 1;
        i--
    ) {

        if (
            String(data[i][0] || "").trim() ===
            String(waitlistId).trim()
        ) {

            sheet.deleteRow(i + 1);
            return true;
        }
    }

    return false;
}



// Get patient's waitlist entries
function getPatientWaitlistEntries(patientPhone) {

    if (!patientPhone) {
        return [];
    }

    const sheet = ensureWaitlistSheet();

    const data = sheet.getDataRange().getValues();

    const entries = [];

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        const phone =
            String(data[i][4] || "").trim();

        const status =
            String(data[i][7] || "").trim();

        if (
            phonesMatch(phone, patientPhone) &&
            status === "WAITING"
        ) {

            const doctor =
                getDoctorRecord(data[i][1]);

            entries.push({
                waitlistId: data[i][0],
                doctorName:
                    doctor && doctor.doctorName
                        ? doctor.doctorName
                        : "Unknown",
                date: data[i][2],
                time: data[i][3],
                addedOn: data[i][6]
            });
        }
    }

    return entries;
}
