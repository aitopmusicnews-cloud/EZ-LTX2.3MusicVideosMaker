# VideoDB Script-Locked Director Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the structured-timecode Director planner with a pinned VideoDB Director-based `ScriptLockedAgnesAgent` that preserves exact user shot facts and produces precise, editable Agnes instructions without generic creative rewriting.

**Architecture:** Keep the React editor, Node/Fastify gateway, existing reference/approval state, Agnes generation, stitching, and render pipeline. Add an authenticated Python service under `services/videodb-director/` containing a pinned/adapted subset of `video-db/Director@70e0b3dfdf59c679a25f4bea511e3cc4c5f2457f`; structured compile/edit flows go Node -> Python -> strict Node validation. Compile-only outages may use a deterministic Node script-preserving fallback. A new `ScriptLockedDirectorAgent` owns structured Vision; non-timecoded prose can explicitly open the legacy Assisted Director during rollout.

**Tech Stack:** React 19, TypeScript 5.6, Node 22, Fastify, Zod, Python 3.11.9, Flask 3.0.3, Gunicorn, Pydantic 2.8.2, VideoDB Director agent/LLM abstractions, Google Gemini through VideoDB Director’s Google/OpenAI-compatible adapter, GitHub Actions, Render.

**Spec:** `docs/superpowers/specs/2026-09-03-videodb-scriptlocked-director-replacement-design.md`

## Global Constraints

- Production target stays `backup-pre-rollback-1890d80`; never switch the existing Render service to `main`.
- Pin upstream VideoDB Director to `70e0b3dfdf59c679a25f4bea511e3cc4c5f2457f`; no floating upstream dependency or production-time clone.
- Preserve upstream MIT attribution.
- Structured Vision is authoritative: shot count, `clipId`, `start`, `end`, `sourceText` are immutable.
- Director may reorder/clarify existing shot facts only; it may not invent people, locations, props, equipment, wardrobe, lighting, palettes, camera moves, story beats, text/dialogue, or transitions.
- Do not register stock `TextToMovieAgent`, stock `ChatHandler`, stock search/media agents, or stock generation engines.
- Python receives no Agnes credentials and requires no VideoDB storage/collection.
- Browser calls Node only; Node calls Python with a bearer token.
- Compile outage/timeout may use literal Node fallback; edit outage returns 503. Validation/conflict errors never fall back.
- Old Gemini/local generic planning is not an automatic Script-Locked fallback.
- Existing approved/generated media remains; migration recompiles text only and never regenerates media automatically.
- Keep existing reference kinds: `character | style | location | shot | note`. Do not add `prop`/`equipment` kinds in this replacement. Prop/equipment continuity comes from source text, approved reference descriptions, and approved shot/project image anchors.
- Continuity remains hardwired but concise: identity/skin tone, wardrobe, props/equipment, vehicles/instruments, recurring set details.
- Compile/edit/reference/migration/approval actions never invoke providers.
- No real Agnes generation in CI or automated smoke verification.
- Legacy Director is available only through explicit Assisted Director / rollback behavior during migration.

---

## Shared Contracts

These names and fields are fixed across Python, Node, and web.

### Reference

```ts
type ScriptLockedReference = {
  id: string;
  kind: "character" | "style" | "location" | "shot" | "note";
  name: string;
  description: string;
};
```

### Immutable source shot

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

### Compile request/response

```ts
type ScriptLockedCompileRequest = {
  projectId: string;
  visionMode: "structured";
  shots: ScriptLockedShot[];
  references: ScriptLockedReference[];
  mustInclude: string;
  avoid: string;
};

type ScriptLockedCompiledShot = {
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

type ScriptLockedCompileResponse = {
  compiler: "videodb-scriptlocked-agnes-v1" | "node-script-preserving-fallback-v1";
  shots: ScriptLockedCompiledShot[];
};
```

### Edit request/response

```ts
type ScriptLockedEditRequest = {
  projectId: string;
  target: "agnes_instruction";
  clipId: string;
  start: number;
  end: number;
  sourceText: string;
  currentAgnesPrompt: string;
  selectedCharacterIds: string[];
  selectedReferenceIds: string[];
  continuityConstraints: string[];
  userMessage: string;
};

type ScriptLockedEditResponse = {
  clipId: string;
  start: number;
  end: number;
  sourceText: string;
  agnesPrompt: string;
  compilerNotes: string[];
};
```

