# Director Asset Chat + Multi-Character Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a compact, target-locked edit chat under every Director scene image, shot image, and production clip, while allowing multiple project-approved characters and one-or-more approved characters per asset without changing Agnes's single-seed video contract.

**Architecture:** Keep the existing build-patch architecture. Add small pure helpers for character state/media resolution and Director chat transport, add focused UI components for character approval/picking and asset chat, extend the API chat schema with a locked target, and add one dedicated `director-multichar.patch.mjs` applied after the existing Director chat + left-rail patches. Multi-character identity is composed during the approval-image stage; the approved shot image is then the single Agnes video seed. Chat never spends provider credits automatically.

**Tech Stack:** TypeScript, React, Zustand-backed editor state, Node `node:test`, Zod, Vite, GitHub Actions, Render, existing Agnes video scheduler and text-to-image API.

**Spec:** `docs/superpowers/specs/2026-09-02-director-asset-chat-multichar-design.md`

## Global Constraints

- Preserve precedence: **User Vision > explicit Director edits > Director suggestions > audio analysis**.
- Preserve exact timeline start/end values and the user-controlled clip count.
- Do not change the Render branch or service configuration.
- Do not change Agnes to accept multiple raw character seed images.
- Sending chat must not enqueue image or video generation.
- A chat request containing regeneration intent only marks/prepares that asset for explicit regeneration.
- A chat image-edit action only stores a pending image edit; the user must press the explicit image generation/edit button.
- Completed media remains locked until explicit regeneration/replacement.
- For a character-required clip, production must use an **approved shot image** as the seed; if no approved shot image exists, block production instead of silently falling back to a raw character image.
- Keep the existing global Director chat for broad/multi-asset edits.
- Use TDD for every behavior change: add/modify a failing regression, observe RED, implement minimally, observe GREEN, then commit.
- Do not run real image/Agnes provider generations as automated verification; use unit/source/build tests to avoid spending credits.

---

## Task 1: Add pure multi-character state and migration helpers

**Files:**
- Create: `apps/web/src/lib/directorCharacterState.ts`
- Create: `apps/web/src/lib/directorCharacterState.test.ts`

- [ ] **Step 1: Write fail-first tests for project approval, per-clip selection, and legacy migration**

Create tests that prove:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  migrateDirectorCharacterState,
  selectionForClip,
  setClipCharacterSelection,
  toggleApprovedCharacter,
} from "./directorCharacterState.js";

test("multiple character IDs can be approved independently", () => {
  let ids = toggleApprovedCharacter([], "char-a");
  ids = toggleApprovedCharacter(ids, "char-b");
  assert.deepEqual(ids, ["char-a", "char-b"]);
  ids = toggleApprovedCharacter(ids, "char-a");
  assert.deepEqual(ids, ["char-b"]);
});

test("a clip can select two approved characters", () => {
  const next = setClipCharacterSelection({}, "clip-1", ["char-a", "char-b"], ["char-a", "char-b"]);
  assert.deepEqual(next["clip-1"], ["char-a", "char-b"]);
});

test("legacy single-character approval migrates without losing identity", () => {
  const state = migrateDirectorCharacterState({
    legacyCharacterApproved: true,
    legacyCharacterReferenceId: "char-a",
    validCharacterIds: ["char-a", "char-b"],
  });
  assert.deepEqual(state.approvedCharacterIds, ["char-a"]);
});

test("legacy conditioningReferenceId supplies the default clip selection", () => {
  assert.deepEqual(selectionForClip({}, "clip-1", "char-a"), ["char-a"]);
});
```

Run:

```bash
npx tsx --test apps/web/src/lib/directorCharacterState.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 2: Implement the pure helper module**

Use explicit types:

```ts
export type DirectorCharacterState = {
  approvedCharacterIds: string[];
  characterSelections: Record<string, string[]>;
};

export type CharacterMigrationInput = {
  approvedCharacterIds?: unknown;
  characterSelections?: unknown;
  legacyCharacterApproved?: boolean;
  legacyCharacterReferenceId?: string | null;
  validCharacterIds: string[];
};
```

Implement:

```ts
export function toggleApprovedCharacter(ids: string[], id: string): string[];
export function setClipCharacterSelection(
  current: Record<string, string[]>,
  clipId: string,
  requestedIds: string[],
  approvedIds: string[],
): Record<string, string[]>;
export function selectionForClip(
  selections: Record<string, string[]>,
  clipId: string,
  legacyConditioningReferenceId?: string | null,
): string[];
export function migrateDirectorCharacterState(input: CharacterMigrationInput): DirectorCharacterState;
```

