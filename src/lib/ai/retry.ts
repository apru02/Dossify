// Retry transient Gemini failures (rate limits, overload, network) with exponential backoff.
// Anything else (bad request, auth) fails immediately.

export function isRetryable(error: unknown): boolean {
  const status = (error as { status?: number })?.status;
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) return true;
  const msg = String((error as Error)?.message ?? "");
  return /fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|timed? ?out|abort/i.test(msg);
}

export async function withRetry<T>(fn: () => Promise<T>, { attempts = 3, baseMs = 800 } = {}): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= attempts || !isRetryable(error)) throw error;
      const delay = baseMs * 2 ** (attempt - 1) + Math.random() * 250;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}
