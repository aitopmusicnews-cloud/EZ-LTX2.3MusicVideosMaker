# Director Asset Chat + Multi-Character Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a compact, target-locked edit chat directly under every Director scene image, shot image, and production clip while allowing multiple approved characters and one-or-more approved characters per asset, without changing Agnes's single-seed video contract.

**Architecture:** Preserve the current build-patch architecture. Add pure helpers for multi-character state/media resolution, extend Director chat with a validated locked target, reuse one typed web chat client for global and asset chat, and add one final `director-multichar.patch.mjs` after the existing chat and Vision/left-rail patches. Multi-character identity is composed during approval-image generation; the approved shot image becomes the single Agnes video seed. Chat only prepares edits and never spends provider credits automatically.

**Tech Stack:** TypeScript, React, Zustand-backed editor state, Node `node:test`, Zod, Vite, GitHub Actions, Render, existing text-to-image API, existing Agnes scheduler.

**Spec:** `docs/superpowers/specs/2026-09-02-director-asset-chat-multichar-design.md`

## Global Constraints

- Preserve **User Vision > explicit Director edits > Director suggestions > audio analysis**.
- Preserve exact clip `start`/`end` and the user-controlled clip count.
- Do not change Render branch/service configuration.
- Do not change Agnes to accept multiple raw character images.
- Chat send must never enqueue image/video generation.
- Image-edit chat stores a pending edit; user presses an explicit image Generate/Edit button.
- Regenerate chat stores regeneration intent; user presses an explicit video Regenerate button.
- Completed media remains locked until explicit regeneration/replacement.
- Character-required video generation must use an approved shot image as the seed. If none exists, block production.
- Keep the existing global Director chat for broad/multi-asset edits.
- Apply TDD per task: failing regression first, then minimal implementation, then green test/build, then commit.
- Do not run real image or Agnes generations during automated verification.

---

## Task 1: Multi-character state and migration helpers

**Files**
- Create `apps/web/src/lib/directorCharacterState.ts`
- Create `apps/web/src/lib/directorCharacterState.test.ts`

- [ ] **1.1 Write RED tests**

Cover:

```ts
test("multiple characters can be approved independently", () => {
  let ids = toggleApprovedCharacter([], "char-a");
  ids = toggleApprovedCharacter(ids, "char-b");
  assert.deepEqual(ids, ["char-a", "char-b"]);
});

test("unapproving a character removes it from every clip selection", () => {
  const next = sanitizeCharacterSelections(
    { "clip-1": ["char-a", "char-b"], "clip-2": ["char-a"] },
    ["char-b"],
  );
  assert.deepEqual(next, { "clip-1": ["char-b"], "clip-2": [] });
});

test("one clip can select two approved characters", () => {
  const next = setClipCharacterSelection({}, "clip-1", ["char-a", "char-b"], ["char-a", "char-b"]);
  assert.deepEqual(next["clip-1"], ["char-a", "char-b"]);
});

test("legacy single-character approval migrates", () => {
  const state = migrateDirectorCharacterState({
    legacyCharacterApproved: true,
    legacyCharacterReferenceId: "char-a",
    validCharacterIds: ["char-a", "char-b"],
  });
  assert.deepEqual(state.approvedCharacterIds, ["char-a"]);
});

test("legacy conditioning ID becomes the default clip selection", () => {
  assert.deepEqual(selectionForClip({}, "clip-1", "char-a"), ["char-a"]);
});
```

Run:

```bash
npx tsx --test apps/web/src/lib/directorCharacterState.test.ts
```

Expected RED: module/functions absent.

- [ ] **1.2 Implement pure helpers**

```ts
export type DirectorCharacterState = {
  approvedCharacterIds: string[];
  characterSelections: Record<string, string[]>;
};

export function toggleApprovedCharacter(ids: string[], id: string): string[];
export function sanitizeCharacterSelections(
  selections: Record<string, string[]>,
  approvedIds: string[],
): Record<string, string[]>;
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
export function migrateDirectorCharacterState(input: {
  approvedCharacterIds?: unknown;
  characterSelections?: unknown;
  legacyCharacterApproved?: boolean;
  legacyCharacterReferenceId?: string | null;
  validCharacterIds: string[];
}): DirectorCharacterState;
```

Rules: dedupe in stable order, discard invalid IDs, support `store-character` only when supplied as a valid ID, never mutate input, and sanitize selections when approvals shrink.

- [ ] **1.3 Verify and commit**

```bash
npx tsx --test apps/web/src/lib/directorCharacterState.test.ts
```

Commit message: `feat: add Director multi-character state helpers`

