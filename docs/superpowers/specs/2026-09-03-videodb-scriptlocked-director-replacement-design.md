# VideoDB Script-Locked Director Replacement Design

Date: 2026-09-03
Status: Design approved in chat; written-spec review pending
Production base: `backup-pre-rollback-1890d80`
Upstream VideoDB Director baseline: `video-db/Director@70e0b3dfdf59c679a25f4bea511e3cc4c5f2457f`
License: MIT; preserve upstream copyright/license notice in any vendored or modified source

## 1. Decision Summary

Replace the current Gemini/local-treatment Director planner with a VideoDB Director-based reasoning service, while keeping the existing music-video editor, timecoded Vision parser, reference/character library, approval UI, Agnes generation path, stitching, and final render pipeline.

The replacement is not VideoDB Director's stock `TextToMovieAgent`. That agent generates a new visual style and breaks a storyline into newly invented scenes, which conflicts with the product requirement. Instead, the VideoDB Director reasoning framework will run a custom `ScriptLockedAgnesAgent` whose only job is to compile each user-authored timecoded shot into an Agnes-ready execution instruction without creatively reinterpreting it.

Core rule:

> User script facts are immutable. Director may clarify wording for Agnes, but it may never creatively reinterpret, add, replace, merge, omit, or "improve" the shot.

The resulting product flow is:

`User Vision -> exact parsed shot -> ScriptLockedAgnesAgent -> editable Agnes instruction + references -> explicit Generate -> existing Agnes pipeline`

The generic treatment/scene-board pipeline is removed as a required generation path. Any treatment or inspiration view that remains is optional display metadata and cannot overwrite shot instructions.

## 2. Goals

1. Preserve the user's exact timecoded shot count and start/end boundaries.
2. Preserve each shot's explicit action, character, prop, wardrobe, equipment, location, camera, text, and audio-cue facts.
3. Use VideoDB Director as the reasoning/agent framework rather than the current Gemini Director planner architecture.
4. Optimize wording for Agnes without adding creative concepts that the user did not request.
5. Bind the correct approved character/reference assets to every shot.
6. Maintain strict identity and production continuity with short, shot-specific constraints that do not drown out the shot instruction.
7. Keep generation credit-safe: planning, compiling, editing, approval, and reference selection do not generate media automatically.
8. Preserve existing Agnes generation, long-shot provider segmentation/stitching, completed-media locking, and final assembly behavior.
9. Keep the existing web editor experience and adapt the Director panel rather than replacing the entire application with VideoDB's separate chat frontend.

## 3. Non-Goals

- Do not use VideoDB Director's stock `TextToMovieAgent` for the music-video generation workflow.
- Do not replace Agnes with Stability AI, Kling, or VideoDB generation engines.
- Do not upload the user's project media to VideoDB merely to make the reasoning framework work.
- Do not let Director invent a global color palette, director style, lighting concept, new location, new character, new prop, new wardrobe, new camera move, new story beat, or new transition unless the user explicitly requested it.
- Do not change timecodes or clip count through chat.
- Do not automatically regenerate existing approved or completed media.
- Do not require the generic treatment and scene-board approval stages before Agnes generation.

## 4. Architecture

### 4.1 Existing web application remains the product shell

Keep the current React editor and its existing project state, including:

- uploaded song/audio
- analyzer data
- exact timecoded Vision
- `parseDirectorVision` / Vision-derived timeline clips
- reference library
- multi-character approvals and per-shot character selection
- approval images
- inline target-locked edit chat
- existing Agnes generation queue
- provider-rate protection
- stitching/final render

The visible Director UI changes from a generic filmmaking workflow into a script-execution workflow.

### 4.2 Existing Node API remains the trusted application gateway

The current Node API remains responsible for:

- application-facing `/api/director/*` routes
- validation of project/clip IDs and exact time boundaries
- media/reference URL handling
- Agnes credentials and generation requests
- generation-rate limits
- stitching and final media operations
- shielding the Python reasoning service from provider credentials that it does not need