Rules:
- de-duplicate IDs while preserving order;
- drop IDs that are not in `validCharacterIds`;
- allow the special `store-character` ID only when it is included in `validCharacterIds`;
- clip selections may contain only currently approved IDs when set interactively;
- legacy migration may populate `approvedCharacterIds` from an approved `legacyCharacterReferenceId`;
- never mutate the input arrays/maps.

- [ ] **Step 3: Run the helper tests and commit**

```bash
npx tsx --test apps/web/src/lib/directorCharacterState.test.ts
```

Expected: PASS.

Commit:

```bash
git add apps/web/src/lib/directorCharacterState.ts apps/web/src/lib/directorCharacterState.test.ts
git commit -m "feat: add Director multi-character state helpers"
```

---

## Task 2: Add locked-target Director chat to the API and local quota fallback

**Files:**
- Modify: `apps/api/src/director_chat.ts`
- Modify: `apps/api/src/director_chat_local.ts`
- Modify: `apps/api/src/director_chat_local.test.ts`

- [ ] **Step 1: Add RED tests for target-locked local editing**

Extend `director_chat_local.test.ts` with:

```ts
test("targeted clip chat works without naming a clip number", () => {
  const result = localChatModule!.buildLocalDirectorChatResponse({
    message: "make it a dramatic low-angle orbit",
    target: { type: "clip", clipId: "clip-b" },
    plan,
  });
  assert.equal(result.actions.length, 1);
  assert.equal(result.actions[0]?.type, "update_clip");
  assert.equal(result.actions[0]?.clipId, "clip-b");
  assert.doesNotMatch(JSON.stringify(result.actions[0]), /start|end/);
});

test("targeted shot-image chat produces only the requested shot-image action", () => {
  const result = localChatModule!.buildLocalDirectorChatResponse({
    message: "make the lighting warmer",
    target: { type: "shot_image", clipId: "clip-a" },
    plan,
  });
  assert.deepEqual(result.actions.map((action) => [action.type, action.clipId]), [["edit_shot_image", "clip-a"]]);
});

test("targeted scene-image chat produces only the requested scene-image action", () => {
  const result = localChatModule!.buildLocalDirectorChatResponse({
    message: "remove the car",
    target: { type: "scene_image", clipId: "clip-b" },
    plan,
  });
  assert.deepEqual(result.actions.map((action) => [action.type, action.clipId]), [["edit_scene_image", "clip-b"]]);
});

test("invalid locked targets fail safely", () => {
  const result = localChatModule!.buildLocalDirectorChatResponse({
    message: "make it darker",
    target: { type: "clip", clipId: "missing" },
    plan,
  });
  assert.deepEqual(result.actions, []);
});

test("targeted chat still refuses timing edits", () => {
  const result = localChatModule!.buildLocalDirectorChatResponse({
    message: "extend this clip to 10 seconds",
    target: { type: "clip", clipId: "clip-a" },
    plan,
  });
  assert.deepEqual(result.actions, []);
});
```

Also strengthen the source test to require `target` in `director_chat.ts`.

Run:

```bash
npx tsx --test apps/api/src/director_chat_local.test.ts
```

Expected: FAIL because `target` is not supported.

- [ ] **Step 2: Extend local fallback request types and target resolution**

Add:

```ts
export type LocalDirectorChatTarget = {
  type: "scene_image" | "shot_image" | "clip";
  clipId: string;
};

export type LocalDirectorChatRequest = {
  message: string;
  plan: { shots: LocalDirectorChatShot[] };
  target?: LocalDirectorChatTarget;
};
```

Behavior:
- if `target` exists, resolve exactly that clip before any free-text target parsing;
- if the target clip is absent, return no actions;
- `scene_image` always creates `edit_scene_image` for the target clip;
- `shot_image` always creates `edit_shot_image` for the target clip;
- `clip` creates `update_clip`; regeneration language sets `regenerate:true`, otherwise append the creative edit to the existing prompt;
- timing requests still return no actions;
- global chat with no target keeps its current number/ID parsing behavior.

- [ ] **Step 3: Extend the API request schema and Gemini context**

In `director_chat.ts`, add:

