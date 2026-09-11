// ============================================================
// Model_Session — part of the ABC Clinic WhatsApp bot
// WhatsApp_Sessions sheet read/write (conversation state persistence).
// See src/Config.gs for the full file-layout map and Script Properties.
// ============================================================



function ensureWhatsAppSessionsSheet() {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    let sheet =
        ss.getSheetByName("WhatsApp_Sessions");

    if (!sheet) {

        sheet =
            ss.insertSheet("WhatsApp_Sessions");

        sheet.appendRow([
            "Phone",
            "Role",
            "State",
            "Doctor ID",
            "Date",
            "Time",
            "Appointment ID",
            "Updated At",
            "Language",
            "Patient Name",
            "Slot Page",
            "Appointment Page",
            "Doctor Menu Tier",
            "List Page",
            "Location"
        ]);
    }

    return sheet;
}



// Cache layer for getWhatsAppSession(). WhatsApp_Sessions has one row per
// phone number that has ever messaged the bot and never shrinks, so the
// linear scan in readWhatsAppSessionFromSheet() gets slower as the clinic's
// user base grows — this was the main driver of the bot feeling slower
// over time. CacheService persists ACROSS separate webhook invocations
// (unlike a plain in-memory variable), so an active conversation mostly
// hits cache instead of re-scanning the whole sheet on every message.
// TTL is short enough that a missed invalidation self-heals quickly.
//
// NOTE: constants are inlined (not top-level var/const) because
// scripts/sync-monolith-from-src.js only syncs function bodies into
// ABC_Clinic_WhatsApp_Complete.gs — a top-level declaration here would
// silently never reach the monolith.

function getWhatsAppSessionCacheKey(phone) {
    return "WA_SESSION_" + normalizeWhatsAppPhone(phone);
}

function getWhatsAppSession(phone) {

    const cacheTtlSeconds = 1800; // 30 minutes
    const cacheNullSentinel = "__NULL__";

    const cache =
        CacheService.getScriptCache();

    const cacheKey =
        getWhatsAppSessionCacheKey(phone);

    const cached =
        cache.get(cacheKey);

    if (cached !== null) {

        if (cached === cacheNullSentinel) {
            return null;
        }

        try {
            return JSON.parse(cached);
        } catch (parseError) {
            // Corrupt/unexpected cache entry — fall through to a real read
            // rather than propagate the error.
        }
    }

    const session =
        readWhatsAppSessionFromSheet(phone);

    cache.put(
        cacheKey,
        session
            ? JSON.stringify(session)
            : cacheNullSentinel,
        cacheTtlSeconds
    );

    return session;
}

function invalidateWhatsAppSessionCache(phone) {

    CacheService.getScriptCache().remove(
        getWhatsAppSessionCacheKey(phone)
    );
}

