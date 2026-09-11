/**
 * Query timeout utility
 * Wraps database queries with automatic timeout
 */

/**
 * Execute a promise with a timeout
 * @param query The promise to execute
 * @param timeoutMs Timeout in milliseconds (default 5000)
 * @param description Description for error messages
 * @returns The result or throws TimeoutError
 */
export async function queryWithTimeout<T>(
  query: Promise<T>,
  timeoutMs: number = 5000,
  description: string = "Database query"
): Promise<T> {
  return Promise.race([
    query,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${description} timeout after ${timeoutMs}ms`)),
        timeoutMs
      )
    )
  ]);
}

/**
 * Execute a query with detailed timeout handling
 * @param query The query function to execute
 * @param timeoutMs Timeout in milliseconds
 * @param description Description for logging
 * @returns The result or null if timeout
 */
export async function queryWithTimeoutAndFallback<T>(
  query: () => Promise<T>,
  timeoutMs: number = 5000,
  description: string = "Database query"
): Promise<T | null> {
  try {
    return await queryWithTimeout(query(), timeoutMs, description);
  } catch (error) {
    if (error instanceof Error && error.message.includes("timeout")) {
      console.warn(`${description} exceeded ${timeoutMs}ms timeout`);
      return null;
    }
    throw error;
  }
}
