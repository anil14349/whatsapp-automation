/**
 * Where an appointment happens.
 *
 * Two spellings were already in use: the receptionist wrote "CLINIC" and the
 * patient flow wrote "clinic", while slot generation compares against "HOME".
 * That difference decides which hours a booking is offered from, so a home
 * visit written in lower case would have been quietly filled from the doctor's
 * clinic hours — a booking that looks right and is not.
 */

export type LocationType = "CLINIC" | "HOME";

export const LOCATION_CLINIC: LocationType = "CLINIC";
export const LOCATION_HOME: LocationType = "HOME";

/** Anything unrecognised is a clinic visit, which is the safe reading. */
export function asLocationType(value: unknown): LocationType {
    return String(value ?? "").trim().toUpperCase() === LOCATION_HOME
        ? LOCATION_HOME
        : LOCATION_CLINIC;
}

export function isHomeVisit(value: unknown): boolean {
    return asLocationType(value) === LOCATION_HOME;
}
