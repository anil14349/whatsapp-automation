// ============================================================
// Model_HomeCollection — part of the ABC Clinic WhatsApp bot
// Home_Collection_Requests sheet (home blood-sample-collection
// requests). See src/Config.gs for the full file-layout map and
// Script Properties.
// ============================================================



function ensureHomeCollectionSheet() {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    let sheet =
        ss.getSheetByName("Home_Collection_Requests");

    if (!sheet) {

        sheet =
            ss.insertSheet("Home_Collection_Requests");

        sheet.appendRow([
            "Request ID",
            "Phone",
            "Patient Name",
            "Latitude",
            "Longitude",
            "Distance (km)",
            "Preferred Date",
            "Time Window",
            "Status",
            "Created At"
        ]);
    }

    return sheet;
}



function generateHomeCollectionRequestId() {

    return (
        "HC" +
        Utilities.formatDate(
            new Date(),
            TIMEZONE,
            "yyMMddHHmmss"
        )
    );
}



// Appends a new home-collection request row. Status starts "Pending" —
// a staff member follows up by phone to confirm the exact visit time
// (this flow only captures a preferred date + time window, not a
// bookable slot; see the "Simple request" design decision).
function createHomeCollectionRequest(details) {

    const sheet =
        ensureHomeCollectionSheet();

    const requestId =
        generateHomeCollectionRequestId();

    sheet.appendRow([
        requestId,
        String(details.phone || ""),
        String(details.patientName || ""),
        details.latitude,
        details.longitude,
        details.distanceKm,
        String(details.date || ""),
        String(details.timeWindow || ""),
        "Pending",
        new Date()
    ]);

    return requestId;
}
