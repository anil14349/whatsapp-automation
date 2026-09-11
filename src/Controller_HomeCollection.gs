// ============================================================
// Controller_HomeCollection — part of the ABC Clinic WhatsApp bot
// Home blood-sample-collection request flow: patient shares their
// WhatsApp location, we check it's within getHomeCollectionRadiusKm()
// of getHospitalLocation(), then capture a preferred date + time
// window and save a Home_Collection_Requests row for staff follow-up.
// See src/Config.gs for the full file-layout map and Script Properties.
// ============================================================



function beginWhatsAppHomeCollectionFlow(
    ss,
    senderPhone
) {

    if (!getHospitalLocation()) {

        sendPatientMainMoreMenuReply(
            ss,
            senderPhone,
            "❌ Home sample collection isn't set up yet. Please call the clinic directly."
        );

        return;
    }

    saveWhatsAppSession(
        senderPhone,
        {
            role: "PATIENT",
            state: "HOME_COLLECTION_LOCATION",
            doctorId: "",
            date: "",
            time: "",
            appointmentId: "",
            location: ""
        }
    );

    sendCustomDateEntryMenuReply(
        ss,
        senderPhone,
        "🩸 Home Sample Collection\n\n" +
        "Please share your location (tap 📎 Attach → Location in WhatsApp) " +
        "so we can confirm you're within " +
        getHomeCollectionRadiusKm() +
        " km of " +
        getClinicName() +
        "."
    );
}