---

## Task 2: Locked-target chat in API and local quota fallback

**Files**
- Modify `apps/api/src/director_chat.ts`
- Modify `apps/api/src/director_chat_local.ts`
- Modify `apps/api/src/director_chat_local.test.ts`

- [ ] **2.1 Add RED target tests**

Cover all target types without requiring the user to name a clip:

```ts
buildLocalDirectorChatResponse({
  message: "make it a low-angle orbit",
  target: { type: "clip", clipId: "clip-b" },
  plan,
});

buildLocalDirectorChatResponse({
  message: "make the lighting warmer",
  target: { type: "shot_image", clipId: "clip-a" },
  plan,
});

buildLocalDirectorChatResponse({
  message: "remove the car",
  target: { type: "scene_image", clipId: "clip-b" },
  plan,
});
```

Assertions:
- exact target `clipId` only;
- matching action type only;
- no `start`/`end` fields;
- invalid target => no actions;
- target timing request such as `extend this to 10 seconds` => no actions;
- no-target/global behavior remains unchanged.

Run:

```bash
npx tsx --test apps/api/src/director_chat_local.test.ts
```

Expected RED.

- [ ] **2.2 Extend local request and targeting logic**

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

Target behavior:
- resolve target by exact `clipId` before free-text parsing;
- missing target clip => safe no-action reply;
- `scene_image` => `edit_scene_image`;
- `shot_image` => `edit_shot_image`;
- `clip` => `update_clip`; regeneration language sets `regenerate:true`;
- timing guard runs before action construction.

- [ ] **2.3 Extend API schema and Gemini lock**

Add:

```ts
const DirectorChatTargetSchema = z.object({
  type: z.enum(["scene_image", "shot_image", "clip"]),
  clipId: z.string().min(1),
});
```

Add optional `target` to `DirectorChatRequestSchema`. After creating `validClipIds`, reject an unknown locked target.

Pass `target` into both local fallback and Gemini context. System instruction must say that a locked target permits only the matching action type and exact clip ID. Validate Gemini output against that lock; if it violates the lock, fall through to the local fallback.

- [ ] **2.4 Verify and commit**

```bash
npx tsx --test \
  apps/api/src/director_chat_local.test.ts \
  apps/api/src/director_agent.retry.test.ts \
  apps/api/src/director_local_plan.test.ts
```

Commit message: `feat: lock Director chat to individual assets`

---

## Task 3: Shared web chat client and compact `AssetEditChat`

**Files**
- Create `apps/web/src/lib/directorChatClient.ts`
- Create `apps/web/src/lib/directorChatClient.test.ts`
- Create `apps/web/src/components/AssetEditChat.tsx`
- Modify `apps/web/src/components/DirectorEditChat.tsx`

- [ ] **3.1 Add RED payload tests**

Test pure payload construction:

```ts
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
```

Run `npx tsx --test apps/web/src/lib/directorChatClient.test.ts` and observe RED.

- [ ] **3.2 Implement typed transport**

Move the reusable `DirectorEditAction` type to this client and export:

```ts
export type DirectorChatTarget = {
  type: "scene_image" | "shot_image" | "clip";
  clipId: string;
};

export function buildDirectorChatRequest(input: DirectorChatRequestInput): Record<string, unknown>;
export async function requestDirectorChat(input: DirectorChatRequestInput): Promise<{
  reply: string;
  actions: DirectorEditAction[];
}>;
```

`requestDirectorChat` posts to `/api/director/chat` and retains current safe response/error parsing.

- [ ] **3.3 Refactor global chat**

`DirectorEditChat.tsx` uses `requestDirectorChat` with no target. Keep its existing global thread/focus behavior.

- [ ] **3.4 Create compact asset chat**

`AssetEditChat` props:

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

It renders compact input + Send + last reply/error. It sends the locked target and has zero provider calls.

- [ ] **3.5 Verify and commit**

```bash
npx tsx --test apps/web/src/lib/directorChatClient.test.ts
npm run build --workspace @mvs/web
```

Commit message: `feat: add target-locked asset edit chat`

---

## Task 4: Multi-character project approval and final active-session migration

**Files**
- Create `apps/web/src/components/DirectorCharacterControls.tsx`
- Create `apps/web/scripts/director-multichar.patch.mjs`
- Create `apps/web/src/components/LtxDirectorAgent.multichar.test.ts`
- Modify `apps/web/scripts/build.mjs`
- Modify `apps/web/src/components/LtxDirectorAgent.vision-first.test.ts`

- [ ] **4.1 Add RED full-chain active-Director test**

Apply patches in production order:

