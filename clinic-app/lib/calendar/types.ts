/**
 * Abstraction over "a calendar" so booking/cancel/reschedule logic can be
 * unit-tested with an in-memory fake instead of needing live Google
 * Calendar credentials (which this environment can't exercise — see
 * lib/calendar/google.ts for the real implementation, and
 * lib/calendar/fake.ts for the test double).
 */

export interface CalendarEvent {
  id: string;
  start: Date;
  end: Date;
}

export interface CalendarPort {
  /** All events overlapping the given day, in the calendar's own timezone. */
  getEventsForDay(calendarId: string, date: Date): Promise<CalendarEvent[]>;

  createEvent(
    calendarId: string,
    params: {
      title: string;
      start: Date;
      end: Date;
      description: string;
      location: string;
    }
  ): Promise<CalendarEvent>;

  deleteEvent(calendarId: string, eventId: string): Promise<void>;

  getEventById(calendarId: string, eventId: string): Promise<CalendarEvent | null>;
}
