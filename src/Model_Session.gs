// ============================================================
// Model_Session — part of the ABC Clinic WhatsApp bot
// WhatsApp_Sessions sheet read/write (conversation state persistence).
// See src/Config.gs for the full file-layout map and Script Properties.
// ============================================================



function getWhatsAppSession(phone) {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("WhatsApp_Sessions");

    if (!sheet) {
        throw new Error(
            "WhatsApp_Sessions sheet not found."
        );
    }

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

            serviceId:
                String(data[i][11] || "").trim()
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



function ensureWhatsAppSessionServiceIdColumn(sheet) {

    if (!sheet.getRange(1, 12).getValue()) {
        sheet
            .getRange(1, 12)
            .setValue("Service ID");
    }
}



function saveWhatsAppSession(
    phone,
    updates
) {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName(
            "WhatsApp_Sessions"
        );

    if (!sheet) {
        throw new Error(
            "WhatsApp_Sessions sheet not found."
        );
    }

    ensureWhatsAppSessionLanguageColumn(sheet);
    ensureWhatsAppSessionPatientNameColumn(sheet);
    ensureWhatsAppSessionSlotPageColumn(sheet);
    ensureWhatsAppSessionServiceIdColumn(sheet);

    const existing =
        getWhatsAppSession(phone);

    const now =
        new Date();

    if (existing) {

        const row =
            existing.row;

        const current =
            sheet
                .getRange(row, 1, 1, 12)
                .getValues()[0];

        sheet
            .getRange(row, 1, 1, 12)
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

                updates.serviceId !== undefined
                    ? updates.serviceId
                    : (
                        current[11] || ""
                    )
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
            updates.serviceId || ""
        ]);
    }
}


function clearWhatsAppSession(phone) {

    const session =
        getWhatsAppSession(phone);

    if (!session) {
        return;
    }

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName(
            "WhatsApp_Sessions"
        );

    sheet
        .getRange(
            session.row,
            2,
            1,
            7
        )
        .clearContent();
}
