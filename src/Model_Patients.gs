// ============================================================
// Model_Patients — part of the ABC Clinic WhatsApp bot
// Patients registry: find/upsert/sync, name & language resolution.
// See src/Config.gs for the full file-layout map and Script Properties.
// ============================================================



// ============================================================
// PATIENT REGISTRY
// ============================================================

function isValidPatientName(name) {

    const value =
        String(name || "").trim();

    if (value.length < 2) {
        return false;
    }

    if (/^\d+$/.test(value)) {
        return false;
    }

    return true;
}


function ensurePatientsSheet() {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    let sheet =
        ss.getSheetByName("Patients");

    if (!sheet) {

        sheet =
            ss.insertSheet("Patients");

        sheet.appendRow([
            "Patient ID",
            "Phone",
            "Name",
            "Language",
            "First Seen",
            "Last Visit",
            "Notes"
        ]);
    }

    return sheet;
}


function generatePatientId() {

    return (
        "PAT-" +
        Utilities.formatDate(
            new Date(),
            TIMEZONE,
            "yyyyMMdd"
        ) +
        "-" +
        String(
            Math.floor(Math.random() * 9000) + 1000
        )
    );
}


function findPatientByPhone(phone) {

    const sheet =
        ensurePatientsSheet();

    const data =
        sheet.getDataRange().getValues();

    const target =
        normalizeWhatsAppPhone(phone);

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        if (
            phonesMatch(
                data[i][1],
                target
            )
        ) {

            return {
                patientId:
                    String(data[i][0]).trim(),
                phone:
                    String(data[i][1]).trim(),
                name:
                    String(data[i][2] || "").trim(),
                language:
                    String(data[i][3] || "EN")
                        .trim()
                        .toUpperCase(),
                row: i + 1
            };
        }
    }

    return null;
}


function upsertPatient(
    phone,
    name,
    language,
    options
) {

    const opts = options || {};
    const sheet = ensurePatientsSheet();
    const lock = LockService.getScriptLock();
    let locked = false;

    try {

        if (!opts.skipLock) {

            if (!lock.tryLock(10000)) {

                return {
                    success: false,
                    message:
                        "Unable to save patient record. Please try again."
                };
            }

            locked = true;
        }

        // ========================================================
        // GUARD: Verify lock is held before modifying sheet
        // ========================================================
        // The locked flag check prevents race condition where concurrent
        // webhook deliveries could both pass tryLock() and modify the sheet
        // simultaneously. This guard ensures lock is held before any sheet modifications.

        if (!opts.skipLock && !locked) {
            throw new Error("Lock not acquired");
        }

        const existing =
            findPatientByPhone(phone);

        const now = new Date();
        const lang =
            String(language || "EN")
                .trim()
                .toUpperCase();

        if (existing) {

            sheet.getRange(existing.row, 1, 1, 7).setValues([[
                existing.patientId,
                existing.phone,
                name || existing.name,
                lang || existing.language,
                sheet.getRange(existing.row, 5).getValue(),
                opts.updateLastVisit === false
                    ? sheet.getRange(existing.row, 6).getValue()
                    : now,
                sheet.getRange(existing.row, 7).getValue()
            ]]);

            return {
                success: true,
                patientId: existing.patientId,
                name: name || existing.name
            };
        }

        const patientId = generatePatientId();

        sheet.appendRow([
            patientId,
            String(phone).trim(),
            name,
            lang,
            now,
            opts.updateLastVisit === false ? "" : now,
            ""
        ]);

        return {
            success: true,
            patientId: patientId,
            name: name
        };

    } finally {

        if (
            locked &&
            lock.hasLock()
        ) {
            lock.releaseLock();
        }
    }
}



function registerPatientForBooking(
    phone,
    name,
    language
) {

    let lang =
        String(language || "")
            .trim()
            .toUpperCase();

    if (
        ["EN", "TE", "HI", "KA", "TA", "ML"].indexOf(lang) === -1
    ) {

        const existing =
            findPatientByPhone(phone);

        lang =
            existing &&
            ["EN", "TE", "HI", "KA", "TA", "ML"].indexOf(
                existing.language
            ) !== -1
                ? existing.language
                : "EN";
    }

    // Note: this runs on the hottest concurrency path (patient booking),
    // where duplicate/retried WhatsApp webhook deliveries make a
    // check-then-act race on Patients rows most likely — do NOT skip
    // the lock here.
    return upsertPatient(
        phone,
        name,
        lang,
        {
            updateLastVisit: true
        }
    );
}