```ts
let patched = patchOptionalCharacterConditioning(source, replaceRequired);
patched = patchDirectorChat(patched, replaceRequired);
patched = patchDirectorLeftRailLauncher(patched, replaceRequired);
patched = patchDirectorMultiCharacter(patched, replaceRequired);
```

Assert final source contains:

```ts
/const SESSION_VERSION = 4/
/approvedCharacterIds/
/characterSelections/
/pendingAssetEdits/
/migrateDirectorCharacterState/
```

and does not use `session.characterApproved` as a production gate. Also keep Vision-first assertions (`buildVisionTimelineClips`, `Vision override detected`).

- [ ] **4.2 Implement character UI components**

`DirectorCharacterControls.tsx` exports:

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

Approval and selection are free state changes only.

- [ ] **4.3 Implement final-stage session patch**

`patchDirectorMultiCharacter` runs after chat + left-rail patches and:
- bumps session v3 -> v4;
- adds `approvedCharacterIds`, `characterSelections`, and `pendingAssetEdits`;
- keeps `characterApproved?: boolean` only for legacy migration reads;
- uses composite pending-edit keys so scene/shot/clip edits for one clip cannot collide:

```ts
const assetEditKey = (
  type: "scene_image" | "shot_image" | "clip",
  clipId: string,
) => `${type}:${clipId}`;
```

Pending edit shape:

```ts
type PendingAssetEdit = {
  targetType: "scene_image" | "shot_image" | "clip";
  clipId: string;
  prompt?: string;
  regenerate?: boolean;
};
```

Session restore sequence:
1. restore raw v4/legacy fields without generation side effects;
2. after `characterReferences`/`characterImageUrl` are available, run a migration/sanitization effect using valid IDs plus `store-character` when available;
3. persist only sanitized approvals/selections;
4. never rewrite timeline clips or approvals during migration.

On unapprove, sanitize every clip selection immediately.

On new plan creation, preserve project `approvedCharacterIds`, preserve selections only for clip IDs that still exist, remove stale pending edits, and do not reset character approval.

Production character gate becomes: character-required project must have at least one approved character; no `session.characterApproved` check.

Add `DirectorCharacterApproval` near the current character/reference status strip.

- [ ] **4.4 Wire patch into build**

In `build.mjs`:

```ts
patchedAgent = patchDirectorChat(patchedAgent, replaceRequired);
patchedAgent = patchDirectorLeftRailLauncher(patchedAgent, replaceRequired);
patchedAgent = patchDirectorMultiCharacter(patchedAgent, replaceRequired);
```

Add a build log indicating multi-character Director state was enabled.

- [ ] **4.5 Update Vision regression to final session v4**

Do not leave a test that treats intermediate v3 as the shipped state. Apply the final patch in the relevant source regression while keeping all existing Vision/clip-count checks.

- [ ] **4.6 Verify and commit**

```bash
node apps/web/scripts/clip-count-prebuild.mjs
npx tsx --test \
  apps/web/src/lib/directorCharacterState.test.ts \
  apps/web/src/components/LtxDirectorAgent.multichar.test.ts \
  apps/web/src/components/LtxDirectorAgent.vision-first.test.ts
npm run build --workspace @mvs/web
```

Commit message: `feat: add Director multi-character approval state`

---

## Task 5: Multi-reference approval images and approved-shot Agnes seed

**Files**
- Create `apps/web/src/lib/directorCharacterMedia.ts`
- Create `apps/web/src/lib/directorCharacterMedia.test.ts`
- Modify `apps/web/scripts/director-multichar.patch.mjs`
- Modify `apps/web/src/components/LtxDirectorAgent.multichar.test.ts`

- [ ] **5.1 Add RED media tests**

Cover:

```ts
assert.deepEqual(
  resolveCharacterReferenceUrls(
    ["char-a", "char-b"],
    [{ id: "char-a", anchorUrl: "/a.png" }, { id: "char-b", anchorUrl: "/b.png" }],
    null,
  ),
  ["/a.png", "/b.png"],
);

assert.deepEqual(
  buildApprovalReferenceImages("/current.png", ["/a.png", "/b.png"]),
  [{ uri: "/current.png" }, { uri: "/a.png" }, { uri: "/b.png" }],
);

assert.equal(chooseApprovedShotSeed({ url: "/shot.png", approved: true }), "/shot.png");
assert.equal(chooseApprovedShotSeed({ url: "/shot.png", approved: false }), undefined);
```

- [ ] **5.2 Implement media helpers**

