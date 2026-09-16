/**
 * Input validation.
 *
 * The monolith accepted booking dates decades into the future; the 7-day
 * window is the fix and needs to stay enforced.
 */

import { assertEquals } from "std/testing/asserts.ts";
import {
    isValidBookingDate,
    isValidISODate,
    isValidTimeString,
    isValidPatientName,
    normalizePhoneNumber,
    phonesMatch,
    isValidPhoneNumber,
    normalizeAppointmentStatus,
    canCancelAppointmentStatus,
    isTerminalAppointmentStatus
} from "../shared/validators.ts";

// Local days, not UTC ones. toISOString() shifts to UTC, so between local
// midnight and UTC midnight this drifted a day and the suite failed nightly.
function offsetDate(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() + days);

    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

Deno.test("today and the next seven days are bookable", () => {
    for (let i = 0; i <= 7; i++) {
        assertEquals(
            isValidBookingDate(offsetDate(i)).valid,
            true,
            `day +${i} should be bookable`
        );
    }
});

Deno.test("yesterday is not bookable", () => {
    const result = isValidBookingDate(offsetDate(-1));

    assertEquals(result.valid, false);
    assertEquals(result.error, "past");
});

Deno.test("beyond a week is not bookable", () => {
    const result = isValidBookingDate(offsetDate(8));

    assertEquals(result.valid, false);
    assertEquals(result.error, "too_far");
});

Deno.test("a far future date is rejected rather than accepted", () => {
    assertEquals(isValidBookingDate("2099-01-01").valid, false);
});

Deno.test("malformed dates are rejected", () => {
    for (const bad of ["", "not-a-date", "15-09-2026", "2026/09/15", "2026-13-01"]) {
        assertEquals(isValidBookingDate(bad).valid, false, `${bad} should be invalid`);
    }
});

// The server runs on UTC. A clinic in Asia/Kolkata is already on the next day
// from 18:30 UTC, so measuring the window against the server's date let a
// patient book a day the clinic had finished, and cost them the seventh day.
Deno.test("the booking window follows the clinic's day, not the server's", () => {
    const clinicToday = "2026-09-16";

    assertEquals(isValidBookingDate("2026-09-15", clinicToday).error, "past");
    assertEquals(isValidBookingDate("2026-09-16", clinicToday).valid, true);
    assertEquals(isValidBookingDate("2026-09-23", clinicToday).valid, true);
    assertEquals(isValidBookingDate("2026-09-24", clinicToday).error, "too_far");
});

Deno.test("a clinic day that is not a real date is ignored", () => {
    // Falls back to the server's day rather than accepting anything.
    assertEquals(isValidBookingDate("2099-01-01", "not-a-date").valid, false);
});

Deno.test("ISO date validation", () => {
    assertEquals(isValidISODate("2026-09-15"), true);
    assertEquals(isValidISODate("2026-9-5"), false);
    assertEquals(isValidISODate("garbage"), false);
});

Deno.test("time strings accept H:MM and HH:MM but reject impossible times", () => {
    assertEquals(isValidTimeString("09:00"), true);
    assertEquals(isValidTimeString("9:00"), true);
    assertEquals(isValidTimeString("23:59"), true);
    assertEquals(isValidTimeString("24:00"), false);
    assertEquals(isValidTimeString("12:60"), false);
    assertEquals(isValidTimeString("noon"), false);
});

Deno.test("patient names reject empty and junk input", () => {
    assertEquals(isValidPatientName("Ravi Sharma"), true);
    assertEquals(isValidPatientName(""), false);
    assertEquals(isValidPatientName("   "), false);
});

Deno.test("phone numbers normalise consistently", () => {
    const normalized = normalizePhoneNumber("+91 90000 00001");

    assertEquals(normalized.includes(" "), false);
    assertEquals(normalized.includes("+"), false);
    assertEquals(phonesMatch("+919000000001", "919000000001"), true);
});

Deno.test("phone validation rejects obvious rubbish", () => {
    assertEquals(isValidPhoneNumber("919000000001"), true);
    assertEquals(isValidPhoneNumber("123"), false);
    assertEquals(isValidPhoneNumber("abcdefghij"), false);
});

Deno.test("appointment status transitions are guarded", () => {
    // Normalisation is lower-case; the database stores upper-case, so the
    // helpers must cope with both.
    assertEquals(normalizeAppointmentStatus("CONFIRMED"), "confirmed");
    assertEquals(normalizeAppointmentStatus("booked"), "confirmed");
    assertEquals(normalizeAppointmentStatus("noshow"), "no-show");
    assertEquals(canCancelAppointmentStatus("CONFIRMED"), true);
    assertEquals(canCancelAppointmentStatus("COMPLETED"), false);
    assertEquals(canCancelAppointmentStatus("CANCELLED"), false);
    assertEquals(isTerminalAppointmentStatus("COMPLETED"), true);
    assertEquals(isTerminalAppointmentStatus("CONFIRMED"), false);
});