---

### Task 1: Vendor minimal VideoDB Director core and create the authenticated Python shell

**Files:**
- Create: `services/videodb-director/.python-version`
- Create: `services/videodb-director/requirements.txt`
- Create: `services/videodb-director/LICENSE.upstream`
- Create: `services/videodb-director/UPSTREAM.md`
- Create: `services/videodb-director/app.py`
- Create: `services/videodb-director/director/agents/base.py`
- Create: `services/videodb-director/director/llm/base.py`
- Create: `services/videodb-director/director/llm/googleai.py`
- Create: `services/videodb-director/director/core/session.py`
- Create: `services/videodb-director/director/core/reasoning.py`
- Test: `services/videodb-director/tests/test_app.py`

**Interfaces:** Produces Flask `create_app()`, public `/health`, authenticated `/v1/compile` and `/v1/edit` route shells, and VideoDB-compatible agent/LLM/session/reasoning interfaces used by Tasks 2–3.

- [ ] **Step 1: Write the failing auth/health test**

```python
from app import create_app


def make_client(monkeypatch):
    monkeypatch.setenv("DIRECTOR_REASONING_TOKEN", "test-token")
    return create_app().test_client()


def test_health(monkeypatch):
    response = make_client(monkeypatch).get("/health")
    assert response.status_code == 200
    assert response.get_json() == {"ok": True, "service": "videodb-scriptlocked-director"}


def test_compile_requires_bearer(monkeypatch):
    response = make_client(monkeypatch).post("/v1/compile", json={})
    assert response.status_code == 401
    assert response.get_json()["error"] == "unauthorized"
```

- [ ] **Step 2: Run RED**

```bash
cd services/videodb-director
python -m pytest tests/test_app.py -q
```

Expected: import/file failure.

- [ ] **Step 3: Add pinned runtime/dependencies**

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

The VideoDB-derived versions match the pinned upstream backend where applicable.

- [ ] **Step 4: Add upstream attribution**

Copy the upstream MIT `LICENSE` verbatim to `LICENSE.upstream`. Create `UPSTREAM.md` with exact repo, pinned commit, reused files, and local changes.

- [ ] **Step 5: Vendor/adapt minimal abstractions**

Preserve these interfaces:

```python
class AgentStatus:
    SUCCESS = "success"
    ERROR = "error"

class AgentResponse(BaseModel):
    status: str = AgentStatus.SUCCESS
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

Adapt reasoning/session code so it never accesses VideoDB collection/media state, sockets, or DB persistence.

- [ ] **Step 6: Add Flask shell**

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

### Task 2: Implement immutable models, concise continuity, fidelity guard, and `ScriptLockedAgnesAgent`

**Files:**
- Create: `services/videodb-director/scriptlocked/models.py`
- Create: `services/videodb-director/scriptlocked/continuity.py`
- Create: `services/videodb-director/scriptlocked/fidelity.py`
- Create: `services/videodb-director/scriptlocked/llm.py`
- Create: `services/videodb-director/scriptlocked/agent.py`
- Create: `services/videodb-director/scriptlocked/service.py`
- Test: `services/videodb-director/tests/test_compile.py`
- Modify: `services/videodb-director/app.py`

**Interfaces:** `compile_project(request: CompileRequest) -> CompileResponse`, `ReasonerUnavailable`.

- [ ] **Step 1: Write failing compile tests with a fully defined fixture**

```python
import pytest
from scriptlocked.models import CompileRequest
from scriptlocked.service import compile_project


def request_fixture():
    return CompileRequest.model_validate({
        "projectId": "proj-1",
        "visionMode": "structured",
        "shots": [{
            "clipId": "vision-shot-1",
            "start": 12.0,
            "end": 18.0,
            "sourceText": "Character 1 walks from the white piano to the window. Camera tracks right. Red suit. Microphone stays on piano.",
            "visualDirection": "Character 1 walks from the white piano to the window. Red suit. Microphone stays on piano.",
            "cameraDirection": "Camera tracks right.",
            "audioCue": "",
            "onScreenText": "",
            "selectedCharacterIds": ["char-1"],
            "selectedReferenceIds": ["char-1", "piano-shot-ref"],
        }],
        "references": [
            {"id": "char-1", "kind": "character", "name": "Character 1", "description": "Black woman in red suit"},
            {"id": "piano-shot-ref", "kind": "shot", "name": "Approved piano setup", "description": "white grand piano with silver microphone"},
        ],
        "mustInclude": "",
        "avoid": "",
    })


