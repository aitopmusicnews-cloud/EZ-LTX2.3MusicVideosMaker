# VideoDB Script-Locked Director Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the structured-timecode Director planner with a pinned VideoDB Director-based `ScriptLockedAgnesAgent` that preserves the user’s exact shot facts and produces precise, editable Agnes instructions without generic creative rewriting.

**Architecture:** Keep the existing React editor, Node/Fastify gateway, Agnes provider integration, approvals, stitching, and render pipeline. Add an authenticated Python reasoning service under `services/videodb-director/` containing a pinned/adapted subset of `video-db/Director@70e0b3dfdf59c679a25f4bea511e3cc4c5f2457f`; structured Vision compile/edit requests go Node -> Python -> Node validation, with a deterministic script-preserving Node fallback only when compile reasoning is unavailable. A new `ScriptLockedDirectorAgent` handles structured Vision, while general prose can explicitly open a separately labeled Assisted Director during migration.

**Tech Stack:** React 19, TypeScript 5.6, Fastify, Zod, Node 22, Python 3.11, Flask 3.0.3, Gunicorn, Pydantic 2.8.2, VideoDB Director agent/LLM abstractions, Gemini via VideoDB Director’s Google/OpenAI-compatible adapter, GitHub Actions, Render.

**Spec:** `docs/superpowers/specs/2026-09-03-videodb-scriptlocked-director-replacement-design.md`

## Global Constraints

- Production target is `backup-pre-rollback-1890d80`; never retarget the existing Render service to `main`.
- Upstream VideoDB Director is pinned to commit `70e0b3dfdf59c679a25f4bea511e3cc4c5f2457f`; no production-time clone/submodule/floating `main`.
- Preserve upstream MIT attribution for reused source.
- Structured Vision is authoritative: exact shot count, `clipId`, `start`, `end`, and `sourceText` are immutable.
- `ScriptLockedAgnesAgent` may only reorder/clarify existing facts for Agnes; it may not invent people, locations, props, equipment, wardrobe, lighting, palettes, camera moves, story beats, text/dialogue, or transitions.
- Do not register VideoDB stock `TextToMovieAgent`, stock `ChatHandler`, stock search/media agents, or stock generation engines for this workflow.
- Python receives no Agnes key and requires no VideoDB collection/storage account.
- Browser calls Node only; Node calls Python with bearer auth.
- Compile outage/timeout may use the deterministic Node script-preserving fallback; validation/conflict errors do not fall back. Edit outage returns 503 rather than guessing.
- Old generic Gemini/local-treatment planning is never an automatic fallback inside Script-Locked mode.
- Existing approved/generated images/clips remain; migration recompiles text only and never regenerates automatically.
- Character identity, skin tone/complexion, wardrobe, props, equipment, vehicles/instruments, and recurring set continuity remain enforced with short shot-specific constraints.
- Compile/edit/reference/approval/migration actions never invoke image/Agnes providers.
- No real Agnes generation in CI or automated smoke verification.
- Legacy Director remains available only through an explicit rollback/Assisted Director route during migration.

---

## File Structure

### Python service
- `services/videodb-director/.python-version`
- `services/videodb-director/requirements.txt`
- `services/videodb-director/LICENSE.upstream`
- `services/videodb-director/UPSTREAM.md`
- `services/videodb-director/app.py`
- `services/videodb-director/director/agents/base.py`
- `services/videodb-director/director/llm/base.py`
- `services/videodb-director/director/llm/googleai.py`
- `services/videodb-director/director/core/session.py`
- `services/videodb-director/director/core/reasoning.py`
- `services/videodb-director/scriptlocked/models.py`
- `services/videodb-director/scriptlocked/fidelity.py`
- `services/videodb-director/scriptlocked/continuity.py`
- `services/videodb-director/scriptlocked/agent.py`
- `services/videodb-director/scriptlocked/llm.py`
- `services/videodb-director/scriptlocked/service.py`
- `services/videodb-director/tests/test_app.py`
- `services/videodb-director/tests/test_compile.py`
- `services/videodb-director/tests/test_edit.py`

### Node API
- `apps/api/src/director_scriptlocked_contract.ts`
- `apps/api/src/director_scriptlocked_fallback.ts`
- `apps/api/src/director_scriptlocked_client.ts`
- `apps/api/src/director_scriptlocked.test.ts`
- `apps/api/src/config.ts`
- `apps/api/src/server.ts`