```ts
const DirectorChatTargetSchema = z.object({
  type: z.enum(["scene_image", "shot_image", "clip"]),
  clipId: z.string().min(1),
});
```

Add `target: DirectorChatTargetSchema.optional()` to `DirectorChatRequestSchema`.

Immediately after parsing:

```ts
if (req.target && !validClipIds.has(req.target.clipId)) {
  throw new Error(`Director chat target referenced unknown clipId ${req.target.clipId}.`);
}
```

Pass `target` to local fallback and Gemini context.

Strengthen `systemInstruction()`:
- when a locked target is present, all returned actions must use that `clipId`;
- `scene_image` target permits only `edit_scene_image`;
- `shot_image` target permits only `edit_shot_image`;
- `clip` target permits only `update_clip`;
- never alter timing.

Validate Gemini output against the lock before returning it. If Gemini violates the lock, throw inside the try so local fallback handles the request safely.

- [ ] **Step 4: Run API regressions and commit**

```bash
npx tsx --test apps/api/src/director_chat_local.test.ts apps/api/src/director_agent.retry.test.ts apps/api/src/director_local_plan.test.ts
```

Expected: PASS.

Commit:

```bash
git add apps/api/src/director_chat.ts apps/api/src/director_chat_local.ts apps/api/src/director_chat_local.test.ts
git commit -m "feat: lock Director chat to individual assets"
```

---

## Task 3: Create a reusable web chat client and compact `AssetEditChat`

**Files:**
- Create: `apps/web/src/lib/directorChatClient.ts`
- Create: `apps/web/src/lib/directorChatClient.test.ts`
- Create: `apps/web/src/components/AssetEditChat.tsx`
- Modify: `apps/web/src/components/DirectorEditChat.tsx`

- [ ] **Step 1: Write RED tests for the request payload builder**

Expose a pure builder so no browser fetch mocking is required:

```ts
export type DirectorChatTarget = {
  type: "scene_image" | "shot_image" | "clip";
  clipId: string;
};
```

Test:

```ts
test("asset chat payload includes the locked target", () => {
  const payload = buildDirectorChatRequest({
    message: "make it warmer",
    plan: { shots: [] },
    references: [],
    sceneImages: {},
    shotImages: {},
    history: [],
    target: { type: "shot_image", clipId: "clip-a" },
  });
  assert.deepEqual(payload.target, { type: "shot_image", clipId: "clip-a" });
});
```

Run:

```bash
npx tsx --test apps/web/src/lib/directorChatClient.test.ts
```

Expected: FAIL because the client does not exist.

- [ ] **Step 2: Implement typed shared chat transport**

Move/reuse the action type here:

```ts
export type DirectorEditAction =
  | {
      type: "update_clip";
      clipId: string;
      prompt?: string;
      continuityNotes?: string;
      transition?: string;
      sectionLabel?: string;
      requiresCharacter?: boolean;
      conditioningReferenceId?: string | null;
      regenerate?: boolean;
    }
  | { type: "edit_scene_image" | "edit_shot_image"; clipId: string; prompt: string };
```

Implement:

```ts
export function buildDirectorChatRequest(input: DirectorChatRequestInput): Record<string, unknown>;
export async function requestDirectorChat(input: DirectorChatRequestInput): Promise<{
  reply: string;
  actions: DirectorEditAction[];
}>;
```

The network function posts to `/api/director/chat` and preserves the current HTML/error-safe parsing behavior.

- [ ] **Step 3: Refactor global `DirectorEditChat` to use the shared client**

Keep the global UI and focus-event behavior unchanged. Replace its inline `fetch()` with `requestDirectorChat()` and import `DirectorEditAction` from the new client.

No target is passed by global chat.

- [ ] **Step 4: Create `AssetEditChat`**

Use compact props:

```ts
type Props = {
  label: string;
  target: DirectorChatTarget;
  plan: unknown;
  references: unknown[];
  sceneImages: Record<string, string>;
  shotImages: Record<string, string>;
  disabled?: boolean;
  onApply: (actions: DirectorEditAction[]) => Promise<void>;
};
```

Behavior:
- one compact textarea/input and Send button directly under the asset;
- local `pending`, `error`, and last Director reply;
- request includes the locked `target`;
- it calls `onApply(actions)` but contains **no** image/video provider calls;
- placeholder examples depend on target type;
- `aria-label` includes target clip ID for testability.

- [ ] **Step 5: Run tests/build for the new client/components and commit**

