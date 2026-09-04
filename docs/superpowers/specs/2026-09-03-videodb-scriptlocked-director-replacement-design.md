# VideoDB Script-Locked Director Replacement Design

Date: 2026-09-03
Status: Design approved in chat; written-spec review pending
Production base: `backup-pre-rollback-1890d80`
Upstream baseline: `video-db/Director@70e0b3dfdf59c679a25f4bea511e3cc4c5f2457f`
License: MIT; preserve upstream copyright/license notice for reused source

## 1. Decision

Replace the current Gemini/local-treatment Director planner for structured timecoded Vision with a VideoDB Director-based reasoning service, while keeping the existing editor, timecoded Vision parser, references/characters, approvals, Agnes generation, stitching, and final render pipeline.

Do **not** use VideoDB Director's stock `TextToMovieAgent`. Its default behavior generates a visual style and breaks a storyline into newly invented scenes, which is the generic behavior this replacement is intended to remove.

Instead, use the VideoDB Director reasoning/session/agent framework with one custom production agent:

`ScriptLockedAgnesAgent`

Core rule:

> User script facts are immutable. Director may clarify wording for Agnes, but may never creatively reinterpret, add, replace, merge, omit, or "improve" the shot.

Authoritative flow:

`User Vision -> exact parsed shot -> ScriptLockedAgnesAgent -> editable Agnes instruction + approved references -> explicit Generate -> existing Agnes pipeline`

Treatment, scene concepts, palette generation, and generic movie planning are not part of the authoritative structured-shot path.

## 2. Goals

- Preserve exact shot count, clip IDs, start times, and end times.
- Preserve explicit action, character, wardrobe, prop, equipment, location, camera, text, and audio-cue facts.
- Optimize wording for Agnes without inventing creative content.
- Keep multiple approved characters correctly bound to their own references.
- Keep identity, skin tone, wardrobe, props, equipment, vehicles/instruments, and recurring set details continuous.
- Keep continuity constraints concise enough that the current shot remains the dominant instruction.
- Keep planning/editing free of generation side effects.
- Preserve current Agnes generation, rate protection, technical segmentation/stitching, completed-media locking, and final assembly.
- Preserve the current app UI shell instead of replacing the product with VideoDB's separate chat frontend.

## 3. Non-Goals

- Do not use stock `TextToMovieAgent` for this workflow.
- Do not replace Agnes with VideoDB, Kling, or Stability generation.
- Do not require VideoDB media storage or a VideoDB collection for this workflow.
- Do not upload project media to VideoDB solely to use the reasoning framework.
- Do not invent global visual style, director references, palette, lighting, locations, characters, props, wardrobe, camera moves, story beats, or transitions.
- Do not change timecodes or clip count through chat.
- Do not auto-regenerate media.
- Do not make treatment/scene-board approval a gate before Agnes.

## 4. Architecture

### 4.1 Existing React editor remains the product shell

Keep:

- uploaded song/audio and analyzer data
- exact Vision text
- `parseDirectorVision` and Vision-derived timeline clips
- reference library
- multi-character approvals and per-shot selection
- approval images
- inline target-locked editing
- Agnes queue and provider pacing
- stitching/final render

The visible Director changes from a generic filmmaking workflow to a script-execution workflow.

### 4.2 Existing Node API remains the trusted gateway

The Node API remains responsible for:

- browser-facing `/api/director/*` routes
- project/clip/time validation
- reference/media URL handling
- Agnes credentials and generation calls
- rate limiting and generation safety
- stitching/final media operations
- validating every Python compiler response before the web app receives it

The browser never calls the Python reasoning service directly.

### 4.3 New Python VideoDB Director service

Add a separate Render Python web service under this repository, rooted at:

`services/videodb-director/`

The service will contain a **vendored snapshot** of only the upstream VideoDB Director modules required for reasoning/session/agent execution, copied from exact commit:

`70e0b3dfdf59c679a25f4bea511e3cc4c5f2457f`

Do not use a floating Git dependency, Git submodule, or production-time clone of upstream `main`.

Required attribution files:

- `services/videodb-director/LICENSE.upstream`
- `services/videodb-director/UPSTREAM.md`

`UPSTREAM.md` records upstream repository, pinned commit, vendored modules, and local modifications.

Deployment:

- separate Render Python web service
- service URL stored only in Node as `DIRECTOR_REASONING_URL`
- service-to-service bearer secret `DIRECTOR_REASONING_TOKEN`
- Python service rejects unauthenticated compile/edit requests
- no Agnes credentials in Python
- no direct browser access path in application code

If Render private networking is available later, the same HTTP contract can move to a private address without changing the application architecture. The initial design does not depend on private networking being available.

### 4.4 Do not use stock VideoDB `ChatHandler`

VideoDB's stock `ChatHandler` initializes VideoDB media state and registers the full stock agent list. That is not appropriate here.

Create a local entrypoint that reuses the vendored VideoDB Director reasoning/session/agent abstractions but:

- does not call `connect()` to VideoDB
- does not require `VIDEO_DB_API_KEY`
- does not register stock media/search/movie agents
- registers only `ScriptLockedAgnesAgent` for compile/edit operations