```ts
export function resolveCharacterReferenceUrls(
  selectionIds: string[],
  references: Array<{ id: string; url?: string; anchorUrl?: string }>,
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

Deduplicate URLs and resolve special `store-character` from `storeCharacterUrl`.

- [ ] **5.3 Patch approval-image generation to accept many references**

Final active function becomes equivalent to:

```ts
async function generateApprovalImage(prompt: string, referenceUrls: string[] = []) {
  const referenceImages = [...new Set(referenceUrls.filter(Boolean))].map((uri) => ({ uri }));
  const { id } = await startTextToImage({
    prompt: prompt.trim(),
    promptText: prompt.trim(),
    model: "openrouter_image_flash",
    ratio: "1920:1080",
    ...(referenceImages.length ? { referenceImages } : {}),
  });
  // existing poll/save logic
}
```

For an explicit scene/shot edit, reference order is:
1. current image, if editing one;
2. all selected approved character images.

Regenerating one image resets only that image's approval.

- [ ] **5.4 Patch video generation to use approved shot image**

In `generateSectionPreview` and any reachable active production path:

```ts
const approvedShotSeed = chooseApprovedShotSeed(session.shotApprovals[clipId]);
if (shot.requiresCharacter && !approvedShotSeed) {
  setError(`${shot.sectionLabel} needs an approved shot image before video generation.`);
  return;
}
const source = approvedShotSeed ? "imageToVideo" : previousReady ? "continue" : "textToVideo";
```

Use `approvedShotSeed` for both `seedImageUrl` and `archetypeUrl` when present. Never silently fall back to raw `conditioningReferenceId` for a character-required clip.

- [ ] **5.5 Verify and commit**

```bash
npx tsx --test \
  apps/web/src/lib/directorCharacterMedia.test.ts \
  apps/web/src/components/LtxDirectorAgent.multichar.test.ts
npm run build --workspace @mvs/web
```

Commit message: `feat: seed Agnes from approved multi-character shots`

---

## Task 6: Inline chat/pickers under every main image and clip, with explicit credit controls

**Files**
- Modify `apps/web/src/components/DirectorAssetsPanel.tsx`
- Modify `apps/web/src/components/DirectorSectionReview.tsx`
- Modify `apps/web/scripts/director-chat-patch.mjs`
- Modify `apps/web/scripts/director-multichar.patch.mjs`
- Create `apps/web/src/components/DirectorAssetEditing.test.ts`
- Modify `.github/workflows/build-check.yml`

- [ ] **6.1 Add RED regressions for every rendering location**

Test:
- reusable generated scene-image cards contain `AssetEditChat` + `DirectorCharacterPicker`;
- reusable generated shot-image cards contain both;
- production clip cards in `DirectorSectionReview` contain both;
- final patched **main Director scene approval card** contains inline `AssetEditChat` + picker directly beneath its image;
- final patched **main Director shot approval card** contains inline `AssetEditChat` + picker directly beneath its image.

Also source-test no auto-generation from chat:

```ts
assert.doesNotMatch(patched, /if \(action\.regenerate\)[\s\S]{0,500}generateSectionPreview\(action\.clipId\)/);
assert.doesNotMatch(patched, /action\.type === "edit_scene_image"[\s\S]{0,500}await generateSceneVisual/);
assert.doesNotMatch(patched, /action\.type === "edit_shot_image"[\s\S]{0,500}await generateShotVisual/);
```

Observe RED.

- [ ] **6.2 Change chat action application to prepare edits only**

For `update_clip`:
- apply prompt/continuity/transition/label state changes;
- never modify `start`/`end`;
- when `regenerate:true`, store pending edit at `assetEditKey("clip", clipId)`;
- do not call `generateSectionPreview`.

For image actions:
- store prompt at `assetEditKey("scene_image", clipId)` or `assetEditKey("shot_image", clipId)`;
- do not call image generation.

- [ ] **6.3 Add explicit prepared-edit handlers**

Add final active-Agent callbacks:

```ts
const generatePreparedImage = async (
  type: "scene_image" | "shot_image",
  clipId: string,
) => { /* read pending prompt, generate explicitly, clear only matching composite key */ };