```bash
npx tsx --test apps/web/src/lib/directorChatClient.test.ts
npm run build --workspace @mvs/web
```

Expected: PASS.

Commit:

```bash
git add apps/web/src/lib/directorChatClient.ts apps/web/src/lib/directorChatClient.test.ts apps/web/src/components/AssetEditChat.tsx apps/web/src/components/DirectorEditChat.tsx
git commit -m "feat: add target-locked asset edit chat"
```

---

## Task 4: Add project character approvals and session migration to the active Director

**Files:**
- Create: `apps/web/src/components/DirectorCharacterControls.tsx`
- Create: `apps/web/scripts/director-multichar.patch.mjs`
- Create: `apps/web/src/components/LtxDirectorAgent.multichar.test.ts`
- Modify: `apps/web/scripts/build.mjs`
- Modify: `apps/web/src/components/LtxDirectorAgent.vision-first.test.ts`

- [ ] **Step 1: Add fail-first regression for final active Director state**

The test must apply patches in the same order as production:

```ts
let patched = patchOptionalCharacterConditioning(source, replaceRequired);
patched = patchDirectorChat(patched, replaceRequired);
patched = patchDirectorLeftRailLauncher(patched, replaceRequired);
patched = patchDirectorMultiCharacter(patched, replaceRequired);
```

Assert:

```ts
assert.match(patched, /const SESSION_VERSION = 4/);
assert.match(patched, /approvedCharacterIds/);
assert.match(patched, /characterSelections/);
assert.match(patched, /migrateDirectorCharacterState/);
assert.doesNotMatch(patched, /if \(!session\.characterApproved/);
```

Also assert the Vision-first code remains present:

```ts
assert.match(patched, /buildVisionTimelineClips/);
assert.match(patched, /Vision override detected:/);
```

Run the new test and observe RED.

- [ ] **Step 2: Implement `DirectorCharacterControls.tsx`**

Export two focused components:

```ts
export function DirectorCharacterApproval(props: {
  characters: CharacterOption[];
  approvedIds: string[];
  onToggle: (id: string) => void;
}): JSX.Element;

export function DirectorCharacterPicker(props: {
  label?: string;
  characters: CharacterOption[];
  approvedIds: string[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}): JSX.Element;
```

`CharacterOption` contains `{ id, name, url }`.

UI rules:
- project panel shows every ready character reference as a card/chip with independent Approve/Unapprove control;
- picker shows only approved characters;
- multiple chips can be active simultaneously;
- no provider calls occur from approval/selection controls.

- [ ] **Step 3: Implement a dedicated final-stage Director patch**

`patchDirectorMultiCharacter(source, replaceRequired)` runs after the existing chat + left-rail patches and performs these final active-Agent changes:

1. Import `DirectorCharacterApproval`, character helper functions, and media helper placeholders to be filled in Task 5.
2. Bump patched session version `3 -> 4`.
3. Extend `AgentSession` with:

```ts
approvedCharacterIds: string[];
characterSelections: Record<string, string[]>;
pendingAssetEdits: Record<string, {
  targetType: "scene_image" | "shot_image" | "clip";
  prompt?: string;
  regenerate?: boolean;
}>;
```

Keep `characterApproved?: boolean` only as a legacy read/migration field; do not use it as a production gate.

4. Make `emptySession()` initialize new fields.
5. On session restore, build valid character IDs from ready character references plus `store-character` when `characterImageUrl` exists, call `migrateDirectorCharacterState`, and preserve scene/shot approvals and pending edits.
6. When a new plan is built, preserve `approvedCharacterIds`, reset `characterSelections` for the new plan only if clip IDs changed, and clear stale pending edit intents. Do not clear project character approval.
7. Add `DirectorCharacterApproval` near the existing character/reference asset strip.
8. Replace the single-character approval gate with: if `session.characterRequired`, at least one approved character must exist.
9. Preserve legacy `conditioningReferenceId` so old plan data remains valid.

Because references are read from song-local storage, migration must be deterministic and must not trigger generation or rewrite timeline clips.

- [ ] **Step 4: Wire the patch into `build.mjs` after all existing active-Agent patches**

Add:

```ts
import { patchDirectorMultiCharacter } from "./director-multichar.patch.mjs";
```

Then:

```ts
patchedAgent = patchDirectorChat(patchedAgent, replaceRequired);
patchedAgent = patchDirectorLeftRailLauncher(patchedAgent, replaceRequired);
patchedAgent = patchDirectorMultiCharacter(patchedAgent, replaceRequired);
```

Log:

```ts
console.log("[web build] Enabled multi-character Director approval and asset selections.");
```

- [ ] **Step 5: Update the existing Vision regression to assert final session v4**

Do not leave a production-facing regression asserting the intermediate v3 state. Apply the multi-character patch in `LtxDirectorAgent.vision-first.test.ts` or assert v4 in the full-chain test while preserving all Vision/clip-count assertions.

- [ ] **Step 6: Run regressions and commit**

```bash
node apps/web/scripts/clip-count-prebuild.mjs
npx tsx --test \
  apps/web/src/lib/directorCharacterState.test.ts \
  apps/web/src/components/LtxDirectorAgent.multichar.test.ts \
  apps/web/src/components/LtxDirectorAgent.vision-first.test.ts
npm run build --workspace @mvs/web
```

Expected: PASS.

Commit:

```bash
git add apps/web/src/components/DirectorCharacterControls.tsx apps/web/scripts/director-multichar.patch.mjs apps/web/scripts/build.mjs apps/web/src/components/LtxDirectorAgent.multichar.test.ts apps/web/src/components/LtxDirectorAgent.vision-first.test.ts
git commit -m "feat: add Director multi-character approval state"
```

---

## Task 5: Generate approval images with multiple character references and seed Agnes from the approved shot image

**Files:**
- Create: `apps/web/src/lib/directorCharacterMedia.ts`
- Create: `apps/web/src/lib/directorCharacterMedia.test.ts`
- Modify: `apps/web/scripts/director-multichar.patch.mjs`
- Modify: `apps/web/src/components/LtxDirectorAgent.multichar.test.ts`

- [ ] **Step 1: Write RED tests for reference image arrays and video seed choice**

Test pure helpers:

```ts
test("selected character IDs resolve to deduped reference URLs", () => {
  const urls = resolveCharacterReferenceUrls(
    ["char-a", "char-b"],
    [
      { id: "char-a", anchorUrl: "/a.png" },
      { id: "char-b", anchorUrl: "/b.png" },
    ],
    null,
  );
  assert.deepEqual(urls, ["/a.png", "/b.png"]);
});

test("current image is first preservation reference and characters follow", () => {
  assert.deepEqual(
    buildApprovalReferenceImages("/current.png", ["/a.png", "/b.png"]),
    [{ uri: "/current.png" }, { uri: "/a.png" }, { uri: "/b.png" }],
  );
});

test("approved shot image is the Agnes seed", () => {
  assert.equal(chooseApprovedShotSeed({ url: "/shot.png", approved: true }), "/shot.png");
  assert.equal(chooseApprovedShotSeed({ url: "/shot.png", approved: false }), undefined);
});
```

Run and observe RED.

- [ ] **Step 2: Implement media helpers**

Create:

```ts
export type CharacterReferenceLike = {
  id: string;
  url?: string;
  anchorUrl?: string;
};

export function resolveCharacterReferenceUrls(
  selectionIds: string[],
  references: CharacterReferenceLike[],
  storeCharacterUrl: string | null,
): string[];

export function buildApprovalReferenceImages(
  currentImageUrl: string | undefined,
  selectedCharacterUrls: string[],
): Array<{ uri: string }>;

export function chooseApprovedShotSeed(
  approval?: { url: string; approved: boolean },
): string | undefined;
```

Special ID `store-character` resolves to `storeCharacterUrl`.

- [ ] **Step 3: Change approval image generation to accept an array of references**

The final patched Agent must produce the equivalent of:

```ts
async function generateApprovalImage(prompt: string, referenceUrls: string[] = []): Promise<string> {
  const referenceImages = [...new Set(referenceUrls.filter(Boolean))].map((uri) => ({ uri }));
  const { id } = await startTextToImage({
    prompt: prompt.trim(),
    promptText: prompt.trim(),
    model: "openrouter_image_flash",
    ratio: "1920:1080",
    ...(referenceImages.length ? { referenceImages } : {}),
  });
  // existing poll/save behavior remains unchanged
}
```

For explicit scene/shot image generation/editing:
- resolve that clip's selected approved character IDs;
- build reference list with current scene/shot image first when editing;
- append all selected character URLs;
- reset only the regenerated image's approval to `false`.

