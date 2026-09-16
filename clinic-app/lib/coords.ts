/**
 * Read a latitude/longitude pair out of whatever someone pasted.
 *
 * Nobody types coordinates. They copy them from Google Maps, which gives back
 * either "12.9716, 77.5946" or a URL with the pair buried in it, and pasting
 * that whole thing into a latitude box is the obvious first attempt.
 */

const PAIR = /(-?\d{1,3}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)/;

export function parseCoordinates(input: string): { lat: string; lon: string } | null {
    const text = input.trim();

    if (!text) {
        return null;
    }

    // A maps URL has the pair after "@" or "q="; both are covered by taking the
    // first pair that is in range, since a zoom level like ",15z" is not.
    const match = PAIR.exec(text.replace(/[?&]/g, " "));

    if (!match) {
        return null;
    }

    const lat = Number(match[1]);
    const lon = Number(match[2]);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return null;
    }

    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        return null;
    }

    return { lat: match[1], lon: match[2] };
}