This ensures VideoDB media infrastructure is not a hidden dependency and prevents routing into generic agents.

### 4.5 LLM adapter

The custom service uses VideoDB Director's LLM abstraction but wraps it behind a local `ScriptLockedCompilerLLM` adapter.

Provider is configurable with `DIRECTOR_LLM_PROVIDER` and corresponding key. The implementation may use a supported VideoDB Director LLM backend, but provider choice must not alter the fidelity contract.

If the configured reasoning LLM is unavailable, the service returns a typed `reasoner_unavailable` failure. The Node gateway then uses the deterministic script-preserving fallback described in section 11. It never uses the old generic Gemini/local-treatment planner as fallback.

## 5. Script Fidelity Contract

Every structured shot has an immutable source record:

```ts
type ScriptLockedShot = {
  clipId: string;
  start: number;
  end: number;
  sourceText: string;
  visualDirection: string;
  cameraDirection: string;
  audioCue: string;
  onScreenText: string;
  selectedCharacterIds: string[];
  selectedReferenceIds: string[];
};
```

Compiler output is separate:

```ts
type AgnesExecutionShot = {
  clipId: string;
  start: number;
  end: number;
  sourceText: string;
  agnesPrompt: string;
  selectedCharacterIds: string[];
  selectedReferenceIds: string[];
  continuityConstraints: string[];
  compilerNotes: string[];
};
```

`sourceText`, `clipId`, `start`, and `end` are immutable.

### 5.1 Director may not add

Unless present in the current shot, approved persistent continuity state, or an explicit user edit, Director may not add:

- characters/people
- appearance or complexion changes
- wardrobe changes
- props/equipment
- vehicles/instruments
- locations/set pieces
- dialogue/on-screen text
- camera movement
- contradictory lens/framing specifics
- lighting/color concepts
- weather/time-of-day changes
- action beats
- transitions

### 5.2 Director may do

Director may:

- reorder the same facts into a clearer chronological Agnes prompt
- resolve an unambiguous pronoun to a selected named character
- express stated action temporally, e.g. start/middle/end positions
- express an explicitly stated camera move in executable motion language
- repeat essential approved identity/object details concisely
- add negative constraints that only prevent contradiction of locked facts
- report ambiguity instead of inventing a fact

## 6. Agnes Prompt Compiler

For structured Vision, `ScriptLockedAgnesAgent` is a constrained compiler, not a creative director.

Preferred prompt order:

1. visible subject/action in the current shot
2. required selected-character identity facts
3. required environment/prop/equipment facts
4. exact requested framing/camera/movement
5. visible temporal progression
6. concise continuity constraints
7. shot-relevant avoid constraints

Never prepend generic phrases such as:

- "cinematic scene board"
- "masterful composition"
- an invented director style
- an invented palette
- an invented mood/lighting package

The compiler should favor literal observable instructions and keep the user's shot content dominant.

## 7. Continuity

Continuity remains hardwired but is expressed as short shot-specific constraints.

### 7.1 Character continuity

For selected recurring characters:

- use the approved named reference for each character
- use the nearest prior approved image with that character when available
- preserve identity, skin tone/complexion, face, hair, body proportions, wardrobe, jewelry, and accessories unless the current script explicitly changes them
- never swap or clone Character 1 into Character 2

Example:

`Match Character 1 / char-1 exactly: same Black woman, same complexion, face, hair, and red suit.`

### 7.2 Project object/equipment continuity

For recurring props/equipment/set items, use the nearest approved project image as an object/set continuity anchor without importing people who are not selected in the current shot.

Example:

`Keep the same white grand piano and silver microphone established in the prior approved shot.`

### 7.3 Agnes video continuity

The approved shot image remains the preferred Agnes seed. The Agnes text receives only concise constraints needed to preserve that approved appearance across provider-sized technical segments.

## 8. UI Flow

### Step 1 — Script

Display the exact parsed timecoded shots and source text.

### Step 2 — References

Approve/select one or more characters and supporting references per shot.

### Step 3 — Agnes Instructions

For every shot display:

- exact source script
- compiled Agnes instruction
- selected character/reference chips
- continuity constraints
- `Script locked` status

The compiled instruction remains target-editable.

### Step 4 — Explicit generation

Keep explicit buttons:

- Generate shot image
- Generate section/video
- Regenerate this shot/section

Compile/chat never spends generation credits.

Treatment/mood/scene-board views may exist only as optional non-authoritative helpers. They cannot mutate source shots or compiled Agnes instructions unless the user explicitly applies a change.

## 9. Chat Behavior

Targeted chat edits the compiled Agnes instruction, not immutable source text, unless the user explicitly chooses to edit the source script.

Examples:

- `Make the camera movement slower` -> update only this compiled instruction if compatible with source facts.
- `Keep the microphone on the piano` -> strengthen this shot's object constraint.
- `Change her red suit to blue` -> if red suit is a locked source fact, report the conflict and require explicit source-script change.
- `Regenerate` -> prepare regeneration intent only; do not call Agnes.

