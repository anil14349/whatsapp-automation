// ============================================================
// Model_Services — part of the ABC Clinic WhatsApp bot
// Visit type / service catalog and booking duration resolution.
// See src/Config.gs for the full file-layout map and Script Properties.
// ============================================================



function getVisitTypeSettings() {

    ensureSettingsSheet();

    const enabled =
        parseSettingsBoolean(
            getSetting(
                "ENABLE_VISIT_TYPE_SELECTION",
                "TRUE"
            ),
            true
        );

    return {
        enabled: enabled
    };
}



function ensureServicesSheet() {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    let sheet =
        ss.getSheetByName("Services");

    if (!sheet) {

        sheet =
            ss.insertSheet("Services");

        sheet.appendRow([
            "Service ID",
            "Name",
            "Duration Minutes",
            "Active"
        ]);

        [
            ["S001", "Consultation", 30, "TRUE"],
            ["S002", "Follow-up", 15, "TRUE"],
            ["S003", "Vaccination", 20, "TRUE"],
            ["S004", "Health check", 45, "TRUE"]
        ].forEach(function (row) {
            sheet.appendRow(row);
        });
    }

    return sheet;
}



function getActiveServices() {

    const sheet =
        ensureServicesSheet();

    const data =
        sheet.getDataRange().getValues();

    const services = [];

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        const active =
            parseSettingsBoolean(
                data[i][3],
                true
            );

        if (!active) {
            continue;
        }

        const serviceId =
            String(data[i][0] || "").trim();

        const name =
            String(data[i][1] || "").trim();

        if (
            !serviceId ||
            !name
        ) {
            continue;
        }

        let durationMinutes =
            Number(data[i][2]);

        if (
            isNaN(durationMinutes) ||
            durationMinutes <= 0
        ) {
            durationMinutes = 0;
        }

        services.push({
            serviceId: serviceId,
            name: name,
            durationMinutes:
                durationMinutes
        });
    }

    return services;
}



function getServiceRecord(serviceId) {

    const target =
        String(serviceId || "")
            .trim()
            .toUpperCase();

    if (!target) {
        return null;
    }

    const services =
        getActiveServices();

    for (
        let i = 0;
        i < services.length;
        i++
    ) {

        if (
            String(
                services[i].serviceId || ""
            )
                .trim()
                .toUpperCase() ===
            target
        ) {
            return services[i];
        }
    }

    return null;
}



function getServiceDisplayName(
    serviceId
) {

    const service =
        getServiceRecord(serviceId);

    return service
        ? service.name
        : "";
}



function resolveBookingDurationMinutes(
    doctorId,
    serviceId
) {

    const service =
        getServiceRecord(serviceId);

    if (
        service &&
        service.durationMinutes > 0
    ) {
        return service.durationMinutes;
    }

    return getDoctorAppointmentDuration(
        doctorId
    );
}



function getAvailableSlotsForBooking(
    doctorId,
    dateString,
    serviceId
) {

    return getAvailableSlots(
        doctorId,
        dateString,
        resolveBookingDurationMinutes(
            doctorId,
            serviceId
        )
    );
}



function shouldOfferVisitTypeSelection() {

    const settings =
        getVisitTypeSettings();

    if (!settings.enabled) {
        return false;
    }

    return (
        getActiveServices().length > 1
    );
}



function getAutoSelectedServiceId() {

    const settings =
        getVisitTypeSettings();

    if (!settings.enabled) {
        return "";
    }

    const services =
        getActiveServices();

    if (services.length === 1) {
        return services[0].serviceId;
    }

    return "";
}
