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


// Ported from ABC_Clinic_WhatsApp_Complete.gs (monolith is the source of truth).
function findActiveHomeCollectionRequestByPhone(phone, sheet) {

    const normalizedPhone =
        normalizeWhatsAppPhone(phone);

    if (!normalizedPhone) return null;

    const targetSheet =
        sheet || ensureHomeCollectionSheet();

    const map =
        getHomeCollectionRequestSheetColumnMap(targetSheet);

    const data =
        targetSheet.getDataRange().getValues();

    for (let i = data.length - 1; i >= 1; i--) {

        const rowPhone =
            String(data[i][map["Phone"] - 1] || "").trim();

        if (!phonesMatch(normalizedPhone, rowPhone)) continue;

        const status =
            String(data[i][map["Status"] - 1] || "Pending")
                .trim()
                .toLowerCase();

        // Only outstanding requests block a new request.
        // Completed/cancelled requests do not block future collections.
        if (status === "pending" || status === "accepted") {
            return getHomeCollectionRequestByRow(i + 1);
        }
    }

    return null;
}


// Ported from ABC_Clinic_WhatsApp_Complete.gs (monolith is the source of truth).
function cancelHomeCollectionRequestByPatient(requestId, patientPhone) {
    const targetId = String(requestId || "").trim();
    const targetPhone = normalizeWhatsAppPhone(patientPhone);
    if (!targetId || !targetPhone) {
        return { ok: false, reason: "not_found" };
    }

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) {
        return { ok: false, reason: "busy" };
    }

    let cancelledRequest = null;
    let result = null;

    try {
        const sheet = ensureHomeCollectionSheet();
        const map = getHomeCollectionRequestSheetColumnMap(sheet);
        const data = sheet.getDataRange().getValues();

        for (let i = 1; i < data.length; i++) {
            const requestIdValue =
                String(data[i][map["Request ID"] - 1] || "").trim();

            if (!requestIdValue || requestIdValue.toLowerCase() !== targetId.toLowerCase()) {
                continue;
            }

            const rowNumber = i + 1;
            const phone = String(data[i][map["Phone"] - 1] || "").trim();

            if (!phonesMatch(phone, targetPhone)) {
                result = { ok: false, reason: "not_authorized" };
                break;
            }

            const status =
                String(data[i][map["Status"] - 1] || "Pending").trim().toLowerCase();

            if (status === "completed") {
                result = { ok: false, reason: "already_completed" };
                break;
            }

            if (status === "cancelled") {
                result = { ok: false, reason: "already_cancelled" };
                break;
            }

            if (status !== "pending" && status !== "accepted") {
                result = { ok: false, reason: "not_active" };
                break;
            }

            // Capture the authoritative record, including Accepted By, before
            // changing the status so an assigned collector can be notified.
            cancelledRequest = getHomeCollectionRequestByRow(rowNumber);
            sheet.getRange(rowNumber, map["Status"]).setValue("Cancelled");

            result = {
                ok: true,
                requestId: requestIdValue
            };
            break;
        }

        if (!result) {
            result = { ok: false, reason: "not_found" };
        }
    } catch (error) {
        Logger.log("cancelHomeCollectionRequestByPatient failed: " + error.message);
        result = { ok: false, reason: "error" };
    } finally {
        lock.releaseLock();
    }

    // Notify only the assigned collector. Pending/unassigned requests need no
    // collector notification, while an accepted request should immediately
    // release the collector from any expected collection action.
    if (result && result.ok && cancelledRequest && cancelledRequest.acceptedBy) {
        notifyHomeCollectionCancellationToCollector(cancelledRequest);
    }

    return result;
}


