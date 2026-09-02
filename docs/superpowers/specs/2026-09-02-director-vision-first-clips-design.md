# Director Vision-First Clip Control Design

Date: 2026-09-02
Status: Proposed / user-approved in chat, pending written-spec review
Production baseline: `729846730431eb541a475aebd0ed417c21403a23`
Feature branch: `feature/director-vision-first-clips`

## Summary

Change Auto Director so the user's Vision is the highest-authority creative input. When the user pastes a structured production plan such as a timecoded script/shot list, the Director must preserve that plan, its shot count, timing, visual direction, camera direction, lyric/audio cues, and on-screen text instead of replacing it with an automatically derived plan.

The Director may still help fill missing details, but it must not overwrite explicit user instructions unless the user asks it to refine or replace them.

Generation also becomes user-controlled. Nothing should automatically regenerate completed clips. The user can generate one shot, one section, or all explicitly approved items.

## Problem

The current flow uses song analysis sections to build Director storyboard shots, while the project store independently subdivides song sections into clips capped at `MAX_CLIP_LEN = 5`. When production starts, Auto Director loops through every project clip and queues each one for generation. This can turn a relatively small creative plan into roughly 30 generated videos.

That behavior creates two problems:

1. The Director's inferred structure can override or dilute a detailed user-supplied vision.
2. The generated clip count is driven by automatic subdivision rather than the user's intended number of shots.

The user also observed apparent regeneration after rendering. Regardless of the exact UI perception, the desired product rule is clear: no generation or regeneration should start without an explicit user action.

## Design Principles

### 1. Creative precedence

The precedence order is:

1. **Explicit user Vision instructions**
2. **Explicit user edits inside Director**
3. **Director suggestions / enhancements**
4. **Automatic audio analysis defaults**

Lower-priority sources may fill blanks but may not replace higher-priority values.

### 2. Structured Vision is a production plan

If the Vision contains recognizable structured shot information, such as:

- timecodes (`0:00 - 0:06`, `0:06 – 0:14`)
- shot labels (`Shot 1`, `Shot 2`, etc.)
- visual direction
- camera direction
- lyric/audio cues
- on-screen text

then Director enters **Structured Vision mode**.

In Structured Vision mode:

- the parsed shot count becomes the default creative shot count;
- parsed timecodes are preserved;
- parsed visual/camera/audio/text fields are preserved;
- Director can fill missing fields but cannot rewrite explicit ones without user approval;
- the UI clearly states that the plan came from the user's Vision.

Example: if the user supplies 8 timecoded shots, Director creates 8 creative shots by default, not 30 automatically generated clips.

### 3. General Vision remains assisted

If the Vision is general prose rather than a structured shot list, Director keeps its existing creative-assistant role:

- analyze song structure;
- suggest sections and shots;
- propose visual direction;
- let the user edit and approve the result before any generation.

The generated plan remains a suggestion until the user approves it.

### 4. Creative shots are not the same as technical generation segments

Introduce a clear distinction:

- **Creative Shot**: what the user/director intends as one shot in the music video.
- **Generation Segment**: a provider-specific render unit used only if the selected model cannot generate the entire requested shot duration in one request.

The creative shot count must remain authoritative.

If a shot's requested duration exceeds a model/provider limit, the UI must not silently subdivide it. Instead it must show a preview such as:

> Shot 4 is 12 seconds. This model requires 3 generation segments. Keep as one creative shot and render 3 connected segments?

The user must explicitly approve that technical split before generation.

## Proposed Data Model

Replace the current flat interpretation of `StoryboardShot` with an explicit section/shot hierarchy.

```ts
type DirectorSection = {
  id: string;
  label: string;
  start: number;
  end: number;
  shots: DirectorShot[];
};

type DirectorShot = {
  id: string;
  label: string;
  start: number;
  end: number;
  visualDirection: string;
  cameraDirection: string;
  audioCue: string;
  onScreenText: string;
  prompt: string;
  approved: boolean;
  source: "user-vision" | "director-suggestion" | "manual";
  generationSegments: GenerationSegment[];
};

type GenerationSegment = {
  id: string;
  start: number;
  end: number;
  status: "empty" | "queued" | "generating" | "ready" | "failed";
  videoUrl?: string;
  lastError?: string;
};
```

The exact TypeScript names can vary during implementation, but the architectural boundary must remain: creative shot identity is separate from provider segmentation.

## Vision Parsing

Add a pure parsing layer that classifies Vision input as either:

- `structured`
- `general`

For structured input, extract when available:

- shot number/label;
- start/end timecode;
- visual description;
- camera direction;
- lyric/audio cue;
- on-screen text.

Parsing should be conservative. If a field cannot be confidently identified, preserve the raw text and leave the field editable rather than inventing content.

### Partial structured plans

A Vision may include timecodes and visuals but omit camera notes or on-screen text. In that case Director may suggest values only for the missing fields. Explicit values remain untouched.

## Section and Shot UI

Production should be organized as section cards such as:

- Intro
- Verse 1
- Chorus
- Verse 2
- Bridge
- Outro

Each section card shows its creative shots.

Each shot exposes:

- timecode;
- visual direction;
- camera direction;
- audio/lyric cue;
- on-screen text;
- duration;
- technical segment count, if needed;
- current generation state;
- preview when ready.

