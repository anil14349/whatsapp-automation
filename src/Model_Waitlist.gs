// ============================================================
// Model_Waitlist — part of the ABC Clinic WhatsApp bot
// Slot-alert waitlist and opened-slot offer notifications.
// See src/Config.gs for the full file-layout map and Script Properties.
// ============================================================



function getWaitlistSettings() {

    ensureSettingsSheet();

    const enabled =
        parseSettingsBoolean(
            getSetting(
                "ENABLE_APPOINTMENT_WAITLIST",
                "TRUE"
            ),
            true
        );

    let notifyCount =
        Number(
            getSetting(
                "WAITLIST_NOTIFY_COUNT",
                "3"
            )
        );

    if (
        isNaN(notifyCount) ||
        notifyCount < 1
    ) {
        notifyCount = 3;
    }

    if (notifyCount > 10) {
        notifyCount = 10;
    }

    return {
        enabled: enabled,
        notifyCount: notifyCount
    };
}



function ensureWaitlistSheet() {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    let sheet =
        ss.getSheetByName("Waitlist");

    if (!sheet) {

        sheet =
            ss.insertSheet("Waitlist");

        sheet.appendRow([
            "Phone",
            "Doctor ID",
            "Patient Name",
            "Status",
            "Created At"
        ]);
    }

    return sheet;
}



function ensureSlotOfferSheet() {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    let sheet =
        ss.getSheetByName("Slot_Offers");

    if (!sheet) {

        sheet =
            ss.insertSheet("Slot_Offers");

        sheet.appendRow([
            "Offer ID",
            "Doctor ID",
            "ISO Date",
            "Time",
            "Phone",
            "Status",
            "Sent At"
        ]);
    }

    return sheet;
}



function generateWaitlistOfferId() {

    return (
        "w" +
        Utilities.formatDate(
            new Date(),
            TIMEZONE,
            "yyyyMMddHHmmss"
        ) +
        String(
            Math.floor(
                Math.random() * 1000
            )
        ).padStart(3, "0")
    );
}



function buildOpenedSlotFromAppointmentRow(
    row
) {

    const isoDate =
        normalizeAppointmentDate(
            row[1]
        );

    const displayDate =
        formatAppointmentDisplayDate(
            row[1]
        );

    const time =
        formatAppointmentDisplayTime(
            row[2]
        );

    return {
        doctorId:
            String(row[3] || "").trim(),
        isoDate: isoDate,
        displayDate: displayDate,
        time: time,
        excludedPhone:
            String(row[5] || "").trim()
    };
}



function isPatientOnWaitlist(
    phone,
    doctorId
) {

    const sheet =
        ensureWaitlistSheet();

    const data =
        sheet.getDataRange().getValues();

    const targetDoctor =
        String(doctorId || "").trim();

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        if (
            phonesMatch(
                data[i][0],
                phone
            ) &&
            String(data[i][1] || "").trim() ===
            targetDoctor &&
            String(data[i][3] || "")
                .trim()
                .toUpperCase() ===
            "ACTIVE"
        ) {
            return true;
        }
    }

    return false;
}



function addPatientToWaitlist(
    phone,
    doctorId,
    patientName
) {

    const targetDoctor =
        String(doctorId || "").trim();

    if (!targetDoctor) {
        return {
            success: false,
            message:
                "Doctor not found."
        };
    }

    if (
        isPatientOnWaitlist(
            phone,
            targetDoctor
        )
    ) {

        const doctorName =
            findDoctorById(
                targetDoctor
            ) || "this doctor";

        return {
            success: false,
            message:
                "You are already on slot alerts for " +
                doctorName +
                "."
        };
    }

    const sheet =
        ensureWaitlistSheet();

    sheet.appendRow([
        String(phone || "").trim(),
        targetDoctor,
        String(patientName || "Patient").trim(),
        "ACTIVE",
        new Date()
    ]);

    const doctorName =
        findDoctorById(targetDoctor) ||
        "your doctor";

    return {
        success: true,
        message:
            "You will be notified when a slot opens with " +
            doctorName +
            "."
    };
}