// Ported from ABC_Clinic_WhatsApp_Complete.gs (monolith is the source of truth).
function getHomeCollectionTimeWindowOptionsForDate(dateString) {

    const options =
        getHomeCollectionTimeWindowOptions();

    if (!dateString) {
        return options;
    }

    const todayString =
        Utilities.formatDate(
            new Date(),
            TIMEZONE,
            "yyyy-MM-dd"
        );

    // Future dates have the full set of time windows available.
    if (String(dateString) !== todayString) {
        return options;
    }

    const now = new Date();
    const currentTime =
        Utilities.formatDate(
            now,
            TIMEZONE,
            "HH:mm"
        );

    const parts = currentTime.split(":");
    const currentMinutes =
        Number(parts[0]) * 60 + Number(parts[1]);

    const minimumStartMinutes =
        currentMinutes +
        Math.ceil(getHomeCollectionMinLeadHours() * 60);

    return options.filter(function (option) {
        return option.startMinutes >= minimumStartMinutes;
    });
}


// Ported from ABC_Clinic_WhatsApp_Complete.gs (monolith is the source of truth).
function getHomeCollectionMinLeadHours() {

    const hours =
        Number(
            getSetting("HOME_COLLECTION_MIN_LEAD_HOURS", "2")
        );

    return (
        isFinite(hours) &&
        hours >= 0
    )
        ? hours
        : 2;
}


// Ported from ABC_Clinic_WhatsApp_Complete.gs (monolith is the source of truth).
function rescheduleHomeCollectionRequestByPatient(requestId, patientPhone, newDate, newTimeWindow) {
    const targetId = String(requestId || "").trim();
    const targetPhone = normalizeWhatsAppPhone(patientPhone);
    const dateValue = String(newDate || "").trim();
    const timeValue = String(newTimeWindow || "").trim();

    if (!targetId || !targetPhone || !dateValue || !timeValue) {
        return { ok: false, reason: "invalid_request" };
    }

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) {
        return { ok: false, reason: "busy" };
    }

    let updatedRequest = null;
    let failureReason = "not_found";

    try {
        const sheet = ensureHomeCollectionSheet();
        const map = getHomeCollectionRequestSheetColumnMap(sheet);
        const required = ["Request ID", "Phone", "Preferred Date", "Time Window", "Status"];

        for (const header of required) {
            if (!map[header]) {
                return { ok: false, reason: "schema_missing", header: header };
            }
        }

        const lastRow = sheet.getLastRow();
        if (lastRow < 2) {
            return { ok: false, reason: "not_found" };
        }

        const columnCount = sheet.getLastColumn();
        const data = sheet.getRange(2, 1, lastRow - 1, columnCount).getValues();

        for (let i = 0; i < data.length; i++) {
            const rowNumber = i + 2;
            const requestIdValue = String(
                data[i][map["Request ID"] - 1] || ""
            ).trim();

            if (!requestIdValue || requestIdValue.toLowerCase() !== targetId.toLowerCase()) {
                continue;
            }

            const phone = String(
                data[i][map["Phone"] - 1] || ""
            ).trim();

            if (!phonesMatch(phone, targetPhone)) {
                return { ok: false, reason: "not_authorized" };
            }

            const status = String(
                data[i][map["Status"] - 1] || "Pending"
            ).trim().toLowerCase();

            if (status === "completed") {
                return { ok: false, reason: "already_completed" };
            }

            if (status === "cancelled" || status === "canceled") {
                return { ok: false, reason: "already_cancelled" };
            }

            if (status !== "pending" && status !== "accepted") {
                return { ok: false, reason: "not_active" };
            }

            // Update the existing request row only. The patient location,
            // Request ID, creation time and collector assignment stay unchanged.
            sheet.getRange(rowNumber, map["Preferred Date"]).setValue(dateValue);
            sheet.getRange(rowNumber, map["Time Window"]).setValue(timeValue);
            SpreadsheetApp.flush();

            // Build the result from the same authoritative row context instead
            // of performing a second lookup that can incorrectly turn a
            // successful update into a generic "not found" failure.
            updatedRequest = {
                row: rowNumber,
                requestId: requestIdValue,
                phone: phone,
                patientName: map["Patient Name"]
                    ? String(data[i][map["Patient Name"] - 1] || "").trim()
                    : "",
                latitude: map["Latitude"]
                    ? data[i][map["Latitude"] - 1]
                    : "",
                longitude: map["Longitude"]
                    ? data[i][map["Longitude"] - 1]
                    : "",
                mapsUrl: map["Patient Location"]
                    ? String(data[i][map["Patient Location"] - 1] || "").trim()
                    : "",
                distanceKm: map["Distance (km)"]
                    ? Number(data[i][map["Distance (km)"] - 1] || 0)
                    : 0,
                date: dateValue,
                timeWindow: timeValue,
                status: status === "accepted" ? "Accepted" : "Pending",
                acceptedBy: map["Accepted By"]
                    ? String(data[i][map["Accepted By"] - 1] || "").trim()
                    : "",
                acceptedAt: map["Accepted At"]
                    ? data[i][map["Accepted At"] - 1]
                    : "",
                completedBy: map["Completed By"]
                    ? String(data[i][map["Completed By"] - 1] || "").trim()
                    : "",
                completedAt: map["Completed At"]
                    ? data[i][map["Completed At"] - 1]
                    : ""
            };

            failureReason = "";
            break;
        }
    } catch (error) {
        Logger.log(
            "rescheduleHomeCollectionRequestByPatient failed: " +
            error.message +
            " | requestId=" + targetId +
            " | phone=" + targetPhone
        );
        failureReason = "error";
    } finally {
        lock.releaseLock();
    }

    if (!updatedRequest) {
        return { ok: false, reason: failureReason || "not_found" };
    }

    // Pending requests: notify all active collectors that the preferred
    // date/time changed, so no one is left with stale WhatsApp details.
    // Accepted requests: notify only the assigned collector.
    if (isHomeCollectionNotificationsEnabled()) {
        const people = getActiveHomeCollectionPersons();
        const recipients = updatedRequest.acceptedBy
            ? people.filter(function (person) {
                return String(person.personId || "").trim() ===
                    String(updatedRequest.acceptedBy || "").trim();
            })
            : people;

        recipients.forEach(function (person) {
            try {
                const body =
                    "🔄 Home Sample Collection Rescheduled\n\n" +
                    "Request: " + updatedRequest.requestId + "\n" +
                    "👤 " + (updatedRequest.patientName || "Patient") + "\n" +
                    "📅 " + updatedRequest.date + "\n" +
                    "🕐 " + updatedRequest.timeWindow + "\n" +
                    "📍 Patient location:\n" +
                    (updatedRequest.mapsUrl || "Location unavailable") +
                    (updatedRequest.acceptedBy
                        ? "\n\nThis request remains assigned to you."
                        : "\n\nPlease review the updated date/time and accept the request if you can take it.");

                sendWhatsAppMenuReply(
                    SpreadsheetApp.getActiveSpreadsheet(),
                    person.whatsapp,
                    body,
                    {
                        fallbackText: body,
                        interactive: buildInteractiveButtonSpec([
                            {
                                id: "hc_view_row_" + updatedRequest.row,
                                title: "View Details"
                            },
                            {
                                id: "nav_main_menu",
                                title: "Main Menu"
                            }
                        ])
                    }
                );
            } catch (error) {
                Logger.log(
                    "Home collection reschedule notification failed for " +
                    person.personId + ": " + error.message
                );
            }
        });
    }

    return {
        ok: true,
        requestId: updatedRequest.requestId,
        date: updatedRequest.date,
        timeWindow: updatedRequest.timeWindow
    };
}


