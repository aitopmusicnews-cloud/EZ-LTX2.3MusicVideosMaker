# Director Vision-First Clip Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the user's Vision the authoritative production plan, preserve its explicit shot count and timecodes, expose provider-required technical splits separately, and require an explicit user command for every video generation/regeneration action.

**Architecture:** Add a pure Vision parser and a pure Director plan layer between Auto Director and the existing timeline/scheduler. The Director plan owns creative sections/shots; the timeline continues to own provider-sized `Clip` render units, linked back to creative shots with metadata. Auto Director becomes a controller/UI over that plan and calls generation only from explicit button handlers.

**Tech Stack:** React 19, TypeScript 5.6, Zustand 5, Zod 3, Node `node:test` via `tsx`, existing Agnes `agnes-video-v2.0` scheduler.

**Spec:** `docs/superpowers/specs/2026-09-02-director-vision-first-clips-design.md`

## Global Constraints

- Production baseline is `729846730431eb541a475aebd0ed417c21403a23`; implement on `feature/director-vision-first-clips` without retargeting Render during development.
- Creative precedence is: explicit user Vision > explicit user Director edits > Director suggestions > audio-analysis defaults.
- Structured Vision shot count is authoritative. Eight supplied shots remain eight creative shots.
- Creative shots and provider generation segments are distinct concepts.
- `agnes-video-v2.0` render requests remain provider-sized; the current scheduler clamps a request to 1–5 seconds.
- A shot longer than 5 seconds may require technical segments, but those segments must be shown separately and explicitly approved before generation.
- Completed ready media stays locked until the user explicitly chooses Regenerate/Delete/Replace.
- Opening Director, restoring state, changing stages, rendering the final timeline, completing another clip, or revisiting Production must never enqueue generation.
- Final render is assembly-only.
- Lip sync remains optional and explicit.
- Do not change Agnes API contracts, Render configuration, or unrelated UI/provider code.

---

## File Structure

### New files

- `apps/web/src/lib/directorVisionParser.ts` — classify Vision input and parse structured timecoded shots conservatively.
- `apps/web/src/lib/directorVisionParser.test.ts` — parser regression tests using `node:test`.
- `apps/web/src/lib/directorPlan.ts` — Director section/shot/segment types, section grouping, provider segmentation, timeline materialization helpers.
- `apps/web/src/lib/directorPlan.test.ts` — shot-count, grouping, technical-split, and timeline-materialization tests.
- `apps/web/src/lib/directorGeneration.ts` — pure selection of exactly which timeline clips a Generate Shot/Section/All action may enqueue.
- `apps/web/src/lib/directorGeneration.test.ts` — scope-selection and ready-lock regression tests.
- `apps/web/src/components/DirectorProductionSections.tsx` — focused Production-stage UI for section cards, shot controls, technical split approval, and queue counts.
- `apps/web/src/components/AutoDirector.vision-first.test.ts` — source-level safety regressions proving effects/render functions do not enqueue video generation.

### Existing files to modify

- `packages/shared/src/index.ts` — add optional Director mapping metadata to `ClipSchema`.
- `apps/web/src/lib/store.ts` — add an explicit, non-generating action to apply/reconcile Director timeline clips.
- `apps/web/src/components/AutoDirector.tsx` — bump Director session version, use parser/plan model, preserve explicit Vision fields, remove bulk auto-production behavior, wire explicit generation handlers, and render section UI.
- `.github/workflows/build-check.yml` — run the new Director regression tests before workspace build.

---

### Task 1: Parse structured Vision without overriding user content

**Files:**
- Create: `apps/web/src/lib/directorVisionParser.ts`
- Create: `apps/web/src/lib/directorVisionParser.test.ts`

**Interfaces:**
- Produces:
  - `parseTimecode(value: string): number | null`
  - `parseDirectorVision(value: string): ParsedDirectorVision`
  - `ParsedDirectorVision = { mode: "general"; rawText: string } | { mode: "structured"; rawText: string; shots: ParsedVisionShot[] }`
  - `ParsedVisionShot` fields: `label`, `start`, `end`, `rawText`, `visualDirection`, `cameraDirection`, `audioCue`, `onScreenText`