function readWhatsAppSessionFromSheet(phone) {

    const sheet =
        ensureWhatsAppSessionsSheet();

    const range =
        sheet.getDataRange();

    const data =
        range.getValues();

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        if (
            !phonesMatch(
                data[i][0],
                phone
            )
        ) {
            continue;
        }

        // ----------------------------------------------------------
        // IMPORTANT:
        // Google Sheets may automatically convert:
        //   "2026-08-18" -> Date object
        //   "10:00 AM"  -> Date object
        //
        // Never use String(Date) for these fields because it produces
        // values such as:
        //   "Tue Aug 18 2026 00:00:00 GMT+0530..."
        //
        // Normalize them back to the values used by the application.
        // ----------------------------------------------------------

        let sessionDate = "";

        if (
            data[i][4] instanceof Date &&
            !isNaN(data[i][4].getTime())
        ) {

            sessionDate =
                Utilities.formatDate(
                    data[i][4],
                    TIMEZONE,
                    "yyyy-MM-dd"
                );

        } else {

            sessionDate =
                String(data[i][4] || "").trim();
        }

        let sessionTime = "";

        if (
            data[i][5] instanceof Date &&
            !isNaN(data[i][5].getTime())
        ) {

            sessionTime =
                Utilities.formatDate(
                    data[i][5],
                    TIMEZONE,
                    "hh:mm a"
                );

        } else {

            sessionTime =
                String(data[i][5] || "").trim();
        }

        return {

            row:
                i + 1,

            phone:
                String(data[i][0]).trim(),

            role:
                String(data[i][1] || "").trim(),

            state:
                String(data[i][2] || "").trim(),

            doctorId:
                String(data[i][3] || "").trim(),

            date:
                sessionDate,

            time:
                sessionTime,

            appointmentId:
                String(data[i][6] || "").trim(),

            updatedAt:
                data[i][7],

            language:
                String(data[i][8] || "")
                    .trim()
                    .toUpperCase(),

            patientName:
                String(data[i][9] || "").trim(),

            slotPage:
                data[i][10] === "" ||
                data[i][10] === undefined ||
                data[i][10] === null
                    ? 0
                    : parseInt(
                        data[i][10],
                        10
                    ) || 0,

            apptPage:
                data[i][11] === "" ||
                data[i][11] === undefined ||
                data[i][11] === null
                    ? 0
                    : parseInt(
                        data[i][11],
                        10
                    ) || 0,

            doctorMenuTier:
                data[i][12] === "" ||
                data[i][12] === undefined ||
                data[i][12] === null
                    ? ""
                    : String(data[i][12]).trim(),

            // Generic scroll-position field shared by any paginated list
            // menu that isn't the appointment list or the slot picker
            // (doctor selection, doctor's per-day session-remove list).
            // These states are mutually exclusive with each other and
            // with slot/appointment pagination, so one column covers all
            // of them the same way slotPage/apptPage already do for
            // their own flows.
            listPage:
                data[i][13] === "" ||
                data[i][13] === undefined ||
                data[i][13] === null
                    ? 0
                    : parseInt(
                        data[i][13],
                        10
                    ) || 0,

            // "lat,lng" string captured from a WhatsApp location share,
            // used by the home blood-sample-collection flow between the
            // location-check step and the final request being saved.
            location:
                String(data[i][14] || "").trim()
        };
    }

    return null;
}



function ensureWhatsAppSessionLanguageColumn(sheet) {

    if (!sheet.getRange(1, 9).getValue()) {
        sheet
            .getRange(1, 9)
            .setValue("Language");
    }
}


function ensureWhatsAppSessionPatientNameColumn(sheet) {

    if (!sheet.getRange(1, 10).getValue()) {
        sheet
            .getRange(1, 10)
            .setValue("Patient Name");
    }
}



function ensureWhatsAppSessionSlotPageColumn(sheet) {

    if (!sheet.getRange(1, 11).getValue()) {
        sheet
            .getRange(1, 11)
            .setValue("Slot Page");
    }
}



// Appointment-list pagination (apptPage) and the doctor "More" submenu
// tier (doctorMenuTier) used to be read throughout Controller_Shared.gs/
// Controller_DoctorFlow.gs as if persisted here, but this sheet never
// actually had columns for them — every saveWhatsAppSession({apptPage/
// doctorMenuTier: ...}) call silently dropped the value, so pagination
// and "More" tier navigation reset on every single incoming message.
function ensureWhatsAppSessionAppointmentPageColumn(sheet) {

    if (!sheet.getRange(1, 12).getValue()) {
        sheet
            .getRange(1, 12)
            .setValue("Appointment Page");
    }
}



function ensureWhatsAppSessionDoctorMenuTierColumn(sheet) {

    if (!sheet.getRange(1, 13).getValue()) {
        sheet
            .getRange(1, 13)
            .setValue("Doctor Menu Tier");
    }
}



function ensureWhatsAppSessionListPageColumn(sheet) {

    if (!sheet.getRange(1, 14).getValue()) {
        sheet
            .getRange(1, 14)
            .setValue("List Page");
    }
}