// Ported from ABC_Clinic_WhatsApp_Complete.gs (monolith is the source of truth).
function findHomeCollectionPersonByWhatsAppPhone(phone) {
    const sheet = ensureHomeCollectionPersonsSheet();
    const target = normalizeWhatsAppPhone(phone);
    if (!target) return { found: false, error: "invalid_phone" };
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
        const personId = String(data[i][0] || "").trim();
        const name = String(data[i][1] || "").trim();
        const whatsapp = String(data[i][2] || "").trim();
        const active = String(data[i][3] || "").trim().toUpperCase();
        if (personId && name && whatsapp && active === "YES" &&
            normalizeWhatsAppPhone(whatsapp) === target) {
            return { found: true, personId: personId, name: name, whatsapp: whatsapp };
        }
    }
    return { found: false, error: "not_found" };
}


// Ported from ABC_Clinic_WhatsApp_Complete.gs (monolith is the source of truth).
function isHomeCollectionNotificationsEnabled() {
    return String(getSetting("ENABLE_HOME_COLLECTION_NOTIFICATIONS", "TRUE"))
        .trim().toUpperCase() === "TRUE";
}


// Ported from ABC_Clinic_WhatsApp_Complete.gs (monolith is the source of truth).
function ensureWhatsAppSessionHomeCollectionRequestIdColumn(sheet) {

    if (!sheet.getRange(1, 16).getValue()) {
        sheet
            .getRange(1, 16)
            .setValue("Home Collection Request ID");
    }
}