def test_compile_preserves_immutable_source(monkeypatch):
    monkeypatch.setenv("SCRIPTLOCKED_TEST_RESPONSE", "Character 1 walks from the white piano to the window while the camera tracks right. She wears the same red suit. The microphone remains on the piano.")
    source = request_fixture().shots[0]
    output = compile_project(request_fixture()).shots[0]
    assert (output.clipId, output.start, output.end, output.sourceText) == (source.clipId, source.start, source.end, source.sourceText)


def test_compile_rejects_invented_nightclub(monkeypatch):
    monkeypatch.setenv("SCRIPTLOCKED_TEST_RESPONSE", "In a neon nightclub, Character 1 walks from the piano to the window.")
    with pytest.raises(ValueError, match="unsupported addition"):
        compile_project(request_fixture())
```

- [ ] **Step 2: Run RED**

```bash
cd services/videodb-director && python -m pytest tests/test_compile.py -q
```

- [ ] **Step 3: Implement Pydantic models matching Shared Contracts**

Use aliases exactly as shown (`clipId`, `sourceText`, etc.) so Node/Python payloads need no translation layer.

- [ ] **Step 4: Build concise continuity constraints**

```python
def build_continuity_constraints(shot, references) -> list[str]:
    by_id = {ref.id: ref for ref in references}
    constraints = []
    for character_id in shot.selectedCharacterIds:
        ref = by_id.get(character_id)
        if ref:
            constraints.append(f"Match {ref.name} / {ref.id} exactly: same identity, skin tone/complexion, face, hair, wardrobe, jewelry, and accessories unless this shot explicitly changes them.")
    return constraints
```

Use selected `shot`/`note` reference descriptions and approved project anchors for recurring props/equipment; do not add new reference kinds.

- [ ] **Step 5: Add deterministic generic-addition guard**

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

Also reject unknown reference IDs and any changed immutable source field.

- [ ] **Step 6: Implement agent system instruction**

```python
SCRIPT_LOCKED_SYSTEM = """
You are ScriptLockedAgnesAgent, an execution-prompt compiler for Agnes video generation.
The current timecoded shot is the source of truth.
Reorder and clarify the same visible facts into chronological Agnes-friendly language only.
Never add a person, location, prop, wardrobe/equipment item, vehicle, instrument, lighting concept, palette, weather, time of day, camera move, story beat, dialogue, on-screen text, or transition not present in the current shot or supplied approved continuity facts.
Never add generic cinematic filler unless the user wrote it.
Return only the compiled Agnes prompt text.
""".strip()
```

Compile one shot at a time; never pass the full script as creative context for the current shot.

- [ ] **Step 7: Add LLM selection and deterministic test LLM**

```python
class ReasonerUnavailable(RuntimeError):
    pass


def get_scriptlocked_llm():
    if "SCRIPTLOCKED_TEST_RESPONSE" in os.environ:
        return StaticTestLLM(os.environ["SCRIPTLOCKED_TEST_RESPONSE"])
    if not os.getenv("GOOGLEAI_API_KEY"):
        raise ReasonerUnavailable("GOOGLEAI_API_KEY is not configured")
    return GoogleAI()