### Web
- `apps/web/src/lib/directorScriptLocked.ts`
- `apps/web/src/lib/directorScriptLockedClient.ts`
- `apps/web/src/lib/directorScriptLockedGeneration.ts`
- `apps/web/src/lib/directorScriptLocked.test.ts`
- `apps/web/src/lib/directorScriptLockedGeneration.test.ts`
- `apps/web/src/components/ScriptLockedDirectorAgent.tsx`
- `apps/web/src/components/ScriptLockedDirectorAgent.test.ts`
- `apps/web/scripts/scriptlocked-director-launcher.patch.mjs`
- existing web prebuild entrypoint that applies Director patches

### CI/rollout
- `.github/workflows/build-check.yml`
- approved spec status updated only after production verification

---

### Task 1: Vendor the minimal VideoDB Director core and create the authenticated Python service shell

**Files:** Python service foundation files listed above through `director/core/reasoning.py`, plus `tests/test_app.py`.

**Interfaces:**
- Produces `create_app()` and routes `/health`, `/v1/compile`, `/v1/edit`.
- Produces VideoDB-compatible `BaseAgent`, `AgentResponse`, `BaseLLM`, `LLMResponse`, `ContextMessage`, `Session`, `ReasoningEngine` interfaces.

- [ ] **Step 1: Write failing service/auth tests**

```python
from app import create_app


def make_client(monkeypatch):
    monkeypatch.setenv("DIRECTOR_REASONING_TOKEN", "test-token")
    return create_app().test_client()


def test_health_is_public(monkeypatch):
    response = make_client(monkeypatch).get("/health")
    assert response.status_code == 200
    assert response.get_json() == {"ok": True, "service": "videodb-scriptlocked-director"}


def test_compile_requires_service_bearer(monkeypatch):
    response = make_client(monkeypatch).post("/v1/compile", json={})
    assert response.status_code == 401
    assert response.get_json()["error"] == "unauthorized"
```

- [ ] **Step 2: Run RED**

```bash
cd services/videodb-director
python -m pytest tests/test_app.py -q
```

Expected: import/file failure because the service does not exist.

- [ ] **Step 3: Pin runtime/dependencies to verified upstream-compatible versions**

`.python-version`:

```text
3.11.9
```

`requirements.txt`:

```text
Flask==3.0.3
gunicorn==23.0.0
openai==1.55.3
openai-function-calling==2.6.0
pydantic==2.8.2
pydantic-settings==2.4.0
pytest==8.3.5
```

The VideoDB-derived dependency versions above match the pinned upstream backend where relevant; Gunicorn/pytest are local service/test additions.

- [ ] **Step 4: Add exact MIT attribution**

Copy upstream `LICENSE` verbatim to `LICENSE.upstream`. `UPSTREAM.md` must state:

```markdown
Repository: https://github.com/video-db/Director
Pinned commit: 70e0b3dfdf59c679a25f4bea511e3cc4c5f2457f
Reused/adapted: agents/base.py, llm/base.py, llm/googleai.py, core/session.py interfaces, core/reasoning.py orchestration pattern.
Local changes: no VideoDB collection/media state; Script-Locked system prompt; one custom agent; authenticated compile/edit HTTP service.
```

- [ ] **Step 5: Vendor/adapt the core**

Keep these external signatures stable:

```python
class AgentResponse(BaseModel):
    status: str
    message: str = ""
    data: dict = {}

class BaseAgent(ABC):
    def to_llm_format(self) -> dict: ...
    def safe_call(self, *args, **kwargs) -> AgentResponse: ...

class ContextMessage(BaseModel):
    content: str | list[dict] | None = None
    tool_calls: list[dict] | None = None
    tool_call_id: str | None = None
    role: RoleTypes
    def to_llm_msg(self) -> dict: ...

class Session(BaseModel):
    session_id: str
    reasoning_context: list[ContextMessage]
```

Adapt `ReasoningEngine.build_context()` so it never accesses `session.state["collection"]`, VideoDB media, sockets, or DB persistence.

- [ ] **Step 6: Add Flask auth shell**

```python
import os
from flask import Flask, jsonify, request


def create_app():
    app = Flask(__name__)

    @app.get("/health")
    def health():
        return {"ok": True, "service": "videodb-scriptlocked-director"}

    def require_token():
        expected = os.environ.get("DIRECTOR_REASONING_TOKEN", "")
        received = request.headers.get("Authorization", "")
        if not expected or received != f"Bearer {expected}":
            return jsonify({"error": "unauthorized"}), 401
        return None

    @app.post("/v1/compile")
    def compile_route():
        denied = require_token()
        if denied: return denied
        return jsonify({"error": "invalid_request"}), 400

    @app.post("/v1/edit")
    def edit_route():
        denied = require_token()
        if denied: return denied
        return jsonify({"error": "invalid_request"}), 400

    return app

app = create_app()
```