function resolveKnownPatientName(phone) {

    const patient =
        findPatientByPhone(phone);

    if (
        patient &&
        isValidPatientName(patient.name)
    ) {
        return patient.name;
    }

    return findPatientNameFromAppointments(phone);
}


function findPatientNameFromAppointments(phone) {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Appointments");

    if (!sheet) {
        return "";
    }

    const data =
        sheet.getDataRange().getValues();

    let bestName = "";
    let bestTime = 0;

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        if (
            !phonesMatch(
                data[i][5],
                phone
            )
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

        const name =
            String(data[i][4] || "").trim();

        if (!isValidPatientName(name)) {
            continue;
        }

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

        if (
            sortKey >= bestTime ||
            (
                sortKey === bestTime &&
                !bestName
            )
        ) {
            bestTime = sortKey;
            bestName = name;
        }
    }

    return bestName;
}


function ensurePatientRecordFromHistory(
    phone,
    language
) {

    if (findPatientByPhone(phone)) {
        return;
    }

    const name =
        findPatientNameFromAppointments(phone);

    if (!isValidPatientName(name)) {
        return;
    }

    upsertPatient(
        phone,
        name,
        language || "EN",
        { updateLastVisit: false }
    );
}


function syncPatientLanguagePreference(
    phone,
    language
) {

    const lang =
        String(language || "EN")
            .trim()
            .toUpperCase();

    if (
        ["EN", "TE", "HI", "KA", "TA", "ML"].indexOf(lang) === -1
    ) {
        return;
    }

    const existing =
        findPatientByPhone(phone);

    if (existing) {

        upsertPatient(
            phone,
            existing.name,
            lang,
            { updateLastVisit: false }
        );

        return;
    }

    const name =
        findPatientNameFromAppointments(phone);

    if (isValidPatientName(name)) {

        upsertPatient(
            phone,
            name,
            lang,
            { updateLastVisit: false }
        );
    }
}


function resolvePatientLanguage(phone, session) {

    if (
        session &&
        session.role === "DOCTOR"
    ) {
        return "EN";
    }

    if (
        session &&
        session.state === "LANGUAGE_SELECT"
    ) {
        return "EN";
    }

    const sessionLang =
        session &&
        String(session.language || "")
            .trim()
            .toUpperCase();

    if (
        ["EN", "TE", "HI", "KA", "TA", "ML"].indexOf(
            sessionLang
        ) !== -1
    ) {
        return sessionLang;
    }

    const patient =
        findPatientByPhone(phone);

    if (
        patient &&
        ["EN", "TE", "HI", "KA", "TA", "ML"].indexOf(
            patient.language
        ) !== -1
    ) {
        return patient.language;
    }

    return "EN";
}


function resolvePatientNameForBooking(
    phone,
    session,
    senderName
) {

    if (
        session &&
        isValidPatientName(
            session.patientName
        )
    ) {
        return session.patientName;
    }

    const knownName =
        resolveKnownPatientName(phone);

    if (isValidPatientName(knownName)) {
        return knownName;
    }

    if (isValidPatientName(senderName)) {
        return String(senderName).trim();
    }

    return "WhatsApp Patient";
}


function syncPatientsFromAppointments() {

    requireDebugMode(
        "syncPatientsFromAppointments"
    );

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("Appointments");

    if (!sheet) {
        throw new Error(
            "Appointments sheet not found."
        );
    }

    const data =
        sheet.getDataRange().getValues();

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        const status =
            String(data[i][6] || "")
                .trim()
                .toLowerCase();

        if (status === "cancelled") {
            skipped++;
            continue;
        }

        const phone = data[i][5];
        const name =
            String(data[i][4] || "").trim();

        if (
            !phone ||
            !isValidPatientName(name)
        ) {
            skipped++;
            continue;
        }

        const existing =
            findPatientByPhone(phone);

        const result =
            upsertPatient(
                phone,
                name,
                existing
                    ? existing.language
                    : "EN",
                { updateLastVisit: true }
            );

        if (!result.success) {
            skipped++;
            continue;
        }

        if (existing) {
            updated++;
        } else {
            created++;
        }
    }

    const summary = {
        created: created,
        updated: updated,
        skipped: skipped,
        total: created + updated
    };

    Logger.log(
        "syncPatientsFromAppointments: " +
        JSON.stringify(summary)
    );

    return summary;
}


function patientNeedsNameCapture(phone) {

    return !isValidPatientName(
        resolveKnownPatientName(phone)
    );
}
