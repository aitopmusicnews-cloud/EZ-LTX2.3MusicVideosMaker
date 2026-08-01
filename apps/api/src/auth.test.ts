import assert from "node:assert/strict";
import test from "node:test";
import {
  assertProductionAuthConfigured,
  constantTimeEqual,
  credentialFromAuthorizationHeader,
  isAuthorizedRequest,
  isPublicAuthRequest,
  redactSensitiveHeaders,
} from "./auth.js";

test("production refuses to start without an API auth token", () => {
  assert.throws(
    () => assertProductionAuthConfigured({ nodeEnv: "production" }),
    /API_AUTH_TOKEN is required/
  );
});

test("production rejects weak API auth tokens", () => {
  assert.throws(
    () => assertProductionAuthConfigured({ nodeEnv: "production", token: "too-short" }),
    /at least 32 characters/
  );
});

test("development may run without authentication", () => {
  assert.doesNotThrow(() => assertProductionAuthConfigured({ nodeEnv: "development" }));
});

test("constant-time comparison returns the expected result", () => {
  assert.equal(constantTimeEqual("same-value", "same-value"), true);
  assert.equal(constantTimeEqual("same-value", "different-value"), false);
});

test("Bearer credentials authenticate correctly", () => {
  assert.equal(isAuthorizedRequest("Bearer secret-token", "secret-token", "admin"), true);
  assert.equal(isAuthorizedRequest("Bearer wrong-token", "secret-token", "admin"), false);
});

test("Basic credentials require the configured username and password", () => {
  const valid = `Basic ${Buffer.from("studio-owner:secret-token").toString("base64")}`;
  const wrongUser = `Basic ${Buffer.from("other-user:secret-token").toString("base64")}`;

  assert.equal(credentialFromAuthorizationHeader(valid, "studio-owner"), "secret-token");
  assert.equal(isAuthorizedRequest(valid, "secret-token", "studio-owner"), true);
  assert.equal(isAuthorizedRequest(wrongUser, "secret-token", "studio-owner"), false);
});

test("query-string tokens are not treated as credentials", () => {
  assert.equal(isAuthorizedRequest(undefined, "secret-token", "admin"), false);
});

test("only health, callback, storage, and preflight requests bypass admin auth", () => {
  assert.equal(isPublicAuthRequest("GET", "/health"), true);
  assert.equal(isPublicAuthRequest("GET", "/api/health"), true);
  assert.equal(isPublicAuthRequest("POST", "/api/modal/webhook"), true);
  assert.equal(isPublicAuthRequest("GET", "/storage/uploads/example.mp4"), true);
  assert.equal(isPublicAuthRequest("OPTIONS", "/api/projects"), true);
  assert.equal(isPublicAuthRequest("GET", "/"), false);
  assert.equal(isPublicAuthRequest("GET", "/api/projects"), false);
});

test("sensitive request headers are redacted before logging", () => {
  assert.deepEqual(
    redactSensitiveHeaders({
      authorization: "Bearer top-secret",
      cookie: "session=secret",
      host: "example.test",
    }),
    {
      authorization: "[REDACTED]",
      cookie: "[REDACTED]",
      host: "example.test",
    }
  );
});
