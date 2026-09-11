// ============================================================
// Util_PatientHistory — part of the ABC Clinic WhatsApp bot
// Show patient's past appointments before new booking (continuity of care)
// ============================================================



// Get patient's past appointment history
// Returns: {appointments: [{date, doctor, status, notes}, ...], count: number}
function getPatientAppointmentHistory(patientPhone) {

    if (!patientPhone) {
        return {
            appointments: [],
            count: 0
        };
    }

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Appointments");

    if (!sheet) {

        return {
            appointments: [],
            count: 0
        };
    }

    const data = sheet.getDataRange().getValues();
    const history = [];

    // Scan backwards (most recent first)
    for (
        let i = data.length - 1;
        i >= 1;
        i--
    ) {

        const phone =
            String(data[i][5] || "").trim();

        const status =
            String(data[i][6] || "").trim();

        // Only include completed appointments
        if (
            !phonesMatch(phone, patientPhone) ||
            (
                status.toUpperCase() !== "COMPLETED" &&
                status.toUpperCase() !== "NO-SHOW"
            )
        ) {
            continue;
        }

        const appointmentDate =
            String(data[i][1] || "").trim();

        const appointmentTime =
            String(data[i][2] || "").trim();

        const doctorId =
            String(data[i][3] || "").trim();

        const doctor =
            getDoctorRecord(doctorId);

        const doctorName =
            doctor && doctor.doctorName
                ? doctor.doctorName
                : "Unknown Doctor";

        history.push({
            date: appointmentDate,
            time: appointmentTime,
            doctor: doctorName,
            doctorId: doctorId,
            status: status
        });

        // Limit to last 5 appointments
        if (history.length >= 5) {
            break;
        }
    }

    return {
        appointments: history,
        count: history.length
    };
}



// Format appointment history as WhatsApp message
function formatPatientHistoryMessage(patientPhone) {

    const history =
        getPatientAppointmentHistory(patientPhone);

    if (
        !history ||
        history.count === 0
    ) {

        return null;
    }

    let message =
        "📋 *Your Recent Appointments*\n\n";

    for (
        let i = 0;
        i < history.appointments.length;
        i++
    ) {

        const appt = history.appointments[i];

        message +=
            (i + 1) + ". " +
            appt.date + " @ " +
            appt.time + "\n" +
            "   Dr. " + appt.doctor + "\n" +
            "   Status: " + appt.status + "\n\n";
    }

    return message;
}



// Get last appointment (for follow-up context)
function getLastAppointmentSummary(
    patientPhone,
    doctorId
) {

    if (!patientPhone || !doctorId) {
        return null;
    }

    const history =
        getPatientAppointmentHistory(patientPhone);

    if (!history || history.count === 0) {
        return null;
    }

    // Find last appointment with this doctor
    for (
        let i = 0;
        i < history.appointments.length;
        i++
    ) {

        const appt = history.appointments[i];

        if (appt.doctorId === doctorId) {

            return {
                date: appt.date,
                time: appt.time,
                doctor: appt.doctor,
                status: appt.status,
                message:
                    "Last visit: " + appt.date +
                    " with Dr. " + appt.doctor
            };
        }
    }

    return null;
}



// Show appointment history before booking
function showPatientHistoryBeforeBooking(
    patientPhone,
    doctorId
) {

    let message = "";

    // Show recent appointments
    const historyMsg =
        formatPatientHistoryMessage(patientPhone);

    if (historyMsg) {
        message += historyMsg + "\n";
    }

    // Show last visit with this doctor
    const lastVisit =
        getLastAppointmentSummary(
            patientPhone,
            doctorId
        );

    if (lastVisit) {

        message +=
            "📅 *Last Visit with this Doctor*\n" +
            lastVisit.date + " @ " +
            lastVisit.time + "\n";
    }

    return message || null;
}



// Track appointment notes (doctor's post-appointment observations)
function addAppointmentNotes(
    appointmentId,
    notes
) {

    if (!appointmentId || !notes) {
        return false;
    }

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    let notesSheet =
        ss.getSheetByName("Appointment_Notes");

    if (!notesSheet) {

        notesSheet = ss.insertSheet("Appointment_Notes");

        notesSheet.appendRow([
            "Appointment ID",
            "Date",
            "Doctor Notes",
            "Created At"
        ]);

        notesSheet.hideSheet();
    }

    const date = new Date();

    notesSheet.appendRow([
        String(appointmentId).trim(),
        Utilities.formatDate(date, TIMEZONE, "yyyy-MM-dd HH:mm:ss"),
        String(notes).trim(),
        date
    ]);

    return true;
}



// Get appointment notes (for follow-up context)
function getAppointmentNotes(appointmentId) {

    if (!appointmentId) {
        return null;
    }

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Appointment_Notes");

    if (!sheet) {
        return null;
    }

    const data = sheet.getDataRange().getValues();

    for (
        let i = data.length - 1;
        i >= 1;
        i--
    ) {

        if (
            String(data[i][0] || "").trim() ===
            String(appointmentId).trim()
        ) {

            return {
                appointmentId: appointmentId,
                notes: String(data[i][2] || ""),
                createdAt: data[i][3]
            };
        }
    }

    return null;
}