// Ported from ABC_Clinic_WhatsApp_Complete.gs (monolith is the source of truth).
function getHomeCollectionRequestsForCollector(includeCompleted, collectorPersonId) {
    const sheet = ensureHomeCollectionSheet();
    const map = getHomeCollectionRequestSheetColumnMap(sheet);
    const data = sheet.getDataRange().getValues();
    const requests = [];
    for (let i = 1; i < data.length; i++) {
        const status = String(data[i][map["Status"] - 1] || "Pending").trim();
        const acceptedBy = map["Accepted By"]
            ? String(data[i][map["Accepted By"] - 1] || "").trim()
            : "";
        const requestedCollector = String(collectorPersonId || "").trim();

        // Unassigned requests are visible to all active collectors.
        // Once accepted, the request is visible only to its assigned collector.
        if (requestedCollector && acceptedBy && acceptedBy !== requestedCollector) continue;
        if (!requestedCollector && acceptedBy) continue;
        const normalizedStatus = status.toLowerCase();
        // Active collector queues must never show completed or cancelled
        // home-collection requests. Completed/cancelled records may still
        // remain available when includeCompleted=true for history/audit views.
        if (!includeCompleted && (normalizedStatus === "completed" || normalizedStatus === "cancelled")) continue;
        requests.push({
            row: i + 1,
            requestId: String(data[i][map["Request ID"] - 1] || "").trim(),
            phone: String(data[i][map["Phone"] - 1] || "").trim(),
            patientName: String(data[i][map["Patient Name"] - 1] || "").trim(),
            latitude: data[i][map["Latitude"] - 1],
            longitude: data[i][map["Longitude"] - 1],
            mapsUrl: String(data[i][map["Patient Location"] - 1] || "").trim(),
            distanceKm: Number(data[i][map["Distance (km)"] - 1] || 0),
            date: formatHomeCollectionDate(data[i][map["Preferred Date"] - 1]),
            timeWindow: String(data[i][map["Time Window"] - 1] || "").trim(),
            status: status,
            acceptedBy: map["Accepted By"] ? String(data[i][map["Accepted By"] - 1] || "").trim() : "",
            acceptedAt: map["Accepted At"] ? data[i][map["Accepted At"] - 1] : "",
            completedBy: map["Completed By"] ? String(data[i][map["Completed By"] - 1] || "").trim() : "",
            completedAt: map["Completed At"] ? data[i][map["Completed At"] - 1] : ""
        });
    }
    requests.sort(function(a,b) {
        return (a.date + " " + a.timeWindow).localeCompare(b.date + " " + b.timeWindow);
    });
    return requests;
}