function ensureWhatsAppSessionLocationColumn(sheet) {

    if (!sheet.getRange(1, 15).getValue()) {
        sheet
            .getRange(1, 15)
            .setValue("Location");
    }
}



function saveWhatsAppSession(
    phone,
    updates
) {

    const sheet =
        ensureWhatsAppSessionsSheet();

    ensureWhatsAppSessionLanguageColumn(sheet);
    ensureWhatsAppSessionPatientNameColumn(sheet);
    ensureWhatsAppSessionSlotPageColumn(sheet);
    ensureWhatsAppSessionAppointmentPageColumn(sheet);
    ensureWhatsAppSessionDoctorMenuTierColumn(sheet);
    ensureWhatsAppSessionListPageColumn(sheet);
    ensureWhatsAppSessionLocationColumn(sheet);

    try {

        const existing =
            getWhatsAppSession(phone);

        const now =
            new Date();

        if (existing) {

            const row =
                existing.row;

            const current =
                sheet
                    .getRange(row, 1, 1, 15)
                    .getValues()[0];

            sheet
                .getRange(row, 1, 1, 15)
                .setValues([[
                    phone,

                    updates.role !== undefined
                        ? updates.role
                        : current[1],

                    updates.state !== undefined
                        ? updates.state
                        : current[2],

                    updates.doctorId !== undefined
                        ? updates.doctorId
                        : current[3],

                    updates.date !== undefined
                        ? updates.date
                        : current[4],

                    updates.time !== undefined
                        ? updates.time
                        : current[5],

                    updates.appointmentId !== undefined
                        ? updates.appointmentId
                        : current[6],

                    now,

                    updates.language !== undefined
                        ? updates.language
                        : current[8],

                    updates.patientName !== undefined
                        ? updates.patientName
                        : current[9],

                    updates.slotPage !== undefined
                        ? updates.slotPage
                        : (
                            current[10] === "" ||
                            current[10] === undefined ||
                            current[10] === null
                                ? 0
                                : current[10]
                        ),

                    updates.apptPage !== undefined
                        ? updates.apptPage
                        : (
                            current[11] === "" ||
                            current[11] === undefined ||
                            current[11] === null
                                ? 0
                                : current[11]
                        ),

                    updates.doctorMenuTier !== undefined
                        ? updates.doctorMenuTier
                        : current[12],

                    updates.listPage !== undefined
                        ? updates.listPage
                        : (
                            current[13] === "" ||
                            current[13] === undefined ||
                            current[13] === null
                                ? 0
                                : current[13]
                        ),

                    updates.location !== undefined
                        ? updates.location
                        : current[14]
                ]]);

        } else {

            sheet.appendRow([
                phone,
                updates.role || "",
                updates.state || "",
                updates.doctorId || "",
                updates.date || "",
                updates.time || "",
                updates.appointmentId || "",
                now,
                updates.language || "EN",
                updates.patientName || "",
                updates.slotPage !== undefined
                    ? updates.slotPage
                    : 0,
                updates.apptPage !== undefined
                    ? updates.apptPage
                    : 0,
                updates.doctorMenuTier !== undefined
                    ? updates.doctorMenuTier
                    : "",
                updates.listPage !== undefined
                    ? updates.listPage
                    : 0,
                updates.location || ""
            ]);
        }

    } finally {

        // MUST run after every write so next read sees fresh data instead of
        // cached value. Placed in finally block to ensure cache invalidation
        // even if an exception occurs during save operation.
        invalidateWhatsAppSessionCache(phone);
    }
}


function clearWhatsAppSession(phone) {

    const session =
        getWhatsAppSession(phone);

    if (!session) {
        return;
    }

    const sheet =
        ensureWhatsAppSessionsSheet();

    sheet
        .getRange(
            session.row,
            2,
            1,
            7
        )
        .clearContent();

    invalidateWhatsAppSessionCache(phone);
}