The browser never calls the Python Director service directly.

### 4.3 New Python VideoDB Director reasoning service

Add a dedicated Python service based on the VideoDB Director backend framework pinned to upstream commit `70e0b3dfdf59c679a25f4bea511e3cc4c5f2457f`.

Deployment model:

- separate private/internal Render web service
- Python runtime
- reachable only through a server-side URL configured in the Node API, e.g. `DIRECTOR_REASONING_URL`
- authenticated with a service-to-service secret, e.g. `DIRECTOR_REASONING_TOKEN`
- no Agnes API key in the Python service

The service will reuse the VideoDB Director agent/session/reasoning patterns required for our workflow, with upstream MIT license attribution preserved. The implementation should vendor or otherwise pin the required upstream source so production does not float with VideoDB's `main` branch.

### 4.4 Registered agent scope is intentionally narrow

For the music-video Director request, VideoDB Director will register only our approved custom agent(s), not the full stock agent list.

Primary agent:

`ScriptLockedAgnesAgent`

Responsibilities:

- compile exact timecoded shots into Agnes execution prompts
- perform target-locked prompt edits
- attach/return validated reference IDs
- return concise continuity requirements
- explain what it changed when editing a prompt

The stock `TextToMovieAgent` is not registered. Stock web search, movie-generation, generic image/video generation, and other unrelated agents are not available to this workflow.

This avoids accidental orchestration into a generic movie/storyline path.

## 5. Script Fidelity Contract

Every parsed structured shot has an immutable source record.

Example internal shape:

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

The compiler output is separate from the source:

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

`sourceText`, `start`, and `end` are never rewritten by Director.

### 5.1 Facts Director may not add

Unless present in the current shot source, approved persistent project state, or an explicit user edit, Director may not add:

- people or characters
- racial/ethnic appearance or skin-tone changes
- wardrobe or costume changes
- props or equipment
- vehicles or instruments
- locations or set pieces
- dialogue or on-screen text
- camera movement
- lens/framing specifics that contradict the shot
- lighting/color concepts
- weather/time-of-day changes
- action beats
- transitions

### 5.2 What Director may do

Director may:

- put the same facts into a clearer chronological order for Agnes
- resolve pronouns to the selected named character when unambiguous
- make explicitly stated motion temporal, e.g. "starts at piano, walks to window, ends at window"
- express an explicitly stated camera direction in executable motion language
- repeat essential identity/prop details concisely when needed for continuity
- state negative constraints that directly prevent contradiction of approved source facts
- flag ambiguity instead of inventing a fact

## 6. Agnes Prompt Compiler

For structured Vision, the custom agent acts as a deterministic constrained compiler rather than a creative director.

The preferred prompt order is:

1. visible subject/action from the current shot
2. required character identity/appearance facts
3. required environment/prop/equipment facts
4. exact camera/framing/movement requested by the user
5. visible temporal progression during the shot
6. concise continuity constraints from approved references
7. explicit avoid constraints relevant to this shot

No generic prefix such as "cinematic scene board," "masterful composition," "director style," or an invented palette is added automatically.

The output should be concise enough that the shot itself remains the dominant instruction.

## 7. Continuity Model

Continuity remains hardwired, but its prompt representation changes from a large blanket paragraph to minimal shot-specific constraints.

### 7.1 Character continuity

For every selected recurring character:

- use the approved named character reference
- use the nearest approved prior image featuring that same character when available
- preserve identity, skin tone/complexion, face, hair, body proportions, wardrobe, jewelry, and accessories unless the current script explicitly changes them
- never substitute one selected character for another

Example constraint:

`Match Character 1 / Reference char-1 exactly: same Black woman, same complexion, face, hair, and red suit.`

### 7.2 Project-object continuity

When a prop/equipment/set item is known to recur, use the nearest approved project image as an object/set anchor, without importing unselected people from that image.

Example:

`Keep the same white grand piano and silver microphone established in the prior approved shot.`