function findActiveWaitlistPatients(
    doctorId,
    limit,
    excludedPhone
) {

    const sheet =
        ensureWaitlistSheet();

    const data =
        sheet.getDataRange().getValues();

    const targetDoctor =
        String(doctorId || "").trim();

    const matches = [];

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        const rowPhone =
            String(data[i][0] || "").trim();

        if (
            String(data[i][1] || "").trim() !==
            targetDoctor
        ) {
            continue;
        }

        if (
            String(data[i][3] || "")
                .trim()
                .toUpperCase() !==
            "ACTIVE"
        ) {
            continue;
        }

        if (
            excludedPhone &&
            phonesMatch(
                rowPhone,
                excludedPhone
            )
        ) {
            continue;
        }

        matches.push({
            phone: rowPhone,
            doctorId: targetDoctor,
            patientName:
                String(data[i][2] || "").trim() ||
                "Patient",
            createdAt: data[i][4],
            row: i + 1
        });
    }

    matches.sort(function (a, b) {

        const aTime =
            a.createdAt instanceof Date
                ? a.createdAt.getTime()
                : 0;

        const bTime =
            b.createdAt instanceof Date
                ? b.createdAt.getTime()
                : 0;

        return aTime - bTime;
    });

    return matches.slice(
        0,
        Number(limit) || 3
    );
}



function createSlotOfferRecord(
    doctorId,
    isoDate,
    time,
    phone
) {

    const sheet =
        ensureSlotOfferSheet();

    const offerId =
        generateWaitlistOfferId();

    sheet.appendRow([
        offerId,
        String(doctorId || "").trim(),
        String(isoDate || "").trim(),
        String(time || "").trim(),
        String(phone || "").trim(),
        "PENDING",
        new Date()
    ]);

    return offerId;
}



function getSlotOfferRecord(offerId) {

    const sheet =
        ensureSlotOfferSheet();

    if (!sheet) {
        return null;
    }

    const data =
        sheet.getDataRange().getValues();

    const target =
        String(offerId || "")
            .trim()
            .toLowerCase();

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        if (
            String(data[i][0] || "")
                .trim()
                .toLowerCase() ===
            target
        ) {

            return {
                row: i + 1,
                offerId:
                    String(data[i][0] || "").trim(),
                doctorId:
                    String(data[i][1] || "").trim(),
                isoDate:
                    String(data[i][2] || "").trim(),
                time:
                    String(data[i][3] || "").trim(),
                phone:
                    String(data[i][4] || "").trim(),
                status:
                    String(data[i][5] || "").trim(),
                sentAt: data[i][6]
            };
        }
    }

    return null;
}



function updateSlotOfferStatus(
    offerId,
    status
) {

    const offer =
        getSlotOfferRecord(offerId);

    if (!offer) {
        return false;
    }

    const sheet =
        ensureSlotOfferSheet();

    sheet
        .getRange(offer.row, 6)
        .setValue(
            String(status || "").trim()
        );

    return true;
}



function expirePendingOffersForSlot(
    doctorId,
    isoDate,
    time,
    exceptOfferId
) {

    const sheet =
        ensureSlotOfferSheet();

    const data =
        sheet.getDataRange().getValues();

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        if (
            String(data[i][1] || "").trim() !==
            String(doctorId || "").trim()
        ) {
            continue;
        }

        if (
            String(data[i][2] || "").trim() !==
            String(isoDate || "").trim()
        ) {
            continue;
        }

        if (
            formatAppointmentDisplayTime(
                data[i][3]
            ) !==
            formatAppointmentDisplayTime(time)
        ) {
            continue;
        }

        if (
            String(data[i][5] || "")
                .trim()
                .toUpperCase() !==
            "PENDING"
        ) {
            continue;
        }

        if (
            exceptOfferId &&
            String(data[i][0] || "").trim() ===
            String(exceptOfferId).trim()
        ) {
            continue;
        }

        sheet
            .getRange(i + 1, 6)
            .setValue("EXPIRED");
    }
}



function isWaitlistSlotTimeAvailable(
    doctorId,
    isoDate,
    time
) {

    if (
        !doctorId ||
        !isoDate ||
        !time
    ) {
        return false;
    }

    const slots =
        getAvailableSlots(
            doctorId,
            isoDate
        );

    const target =
        formatAppointmentDisplayTime(time);

    for (
        let i = 0;
        i < slots.length;
        i++
    ) {

        if (
            formatAppointmentDisplayTime(
                slots[i]
            ) === target
        ) {
            return true;
        }
    }

    return false;
}



function markWaitlistPatientClaimed(
    phone,
    doctorId
) {

    const sheet =
        ensureWaitlistSheet();

    const data =
        sheet.getDataRange().getValues();

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        if (
            phonesMatch(
                data[i][0],
                phone
            ) &&
            String(data[i][1] || "").trim() ===
            String(doctorId || "").trim() &&
            String(data[i][3] || "")
                .trim()
                .toUpperCase() ===
            "ACTIVE"
        ) {

            sheet
                .getRange(i + 1, 4)
                .setValue("CLAIMED");

            return;
        }
    }
}



