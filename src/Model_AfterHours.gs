// ============================================================
// Model_AfterHours — part of the ABC Clinic WhatsApp bot
// Clinic-hours gate and after-hours auto-reply for patients.
// See src/Config.gs for the full file-layout map and Script Properties.
// ============================================================



function parseClinicWorkingDays(value) {

    const raw =
        String(value || "").trim();

    const defaultDays = [
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday"
    ];

    if (!raw) {
        return defaultDays;
    }

    const days = [];
    const seen = {};

    raw.split(",")
        .forEach(function (part) {

            const key =
                String(part || "")
                    .trim()
                    .toLowerCase();

            const dayName =
                CLINIC_DAY_ALIASES[key];

            if (
                dayName &&
                !seen[dayName]
            ) {
                seen[dayName] = true;
                days.push(dayName);
            }
        });

    return days.length > 0
        ? days
        : defaultDays;
}



function formatClinicTimeForDisplay(value) {

    const normalized =
        normalizeAvailabilityTimeInput(
            value
        );

    if (normalized) {
        return normalized;
    }

    const time24 =
        convert12HourTo24Hour(value);

    if (!time24) {
        return String(value || "").trim();
    }

    const parts =
        time24.split(":");

    let hour =
        Number(parts[0]);

    const minute =
        parts[1];

    const suffix =
        hour >= 12 ? "PM" : "AM";

    hour = hour % 12;
    if (hour === 0) {
        hour = 12;
    }

    return (
        hour +
        ":" +
        minute +
        " " +
        suffix
    );
}



function formatClinicWorkingDaysForDisplay(
    workingDays
) {

    const shortNames = {
        Monday: "Mon",
        Tuesday: "Tue",
        Wednesday: "Wed",
        Thursday: "Thu",
        Friday: "Fri",
        Saturday: "Sat",
        Sunday: "Sun"
    };

    const labels =
        (workingDays || []).map(
            function (day) {
                return (
                    shortNames[day] ||
                    day
                );
            }
        );

    if (labels.length === 0) {
        return "Mon–Sat";
    }

    if (labels.length === 1) {
        return labels[0];
    }

    return (
        labels[0] +
        "–" +
        labels[labels.length - 1]
    );
}



function getAfterHoursSettings() {

    ensureSettingsSheet();

    const enabled =
        parseSettingsBoolean(
            getSetting(
                "ENABLE_AFTER_HOURS_REPLY",
                "FALSE"
            ),
            false
        );

    const openTime =
        getSetting(
            "CLINIC_OPEN_TIME",
            "09:00"
        );

    const closeTime =
        getSetting(
            "CLINIC_CLOSE_TIME",
            "18:00"
        );

    const workingDays =
        parseClinicWorkingDays(
            getSetting(
                "CLINIC_WORKING_DAYS",
                "Mon,Tue,Wed,Thu,Fri,Sat"
            )
        );

    const customMessage =
        String(
            getSetting(
                "AFTER_HOURS_MESSAGE",
                ""
            ) || ""
        ).trim();

    return {
        enabled: enabled,
        openTime: openTime,
        closeTime: closeTime,
        workingDays: workingDays,
        customMessage: customMessage,
        openTimeDisplay:
            formatClinicTimeForDisplay(
                openTime
            ),
        closeTimeDisplay:
            formatClinicTimeForDisplay(
                closeTime
            ),
        workingDaysDisplay:
            formatClinicWorkingDaysForDisplay(
                workingDays
            )
    };
}



