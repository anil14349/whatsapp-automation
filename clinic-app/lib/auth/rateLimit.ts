const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

const attempts = new Map<string, number[]>();

export function checkLoginRateLimit(key: string): { allowed: boolean; retryAfterSeconds?: number } {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  const timestamps = (attempts.get(key) ?? []).filter((t) => t > windowStart);
  attempts.set(key, timestamps);

  if (timestamps.length >= MAX_ATTEMPTS) {
    const oldestInWindow = timestamps[0]!;
    const retryAfterSeconds = Math.ceil((oldestInWindow + WINDOW_MS - now) / 1000);
    return { allowed: false, retryAfterSeconds };
  }

  timestamps.push(now);
  return { allowed: true };
}