- [ ] **Step 1: Write the failing parser tests**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { parseDirectorVision, parseTimecode } from "./directorVisionParser.js";

const SAMPLE = `
0:00 – 0:06 Shot 1: Extreme Close-Up (ECU)
Slow push-in on a stove clock glowing 2:15 in the dark.
0:06 – 0:14 Shot 2: Low-Angle Tracking
Gliding camera tracking behind her pointed stiletto boots.
0:14 – 0:22 Shot 3: Medium Waist-Up
She leans against the marble island.
`;

test("parseTimecode converts mm:ss to seconds", () => {
  assert.equal(parseTimecode("1:00"), 60);
  assert.equal(parseTimecode("0:14"), 14);
  assert.equal(parseTimecode("bad"), null);
});

test("structured timecoded Vision preserves explicit shot count and timing", () => {
  const parsed = parseDirectorVision(SAMPLE);
  assert.equal(parsed.mode, "structured");
  if (parsed.mode !== "structured") return;
  assert.equal(parsed.shots.length, 3);
  assert.deepEqual(parsed.shots.map((shot) => [shot.start, shot.end]), [
    [0, 6],
    [6, 14],
    [14, 22],
  ]);
  assert.equal(parsed.shots[0]!.label, "Shot 1: Extreme Close-Up (ECU)");
  assert.match(parsed.shots[0]!.rawText, /stove clock glowing 2:15/i);
});

test("general prose stays general", () => {
  assert.deepEqual(parseDirectorVision("Luxury rooftop performance at night"), {
    mode: "general",
    rawText: "Luxury rooftop performance at night",
  });
});
```

- [ ] **Step 2: Run the parser test and verify RED**

Run:

```bash
npx tsx --test apps/web/src/lib/directorVisionParser.test.ts
```

Expected: FAIL because `directorVisionParser.ts` does not exist.

- [ ] **Step 3: Implement conservative parsing**

Create `directorVisionParser.ts` with these rules:

```ts
export type ParsedVisionShot = {
  label: string;
  start: number;
  end: number;
  rawText: string;
  visualDirection: string;
  cameraDirection: string;
  audioCue: string;
  onScreenText: string;
};

export type ParsedDirectorVision =
  | { mode: "general"; rawText: string }
  | { mode: "structured"; rawText: string; shots: ParsedVisionShot[] };

const RANGE = /(\d{1,2}:\d{2})\s*[–—-]\s*(\d{1,2}:\d{2})/g;
const SHOT_LABEL = /^\s*(Shot\s+\d+\s*:\s*[^\n\r]+)/i;

export function parseTimecode(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (!Number.isFinite(minutes) || seconds < 0 || seconds >= 60) return null;
  return minutes * 60 + seconds;
}

