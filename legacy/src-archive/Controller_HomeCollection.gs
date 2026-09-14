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

    // Check for an existing active request immediately when the patient
    // taps Home Sample Collection. This avoids asking for a new location,
    // date, or time when the same phone already has an outstanding request.
    // The final duplicate check inside createHomeCollectionRequest() is
    // still kept as a race-condition safety net.
    const existingRequest =
        findActiveHomeCollectionRequestByPhone(senderPhone);

    if (existingRequest) {
        saveWhatsAppSession(
            senderPhone,
            {
                role: "PATIENT",
                state: "HOME_COLLECTION_ACTIVE",
                homeCollectionRequestId: existingRequest.requestId || "",
                doctorId: "",
                date: existingRequest.date || "",
                time: existingRequest.timeWindow || "",
                appointmentId: "",
                location: ""
            }
        );

        sendWhatsAppMenuReply(
            ss,
            senderPhone,
            "⚠️ You already have an active home sample collection request.\n\n" +
            "🆔 Request ID: " +
            (existingRequest.requestId || "") +
            "\n📅 Date: " +
            (existingRequest.date || "") +
            "\n🕐 Time: " +
            (existingRequest.timeWindow || "") +
            "\n📌 Status: " +
            (existingRequest.status || "Pending") +
            "\n\nWhat would you like to do?",
            getHomeCollectionCompletionMenuSpec()
        );

        return;
    }

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
        "HOME_COLLECTION_TIME",
        "HOME_COLLECTION_ACTIVE",
        "HOME_COLLECTION_CANCEL_CONFIRM",
        "HOME_COLLECTION_RESCHEDULE_DATE",
        "HOME_COLLECTION_RESCHEDULE_DATE_CUSTOM",
        "HOME_COLLECTION_RESCHEDULE_TIME"
    ];

    if (
        !session ||
        homeCollectionStates.indexOf(session.state) === -1
    ) {
        return false;
    }


    // ======================================================
    // ACTIVE REQUEST → CANCEL OR RESCHEDULE HOME COLLECTION
    // ======================================================

    if (session.state === "HOME_COLLECTION_ACTIVE") {

        if (normalizedMessage === "cancel_home_collection") {
            saveWhatsAppSession(
                senderPhone,
                {
                    role: "PATIENT",
                    state: "HOME_COLLECTION_CANCEL_CONFIRM",
                    homeCollectionRequestId: session.homeCollectionRequestId || "",
                    doctorId: "",
                    date: session.date || "",
                    time: session.time || "",
                    appointmentId: "",
                    location: ""
                }
            );

            sendWhatsAppMenuReply(
                ss,
                senderPhone,
                "⚠️ Are you sure you want to cancel your active home sample collection request?",
                {
                    fallbackText: "Yes, Cancel\nKeep Request",
                    interactive: buildInteractiveButtonSpec([
                        { id: "confirm_cancel_home_collection", title: "Yes, Cancel" },
                        { id: "keep_home_collection", title: "Keep Request" }
                    ])
                }
            );

            return true;
        }

        if (
            normalizedMessage === "reschedule_home_collection" ||
            normalizedMessage === "reschedule_doctor_appointment"
        ) {
            saveWhatsAppSession(
                senderPhone,
                {
                    role: "PATIENT",
                    state: "HOME_COLLECTION_RESCHEDULE_DATE",
                    homeCollectionRequestId: session.homeCollectionRequestId || "",
                    doctorId: "",
                    date: session.date || "",
                    time: session.time || "",
                    appointmentId: "",
                    location: ""
                }
            );

            sendDateMenuReply(
                ss,
                senderPhone,
                "🔄 Reschedule home sample collection\n\nChoose a new preferred date:",
                "patient"
            );

            return true;
        }

        // A user may type 0 / Back here and fall through to the universal
        // navigation handler, which returns them to the Main Menu.
        return false;
    }


    // ======================================================
    // CONFIRM ACTIVE REQUEST CANCELLATION
    // ======================================================

    if (session.state === "HOME_COLLECTION_CANCEL_CONFIRM") {

        if (normalizedMessage === "confirm_cancel_home_collection") {
            const result =
                cancelHomeCollectionRequestByPatient(
                    session.homeCollectionRequestId,
                    senderPhone
                );

            if (result.ok) {
                saveWhatsAppSession(
                    senderPhone,
                    {
                        role: "PATIENT",
                        state: "MAIN_MENU",
                        homeCollectionRequestId: "",
                        doctorId: "",
                        date: "",
                        time: "",
                        appointmentId: "",
                        location: ""
                    }
                );

                sendWhatsAppText(
                    senderPhone,
                    "✅ Home sample collection request " +
                    result.requestId +
                    " has been cancelled. You can create a new request whenever needed."
                );
            } else {
                saveWhatsAppSession(
                    senderPhone,
                    {
                        role: "PATIENT",
                        state: "MAIN_MENU",
                        homeCollectionRequestId: "",
                        doctorId: "",
                        date: "",
                        time: "",
                        appointmentId: "",
                        location: ""
                    }
                );

                sendWhatsAppText(
                    senderPhone,
                    result.reason === "already_completed"
                        ? "ℹ️ This home sample collection has already been completed."
                        : result.reason === "already_cancelled"
                            ? "ℹ️ This home sample collection has already been cancelled."
                            : "❌ We couldn't cancel that home sample collection request. Please contact the clinic."
                );
            }

            return true;
        }

        if (normalizedMessage === "keep_home_collection") {
            saveWhatsAppSession(
                senderPhone,
                {
                    role: "PATIENT",
                    state: "HOME_COLLECTION_ACTIVE",
                    homeCollectionRequestId: session.homeCollectionRequestId || "",
                    date: session.date || "",
                    time: session.time || ""
                }
            );

            sendWhatsAppMenuReply(
                ss,
                senderPhone,
                "✅ Your home sample collection request remains active.",
                getHomeCollectionCompletionMenuSpec()
            );

            return true;
        }

        sendWhatsAppMenuReply(
            ss,
            senderPhone,
            "Please choose an option.",
            {
                fallbackText: "Yes, Cancel\nKeep Request",
                interactive: buildInteractiveButtonSpec([
                    { id: "confirm_cancel_home_collection", title: "Yes, Cancel" },
                    { id: "keep_home_collection", title: "Keep Request" }
                ])
            }
        );

        return true;
    }


    // ======================================================
    // RESCHEDULE HOME COLLECTION → DATE
    // ======================================================

    if (session.state === "HOME_COLLECTION_RESCHEDULE_DATE") {

        const selectedDate =
            getISODateFromMenuChoice(
                normalizedMessage
            );

        if (selectedDate) {
            const availableTimeWindows =
                getHomeCollectionTimeWindowOptionsForDate(
                    selectedDate
                );

            if (availableTimeWindows.length === 0) {
                sendDateMenuReply(
                    ss,
                    senderPhone,
                    "⏰ There are no time windows left for today with the " +
                    getHomeCollectionMinLeadHours() +
                    "-hour minimum notice.\n\nChoose another date:",
                    "patient"
                );
                return true;
            }

            saveWhatsAppSession(
                senderPhone,
                {
                    state: "HOME_COLLECTION_RESCHEDULE_TIME",
                    date: selectedDate,
                    homeCollectionRequestId: session.homeCollectionRequestId || "",
                    doctorId: "",
                    time: "",
                    appointmentId: "",
                    location: ""
                }
            );

            sendWhatsAppMenuReply(
                ss,
                senderPhone,
                "🕐 Choose a new preferred time window:",
                getHomeCollectionTimeWindowSpec(selectedDate)
            );

            return true;
        }

        if (
            normalizedMessage === "3" ||
            normalizedMessage === "date_custom"
        ) {
            saveWhatsAppSession(
                senderPhone,
                {
                    state: "HOME_COLLECTION_RESCHEDULE_DATE_CUSTOM",
                    homeCollectionRequestId: session.homeCollectionRequestId || "",
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
                "Please enter the new preferred date in YYYY-MM-DD format.\n\n" +
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
            "❌ Invalid option.\n\nChoose a new preferred date:",
            "patient"
        );
        return true;
    }


    // ======================================================
    // RESCHEDULE HOME COLLECTION → CUSTOM DATE
    // ======================================================

    if (session.state === "HOME_COLLECTION_RESCHEDULE_DATE_CUSTOM") {

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

        const availableTimeWindows =
            getHomeCollectionTimeWindowOptionsForDate(
                validation.date
            );

        if (availableTimeWindows.length === 0) {
            sendCustomDateEntryMenuReply(
                ss,
                senderPhone,
                "⏰ There are no available home collection time windows for that date. Please choose another date."
            );
            return true;
        }

        saveWhatsAppSession(
            senderPhone,
            {
                state: "HOME_COLLECTION_RESCHEDULE_TIME",
                date: validation.date,
                homeCollectionRequestId: session.homeCollectionRequestId || "",
                doctorId: "",
                time: "",
                appointmentId: "",
                location: ""
            }
        );

        sendWhatsAppMenuReply(
            ss,
            senderPhone,
            "🕐 Choose a new preferred time window:",
            getHomeCollectionTimeWindowSpec(validation.date)
        );

        return true;
    }


    // ======================================================
    // RESCHEDULE HOME COLLECTION → TIME
    // ======================================================

    if (session.state === "HOME_COLLECTION_RESCHEDULE_TIME") {

        const availableTimeWindows =
            getHomeCollectionTimeWindowOptionsForDate(
                session.date
            );

        const selectedTimeWindow =
            availableTimeWindows.find(function (option) {
                return (
                    option.id === normalizedMessage ||
                    option.title.toLowerCase() === String(normalizedMessage || "").toLowerCase()
                );
            });

        if (!selectedTimeWindow) {
            sendWhatsAppMenuReply(
                ss,
                senderPhone,
                "❌ That time window is no longer available.\n\n" +
                "Choose a new preferred time window:",
                getHomeCollectionTimeWindowSpec(session.date)
            );
            return true;
        }

        const result =
            rescheduleHomeCollectionRequestByPatient(
                session.homeCollectionRequestId,
                senderPhone,
                session.date,
                selectedTimeWindow.value
            );

        saveWhatsAppSession(
            senderPhone,
            {
                role: "PATIENT",
                state: "MAIN_MENU",
                homeCollectionRequestId: result.ok
                    ? result.requestId
                    : session.homeCollectionRequestId || "",
                doctorId: "",
                date: "",
                time: "",
                appointmentId: "",
                location: ""
            }
        );

        if (result.ok) {
            sendWhatsAppText(
                senderPhone,
                "✅ Home sample collection rescheduled successfully.\n\n" +
                "🆔 Request ID: " + result.requestId + "\n" +
                "📅 Date: " + result.date + "\n" +
                "🕐 Time: " + result.timeWindow
            );
        } else {
            const message =
                result.reason === "already_completed"
                    ? "ℹ️ This home sample collection has already been completed."
                    : result.reason === "already_cancelled"
                        ? "ℹ️ This home sample collection has already been cancelled."
                        : result.reason === "not_authorized"
                            ? "❌ This home sample collection request does not belong to you."
                            : "❌ We couldn't reschedule that home sample collection request. Please try again or contact the clinic.";

            sendWhatsAppText(
                senderPhone,
                message
            );
        }

        return true;
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

            const availableTimeWindows =
                getHomeCollectionTimeWindowOptionsForDate(
                    selectedDate
                );

            if (availableTimeWindows.length === 0) {

                sendDateMenuReply(
                    ss,
                    senderPhone,
                    "⏰ There are no time windows left for today with the " +
                    getHomeCollectionMinLeadHours() +
                    "-hour minimum notice.\n\nChoose another date:",
                    "patient"
                );

                return true;
            }

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
                getHomeCollectionTimeWindowSpec(selectedDate)
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
            getHomeCollectionTimeWindowSpec(validation.date)
        );

        return true;
    }


    // ======================================================
    // WAITING FOR A TIME WINDOW → SAVE THE REQUEST
    // ======================================================

    if (session.state === "HOME_COLLECTION_TIME") {

        const availableTimeWindows =
            getHomeCollectionTimeWindowOptionsForDate(
                session.date
            );

        const selectedTimeWindow =
            availableTimeWindows.find(function (option) {
                return (
                    option.id === normalizedMessage ||
                    option.title.toLowerCase() === String(normalizedMessage || "").toLowerCase()
                );
            });

        if (!selectedTimeWindow) {

            // If the user is booking for today and a window has just become
            // unavailable, rebuild the menu using the current time rather
            // than accepting a stale option from an earlier message.
            sendWhatsAppMenuReply(
                ss,
                senderPhone,
                "❌ That time window is no longer available.\n\n" +
                "Choose a preferred time window:",
                getHomeCollectionTimeWindowSpec(session.date)
            );

            return true;
        }

        const timeWindow =
            selectedTimeWindow.value;

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

        const homeCollectionResult =
            createHomeCollectionRequest({
                phone: senderPhone,
                patientName: patientName,
                latitude: latitude,
                longitude: longitude,
                distanceKm: distanceKm,
                date: session.date,
                timeWindow: timeWindow
            });

        if (homeCollectionResult && homeCollectionResult.duplicate) {
            const existing =
                homeCollectionResult.existingRequest || {};

            saveWhatsAppSession(
                senderPhone,
                {
                    role: "PATIENT",
                    state: "HOME_COLLECTION_ACTIVE",
                    homeCollectionRequestId: existing.requestId || homeCollectionResult.requestId || "",
                    doctorId: "",
                    date: existing.date || session.date || "",
                    time: existing.timeWindow || "",
                    appointmentId: "",
                    location: ""
                }
            );

            sendWhatsAppMenuReply(
                ss,
                senderPhone,
                "⚠️ You already have an active home sample collection request.\n\n" +
                "🆔 Request ID: " +
                (existing.requestId || homeCollectionResult.requestId || "") +
                "\n📅 Date: " +
                (existing.date || session.date || "") +
                "\n🕐 Time: " +
                (existing.timeWindow || "") +
                "\n📌 Status: " +
                (existing.status || "Pending") +
                "\n\nPlease wait for the collection to be completed before creating another request.",
                getHomeCollectionCompletionMenuSpec()
            );

            return true;
        }

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

        const confirmationText =
            "✅ Home sample collection requested for " +
            session.date +
            " (" +
            timeWindow +
            ").\n\n" +
            "Our team will call you shortly to confirm the exact time.";

        const confirmationSession =
            getWhatsAppSession(senderPhone);

        const confirmationLanguage =
            resolvePatientLanguage(
                senderPhone,
                confirmationSession
            );

        sendWhatsAppText(
            senderPhone,
            localizeWhatsAppReply(
                confirmationLanguage,
                confirmationText
            )
        );

        return true;
    }

    return false;
}


