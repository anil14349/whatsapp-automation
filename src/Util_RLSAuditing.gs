// ============================================================
// Util_RLSAuditing — part of the ABC Clinic WhatsApp bot
// Integrate RLS validation checks into existing flows with audit logging
// ============================================================



// Wrapper for cancelAppointment with RLS audit
function cancelAppointmentWithRLSAudit(
    appointmentId,
    patientPhone,
    options,
    requestorType,
    requestorId
) {

    // ========================================================
    // RLS VALIDATION
    // ========================================================

    const rlsCheck =
        validateAppointmentClinicAccess(
            appointmentId
        );

    if (!rlsCheck.authorized) {

        logRLSViolation(
            "CANCEL_ATTEMPT",
            appointmentId,
            requestorType,
            requestorId,
            rlsCheck.reason
        );

        return {
            success: false,
            message:
                "Unauthorized: Unable to access appointment"
        };
    }

    // Verify patient if patient-initiated
    if (
        requestorType === "PATIENT"
    ) {

        const patientAccess =
            validatePatientDataAccess(
                appointmentId,
                patientPhone
            );

        if (!patientAccess.authorized) {

            logRLSViolation(
                "CANCEL_UNAUTHORIZED",
                appointmentId,
                requestorType,
                requestorId,
                patientAccess.reason
            );

            return {
                success: false,
                message:
                    "You can only cancel your own appointments"
            };
        }
    }

    // ========================================================
    // PROCEED WITH CANCELLATION
    // ========================================================

    const result =
        cancelAppointment(
            appointmentId,
            patientPhone,
            options
        );

    if (result.success) {

        Logger.log(
            "RLS Audit: Appointment " +
            appointmentId + " cancelled by " +
            requestorType + " (" + requestorId + ")"
        );
    }

    return result;
}



// Wrapper for rescheduleAppointment with RLS audit
function rescheduleAppointmentWithRLSAudit(
    appointmentId,
    patientPhone,
    newDate,
    newTime,
    options,
    requestorType,
    requestorId
) {

    // ========================================================
    // RLS VALIDATION
    // ========================================================

    const rlsCheck =
        validateAppointmentClinicAccess(
            appointmentId
        );

    if (!rlsCheck.authorized) {

        logRLSViolation(
            "RESCHEDULE_ATTEMPT",
            appointmentId,
            requestorType,
            requestorId,
            rlsCheck.reason
        );

        return {
            success: false,
            message:
                "Unauthorized: Unable to access appointment"
        };
    }

    // Verify patient if patient-initiated
    if (
        requestorType === "PATIENT"
    ) {

        const patientAccess =
            validatePatientDataAccess(
                appointmentId,
                patientPhone
            );

        if (!patientAccess.authorized) {

            logRLSViolation(
                "RESCHEDULE_UNAUTHORIZED",
                appointmentId,
                requestorType,
                requestorId,
                patientAccess.reason
            );

            return {
                success: false,
                message:
                    "You can only reschedule your own appointments"
            };
        }
    }

    // ========================================================
    // PROCEED WITH RESCHEDULE
    // ========================================================

    const result =
        rescheduleAppointment(
            appointmentId,
            patientPhone,
            newDate,
            newTime,
            options
        );

    if (result.success) {

        Logger.log(
            "RLS Audit: Appointment " +
            appointmentId + " rescheduled by " +
            requestorType + " (" + requestorId + ")"
        );
    }

    return result;
}



// Wrapper for viewing patient appointments with RLS audit
function getPatientAppointmentsWithRLSAudit(
    patientPhone,
    requestorType,
    requestorId
) {

    // ========================================================
    // RLS VALIDATION
    // ========================================================

    // Patient can only view own appointments
    if (requestorType === "PATIENT") {

        // Patients can only see their own phone
        if (requestorId !== patientPhone) {

            logRLSViolation(
                "VIEW_APPOINTMENTS",
                "PATIENT:" + requestorId,
                requestorType,
                requestorId,
                "Attempted to view another patient's appointments"
            );

            return {
                success: false,
                message: "Unauthorized"
            };
        }
    }

    // Doctors can view any patient
    if (
        requestorType === "DOCTOR"
    ) {

        const doctorAccess =
            validateDoctorClinicAccess(
                requestorId
            );

        if (!doctorAccess.authorized) {

            logRLSViolation(
                "VIEW_APPOINTMENTS",
                "PATIENT:" + patientPhone,
                requestorType,
                requestorId,
                "Doctor not found in clinic"
            );

            return {
                success: false,
                message: "Unauthorized"
            };
        }
    }

    // ========================================================
    // PROCEED WITH VIEW
    // ========================================================

    try {

        const appointments =
            getMyAppointments(patientPhone);

        Logger.log(
            "RLS Audit: " + requestorType + " (" +
            requestorId + ") viewed appointments for " +
            patientPhone
        );

        return {
            success: true,
            appointments: appointments
        };

    } catch (error) {

        Logger.log(
            "Error retrieving appointments: " +
            error.message
        );

        return {
            success: false,
            message: "Unable to retrieve appointments"
        };
    }
}



// Generate RLS audit report
// Returns: {success: bool, report: string}
function generateRLSAuditReport(
    fromDate,
    toDate
) {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("RLS_Violations");

    if (!sheet) {

        return {
            success: false,
            message: "No RLS violations recorded"
        };
    }

    const data = sheet.getDataRange().getValues();
    const report = [];

    report.push(
        "RLS Violation Audit Report"
    );

    report.push(
        "Generated: " +
        Utilities.formatDate(
            new Date(),
            TIMEZONE,
            "yyyy-MM-dd HH:mm:ss"
        )
    );

    report.push("");
    report.push("Total Violations: " + (data.length - 1));
    report.push("");
    report.push("Details:");
    report.push("");

    let filteredCount = 0;

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        const timestamp =
            String(data[i][0] || "");

        const violationType =
            String(data[i][1] || "");

        const attemptedId =
            String(data[i][2] || "");

        const requestorType =
            String(data[i][3] || "");

        const requestorId =
            String(data[i][4] || "");

        const reason =
            String(data[i][5] || "");

        // Apply date filters if provided
        if (fromDate && timestamp < fromDate) {
            continue;
        }

        if (toDate && timestamp > toDate) {
            continue;
        }

        filteredCount++;

        report.push(
            filteredCount + ". " +
            "[" + timestamp + "] " +
            violationType + " - " +
            requestorType + " (" + requestorId + ") " +
            "attempted " + attemptedId + ": " +
            reason
        );
    }

    report.push("");
    report.push("End of Report");

    return {
        success: true,
        report: report.join("\n"),
        violationCount: filteredCount
    };
}
