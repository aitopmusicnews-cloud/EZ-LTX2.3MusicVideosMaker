const AGNES_MAX_SEGMENT_DURATION_SECONDS = 441 / 24;
const AGNES_SERVER_SEGMENT_TIMEOUT_MS = 360_000;
const EXISTING_CLIENT_TIMEOUT_MS = 900_000;
const LOGICAL_JOB_MARGIN_MS = 120_000;

export function agnesClientPollTimeoutMs(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("Agnes timeline duration must be a positive finite number.");
  }
  const segmentCount = Math.max(1, Math.ceil(durationSeconds / AGNES_MAX_SEGMENT_DURATION_SECONDS));
  return Math.max(
    EXISTING_CLIENT_TIMEOUT_MS,
    segmentCount * AGNES_SERVER_SEGMENT_TIMEOUT_MS + LOGICAL_JOB_MARGIN_MS,
  );
}