- [ ] **Step 7: Run GREEN and commit**

```bash
cd services/videodb-director && python -m pytest tests/test_app.py -q
cd ../..
git add services/videodb-director
git commit -m "feat: add pinned VideoDB Director service shell"
```

---

### Task 2: Implement immutable contracts, fidelity guards, concise continuity, and `ScriptLockedAgnesAgent`

**Files:** `scriptlocked/models.py`, `fidelity.py`, `continuity.py`, `agent.py`, `llm.py`, `service.py`, `tests/test_compile.py`, modify `app.py`.

**Interfaces:**
- `compile_project(request: CompileRequest) -> CompileResponse`
- typed `ReasonerUnavailable`
- response compiler ID `videodb-scriptlocked-agnes-v1`

- [ ] **Step 1: Write failing compile fidelity tests**

```python
SHOT = {
    "clipId": "vision-shot-1",
    "start": 12.0,
    "end": 18.0,
    "sourceText": "Character 1 walks from the white piano to the window. Camera tracks right. Red suit. Microphone stays on piano.",
    "visualDirection": "Character 1 walks from the white piano to the window. Red suit. Microphone stays on piano.",
    "cameraDirection": "Camera tracks right.",
    "audioCue": "",
    "onScreenText": "",
    "selectedCharacterIds": ["char-1"],
    "selectedReferenceIds": ["char-1", "piano-ref"],
}


def test_compile_preserves_immutable_source(monkeypatch):
    monkeypatch.setenv("SCRIPTLOCKED_TEST_RESPONSE", "Character 1 walks from the white piano to the window while the camera tracks right. She wears the same red suit. The microphone remains on the piano.")
    result = compile_project(make_request(SHOT))
    output = result.shots[0]
    assert (output.clipId, output.start, output.end, output.sourceText) == (SHOT["clipId"], SHOT["start"], SHOT["end"], SHOT["sourceText"])


def test_compile_rejects_generic_invented_location(monkeypatch):
    monkeypatch.setenv("SCRIPTLOCKED_TEST_RESPONSE", "In a neon nightclub, Character 1 walks from the piano to the window.")
    with pytest.raises(ValueError, match="unsupported addition"):
        compile_project(make_request(SHOT))
```

- [ ] **Step 2: Run RED**

```bash
cd services/videodb-director && python -m pytest tests/test_compile.py -q
```

- [ ] **Step 3: Define exact models**

```python
class ScriptLockedShot(BaseModel):
    clipId: str
    start: float
    end: float
    sourceText: str
    visualDirection: str = ""
    cameraDirection: str = ""
    audioCue: str = ""
    onScreenText: str = ""
    selectedCharacterIds: list[str] = Field(default_factory=list)
    selectedReferenceIds: list[str] = Field(default_factory=list)

class AgnesExecutionShot(BaseModel):
    clipId: str
    start: float
    end: float
    sourceText: str
    agnesPrompt: str
    selectedCharacterIds: list[str]
    selectedReferenceIds: list[str]
    continuityConstraints: list[str] = Field(default_factory=list)
    compilerNotes: list[str] = Field(default_factory=list)
```

`CompileRequest` accepts only `visionMode="structured"`; `CompileResponse.compiler` is literal `videodb-scriptlocked-agnes-v1`.

- [ ] **Step 4: Implement concise continuity builder**

```python
def build_continuity_constraints(shot, references) -> list[str]:
    by_id = {ref.id: ref for ref in references}
    result = []
    for character_id in shot.selectedCharacterIds:
        ref = by_id.get(character_id)
        if ref:
            result.append(f"Match {ref.name} / {ref.id} exactly: same identity, skin tone/complexion, face, hair, wardrobe, jewelry, and accessories unless this shot explicitly changes them.")
    return result
```

Object/equipment constraints may use approved reference descriptions, but must describe only objects already supplied to the shot/project continuity context.

- [ ] **Step 5: Implement deterministic fidelity guard**

```python
GENERIC_ADDITION_TERMS = (
    "nightclub", "neon", "smoke", "dancers", "stage",
    "dramatic lighting", "cinematic palette", "director style",
)

def validate_no_generic_additions(prompt: str, allowed_text: str) -> None:
    invented = [term for term in GENERIC_ADDITION_TERMS if term in prompt.lower() and term not in allowed_text.lower()]
    if invented:
        raise ValueError(f"unsupported addition: {', '.join(invented)}")
```

Also validate output reference IDs are a subset of supplied/selected IDs and preserve exact immutable source fields.

