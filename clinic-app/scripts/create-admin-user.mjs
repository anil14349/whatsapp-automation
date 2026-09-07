#!/usr/bin/env node
/**
 * One-time bootstrap: creates the first admin_users row (or any
 * subsequent one — there's no UI to do this, by design, since the admin
 * UI itself requires being logged in already).
 *
 * Usage:
 *   node scripts/create-admin-user.mjs --email you@clinic.com --password 'a strong password' [--role ADMIN|RECEPTIONIST] [--name "Jane Doe"]
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the
 * environment (e.g. `source .env.local` first, or prefix the command
 * with them inline).
 *
 * Password hashing duplicates lib/auth/password.ts's scrypt format
 * ("scrypt:<salt-hex>:<hash-hex>") rather than importing it, so this
 * script has zero build step / TypeScript toolchain dependency — just
 * plain Node. Keep the two in sync if the hash format ever changes.
 */

import { randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;

function parseArgs() {
  const args = {};
  const argv = process.argv.slice(2);

  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "");
    args[key] = argv[i + 1];
  }

  return args;
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const derivedKey = await scryptAsync(password, salt, KEY_LENGTH);
  return `scrypt:${salt.toString("hex")}:${derivedKey.toString("hex")}`;
}

async function main() {
  const args = parseArgs();

  if (!args.email || !args.password) {
    console.error(
      "Usage: node scripts/create-admin-user.mjs --email you@clinic.com --password 'a strong password' [--role ADMIN|RECEPTIONIST] [--name \"Jane Doe\"]"
    );
    process.exit(1);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the environment."
    );
    process.exit(1);
  }

  const role = args.role === "RECEPTIONIST" ? "RECEPTIONIST" : "ADMIN";
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { error } = await supabase.from("admin_users").upsert(
    {
      email: args.email.trim().toLowerCase(),
      password_hash: await hashPassword(args.password),
      full_name: args.name ?? "",
      role,
      active: true
    },
    { onConflict: "email" }
  );

  if (error) {
    console.error("Failed to create admin user:", error.message);
    process.exit(1);
  }

  console.log(`Admin user ${args.email} (${role}) created/updated.`);
}

main();