export function parseDirectorVision(value: string): ParsedDirectorVision {
  const rawText = value.trim();
  const matches = [...rawText.matchAll(RANGE)];
  const hasShotLabel = /\bShot\s+\d+\s*:/i.test(rawText);
  const structured = matches.length >= 2 || (matches.length === 1 && hasShotLabel);
  if (!structured) return { mode: "general", rawText };

  const shots: ParsedVisionShot[] = matches.flatMap((match, index) => {
    const start = parseTimecode(match[1]!);
    const end = parseTimecode(match[2]!);
    if (start === null || end === null || end <= start) return [];
    const chunkStart = (match.index ?? 0) + match[0].length;
    const chunkEnd = matches[index + 1]?.index ?? rawText.length;
    const rawChunk = rawText.slice(chunkStart, chunkEnd).trim();
    const labelMatch = SHOT_LABEL.exec(rawChunk);
    const label = labelMatch?.[1]?.trim() || `Shot ${index + 1}`;
    const body = labelMatch ? rawChunk.slice(labelMatch[0].length).trim() : rawChunk;

    return [{
      label,
      start,
      end,
      rawText: rawChunk,
      visualDirection: body,
      cameraDirection: "",
      audioCue: "",
      onScreenText: "",
    }];
  });

  return shots.length ? { mode: "structured", rawText, shots } : { mode: "general", rawText };
}
```

Do not invent camera/audio/text fields when the paste format does not expose reliable column boundaries. Preserve all unclassified content in `rawText`/`visualDirection` so nothing is lost.

- [ ] **Step 4: Run parser tests and verify GREEN**

```bash
npx tsx --test apps/web/src/lib/directorVisionParser.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/directorVisionParser.ts apps/web/src/lib/directorVisionParser.test.ts
git commit -m "feat: parse structured Director vision"
```

---

### Task 2: Model creative shots separately from provider generation segments

**Files:**
- Create: `apps/web/src/lib/directorPlan.ts`
- Create: `apps/web/src/lib/directorPlan.test.ts`

**Interfaces:**
- Consumes: `ParsedVisionShot` from Task 1 and `AudioAnalysis`, `Clip` from `@mvs/shared`.
- Produces:
  - `DirectorPlan`, `DirectorSection`, `DirectorShot`, `DirectorGenerationSegment`
  - `buildStructuredDirectorPlan(shots, analysis): DirectorPlan`
  - `splitDirectorShot(shot, maxDuration = 5): DirectorGenerationSegment[]`
  - `materializeDirectorClips(plan): Clip[]`

- [ ] **Step 1: Write failing plan tests**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { buildStructuredDirectorPlan, splitDirectorShot, materializeDirectorClips } from "./directorPlan.js";

const parsedShots = [
  { label: "Shot 1", start: 0, end: 6, rawText: "Clock", visualDirection: "Clock", cameraDirection: "", audioCue: "", onScreenText: "" },
  { label: "Shot 2", start: 6, end: 14, rawText: "Tracking", visualDirection: "Tracking", cameraDirection: "", audioCue: "", onScreenText: "" },
];

const analysis = {
  duration: 14,
  sections: [
    { label: "Intro", start: 0, end: 6 },
    { label: "Verse 1", start: 6, end: 14 },
  ],
};

test("structured plan keeps the exact creative shot count", () => {
  const plan = buildStructuredDirectorPlan(parsedShots, analysis);
  assert.equal(plan.sections.flatMap((section) => section.shots).length, 2);
  assert.equal(plan.sections[0]!.shots[0]!.source, "user-vision");
});

test("a 12 second creative shot remains one shot but has three technical segments", () => {
  const shot = {
    id: "shot-long",
    label: "Hero",
    start: 0,
    end: 12,
    visualDirection: "Hero performance",
    cameraDirection: "Slow push",
    audioCue: "chorus",
    onScreenText: "OFF-HOURS",
    rawText: "Hero performance",
    prompt: "Hero performance",
    approved: true,
    source: "user-vision" as const,
    technicalSplitApproved: false,
  };
  const segments = splitDirectorShot(shot);
  assert.equal(segments.length, 3);
  assert.deepEqual(segments.map((segment) => [segment.start, segment.end]), [[0, 4], [4, 8], [8, 12]]);
});

test("materialized clips retain creative-shot identity", () => {
  const plan = buildStructuredDirectorPlan(parsedShots, analysis);
  const clips = materializeDirectorClips(plan);
  assert.ok(clips.length >= 2);
  assert.equal(clips[0]!.directorShotId, plan.sections[0]!.shots[0]!.id);
  assert.equal(clips[0]!.directorSegmentIndex, 0);
});
```

- [ ] **Step 2: Run the plan test and verify RED**

```bash
npx tsx --test apps/web/src/lib/directorPlan.test.ts
```

Expected: FAIL because the module does not exist and shared `Clip` has no Director metadata yet.

- [ ] **Step 3: Implement the plan types and deterministic segmentation**

Use these exact public types in `directorPlan.ts`:

```ts
export type DirectorShotSource = "user-vision" | "director-suggestion" | "manual";

export type DirectorShot = {
  id: string;
  label: string;
  start: number;
  end: number;
  visualDirection: string;
  cameraDirection: string;
  audioCue: string;
  onScreenText: string;
  rawText: string;
  prompt: string;
  approved: boolean;
  source: DirectorShotSource;
  technicalSplitApproved: boolean;
};

export type DirectorSection = {
  id: string;
  label: string;
  start: number;
  end: number;
  shots: DirectorShot[];
};

export type DirectorPlan = {
  mode: "structured" | "assisted";
  sections: DirectorSection[];
};

export type DirectorGenerationSegment = {
  clipId: string;
  shotId: string;
  start: number;
  end: number;
  index: number;
  count: number;
};
```

