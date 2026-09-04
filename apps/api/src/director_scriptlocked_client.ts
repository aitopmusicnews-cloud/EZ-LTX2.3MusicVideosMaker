import { config } from "./config.js";
import {
  ScriptLockedCompileRequestSchema,
  ScriptLockedEditRequestSchema,
  type ScriptLockedCompileRequest,
  type ScriptLockedCompileResponse,
  type ScriptLockedEditRequest,
  type ScriptLockedEditResponse,
  validateCompileResponse,
  validateEditResponse,
} from "./director_scriptlocked_contract.js";
import { buildScriptPreservingFallback } from "./director_scriptlocked_fallback.js";

export class DirectorReasoningHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "DirectorReasoningHttpError";
  }
}

function endpoint(path: string): string {
  if (!config.DIRECTOR_REASONING_URL) throw new DirectorReasoningHttpError("Script-Locked reasoning service URL is not configured", 503, "reasoner_unavailable");
  return new URL(path, `${config.DIRECTOR_REASONING_URL.replace(/\/$/, "")}/`).toString();
}

async function postJson(path: string, body: unknown): Promise<{ status: number; payload: any }> {
  if (!config.DIRECTOR_REASONING_TOKEN) throw new DirectorReasoningHttpError("Script-Locked reasoning token is not configured", 503, "reasoner_unavailable");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch(endpoint(path), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.DIRECTOR_REASONING_TOKEN}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    let payload: any = {};
    try {
      payload = await response.json();
    } catch {
      payload = {};
    }
    return { status: response.status, payload };
  } catch (error) {
    if (error instanceof DirectorReasoningHttpError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new DirectorReasoningHttpError(`Script-Locked reasoning unavailable: ${message}`, 503, "reasoner_unavailable");
  } finally {
    clearTimeout(timeout);
  }
}

function responseError(status: number, payload: any): DirectorReasoningHttpError {
  const code = typeof payload?.error === "string" ? payload.error : "reasoning_error";
  const message = typeof payload?.message === "string" ? payload.message : `Script-Locked reasoning returned HTTP ${status}`;
  return new DirectorReasoningHttpError(message, status, code);
}

export async function compileScriptLockedDirector(rawRequest: unknown): Promise<ScriptLockedCompileResponse> {
  const request = ScriptLockedCompileRequestSchema.parse(rawRequest);
  if (!config.DIRECTOR_SCRIPTLOCKED_ENABLED) {
    throw new DirectorReasoningHttpError("Script-Locked Director is disabled", 404, "scriptlocked_disabled");
  }

  try {
    const { status, payload } = await postJson("v1/compile", request);
    if (status === 503 && payload?.error === "reasoner_unavailable") return buildScriptPreservingFallback(request);
    if (status < 200 || status >= 300) throw responseError(status, payload);
    return validateCompileResponse(request, payload);
  } catch (error) {
    if (error instanceof DirectorReasoningHttpError) {
      if (error.status === 503 && error.code === "reasoner_unavailable") return buildScriptPreservingFallback(request);
      throw error;
    }
    throw error;
  }
}

export async function editScriptLockedDirector(rawRequest: unknown): Promise<ScriptLockedEditResponse> {
  const request: ScriptLockedEditRequest = ScriptLockedEditRequestSchema.parse(rawRequest);
  if (!config.DIRECTOR_SCRIPTLOCKED_ENABLED) {
    throw new DirectorReasoningHttpError("Script-Locked Director is disabled", 404, "scriptlocked_disabled");
  }
  const { status, payload } = await postJson("v1/edit", request);
  if (status < 200 || status >= 300) throw responseError(status, payload);
  return validateEditResponse(request, payload);
}