### 7.3 Agnes video continuity

The approved shot image remains the preferred Agnes seed. The video prompt receives only concise continuity constraints required to preserve that approved image across provider-sized technical segments.

## 8. UI / User Flow

The main Director workflow becomes:

### Step 1: Script

Show the parsed timecoded shots exactly as supplied. The user can inspect the source text and timing.

### Step 2: References

Select/approve characters and references for each shot. Multiple characters remain supported.

### Step 3: Agnes Instructions

For every shot show:

- exact source script
- compiled Agnes instruction
- selected character/reference chips
- continuity constraints
- status such as `Script locked`

The Agnes instruction is editable through the existing target-locked chat/edit control.

### Step 4: Explicit generation

Buttons remain explicit:

- Generate shot image
- Generate section/video
- Regenerate this shot/section

Planning or chat never spends generation credits automatically.

### Optional creative helpers

Treatment, mood, or scene-board tools may remain only as optional inspiration views. They must be clearly labeled non-authoritative and cannot mutate the source script or compiled Agnes instructions unless the user explicitly applies a change.

## 9. Director Chat Behavior

Targeted chat operates on the compiled instruction, not the immutable source script, unless the user explicitly asks to edit the script itself.

Examples:

- "Make the camera movement slower" -> modify only the current shot's Agnes instruction if compatible with source facts.
- "Keep the microphone on the piano" -> add/strengthen that shot's constraint.
- "Change her suit to blue" -> this conflicts with a locked red-suit source fact; Director should report the conflict and require an explicit source-script change rather than silently overriding it.
- "Regenerate" -> prepare regeneration intent only; do not call Agnes until the explicit button is pressed.

Global chat may answer questions about the project and prepare edits, but cannot alter timecodes/clip count or silently apply changes to unrelated shots.

## 10. Service API Contract

Node -> Python compile request:

```json
{
  "projectId": "...",
  "visionMode": "structured",
  "shots": [
    {
      "clipId": "vision-shot-1-...",
      "start": 12,
      "end": 18,
      "sourceText": "...",
      "visualDirection": "...",
      "cameraDirection": "...",
      "audioCue": "...",
      "onScreenText": "...",
      "selectedCharacterIds": ["char-1"],
      "selectedReferenceIds": ["char-1", "prop-piano"]
    }
  ],
  "references": [
    {
      "id": "char-1",
      "kind": "character",
      "name": "Character 1",
      "description": "..."
    }
  ],
  "mustInclude": "...",
  "avoid": "..."
}
```

Python -> Node response:

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

The Node API validates that every returned `clipId`, `start`, `end`, and `sourceText` exactly matches the request before accepting the compiled plan.

## 11. Validation / Fail-Closed Rules

The Node gateway rejects a compiled result if:

- shot count changes
- a clip ID is invented, omitted, duplicated, or renamed
- start/end time changes
- source text changes
- a returned character/reference ID is not one of the supplied IDs
- output contains an unapproved reference binding
- a structured shot has no compiled Agnes prompt

The compiler should also run semantic guard checks for obvious unsupported additions. The automated guard is defense-in-depth; the primary control is the constrained agent instruction and narrow registered-agent set.

If the Python Director service is unavailable, structured Vision does **not** fall back to the old generic planner. The safe fallback is a local script-preserving compiler in Node that passes through the user's shot facts with minimal formatting. Generic treatment fallback is removed from this path.

## 12. General-Prose Vision

Structured timecoded Vision gets the strict compiler path above.

For non-timecoded general prose, the app may still offer an assisted planning mode. It must be visually and technically separate from Script-Locked mode so assisted planning cannot silently become authoritative for a structured Vision.

When the user later provides timecodes, Script-Locked mode takes precedence immediately.

## 13. Upstream VideoDB Director Integration and License

Use upstream baseline:

`video-db/Director@70e0b3dfdf59c679a25f4bea511e3cc4c5f2457f`