// Ported from ABC_Clinic_WhatsApp_Complete.gs (monolith is the source of truth).
function acceptHomeCollectionRequestByRow(rowNumber, collectorPersonId) {
    const row = Number(rowNumber);
    if (!row || row < 2) return { ok: false, reason: "not_found" };

    const lock = LockService.getScriptLock();
    try {
        lock.waitLock(10000);

        const sheet = ensureHomeCollectionSheet();
        const map = getHomeCollectionRequestSheetColumnMap(sheet);
        if (!map["Request ID"] || !map["Status"] || !map["Accepted By"] || !map["Accepted At"]) {
            return { ok: false, reason: "schema_missing" };
        }
        if (row > sheet.getLastRow()) return { ok: false, reason: "not_found" };

        // Re-read the authoritative row while holding the lock.
        const request = getHomeCollectionRequestByRow(row);
        if (!request) return { ok: false, reason: "not_found" };

        const status = String(
            sheet.getRange(row, map["Status"]).getValue() || "Pending"
        ).trim().toLowerCase();
        const acceptedBy = String(
            sheet.getRange(row, map["Accepted By"]).getValue() || ""
        ).trim();
        const personId = String(collectorPersonId || "").trim();

        if (status === "completed") {
            return { ok: false, reason: "already_completed", request: request };
        }

        if (acceptedBy) {
            return {
                ok: false,
                reason: acceptedBy === personId
                    ? "already_accepted_by_self"
                    : "already_accepted",
                request: request
            };
        }

        sheet.getRange(row, map["Status"]).setValue("Accepted");
        sheet.getRange(row, map["Accepted By"]).setValue(personId);
        sheet.getRange(row, map["Accepted At"]).setValue(new Date());

        return {
            ok: true,
            request: getHomeCollectionRequestByRow(row)
        };
    } catch (error) {
        Logger.log("acceptHomeCollectionRequestByRow failed: " + error.message);
        return { ok: false, reason: "error" };
    } finally {
        try { lock.releaseLock(); } catch (e) {}
    }
}


// Ported from ABC_Clinic_WhatsApp_Complete.gs (monolith is the source of truth).
function getHomeCollectionRequestByRow(rowNumber) {
    const row = Number(rowNumber);
    if (!row || row < 2) return null;

    const sheet = ensureHomeCollectionSheet();
    const map = getHomeCollectionRequestSheetColumnMap(sheet);
    if (row > sheet.getLastRow()) return null;

    const values = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
    const requestId = String(values[map["Request ID"] - 1] || "").trim();
    if (!requestId) return null;

    return {
        row: row,
        requestId: requestId,
        phone: String(values[map["Phone"] - 1] || "").trim(),
        patientName: String(values[map["Patient Name"] - 1] || "").trim(),
        latitude: values[map["Latitude"] - 1],
        longitude: values[map["Longitude"] - 1],
        mapsUrl: map["Patient Location"] ? String(values[map["Patient Location"] - 1] || "").trim() : "",
        distanceKm: Number(values[map["Distance (km)"] - 1] || 0),
        date: formatHomeCollectionDate(values[map["Preferred Date"] - 1]),
        timeWindow: String(values[map["Time Window"] - 1] || "").trim(),
        status: String(values[map["Status"] - 1] || "Pending").trim(),
        acceptedBy: map["Accepted By"] ? String(values[map["Accepted By"] - 1] || "").trim() : "",
        acceptedAt: map["Accepted At"] ? values[map["Accepted At"] - 1] : "",
        completedBy: map["Completed By"] ? String(values[map["Completed By"] - 1] || "").trim() : "",
        completedAt: map["Completed At"] ? values[map["Completed At"] - 1] : ""
    };
}


// Ported from ABC_Clinic_WhatsApp_Complete.gs (monolith is the source of truth).
function getHomeCollectionRequestById(requestId) {
    const target = String(requestId || "").trim();
    if (!target) return null;
    const requests = getHomeCollectionRequestsForCollector(true);
    const exact = requests.find(function(r) { return r.requestId === target; });
    if (exact) return exact;

    // Be tolerant of casing/whitespace changes introduced by a transport layer.
    const folded = target.toLowerCase();
    return requests.find(function(r) { return r.requestId.toLowerCase() === folded; }) || null;
}


