export const GEMINI_DIRECTOR_FALLBACK_MODEL = "gemini-2.5-flash";

function errorText(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    const causeText = cause instanceof Error ? `${cause.name}: ${cause.message}` : cause ? String(cause) : "";
    return `${error.name}: ${error.message} ${causeText}`.trim();
  }
  return String(error ?? "");
}

export function isTransientGeminiFailure(error: unknown): boolean {
  const status = Number((error as { status?: unknown; statusCode?: unknown } | null)?.status ?? (error as { statusCode?: unknown } | null)?.statusCode);
  if ([429, 500, 502, 503, 504].includes(status)) return true;

  const text = errorText(error).toLowerCase();
  const transientMarkers = [
    "RESOURCE_EXHAUSTED",
    "UNAVAILABLE",
    "high demand",
    "temporarily unavailable",
    "overloaded",
    "Headers Timeout",
    "HeadersTimeout",
    "fetch failed",
    "TimeoutError",
    "timed out",
    "ETIMEDOUT",
    "ECONNRESET",
    "429",
    "503",
  ];
  return transientMarkers.some((marker) => text.includes(marker.toLowerCase()));
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runGeminiDirectorWithFallback<T>(
  primaryModel: string,
  operation: (model: string) => Promise<T>,
  options: { retriesPerModel?: number; baseDelayMs?: number } = {},
): Promise<{ value: T; model: string }> {
  const retriesPerModel = Math.max(1, Math.min(3, Math.round(options.retriesPerModel ?? 2)));
  const baseDelayMs = Math.max(0, Math.round(options.baseDelayMs ?? 1_500));
  const modelCandidates = Array.from(new Set([primaryModel, GEMINI_DIRECTOR_FALLBACK_MODEL].filter(Boolean)));
  let lastError: unknown;

  for (const candidateModel of modelCandidates) {
    for (let attempt = 1; attempt <= retriesPerModel; attempt += 1) {
      try {
        return { value: await operation(candidateModel), model: candidateModel };
      } catch (error) {
        lastError = error;
        if (!isTransientGeminiFailure(error)) throw error;
        if (attempt < retriesPerModel) {
          await delay(baseDelayMs * 2 ** (attempt - 1));
        }
      }
    }
  }

  if (lastError instanceof Error) throw lastError;
  throw new Error("Gemini Director remained unavailable after automatic retries.");
}