- [ ] **Step 4: Make approved shot images the only character-safe Agnes seed**

Change `generateSectionPreview` and any remaining active production path so:

```ts
const approvedShotSeed = chooseApprovedShotSeed(session.shotApprovals[clipId]);
if (shot.requiresCharacter && !approvedShotSeed) {
  setError(`${shot.sectionLabel} needs an approved shot image before video generation.`);
  return;
}
const seedImageUrl = approvedShotSeed;
const source = seedImageUrl ? "imageToVideo" : previousReady ? "continue" : "textToVideo";
```

Set both `seedImageUrl` and `archetypeUrl` to the approved shot image when present.

Do **not** fall back to a raw `conditioningReferenceId` when the shot requires characters. The approved shot image is the identity-composed bridge from multiple references into Agnes's single-seed video request.

- [ ] **Step 5: Add source regressions for multi-reference generation and approved-shot seeding**

The full-chain Director test should assert the patched source contains:

```ts
/referenceImages/
/approved shot image/i
/seedImageUrl: approvedShotSeed/
```

and does not contain the old character-required fallback pattern in `generateSectionPreview`.

- [ ] **Step 6: Run tests and commit**

```bash
npx tsx --test apps/web/src/lib/directorCharacterMedia.test.ts apps/web/src/components/LtxDirectorAgent.multichar.test.ts
npm run build --workspace @mvs/web
```

Expected: PASS.

Commit:

```bash
git add apps/web/src/lib/directorCharacterMedia.ts apps/web/src/lib/directorCharacterMedia.test.ts apps/web/scripts/director-multichar.patch.mjs apps/web/src/components/LtxDirectorAgent.multichar.test.ts
git commit -m "feat: seed Agnes from approved multi-character shots"
```

---

## Task 6: Put edit chat and character pickers directly under images and clips, and make chat credit-safe

**Files:**
- Modify: `apps/web/src/components/DirectorAssetsPanel.tsx`
- Modify: `apps/web/src/components/DirectorSectionReview.tsx`
- Modify: `apps/web/scripts/director-chat-patch.mjs`
- Modify: `apps/web/scripts/director-multichar.patch.mjs`
- Create: `apps/web/src/components/DirectorAssetEditing.test.ts`
- Modify: `.github/workflows/build-check.yml`

- [ ] **Step 1: Add RED source regressions for inline chat, character pickers, and no auto-generation**

Test the actual components/patch output for:

```ts
assert.match(assetsPanelSource, /AssetEditChat/);
assert.match(sectionReviewSource, /AssetEditChat/);
assert.match(assetsPanelSource, /DirectorCharacterPicker/);
assert.match(sectionReviewSource, /DirectorCharacterPicker/);
```

Apply `patchDirectorChat` + `patchDirectorMultiCharacter` to the active Agent and assert:

```ts
assert.match(patchedAgent, /pendingAssetEdits/);
assert.doesNotMatch(patchedAgent, /if \(action\.regenerate\)[\s\S]{0,500}generateSectionPreview\(action\.clipId\)/);
assert.doesNotMatch(patchedAgent, /action\.type === "edit_scene_image"[\s\S]{0,500}await generateSceneVisual/);
```

Also assert chat actions do not write `start` or `end`.

Run the new test and observe RED.

- [ ] **Step 2: Change chat action application from provider execution to prepared state**

This is a required correction to the current code.

For `update_clip`:
- apply prompt/continuity/transition/section label changes as free state edits;
- do not modify `start` or `end`;
- if `regenerate:true`, set:

```ts
pendingAssetEdits[clipId] = {
  targetType: "clip",
  regenerate: true,
};
```

Do not call `generateSectionPreview()` from chat.

For `edit_scene_image` / `edit_shot_image`:
- store the returned prompt in `pendingAssetEdits[clipId]` with its target type;
- do not call `generateSceneVisual()` or `generateShotVisual()` from chat.

The Director reply can say the edit is prepared and the user should press the explicit Generate/Edit/Regenerate control.

- [ ] **Step 3: Add explicit prepared-edit controls to the asset cards**

`DirectorAssetsPanel` props should include:

```ts
plan: unknown;
references: RefAsset[];
approvedCharacterIds: string[];
characterSelections: Record<string, string[]>;
onCharacterSelectionChange: (clipId: string, ids: string[]) => void;
pendingAssetEdits: Record<string, PendingAssetEdit>;
onGeneratePreparedImage: (targetType: "scene_image" | "shot_image", clipId: string) => Promise<void>;
onApplyChatActions: (actions: DirectorEditAction[]) => Promise<void>;
disabled?: boolean;
```

