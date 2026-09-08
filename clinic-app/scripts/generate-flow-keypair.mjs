#!/usr/bin/env node
/**
 * One-time setup: generates the RSA keypair the WhatsApp Flow endpoint
 * (app/api/whatsapp/flow/route.ts) needs. The public key gets uploaded
 * to Meta (associated with your phone number, via the Graph API "sign
 * public key" call in the README's WhatsApp Flows section) and the
 * private key goes into WHATSAPP_FLOW_PRIVATE_KEY / _PASSPHRASE.
 *
 * Usage:
 *   node scripts/generate-flow-keypair.mjs [--passphrase 'something long']
 *
 * If --passphrase is omitted, one is generated for you and printed —
 * there is no way to encrypt the private key at rest without one, and
 * an unencrypted private key sitting in a hosting provider's env var UI
 * is worse than a passphrase you have to also copy into
 * WHATSAPP_FLOW_PRIVATE_KEY_PASSPHRASE.
 *
 * Prints both PEM values with real newlines converted to literal "\n"
 * sequences, matching the convention already used for
 * GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY — paste each straight into your
 * .env file.
 */

import { generateKeyPairSync, randomBytes } from "node:crypto";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      args[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const passphrase = args.passphrase || randomBytes(24).toString("base64url");

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: {
    type: "pkcs8",
    format: "pem",
    cipher: "aes-256-cbc",
    passphrase
  }
});

const escapeForEnvFile = (pem) => pem.trim().replace(/\n/g, "\\n");

console.log("=".repeat(70));
console.log("Public key — upload this to Meta (see README's WhatsApp Flows");
console.log("section for the exact Graph API call):");
console.log("=".repeat(70));
console.log(publicKey);

console.log("=".repeat(70));
console.log("Paste these into your .env / hosting provider's env vars:");
console.log("=".repeat(70));
console.log(`WHATSAPP_FLOW_PRIVATE_KEY=${escapeForEnvFile(privateKey)}`);
console.log(`WHATSAPP_FLOW_PRIVATE_KEY_PASSPHRASE=${passphrase}`);

if (!args.passphrase) {
  console.log("");
  console.log(
    "(No --passphrase given, so one was generated above — save it now, it won't be shown again.)"
  );
}
