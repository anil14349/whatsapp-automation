/**
 * Phone numbers are stored as digits with the country code and no punctuation,
 * because that is the form the WhatsApp API and every lookup expect.
 *
 * India is the default, so its code is hidden on screen rather than repeated on
 * every row. A number from anywhere else still shows its code, since dropping
 * that would be a lie.
 */

export const DEFAULT_COUNTRY_CODE = "91";

export interface Country {
    code: string;
    name: string;
}

// Longest codes first would matter for parsing, but these are matched against a
// known list rather than guessed, so alphabetical by name reads better.
export const COUNTRIES: Country[] = [
    { code: "91", name: "India" },
    { code: "1", name: "United States / Canada" },
    { code: "44", name: "United Kingdom" },
    { code: "61", name: "Australia" },
    { code: "64", name: "New Zealand" },
    { code: "65", name: "Singapore" },
    { code: "60", name: "Malaysia" },
    { code: "971", name: "United Arab Emirates" },
    { code: "966", name: "Saudi Arabia" },
    { code: "974", name: "Qatar" },
    { code: "968", name: "Oman" },
    { code: "973", name: "Bahrain" },
    { code: "965", name: "Kuwait" },
    { code: "94", name: "Sri Lanka" },
    { code: "977", name: "Nepal" },
    { code: "880", name: "Bangladesh" },
    { code: "92", name: "Pakistan" },
    { code: "49", name: "Germany" },
    { code: "33", name: "France" },
    { code: "39", name: "Italy" },
    { code: "34", name: "Spain" },
    { code: "31", name: "Netherlands" },
    { code: "27", name: "South Africa" },
    { code: "254", name: "Kenya" },
    { code: "234", name: "Nigeria" },
    { code: "81", name: "Japan" },
    { code: "86", name: "China" },
    { code: "82", name: "South Korea" },
    { code: "63", name: "Philippines" },
    { code: "62", name: "Indonesia" },
    { code: "66", name: "Thailand" }
];

export function digitsOnly(value: string): string {
    return (value ?? "").replace(/\D/g, "");
}

/** Splits a stored number into its country code and the rest. */
export function splitPhone(stored: string): { code: string; national: string } {
    const digits = digitsOnly(stored);

    if (!digits) {
        return { code: DEFAULT_COUNTRY_CODE, national: "" };
    }

    // Longest match wins, so 91 does not claim a number that starts 917 for Oman.
    const matches = COUNTRIES.map((c) => c.code)
        .filter((code) => digits.startsWith(code) && digits.length > code.length)
        .sort((a, b) => b.length - a.length);

    if (matches.length === 0) {
        return { code: DEFAULT_COUNTRY_CODE, national: digits };
    }

    return { code: matches[0], national: digits.slice(matches[0].length) };
}

export function joinPhone(code: string, national: string): string {
    // A country code on its own is not a number. The picker always has one
    // selected, so without this an untouched field submits "91" and that gets
    // stored as a receptionist's phone.
    const digits = digitsOnly(national);

    return digits ? digitsOnly(code) + digits : "";
}

/** What a human should read: no country code when it is the default one. */
export function displayPhone(stored: string): string {
    const { code, national } = splitPhone(stored);

    if (!national) {
        return stored ?? "";
    }

    return code === DEFAULT_COUNTRY_CODE ? national : `+${code} ${national}`;
}