// Ported from ABC_Clinic_WhatsApp_Complete.gs (monolith is the source of truth).
function handleWhatsAppHomeCollectionPersonMessage(ss, senderPhone, senderName, messageText, normalizedMessage, session) {
    if (!session || session.role !== "HOME_COLLECTION_PERSON") return false;
    const collector = findHomeCollectionPersonByWhatsAppPhone(senderPhone);
    if (!collector.found) return false;

    if (normalizedMessage === "hc_today" || normalizedMessage === "1") {
        const today = Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd");
        sendHomeCollectionRequestsListReply(ss, senderPhone, "Today's Collections",
            getHomeCollectionRequestsForCollector(false, collector.personId).filter(function(r) { return r.date === today; }));
        return true;
    }

    if (normalizedMessage === "hc_upcoming" || normalizedMessage === "2") {
        const today = Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd");
        sendHomeCollectionRequestsListReply(ss, senderPhone, "Upcoming Collections",
            getHomeCollectionRequestsForCollector(false, collector.personId).filter(function(r) { return r.date >= today; }));
        return true;
    }

    if (normalizedMessage === "hc_more" || normalizedMessage === "3") {
        sendWhatsAppMenuReply(ss, senderPhone, "More options", {
            fallbackText: "All Pending Collections\nMain Menu",
            interactive: buildInteractiveButtonSpec([
                { id: "hc_all_pending", title: "All Pending" },
                { id: "nav_main_menu", title: "Main Menu" }
            ])
        });
        return true;
    }

    if (normalizedMessage === "hc_all_pending") {
        sendHomeCollectionRequestsListReply(ss, senderPhone, "All Pending Collections",
            getHomeCollectionRequestsForCollector(false, collector.personId).filter(function(r) {
                return String(r.status || "").toLowerCase() === "pending";
            }));
        return true;
    }

    if (normalizedMessage.indexOf("hc_accept_row_") === 0) {
        const rowNumber = normalizedMessage.substring("hc_accept_row_".length);
        const result = acceptHomeCollectionRequestByRow(rowNumber, collector.personId);

        if (result.ok) {
            const request = result.request;
            sendHomeCollectionPersonMenuReply(
                ss,
                senderPhone,
                collector.name,
                "✅ Collection accepted.\n\n" +
                "Request: " + request.requestId + "\n" +
                "👤 " + (request.patientName || "Patient") + "\n" +
                "📅 " + request.date + "\n" +
                "🕐 " + request.timeWindow + "\n\n" +
                "This collection is now assigned to you."
            );
            return true;
        }

        if (result.reason === "already_accepted_by_self") {
            sendHomeCollectionPersonMenuReply(ss, senderPhone, collector.name,
                "✅ This collection is already assigned to you.");
            return true;
        }

        if (result.reason === "already_accepted") {
            sendHomeCollectionPersonMenuReply(ss, senderPhone, collector.name,
                "ℹ️ This collection has already been assigned to another collection person.");
            return true;
        }

        if (result.reason === "already_completed") {
            sendHomeCollectionPersonMenuReply(ss, senderPhone, collector.name,
                "ℹ️ This collection has already been completed.");
            return true;
        }

        sendHomeCollectionPersonMenuReply(ss, senderPhone, collector.name,
            "❌ Collection request not found or is no longer available.");
        return true;
    }

    if (normalizedMessage.indexOf("hc_view_row_") === 0) {
        const rowNumber = normalizedMessage.substring("hc_view_row_".length);
        const request = getHomeCollectionRequestByRow(rowNumber);
        if (request && request.acceptedBy && request.acceptedBy !== collector.personId) {
            sendHomeCollectionPersonMenuReply(ss, senderPhone, collector.name,
                "ℹ️ This collection has already been assigned to another collection person.");
            return true;
        }
        sendHomeCollectionRequestDetailReply(ss, senderPhone, request);
        return true;
    }

    // Backward compatibility for older list messages.
    if (normalizedMessage.indexOf("hc_view_") === 0) {
        const request = getHomeCollectionRequestById(
            normalizedMessage.substring(8)
        );
        if (request && request.acceptedBy && request.acceptedBy !== collector.personId) {
            sendHomeCollectionPersonMenuReply(ss, senderPhone, collector.name,
                "ℹ️ This collection has already been assigned to another collection person.");
            return true;
        }
        sendHomeCollectionRequestDetailReply(ss, senderPhone, request);
        return true;
    }

    if (normalizedMessage.indexOf("hc_complete_row_") === 0) {
        const rowNumber = normalizedMessage.substring("hc_complete_row_".length);
        const result = markHomeCollectionRequestCompletedByRow(
            rowNumber, collector.name, collector.personId);
        const msg = result.ok
            ? "✅ Collection " + (result.requestId || "") + " marked Completed."
            : result.reason === "already_completed"
                ? "ℹ️ This collection has already been marked Completed."
                : result.reason === "assigned_to_other"
                    ? "ℹ️ This collection is assigned to another collection person."
                    : result.reason === "not_accepted"
                        ? "ℹ️ Please accept this collection before marking it Completed."
                        : "❌ Collection request not found.";
        sendHomeCollectionPersonMenuReply(ss, senderPhone, collector.name, msg);
        return true;
    }

    if (normalizedMessage.indexOf("hc_complete_") === 0) {
        const requestId = normalizedMessage.substring("hc_complete_".length);
        const result = markHomeCollectionRequestCompleted(
            requestId, collector.name, collector.personId);
        const msg = result.ok
            ? "✅ Collection " + requestId + " marked Completed."
            : result.reason === "already_completed"
                ? "ℹ️ This collection has already been marked Completed."
                : result.reason === "assigned_to_other"
                    ? "ℹ️ This collection is assigned to another collection person."
                    : result.reason === "not_accepted"
                        ? "ℹ️ Please accept this collection before marking it Completed."
                        : "❌ Collection request not found.";
        sendHomeCollectionPersonMenuReply(ss, senderPhone, collector.name, msg);
        return true;
    }

    sendHomeCollectionPersonMenuReply(ss, senderPhone, collector.name,
        "❌ Please choose one of the available options.");
    return true;
}


