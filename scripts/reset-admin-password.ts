/**
 * Reset a portal admin's password.
 *
 * Doctors and receptionists have password reset endpoints that email a link.
 * Admins do not, and cannot: the reset endpoints are reached with an admin
 * token, and an admin who has forgotten their password has no token. That
 * circle is the same one create-admin.ts breaks, and it is broken the same
 * way — directly against the database, deliberately not over HTTP.
 *
 * Usage (from the repo root):
 *   deno run --allow-env --allow-read --allow-net scripts/reset-admin-password.ts \
 *     --email owner@clinic.com [--clinic <uuid>] [--password <new password>]
 *
 * Omit --password to have one generated and printed.
 * --clinic is only needed when the same address is an admin at more than one
 * clinic, which the script will tell you about rather than guessing.
 */

import { hashPassword, validatePasswordStrength } from "../supabase/functions/shared/bcrypt-password.ts";

function arg(name: string): string | undefined {
    const index = Deno.args.indexOf(`--${name}`);
    return index >= 0 ? Deno.args[index + 1] : undefined;
}

function readEnvFile(path: string): Record<string, string> {
    try {
        const values: Record<string, string> = {};

        for (const line of Deno.readTextFileSync(path).split(/\r?\n/)) {
            const match = line.match(/^([A-Z0-9_]+)=(.*)$/);

            if (match) {
                values[match[1]] = match[2].trim();
            }
        }

        return values;
    } catch {
        return {};
    }
}

/** Ambiguous characters are left out: this gets read aloud and typed by hand. */
function generatePassword(): string {
    const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    const lower = "abcdefghijkmnopqrstuvwxyz";
    const digits = "23456789";
    const symbols = "!@#$%^&*";
    const all = upper + lower + digits + symbols;

    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);

    const required = [
        upper[bytes[0] % upper.length],
        lower[bytes[1] % lower.length],
        digits[bytes[2] % digits.length],
        symbols[bytes[3] % symbols.length]
    ];

    return [...required, ...Array.from(bytes.slice(4), (b) => all[b % all.length])].join("");
}

const env = readEnvFile(".env.local");
const url = (env.SU_URL || Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
const key = env.SU_SERVICE_ROLE_KEY || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!url || !key) {
    console.error("Missing SU_URL / SU_SERVICE_ROLE_KEY (checked .env.local and the environment).");
    Deno.exit(1);
}

const email = arg("email");
const clinicId = arg("clinic");
const password = arg("password") || generatePassword();

if (!email) {
    console.error(
        "Usage: --email <address> [--clinic <uuid>] [--password <new password>]"
    );
    Deno.exit(1);
}

const strength = validatePasswordStrength(password);

if (!strength.valid) {
    console.error(`Password rejected: ${strength.errors.join(", ")}`);
    Deno.exit(1);
}

const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json"
};

async function rest(path: string, init?: RequestInit): Promise<Response> {
    return await fetch(`${url}/rest/v1/${path}`, { ...init, headers });
}

// Found first so the script can say who it is about to change, and refuse
// rather than pick when an address is an admin at more than one clinic.
const lookup = await rest(
    `clinic_admins?email=eq.${encodeURIComponent(email.toLowerCase())}` +
    `&select=id,name,email,role,status,clinic_id`
);

if (!lookup.ok) {
    console.error(`Lookup failed (${lookup.status}): ${await lookup.text()}`);
    Deno.exit(1);
}

const all = await lookup.json() as Array<Record<string, string | null>>;

const matches = clinicId
    ? all.filter((row) => row.clinic_id === clinicId)
    : all;

if (matches.length === 0) {
    console.error(`No admin found for ${email}${clinicId ? ` at clinic ${clinicId}` : ""}.`);

    if (all.length > 0) {
        console.error("That address exists at:");
        for (const row of all) {
            console.error(`  clinic ${row.clinic_id ?? "(platform admin)"}`);
        }
    }

    Deno.exit(1);
}

if (matches.length > 1) {
    console.error(`${email} is an admin in ${matches.length} places. Name one with --clinic:`);
    for (const row of matches) {
        console.error(`  ${row.clinic_id ?? "(platform admin, omit --clinic)"}  ${row.role}`);
    }
    Deno.exit(1);
}

const admin = matches[0];

const update = await rest(`clinic_admins?id=eq.${admin.id}`, {
    method: "PATCH",
    body: JSON.stringify({
        password_hash: await hashPassword(password),
        updated_at: new Date().toISOString()
    })
});

if (!update.ok) {
    console.error(`Reset failed (${update.status}): ${await update.text()}`);
    Deno.exit(1);
}

// Somebody who has forgotten a password has usually just spent three attempts
// proving it, and would otherwise wait out a lockout with a password that now
// works.
const cleared = await rest(`login_rate_limits?user_id=eq.${admin.id}`, { method: "DELETE" });

console.log(`Reset password for ${admin.role} ${admin.email} (${admin.name}).`);
console.log(`Clinic: ${admin.clinic_id ?? "(platform admin, all clinics)"}`);

if (!cleared.ok) {
    console.log("Note: could not clear the lockout counter; any lockout will expire on its own.");
}

if (admin.status !== "ACTIVE") {
    console.log(`Warning: this account is ${admin.status}, so the new password will not sign in until it is reactivated.`);
}

if (!arg("password")) {
    console.log(`\nNew password: ${password}`);
    console.log("Store it now - it is not recoverable and is not stored in plain text.");
}