- [ ] **Step 6: Implement Script-Locked system instruction**

```python
SCRIPT_LOCKED_SYSTEM = """
You are ScriptLockedAgnesAgent, an execution-prompt compiler for Agnes video generation.
The current timecoded shot is the source of truth.
Reorder and clarify the same visible facts into chronological Agnes-friendly language only.
Never add a person, location, prop, wardrobe/equipment item, vehicle, instrument, lighting concept, palette, weather, time of day, camera move, story beat, dialogue, on-screen text, or transition that is not in the current shot or supplied approved continuity facts.
Never add generic cinematic filler unless the user wrote it.
Return only the compiled Agnes prompt text.
""".strip()
```

The agent receives one shot at a time, never the whole script as creative material.

- [ ] **Step 7: Implement VideoDB Google LLM adapter selection**

```python
class ReasonerUnavailable(RuntimeError):
    pass


def get_scriptlocked_llm():
    test_response = os.getenv("SCRIPTLOCKED_TEST_RESPONSE")
    if test_response is not None:
        return StaticTestLLM(test_response)
    if not os.getenv("GOOGLEAI_API_KEY"):
        raise ReasonerUnavailable("GOOGLEAI_API_KEY is not configured")
    return GoogleAI()
```

`GOOGLEAI_CHAT_MODEL` is supplied by Render and must be verified against a currently supported Gemini model before production enablement.

- [ ] **Step 8: Implement direct authoritative compile path**

`compile_project()` loops request shots and directly invokes `ScriptLockedAgnesAgent.compile_shot(...)`; do not ask the reasoning engine to choose a tool during authoritative compilation.

- [ ] **Step 9: Wire `/v1/compile`**

- HTTP 200 valid compile
- HTTP 422 fidelity/validation failure
- HTTP 503 `{error:"reasoner_unavailable"}` for provider outage/configuration
- no partial success response

- [ ] **Step 10: Run GREEN and commit**

```bash
cd services/videodb-director && python -m pytest tests/test_app.py tests/test_compile.py -q
cd ../..
git add services/videodb-director
git commit -m "feat: add Script-Locked Agnes compile agent"
```

---

### Task 3: Add target-locked VideoDB reasoning for instruction edits

**Files:** `tests/test_edit.py`, modify Python reasoning/models/agent/service/app files.

**Interfaces:**
- `edit_instruction(request: EditRequest) -> EditResponse`
- one registered tool only: `script_locked_agnes`
- immutable `clipId/start/end/sourceText`

- [ ] **Step 1: Write failing tests**

```python
def test_edit_rejects_timing_change(client, auth_headers):
    response = client.post("/v1/edit", headers=auth_headers, json=make_edit_request("Change this to 00:30-00:40"))
    assert response.status_code == 409
    assert response.get_json()["error"] == "locked_source_conflict"


def test_edit_rejects_locked_wardrobe_change(client, auth_headers):
    response = client.post("/v1/edit", headers=auth_headers, json=make_edit_request("Change her red suit to blue"))
    assert response.status_code == 409


def test_edit_returns_only_target_clip(client, auth_headers, monkeypatch):
    monkeypatch.setenv("SCRIPTLOCKED_TEST_RESPONSE", "Character 1 walks more slowly to the window while the camera tracks right; red suit and microphone placement remain unchanged.")
    response = client.post("/v1/edit", headers=auth_headers, json=make_edit_request("Make her walk slower"))
    assert response.status_code == 200
    assert response.get_json()["clipId"] == "vision-shot-1"
```

- [ ] **Step 2: Run RED**

```bash
cd services/videodb-director && python -m pytest tests/test_edit.py -q
```

- [ ] **Step 3: Define edit contract**

```python
class EditRequest(BaseModel):
    projectId: str
    target: Literal["agnes_instruction"]
    clipId: str
    start: float
    end: float
    sourceText: str
    currentAgnesPrompt: str
    selectedCharacterIds: list[str]
    selectedReferenceIds: list[str]
    continuityConstraints: list[str]
    userMessage: str
```

`EditResponse` repeats immutable fields plus `agnesPrompt` and `compilerNotes`.

- [ ] **Step 4: Replace upstream generic reasoning system prompt**

```text
You are the reasoning layer for one Script-Locked Agnes instruction.
You have exactly one tool: script_locked_agnes.
Never change clipId, start, end, or sourceText.
Never operate on another clip.
If the edit conflicts with locked source facts, report locked_source_conflict.
Never invoke media generation.
```

Remove all upstream collection/upload/search fallback behavior.

- [ ] **Step 5: Add deterministic preflight conflicts**