Segmentation rule:

```ts
export function splitDirectorShot(shot: DirectorShot, maxDuration = 5): DirectorGenerationSegment[] {
  const duration = shot.end - shot.start;
  const count = Math.max(1, Math.ceil(duration / maxDuration));
  const segmentDuration = duration / count;
  return Array.from({ length: count }, (_, index) => ({
    clipId: `${shot.id}-segment-${index + 1}`,
    shotId: shot.id,
    start: shot.start + segmentDuration * index,
    end: index === count - 1 ? shot.end : shot.start + segmentDuration * (index + 1),
    index,
    count,
  }));
}
```

`buildStructuredDirectorPlan` assigns each shot to the audio section containing the shot midpoint; if no section matches, place it in a visible `Custom` section. Do not change shot start/end times.

`materializeDirectorClips` creates one `Clip` per generation segment. The first segment of each creative shot uses `imageToVideo`; later segments use `continue`. Each clip carries `directorShotId`, `directorSectionId`, `directorSegmentIndex`, and `directorSegmentCount`.

- [ ] **Step 4: Extend shared Clip metadata**

Modify `packages/shared/src/index.ts` inside `ClipSchema`:

```ts
  directorShotId: z.string().optional(),
  directorSectionId: z.string().optional(),
  directorSegmentIndex: z.number().int().min(0).optional(),
  directorSegmentCount: z.number().int().positive().optional(),
```

- [ ] **Step 5: Run plan tests and shared typecheck**

```bash
npx tsx --test apps/web/src/lib/directorPlan.test.ts
npm run typecheck --workspace @mvs/shared
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/directorPlan.ts apps/web/src/lib/directorPlan.test.ts packages/shared/src/index.ts
git commit -m "feat: separate Director shots from generation segments"
```

---

### Task 3: Select generation scope explicitly and protect ready clips

**Files:**
- Create: `apps/web/src/lib/directorGeneration.ts`
- Create: `apps/web/src/lib/directorGeneration.test.ts`

**Interfaces:**
- Consumes: `DirectorPlan`, `Clip[]`.
- Produces:
  - `DirectorGenerationScope = { type: "shot"; shotId: string } | { type: "section"; sectionId: string } | { type: "all" }`
  - `selectDirectorGenerationClips(plan, clips, scope, regenerate = false): Clip[]`
  - `countDirectorGenerationRequests(plan, clips, scope, regenerate = false): number`

- [ ] **Step 1: Write failing explicit-scope tests**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import type { Clip } from "@mvs/shared";
import type { DirectorPlan } from "./directorPlan.js";
import { selectDirectorGenerationClips } from "./directorGeneration.js";

const plan: DirectorPlan = {
  mode: "structured",
  sections: [{
    id: "section-chorus",
    label: "Chorus",
    start: 0,
    end: 10,
    shots: [
      { id: "shot-a", label: "A", start: 0, end: 5, visualDirection: "A", cameraDirection: "", audioCue: "", onScreenText: "", rawText: "A", prompt: "A", approved: true, source: "user-vision", technicalSplitApproved: true },
      { id: "shot-b", label: "B", start: 5, end: 10, visualDirection: "B", cameraDirection: "", audioCue: "", onScreenText: "", rawText: "B", prompt: "B", approved: true, source: "user-vision", technicalSplitApproved: true },
    ],
  }],
};

const clips: Clip[] = [
  { id: "shot-a-segment-1", start: 0, end: 5, source: "imageToVideo", status: "ready", videoUrl: "https://example.com/a.mp4", directorShotId: "shot-a", directorSectionId: "section-chorus", directorSegmentIndex: 0, directorSegmentCount: 1 },
  { id: "shot-b-segment-1", start: 5, end: 10, source: "imageToVideo", status: "empty", directorShotId: "shot-b", directorSectionId: "section-chorus", directorSegmentIndex: 0, directorSegmentCount: 1 },
];

test("Generate Section skips already-ready media", () => {
  const selected = selectDirectorGenerationClips(plan, clips, { type: "section", sectionId: "section-chorus" });
  assert.deepEqual(selected.map((clip) => clip.id), ["shot-b-segment-1"]);
});

