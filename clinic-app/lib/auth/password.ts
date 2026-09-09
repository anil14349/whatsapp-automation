import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

/**
 * Password hashing for admin_users.password_hash, using Node's built-in
 * scrypt (no external dependency like bcrypt/argon2 needed). Format:
 * "scrypt:<salt-hex>:<hash-hex>" so the salt travels with the hash and
 * future algorithm changes can be detected by the prefix.
 */

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  return `scrypt:${salt.toString("hex")}:${derivedKey.toString("hex")}`;
}

const MIN_PASSWORD_LENGTH = 8;

/**
 * Shared by every "set/reset a password" form — currently the admin
 * doctor-password-reset action (app/admin/(dashboard)/doctors/actions.ts).
 * Pulled out as a pure function (no I/O) so it's unit-testable on its
 * own, same reasoning as lib/patients.ts's isValidPatientName.
 * scripts/set-doctor-password.mjs's own inline validation stays
 * separate — that script has no TypeScript/build step to import this
 * from.
 */
export function validateNewPassword(password: string, confirmPassword: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }

  if (password !== confirmPassword) {
    return "Passwords do not match.";
  }

  return null;
}

export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<boolean> {
  const parts = storedHash.split(":");

  if (parts.length !== 3 || parts[0] !== "scrypt") {
    return false;
  }

  const [, saltHex, hashHex] = parts;
  const salt = Buffer.from(saltHex!, "hex");
  const expected = Buffer.from(hashHex!, "hex");

  const derivedKey = (await scryptAsync(password, salt, expected.length)) as Buffer;

  // timingSafeEqual throws if lengths differ — expected.length is always
  // used to derive the same-length key above, so this can't mismatch
  // unless storedHash was tampered with/corrupted, in which case "not a
  // match" is exactly the right answer anyway.
  if (derivedKey.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(derivedKey, expected);
}
