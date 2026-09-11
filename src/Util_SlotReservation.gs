// ============================================================
// Util_SlotReservation — part of the ABC Clinic WhatsApp bot
// Appointment slot reservation to prevent TOCTOU (Time-of-Check-Time-of-Use)
// race conditions where two patients book the same slot.
// ============================================================



function ensureSlotReservationSheet() {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    let sheet =
        ss.getSheetByName("Slot_Reservations");

    if (!sheet) {

        sheet = ss.insertSheet("Slot_Reservations");

        sheet.appendRow([
            "Doctor ID",
            "Date",
            "Time",
            "Patient Phone",
            "Reserved At",
            "Expires At"
        ]);

        // Hide this operational sheet
        sheet.hideSheet();
    }

    return sheet;
}



// Reserve a slot for a patient (prevents overbooking during booking flow)
// Returns: {reserved: bool, expiresAt: date}
function reserveSlot(
    doctorId,
    dateString,
    timeString,
    patientPhone
) {

    if (
        !doctorId || !dateString ||
        !timeString || !patientPhone
    ) {

        return { reserved: false };
    }

    const sheet =
        ensureSlotReservationSheet();

    const now = new Date();
    const expiresAt =
        new Date(now.getTime() + (10 * 60 * 1000)); // 10-minute TTL

    sheet.appendRow([
        String(doctorId).trim(),
        String(dateString).trim(),
        String(timeString).trim(),
        String(patientPhone).trim(),
        now,
        expiresAt
    ]);

    return {
        reserved: true,
        expiresAt: expiresAt
    };
}



// Check if a slot is reserved by a different patient
// Returns: {isReserved: bool, reservedByPhone: string}
function isSlotReservedByOther(
    doctorId,
    dateString,
    timeString,
    patientPhone
) {

    if (
        !doctorId || !dateString ||
        !timeString || !patientPhone
    ) {

        return { isReserved: false };
    }

    const sheet =
        ensureSlotReservationSheet();

    const data = sheet.getDataRange().getValues();
    const now = new Date();
    const normalizedPhone =
        String(patientPhone).trim();
    const normalizedDoctor =
        String(doctorId).trim();
    const normalizedDate =
        String(dateString).trim();
    const normalizedTime =
        String(timeString).trim();

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        const reservedDoctor =
            String(data[i][0] || "").trim();

        const reservedDate =
            String(data[i][1] || "").trim();

        const reservedTime =
            String(data[i][2] || "").trim();

        const reservedPhone =
            String(data[i][3] || "").trim();

        const expiresAt =
            new Date(data[i][5]);

        // Skip expired reservations
        if (now > expiresAt) {
            continue;
        }

        // Check if this slot matches and belongs to someone else
        if (
            reservedDoctor === normalizedDoctor &&
            reservedDate === normalizedDate &&
            reservedTime === normalizedTime &&
            reservedPhone !== normalizedPhone
        ) {

            return {
                isReserved: true,
                reservedByPhone: reservedPhone
            };
        }
    }

    return { isReserved: false };
}



// Clear a patient's reservation for a slot
function clearSlotReservation(
    doctorId,
    dateString,
    timeString,
    patientPhone
) {

    if (
        !doctorId || !dateString ||
        !timeString || !patientPhone
    ) {

        return false;
    }

    const sheet =
        ensureSlotReservationSheet();

    const data = sheet.getDataRange().getValues();
    const normalizedPhone =
        String(patientPhone).trim();
    const normalizedDoctor =
        String(doctorId).trim();
    const normalizedDate =
        String(dateString).trim();
    const normalizedTime =
        String(timeString).trim();

    // Delete in reverse order to avoid row number shifts
    const rowsToDelete = [];

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        const reservedDoctor =
            String(data[i][0] || "").trim();

        const reservedDate =
            String(data[i][1] || "").trim();

        const reservedTime =
            String(data[i][2] || "").trim();

        const reservedPhone =
            String(data[i][3] || "").trim();

        if (
            reservedDoctor === normalizedDoctor &&
            reservedDate === normalizedDate &&
            reservedTime === normalizedTime &&
            reservedPhone === normalizedPhone
        ) {

            rowsToDelete.push(i + 1);
        }
    }

    for (
        let j = rowsToDelete.length - 1;
        j >= 0;
        j--
    ) {

        sheet.deleteRow(rowsToDelete[j]);
    }

    return rowsToDelete.length > 0;
}



// Clean up expired slot reservations (call periodically)
function cleanupExpiredSlotReservations() {

    const sheet =
        ensureSlotReservationSheet();

    const data = sheet.getDataRange().getValues();
    const now = new Date();
    const rowsToDelete = [];

    for (
        let i = data.length - 1;
        i >= 1;
        i--
    ) {

        const expiresAt = new Date(data[i][5]);

        if (now > expiresAt) {
            rowsToDelete.push(i + 1);
        }
    }

    // Delete in reverse order
    for (const row of rowsToDelete) {
        sheet.deleteRow(row);
    }

    return rowsToDelete.length;
}
