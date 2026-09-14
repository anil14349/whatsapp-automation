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
            "Patient Location",
            "Preferred Date",
            "Time Window",
            "Status",
            "Created At",
            "Accepted By",
            "Accepted At",
            "Completed By",
            "Completed At"
        ]);
    } else {

        // Existing installations may already have the original 10-column
        // Home_Collection_Requests sheet. Add the Maps link column once.
        const headers = sheet
            .getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1))
            .getValues()[0]
            .map(function(value) {
                return String(value || "").trim();
            });

        if (headers.indexOf("Patient Location") === -1) {
            const distanceIndex = headers.indexOf("Distance (km)");
            const insertColumn =
                distanceIndex >= 0
                    ? distanceIndex + 2
                    : sheet.getLastColumn() + 1;

            sheet.insertColumnBefore(insertColumn);
            sheet.getRange(1, insertColumn).setValue("Patient Location");
        }

        ["Accepted By", "Accepted At", "Completed By", "Completed At"].forEach(function(header) {
            const currentHeaders = sheet
                .getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1))
                .getValues()[0]
                .map(function(value) { return String(value || "").trim(); });
            if (currentHeaders.indexOf(header) === -1) {
                sheet.getRange(1, sheet.getLastColumn() + 1).setValue(header);
            }
        });
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

    const phone =
        String(details.phone || "").trim();

    if (!phone) {
        throw new Error(
            "Cannot create home collection request: phone number is missing"
        );
    }

    const sheet =
        ensureHomeCollectionSheet();

    // The duplicate check and row creation must be atomic. Otherwise two
    // near-simultaneous WhatsApp requests can both pass the check.
    const lock = LockService.getScriptLock();
    lock.waitLock(15000);

    let requestId = "";
    let duplicateRequest = null;
    let mapsUrl = "";

    try {
        duplicateRequest =
            findActiveHomeCollectionRequestByPhone(phone, sheet);

        if (duplicateRequest) {
            return {
                success: false,
                duplicate: true,
                requestId: duplicateRequest.requestId,
                existingRequest: duplicateRequest
            };
        }

        requestId =
            generateHomeCollectionRequestId();

        const latitude = details.latitude;
        const longitude = details.longitude;
        mapsUrl =
            latitude !== undefined && latitude !== null &&
            longitude !== undefined && longitude !== null &&
            String(latitude).trim() !== "" &&
            String(longitude).trim() !== ""
                ? "https://www.google.com/maps?q=" +
                  encodeURIComponent(String(latitude).trim() + "," + String(longitude).trim())
                : "";

        sheet.appendRow([
            requestId,
            phone,
            String(details.patientName || ""),
            latitude,
            longitude,
            details.distanceKm,
            mapsUrl,
            String(details.date || ""),
            String(details.timeWindow || ""),
            "Pending",
            new Date(),
            "",
            "",
            "",
            ""
        ]);
    } finally {
        lock.releaseLock();
    }

    if (isHomeCollectionNotificationsEnabled()) {
        notifyHomeCollectionPersons(
            requestId,
            {
                phone: phone,
                patientName: String(details.patientName || ""),
                distanceKm: details.distanceKm,
                mapsUrl: mapsUrl,
                date: String(details.date || ""),
                timeWindow: String(details.timeWindow || "")
            }
        );
    }

    return {
        success: true,
        duplicate: false,
        requestId: requestId
    };
}
