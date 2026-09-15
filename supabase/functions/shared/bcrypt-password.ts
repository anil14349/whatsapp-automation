/**
 * Bcrypt Password Hashing & Verification
 * 
 * Secure password hashing using bcrypt via deno-bcrypt library
 * Provides consistent hashing across different password storage scenarios
 */

import * as bcrypt from "https://deno.land/x/bcrypt@v0.4.1/mod.ts";
import { debug } from "./logger.ts";

/**
 * Hash a plain text password using bcrypt with 10 salt rounds
 * 
 * @param plainPassword - The plain text password to hash
 * @returns Promise<string> - The bcrypt hash string
 * 
 * @example
 * const hash = await hashPassword("myPassword123");
 * // hash = "$2a$10$..."
 */
export async function hashPassword(plainPassword: string): Promise<string> {
  try {
    if (!plainPassword || plainPassword.length === 0) {
      throw new Error("Password cannot be empty");
    }

    // hashSync/compareSync are required here: the async variants spawn a Web
    // Worker, which the Supabase Edge runtime does not support, so they throw.
    const hash = bcrypt.hashSync(plainPassword);
    debug("bcryptPassword", "Password hashed successfully", {});
    return hash;
  } catch (error) {
    debug("bcryptPassword", "Error hashing password", {
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

/**
 * Verify a plain text password against a bcrypt hash
 * 
 * @param plainPassword - The plain text password to verify
 * @param hash - The bcrypt hash to compare against
 * @returns Promise<boolean> - true if password matches, false otherwise
 * 
 * @example
 * const isValid = await verifyPassword("myPassword123", "$2a$10$...");
 * // true or false
 */
export async function verifyPassword(plainPassword: string, hash: string): Promise<boolean> {
  try {
    if (!plainPassword || plainPassword.length === 0) {
      return false;
    }

    if (!hash || hash.length === 0) {
      return false;
    }

    // Sync variant: see hashPassword above for why the async API is unusable.
    const isValid = bcrypt.compareSync(plainPassword, hash);
    
    if (isValid) {
      debug("bcryptPassword", "Password verified successfully", {});
    } else {
      debug("bcryptPassword", "Password verification failed - mismatch", {});
    }

    return isValid;
  } catch (error) {
    debug("bcryptPassword", "Error verifying password", {
      error: error instanceof Error ? error.message : String(error)
    });
    // Return false on error to fail securely
    return false;
  }
}

/**
 * Validate password strength
 * 
 * Requirements:
 * - Minimum 8 characters
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one number
 * - At least one special character (!@#$%^&*)
 * 
 * @param password - The password to validate
 * @returns { valid: boolean; errors: string[] }
 */
export function validatePasswordStrength(password: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!password) {
    return { valid: false, errors: ["Password cannot be empty"] };
  }

  if (password.length < 8) {
    errors.push("Password must be at least 8 characters long");
  }

  if (!/[A-Z]/.test(password)) {
    errors.push("Password must contain at least one uppercase letter");
  }

  if (!/[a-z]/.test(password)) {
    errors.push("Password must contain at least one lowercase letter");
  }

  if (!/[0-9]/.test(password)) {
    errors.push("Password must contain at least one number");
  }

  if (!/[!@#$%^&*]/.test(password)) {
    errors.push("Password must contain at least one special character (!@#$%^&*)");
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate PIN strength (simpler than passwords)
 * 
 * Requirements:
 * - 4 to 6 digits
 * - Cannot be sequential (1234, 4567, etc)
 * - Cannot be repeating (1111, 2222, etc)
 * 
 * @param pin - The PIN to validate (string)
 * @returns { valid: boolean; errors: string[] }
 */
export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 6;

export function validatePinStrength(pin: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!pin) {
    return { valid: false, errors: ["PIN cannot be empty"] };
  }

  if (!/^\d+$/.test(pin)) {
    errors.push("PIN must contain only digits");
  }

  if (pin.length < PIN_MIN_LENGTH || pin.length > PIN_MAX_LENGTH) {
    errors.push(`PIN must be ${PIN_MIN_LENGTH} to ${PIN_MAX_LENGTH} digits`);
  }

  // Runs of consecutive digits in either direction: 1234, 4321, 345678.
  const digits = pin.split("").map(Number);
  let isSequential = digits.length > 1 && !digits.some(Number.isNaN);

  for (let i = 1; i < digits.length && isSequential; i++) {
    if (digits[i] - digits[i - 1] !== digits[1] - digits[0]) {
      isSequential = false;
    }
  }

  if (isSequential && Math.abs(digits[1] - digits[0]) === 1) {
    errors.push("PIN cannot be sequential (1234, 4321, etc)");
  }

  if (/^(\d)\1*$/.test(pin)) {
    errors.push("PIN cannot be all the same digit");
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
