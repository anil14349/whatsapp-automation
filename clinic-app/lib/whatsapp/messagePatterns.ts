/**
 * Pre-compiled message patterns for performance
 * Patterns are compiled once at module load, not per message
 */

export const MESSAGE_PATTERNS = {
  LAB: /lab|collect|sample|blood|test|needle|home.*collect/i,
  RESULTS: /result|report|ready|test.*ready|check.*result/i,
  PRESCRIPTION: /prescription|medicine|drug|refill|rx/i,
  BILLING: /bill|invoice|cost|charge|pay|payment/i,
  DOCTOR: /doctor|specialist|cardiologist|dermatologist|who.*doctor/i,
  RESCHEDULE: /reschedule|change|different.*time|postpone|later/i,
  STATUS: /status|when|time|appointment.*time|my.*appointment/i,
  FEEDBACK: /feedback|complaint|suggest|issue|problem/i,
  BOOKING: /book|appointment/i,
  CONFIRMATION: /confirm|yes/i,
  CANCELLATION: /cancel/i,
  HELP: /help|menu/i
} as const;

/**
 * Type-safe pattern matching
 */
export function matchesPattern(text: string, pattern: RegExp): boolean {
  return pattern.test(text);
}

/**
 * Check if text matches multiple patterns
 */
export function matchesAnyPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some(pattern => matchesPattern(text, pattern));
}