Reject before LLM:
- different timecode/timing request
- explicit wardrobe/color substitution against a stated source fact
- explicit addition of a person/location/prop not present in source/reference facts

Return HTTP 409 rather than guessing.

- [ ] **Step 6: Implement edit reasoning and post-validation**

Run the narrow VideoDB reasoning loop with only `ScriptLockedAgnesAgent`; revalidate exact source and unsupported additions after the tool response.

- [ ] **Step 7: Wire route, run GREEN, commit**

```bash
cd services/videodb-director && python -m pytest -q
cd ../..
git add services/videodb-director
git commit -m "feat: add target-locked Director instruction editing"
```

---

### Task 4: Add Node contracts, authenticated bridge, safe feature flag, and deterministic fallback

**Files:** create Node contract/fallback/client/tests; modify `apps/api/src/config.ts` and `server.ts`.

**Interfaces:**
- `compileScriptLockedDirector(raw): Promise<ScriptLockedCompileResponse>`
- `editScriptLockedDirector(raw): Promise<ScriptLockedEditResponse>`
- routes `/api/director/scriptlocked/compile`, `/api/director/scriptlocked/edit`

- [ ] **Step 1: Write failing contract/fallback tests**

```ts
test("rejects compile response that changes exact time", () => {
  assert.throws(() => validateCompileResponse(request, changedEndResponse), /exact source/i);
});

test("fallback preserves literal script and has no generic filler", () => {
  const prompt = buildScriptPreservingFallback(request).shots[0]!.agnesPrompt;
  assert.match(prompt, /walks from the piano to the window/i);
  assert.match(prompt, /camera tracks right/i);
  assert.doesNotMatch(prompt, /cinematic|masterful|neon|dramatic lighting/i);
});
```

- [ ] **Step 2: Run RED**

```bash
npx tsx --test apps/api/src/director_scriptlocked.test.ts
```

- [ ] **Step 3: Mirror Python schemas in Zod and validate exact source**

Validation must reject changed/missing/duplicate/renamed IDs, changed times/source text, unknown character/reference IDs, and empty compiled prompts.

- [ ] **Step 4: Implement deterministic fallback**

```ts
export function buildScriptPreservingFallback(req: ScriptLockedCompileRequest): ScriptLockedCompileResponse {
  return {
    compiler: "node-script-preserving-fallback-v1",
    shots: req.shots.map((shot) => ({
      clipId: shot.clipId,
      start: shot.start,
      end: shot.end,
      sourceText: shot.sourceText,
      agnesPrompt: [shot.visualDirection || shot.sourceText, shot.cameraDirection, shot.onScreenText ? `On-screen text: ${shot.onScreenText}` : ""].filter(Boolean).join(" "),
      selectedCharacterIds: shot.selectedCharacterIds,
      selectedReferenceIds: shot.selectedReferenceIds,
      continuityConstraints: [],
      compilerNotes: ["Reasoning service unavailable; literal script-preserving fallback used."],
    })),
  };
}
```

Never call old `createDirectorPlan()` from this path.

- [ ] **Step 5: Add a safe boolean env parser**

Do **not** use `z.coerce.boolean()` because the string `"false"` is truthy in JavaScript coercion.

```ts
const envBoolean = z.preprocess((value) => {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false" || normalized === "") return false;
  }
  return value;
}, z.boolean());

DIRECTOR_REASONING_URL: optionalUrl.optional(),
DIRECTOR_REASONING_TOKEN: optionalNonEmpty.optional(),
DIRECTOR_SCRIPTLOCKED_ENABLED: envBoolean.default(false),
```

- [ ] **Step 6: Implement authenticated Python client**

Use 120s timeout. Only network/timeout/503 `reasoner_unavailable` invokes compile fallback. HTTP 409/422 propagates as conflict/validation and never falls back.

- [ ] **Step 7: Add routes**

When `DIRECTOR_SCRIPTLOCKED_ENABLED=false`, routes return 404 `{error:"Script-Locked Director is disabled"}`; do not silently route to legacy.

- [ ] **Step 8: Run GREEN and commit**

```bash
npx tsx --test apps/api/src/director_scriptlocked.test.ts
npm run typecheck --workspace @mvs/api
git add apps/api/src
git commit -m "feat: bridge Node API to Script-Locked Director"
```

---

### Task 5: Build the new structured Director UI, migrate assets, and keep general prose explicitly separate

**Files:** web Script-Locked modules/component/tests/launcher patch and prebuild entrypoint.

