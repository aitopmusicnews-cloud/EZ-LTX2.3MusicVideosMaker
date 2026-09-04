import type {
  ScriptLockedCompileRequest,
  ScriptLockedCompileResponse,
  ScriptLockedEditRequest,
  ScriptLockedEditResponse,
} from "./directorScriptLocked.js";

async function readJsonOrThrow<T>(response: Response): Promise<T> {
  const text = await response.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok) {
    const message = typeof parsed?.error === "string"
      ? parsed.error
      : (/<html|<!doctype/i.test(text) ? "The Director service is temporarily unavailable." : text.slice(0, 500));
    throw new Error(message || `Director request failed (${response.status})`);
  }
  return parsed as T;
}

export async function compileScriptLocked(request: ScriptLockedCompileRequest): Promise<ScriptLockedCompileResponse> {
  return readJsonOrThrow<ScriptLockedCompileResponse>(await fetch("/api/director/scriptlocked/compile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  }));
}

export async function editScriptLocked(request: ScriptLockedEditRequest): Promise<ScriptLockedEditResponse> {
  return readJsonOrThrow<ScriptLockedEditResponse>(await fetch("/api/director/scriptlocked/edit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  }));
}
