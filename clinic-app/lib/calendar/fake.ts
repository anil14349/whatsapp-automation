import type { CalendarEvent, CalendarPort } from "./types";

/**
 * In-memory CalendarPort for tests. Ignores `calendarId` (single shared
 * store) since tests only ever exercise one doctor's calendar at a time.
 */
export class FakeCalendar implements CalendarPort {
  private events: CalendarEvent[] = [];
  private nextId = 1;

  seedEvent(start: Date, end: Date): CalendarEvent {
    const event: CalendarEvent = { id: `seed-${this.nextId++}`, start, end };
    this.events.push(event);
    return event;
  }

  async getEventsForDay(_calendarId: string, date: Date): Promise<CalendarEvent[]> {
    const dayStart = new Date(date);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

    return this.events.filter(
      (event) => event.start.getTime() < dayEnd.getTime() && event.end.getTime() > dayStart.getTime()
    );
  }

  async createEvent(
    _calendarId: string,
    params: { title: string; start: Date; end: Date; description: string; location: string }
  ): Promise<CalendarEvent> {
    const event: CalendarEvent = {
      id: `event-${this.nextId++}`,
      start: params.start,
      end: params.end
    };
    this.events.push(event);
    return event;
  }

  async deleteEvent(_calendarId: string, eventId: string): Promise<void> {
    this.events = this.events.filter((event) => event.id !== eventId);
  }

  async getEventById(_calendarId: string, eventId: string): Promise<CalendarEvent | null> {
    return this.events.find((event) => event.id === eventId) ?? null;
  }
}
