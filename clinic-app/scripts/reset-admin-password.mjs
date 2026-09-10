#!/usr/bin/env node

/**
 * Reset Admin Password Script
 *
 * Usage:
 *   node scripts/reset-admin-password.mjs
 *
 * What it does:
 *   1. Prompts for admin email
 *   2. Prompts for new password (min 8 chars)
 *   3. Hashes password using scrypt
 *   4. Updates admin_users table in Supabase
 *
 * Environment:
 *   NEXT_PUBLIC_SUPABASE_URL - Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY - Service role key (for admin access)
 *
 * Security:
 *   - Passwords are hashed with scrypt (Node.js built-in)
 *   - Uses service role key (can only be run by DevOps/deploy process)
 *   - No plaintext passwords logged or stored
 */

import { randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";
import * as readline from "node:readline";

const scryptAsync = promisify(scrypt);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (q) =>
  new Promise((resolve) => rl.question(q, resolve));

async function main() {
  console.log("🔐 Admin Password Reset\n");

  // Validate environment
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      "❌ Error: Missing environment variables\n" +
        "   NEXT_PUBLIC_SUPABASE_URL\n" +
        "   SUPABASE_SERVICE_ROLE_KEY\n"
    );
    process.exit(1);
  }

  try {
    // Get email
    const email = (await question("Admin email: ")).trim().toLowerCase();
    if (!email) {
      console.error("❌ Email is required");
      process.exit(1);
    }

    if (!email.includes("@")) {
      console.error("❌ Invalid email address");
      process.exit(1);
    }

    // Get password
    const password = await question("New password (min 8 chars): ");
    if (password.length < 8) {
      console.error("❌ Password must be at least 8 characters");
      process.exit(1);
    }

    // Confirm password
    const confirm = await question("Confirm password: ");
    if (password !== confirm) {
      console.error("❌ Passwords do not match");
      process.exit(1);
    }

    console.log("\n⏳ Hashing password...");

    // Hash password using scrypt (same as in lib/auth/password.ts)
    const salt = randomBytes(16);
    const derivedKey = await scryptAsync(password, salt, 64);
    const passwordHash = `scrypt:${salt.toString("hex")}:${derivedKey.toString("hex")}`;

    console.log("⏳ Connecting to Supabase...");

    // Connect to Supabase
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Check if user exists
    const { data: existing, error: checkError } = await supabase
      .from("admin_users")
      .select("id, full_name")
      .eq("email", email)
      .single();

    if (checkError && checkError.code !== "PGRST116") {
      // PGRST116 = not found, which is fine
      console.error("❌ Database error:", checkError.message);
      process.exit(1);
    }

    if (!existing) {
      console.error(`❌ Admin user not found: ${email}`);
      process.exit(1);
    }

    console.log(`⏳ Resetting password for ${existing.full_name} (${email})...`);

    // Update password
    const { error } = await supabase
      .from("admin_users")
      .update({ password_hash: passwordHash })
      .eq("email", email);

    if (error) {
      console.error("❌ Database error:", error.message);
      process.exit(1);
    }

    console.log("\n✅ Password reset successfully!\n");
    console.log(`   Admin: ${existing.full_name}`);
    console.log(`   Email: ${email}`);
    console.log("\n   They can now log in with their new password.");
  } catch (error) {
    console.error("❌ Error:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    rl.close();
  }
}

main();
