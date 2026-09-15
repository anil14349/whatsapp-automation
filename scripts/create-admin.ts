/**
 * Create the first portal admin.
 *
 * Staff are provisioned through the /staff endpoint, which requires an admin
 * token, which requires an admin to exist. This breaks that circle and is the
 * only step that should ever need direct database access.
 *
 * Usage (from the repo root):
 *   deno run --allow-env --allow-read --allow-net scripts/create-admin.ts \
 *     --email owner@clinic.com --name "Clinic Owner" --clinic <uuid>
 *
 * Omit --clinic to create a platform-wide ADMIN.
 * Omit --password to have one generated and printed.
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
const url = env.SU_URL || Deno.env.get("SUPABASE_URL");
const key = env.SU_SERVICE_ROLE_KEY || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!url || !key) {
    console.error("Missing SU_URL / SU_SERVICE_ROLE_KEY (checked .env.local and the environment).");
    Deno.exit(1);
}

const email = arg("email");
const name = arg("name");
const clinicId = arg("clinic");
const password = arg("password") || generatePassword();

if (!email || !name) {
    console.error("Usage: --email <address> --name <name> [--clinic <uuid>] [--password <password>]");
    Deno.exit(1);
}

const strength = validatePasswordStrength(password);

if (!strength.valid) {
    console.error(`Password rejected: ${strength.errors.join(", ")}`);
    Deno.exit(1);
}

const role = clinicId ? "CLINIC_OWNER" : "ADMIN";

const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/clinic_admins`, {
    method: "POST",
    headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=representation"
    },
    body: JSON.stringify({
        clinic_id: clinicId ?? null,
        name,
        email: email.toLowerCase(),
        password_hash: await hashPassword(password),
        role,
        status: "ACTIVE"
    })
});

if (!response.ok) {
    console.error(`Failed to create admin (${response.status}): ${await response.text()}`);
    Deno.exit(1);
}

const [created] = await response.json();

console.log(`Created ${role} ${created.email} (${created.id})`);

if (!arg("password")) {
    console.log(`Generated password: ${password}`);
    console.log("Store it now - it is not recoverable and is not stored in plain text.");
}
