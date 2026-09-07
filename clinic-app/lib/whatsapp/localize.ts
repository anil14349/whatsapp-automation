import translations from "./localization.json";

/**
 * Ported from localizeWhatsAppReply / applyClinicNamePlaceholder in
 * src/View_Messages.gs. The translation dictionaries in localization.json
 * were extracted programmatically from that file (not hand-transcribed)
 * to guarantee the ~600 lines of Telugu/Hindi/Kannada/Tamil/Malayalam
 * text are byte-for-byte what's already in production, not a
 * re-typed/re-translated copy that could silently drift or introduce
 * typos in scripts this assistant can't proofread with full confidence.
 *
 * Behavior kept identical: replace keyed English phrases (longest key
 * first, so no key is a substring of a later, longer, still-untouched
 * key — avoiding partial-replacement bugs), then substitute
 * {{CLINIC_NAME}} last so it's correct in every language including
 * English.
 */

export type SupportedLanguage = "EN" | "TE" | "HI" | "KA" | "TA" | "ML";

const translationDict = translations as Record<string, Record<string, string>>;

export function applyClinicNamePlaceholder(message: string, clinicName: string): string {
  return message.split("{{CLINIC_NAME}}").join(clinicName);
}

export function localizeWhatsAppReply(
  language: string | null | undefined,
  message: string,
  clinicName: string
): string {
  const selectedLanguage = String(language ?? "EN").toUpperCase();

  if (selectedLanguage === "EN") {
    return applyClinicNamePlaceholder(message, clinicName);
  }

  const dictionary = translationDict[selectedLanguage] ?? {};

  let localized = message;

  for (const englishText of Object.keys(dictionary).sort(
    (a, b) => b.length - a.length
  )) {
    localized = localized.split(englishText).join(dictionary[englishText]!);
  }

  return applyClinicNamePlaceholder(localized, clinicName);
}
