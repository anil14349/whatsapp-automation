// ============================================================
// Util_Common — part of the ABC Clinic WhatsApp bot
// Phone/date/time parsing & formatting helpers shared across models and controllers.
// See src/Config.gs for the full file-layout map and Script Properties.
// ============================================================



// ========================================================
// TIMEZONE HELPERS
// ========================================================
// Get the ISO 8601 offset string for the configured TIMEZONE
// e.g., "Asia/Kolkata" → "+05:30"
// CACHED: Timezone offset doesn't change during script execution
let __cachedTimezoneOffset = null;

function getTimezoneOffsetString() {

    // ========================================================
    // CACHING: Return cached offset if available
    // ========================================================
    // Timezone offset is constant for script lifetime;
    // avoid recomputation on every datetime build

    if (__cachedTimezoneOffset !== null) {
        return __cachedTimezoneOffset;
    }

    const now = new Date();

    const utcDate =
        new Date(now.getTime() +
        now.getTimezoneOffset() * 60000);

    const tzDate =
        new Date(
            Utilities.formatDate(now, TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss")
        );

    const diffMs =
        tzDate.getTime() - utcDate.getTime();

    const diffMins = Math.round(diffMs / 60000);
    const hours = Math.floor(Math.abs(diffMins) / 60);
    const mins = Math.abs(diffMins) % 60;

    const sign = diffMins >= 0 ? "+" : "-";

    __cachedTimezoneOffset =
        sign +
        String(hours).padStart(2, "0") + ":" +
        String(mins).padStart(2, "0");

    return __cachedTimezoneOffset;
}


// Build ISO 8601 datetime string with configured timezone offset
// e.g., buildISODatetimeWithTimezone("2026-09-12", "14:30")
//       → "2026-09-12T14:30:00+05:30"
function buildISODatetimeWithTimezone(dateString, timeString) {

    if (!dateString) {
        return "";
    }

    const tzOffset = getTimezoneOffsetString();

    if (!timeString) {
        return dateString + "T00:00:00" + tzOffset;
    }

    return dateString + "T" + timeString + ":00" + tzOffset;
}



function normalizeWhatsAppPhone(phone) {

    const digits =
        String(phone || "").replace(/\D/g, "");

    return digits.length > 10
        ? digits.slice(-10)
        : digits;
}


function phonesMatch(phoneA, phoneB) {

    const a = normalizeWhatsAppPhone(phoneA);
    const b = normalizeWhatsAppPhone(phoneB);

    return !!a && a === b;
}


function getRequiredSheet(ss, sheetName) {

    const sheet = ss.getSheetByName(sheetName);

    if (!sheet) {
        throw new Error(
            sheetName + " sheet not found."
        );
    }

    return sheet;
}



function formatWhatsAppRecipientPhone(phone) {

    const digits =
        String(phone || "")
            .replace(/\D/g, "");

    if (!digits) {
        return "";
    }

    if (digits.length === 10) {
        return "91" + digits;
    }

    return digits;
}



function formatAppointmentDisplayDate(value) {

    if (
        value instanceof Date &&
        !isNaN(value.getTime())
    ) {
        return Utilities.formatDate(
            value,
            TIMEZONE,
            "dd-MMM-yyyy"
        );
    }

    const iso =
        normalizeAppointmentDate(value);

    if (iso) {
        return Utilities.formatDate(
            new Date(
                buildISODatetimeWithTimezone(
                    iso,
                    "00:00"
                )
            ),
            TIMEZONE,
            "dd-MMM-yyyy"
        );
    }

    return String(value || "").trim();
}



function formatAppointmentDisplayTime(value) {

    if (
        value instanceof Date &&
        !isNaN(value.getTime())
    ) {
        return Utilities.formatDate(
            value,
            TIMEZONE,
            "hh:mm a"
        );
    }

    const time24 =
        convert12HourTo24Hour(
            formatAppointmentSheetTime(value)
        );

    if (!time24) {
        return String(value || "").trim();
    }

    const parts = time24.split(":");
    let hour = Number(parts[0]);
    const minute = parts[1];
    const suffix = hour >= 12 ? "PM" : "AM";

    hour = hour % 12;
    if (hour === 0) {
        hour = 12;
    }

    return (
        String(hour).padStart(2, "0") +
        ":" +
        minute +
        " " +
        suffix
    );
}



// ============================================================
// TIME HELPERS
// ============================================================

function convert12HourTo24Hour(timeString) {

    const value =
        String(timeString || "").trim();

    // Already normalized 24-hour format: 10:00
    if (/^\d{1,2}:\d{2}$/.test(value)) {

        const parts = value.split(":");
        const hour = Number(parts[0]);
        const minute = Number(parts[1]);

        if (
            hour >= 0 &&
            hour <= 23 &&
            minute >= 0 &&
            minute <= 59
        ) {
            return (
                String(hour).padStart(2, "0") +
                ":" +
                String(minute).padStart(2, "0")
            );
        }
    }

    // User-facing format: 10:00 AM
    const match =
        value.match(
            /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i
        );

    if (!match) {
        return null;
    }

    let hour = Number(match[1]);
    const minute = Number(match[2]);
    const period = match[3].toUpperCase();

    if (
        hour < 1 ||
        hour > 12 ||
        minute < 0 ||
        minute > 59
    ) {
        return null;
    }

    if (period === "AM") {
        if (hour === 12) {
            hour = 0;
        }
    } else {
        if (hour !== 12) {
            hour += 12;
        }
    }

    return (
        String(hour).padStart(2, "0") +
        ":" +
        String(minute).padStart(2, "0")
    );
}



function isValidISODate(dateString) {

    const value =
        String(dateString || "").trim();

    if (
        !/^\d{4}-\d{2}-\d{2}$/.test(value)
    ) {
        return false;
    }

    const parts = value.split("-");
    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const day = Number(parts[2]);

    const date =
        new Date(
            buildISODatetimeWithTimezone(
                value,
                "00:00"
            )
        );

    if (isNaN(date.getTime())) {
        return false;
    }

    return (
        date.getFullYear() === year &&
        date.getMonth() + 1 === month &&
        date.getDate() === day
    );
}



function normalizeAppointmentDate(value) {

    if (value instanceof Date) {
        return Utilities.formatDate(
            value,
            TIMEZONE,
            "yyyy-MM-dd"
        );
    }

    const text =
        String(value || "").trim();

    if (!text) {
        return "";
    }

    // Already ISO
    if (isValidISODate(text)) {
        return text;
    }

    // dd-MMM-yyyy
    const match =
        text.match(
            /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/
        );

    if (!match) {
        return "";
    }

    const day =
        Number(match[1]);

    const monthNames = [
        "Jan", "Feb", "Mar",
        "Apr", "May", "Jun",
        "Jul", "Aug", "Sep",
        "Oct", "Nov", "Dec"
    ];

    const month =
        monthNames.indexOf(
            match[2].substring(0, 1).toUpperCase() +
            match[2].substring(1, 3).toLowerCase()
        );

    const year =
        Number(match[3]);

    if (month < 0) {
        return "";
    }

    const iso =
        year +
        "-" +
        String(month + 1).padStart(2, "0") +
        "-" +
        String(day).padStart(2, "0");

    return isValidISODate(iso)
        ? iso
        : "";
}



function formatAppointmentSheetDate(value) {

    if (
        value instanceof Date &&
        !isNaN(value.getTime())
    ) {
        return Utilities.formatDate(
            value,
            TIMEZONE,
            "dd-MMM-yyyy"
        );
    }

    const text =
        String(value || "").trim();

    if (!text) {
        return "";
    }

    const iso =
        normalizeAppointmentDate(text);

    if (iso) {
        return Utilities.formatDate(
            new Date(
                buildISODatetimeWithTimezone(
                    iso,
                    "00:00"
                )
            ),
            TIMEZONE,
            "dd-MMM-yyyy"
        );
    }

    return text;
}



function formatAppointmentSheetTime(value) {

    if (
        value instanceof Date &&
        !isNaN(value.getTime())
    ) {
        return Utilities.formatDate(
            value,
            TIMEZONE,
            "HH:mm"
        );
    }

    const text =
        String(value || "").trim();

    if (!text) {
        return "";
    }

    const time24 =
        convert12HourTo24Hour(text);

    if (time24) {
        return time24;
    }

    if (/^\d{1,2}:\d{2}$/.test(text)) {
        return text;
    }

    return text;
}



function captureAppointmentSheetSnapshot(
    rowValues
) {

    return {
        date: rowValues[1],
        time: rowValues[2],
        status:
            String(rowValues[6] || "Confirmed"),
        eventId:
            String(rowValues[7] || "")
    };
}



function writeAppointmentSheetSchedule(
    sheet,
    row,
    startTime,
    status,
    eventId
) {

    sheet
        .getRange(row, 2)
        .setValue(
            Utilities.formatDate(
                startTime,
                TIMEZONE,
                "dd-MMM-yyyy"
            )
        );

    sheet
        .getRange(row, 3)
        .setValue(
            Utilities.formatDate(
                startTime,
                TIMEZONE,
                "HH:mm"
            )
        );

    sheet
        .getRange(row, 7)
        .setValue(status || "Confirmed");

    if (eventId !== undefined) {
        sheet
            .getRange(row, 8)
            .setValue(String(eventId || ""));
    }
}



function restoreAppointmentSheetSchedule(
    sheet,
    row,
    snapshot
) {

    sheet
        .getRange(row, 2)
        .setValue(
            formatAppointmentSheetDate(
                snapshot.date
            )
        );

    sheet
        .getRange(row, 3)
        .setValue(
            formatAppointmentSheetTime(
                snapshot.time
            )
        );

    sheet
        .getRange(row, 7)
        .setValue(
            snapshot.status || "Confirmed"
        );

    sheet
        .getRange(row, 8)
        .setValue(
            String(snapshot.eventId || "")
        );
}



function parseAppointmentSheetDateTime(
    dateValue,
    timeValue
) {

    const iso =
        normalizeAppointmentDate(dateValue);

    if (!iso) {
        return null;
    }

    const time24 =
        convert12HourTo24Hour(
            formatAppointmentSheetTime(timeValue)
        );

    if (!time24) {
        return null;
    }

    const dateTime =
        new Date(
            buildISODatetimeWithTimezone(
                iso,
                time24
            )
        );

    return isNaN(dateTime.getTime())
        ? null
        : dateTime;
}



// ============================================================
// WHATSAPP HELPERS - APPOINTMENT LISTS & SLOT FORMATTING
// ============================================================
//
// These support the "My Appointments", "Cancel Appointment",
// and "Reschedule Appointment" WhatsApp conversation flows.
//
// ============================================================

function parseAppointmentDateTime(
    dateString,
    timeString
) {

    const MONTHS = {
        Jan: 0, Feb: 1, Mar: 2, Apr: 3,
        May: 4, Jun: 5, Jul: 6, Aug: 7,
        Sep: 8, Oct: 9, Nov: 10, Dec: 11
    };

    const dateParts =
        String(dateString || "")
            .trim()
            .split("-");

    if (dateParts.length !== 3) {
        return null;
    }

    const day = Number(dateParts[0]);
    const month = MONTHS[dateParts[1]];
    const year = Number(dateParts[2]);

    if (
        isNaN(day) ||
        month === undefined ||
        isNaN(year)
    ) {
        return null;
    }

    const time24 =
        convert12HourTo24Hour(timeString);

    if (!time24) {
        return null;
    }

    // Build the instant with an explicit +05:30 offset instead of the
    // new Date(y, m, d, h, min) constructor, which resolves its
    // components in the Apps Script *project's* configured timezone —
    // not necessarily the TIMEZONE constant (Asia/Kolkata) used
    // everywhere else. Matches parseAppointmentSheetDateTime's approach
    // so the two parsers can never disagree on what "now" means relative
    // to a given appointment.
    const iso =
        String(year).padStart(4, "0") +
        "-" +
        String(month + 1).padStart(2, "0") +
        "-" +
        String(day).padStart(2, "0");

    const dateTime =
        new Date(
            buildISODatetimeWithTimezone(
                iso,
                time24
            )
        );

    return isNaN(dateTime.getTime())
        ? null
        : dateTime;
}


function maskPhone(phone) {
    const digits = String(phone || "").replace(/\D/g, "");
    if (!digits) return "";
    if (digits.length <= 4) return digits;
    const visible = digits.slice(-4);
    const hidden = "x".repeat(Math.max(0, digits.length - 4));
    return hidden + visible;
}



// Great-circle distance between two lat/long points, in kilometers.
// Used to gate the home blood-sample-collection service to patients
// within a configurable radius of the hospital (see getHospitalLocation/
// getHomeCollectionRadiusKm in Config.gs).
function haversineDistanceKm(
    lat1,
    lng1,
    lat2,
    lng2
) {

    const EARTH_RADIUS_KM = 6371;

    const toRadians =
        function (degrees) {
            return degrees * (Math.PI / 180);
        };

    const dLat =
        toRadians(lat2 - lat1);

    const dLng =
        toRadians(lng2 - lng1);

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRadians(lat1)) *
        Math.cos(toRadians(lat2)) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);

    const c =
        2 * Math.atan2(
            Math.sqrt(a),
            Math.sqrt(1 - a)
        );

    return EARTH_RADIUS_KM * c;
}



// ============================================================
// TAPPABLE-ONLY ENFORCEMENT
// ============================================================
// (TEXT_INPUT_ALLOWED_STATES constant defined in Config.gs)

function isTextInputAllowedForState(state) {
    return TEXT_INPUT_ALLOWED_STATES.indexOf(state) !== -1;
}

function shouldRejectPlainTextInput(messageType, session) {
    // Allow text input only if:
    // 1. Message is interactive (button/list reply), OR
    // 2. Message is location (shared location), OR
    // 3. Session state explicitly allows text input

    if (messageType === "interactive" || messageType === "location") {
        return false;  // Allow interactive messages and locations
    }

    if (!session || !session.state) {
        return false;  // Allow if no session
    }

    // Reject plain text if state doesn't allow it
    return !isTextInputAllowedForState(session.state);
}


// ============================================================
// NAVIGATION PROTECTION
// ============================================================
// (PROTECTED_BOOKING_STATES constant defined in Config.gs)

function isStateProtectedFromNavigation(state) {
    return PROTECTED_BOOKING_STATES.indexOf(state) !== -1;
}