test("Regenerate Shot selects ready media only when explicitly requested", () => {
  const normal = selectDirectorGenerationClips(plan, clips, { type: "shot", shotId: "shot-a" });
  const regenerate = selectDirectorGenerationClips(plan, clips, { type: "shot", shotId: "shot-a" }, true);
  assert.equal(normal.length, 0);
  assert.deepEqual(regenerate.map((clip) => clip.id), ["shot-a-segment-1"]);
});
```

- [ ] **Step 2: Run test and verify RED**

```bash
npx tsx --test apps/web/src/lib/directorGeneration.test.ts
```

Expected: FAIL because `directorGeneration.ts` does not exist.

- [ ] **Step 3: Implement explicit scope selection**

Implement selection with these invariants:

```ts
const eligibleStatus = (clip: Clip, regenerate: boolean) =>
  regenerate ? clip.status !== "queued" && clip.status !== "generating" : clip.status !== "ready" && clip.status !== "queued" && clip.status !== "generating";
```

A shot is selectable only when `shot.approved === true`. If `splitDirectorShot(shot).length > 1`, require `shot.technicalSplitApproved === true`. Section scope selects only shots in that section; all scope selects only approved shots across all sections.

Do not mutate clips in this module.

- [ ] **Step 4: Run tests and verify GREEN**

```bash
npx tsx --test apps/web/src/lib/directorGeneration.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/directorGeneration.ts apps/web/src/lib/directorGeneration.test.ts
git commit -m "feat: add explicit Director generation scopes"
```

---

### Task 4: Apply a Director plan to the timeline without starting generation

**Files:**
- Modify: `apps/web/src/lib/store.ts`
- Test: `apps/web/src/lib/directorPlan.test.ts`

**Interfaces:**
- Consumes: `Clip[]` produced by `materializeDirectorClips`.
- Produces Zustand action:
  - `applyDirectorTimeline(clips: Clip[]): void`

- [ ] **Step 1: Add a failing reconciliation test to `directorPlan.test.ts`**

Add a pure helper `reconcileDirectorClips(next, existing)` to `directorPlan.ts` and test it before wiring the store:

```ts
test("reconcile keeps a ready matching segment locked", () => {
  const existing = [{
    id: "shot-1-segment-1",
    start: 0,
    end: 5,
    source: "imageToVideo",
    status: "ready",
    videoUrl: "https://example.com/ready.mp4",
    directorShotId: "shot-1",
    directorSegmentIndex: 0,
    directorSegmentCount: 1,
  }] as any;
  const next = [{
    ...existing[0],
    status: "empty",
    videoUrl: undefined,
  }] as any;

  const reconciled = reconcileDirectorClips(next, existing);
  assert.equal(reconciled[0]!.status, "ready");
  assert.equal(reconciled[0]!.videoUrl, "https://example.com/ready.mp4");
});
```

- [ ] **Step 2: Run the focused test and verify RED**

```bash
npx tsx --test apps/web/src/lib/directorPlan.test.ts
```

Expected: FAIL because `reconcileDirectorClips` is missing.

- [ ] **Step 3: Implement reconciliation**

A ready existing clip may be preserved only when all of these match the proposed clip:

```ts
existing.id === next.id &&
existing.directorShotId === next.directorShotId &&
existing.start === next.start &&
existing.end === next.end &&
existing.status === "ready" &&
Boolean(existing.videoUrl)
```

Otherwise the proposed clip remains empty. Never enqueue inside reconciliation.

- [ ] **Step 4: Add the store action**

Extend the Zustand `State` type:

```ts
applyDirectorTimeline: (clips: Clip[]) => void;
```

Implement:

```ts
applyDirectorTimeline: (clips) => set((state) => ({
  clips: reconcileDirectorClips(clips, state.clips),
  selectedClipId: null,
  jobs: state.jobs.filter((job) => job.state === "running"),
})),
```

Import `reconcileDirectorClips` from `./directorPlan.js`.

This action prepares timeline slots only. It must not call `enqueueGeneration`, `pump`, API functions, or modify a ready matching video.

- [ ] **Step 5: Run focused tests and web typecheck**

```bash
npx tsx --test apps/web/src/lib/directorPlan.test.ts
npm run typecheck --workspace @mvs/web
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/directorPlan.ts apps/web/src/lib/directorPlan.test.ts apps/web/src/lib/store.ts
git commit -m "feat: apply Director plan without auto generation"
```

---

### Task 5: Make Auto Director Vision-first and remove bulk auto-production

**Files:**
- Modify: `apps/web/src/components/AutoDirector.tsx`
- Create: `apps/web/src/components/DirectorProductionSections.tsx`

**Interfaces:**
- Consumes:
  - `parseDirectorVision`
  - `buildStructuredDirectorPlan`
  - existing assisted-plan data from `buildCreativePlan`
  - `materializeDirectorClips`
  - `selectDirectorGenerationClips`
  - `useStore.getState().applyDirectorTimeline`
  - existing `enqueueGeneration`
- Produces explicit UI handlers:
  - `generateShot(shotId, regenerate?)`
  - `generateSection(sectionId)`
  - `generateAllApproved()`
  - `approveTechnicalSplit(shotId)`

- [ ] **Step 1: Bump session version and store the new plan**

Change:

```ts
const DIRECTOR_VERSION = 3;
```

Replace the old flat `shots: StoryboardShot[]` session field with:

```ts
plan: DirectorPlan | null;
```

Keep treatment/character/lip-sync/render fields that are still used. Version 2 localStorage sessions should rebuild Director planning state without deleting existing timeline media.

- [ ] **Step 2: Route Vision through structured-vs-general classification**

Inside `createTreatmentFromVision`:

```ts
const parsedVision = parseDirectorVision(vision);
const plan = parsedVision.mode === "structured"
  ? buildStructuredDirectorPlan(parsedVision.shots, analysis)
  : buildAssistedDirectorPlan(analysis, clips, vision, session.mustInclude, session.avoid, variation);
