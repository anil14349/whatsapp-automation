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