// Ported from ABC_Clinic_WhatsApp_Complete.gs (monolith is the source of truth).
function markHomeCollectionRequestCompletedByRow(rowNumber, collectorName, collectorPersonId) {
    const row = Number(rowNumber);
    if (!row || row < 2) return { ok: false, reason: "not_found" };

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) {
        return { ok: false, reason: "busy" };
    }

    try {
        const sheet = ensureHomeCollectionSheet();
        const map = getHomeCollectionRequestSheetColumnMap(sheet);
        if (!map["Request ID"] || !map["Status"]) {
            return { ok: false, reason: "not_found" };
        }
        if (row > sheet.getLastRow()) return { ok: false, reason: "not_found" };

        const requestId = String(sheet.getRange(row, map["Request ID"]).getValue() || "").trim();
        if (!requestId) return { ok: false, reason: "not_found" };

        const status = String(sheet.getRange(row, map["Status"]).getValue() || "Pending").trim();
        if (status.toLowerCase() === "completed") {
            return { ok: false, reason: "already_completed", requestId: requestId };
        }

        if (status.toLowerCase() !== "accepted") {
            return { ok: false, reason: "not_accepted", requestId: requestId };
        }

        const acceptedBy = map["Accepted By"]
            ? String(sheet.getRange(row, map["Accepted By"]).getValue() || "").trim()
            : "";
        if (!acceptedBy) return { ok: false, reason: "not_accepted", requestId: requestId };
        if (collectorPersonId && acceptedBy !== String(collectorPersonId)) {
            return { ok: false, reason: "assigned_to_other", requestId: requestId };
        }

        sheet.getRange(row, map["Status"]).setValue("Completed");
        if (map["Completed By"]) {
            sheet.getRange(row, map["Completed By"]).setValue(String(collectorName || ""));
        }
        if (map["Completed At"]) {
            sheet.getRange(row, map["Completed At"]).setValue(new Date());
        }
        SpreadsheetApp.flush();

        return { ok: true, requestId: requestId };
    } catch (error) {
        Logger.log("markHomeCollectionRequestCompletedByRow failed: " + error.message);
        return { ok: false, reason: "error" };
    } finally {
        lock.releaseLock();
    }
}


// Ported from ABC_Clinic_WhatsApp_Complete.gs (monolith is the source of truth).
function markHomeCollectionRequestCompleted(requestId, collectorName, collectorPersonId) {
    const target = String(requestId || "").trim();
    if (!target) return { ok: false, reason: "not_found" };

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) {
        return { ok: false, reason: "busy" };
    }

    try {
        const sheet = ensureHomeCollectionSheet();
        const map = getHomeCollectionRequestSheetColumnMap(sheet);
        const data = sheet.getDataRange().getValues();

        for (let i = 1; i < data.length; i++) {
            if (String(data[i][map["Request ID"] - 1] || "").trim() !== target) continue;

            const status = String(data[i][map["Status"] - 1] || "Pending").trim();
            if (status.toLowerCase() === "completed") return { ok: false, reason: "already_completed" };
            if (status.toLowerCase() !== "accepted") return { ok: false, reason: "not_accepted" };

            const acceptedBy = map["Accepted By"]
                ? String(data[i][map["Accepted By"] - 1] || "").trim()
                : "";
            if (!acceptedBy) return { ok: false, reason: "not_accepted" };
            if (collectorPersonId && acceptedBy !== String(collectorPersonId)) {
                return { ok: false, reason: "assigned_to_other" };
            }

            const rowNumber = i + 1;
            sheet.getRange(rowNumber, map["Status"]).setValue("Completed");
            if (map["Completed By"]) sheet.getRange(rowNumber, map["Completed By"]).setValue(String(collectorName || ""));
            if (map["Completed At"]) sheet.getRange(rowNumber, map["Completed At"]).setValue(new Date());
            SpreadsheetApp.flush();
            return { ok: true, requestId: target };
        }

        return { ok: false, reason: "not_found" };
    } catch (error) {
        Logger.log("markHomeCollectionRequestCompleted failed: " + error.message);
        return { ok: false, reason: "error" };
    } finally {
        lock.releaseLock();
    }
}


// Ported from ABC_Clinic_WhatsApp_Complete.gs (monolith is the source of truth).
function getActiveHomeCollectionPersons() {
    const sheet = ensureHomeCollectionPersonsSheet();
    const data = sheet.getDataRange().getValues();
    const people = [];
    for (let i = 1; i < data.length; i++) {
        if (String(data[i][0] || "").trim() &&
            String(data[i][1] || "").trim() &&
            String(data[i][2] || "").trim() &&
            String(data[i][3] || "").trim().toUpperCase() === "YES") {
            people.push({
                personId: String(data[i][0]).trim(),
                name: String(data[i][1]).trim(),
                whatsapp: String(data[i][2]).trim()
            });
        }
    }
    return people;
}