```

- [ ] **Step 8: Implement direct compile path and route**

`compile_project()` loops shots and directly invokes `ScriptLockedAgnesAgent`; authoritative compile does not ask a reasoner to choose an agent. `/v1/compile` maps valid=200, fidelity/validation=422, reasoner unavailable=503.

- [ ] **Step 9: Run GREEN and commit**

```bash
cd services/videodb-director && python -m pytest tests/test_app.py tests/test_compile.py -q
cd ../..
git add services/videodb-director
git commit -m "feat: add Script-Locked Agnes compile agent"
```

---

### Task 3: Add target-locked VideoDB reasoning for instruction edits

**Files:** modify Python models/reasoning/agent/service/app; create `tests/test_edit.py`.

**Interfaces:** `edit_instruction(request: EditRequest) -> EditResponse`; exactly one registered tool `script_locked_agnes`.

- [ ] **Step 1: Write failing target/conflict tests**

```python
def edit_fixture(message: str):
    return {
        "projectId": "proj-1",
        "target": "agnes_instruction",
        "clipId": "vision-shot-1",
        "start": 12.0,
        "end": 18.0,
        "sourceText": "Character 1 walks to the window in a red suit. Camera tracks right.",
        "currentAgnesPrompt": "Character 1 walks to the window in the red suit while the camera tracks right.",
        "selectedCharacterIds": ["char-1"],
        "selectedReferenceIds": ["char-1"],
        "continuityConstraints": ["Match Character 1 exactly."],
        "userMessage": message,
    }


def test_timing_change_is_conflict(client, auth_headers):
    response = client.post("/v1/edit", headers=auth_headers, json=edit_fixture("Change this to 00:30-00:40"))
    assert response.status_code == 409


def test_locked_red_suit_change_is_conflict(client, auth_headers):
    response = client.post("/v1/edit", headers=auth_headers, json=edit_fixture("Change the red suit to blue"))
    assert response.status_code == 409
```

- [ ] **Step 2: Run RED**

```bash
cd services/videodb-director && python -m pytest tests/test_edit.py -q
```

- [ ] **Step 3: Implement EditRequest/EditResponse from Shared Contracts**

- [ ] **Step 4: Replace generic VideoDB reasoning prompt**

```text
You edit exactly one Script-Locked Agnes instruction.
You have exactly one tool: script_locked_agnes.
Never change clipId, start, end, or sourceText.
Never operate on another clip.
If the edit contradicts locked source facts, return locked_source_conflict.
Never invoke media generation.
```

Remove stock collection/upload/search behavior.

- [ ] **Step 5: Add deterministic preflight conflicts**

Reject different timecodes, explicit replacement of a locked wardrobe/color fact, or explicit addition of a person/location/prop absent from source/reference facts. Return HTTP 409 before LLM call.

- [ ] **Step 6: Run narrow reasoning loop and post-validate**

Register only `ScriptLockedAgnesAgent`, pass one clip, validate immutable fields and unsupported additions after response.

- [ ] **Step 7: Run GREEN and commit**

```bash
cd services/videodb-director && python -m pytest -q
cd ../..
git add services/videodb-director
git commit -m "feat: add target-locked Director instruction editing"
```

---

### Task 4: Add Node strict contracts, authenticated bridge, safe flags, and literal compile fallback

**Files:**
- Create: `apps/api/src/director_scriptlocked_contract.ts`
- Create: `apps/api/src/director_scriptlocked_fallback.ts`
- Create: `apps/api/src/director_scriptlocked_client.ts`
- Test: `apps/api/src/director_scriptlocked.test.ts`
- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/src/server.ts`

**Interfaces:** `compileScriptLockedDirector`, `editScriptLockedDirector`, `/api/director/scriptlocked/compile`, `/api/director/scriptlocked/edit`.

- [ ] **Step 1: Write failing Node tests with inline fixtures**

```ts
const request = {
  projectId: "proj-1",
  visionMode: "structured" as const,
  shots: [{ clipId: "vision-shot-1", start: 12, end: 18, sourceText: "Character 1 walks to the window. Camera tracks right.", visualDirection: "Character 1 walks to the window.", cameraDirection: "Camera tracks right.", audioCue: "", onScreenText: "", selectedCharacterIds: ["char-1"], selectedReferenceIds: ["char-1"] }],
  references: [{ id: "char-1", kind: "character" as const, name: "Character 1", description: "Black woman in red suit" }],
  mustInclude: "",
  avoid: "",
};

test("rejects changed end time", () => {
  const response = { compiler: "videodb-scriptlocked-agnes-v1" as const, shots: [{ ...request.shots[0], end: 19, agnesPrompt: "Character 1 walks to the window.", continuityConstraints: [], compilerNotes: [] }] };
  assert.throws(() => validateCompileResponse(request, response), /exact source/i);
});

test("literal fallback has no generic filler", () => {
  const prompt = buildScriptPreservingFallback(request).shots[0]!.agnesPrompt;
  assert.match(prompt, /walks to the window/i);
  assert.match(prompt, /camera tracks right/i);
  assert.doesNotMatch(prompt, /cinematic|masterful|neon|dramatic lighting/i);
});
```