// Ported from ABC_Clinic_WhatsApp_Complete.gs (monolith is the source of truth).
function notifyHomeCollectionPersons(requestId, details) {
    const people = getActiveHomeCollectionPersons();
    if (!people.length) return;

    // Resolve the authoritative request from the sheet. The patient name,
    // phone, date, time window and location in the notification all come
    // from the saved request record, not from inbound WhatsApp text.
    const requestRecord = getHomeCollectionRequestById(requestId);
    if (!requestRecord) {
        Logger.log("Home collection notification skipped: request not found " + requestId);
        return;
    }

    const body = "🩸 New Home Sample Collection\n\n" +
        "Request: " + requestRecord.requestId + "\n" +
        "👤 " + (requestRecord.patientName || "Patient") + "\n" +
        "📞 " + (requestRecord.phone || "") + "\n" +
        "📅 " + requestRecord.date + "\n" +
        "🕐 " + requestRecord.timeWindow + "\n" +
        "📏 " + Number(requestRecord.distanceKm || 0).toFixed(1) + " km\n\n" +
        "📍 Patient location:\n" + (requestRecord.mapsUrl || "Location unavailable") + "\n\n" +
        "Please review and accept the request.";

    const requestRow = requestRecord.row;

    const inboundMessageId = getWhatsAppInboundMessageId();
    clearWhatsAppInboundMessageContext();

    try {
        people.forEach(function(person) {
            try {
                sendWhatsAppMenuReply(SpreadsheetApp.getActiveSpreadsheet(), person.whatsapp, body, {
                    fallbackText: body,
                    interactive: buildInteractiveButtonSpec([
                        {
                            id: "hc_accept_row_" + requestRow,
                            title: "Accept Collection"
                        },
                        {
                            id: "hc_view_row_" + requestRow,
                            title: "View Details"
                        },
                        {
                            id: "nav_main_menu",
                            title: "Main Menu"
                        }
                    ])
                });
            } catch (error) {
                Logger.log("Home collection notification failed for " + person.personId + ": " + error.message);
            }
        });
    } finally {
        if (inboundMessageId) {
            setWhatsAppInboundMessageContext(inboundMessageId);
        }
    }
}