**Interfaces:**
- `ScriptLockedDirectorSessionV1`
- browser `compileScriptLocked()` / `editScriptLocked()`
- events: `mvs-open-ltx-director` for product Director, `mvs-open-assisted-director` for explicit legacy/general-prose assisted mode during migration.

- [ ] **Step 1: Write failing source/migration tests**

```ts
test("structured Vision becomes immutable source shots", () => {
  const shots = buildScriptLockedShots(`00:12–00:18\nShot 1: Character 1 walks to the window.\nCamera: track right.\n00:18–00:23\nShot 2: Character 2 remains at the piano.`, []);
  assert.equal(shots.length, 2);
  assert.deepEqual([shots[0]!.start, shots[0]!.end], [12, 18]);
});

test("migration retains approved media but not legacy prompt authority", () => {
  const migrated = migrateLegacyDirectorAssets(legacyFixture);
  assert.equal(migrated.shotApprovals["vision-shot-1"]!.url, "/old.png");
  assert.equal(migrated.sectionApprovals["vision-shot-1"]!.url, "/old.mp4");
  assert.equal(migrated.compiledByClip["vision-shot-1"], undefined);
});
```

- [ ] **Step 2: Run RED**

```bash
npx tsx --test apps/web/src/lib/directorScriptLocked.test.ts
```

- [ ] **Step 3: Define separate session model**

```ts
export type ScriptLockedDirectorSessionV1 = {
  version: 1;
  sourceVision: string;
  compiledByClip: Record<string, ScriptLockedCompiledShot | undefined>;
  approvedCharacterIds: string[];
  characterSelections: Record<string, string[]>;
  shotApprovals: Record<string, Approval | undefined>;
  sceneApprovals: Record<string, Approval | undefined>;
  sectionApprovals: Record<string, Approval | undefined>;
};
```

Legacy `shot.prompt` is not migrated into `compiledByClip`.

- [ ] **Step 4: Add API client and new component**

UI order is fixed:
1. **Script** — exact source/timing.
2. **References** — approved one/many character/reference selection.
3. **Agnes Instructions** — compiled prompt, continuity chips, `Script locked` badge, target edit chat.
4. **Generate** — explicit generation buttons.

No mandatory treatment/palette/scene-board stage.

- [ ] **Step 5: Handle general prose explicitly**

If `parseDirectorVision(vision).mode === "general"`, the new component must not fabricate shot boundaries. Show:

```text
Script-Locked Director needs timecoded shots. Add timecodes to use the Agnes compiler, or open Assisted Director for non-timecoded planning.
```

Provide an **Open Assisted Director** button that dispatches `mvs-open-assisted-director`.

- [ ] **Step 6: Make launcher ownership unambiguous**

With `VITE_SCRIPTLOCKED_DIRECTOR_ENABLED === "true"`:
- `ScriptLockedDirectorAgent` listens to `mvs-open-ltx-director`.
- legacy `LtxDirectorAgent` does **not** listen to `mvs-open-ltx-director`; it listens only to `mvs-open-assisted-director`.

With flag false:
- legacy keeps `mvs-open-ltx-director` behavior.
- no new component listener is active.

The launcher patch must only switch event ownership; it must not patch planning logic.

- [ ] **Step 7: Migrate existing assets without provider calls**

Copy matching approved scene/shot/section media and character approvals/selections by `clipId`; leave compiled text empty until `Compile Agnes instructions` is clicked.

- [ ] **Step 8: Add target instruction chat**

Send one clip only to `/api/director/scriptlocked/edit`; accept response only if `clipId/start/end/sourceText` match exactly. No provider call from chat.

- [ ] **Step 9: Add UI/source regressions**

Tests assert:
- `Script locked`
- exact source display
- `Compile Agnes instructions`
- no required treatment approval
- no generic `Cinematic scene board` prefix
- general prose shows Assisted Director option rather than auto-planning
- compile/edit handlers contain no generation calls

- [ ] **Step 10: Run GREEN and commit**

```bash
npx tsx --test apps/web/src/lib/directorScriptLocked.test.ts apps/web/src/components/ScriptLockedDirectorAgent.test.ts
npm run typecheck --workspace @mvs/web
git add apps/web/src apps/web/scripts
git commit -m "feat: add Script-Locked Director interface"
```

---

### Task 6: Hand the compiled instruction directly to Agnes with concise reference continuity

**Files:** `directorScriptLockedGeneration.ts`, its tests, and generation wiring in `ScriptLockedDirectorAgent.tsx`.

**Interfaces:**
- `buildAgnesGenerationInstruction({agnesPrompt, continuityConstraints}) -> string`
- existing Agnes provider API unchanged.

