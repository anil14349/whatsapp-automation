// ============================================================
// Util_RLS — part of the ABC Clinic WhatsApp bot
// Row-Level Security (RLS) validation to enforce clinic data isolation.
// Ensures each clinic's data is only accessible within that clinic context.
// ============================================================



// ========================================================
// VALIDATE DOCTOR BELONGS TO CLINIC
// ========================================================
// Verify doctor ID is valid and belongs to the configured clinic
// Returns: {authorized: bool, clinicName: string, doctorName: string}
function validateDoctorClinicAccess(doctorId) {

    if (!doctorId) {
        return {
            authorized: false,
            reason: "Doctor ID is required"
        };
    }

    const doctor = getDoctorRecord(doctorId);

    // GUARD: doctor null check at line 25 prevents null dereference at line 38
    // where doctor.clinicName and doctor.doctorName are accessed
    if (!doctor) {
        return {
            authorized: false,
            reason: "Doctor not found"
        };
    }

    // Doctor exists (clinic isolation is per-sheet instance)
    // The Google Sheet itself is clinic-specific; all doctors in the
    // sheet belong to the same clinic. No clinic ID column needed.

    return {
        authorized: true,
        clinicName: doctor.clinicName || "",
        doctorName: doctor.doctorName || ""
    };
}



// ========================================================
// VALIDATE APPOINTMENT BELONGS TO CLINIC
// ========================================================
// Verify appointment is in the clinic's context (by validating doctor ownership)
// Returns: {authorized: bool, doctorId: string, clinicName: string}
function validateAppointmentClinicAccess(appointmentId) {

    if (!appointmentId) {
        return {
            authorized: false,
            reason: "Appointment ID is required"
        };
    }

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Appointments");

    if (!sheet) {
        return {
            authorized: false,
            reason: "Appointments sheet not found"
        };
    }

    const data = sheet.getDataRange().getValues();

    // Find appointment (scan backwards for efficiency)
    for (let i = data.length - 1; i >= 1; i--) {

        const rowAppointmentId =
            String(data[i][0] || "").trim();

        if (rowAppointmentId !== String(appointmentId).trim()) {
            continue;
        }

        // Found appointment
        const doctorId =
            String(data[i][3] || "").trim();

        if (!doctorId) {
            return {
                authorized: false,
                reason: "Appointment has no doctor assigned"
            };
        }

        // Validate doctor belongs to clinic
        const doctorAccess =
            validateDoctorClinicAccess(doctorId);

        return {
            authorized: doctorAccess.authorized,
            doctorId: doctorId,
            clinicName: doctorAccess.clinicName,
            reason: doctorAccess.reason
        };
    }

    return {
        authorized: false,
        reason: "Appointment not found"
    };
}



// ========================================================
// VALIDATE PATIENT DATA ACCESS
// ========================================================
// For patient-initiated operations, validate they have access to the appointment/data
// Returns: {authorized: bool, patientPhone: string}
function validatePatientDataAccess(appointmentId, patientPhone) {

    if (!appointmentId || !patientPhone) {
        return {
            authorized: false,
            reason: "Appointment ID and patient phone required"
        };
    }

    // Verify appointment exists and belongs to patient
    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Appointments");

    if (!sheet) {
        return {
            authorized: false,
            reason: "Appointments sheet not found"
        };
    }

    const data = sheet.getDataRange().getValues();

    for (let i = data.length - 1; i >= 1; i--) {

        const rowAppointmentId =
            String(data[i][0] || "").trim();

        if (
            rowAppointmentId !==
            String(appointmentId).trim()
        ) {
            continue;
        }

        // Found appointment — verify patient ownership
        const rowPhone =
            String(data[i][5] || "").trim();

        const authorized =
            phonesMatch(rowPhone, patientPhone);

        return {
            authorized: authorized,
            patientPhone: rowPhone,
            reason: authorized
                ? ""
                : "Patient phone does not match appointment"
        };
    }

    return {
        authorized: false,
        reason: "Appointment not found"
    };
}



// ========================================================
// LOG RLS VIOLATION (audit trail)
// ========================================================
// Record unauthorized access attempts for security monitoring
function logRLSViolation(
    violationType,
    attemptedId,
    requestorType,
    requestorId,
    reason
) {

    try {

        const ss =
            SpreadsheetApp.getActiveSpreadsheet();

        let logSheet =
            ss.getSheetByName("RLS_Violations");

        if (!logSheet) {

            logSheet = ss.insertSheet("RLS_Violations");

            logSheet.appendRow([
                "Timestamp",
                "Violation Type",
                "Attempted ID",
                "Requestor Type",
                "Requestor ID",
                "Reason"
            ]);

            logSheet.hideSheet();
        }

        logSheet.appendRow([
            new Date(),
            violationType,
            attemptedId,
            requestorType,
            requestorId,
            reason
        ]);

    } catch (error) {

        Logger.log(
            "Failed to log RLS violation: " +
            error.message
        );
    }
}
