import {
  AGNES_CREATE_URL,
  AGNES_MODEL,
  isAgnesWaitStatus,
  parseAgnesCreateIds,
  preferredAgnesResultUrl,
  validCompletedMetadataUrl,
  type AgnesCreateIds,
} from "./agnes_core.js";

const REQUEST_TIMEOUT_MS = 30_000;

type FetchLike = typeof fetch;

type AgnesResult =
  | { kind: "waiting"; status: "pending" | "queued" | "in_progress" }
  | { kind: "completed"; url: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function safeCompletedDiagnostics(endpointType: "preferred" | "legacy", payload: Record<string, unknown>) {
  const metadata = isRecord(payload.metadata) ? payload.metadata : null;
  console.warn("Agnes completed result is missing a valid metadata.url", {
    endpointType,
    status: typeof payload.status === "string" ? payload.status : "missing",
    hasMetadata: metadata !== null,
    topLevelKeys: Object.keys(payload),
    metadataKeys: metadata ? Object.keys(metadata) : [],
  });
}

async function readJson(response: Response, context: string): Promise<Record<string, unknown>> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Agnes returned a malformed ${context} response.`);
  }
  if (!isRecord(payload)) throw new Error(`Agnes returned a malformed ${context} response.`);
  if (!response.ok) throw new Error(`Agnes ${context} request failed with status ${response.status}.`);
  return payload;
}

export async function createAgnesVideo(
  input: {
    prompt: string;
    imageUrl?: string;
    width: number;
    height: number;
    numFrames: number;
  },
  apiKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<AgnesCreateIds> {
  let response: Response;
  try {
    response = await fetchImpl(AGNES_CREATE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: AGNES_MODEL,
        prompt: input.prompt,
        ...(input.imageUrl ? { image: input.imageUrl } : {}),
        width: input.width,
        height: input.height,
        num_frames: input.numFrames,
        frame_rate: 24,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not start Agnes video generation: ${message}`);
  }

  const payload = await readJson(response, "create-video");
  return parseAgnesCreateIds(payload);
}

export async function getAgnesResultOnce(
  ids: AgnesCreateIds,
  apiKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<AgnesResult> {
  let response: Response;
  try {
    response = await fetchImpl(preferredAgnesResultUrl(ids.videoId), {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read Agnes video generation status: ${message}`);
  }

  const payload = await readJson(response, "status");
  const status = typeof payload.status === "string" ? payload.status.toLowerCase() : "";

  if (isAgnesWaitStatus(status)) {
    return { kind: "waiting", status: status as "pending" | "queued" | "in_progress" };
  }

  if (status === "failed") {
    throw new Error("Agnes video generation failed before producing a video.");
  }

  if (status !== "completed") {
    throw new Error(`Agnes returned an unexpected video generation status: ${status || "missing"}.`);
  }

  const preferredUrl = validCompletedMetadataUrl(payload);
  if (preferredUrl) return { kind: "completed", url: preferredUrl };
  safeCompletedDiagnostics("preferred", payload);

  if (ids.taskId) {
    let legacyResponse: Response;
    try {
      legacyResponse = await fetchImpl(`${AGNES_CREATE_URL}/${encodeURIComponent(ids.taskId)}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not read the completed Agnes video result: ${message}`);
    }

    const legacyPayload = await readJson(legacyResponse, "legacy result");
    const legacyUrl = validCompletedMetadataUrl(legacyPayload);
    if (legacyUrl) return { kind: "completed", url: legacyUrl };
    safeCompletedDiagnostics("legacy", legacyPayload);
  }

  throw new Error("Agnes completed without returning a valid HTTPS metadata.url.");
}