For each generated scene/shot image card:
1. show image;
2. show `DirectorCharacterPicker`;
3. show `AssetEditChat` locked to the correct target;
4. if a pending image edit exists, show **Generate edited image** button;
5. existing Save as asset remains available.

`DirectorSectionReview` gets equivalent chat props. Each clip card:
1. shows `DirectorCharacterPicker`;
2. shows `AssetEditChat target={{ type:"clip", clipId }}` directly under the preview;
3. when chat marks regeneration, show a visible **Regenerate with prepared edit** state/button;
4. explicit existing generate/regenerate button is the only code path that calls `onGenerate`.

Remove the old `Chat changes` button that only scrolls to global chat.

- [ ] **Step 4: Pass final active-Agent callbacks/character state into both panels**

Update the build patches so the rendered workflow is equivalent to:

```tsx
<DirectorAssetsPanel
  plan={session.plan}
  references={readyReferencesMapped}
  sceneImages={sceneImages}
  shotImages={shotImages}
  approvedCharacterIds={session.approvedCharacterIds}
  characterSelections={session.characterSelections}
  onCharacterSelectionChange={setCharacterSelection}
  pendingAssetEdits={session.pendingAssetEdits}
  onGeneratePreparedImage={generatePreparedImage}
  onApplyChatActions={applyDirectorChatActions}
  disabled={!!busy}
/>

<DirectorEditChat ... />

<DirectorSectionReview
  songId={songId}
  plan={session.plan}
  references={readyReferencesMapped}
  sceneImages={sceneImages}
  shotImages={shotImages}
  approvedCharacterIds={session.approvedCharacterIds}
  characterSelections={session.characterSelections}
  onCharacterSelectionChange={setCharacterSelection}
  pendingAssetEdits={session.pendingAssetEdits}
  onApplyChatActions={applyDirectorChatActions}
  disabled={!!busy}
  onGenerate={generateSectionPreview}
/>
```

Character selection changes must reset the corresponding pending/approved shot image state only when the selected identities materially change; never touch clip timing or unrelated assets.

- [ ] **Step 5: Keep global chat available**

Do not remove `DirectorEditChat`. It remains the place for broad commands like “make shots 3 and 4 more energetic.” Inline `AssetEditChat` handles the simple target-local edits.

- [ ] **Step 6: Add the feature branch and new regressions to CI**

Add `feature/director-asset-chat-multichar` to the workflow's push branch list.

Add new tests to the Director regression command:

```bash
apps/web/src/lib/directorCharacterState.test.ts
apps/web/src/lib/directorCharacterMedia.test.ts
apps/web/src/lib/directorChatClient.test.ts
apps/web/src/components/LtxDirectorAgent.multichar.test.ts
apps/web/src/components/DirectorAssetEditing.test.ts
```

Keep every existing Director regression in the command.

- [ ] **Step 7: Run the full regression command and workspace build**

```bash
node apps/web/scripts/clip-count-prebuild.mjs && npx tsx --test \
  apps/web/src/lib/directorVisionParser.test.ts \
  apps/web/src/lib/directorAgentVision.test.ts \
  apps/web/src/lib/directorPlan.test.ts \
  apps/web/src/lib/directorGeneration.test.ts \
  apps/web/src/lib/directorCharacterState.test.ts \
  apps/web/src/lib/directorCharacterMedia.test.ts \
  apps/web/src/lib/directorChatClient.test.ts \
  apps/web/src/components/AutoDirector.vision-first.test.ts \
  apps/web/src/components/LtxDirectorAgent.vision-first.test.ts \
  apps/web/src/components/LtxDirectorAgent.multichar.test.ts \
  apps/web/src/components/DirectorAssetEditing.test.ts \
  apps/api/src/director_agent.retry.test.ts \
  apps/api/src/director_local_plan.test.ts \
  apps/api/src/director_chat_local.test.ts

npm run build
```

Expected: all regressions PASS and shared/web/API workspaces build successfully.

- [ ] **Step 8: Commit the integrated UI/credit-safety work**

