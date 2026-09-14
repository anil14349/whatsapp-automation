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

    // Use 10 salt rounds for bcrypt (default is 10)
    const hash = await bcrypt.hash(plainPassword);
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

    const isValid = await bcrypt.compare(plainPassword, hash);
    
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
 * - Exactly 4 digits
 * - Cannot be sequential (1234, 4567, etc)
 * - Cannot be repeating (1111, 2222, etc)
 * 
 * @param pin - The PIN to validate (string)
 * @returns { valid: boolean; errors: string[] }
 */
export function validatePinStrength(pin: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!pin) {
    return { valid: false, errors: ["PIN cannot be empty"] };
  }

  if (pin.length !== 4) {
    errors.push("PIN must be exactly 4 digits");
  }

  if (!/^\d{4}$/.test(pin)) {
    errors.push("PIN must contain only digits");
  }

  // Check for sequential pattern (1234, 4567, etc)
  const digits = pin.split("").map(Number);
  let isSequential = true;
  for (let i = 1; i < digits.length; i++) {
    if (Math.abs(digits[i] - digits[i - 1]) !== 1) {
      isSequential = false;
      break;
    }
  }

  if (isSequential && digits.length === 4) {
    errors.push("PIN cannot be sequential (1234, 4567, etc)");
  }

  // Check for repeating pattern (1111, 2222, etc)
  if (/^(\d)\1{3}$/.test(pin)) {
    errors.push("PIN cannot be all the same digit");
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
