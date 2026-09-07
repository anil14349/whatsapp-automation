/**
 * Ported from src/Util_Common.gs (normalizeWhatsAppPhone / phonesMatch).
 * Kept byte-for-byte equivalent in behavior: strip everything but digits,
 * then compare on the last 10 digits so different country-code prefixes
 * for the same number still match.
 */

export function normalizeWhatsAppPhone(phone: string | null | undefined): string {
  const digits = String(phone ?? "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export function phonesMatch(
  phoneA: string | null | undefined,
  phoneB: string | null | undefined
): boolean {
  const a = normalizeWhatsAppPhone(phoneA);
  const b = normalizeWhatsAppPhone(phoneB);
  return a !== "" && a === b;
}