```

For structured mode, the user's `label/start/end/rawText/visualDirection/cameraDirection/audioCue/onScreenText` values are copied into the Director plan and remain editable. Director-created prompt enrichment may append production-safe language to `prompt`, but must not replace those fields.

- [ ] **Step 3: Convert the existing storyboard flow to plan shots**

`generateStoryboard(onlyShotId?)` must iterate:

```ts
session.plan?.sections.flatMap((section) => section.shots) ?? []
```

Generate one storyboard image per creative shot, not per provider segment. Store the image URL on the creative shot model (add `imageUrl?: string` to `DirectorShot` in `directorPlan.ts`). Regenerating a storyboard image must not touch any ready `Clip.videoUrl`.

- [ ] **Step 4: Replace `approveStoryboard` timeline mutation**

Delete the current loop that walks `shot.clipIds` and resets every mapped timeline clip to `status: "empty"`.

Replace it with:

```ts
const timelineClips = materializeDirectorClips(session.plan);
useStore.getState().applyDirectorTimeline(timelineClips);
updateSession({ stage: "production" });
```

If a creative shot is longer than 5 seconds and `technicalSplitApproved` is false, Production must show the required segment count but must not generate those segments yet.

- [ ] **Step 5: Delete the old bulk `startProduction` behavior**

Remove the function whose core behavior is:

```ts
for (const clip of currentClips) {
  enqueueGeneration(...);
}
```

Remove `productionStarted` as an automatic-flow flag. Production readiness is derived from the plan and clip statuses instead.

- [ ] **Step 6: Add one explicit enqueue helper inside Auto Director**

```ts
const enqueueDirectorClips = (selected: Clip[]) => {
  for (const clip of selected) {
    enqueueGeneration({
      clipId: clip.id,
      source: clip.source === "continue" ? "continue" : "imageToVideo",
      seedImageUrl: clip.archetypeUrl ?? clip.seedImageUrl ?? session.characterUrl ?? lookbook[0] ?? "",
      prompt: clip.prompt || `Cinematic artist performance based on this approved vision: ${session.vision}`,
      duration: clip.end - clip.start,
      sectionLabel: clip.sectionLabel || "song section",
      energy: 0.6,
      model: "agnes-video-v2.0",
    });
  }
};
```

Call this helper only from button handlers:

```ts
const generateShot = (shotId: string, regenerate = false) => {
  if (!session.plan) return;
  enqueueDirectorClips(selectDirectorGenerationClips(session.plan, useStore.getState().clips, { type: "shot", shotId }, regenerate));
};

