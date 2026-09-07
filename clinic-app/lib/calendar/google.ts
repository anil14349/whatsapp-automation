import { google } from "googleapis";
import { getServerEnv } from "@/lib/env";
import type { CalendarEvent, CalendarPort } from "./types";

/**
 * Real Google Calendar implementation via a service account — the
 * doctor's calendar must be shared with the service account's email
 * (Calendar Settings -> Share with specific people -> "Make changes to
 * events"), same requirement as the Apps Script version needed the
 * *executing Google account* to have access to `doctor.calendarId`.
 *
 * NOT exercised by any test in this repo — this environment has no live
 * Google credentials to test against. lib/calendar/fake.ts is what the
 * booking/cancel/reschedule logic is actually tested with; this file
 * only needs to satisfy the same CalendarPort interface correctly.
 */

let cachedClient: ReturnType<typeof google.calendar> | null = null;

function getCalendarClient() {
  if (cachedClient) {
    return cachedClient;
  }

  const env = getServerEnv();

  if (!env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY are not configured."
    );
  }

  const auth = new google.auth.JWT({
    email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    // .env files can't hold real newlines in a single value; the private
    // key is stored with literal "\n" sequences and un-escaped here.
    key: env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/calendar"]
  });

  cachedClient = google.calendar({ version: "v3", auth });
  return cachedClient;
}

function toCalendarEvent(event: {
  id?: string | null;
  start?: { dateTime?: string | null } | null;
  end?: { dateTime?: string | null } | null;
}): CalendarEvent | null {
  if (!event.id || !event.start?.dateTime || !event.end?.dateTime) {
    return null;
  }

  return {
    id: event.id,
    start: new Date(event.start.dateTime),
    end: new Date(event.end.dateTime)
  };
}

export class GoogleCalendar implements CalendarPort {
  async getEventsForDay(calendarId: string, date: Date): Promise<CalendarEvent[]> {
    const dayStart = new Date(date);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

    const calendar = getCalendarClient();

    const response = await calendar.events.list({
      calendarId,
      timeMin: dayStart.toISOString(),
      timeMax: dayEnd.toISOString(),
      singleEvents: true,
      orderBy: "startTime"
    });

    return (response.data.items ?? [])
      .map(toCalendarEvent)
      .filter((event): event is CalendarEvent => event !== null);
  }

  async createEvent(
    calendarId: string,
    params: { title: string; start: Date; end: Date; description: string; location: string }
  ): Promise<CalendarEvent> {
    const calendar = getCalendarClient();

    const response = await calendar.events.insert({
      calendarId,
      requestBody: {
        summary: params.title,
        description: params.description,
        location: params.location,
        start: { dateTime: params.start.toISOString() },
        end: { dateTime: params.end.toISOString() }
      }
    });

    const event = toCalendarEvent(response.data);

    if (!event) {
      throw new Error("Google Calendar returned an incomplete event after creation.");
    }

    return event;
  }

  async deleteEvent(calendarId: string, eventId: string): Promise<void> {
    const calendar = getCalendarClient();

    try {
      await calendar.events.delete({ calendarId, eventId });
    } catch (error) {
      // Deleting an already-deleted/nonexistent event is a no-op from the
      // caller's perspective (typically a rollback path) — Google
      // returns 410 Gone for that case.
      const status = (error as { code?: number; response?: { status?: number } })
        ?.response?.status;

      if (status !== 404 && status !== 410) {
        throw error;
      }
    }
  }

  async getEventById(calendarId: string, eventId: string): Promise<CalendarEvent | null> {
    const calendar = getCalendarClient();

    try {
      const response = await calendar.events.get({ calendarId, eventId });
      return toCalendarEvent(response.data);
    } catch (error) {
      const status = (error as { code?: number; response?: { status?: number } })
        ?.response?.status;

      if (status === 404 || status === 410) {
        return null;
      }

      throw error;
    }
  }
}