- [ ] **Step 2: Run RED**

```bash
npx tsx --test apps/api/src/director_scriptlocked.test.ts
```

- [ ] **Step 3: Implement Zod schemas from Shared Contracts**

`validateCompileResponse(request,response)` rejects changed/missing/duplicate/renamed clip IDs, changed times/source text, unknown returned reference/character IDs, and empty prompt.

- [ ] **Step 4: Implement literal fallback**

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

Never call old `createDirectorPlan()`.

- [ ] **Step 5: Add safe env boolean**

```ts
const envBoolean = z.preprocess((value) => {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false" || normalized === "") return false;
  }
  return value;
}, z.boolean());
```

Add `DIRECTOR_REASONING_URL`, `DIRECTOR_REASONING_TOKEN`, `DIRECTOR_SCRIPTLOCKED_ENABLED: envBoolean.default(false)`. Do not use `z.coerce.boolean()`.

- [ ] **Step 6: Implement authenticated Python client**

120s timeout. Network/timeout/503 reasoner-unavailable -> compile fallback. HTTP 409/422 -> propagate. Edit outage -> 503, no guessed edit.

- [ ] **Step 7: Add Node routes**

When flag false, return 404 Script-Locked disabled. Keep legacy `/api/director/plan` only for explicit Assisted/rollback UI.

- [ ] **Step 8: Run GREEN and commit**

```bash
npx tsx --test apps/api/src/director_scriptlocked.test.ts
npm run typecheck --workspace @mvs/api
git add apps/api/src
git commit -m "feat: bridge Node API to Script-Locked Director"
```

---

### Task 5: Build `ScriptLockedDirectorAgent`, migrate existing media, and separate general prose

**Files:**
- Create: `apps/web/src/lib/directorScriptLocked.ts`
- Create: `apps/web/src/lib/directorScriptLockedClient.ts`
- Test: `apps/web/src/lib/directorScriptLocked.test.ts`
- Create: `apps/web/src/components/ScriptLockedDirectorAgent.tsx`
- Test: `apps/web/src/components/ScriptLockedDirectorAgent.test.ts`
- Create: `apps/web/scripts/scriptlocked-director-launcher.patch.mjs`
- Modify: existing web prebuild entrypoint.

**Interfaces:** `ScriptLockedDirectorSessionV1`; events `mvs-open-ltx-director` and `mvs-open-assisted-director`.

- [ ] **Step 1: Write failing source/migration tests**

```ts
test("timecoded Vision yields exact source shots", () => {
  const shots = buildScriptLockedShots(`00:12–00:18\nShot 1: Character 1 walks to the window.\nCamera: track right.\n00:18–00:23\nShot 2: Character 2 remains at the piano.`, []);
  assert.equal(shots.length, 2);
  assert.deepEqual([shots[0]!.start, shots[0]!.end], [12, 18]);
});

test("migration retains media but not legacy prompt", () => {
  const migrated = migrateLegacyDirectorAssets({ shotApprovals: { "vision-shot-1": { url: "/old.png", approved: true } }, sceneApprovals: {}, sectionApprovals: { "vision-shot-1": { url: "/old.mp4", approved: true } }, legacyPlan: { shots: [{ clipId: "vision-shot-1", prompt: "generic" }] } });
  assert.equal(migrated.shotApprovals["vision-shot-1"]!.url, "/old.png");
  assert.equal(migrated.sectionApprovals["vision-shot-1"]!.url, "/old.mp4");
  assert.equal(migrated.compiledByClip["vision-shot-1"], undefined);
});
```

- [ ] **Step 2: Run RED**

```bash
npx tsx --test apps/web/src/lib/directorScriptLocked.test.ts
```

- [ ] **Step 3: Define session model**