```bash
git add apps/web/src/components/DirectorAssetsPanel.tsx apps/web/src/components/DirectorSectionReview.tsx apps/web/scripts/director-chat-patch.mjs apps/web/scripts/director-multichar.patch.mjs apps/web/src/components/DirectorAssetEditing.test.ts .github/workflows/build-check.yml
git commit -m "feat: add inline Director asset editing and character selection"
```

---

## Task 7: Final verification, PR, merge, and Render deployment

**Files:**
- Review all files changed on `feature/director-asset-chat-multichar`
- No provider credentials or Render configuration changes

- [ ] **Step 1: Re-run fresh verification on the final head**

Run the exact full regression command and `npm run build` again after the last commit. Do not rely on earlier green runs.

Expected:
- every Director regression PASS;
- shared build PASS;
- web build PASS, including all build-time patches;
- API build PASS.

- [ ] **Step 2: Perform final scope and spec review**

Compare against production base `f517576c54dceac641d0b9a46a49c656e7d2d626`.

Confirm changed files are limited to:
- approved design/plan docs;
- Director chat API/local fallback;
- new character/chat/media helpers and tests;
- Director asset/section/chat/character components;
- Director build patches/build script;
- CI workflow.

Confirm no changes to:
- Render service branch/settings;
- Agnes credentials/provider limits;
- timeline start/end mutation from chat;
- automatic provider generation on chat send.

Spec checklist:
1. multiple project characters can be approved;
2. multiple approved characters can be selected on one asset;
3. legacy single-character state migrates;
4. multi-character image generation sends every selected reference;
5. approved shot image seeds the clip;
6. image/clip cards contain locked inline chat;
7. Gemini quota fallback edits a locked target locally;
8. timing and clip count cannot change from chat;
9. chat cannot auto-spend provider credits;
10. existing Vision-first + editable clip count behavior remains green.

- [ ] **Step 3: Open a PR against production**

Base: `backup-pre-rollback-1890d80`
Head: `feature/director-asset-chat-multichar`

PR title:

```text
Add inline Director editing and multi-character approval
```

PR body must summarize:
- inline edit chat under scene/shot images and production clips;
- project multi-character approval + per-asset character selection;
- approved shot image as single Agnes seed;
- target-locked Gemini/local fallback chat;
- explicit-generation credit safety;
- regression/build evidence.

- [ ] **Step 4: Verify the PR is mergeable and the PR-triggered build is green**

Do not merge while GitHub reports merge conflicts or a failing build.

- [ ] **Step 5: Merge with a true merge commit**

Use merge method `merge` and expected final head SHA.

Merge title:

```text
Add inline Director editing and multi-character approval (#<PR>)
```

- [ ] **Step 6: Verify Render auto-deploys the exact merge commit**

Service: `srv-d9gukmb7uimc73946n6g`
Workspace: `tea-d99sd558nd3s73a2744g`

Confirm:
- branch remains `backup-pre-rollback-1890d80`;
- deployment commit exactly equals the merge commit;
- deployment reaches `live`;
- build logs show the web build applied Vision, chat, left-rail, and multi-character patches successfully.

Do not claim an HTTP `/health` 200 unless directly observed.

- [ ] **Step 7: User-facing smoke-test instructions only—no provider generation**

Ask the user to refresh and verify the UI before spending credits:
1. add two character references;
2. approve both;
3. open one scene/shot and select both characters;
4. confirm inline chat is visible directly beneath the image and beneath the clip card;
5. type a harmless prompt edit and verify it prepares the edit without starting image/video generation;
6. verify the explicit Generate/Edit/Regenerate button remains required.

Do not trigger a real image or Agnes generation automatically.

---

## Plan Self-Review

- **Spec coverage:** Every approved success criterion has a matching implementation task and regression.
- **Build architecture:** The active `LtxDirectorAgent` remains build-patched; new multi-character behavior is isolated in a final dedicated patch rather than mixed into Vision/left-rail logic.
- **Credit safety:** Existing chat behavior that can auto-call image/video generation is explicitly removed and tested against.
- **Provider compatibility:** Multiple character images are composed at the image stage; Agnes still receives one approved shot seed.
- **Migration:** Saved sessions move from the single approval flag to ID arrays/maps without regenerating media or rewriting timelines.
- **Timing safety:** Neither API chat actions nor local fallback actions expose `start`/`end`; tests reject timing requests.
- **No placeholders:** All files, commands, state fields, and acceptance conditions are specified.
- **Verification:** Final claims require fresh regressions, full workspace build, merge-commit confirmation, and Render `live` status.