Controls:

- **Generate Shot**
- **Regenerate Shot**
- **Approve Shot**
- **Generate Section**
- **Approve Section**

Global control:

- **Generate All Approved**

There should be no generic action whose meaning is "start everything automatically" without showing the number of creative shots and technical generation segments that will be queued.

## Clip Count Rules

### Structured Vision

The user's explicit shot count wins.

If the input has 8 shots, the default creative shot count is 8.

### General Vision

Director may suggest a shot count from song structure, but the user can adjust it before generation.

### Per-section adjustment

The user can add, remove, split, or merge creative shots within a section before generation.

Changing a section's creative shot count must update the shot plan visibly. It must not immediately enqueue provider requests.

### Technical splitting

Provider/model constraints may require multiple generation segments for one creative shot. Technical segment count is shown separately and never presented as additional creative shots.

## Generation Safety Rules

Generation must be command-driven, not effect-driven.

The following actions must **never** enqueue or regenerate video by themselves:

- opening or closing Director;
- React rerenders;
- restoring persisted state;
- moving between Director stages;
- completing a final render;
- audio analysis updates;
- loading an already-saved project;
- marking another clip ready;
- revisiting the Production stage.

Only explicit user commands may enqueue generation:

- Generate Shot;
- Regenerate Shot;
- Generate Section;
- Generate All Approved;
- an explicitly confirmed technical split generation action.

A completed shot/segment stays locked as `ready` until the user explicitly regenerates or deletes/replaces it.

## Render Behavior

Final render is assembly-only.

`renderFinal` / `renderTimeline` should:

- use approved ready media;
- assemble the timeline;
- save the project;
- return the rendered output URL.

It must never call generation enqueue functions, change ready clips to empty, or trigger regeneration as a side effect.

## Lip Sync Behavior

Lip sync remains optional and explicit.

No production completion effect should automatically launch LipDub. The UI may recommend lip sync for performance shots, but `runLipSync` starts only after the user presses the corresponding action.

A lip-synced result should replace/attach to the selected shot only after successful completion. Other completed shots remain unchanged.

## Migration / Compatibility

Existing saved Director sessions may use the older `shots: StoryboardShot[]` format.

Implementation should either:

1. migrate the old session into the new section/shot model; or
2. bump `DIRECTOR_VERSION` and safely rebuild the Director planning session while preserving the project's existing generated timeline clips.

Preference: bump the Director session version if migration adds unnecessary complexity. Existing generated videos must not be deleted or regenerated automatically.

## Components Expected to Change

Primary areas:

- `apps/web/src/components/AutoDirector.tsx`
- `apps/web/src/lib/store.ts`

Likely new focused modules to keep `AutoDirector.tsx` from growing further:

- `apps/web/src/lib/directorVisionParser.ts`
- `apps/web/src/lib/directorPlan.ts`
- optional dedicated section/shot UI component(s)

Potential tests:

- parser unit tests;
- Director plan unit tests;
- store tests for explicit clip/shot count behavior;
- regression tests proving render and state restoration do not enqueue generation.

Do not refactor unrelated UI or provider code.

## Acceptance Tests

### Structured 8-shot input

Given a Vision containing 8 numbered timecoded shots like the user's 60-second example:

- Director recognizes it as structured;
- Director displays 8 creative shots;
- all 8 timecodes are preserved;
- visual/camera/audio/text fields are preserved;
- no additional creative shots are invented automatically;
- no generation starts until the user presses a generation button.

### Partial structured input

Given timecodes and visual descriptions but no camera direction:

- Director preserves supplied fields;
- Director may suggest camera direction;
- suggestions do not overwrite supplied text.

### General Vision

Given a short concept such as "luxury rooftop performance at night":

- Director may create a suggested section/shot plan;
- the user can change shot count before generation;
- approval does not itself launch generation unless the user presses a generation command.

### Long-shot provider constraint

Given one 12-second creative shot and a selected model that can only render shorter segments:

- the UI still shows one creative shot;
- it explains the required technical segment count;
- no technical split is queued until the user approves it.

### No auto-regeneration

Given a shot that is already `ready`:

- reopening Director does not regenerate it;
- rendering the final timeline does not regenerate it;
- restoring the project does not regenerate it;
- completing another shot does not regenerate it;
- only pressing Regenerate Shot changes it into a new generation request.

### Section generation

Given a section with 3 approved shots:

- Generate Section queues only those 3 shots (plus any explicitly approved technical segments required by provider constraints);
- other sections remain untouched.

### Generate all

Before Generate All Approved runs, the UI shows the exact number of creative shots and provider generation requests that will be queued.

## Non-Goals

This feature does not:

- replace the user's external planning app;
- invent a new script-writing workflow when a structured plan is already supplied;
- change Agnes provider APIs;
- change final video encoding behavior;
- automatically decide that more shots are creatively better;
- silently regenerate content for quality improvement.

## Success Criteria

The feature is successful when the user can paste a detailed shot list into Vision and experience the Director as an executor/helper rather than a competing creative authority.

The user remains in control of:

- the creative shot count;
- shot timing;
- section structure;
- visual/camera/audio/text instructions;
- when generation starts;
- what gets regenerated.

Automatic analysis and Director suggestions remain useful defaults, but they never override explicit user intent.