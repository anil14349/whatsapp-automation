/**
 * Turning one clinic colour into the shades the interface needs.
 *
 * A clinic picks a single colour; buttons also need a hover and an active
 * shade, and a pale tint for backgrounds. Deriving them means the clinic is
 * never asked to choose four colours that agree with each other.
 */

export interface BrandShades {
    "--brand-50": string;
    "--brand-500": string;
    "--brand-600": string;
    "--brand-700": string;
}

/** Null when the colour is absent or not a hex value we can work with. */
export function brandShades(colour: string | null | undefined): BrandShades | null {
    if (!colour || !/^#[0-9a-f]{6}$/i.test(colour)) {
        return null;
    }

    return {
        "--brand-50": mix(colour, 0.92),
        "--brand-500": colour,
        "--brand-600": darken(colour, 0.12),
        "--brand-700": darken(colour, 0.26)
    };
}

/**
 * White text has to stay readable on the clinic's own colour, and a clinic that
 * picks a pale yellow would otherwise get white on white.
 */
export function readableOn(colour: string | null | undefined): "#ffffff" | "#0f172a" {
    if (!colour || !/^#[0-9a-f]{6}$/i.test(colour)) {
        return "#ffffff";
    }

    const [r, g, b] = rgb(colour);

    // Perceived brightness, not the plain average: the eye weights green most.
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

    return luminance > 0.6 ? "#0f172a" : "#ffffff";
}

function rgb(hex: string): [number, number, number] {
    return [
        parseInt(hex.slice(1, 3), 16),
        parseInt(hex.slice(3, 5), 16),
        parseInt(hex.slice(5, 7), 16)
    ];
}

function toHex([r, g, b]: [number, number, number]): string {
    const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

    return `#${[r, g, b].map((n) => clamp(n).toString(16).padStart(2, "0")).join("")}`;
}

function darken(hex: string, amount: number): string {
    const [r, g, b] = rgb(hex);

    return toHex([r * (1 - amount), g * (1 - amount), b * (1 - amount)]);
}

/** Towards white, for the pale background tint. */
function mix(hex: string, amount: number): string {
    const [r, g, b] = rgb(hex);

    return toHex([
        r + (255 - r) * amount,
        g + (255 - g) * amount,
        b + (255 - b) * amount
    ]);
}