```ts
type ScriptLockedDirectorSessionV1 = {
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

Do not migrate legacy `shot.prompt` into compiled output.

- [ ] **Step 4: Add API client and component UI**

Fixed UI order: **Script -> References -> Agnes Instructions -> Generate**. Show exact source, compiled prompt, selected refs, concise continuity, and `Script locked` status. No mandatory treatment/palette/scene-board approval.

- [ ] **Step 5: Separate general prose**

If parser mode is `general`, show:

```text
Script-Locked Director needs timecoded shots. Add timecodes to use the Agnes compiler, or open Assisted Director for non-timecoded planning.
```

`Open Assisted Director` dispatches `mvs-open-assisted-director`; no automatic analyzer/generic planning occurs in Script-Locked component.

- [ ] **Step 6: Make launcher ownership exclusive**

When `VITE_SCRIPTLOCKED_DIRECTOR_ENABLED === "true"`, new component owns `mvs-open-ltx-director`; legacy listens only to `mvs-open-assisted-director`. When false, legacy owns `mvs-open-ltx-director` and new listener is inactive. Launcher patch changes event ownership only, not planning logic.

- [ ] **Step 7: Migrate approvals/media without provider calls**

Copy matching approved scene/shot/section media and character approvals/selections by `clipId`. Leave compiled prompt empty until explicit Compile.

- [ ] **Step 8: Add target edit chat**

Send only one immutable shot/current prompt to Node edit route; accept only exact `clipId/start/end/sourceText`. No provider calls.

- [ ] **Step 9: Add UI source regressions**

Assert `Script locked`, exact source display, `Compile Agnes instructions`, no mandatory treatment, no `Cinematic scene board`, general prose assisted option, no provider call in compile/edit handlers.

- [ ] **Step 10: Run GREEN and commit**

```bash
npx tsx --test apps/web/src/lib/directorScriptLocked.test.ts apps/web/src/components/ScriptLockedDirectorAgent.test.ts
npm run typecheck --workspace @mvs/web
git add apps/web/src apps/web/scripts
git commit -m "feat: add Script-Locked Director interface"
```

---

### Task 6: Send compiled prompt directly to Agnes with concise continuity and existing seed rules

**Files:**
- Create: `apps/web/src/lib/directorScriptLockedGeneration.ts`
- Test: `apps/web/src/lib/directorScriptLockedGeneration.test.ts`
- Modify: `ScriptLockedDirectorAgent.tsx`

**Interfaces:** `buildAgnesGenerationInstruction({ agnesPrompt, continuityConstraints }): string`.

- [ ] **Step 1: Write failing handoff test**

```ts
test("compiled shot stays first and legacy filler is absent", () => {
  const prompt = buildAgnesGenerationInstruction({ agnesPrompt: "Character 1 walks from the white piano to the window while the camera tracks right.", continuityConstraints: ["Match Character 1 exactly: same complexion and red suit."] });
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

- [ ] **Step 4: Preserve reference/seed order**

Image/edit refs: existing target image -> selected named characters -> prior same-character approved anchor -> approved project shot anchor, deduped. Agnes video uses approved current shot image as the single preferred seed. Character-required shot without approved shot image is blocked. Do not change Agnes raw seed contract.

- [ ] **Step 5: Keep generation explicit and long-section content identical**

Only Generate/Regenerate buttons call providers. Every technical segment of a long section gets the same compiled instruction + seed lineage; segmentation changes duration only.

- [ ] **Step 6: Run GREEN and commit**

```bash
npx tsx --test apps/web/src/lib/directorScriptLockedGeneration.test.ts apps/web/src/lib/directorGeneration.test.ts apps/web/src/lib/directorCharacterMedia.test.ts apps/web/src/lib/directorContinuityLock.test.ts
git add apps/web/src
git commit -m "feat: send Script-Locked instructions directly to Agnes"
```

---

### Task 7: Add realistic cross-service fixture and CI gates

**Files:** Python fixture/tests, extend Node tests, modify `.github/workflows/build-check.yml`.

- [ ] **Step 1: Add 4-shot fixture**

Must contain exact timecodes, two separate characters, one recurring Black character with explicit identity description, recurring white piano + silver microphone across character changes, explicit camera moves, and one on-screen text cue. References use only existing kinds (`character`, `shot`, `note`, etc.).

- [ ] **Step 2: Add invariant tests**

Reject changed IDs/times/source, swapped character refs, generic nightclub/neon/stage additions, or unselected people imported from a project anchor. Accept concise piano/microphone continuity.

- [ ] **Step 3: Add feature branch to workflow trigger**

Add `feature/videodb-scriptlocked-director`.

- [ ] **Step 4: Add Python CI**

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

- [ ] **Step 5: Add new Node/web tests while retaining relevant old regressions**

Include Script-Locked contract/UI/generation tests and keep Vision parser, script-lock, multi-character, continuity, chat, and generation regressions until replacement coverage is proven.

- [ ] **Step 6: Run full gate**

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

### Task 8: Deploy Python service, merge, switch product Director, and verify rollback

**Interfaces:** fully green branch -> PR -> existing Node Render service + new Python Render service.

- [ ] **Step 1: Fresh final verification and production-base comparison**

Require all Python tests, Director regressions, and `npm run build` GREEN on final head. If `backup-pre-rollback-1890d80` moved, incorporate it and rerun before PR.

- [ ] **Step 2: Create Render Python service**

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
DIRECTOR_REASONING_TOKEN=<strong generated service secret>
GOOGLEAI_API_KEY=<approved Gemini key>
GOOGLEAI_CHAT_MODEL=<verified currently supported model>
```

Do not set Agnes or VideoDB media/storage credentials.

- [ ] **Step 3: Verify Python service before UI enablement**

Observe `/health` 200, unauthenticated compile 401, authenticated fixture compile exact invariants, and no generation calls.

- [ ] **Step 4: Configure existing Node service with API enabled and UI off**

```text
DIRECTOR_REASONING_URL=<Python URL>
DIRECTOR_REASONING_TOKEN=<same token>
DIRECTOR_SCRIPTLOCKED_ENABLED=true
VITE_SCRIPTLOCKED_DIRECTOR_ENABLED=false
```

Vite flag is build-time and requires redeploy to switch.

- [ ] **Step 5: Open PR to production branch**

Title: `Replace Director with VideoDB Script-Locked Agnes compiler`.

PR body includes upstream pin/license, stock-agent exclusions, fidelity contract, fallback behavior, no auto-generation, test/build evidence, and rollback behavior.

- [ ] **Step 6: Require independent PR CI and true merge**

Use merge method `merge`, expected head SHA locked; no squash/rebase.

- [ ] **Step 7: Verify exact merge SHA LIVE on both services**

Existing Node service remains on `backup-pre-rollback-1890d80`. Python service deploys the same repository merge SHA. Observe deploy status and health before enabling UI.

- [ ] **Step 8: Enable Script-Locked product Director**

Set/redeploy `VITE_SCRIPTLOCKED_DIRECTOR_ENABLED=true`. Verify `✦ Director` opens new component, one launcher listener only, and explicit Assisted Director opens legacy for general prose.

- [ ] **Step 9: Smoke test without generation credits**

Structured project: exact shots/times/source; compile; no invented treatment/palette; character refs separate; concise continuity; approved media retained; edit one instruction only; stop before Generate/Regenerate.

- [ ] **Step 10: Verify rollback without data loss**

Set UI flag false/redeploy; legacy opens and Script-Locked session data remains. Restore true/redeploy. Never auto-route Script-Locked failures to legacy.

- [ ] **Step 11: Update spec status only after live verification**

Record exact merge SHA, both Render service/deploy IDs, observed health, and final CI run.

- [ ] **Step 12: Completion gate**

Use `superpowers:verification-before-completion`; re-check exact production SHA, both LIVE deployments, UI flag true, health observations, and no automated generation credits spent.

---

## Self-Review

- **Spec coverage:** Tasks 1–8 cover pinned VideoDB integration, no stock generic agents, exact script fidelity, compile/edit contracts, Node fail-closed bridge/fallback, general-prose separation, migration, direct Agnes handoff, continuity, CI, two-service rollout, and rollback.
- **Type consistency:** Shared Contracts define every cross-task payload and use only existing reference kinds.
- **Safety corrections:** Node string `"false"` cannot enable the flag; general prose cannot silently enter Script-Locked mode; compile fallback is literal only; edit has no guessed fallback.
- **Placeholder scan:** no `TODO`, `TBD`, undefined test fixture helper, or unspecified neighboring interface remains.