const clearPreparedClipRegeneration = (clipId: string) => { /* clear clip composite key after explicit enqueue */ };
```

Only explicit UI buttons call these/provider generation.

- [ ] **6.4 Add per-asset picker + chat to `DirectorAssetsPanel`**

Expand props with plan, references, approvals/selections, pending edits, chat callback, and explicit image-generation callback.

Each generated image card displays:
1. image;
2. character picker;
3. inline asset chat locked to `scene_image` or `shot_image`;
4. `Generate edited image` only when that exact composite pending key exists;
5. existing Save as asset.

- [ ] **6.5 Add per-clip picker + chat to `DirectorSectionReview`**

Each clip card displays:
1. preview/placeholder;
2. character picker;
3. inline `AssetEditChat target={{ type: "clip", clipId }}`;
4. visible prepared-regeneration state if requested;
5. existing explicit Generate/Regenerate button as the only path to `onGenerate`.

Remove the old `Chat changes` scroll-to-global-chat button.

- [ ] **6.6 Patch main scene/shot approval cards too**

The active `LtxDirectorAgent` already renders main scene and shot approval images. `director-multichar.patch.mjs` must inject directly beneath each of those images:
- `DirectorCharacterPicker` using `characterSelections[clipId]`;
- target-locked `AssetEditChat`;
- explicit `Generate edited image` button if a pending image edit exists.

This guarantees chat is under the images the user is actually reviewing, not only in the reusable Assets panel.

- [ ] **6.7 Keep global chat**

Do not remove `DirectorEditChat`; it remains for broad edits across multiple assets.

- [ ] **6.8 Update CI**

Add `feature/director-asset-chat-multichar` to push branches and include:

```text
apps/web/src/lib/directorCharacterState.test.ts
apps/web/src/lib/directorCharacterMedia.test.ts
apps/web/src/lib/directorChatClient.test.ts
apps/web/src/components/LtxDirectorAgent.multichar.test.ts
apps/web/src/components/DirectorAssetEditing.test.ts
```

alongside every existing Director regression.

- [ ] **6.9 Run full regressions/build and commit**

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

Commit message: `feat: add inline Director asset editing and character selection`

---

## Task 7: Fresh verification, PR, true merge, and Render activation

- [ ] **7.1 Run fresh final verification on final head**

Re-run the exact full regression command and `npm run build` after the last implementation commit. Use this fresh run as completion evidence.

- [ ] **7.2 Review scope against production base**

Compare feature head against `f517576c54dceac641d0b9a46a49c656e7d2d626`.

Expected scope only:
- approved design/plan docs;
- Director chat API/local fallback;
- new state/media/chat helpers/tests;
- Director asset/section/chat/character UI;
- Director build patches/build script;
- CI workflow.

Confirm no Render config, credentials, Agnes provider limits, or chat timing mutation changed.

- [ ] **7.3 Open PR to production branch**

Base `backup-pre-rollback-1890d80`, head `feature/director-asset-chat-multichar`.

Title: `Add inline Director editing and multi-character approval`

PR body includes feature summary, credit-safety behavior, multi-character approved-shot seed strategy, target-local Gemini/local fallback, and exact green regression/build evidence.

- [ ] **7.4 Require mergeable + green PR build**

Do not merge on conflict or failing CI.

- [ ] **7.5 Merge with true merge commit**

Use merge method `merge` and expected final feature-head SHA. Use the actual PR number returned by GitHub in the merge title.

- [ ] **7.6 Verify Render exact commit reaches live**

Workspace `tea-d99sd558nd3s73a2744g`, service `srv-d9gukmb7uimc73946n6g`.

Confirm:
- branch remains `backup-pre-rollback-1890d80`;
- deploy commit exactly equals actual merge commit;
- status reaches `live`;
- web build logs show Vision, chat, left-rail, and multi-character patches applied.

Do not claim `/health` 200 unless directly observed.

- [ ] **7.7 User smoke test without automatic provider spending**

Ask user to refresh and verify before generating:
1. two character references can both be approved;
2. both can be selected on one shot;
3. inline chat is visible under the main scene image, main shot image, reusable image cards, and clip card;
4. chat edit creates a prepared edit/regeneration state without starting provider work;
5. explicit Generate/Edit/Regenerate remains required.

Do not trigger real image or Agnes generations automatically.

---

## Plan Self-Review

- Every approved spec success criterion maps to a task and regression.
- Final active Director remains build-patched; new behavior is isolated in one final multi-character patch.
- Pending edit keys are composite (`targetType:clipId`), so scene/shot/clip edits cannot overwrite one another.
- Inline chat is required under both the main approval images and secondary reusable asset cards, plus production clip cards.
- Existing auto-generation behavior from chat is explicitly removed and source-tested.
- Multi-character identity is composed at image stage; Agnes remains single-seed.
- Legacy sessions migrate without timeline/media regeneration.
- No plan step permits chat to alter timing or clip count.
- No `TODO`, `TBD`, unresolved placeholder, or unspecified provider migration remains.
- Completion requires fresh regression/build evidence plus exact Render merge-commit activation.