Global chat cannot alter timecodes, clip count, or unrelated shots silently.

## 10. Node <-> Python Contract

Compile request contains exact structured shots plus IDs/metadata for approved references. The Python service does not need Agnes provider URLs or credentials to compile text.

Response contains:

```json
{
  "compiler": "videodb-scriptlocked-agnes-v1",
  "shots": [
    {
      "clipId": "vision-shot-1-...",
      "start": 12,
      "end": 18,
      "sourceText": "...",
      "agnesPrompt": "...",
      "selectedCharacterIds": ["char-1"],
      "selectedReferenceIds": ["char-1", "prop-piano"],
      "continuityConstraints": ["..."],
      "compilerNotes": []
    }
  ]
}
```

Node validates identity of every source field before accepting the result.

## 11. Fail-Closed Validation and Fallback

Reject a Python result if:

- shot count changes
- clip ID is added, omitted, duplicated, or renamed
- start/end changes
- source text changes
- returned character/reference ID was not supplied
- unapproved reference is bound
- a structured shot lacks an Agnes prompt

The Python service may also perform semantic unsupported-addition checks as defense-in-depth.

### Script-preserving fallback

If Python reasoning is unavailable or invalid, Node creates a minimal execution prompt directly from the already-parsed shot fields:

- source visual/action text
- explicit camera direction
- explicit on-screen text/audio cue when visually relevant
- selected approved character/object reference constraints
- concise existing continuity constraints

It adds no creative treatment, no invented scene description, and no generic palette/mood. This fallback is intentionally less polished but preserves the user's instructions.

The old Gemini Director planner and old local generic treatment planner are **not** automatic fallbacks for structured Script-Locked mode.

## 12. General-Prose Mode

Non-timecoded prose may still use a separately labeled assisted-planning workflow.

It must be technically separate from structured Script-Locked mode. As soon as a valid structured timecoded Vision exists, Script-Locked mode takes precedence and assisted planning cannot overwrite it.

## 13. Rollout

1. Add vendored/pinned Python reasoning service and unit tests.
2. Deploy new Python Render service and verify `/health` plus auth rejection/acceptance behavior.
3. Add Node compile/edit bridge and strict response validation while current production Director remains active.
4. Add Script-Locked UI behind an internal feature flag.
5. Run fixtures covering exact timecodes, two characters, recurring props/equipment, camera directions, and conflicting edits. No real Agnes generation is required.
6. Switch visible structured Director to the VideoDB Script-Locked path after bridge/UI tests are green.
7. Keep a rollback feature flag to the immediately previous production UI/code during migration. Do not use the previous generic planner as an automatic per-request fallback.
8. Verify exact merge commits are live for both Render services.

## 14. Existing Project Migration

Keep:

- Vision source text/timecodes
- approved characters/references
- approved/generated images and clips
- completed media locks

Treat existing `shot.prompt` values as legacy compiled output, not source truth.

On first Script-Locked recompile:

- regenerate instruction text only
- do not regenerate media automatically
- retain current approved shot image as continuity seed until the user explicitly replaces it

## 15. Testing

### Fidelity

- exact shot count/IDs/times/source text preserved
- no invented people/location/prop/camera move/style
- explicit camera movement preserved
- text/audio cues preserved correctly
- must-include/avoid scope preserved

### Multi-character

- Character 1/2 maintain separate IDs and references
- no swapped references
- no character cloning
- skin tone/complexion and identity remain stable

### Continuity

- wardrobe persists unless explicitly changed
- props/equipment persist across character changes
- approved prior visuals can anchor continuity
- unapproved visuals cannot anchor continuity
- project anchor cannot introduce unselected people

### Chat

- targeted edit changes only one compiled instruction
- timing/clip-count edit rejected
- source-fact conflict requires explicit source edit
- chat never invokes Agnes automatically

### Failure

- Python outage uses script-preserving fallback
- malformed Python response rejected
- unknown IDs rejected
- failure does not mutate approved plan/media

### Build/deploy

- existing relevant Director regressions retained/migrated
- Node workspace build green
- Python tests green
- Node/Python contract tests green
- both production health checks green
- no real Agnes generation in CI

## 16. Success Criteria

A detailed timecoded plan is successful when:

1. Director shows the same shot count and boundaries.
2. Each Agnes instruction is clearly the same user-authored shot, not a generic reinterpretation.
3. No new creative fact appears unless it came from source script, approved continuity state, or an explicit user edit.
4. Characters/props/equipment stay consistent across images and clips.
5. The user can inspect/edit the Agnes instruction before spending credits.
6. Agnes receives existing approved seeds/references and only generates on explicit action.
7. VideoDB Director supplies reasoning/session/agent structure without exposing stock generic Text-to-Movie behavior.

## 17. Final Architecture Choice

**Existing React editor + existing Node gateway + separate authenticated Python service containing a pinned vendored subset of VideoDB Director + custom `ScriptLockedAgnesAgent` + existing Agnes generation/stitch/render pipeline.**

This replaces the current generic Director planner for structured timecoded Vision without replacing the parts of the application that already work well.