// Ported from ABC_Clinic_WhatsApp_Complete.gs (monolith is the source of truth).
function getHomeCollectionRequestSheetColumnMap(sheet) {
    const headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1))
        .getValues()[0].map(function(v) { return String(v || "").trim(); });
    const map = {};
    headers.forEach(function(h, i) { if (h) map[h] = i + 1; });
    return map;
}


// Ported from ABC_Clinic_WhatsApp_Complete.gs (monolith is the source of truth).
function getHomeCollectionTimeWindowOptions() {

    return [
        {
            id: "1",
            title: "Morning: 8AM–12PM",
            description: "8 AM - 12 PM",
            value: "Morning (8 AM - 12 PM)",
            startMinutes: 8 * 60
        },
        {
            id: "2",
            title: "Afternoon: 12–4PM",
            description: "12 PM - 4 PM",
            value: "Afternoon (12 PM - 4 PM)",
            startMinutes: 12 * 60
        },
        {
            id: "3",
            title: "Evening: 4–8PM",
            description: "4 PM - 8 PM",
            value: "Evening (4 PM - 8 PM)",
            startMinutes: 16 * 60
        }
    ];
}


// Ported from ABC_Clinic_WhatsApp_Complete.gs (monolith is the source of truth).
function ensureHomeCollectionPersonsSheet() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName("Home_Collection_Persons");
    if (!sheet) {
        sheet = ss.insertSheet("Home_Collection_Persons");
        sheet.appendRow(["Person ID", "Name", "WhatsApp", "Active"]);
    }
    return sheet;
}


// Ported from ABC_Clinic_WhatsApp_Complete.gs (monolith is the source of truth).
function createDailyHomeCollectionArchiveTask(hourOfDay, minuteOfHour) {

    const hour = hourOfDay === undefined || hourOfDay === null ? 1 : Number(hourOfDay);
    const minute = minuteOfHour === undefined || minuteOfHour === null ? 0 : Number(minuteOfHour);

    if (!isFinite(hour) || hour < 0 || hour > 23 || !isFinite(minute) || minute < 0 || minute > 59) {
        return {
            success: false,
            message: "Invalid time: hour must be 0-23 and minute must be 0-59"
        };
    }

    deleteTriggersByHandler(["archivePreviousDayHomeCollectionRequests"]);

    ScriptApp.newTrigger("archivePreviousDayHomeCollectionRequests")
        .timeBased()
        .atHour(Math.floor(hour))
        .everyDays(1)
        .create();

    Logger.log(
        "createDailyHomeCollectionArchiveTask: Created daily trigger around " +
        String(Math.floor(hour)).padStart(2, "0") + ":00 (minute " +
        String(Math.floor(minute)).padStart(2, "0") + " advisory)"
    );

    return {
        success: true,
        message: "Daily home collection archive scheduled around " +
            String(Math.floor(hour)).padStart(2, "0") + ":00 (minute " +
            String(Math.floor(minute)).padStart(2, "0") + " is advisory)"
    };
}


// Ported from ABC_Clinic_WhatsApp_Complete.gs (monolith is the source of truth).
function ensureHomeCollectionHistorySheet() {

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName("Home_Collection_History");

    if (!sheet) {
        sheet = ss.insertSheet("Home_Collection_History");
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
            "Completed At",
            "Archived At"
        ]);
        sheet.hideSheet();
    } else {
        const headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1))
            .getValues()[0]
            .map(function(v) { return String(v || "").trim(); });

        ["Accepted By", "Accepted At", "Archived At"].forEach(function(header) {
            const currentHeaders = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1))
                .getValues()[0].map(function(v) { return String(v || "").trim(); });
            if (currentHeaders.indexOf(header) === -1) {
                sheet.getRange(1, sheet.getLastColumn() + 1).setValue(header);
            }
        });
    }

    return sheet;
}


