/**
 * Proving an inbound webhook really came from Meta.
 *
 * Until now the only gate was a `?token=` in the query string. Anyone who
 * learned it could post messages as any phone number into a chosen clinic, and
 * because it travels in the URL it ends up in proxy logs, browser history and
 * the Meta dashboard. It identifies the clinic; it does not authenticate the
 * sender.
 *
 * Meta signs every delivery with HMAC-SHA256 of the raw body using the app
 * secret, sent as `X-Hub-Signature-256: sha256=<hex>`. That is the real check,
 * because the secret never travels with the request.
 */

const HEADER = "x-hub-signature-256";
const PREFIX = "sha256=";

/**
 * The HMAC covers the bytes Meta sent. Parsing and re-serialising changes
 * whitespace and key order, so the raw text has to be carried through.
 */
export async function isSignatureValid(
  rawBody: string,
  header: string | null,
  appSecret: string
): Promise<boolean> {
  if (!header || !appSecret) {
    return false;
  }

  const supplied = header.trim().toLowerCase();

  if (!supplied.startsWith(PREFIX)) {
    return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(rawBody)
  );

  const expected = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return constantTimeEquals(supplied.slice(PREFIX.length), expected);
}

export function signatureHeaderName(): string {
  return HEADER;
}

/** Comparing with === leaks where the first difference is. */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let diff = 0;

  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return diff === 0;
}
