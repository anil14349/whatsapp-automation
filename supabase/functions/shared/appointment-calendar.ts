/**
 * The appointment as a calendar file.
 *
 * A confirmation in a chat is a thing to remember; a calendar entry is a thing
 * that reminds you. One tap puts the appointment in the patient's own phone,
 * with its own alarm, and it survives them losing the conversation.
 *
 * Best effort throughout. A booking is confirmed the moment the row is
 * written, so nothing here may be allowed to make it look otherwise.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { WhatsAppClient } from "./whatsapp-client.ts";
import { SIGNED_URL_SECONDS } from "./patient-documents.ts";
import { clinicInstant } from "./clinic-slots.ts";
import { debug } from "./logger.ts";

/**
 * Its own bucket, not the one patient documents use.
 *
 * That one allows PDF, JPEG and PNG only, on purpose, and a calendar file is
 * none of them -- the first attempt was refused with a 400 that the
 * best-effort catch would have swallowed forever. Widening that allow-list to
 * fit this would have loosened a control that exists for uploads a
 * receptionist supplies.
 */
export const CALENDAR_BUCKET = "appointment-calendar";

const DEFAULT_MINUTES = 30;
export interface CalendarEvent {
    appointmentId: string;
    clinicName: string;
    doctorName?: string;
    date: string;
    time: string;
    timezone: string;
    location?: string;
    token?: number | null;
    durationMinutes?: number;
    language?: string;
}

/**
 * What the patient sees as the attachment's name.
 *
 * "appointment.ics" tells them nothing in a list of files a year later, so it
 * carries the day and the doctor. Dots are stripped from the rest of the name
 * because a phone decides how to open a file from its last one.
 */
export function calendarFileName(event: CalendarEvent): string {
    const day = new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        timeZone: "UTC"
    }).format(new Date(`${event.date}T00:00:00Z`));

    const who = event.doctorName ? ` - Dr ${event.doctorName}` : "";

    return `Appointment ${day}${who}`.replace(/[^A-Za-z0-9 -]/g, "").trim() + ".ics";
}

/** ICS wants UTC as 20260918T060000Z. */
function stamp(at: Date): string {
    return at.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * Commas, semicolons and newlines end a field unless they are escaped, so an
 * address like "12 Nehru Road, Delhi" would otherwise truncate the entry.
 */
function escapeText(value: string): string {
    return value
        .replace(/\\/g, "\\\\")
        .replace(/;/g, "\\;")
        .replace(/,/g, "\\,")
        .replace(/\r?\n/g, "\\n");
}

export function buildIcs(event: CalendarEvent): string {
    const start = clinicInstant(event.date, event.time, event.timezone);
    const end = new Date(
        start.getTime() + (event.durationMinutes ?? DEFAULT_MINUTES) * 60 * 1000
    );

    const title = event.doctorName
        ? `Appointment with Dr. ${event.doctorName}`
        : `Appointment at ${event.clinicName}`;

    const description = [
        event.clinicName,
        event.token ? `Token ${event.token}` : "",
        "Booked on WhatsApp."
    ]
        .filter(Boolean)
        .join("\n");

    // CRLF is required by RFC 5545; some calendar apps reject bare newlines.
    return [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Clinic//WhatsApp Booking//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        `UID:${event.appointmentId}@clinic.whatsapp`,
        `DTSTAMP:${stamp(new Date())}`,
        `DTSTART:${stamp(start)}`,
        `DTEND:${stamp(end)}`,
        `SUMMARY:${escapeText(title)}`,
        ...(event.location ? [`LOCATION:${escapeText(event.location)}`] : []),
        `DESCRIPTION:${escapeText(description)}`,
        "BEGIN:VALARM",
        "TRIGGER:-PT1H",
        "ACTION:DISPLAY",
        "DESCRIPTION:Appointment in one hour",
        "END:VALARM",
        "END:VEVENT",
        "END:VCALENDAR"
    ].join("\r\n");
}

/**
 * Store the file and hand Meta a link to it.
 *
 * Served as `text/calendar`. It went out as `text/plain` first, on the
 * assumption that Meta's document endpoint would refuse anything outside its
 * documented media types -- it does not, and the file arrived looking like a
 * text file because that is what we had called it.
 */
export async function sendAppointmentCalendar(
    supabase: SupabaseClient,
    client: WhatsAppClient,
    clinicId: string,
    phone: string,
    event: CalendarEvent
): Promise<boolean> {
    try {
        const path = `${clinicId}/calendar/${event.appointmentId}.ics`;

        const upload = await supabase.storage
            .from(CALENDAR_BUCKET)
            .upload(path, new TextEncoder().encode(buildIcs(event)), {
                contentType: "text/calendar",
                upsert: true
            });

        if (upload.error) {
            debug("appointmentCalendar", "Could not store the file", {
                error: upload.error.message
            });
            return false;
        }

        const signed = await supabase.storage
            .from(CALENDAR_BUCKET)
            .createSignedUrl(path, SIGNED_URL_SECONDS);

        if (signed.error || !signed.data?.signedUrl) {
            debug("appointmentCalendar", "Could not sign the link", {
                error: signed.error?.message
            });
            return false;
        }

        await client.sendDocumentMessage(
            phone,
            signed.data.signedUrl,
            calendarFileName(event),
            event.language === "HI"
                ? "📅 इसे खोलकर अपने कैलेंडर ऐप में जोड़ें"
                : "📅 Open this to add the appointment to your calendar",
            supabase
        );

        return true;
    } catch (error) {
        debug("appointmentCalendar", "Could not send the calendar file", {
            error: error instanceof Error ? error.message : String(error)
        });
        return false;
    }
}