// Ported from ABC_Clinic_WhatsApp_Complete.gs (monolith is the source of truth).
function notifyHomeCollectionCancellationToCollector(requestRecord) {
    if (!requestRecord || !requestRecord.acceptedBy) {
        return;
    }

    const people = getActiveHomeCollectionPersons();
    const collector = people.find(function(person) {
        return String(person.personId || "").trim() ===
            String(requestRecord.acceptedBy || "").trim();
    });

    if (!collector || !collector.whatsapp) {
        Logger.log(
            "Home collection cancellation notification skipped: assigned collector not found " +
            String(requestRecord.acceptedBy || "")
        );
        return;
    }

    const body =
        "❌ Home Sample Collection Cancelled\n\n" +
        "Request: " + (requestRecord.requestId || "") + "\n" +
        "👤 " + (requestRecord.patientName || "Patient") + "\n" +
        "📞 " + (requestRecord.phone || "") + "\n" +
        "📅 " + (requestRecord.date || "") + "\n" +
        "🕐 " + (requestRecord.timeWindow || "") + "\n\n" +
        "The patient has cancelled this home sample collection request.\n" +
        "No collection action is required.";

    const inboundMessageId = getWhatsAppInboundMessageId();
    clearWhatsAppInboundMessageContext();

    try {
        sendWhatsAppText(collector.whatsapp, body);
    } catch (error) {
        Logger.log(
            "Home collection cancellation notification failed for " +
            collector.personId + ": " + error.message
        );
    } finally {
        if (inboundMessageId) {
            setWhatsAppInboundMessageContext(inboundMessageId);
        }
    }
}