Preserve the MIT license and copyright notice for copied/modified upstream portions.

Add an attribution file in the Python service, for example:

`services/videodb-director/UPSTREAM.md`

It should record:

- upstream repository
- pinned commit
- files/components reused
- local modifications
- license location

Do not fetch or execute arbitrary upstream `main` at production build time.

## 14. Deployment / Rollout

1. Build the new Python reasoning service separately from the current production Node service.
2. Deploy it as a private/internal Render service and verify `/health`.
3. Add Node-side bridge with the new compile contract while the existing Director remains production-active.
4. Add Script-Locked UI behind an internal feature flag.
5. Run automated fixture tests using realistic 2-character, props/equipment, and exact-timecode scripts. No real Agnes generation is required for compiler verification.
6. Switch the visible Director planner to VideoDB Script-Locked mode only after the bridge and UI are green.
7. Keep a rollback flag that routes to the immediately previous production UI/code while migration settles; do not use the old generic planner as an automatic fallback inside Script-Locked mode.
8. Verify Render deploys exact merge commits for both services.

## 15. Testing Requirements

### Compiler fidelity

- exact shot count preserved
- exact clip IDs preserved
- exact start/end preserved
- exact source text preserved
- no invented scene/location/prop/person/camera move
- explicitly requested camera motion preserved
- on-screen text and audio cue preserved when present
- must-include and avoid constraints remain scoped correctly

### Multi-character

- Character 1 and Character 2 remain separate bindings
- references cannot be swapped
- same recurring character preserves skin tone/complexion and identity
- second character is not cloned from the first

### Continuity

- recurring wardrobe remains when script does not change it
- recurring prop/equipment remains across character changes
- prior approved visual can be used as an anchor
- unapproved visual cannot become an anchor
- project anchor cannot introduce unselected people

### Chat

- targeted edit changes only one compiled instruction
- timing edit is rejected
- conflicting source-fact edit requires explicit source-script change
- chat never invokes Agnes automatically

### Failure behavior

- Python reasoning outage uses script-preserving fallback, never generic treatment fallback
- malformed Python response is rejected by Node
- unknown clip/reference IDs are rejected
- upstream service/API failure does not mutate current approved plan/media

### Build/deploy

- existing Director regressions retained or migrated
- Node workspace build green
- Python unit/integration tests green
- contract test between Node and Python green
- production health checks green
- no real Agnes generation in CI

## 16. Migration of Existing Projects

Existing saved sessions may contain treatment, scene approvals, shot approvals, compiled prompts, character approvals, and media.

Migration rules:

- keep existing approved/generated media
- keep character/reference approvals
- keep exact Vision text and timecodes
- treat old generated `shot.prompt` as legacy compiled output, not source truth
- on first Script-Locked recompile, regenerate only the Agnes instruction text; do not regenerate media automatically
- retain existing approved shot image as continuity seed until the user explicitly replaces it

## 17. Success Criteria

The replacement is successful when a user can paste a detailed timecoded shot plan and observe that:

1. Director displays exactly the same shot count and time boundaries.
2. Each Agnes instruction is recognizably the same shot, not a generic reinterpretation.
3. No location, character, wardrobe, prop, camera action, lighting concept, or story beat appears unless it came from the script, approved persistent continuity, or an explicit edit.
4. Character and prop continuity remains strong across images and clips.
5. The user can inspect/edit the Agnes instruction before spending credits.
6. Agnes continues to receive the existing approved image seed/reference pipeline and explicit generation commands.
7. VideoDB Director provides reasoning/session/agent orchestration without exposing its generic Text-to-Movie creative behavior to this workflow.

## 18. Explicit Architecture Choice

The chosen implementation is:

**Existing React editor + existing Node application gateway + separate pinned VideoDB Director Python reasoning service + custom ScriptLockedAgnesAgent + existing Agnes generation/stitch/render pipeline.**

This replaces the current Gemini/local generic Director planner architecture for structured timecoded Vision while preserving the production systems that already work well.