- [ ] **Step 1: Write failing handoff test**

```ts
test("compiled shot stays dominant", () => {
  const prompt = buildAgnesGenerationInstruction({
    agnesPrompt: "Character 1 walks from the white piano to the window while the camera tracks right.",
    continuityConstraints: ["Match Character 1 exactly: same complexion and red suit."],
  });
  assert.match(prompt, /^Character 1 walks/);
  assert.doesNotMatch(prompt, /cinematic scene board|visual style|color palette|masterful composition/i);
});
```

- [ ] **Step 2: Run RED**

```bash
npx tsx --test apps/web/src/lib/directorScriptLockedGeneration.test.ts
```

- [ ] **Step 3: Implement minimal builder**

```ts
export function buildAgnesGenerationInstruction(input: { agnesPrompt: string; continuityConstraints: string[] }) {
  return [input.agnesPrompt.trim(), ...input.continuityConstraints.map((item) => item.trim()).filter(Boolean)].filter(Boolean).join(" ");
}
```

No legacy treatment, visual style, palette, or transition text is appended automatically.

- [ ] **Step 4: Bind image references in exact order**

Image/edit refs:
1. existing target image when editing
2. selected named character refs in selected order
3. prior same-character approved anchor when distinct
4. approved project object/set anchor when distinct

Agnes video:
- approved current shot image is preferred single seed
- character-required shot with no approved shot image is blocked
- do not change Agnes raw seed contract to multiple seeds

- [ ] **Step 5: Keep provider calls explicit**

Only Generate/Regenerate buttons may invoke image/Agnes providers. Compile, edit, migration, selection, approval changes do not.

- [ ] **Step 6: Preserve long-section semantics**

Every provider-sized technical segment gets the same compiled instruction and seed lineage; segmentation changes duration only, never creative content.

- [ ] **Step 7: Run GREEN and commit**

```bash
npx tsx --test apps/web/src/lib/directorScriptLockedGeneration.test.ts apps/web/src/lib/directorGeneration.test.ts apps/web/src/lib/directorCharacterMedia.test.ts apps/web/src/lib/directorContinuityLock.test.ts
git add apps/web/src
git commit -m "feat: send Script-Locked instructions directly to Agnes"
```

---

### Task 7: Add realistic cross-service fixtures and CI gates

**Files:** Python fixture/tests, Node fixture validation, `.github/workflows/build-check.yml`.

- [ ] **Step 1: Add 4-shot fixture**

Fixture requirements:
- exact timecodes
- Character 1 + Character 2 separate IDs
- one Black recurring character with explicit complexion reference
- recurring white piano + microphone/equipment across character changes
- explicit camera directions
- one on-screen text cue

- [ ] **Step 2: Test cross-service invariants**

Reject responses that:
- change shot count/IDs/times/source text
- swap `char-1`/`char-2`
- introduce nightclub/neon/stage filler
- introduce unselected people from a project anchor

Accept concise approved piano/microphone continuity.

- [ ] **Step 3: Update workflow branch trigger**

Add `feature/videodb-scriptlocked-director`.

- [ ] **Step 4: Add Python CI steps**

```yaml
- name: Use Python 3.11
  uses: actions/setup-python@v5
  with:
    python-version: "3.11"
- name: Install Script-Locked Director dependencies
  run: pip install -r services/videodb-director/requirements.txt
- name: Script-Locked Director Python tests
  run: python -m pytest services/videodb-director/tests -q
```

- [ ] **Step 5: Extend Director regression command**

Include new Node/web tests while retaining existing Vision, character identity, continuity, chat, and generation regressions until equivalent coverage is proven.

- [ ] **Step 6: Run final local-equivalent gate**

```bash
python -m pytest services/videodb-director/tests -q
npx tsx --test apps/web/src/lib/directorVisionParser.test.ts apps/web/src/lib/directorAgentVision.test.ts apps/web/src/lib/directorCharacterState.test.ts apps/web/src/lib/directorCharacterMedia.test.ts apps/web/src/lib/directorContinuityLock.test.ts apps/web/src/lib/directorScriptLocked.test.ts apps/web/src/lib/directorScriptLockedGeneration.test.ts apps/web/src/components/ScriptLockedDirectorAgent.test.ts apps/api/src/director_scriptlocked.test.ts
npm run build
```

- [ ] **Step 7: Commit**

```bash
git add .github/workflows services/videodb-director/tests apps/api/src apps/web/src
git commit -m "test: gate Script-Locked Director across Python and Node"
```

---

### Task 8: Two-service Render rollout, production switch, and rollback verification

