import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const localChatModule = await import("./director_chat_local.js").catch(() => null);

const plan = {
  shots: [
    { clipId: "clip-a", sectionLabel: "Intro", start: 0, end: 6, prompt: "Wide rooftop performance with the artist centered under neon lights.", continuityNotes: "Keep red suit", transition: "cut" },
    { clipId: "clip-b", sectionLabel: "Verse", start: 6, end: 12, prompt: "Medium performance shot with a slow clockwise camera orbit.", continuityNotes: "Same wardrobe", transition: "match cut" },
  ],
};

test("local Director chat can regenerate a targeted clip without changing timing", () => {
  assert.ok(localChatModule, "director_chat_local module must exist");
  const result = localChatModule!.buildLocalDirectorChatResponse({ message: "regenerate clip 2", plan });
  assert.equal(result.actions.length, 1);
  assert.deepEqual(result.actions[0], { type: "update_clip", clipId: "clip-b", regenerate: true });
  assert.doesNotMatch(JSON.stringify(result.actions[0]), /start|end/);
  assert.match(result.reply, /local/i);
});

test("local Director chat can apply a targeted creative edit while preserving the existing prompt", () => {
  assert.ok(localChatModule, "director_chat_local module must exist");
  const result = localChatModule!.buildLocalDirectorChatResponse({ message: "make shot 1 a dramatic low-angle orbit with faster movement", plan });
  assert.equal(result.actions.length, 1);
  const action = result.actions[0];
  assert.equal(action.type, "update_clip");
  assert.equal(action.clipId, "clip-a");
  assert.match(action.prompt ?? "", /Wide rooftop performance/i);
  assert.match(action.prompt ?? "", /dramatic low-angle orbit/i);
  assert.doesNotMatch(JSON.stringify(action), /start|end/);
});

test("untargeted local chat fails safely with no actions instead of inventing clip IDs", () => {
  assert.ok(localChatModule, "director_chat_local module must exist");
  const result = localChatModule!.buildLocalDirectorChatResponse({ message: "make it more cinematic", plan });
  assert.deepEqual(result.actions, []);
  assert.match(result.reply, /clip|shot/i);
});

test("Director chat source uses Gemini retries and local fallback", async () => {
  const source = await readFile(new URL("./director_chat.ts", import.meta.url), "utf8");
  assert.match(source, /runGeminiDirectorWithFallback/);
  assert.match(source, /buildLocalDirectorChatResponse/);
  assert.match(source, /response\.status/);
});