function handleWhatsAppHomeCollectionMessage(
    ss,
    senderPhone,
    senderName,
    messageText,
    normalizedMessage,
    session,
    location
) {

    const homeCollectionStates = [
        "HOME_COLLECTION_LOCATION",
        "HOME_COLLECTION_DATE",
        "HOME_COLLECTION_DATE_CUSTOM",
        "HOME_COLLECTION_TIME"
    ];

    if (
        !session ||
        homeCollectionStates.indexOf(session.state) === -1
    ) {
        return false;
    }


    // ======================================================
    // WAITING FOR LOCATION SHARE
    // ======================================================

    if (session.state === "HOME_COLLECTION_LOCATION") {

        if (
            !location ||
            typeof location.latitude !== "number" ||
            typeof location.longitude !== "number" ||
            !Number.isFinite(location.latitude) ||
            !Number.isFinite(location.longitude)
        ) {

            sendCustomDateEntryMenuReply(
                ss,
                senderPhone,
                "📍 Please use WhatsApp's Location attachment to share where " +
                "the sample should be collected — I can't use typed text for this."
            );

            return true;
        }

        const hospital =
            getHospitalLocation();

        if (!hospital) {

            saveWhatsAppSession(
                senderPhone,
                { state: "PATIENT_MAIN_MORE" }
            );

            sendPatientMainMoreMenuReply(
                ss,
                senderPhone,
                "❌ Home sample collection isn't set up yet. Please call the clinic directly."
            );

            return true;
        }

        const radiusKm =
            getHomeCollectionRadiusKm();

        const distanceKm =
            haversineDistanceKm(
                location.latitude,
                location.longitude,
                hospital.lat,
                hospital.lng
            );

        if (distanceKm > radiusKm) {

            saveWhatsAppSession(
                senderPhone,
                {
                    state: "PATIENT_MAIN_MORE",
                    location: ""
                }
            );

            sendPatientMainMoreMenuReply(
                ss,
                senderPhone,
                "❌ Sorry, home sample collection is only available within " +
                radiusKm +
                " km of " +
                getClinicName() +
                ".\n\n" +
                "Your shared location is about " +
                distanceKm.toFixed(1) +
                " km away."
            );

            return true;
        }

        saveWhatsAppSession(
            senderPhone,
            {
                state: "HOME_COLLECTION_DATE",
                location:
                    location.latitude +
                    "," +
                    location.longitude
            }
        );

        sendDateMenuReply(
            ss,
            senderPhone,
            "✅ You're within " +
            radiusKm +
            " km — home sample collection is available!\n\n" +
            "Choose a preferred date:",
            "patient"
        );

        return true;
    }


    // ======================================================
    // WAITING FOR A PREFERRED DATE (Today / Tomorrow / Other)
    // ======================================================

    if (session.state === "HOME_COLLECTION_DATE") {

        const selectedDate =
            getISODateFromMenuChoice(
                normalizedMessage
            );

        if (selectedDate) {

            saveWhatsAppSession(
                senderPhone,
                {
                    state: "HOME_COLLECTION_TIME",
                    date: selectedDate
                }
            );

            sendWhatsAppMenuReply(
                ss,
                senderPhone,
                "🕐 Choose a preferred time window:",
                getHomeCollectionTimeWindowSpec()
            );

            return true;
        }

        if (
            normalizedMessage === "3" ||
            normalizedMessage === "date_custom"
        ) {

            saveWhatsAppSession(
                senderPhone,
                { state: "HOME_COLLECTION_DATE_CUSTOM" }
            );

            sendCustomDateEntryMenuReply(
                ss,
                senderPhone,
                "Please enter the preferred date in YYYY-MM-DD format.\n\n" +
                "Example:\n" +
                Utilities.formatDate(
                    new Date(),
                    TIMEZONE,
                    "yyyy-MM-dd"
                )
            );

            return true;
        }

        sendDateMenuReply(
            ss,
            senderPhone,
            "❌ Invalid option.\n\nChoose a preferred date:",
            "patient"
        );

        return true;
    }


    // ======================================================
    // WAITING FOR A TYPED CUSTOM DATE
    // ======================================================

    if (session.state === "HOME_COLLECTION_DATE_CUSTOM") {

        const validation =
            validateFutureISODate(
                String(messageText || "").trim()
            );

        if (!validation.valid) {

            sendCustomDateEntryMenuReply(
                ss,
                senderPhone,
                validation.message
            );

            return true;
        }

        saveWhatsAppSession(
            senderPhone,
            {
                state: "HOME_COLLECTION_TIME",
                date: validation.date
            }
        );

        sendWhatsAppMenuReply(
            ss,
            senderPhone,
            "🕐 Choose a preferred time window:",
            getHomeCollectionTimeWindowSpec()
        );

        return true;
    }


    // ======================================================
    // WAITING FOR A TIME WINDOW → SAVE THE REQUEST
    // ======================================================

    if (session.state === "HOME_COLLECTION_TIME") {

        const timeWindows = {
            "1": "Morning (8 AM - 12 PM)",
            "2": "Afternoon (12 PM - 4 PM)",
            "3": "Evening (4 PM - 8 PM)"
        };

        const timeWindow =
            timeWindows[normalizedMessage];

        if (!timeWindow) {

            sendWhatsAppMenuReply(
                ss,
                senderPhone,
                "❌ Invalid option.\n\nChoose a preferred time window:",
                getHomeCollectionTimeWindowSpec()
            );

            return true;
        }

        const locationParts =
            String(session.location || "").split(",");

        const latitude =
            locationParts.length > 0
                ? Number(locationParts[0])
                : "";

        const longitude =
            locationParts.length > 1
                ? Number(locationParts[1])
                : "";

        const hospital =
            getHospitalLocation();

        const distanceKm =
            hospital &&
            isFinite(latitude) &&
            isFinite(longitude)
                ? haversineDistanceKm(
                    latitude,
                    longitude,
                    hospital.lat,
                    hospital.lng
                )
                : 0;

        const patientName =
            resolveKnownPatientName(senderPhone) ||
            senderName ||
            "";

        createHomeCollectionRequest({
            phone: senderPhone,
            patientName: patientName,
            latitude: latitude,
            longitude: longitude,
            distanceKm: distanceKm,
            date: session.date,
            timeWindow: timeWindow
        });

        saveWhatsAppSession(
            senderPhone,
            {
                role: "PATIENT",
                state: "MAIN_MENU",
                doctorId: "",
                date: "",
                time: "",
                appointmentId: "",
                location: ""
            }
        );

        sendPatientMainMenuReply(
            ss,
            senderPhone,
            "✅ Home sample collection requested for " +
            session.date +
            " (" +
            timeWindow +
            ").\n\n" +
            "Our team will call you shortly to confirm the exact time."
        );

        return true;
    }

    return false;
}