function isWithinClinicHours(
    now,
    settings
) {

    const current =
        now instanceof Date
            ? now
            : new Date();

    const config =
        settings ||
        getAfterHoursSettings();

    const dayName =
        Utilities.formatDate(
            current,
            TIMEZONE,
            "EEEE"
        );

    if (
        config.workingDays.indexOf(
            dayName
        ) === -1
    ) {
        return false;
    }

    const openAt =
        parseAvailabilityTimeValue(
            config.openTime,
            current
        );

    const closeAt =
        parseAvailabilityTimeValue(
            config.closeTime,
            current
        );

    if (
        !openAt ||
        !closeAt
    ) {

        // CLINIC_OPEN_TIME/CLINIC_CLOSE_TIME failed to parse. Fail
        // open (treat as within clinic hours) rather than blocking
        // patients on a configuration typo, but log it loudly so the
        // misconfiguration doesn't go unnoticed and the after-hours
        // feature doesn't silently stay disabled indefinitely.
        Logger.log(
            "isWithinClinicHours: could not parse CLINIC_OPEN_TIME/" +
            "CLINIC_CLOSE_TIME (openTime=" + config.openTime +
            ", closeTime=" + config.closeTime +
            "). Treating as within clinic hours."
        );

        return true;
    }

    const nowMs =
        current.getTime();

    return (
        nowMs >= openAt.getTime() &&
        nowMs < closeAt.getTime()
    );
}



function isActivePatientFlowSession(session) {

    if (
        !session ||
        !session.state
    ) {
        return false;
    }

    const idleStates = [
        "MAIN_MENU"
    ];

    return (
        idleStates.indexOf(
            String(session.state).trim()
        ) === -1
    );
}



function shouldBlockPatientForAfterHours(
    senderPhone,
    session
) {

    const settings =
        getAfterHoursSettings();

    if (!settings.enabled) {
        return false;
    }

    if (
        findDoctorByWhatsAppPhone(
            senderPhone
        )
    ) {
        return false;
    }

    if (
        session &&
        session.role === "DOCTOR"
    ) {
        return false;
    }

    if (
        isWithinClinicHours(
            new Date(),
            settings
        )
    ) {
        return false;
    }

    if (
        isActivePatientFlowSession(
            session
        )
    ) {
        return false;
    }

    return true;
}



function resolveLanguageForAfterHoursReply(
    phone,
    session
) {

    let language =
        session &&
        String(session.language || "")
            .trim()
            .toUpperCase();

    if (
        ["EN", "TE", "HI", "KA", "TA", "ML"].indexOf(
            language
        ) !== -1
    ) {
        return language;
    }

    return resolvePatientLanguageFromRegistry(
        phone
    );
}



function buildAfterHoursMessage(
    language,
    settings
) {

    const config =
        settings ||
        getAfterHoursSettings();

    if (config.customMessage) {
        return config.customMessage;
    }

    const hoursLine =
        config.workingDaysDisplay +
        ", " +
        config.openTimeDisplay +
        " – " +
        config.closeTimeDisplay;

    // {{CLINIC_NAME}} — not a direct getClinicName() call — so this
    // literal text still matches the localization dictionary's key in
    // localizeWhatsAppReply() below; the final substitution there
    // replaces the placeholder with the real name for every language.
    const message =
        "🕐 " +
        "{{CLINIC_NAME}} is currently closed.\n\n" +
        "Our hours: " +
        hoursLine +
        "\n\n" +
        "Please message us during clinic hours to book or manage appointments.\n\n" +
        "Reply Hi during open hours to get started.";

    return localizeWhatsAppReply(
        language,
        message
    );
}



function sendAfterHoursPatientReply(
    ss,
    phone,
    session
) {

    const language =
        resolveLanguageForAfterHoursReply(
            phone,
            session
        );

    const settings =
        getAfterHoursSettings();

    sendWhatsAppReply(
        ss,
        phone,
        buildAfterHoursMessage(
            language,
            settings
        )
    );
}



function handleAfterHoursPatientGate(
    ss,
    senderPhone,
    session
) {

    if (
        !shouldBlockPatientForAfterHours(
            senderPhone,
            session
        )
    ) {
        return false;
    }

    sendAfterHoursPatientReply(
        ss,
        senderPhone,
        session
    );

    return true;
}
