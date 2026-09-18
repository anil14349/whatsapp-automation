/**
 * How a date and time are shown to a patient.
 *
 * Shared because the reminder and the booking confirmation describe the same
 * appointment: one saying "2026-09-19 at 10:00" while the other says
 * "Saturday, 19 September at 10:00 am" reads like two different bookings.
 */

/**
 * "Friday, 18 September" — the weekday is what a patient checks against.
 *
 * Formatted in UTC because the input is a bare date; reading it in a zone
 * behind UTC would show the day before.
 */
export function formatLongDate(dateString: string, language: string): string {
    try {
        return new Intl.DateTimeFormat(language === "EN" ? "en-IN" : "hi-IN", {
            weekday: "long",
            day: "numeric",
            month: "long",
            timeZone: "UTC"
        }).format(new Date(`${dateString}T00:00:00Z`));
    } catch {
        return dateString;
    }
}

/** 24 hour times are what the database holds; "11:30 am" is what people read. */
export function formatClockTime(time: string): string {
    const match = /^(\d{1,2}):(\d{2})$/.exec(time ?? "");

    if (!match) {
        return time;
    }

    const hour = Number(match[1]);
    const suffix = hour < 12 ? "am" : "pm";
    const twelve = hour % 12 === 0 ? 12 : hour % 12;

    return `${twelve}:${match[2]} ${suffix}`;
}