function sendWaitlistSlotOfferMessage(
    ss,
    offerId,
    phone,
    slot,
    doctorName
) {

    const recipient =
        formatWhatsAppRecipientPhone(
            phone
        );

    if (!recipient) {
        throw new Error(
            "Missing phone for waitlist offer."
        );
    }

    const language =
        resolvePatientLanguageFromRegistry(
            phone
        );

    const body =
        localizeWhatsAppReply(
            language,
            buildWaitlistOfferMessage(
                slot,
                doctorName
            )
        );

    const menuSpec =
        getWaitlistOfferButtonSpec(
            offerId
        );

    if (
        interactiveMenusEnabled() &&
        menuSpec &&
        menuSpec.interactive
    ) {

        sendWhatsAppInteractiveMessage(
            recipient,
            body,
            menuSpec.interactive
        );

    } else {

        sendWhatsAppText(
            recipient,
            body +
            "\n\nReply with: book " +
            offerId
        );
    }

    appendWhatsAppDebugLog(
        ss,
        {
            direction: "WAITLIST_OFFER",
            phone: recipient,
            status: "SUCCESS",
            response:
                "[offer:" +
                offerId +
                "] " +
                body
        }
    );
}



function notifyWaitlistForOpenedSlot(
    openedSlot
) {

    const settings =
        getWaitlistSettings();

    if (
        !settings.enabled ||
        !openedSlot ||
        !openedSlot.doctorId ||
        !openedSlot.isoDate ||
        !openedSlot.time
    ) {
        return {
            enabled: settings.enabled,
            notified: 0
        };
    }

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const patients =
        findActiveWaitlistPatients(
            openedSlot.doctorId,
            settings.notifyCount,
            openedSlot.excludedPhone
        );

    if (patients.length === 0) {
        return {
            enabled: true,
            notified: 0
        };
    }

    const doctor =
        getDoctorRecord(
            openedSlot.doctorId
        );

    const doctorName =
        doctor &&
        doctor.doctorName
            ? doctor.doctorName
            : String(
                openedSlot.doctorId
            ).trim();

    let notified = 0;

    patients.forEach(
        function (patient) {

            try {

                const offerId =
                    createSlotOfferRecord(
                        openedSlot.doctorId,
                        openedSlot.isoDate,
                        openedSlot.time,
                        patient.phone
                    );

                sendWaitlistSlotOfferMessage(
                    ss,
                    offerId,
                    patient.phone,
                    openedSlot,
                    doctorName
                );

                notified++;

            } catch (error) {

                Logger.log(
                    "Waitlist offer failed for " +
                    patient.phone +
                    ": " +
                    error.message
                );
            }
        }
    );

    return {
        enabled: true,
        notified: notified
    };
}



function acceptWaitlistSlotOffer(
    offerId,
    phone
) {

    const offer =
        getSlotOfferRecord(offerId);

    if (!offer) {
        return {
            success: false,
            message:
                "This slot offer is no longer valid."
        };
    }

    if (
        String(offer.status || "")
            .trim()
            .toUpperCase() !==
        "PENDING"
    ) {
        return {
            success: false,
            message:
                "This slot offer has already been used or expired."
        };
    }

    if (
        !phonesMatch(
            offer.phone,
            phone
        )
    ) {
        return {
            success: false,
            message:
                "This slot offer belongs to another patient."
        };
    }

    if (
        !isWaitlistSlotTimeAvailable(
            offer.doctorId,
            offer.isoDate,
            offer.time
        )
    ) {
        updateSlotOfferStatus(
            offerId,
            "EXPIRED"
        );

        return {
            success: false,
            message:
                "Sorry, that slot is no longer available."
        };
    }

    const patient =
        findPatientByPhone(phone);

    const patientName =
        patient &&
        patient.name
            ? patient.name
            : "Patient";

    const language =
        patient &&
        patient.language
            ? patient.language
            : "EN";

    const booking =
        bookAppointment(
            offer.doctorId,
            offer.isoDate,
            offer.time,
            patientName,
            phone,
            language
        );

    if (
        !booking ||
        !booking.success
    ) {

        updateSlotOfferStatus(
            offerId,
            "FAILED"
        );

        return {
            success: false,
            message:
                booking &&
                booking.message
                    ? booking.message
                    : "Unable to book the offered slot."
        };
    }

    updateSlotOfferStatus(
        offerId,
        "CLAIMED"
    );

    expirePendingOffersForSlot(
        offer.doctorId,
        offer.isoDate,
        offer.time,
        offerId
    );

    markWaitlistPatientClaimed(
        phone,
        offer.doctorId
    );

    return {
        success: true,
        message:
            "✅ Appointment booked for " +
            formatAppointmentDisplayDate(
                offer.isoDate
            ) +
            " at " +
            formatAppointmentDisplayTime(
                offer.time
            ) +
            ".",
        appointmentId:
            booking.appointmentId
    };
}
