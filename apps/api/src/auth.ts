import { createHash, timingSafeEqual } from "node:crypto";

export const MIN_PRODUCTION_AUTH_TOKEN_LENGTH = 32;

export type ProductionAuthConfig = {
  nodeEnv: string;
  token?: string;
};

export function assertProductionAuthConfigured({ nodeEnv, token }: ProductionAuthConfig): void {
  if (nodeEnv !== "production") return;

  if (!token) {
    throw new Error(
      "API_AUTH_TOKEN is required when NODE_ENV=production. Generate one with: openssl rand -hex 32"
    );
  }

  if (token.length < MIN_PRODUCTION_AUTH_TOKEN_LENGTH) {
    throw new Error(
      `API_AUTH_TOKEN must be at least ${MIN_PRODUCTION_AUTH_TOKEN_LENGTH} characters in production.`
    );
  }
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function constantTimeEqual(left: string, right: string): boolean {
  return timingSafeEqual(digest(left), digest(right));
}

function decodeBasicCredential(header: string, expectedUsername: string): string | null {
  const encoded = header.slice("Basic ".length).trim();
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null;

  let decoded: string;
  try {
    decoded = Buffer.from(encoded, "base64").toString("utf8");
  } catch {
    return null;
  }

  const separator = decoded.indexOf(":");
  if (separator < 0) return null;

  const username = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);
  if (!constantTimeEqual(username, expectedUsername)) return null;

  return password;
}

export function credentialFromAuthorizationHeader(
  authorizationHeader: string | undefined,
  expectedUsername: string
): string | null {
  if (!authorizationHeader) return null;

  const bearerMatch = authorizationHeader.match(/^Bearer[\t ]+(.+)$/i);
  if (bearerMatch?.[1]) return bearerMatch[1].trim();

  if (/^Basic[\t ]+/i.test(authorizationHeader)) {
    return decodeBasicCredential(authorizationHeader, expectedUsername);
  }

  return null;
}

export function isAuthorizedRequest(
  authorizationHeader: string | undefined,
  expectedToken: string | undefined,
  expectedUsername: string
): boolean {
  // Local development remains usable without a token. Production startup is
  // blocked by assertProductionAuthConfigured when the token is absent.
  if (!expectedToken) return true;

  const presented = credentialFromAuthorizationHeader(authorizationHeader, expectedUsername);
  return presented !== null && constantTimeEqual(presented, expectedToken);
}

export function isPublicAuthRequest(method: string, requestUrl: string): boolean {
  if (method.toUpperCase() === "OPTIONS") return true;

  const pathname = requestUrl.split("?", 1)[0] ?? requestUrl;
  if (pathname === "/health" || pathname === "/api/health") return true;

  // These callbacks remain public until the separate webhook-signature audit
  // finding is implemented. They must not use the shared admin credential.
  if (pathname === "/api/modal/webhook" || pathname === "/api/openrouter/webhook") return true;

  // Modal workers currently fetch uploaded media through these URLs. This path
  // will be replaced with signed media URLs under the upload/storage finding.
  if (pathname.startsWith("/storage/")) return true;

  return false;
}

export function redactSensitiveHeaders(
  headers: Record<string, unknown>
): Record<string, unknown> {
  const redacted = { ...headers };
  for (const key of ["authorization", "cookie", "set-cookie", "x-api-key"]) {
    if (key in redacted) redacted[key] = "[REDACTED]";
  }
  return redacted;
}