const generateSection = (sectionId: string) => {
  if (!session.plan) return;
  enqueueDirectorClips(selectDirectorGenerationClips(session.plan, useStore.getState().clips, { type: "section", sectionId }));
};

const generateAllApproved = () => {
  if (!session.plan) return;
  enqueueDirectorClips(selectDirectorGenerationClips(session.plan, useStore.getState().clips, { type: "all" }));
};
```

- [ ] **Step 7: Build `DirectorProductionSections.tsx`**

Props:

```ts
type DirectorProductionSectionsProps = {
  plan: DirectorPlan;
  clips: Clip[];
  onApproveShot: (shotId: string, approved: boolean) => void;
  onApproveTechnicalSplit: (shotId: string) => void;
  onGenerateShot: (shotId: string) => void;
  onRegenerateShot: (shotId: string) => void;
  onGenerateSection: (sectionId: string) => void;
  onGenerateAll: () => void;
};
```

For every section show:

- section label and time range;
- each creative shot label/timecode;
- editable visual/camera/audio/on-screen-text fields (editing is wired through a callback from AutoDirector; add `onUpdateShot(shotId, patch)` to props if needed);
- `technical segment count` from `splitDirectorShot(shot).length`;
- a warning + **Approve technical split** for counts > 1;
- **Generate Shot** for non-ready approved shots;
- **Regenerate Shot** only when all mapped segments are ready;
- **Generate Section**;
- global **Generate All Approved** with exact request count from `countDirectorGenerationRequests`.

Do not render an “Approve and start production” button.

- [ ] **Step 8: Run Director unit tests, web typecheck, and build**

```bash
npx tsx --test apps/web/src/lib/directorVisionParser.test.ts apps/web/src/lib/directorPlan.test.ts apps/web/src/lib/directorGeneration.test.ts
npm run typecheck --workspace @mvs/web
npm run build
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/components/AutoDirector.tsx apps/web/src/components/DirectorProductionSections.tsx apps/web/src/lib/directorPlan.ts
git commit -m "feat: make Director production user controlled"
```

---

### Task 6: Prove render, effects, and state restoration cannot regenerate clips

**Files:**
- Create: `apps/web/src/components/AutoDirector.vision-first.test.ts`
- Modify: `apps/web/src/components/AutoDirector.tsx` only if the regression test exposes an enqueue side effect.

**Interfaces:**
- Safety contract only; no new runtime API.

- [ ] **Step 1: Write source-level safety regressions**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./AutoDirector.tsx", import.meta.url), "utf8");

function between(start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `missing ${start}`);
  assert.notEqual(to, -1, `missing ${end}`);
  return source.slice(from, to);
}

test("final render is assembly-only", () => {
  const renderBlock = between("const renderFinal", "const restartDirector");
  assert.doesNotMatch(renderBlock, /enqueueGeneration|enqueueDirectorClips/);
});

test("Director effects never enqueue video generation", () => {
  const effects = [...source.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\n\s*\}, \[/g)].map((match) => match[1]).join("\n");
  assert.doesNotMatch(effects, /enqueueGeneration|enqueueDirectorClips/);
});

test("old automatic bulk production entry point is gone", () => {
  assert.doesNotMatch(source, /Approve and start production/);
  assert.doesNotMatch(source, /const startProduction\s*=\s*\(\)/);
});
```

- [ ] **Step 2: Run safety tests and verify behavior**

```bash
npx tsx --test apps/web/src/components/AutoDirector.vision-first.test.ts
```

Expected: PASS after Task 5. If it fails, remove the identified implicit enqueue path; do not weaken the assertion to permit background generation.

- [ ] **Step 3: Confirm project restore does not enqueue**

Inspect `apps/web/src/lib/store.ts` and keep `restoreSnapshot` limited to state restoration. It may convert stale `queued/generating` clips back to `empty`, but it must not call scheduler/API generation functions.

Run:

```bash
grep -n "enqueueGeneration\|startImageToVideo\|startTextToVideo" apps/web/src/lib/store.ts
```

