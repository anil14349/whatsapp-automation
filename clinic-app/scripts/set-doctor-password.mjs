#!/usr/bin/env node
/**
 * Bootstraps (or resets) web-portal login credentials for an existing
 * doctor row. There's no UI to do this — a doctor logging into the
 * portal for the first time needs credentials to already exist, so a
 * clinic admin runs this once per doctor.
 *
 * Usage:
 *   node scripts/set-doctor-password.mjs --doctorCode D001 --email dr@clinic.com --password 'a strong password'
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the
 * environment (e.g. `source .env.local` first, or prefix the command
 * with them inline).
 *
 * Looks the doctor up by doctor_code and updates that existing row —
 * unlike create-admin-user.mjs's upsert-by-email (which creates a new
 * admin_users row if none matches), this errors clearly if no doctor
 * with that code exists rather than silently creating a new doctor row
 * (a doctor row has a lot more required fields than admin_users does,
 * and this script isn't meant to be "how you add a doctor").
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

  if (!args.doctorCode || !args.email || !args.password) {
    console.error(
      "Usage: node scripts/set-doctor-password.mjs --doctorCode D001 --email dr@clinic.com --password 'a strong password'"
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

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: doctor, error: lookupError } = await supabase
    .from("doctors")
    .select("id")
    .eq("doctor_code", args.doctorCode)
    .maybeSingle();

  if (lookupError) {
    console.error("Failed to look up doctor:", lookupError.message);
    process.exit(1);
  }

  if (!doctor) {
    console.error(`No doctor found with doctor_code "${args.doctorCode}".`);
    process.exit(1);
  }

  const { error: updateError } = await supabase
    .from("doctors")
    .update({
      email: args.email.trim().toLowerCase(),
      password_hash: await hashPassword(args.password)
    })
    .eq("id", doctor.id);

  if (updateError) {
    console.error("Failed to set doctor password:", updateError.message);
    process.exit(1);
  }

  console.log(`Doctor ${args.doctorCode} (${args.email}) portal login created/updated.`);
}

main();