// Ported from ABC_Clinic_WhatsApp_Complete.gs (monolith is the source of truth).
function archivePreviousDayHomeCollectionRequests() {

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sourceSheet = ss.getSheetByName("Home_Collection_Requests");

    if (!sourceSheet) {
        return {
            success: false,
            message: "Home_Collection_Requests sheet not found"
        };
    }

    const historySheet = ensureHomeCollectionHistorySheet();
    const sourceMap = getHomeCollectionRequestSheetColumnMap(sourceSheet);

    const requiredHeaders = [
        "Request ID", "Phone", "Patient Name", "Latitude", "Longitude",
        "Distance (km)", "Patient Location", "Preferred Date", "Time Window",
        "Status", "Created At", "Completed By", "Completed At"
    ];

    for (const header of requiredHeaders) {
        if (!sourceMap[header]) {
            return {
                success: false,
                message: "Missing Home_Collection_Requests column: " + header
            };
        }
    }

    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayIso = Utilities.formatDate(yesterday, TIMEZONE, "yyyy-MM-dd");

    const sourceData = sourceSheet.getDataRange().getValues();
    const historyData = historySheet.getDataRange().getValues();
    const archivedIds = {};

    for (let i = 1; i < historyData.length; i++) {
        const id = String(historyData[i][0] || "").trim();
        if (id) archivedIds[id] = true;
    }

    const rowsToDelete = [];
    const rowsToArchive = [];
    const skippedNonCompleted = [];
    const skippedAlreadyArchived = [];
    const archivedAt = new Date();

    // Archive completed requests whose preferred collection date is yesterday
    // or earlier. This is intentionally terminal-only and non-destructive until
    // the archive write succeeds.
    for (let i = sourceData.length - 1; i >= 1; i--) {
        const requestId = String(sourceData[i][sourceMap["Request ID"] - 1] || "").trim();
        if (!requestId) continue;

        const status = String(sourceData[i][sourceMap["Status"] - 1] || "Pending").trim();
        if (status.toLowerCase() !== "completed") {
            skippedNonCompleted.push({ requestId: requestId, row: i + 1, status: status });
            continue;
        }

        const preferredDate = formatHomeCollectionDate(
            sourceData[i][sourceMap["Preferred Date"] - 1]
        );

        if (!preferredDate || preferredDate > yesterdayIso) continue;

        if (archivedIds[requestId]) {
            skippedAlreadyArchived.push({ requestId: requestId, row: i + 1 });
            continue;
        }

        rowsToArchive.push([
            sourceData[i][sourceMap["Request ID"] - 1],
            sourceData[i][sourceMap["Phone"] - 1],
            sourceData[i][sourceMap["Patient Name"] - 1],
            sourceData[i][sourceMap["Latitude"] - 1],
            sourceData[i][sourceMap["Longitude"] - 1],
            sourceData[i][sourceMap["Distance (km)"] - 1],
            sourceData[i][sourceMap["Patient Location"] - 1],
            sourceData[i][sourceMap["Preferred Date"] - 1],
            sourceData[i][sourceMap["Time Window"] - 1],
            status,
            sourceData[i][sourceMap["Created At"] - 1],
            sourceData[i][sourceMap["Accepted By"] - 1],
            sourceData[i][sourceMap["Accepted At"] - 1],
            sourceData[i][sourceMap["Completed By"] - 1],
            sourceData[i][sourceMap["Completed At"] - 1],
            archivedAt
        ]);
        rowsToDelete.push(i + 1);
        archivedIds[requestId] = true;
    }

    if (rowsToArchive.length > 0) {
        const firstRow = Math.max(historySheet.getLastRow() + 1, 2);
        historySheet.getRange(
            firstRow,
            1,
            rowsToArchive.length,
            rowsToArchive[0].length
        ).setValues(rowsToArchive);

        // Delete only after the history write has succeeded.
        for (const row of rowsToDelete) {
            sourceSheet.deleteRow(row);
        }
    }

    Logger.log(
        "archivePreviousDayHomeCollectionRequests: Archived " +
        rowsToArchive.length + " completed request(s) through " + yesterdayIso
    );

    return {
        success: true,
        message: "Archived " + rowsToArchive.length +
            " completed home collection request(s) through " + yesterdayIso,
        archivedCount: rowsToArchive.length,
        skippedNonCompletedCount: skippedNonCompleted.length,
        skippedAlreadyArchivedCount: skippedAlreadyArchived.length
    };
}