Expected: no matches.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/AutoDirector.vision-first.test.ts apps/web/src/components/AutoDirector.tsx
git commit -m "test: prevent Director automatic regeneration"
```

---

### Task 7: Add CI coverage and perform full verification

**Files:**
- Modify: `.github/workflows/build-check.yml`

**Interfaces:**
- CI executes the exact Director tests from Tasks 1–6 before build.

- [ ] **Step 1: Add the Director regression test step**

After `npm ci` and before `npm run build`, add:

```yaml
      - name: Director regression tests
        run: >-
          npx tsx --test
          apps/web/src/lib/directorVisionParser.test.ts
          apps/web/src/lib/directorPlan.test.ts
          apps/web/src/lib/directorGeneration.test.ts
          apps/web/src/components/AutoDirector.vision-first.test.ts
```

Keep any existing Agnes regression test step intact.

- [ ] **Step 2: Run the same tests locally**

```bash
npx tsx --test \
  apps/web/src/lib/directorVisionParser.test.ts \
  apps/web/src/lib/directorPlan.test.ts \
  apps/web/src/lib/directorGeneration.test.ts \
  apps/web/src/components/AutoDirector.vision-first.test.ts
```

Expected: all PASS.

- [ ] **Step 3: Run complete typecheck and build**

```bash
npm run typecheck
npm run build
```

Expected: PASS.

- [ ] **Step 4: Run the structured 8-shot acceptance check in the browser**

Using a 60-second Vision containing eight numbered timecoded shots:

1. Paste the Vision.
2. Build treatment/plan.
3. Confirm Director reports **8 creative shots**.
4. Confirm each supplied timecode is unchanged.
5. Confirm shots longer than 5 seconds show a separate provider segment count.
6. Confirm no video generation begins after treatment approval, storyboard approval, stage navigation, closing/reopening Director, or final render.
7. Approve one technical split and click **Generate Shot**; confirm only that shot's eligible segments enter the queue.
8. When a shot becomes ready, close/reopen Director; confirm it stays ready and no new job appears.
9. Click **Generate Section**; confirm only that section's remaining approved non-ready segments queue.
10. Confirm **Generate All Approved** displays the exact number of provider requests before starting.

- [ ] **Step 5: Commit CI**

```bash
git add .github/workflows/build-check.yml
git commit -m "ci: cover Director vision-first workflow"
```

- [ ] **Step 6: Review final diff against the production baseline**

```bash
git diff --stat 729846730431eb541a475aebd0ed417c21403a23...HEAD
git diff 729846730431eb541a475aebd0ed417c21403a23...HEAD -- \
  apps/web/src/components/AutoDirector.tsx \
  apps/web/src/components/DirectorProductionSections.tsx \
  apps/web/src/lib/directorVisionParser.ts \
  apps/web/src/lib/directorPlan.ts \
  apps/web/src/lib/directorGeneration.ts \
  apps/web/src/lib/store.ts \
  packages/shared/src/index.ts \
  .github/workflows/build-check.yml
```

Expected: only Director/shared timeline metadata/test/CI changes described by this plan; no Render settings, Agnes HTTP behavior, or unrelated UI changes.

- [ ] **Step 7: Open a PR targeting the production Render branch**

Target: `backup-pre-rollback-1890d80`.

PR title:

```text
Make Director Vision-first and user-controlled
```

PR body must call out:

- Vision is authoritative;
- structured shot count is preserved;
- provider segments are separately shown/approved;
- no automatic regeneration;
- one-shot/one-section/all-approved controls;
- tests and build results.

Do not merge or deploy until the PR diff and CI are reviewed.

---

## Self-Review

- **Spec coverage:** Vision precedence, structured/general modes, explicit shot count, separate provider segments, section controls, ready-lock behavior, final-render safety, explicit lip sync, compatibility/version bump, and CI are all assigned to tasks.
- **Placeholder scan:** No TBD/TODO/“similar to” instructions remain; public interfaces and test commands are explicit.
- **Type consistency:** `DirectorPlan`, `DirectorSection`, `DirectorShot`, `DirectorGenerationSegment`, `DirectorGenerationScope`, and Director `Clip` metadata use the same names across tasks.
- **Scope:** No Agnes API, Render configuration, unrelated editor, or encoding changes are included.