**Interfaces:** fully green final branch -> PR -> production Node service + new Python reasoning service.

- [ ] **Step 1: Fresh verification and production-base comparison**

Require Python tests, all Director regressions, and full `npm run build` GREEN on final head. Compare against current `backup-pre-rollback-1890d80`; if production moved, incorporate it and rerun all gates before PR.

- [ ] **Step 2: Create Python Render service**

```text
Name: scriptlocked-director
Runtime: Python
Branch: backup-pre-rollback-1890d80 after merge
Build: cd services/videodb-director && pip install -r requirements.txt
Start: cd services/videodb-director && gunicorn -b 0.0.0.0:$PORT app:app
Health: /health
```

Environment:

```text
DIRECTOR_REASONING_TOKEN=<generated strong service secret>
GOOGLEAI_API_KEY=<approved Gemini key>
GOOGLEAI_CHAT_MODEL=<currently verified supported model>
```

No `AGNES_API_KEY` and no VideoDB media/storage credentials.

- [ ] **Step 3: Verify reasoning service before enabling browser path**

Observe:
- `/health` HTTP 200
- unauthenticated `/v1/compile` HTTP 401
- authenticated fixture compile exact source invariants
- no generation/provider calls

- [ ] **Step 4: Configure existing Node service with Script-Locked API enabled but UI off**

```text
DIRECTOR_REASONING_URL=<Python service URL>
DIRECTOR_REASONING_TOKEN=<same token>
DIRECTOR_SCRIPTLOCKED_ENABLED=true
VITE_SCRIPTLOCKED_DIRECTOR_ENABLED=false
```

Remember Vite flag is build-time; changing it requires web rebuild/redeploy.

- [ ] **Step 5: Open PR to `backup-pre-rollback-1890d80`**

Title: `Replace Director with VideoDB Script-Locked Agnes compiler`

PR body includes pinned upstream/license, stock-agent exclusions, fidelity contract, Node fallback, no auto-generation, test/build evidence, and rollback flag.

- [ ] **Step 6: Require independent PR CI and true-merge verified head**

Merge method `merge`, with expected head SHA locked. Do not squash/rebase.

- [ ] **Step 7: Verify exact merge commit LIVE on both services**

Existing Node service stays on branch `backup-pre-rollback-1890d80`. Python service deploys the same repository merge commit. Observe both deployment statuses and `/health` responses before switching UI.

- [ ] **Step 8: Enable new product Director**

Set/redeploy:

```text
VITE_SCRIPTLOCKED_DIRECTOR_ENABLED=true
```

Verify `✦ Director` opens `ScriptLockedDirectorAgent`, only one `mvs-open-ltx-director` listener is active, and **Open Assisted Director** explicitly opens legacy only for general prose/migration use.

- [ ] **Step 9: Smoke test without credits**

For a structured project:
- exact shot count/times/source shown
- compile instructions
- no invented treatment/palette/scene filler
- Character 1/2 refs separate
- concise continuity
- existing approved media retained
- edit one instruction; only target changes
- stop before Generate/Regenerate

- [ ] **Step 10: Verify rollback without data loss**

Set `VITE_SCRIPTLOCKED_DIRECTOR_ENABLED=false`, redeploy, confirm legacy opens and Script-Locked session data remains untouched. Restore `true` and redeploy. This rollback is operational only; Script-Locked request failures never auto-route to legacy.

- [ ] **Step 11: Update spec status after successful live verification**

Record exact production merge SHA, both Render service/deploy IDs, observed health results, and final CI run.

- [ ] **Step 12: Completion gate**

Use `superpowers:verification-before-completion` before claiming success. Re-check exact production SHA, both LIVE deployments, feature flag true, health observations, and that automated verification spent no generation credits.

---

## Self-Review Results

**Spec coverage:** all approved architecture requirements map to Tasks 1–8, including pinned VideoDB source, Script-Locked compilation, target edits, Node validation/fallback, general-prose separation, migration, Agnes handoff, continuity, CI, deployment, and rollback.

**Type consistency:** Python/Node/web use the same fields: `clipId`, `start`, `end`, `sourceText`, `agnesPrompt`, `selectedCharacterIds`, `selectedReferenceIds`, `continuityConstraints`, `compilerNotes`. Edit responses preserve immutable source fields.

**Safety corrections incorporated:** string `"false"` cannot enable the Node feature flag; non-timecoded general prose cannot silently enter Script-Locked compilation and instead requires an explicit Assisted Director action.

**Placeholder scan:** no implementation placeholder remains. If execution discovers a required interface change, stop that task, update the spec/plan deliberately, and re-review before continuing.
