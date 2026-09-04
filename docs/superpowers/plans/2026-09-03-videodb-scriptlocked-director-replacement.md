# VideoDB Script-Locked Director Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the structured-timecode Director planner with a pinned VideoDB Director-based Script-Locked Agnes compiler that preserves the user’s exact shot facts and hands Agnes precise, editable execution instructions without generic creative rewriting.

**Architecture:** Keep the existing React editor, Node/Fastify gateway, Agnes provider integration, stitching, approvals, and render pipeline. Add a separate authenticated Python service under `services/videodb-director/` containing a pinned vendored subset of `video-db/Director@70e0b3dfdf59c679a25f4bea511e3cc4c5f2457f`, plus a custom `ScriptLockedAgnesAgent`; route structured Vision compile/edit requests through Node to that service, validate them fail-closed, and use a deterministic script-preserving Node fallback when the Python reasoner is unavailable. Introduce a new `ScriptLockedDirectorAgent` UI instead of extending the legacy Director patch stack, and keep the previous Director behind a rollback feature flag until rollout is complete.

**Tech Stack:** React 19, TypeScript 5.6, Fastify, Zod, Node 22, Python 3.11, Flask, Gunicorn, Pydantic v2, VideoDB Director agent/LLM abstractions, Gemini through VideoDB Director’s Google/OpenAI-compatible adapter, GitHub Actions, Render.

**Spec:** `docs/superpowers/specs/2026-09-03-videodb-scriptlocked-director-replacement-design.md`

## Global Constraints

- Production base remains `backup-pre-rollback-1890d80`; do not retarget the existing Render service to `main`.
- Upstream VideoDB Director baseline is pinned to `70e0b3dfdf59c679a25f4bea511e3cc4c5f2457f`; do not clone or execute floating upstream `main` during production builds.
- Preserve the upstream MIT license/copyright notice for reused source.
- Structured timecoded Vision is authoritative: exact shot count, `clipId`, `start`, `end`, and `sourceText` are immutable.
- `ScriptLockedAgnesAgent` may clarify/reorder the same facts for Agnes but may not invent people, locations, props, wardrobe, equipment, lighting, palettes, camera moves, story beats, text, dialogue, or transitions.
- VideoDB’s stock `TextToMovieAgent`, stock `ChatHandler`, stock web-search/media agents, and stock video generation engines are not registered for this workflow.
- The Python service does not receive Agnes credentials and does not require VideoDB storage/collections.
- Browser calls only the Node API; Node calls Python with a service-to-service bearer token.
- If Python reasoning is unavailable or invalid, structured mode falls back only to a deterministic script-preserving compiler in Node; never fall back to the old generic Gemini/local-treatment planner.
- Existing approved/generated images and clips are retained; migration recompiles instruction text only and never regenerates media automatically.
- Character identity, skin tone/complexion, wardrobe, props, equipment, vehicles/instruments, and recurring set continuity stay enforced, but continuity text must remain concise and shot-specific.
- Planning, compile, chat, migration, and approval operations never call Agnes or image generation automatically.
- Do not run real Agnes generations in CI or automated verification.
- Keep the old Director reachable only through an explicit rollback flag during migration; do not use it as a per-request fallback inside Script-Locked mode.

---

## File Map

### New Python service

- `services/videodb-director/.python-version` — pin Python runtime to `3.11.9`.
- `services/videodb-director/requirements.txt` — minimal runtime/test dependencies.
- `services/videodb-director/LICENSE.upstream` — exact upstream MIT license text.
- `services/videodb-director/UPSTREAM.md` — pinned commit, reused files, local modifications.
- `services/videodb-director/app.py` — Flask app factory and `/health`, `/v1/compile`, `/v1/edit` routes.
- `services/videodb-director/director/agents/base.py` — vendored/adapted upstream `BaseAgent`, `AgentStatus`, `AgentResponse`.
- `services/videodb-director/director/llm/base.py` — vendored upstream `BaseLLM`, config, response types.
- `services/videodb-director/director/llm/googleai.py` — vendored/adapted upstream GoogleAI adapter.
- `services/videodb-director/director/core/session.py` — lightweight in-memory session/context models derived from upstream interfaces; no DB/socket/VideoDB media dependency.
- `services/videodb-director/director/core/reasoning.py` — adapted upstream reasoning loop with a Script-Locked system prompt and no media collection assumptions.
- `services/videodb-director/scriptlocked/models.py` — request/response Pydantic contracts.
- `services/videodb-director/scriptlocked/fidelity.py` — immutable-source and unsupported-addition checks.
- `services/videodb-director/scriptlocked/continuity.py` — concise continuity-constraint builder.
- `services/videodb-director/scriptlocked/agent.py` — `ScriptLockedAgnesAgent` compile/edit implementation.
- `services/videodb-director/scriptlocked/llm.py` — provider construction and typed unavailable errors.
- `services/videodb-director/scriptlocked/service.py` — direct compile path and narrow edit reasoning orchestration.
- `services/videodb-director/tests/*` — Python unit/API tests.

### Node API

- `apps/api/src/director_scriptlocked_contract.ts` — Zod request/response schemas and exact-source validation.
- `apps/api/src/director_scriptlocked_fallback.ts` — deterministic script-preserving fallback compiler.
- `apps/api/src/director_scriptlocked_client.ts` — authenticated HTTP client to Python reasoning service.
- `apps/api/src/director_scriptlocked.test.ts` — contract/client/fallback tests.
- `apps/api/src/config.ts` — `DIRECTOR_REASONING_URL`, `DIRECTOR_REASONING_TOKEN`, `DIRECTOR_SCRIPTLOCKED_ENABLED`.
- `apps/api/src/server.ts` — structured compile/edit routes and feature-flag routing.

### Web

- `apps/web/src/lib/directorScriptLocked.ts` — web-facing types, immutable-source helpers, migration helpers.
- `apps/web/src/lib/directorScriptLocked.test.ts` — source preservation/migration tests.
- `apps/web/src/lib/directorScriptLockedClient.ts` — browser API client.
- `apps/web/src/components/ScriptLockedDirectorAgent.tsx` — new structured Director UI.
- `apps/web/src/components/ScriptLockedDirectorAgent.test.ts` — source-code regression/UI behavior tests.
- `apps/web/scripts/scriptlocked-director-launcher.patch.mjs` — minimal launcher switch only; no planning logic patching.
- `apps/web/scripts/build.mjs` or the existing prebuild entrypoint — run the launcher patch after existing legacy patches.

### CI / rollout

- `.github/workflows/build-check.yml` — Python setup/tests plus new Node/web tests and feature branch trigger.
- `docs/superpowers/specs/2026-09-03-videodb-scriptlocked-director-replacement-design.md` — update final status after rollout only.

---

### Task 1: Vendor the minimal VideoDB Director core and stand up the authenticated Python service

**Files:**
- Create: `services/videodb-director/.python-version`
- Create: `services/videodb-director/requirements.txt`
- Create: `services/videodb-director/LICENSE.upstream`
- Create: `services/videodb-director/UPSTREAM.md`
- Create: `services/videodb-director/director/agents/base.py`
- Create: `services/videodb-director/director/llm/base.py`
- Create: `services/videodb-director/director/llm/googleai.py`
- Create: `services/videodb-director/director/core/session.py`
- Create: `services/videodb-director/director/core/reasoning.py`
- Create: `services/videodb-director/app.py`
- Create: `services/videodb-director/tests/test_app.py`

**Interfaces:**
- Produces: Flask `create_app()`, authenticated `/health`, `/v1/compile`, `/v1/edit` route shell.
- Produces: VideoDB-compatible `BaseAgent`, `AgentResponse`, `BaseLLM`, `LLMResponse`, `ContextMessage`, `Session`, `ReasoningEngine` interfaces for Tasks 2–3.
- Consumes: none.

- [ ] **Step 1: Write the failing service/auth tests**

```python
# services/videodb-director/tests/test_app.py
from app import create_app


def client(monkeypatch):
    monkeypatch.setenv("DIRECTOR_REASONING_TOKEN", "test-token")
    return create_app().test_client()


def test_health_is_public(monkeypatch):
    response = client(monkeypatch).get("/health")
    assert response.status_code == 200
    assert response.get_json() == {"ok": True, "service": "videodb-scriptlocked-director"}


def test_compile_rejects_missing_bearer(monkeypatch):
    response = client(monkeypatch).post("/v1/compile", json={})
    assert response.status_code == 401
    assert response.get_json()["error"] == "unauthorized"


def test_compile_accepts_service_token_before_payload_validation(monkeypatch):
    response = client(monkeypatch).post(
        "/v1/compile",
        headers={"Authorization": "Bearer test-token"},
        json={},
    )
    assert response.status_code == 400
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
cd services/videodb-director
python -m pytest tests/test_app.py -q
```

Expected: FAIL because `app.py` and the service package do not exist.

- [ ] **Step 3: Add the Python runtime/dependencies and exact upstream attribution**

`services/videodb-director/.python-version`:

```text
3.11.9
```

`services/videodb-director/requirements.txt`:

```text
Flask==3.1.0
gunicorn==23.0.0
openai==1.68.2
openai-function-calling==2.6.0
pydantic==2.10.6
pydantic-settings==2.8.1
pytest==8.3.5
```

Copy the exact upstream MIT text into `LICENSE.upstream`. In `UPSTREAM.md`, record:

```markdown
# Upstream VideoDB Director

Repository: https://github.com/video-db/Director
Pinned commit: 70e0b3dfdf59c679a25f4bea511e3cc4c5f2457f
License: MIT; see LICENSE.upstream

Reused/adapted modules:
- backend/director/agents/base.py
- backend/director/llm/base.py
- backend/director/llm/googleai.py
- backend/director/core/session.py interface shapes
- backend/director/core/reasoning.py orchestration pattern

Local changes:
- remove VideoDB collection/media state from the session path
- replace stock Director system prompt with Script-Locked rules
- register only ScriptLockedAgnesAgent
- expose a small authenticated HTTP compile/edit service
```

- [ ] **Step 4: Vendor/adapt the minimal core**

Preserve upstream copyright/license comments in copied modules. Keep these required signatures:

```python
# director/agents/base.py
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
```

```python
# director/core/session.py
class RoleTypes(str, Enum):
    system = "system"
    user = "user"
    assistant = "assistant"
    tool = "tool"

class ContextMessage(BaseModel):
    content: str | list[dict] | None = None
    tool_calls: list[dict] | None = None
    tool_call_id: str | None = None
    role: RoleTypes = RoleTypes.system

    def to_llm_msg(self) -> dict: ...

class Session(BaseModel):
    session_id: str
    reasoning_context: list[ContextMessage] = []
```

Adapt `ReasoningEngine` so `build_context()` uses only the supplied Script-Locked session text; it must not read `session.state["collection"]` or VideoDB media state.

- [ ] **Step 5: Add the Flask app/auth shell**

```python
# services/videodb-director/app.py
import os
from flask import Flask, jsonify, request


def create_app():
    app = Flask(__name__)

    @app.get("/health")
    def health():
        return {"ok": True, "service": "videodb-scriptlocked-director"}

    def require_service_token():
        expected = os.environ.get("DIRECTOR_REASONING_TOKEN", "")
        received = request.headers.get("Authorization", "")
        if not expected or received != f"Bearer {expected}":
            return jsonify({"error": "unauthorized"}), 401
        return None

    @app.post("/v1/compile")
    def compile_route():
        denied = require_service_token()
        if denied:
            return denied
        return jsonify({"error": "invalid_request"}), 400

    @app.post("/v1/edit")
    def edit_route():
        denied = require_service_token()
        if denied:
            return denied
        return jsonify({"error": "invalid_request"}), 400

    return app


app = create_app()
```

- [ ] **Step 6: Run Task 1 tests GREEN**

```bash
cd services/videodb-director
python -m pytest tests/test_app.py -q
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

```bash
git add services/videodb-director
git commit -m "feat: add pinned VideoDB Director reasoning service shell"
```

---

### Task 2: Implement immutable contracts, concise continuity, and the Script-Locked compile agent

**Files:**
- Create: `services/videodb-director/scriptlocked/models.py`
- Create: `services/videodb-director/scriptlocked/fidelity.py`
- Create: `services/videodb-director/scriptlocked/continuity.py`
- Create: `services/videodb-director/scriptlocked/agent.py`
- Create: `services/videodb-director/scriptlocked/llm.py`
- Create: `services/videodb-director/scriptlocked/service.py`
- Create: `services/videodb-director/tests/test_compile.py`
- Modify: `services/videodb-director/app.py`

**Interfaces:**
- Consumes: Task 1 `BaseAgent`, `AgentResponse`, `BaseLLM`/GoogleAI adapter.
- Produces: `CompileRequest`, `CompileResponse`, `AgnesExecutionShot`.
- Produces: `compile_project(request: CompileRequest) -> CompileResponse`.
- Produces: typed `ReasonerUnavailable` for Node fallback.

- [ ] **Step 1: Write failing compile-fidelity tests**

```python
# tests/test_compile.py
from scriptlocked.models import CompileRequest
from scriptlocked.service import compile_project

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


def make_request():
    return CompileRequest.model_validate({
        "projectId": "proj-1",
        "visionMode": "structured",
        "shots": [SHOT],
        "references": [
            {"id": "char-1", "kind": "character", "name": "Character 1", "description": "Black woman in red suit"},
            {"id": "piano-ref", "kind": "prop", "name": "White piano", "description": "white grand piano"},
        ],
        "mustInclude": "",
        "avoid": "",
    })


def test_compile_preserves_source_identity(monkeypatch):
    monkeypatch.setenv("SCRIPTLOCKED_TEST_RESPONSE", "Character 1 walks from the white piano to the window while the camera tracks right. She wears the same red suit. The microphone remains on the piano.")
    result = compile_project(make_request())
    shot = result.shots[0]
    assert shot.clipId == SHOT["clipId"]
    assert shot.start == SHOT["start"]
    assert shot.end == SHOT["end"]
    assert shot.sourceText == SHOT["sourceText"]
    assert "camera tracks right" in shot.agnesPrompt.lower()
    assert "red suit" in shot.agnesPrompt.lower()
    assert "microphone" in shot.agnesPrompt.lower()


def test_compile_rejects_invented_location(monkeypatch):
    monkeypatch.setenv("SCRIPTLOCKED_TEST_RESPONSE", "In a neon nightclub, Character 1 walks from the piano to the window.")
    try:
        compile_project(make_request())
    except ValueError as exc:
        assert "unsupported addition" in str(exc).lower()
    else:
        raise AssertionError("invented location must be rejected")
```

- [ ] **Step 2: Run RED**

```bash
cd services/videodb-director
python -m pytest tests/test_compile.py -q
```

Expected: FAIL because Script-Locked models/service do not exist.

- [ ] **Step 3: Define exact request/response models**

```python
# scriptlocked/models.py
from pydantic import BaseModel, Field
from typing import Literal

class ScriptLockedReference(BaseModel):
    id: str
    kind: Literal["character", "style", "location", "shot", "note", "prop", "equipment"]
    name: str
    description: str = ""

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

class CompileRequest(BaseModel):
    projectId: str
    visionMode: Literal["structured"]
    shots: list[ScriptLockedShot]
    references: list[ScriptLockedReference] = Field(default_factory=list)
    mustInclude: str = ""
    avoid: str = ""

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

class CompileResponse(BaseModel):
    compiler: Literal["videodb-scriptlocked-agnes-v1"] = "videodb-scriptlocked-agnes-v1"
    shots: list[AgnesExecutionShot]
```

- [ ] **Step 4: Implement concise continuity constraints**

```python
# scriptlocked/continuity.py
def build_continuity_constraints(shot, references) -> list[str]:
    by_id = {reference.id: reference for reference in references}
    constraints: list[str] = []
    for character_id in shot.selectedCharacterIds:
        ref = by_id.get(character_id)
        if ref:
            constraints.append(f"Match {ref.name} / {ref.id} exactly; preserve the same identity, skin tone/complexion, face, hair, wardrobe, jewelry, and accessories unless this shot explicitly changes them.")
    return constraints
```

Do not add generic cinematic/style filler here.

- [ ] **Step 5: Implement fidelity guards**

`validate_compiled_shot(source, output)` must always check exact immutable fields and reject obvious unsupported nouns/phrases introduced by the compiler when they are absent from source + approved reference descriptions + must/avoid context. Keep the first guard deterministic and conservative: maintain a denylist of common generic additions that previously caused drift (`nightclub`, `neon`, `smoke`, `dancers`, `stage`, `dramatic lighting`, `cinematic palette`) and require each such phrase to appear in allowed source/reference context before accepting it.

```python
# scriptlocked/fidelity.py
GENERIC_ADDITION_TERMS = (
    "nightclub", "neon", "smoke", "dancers", "stage",
    "dramatic lighting", "cinematic palette", "director style",
)

def validate_no_generic_additions(prompt: str, allowed_text: str) -> None:
    prompt_l = prompt.lower()
    allowed_l = allowed_text.lower()
    invented = [term for term in GENERIC_ADDITION_TERMS if term in prompt_l and term not in allowed_l]
    if invented:
        raise ValueError(f"unsupported addition: {', '.join(invented)}")
```

- [ ] **Step 6: Implement the constrained agent system instruction**

```python
# scriptlocked/agent.py
SCRIPT_LOCKED_SYSTEM = """
You are ScriptLockedAgnesAgent, an execution-prompt compiler for Agnes video generation.
The user's current timecoded shot is the source of truth.
You may reorder and clarify the same visible facts into chronological Agnes-friendly language.
You must not add a person, location, prop, wardrobe item, equipment item, vehicle, instrument, lighting concept, color palette, weather, time of day, camera move, story beat, dialogue, on-screen text, or transition that is not present in the current shot or supplied approved continuity/reference facts.
Do not write generic phrases such as cinematic, masterful composition, director style, dramatic lighting, or cinematic palette unless the user explicitly wrote them.
Return only the compiled Agnes prompt text.
""".strip()
```

`ScriptLockedAgnesAgent.run()` must accept exactly one shot plus approved reference metadata and continuity constraints; it must never receive the whole script as material to reinterpret the current shot.

- [ ] **Step 7: Build the LLM provider adapter and test hook**

`scriptlocked/llm.py`:

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

Set `GOOGLEAI_CHAT_MODEL` from Render; initial production value should match the currently supported Gemini Director model used by the app unless verification shows a newer supported value is required.

- [ ] **Step 8: Implement direct compile service**

`compile_project()` directly runs `ScriptLockedAgnesAgent` per shot rather than asking the reasoning engine to choose an agent. This removes tool-routing ambiguity from authoritative compile.

```python
def compile_project(request: CompileRequest) -> CompileResponse:
    outputs = []
    for shot in request.shots:
        constraints = build_continuity_constraints(shot, request.references)
        prompt = ScriptLockedAgnesAgent(...).compile_shot(
            shot=shot,
            references=request.references,
            continuity_constraints=constraints,
            must_include=request.mustInclude,
            avoid=request.avoid,
        )
        validate_compiled_shot(...)
        outputs.append(AgnesExecutionShot(...))
    return CompileResponse(shots=outputs)
```

- [ ] **Step 9: Wire `/v1/compile` and return typed unavailable errors**

`app.py` must return:

```json
{"error":"reasoner_unavailable","message":"..."}
```

with HTTP 503 for `ReasonerUnavailable`; validation failures return HTTP 422 and never partially publish a compile result.

- [ ] **Step 10: Run Python compile suite GREEN**

```bash
cd services/videodb-director
python -m pytest tests/test_app.py tests/test_compile.py -q
```

Expected: PASS.

- [ ] **Step 11: Commit Task 2**

```bash
git add services/videodb-director
git commit -m "feat: add Script-Locked Agnes compile agent"
```

---

### Task 3: Add target-locked VideoDB reasoning for prompt edits

**Files:**
- Create: `services/videodb-director/tests/test_edit.py`
- Modify: `services/videodb-director/director/core/reasoning.py`
- Modify: `services/videodb-director/scriptlocked/models.py`
- Modify: `services/videodb-director/scriptlocked/agent.py`
- Modify: `services/videodb-director/scriptlocked/service.py`
- Modify: `services/videodb-director/app.py`

**Interfaces:**
- Consumes: Task 2 `AgnesExecutionShot`, `ScriptLockedAgnesAgent`.
- Produces: `EditRequest`, `EditResponse`.
- Produces: `edit_instruction(request: EditRequest) -> EditResponse`.
- Only one tool is registered: `script_locked_agnes`.

- [ ] **Step 1: Write failing target-lock/conflict tests**

```python
# tests/test_edit.py

def test_edit_cannot_change_timing(client, auth_headers):
    payload = make_edit_request("Change this shot to 00:30-00:40")
    response = client.post("/v1/edit", headers=auth_headers, json=payload)
    assert response.status_code == 409
    assert response.get_json()["error"] == "locked_source_conflict"


def test_edit_cannot_change_locked_red_suit_without_source_edit(client, auth_headers):
    payload = make_edit_request("Change her red suit to blue")
    response = client.post("/v1/edit", headers=auth_headers, json=payload)
    assert response.status_code == 409
    body = response.get_json()
    assert body["error"] == "locked_source_conflict"
    assert "source script" in body["message"].lower()


def test_edit_only_returns_one_target_instruction(client, auth_headers, monkeypatch):
    monkeypatch.setenv("SCRIPTLOCKED_TEST_RESPONSE", "Character 1 walks to the window more slowly while the camera tracks right; the red suit and microphone placement remain unchanged.")
    payload = make_edit_request("Make her walk slower")
    response = client.post("/v1/edit", headers=auth_headers, json=payload)
    assert response.status_code == 200
    assert response.get_json()["clipId"] == "vision-shot-1"
```

- [ ] **Step 2: Run RED**

```bash
cd services/videodb-director
python -m pytest tests/test_edit.py -q
```

Expected: FAIL because edit contracts/route do not exist.

- [ ] **Step 3: Add edit contracts**

```python
class EditRequest(BaseModel):
    projectId: str
    target: Literal["agnes_instruction"]
    clipId: str
    start: float
    end: float
    sourceText: str
    currentAgnesPrompt: str
    selectedCharacterIds: list[str] = Field(default_factory=list)
    selectedReferenceIds: list[str] = Field(default_factory=list)
    continuityConstraints: list[str] = Field(default_factory=list)
    userMessage: str

class EditResponse(BaseModel):
    clipId: str
    start: float
    end: float
    sourceText: str
    agnesPrompt: str
    compilerNotes: list[str] = Field(default_factory=list)
```

- [ ] **Step 4: Adapt the VideoDB reasoning loop to this one-agent domain**

Use the upstream tool-loop shape but replace the system prompt with:

```text
You are the reasoning layer for a Script-Locked Agnes instruction editor.
You have exactly one tool: script_locked_agnes.
Never modify clipId, start, end, or sourceText.
If the requested edit contradicts a locked source fact, return a locked-source conflict instead of calling the tool.
Never invoke media generation.
Never operate on another clip.
```

Do not retain upstream upload/search/collection fallback rules.

- [ ] **Step 5: Add deterministic preflight conflict checks before the LLM**

At minimum reject:

- time ranges/timecode edits when different from the request’s `start/end`
- explicit color/wardrobe substitution when the source text states a different locked garment color
- request to add a named location/person/prop absent from source/reference facts unless user explicitly chooses source-script edit mode (which is not part of this endpoint)

Return HTTP 409 `{error:"locked_source_conflict", message:"..."}`.

- [ ] **Step 6: Implement `edit_instruction()`**

The reasoning engine gets only the targeted shot/current instruction plus the user edit. Register exactly one `ScriptLockedAgnesAgent`. After the tool returns, re-run immutable/fidelity validation before returning `EditResponse`.

- [ ] **Step 7: Wire `/v1/edit`**

Map:

- 200: valid target-only edit
- 409: locked source conflict
- 422: invalid compiler output
- 503: reasoner unavailable

- [ ] **Step 8: Run Python service suite GREEN**

```bash
cd services/videodb-director
python -m pytest -q
```

Expected: all Python tests PASS.

- [ ] **Step 9: Commit Task 3**

```bash
git add services/videodb-director
git commit -m "feat: add target-locked VideoDB Director editing"
```

---

### Task 4: Add the Node strict contract, Python bridge, and deterministic fallback

**Files:**
- Create: `apps/api/src/director_scriptlocked_contract.ts`
- Create: `apps/api/src/director_scriptlocked_fallback.ts`
- Create: `apps/api/src/director_scriptlocked_client.ts`
- Create: `apps/api/src/director_scriptlocked.test.ts`
- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/src/server.ts`

**Interfaces:**
- Consumes: Python `/v1/compile`, `/v1/edit` contracts.
- Produces: `compileScriptLockedDirector(raw: unknown): Promise<ScriptLockedCompileResponse>`.
- Produces: `editScriptLockedDirector(raw: unknown): Promise<ScriptLockedEditResponse>`.
- Produces browser routes: `POST /api/director/scriptlocked/compile`, `POST /api/director/scriptlocked/edit`.

- [ ] **Step 1: Write failing Node contract/fallback tests**

```ts
// apps/api/src/director_scriptlocked.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { validateCompileResponse } from "./director_scriptlocked_contract.js";
import { buildScriptPreservingFallback } from "./director_scriptlocked_fallback.js";

const request = {
  projectId: "proj-1",
  visionMode: "structured" as const,
  shots: [{
    clipId: "vision-shot-1",
    start: 12,
    end: 18,
    sourceText: "Character 1 walks from the piano to the window. Camera tracks right.",
    visualDirection: "Character 1 walks from the piano to the window.",
    cameraDirection: "Camera tracks right.",
    audioCue: "",
    onScreenText: "",
    selectedCharacterIds: ["char-1"],
    selectedReferenceIds: ["char-1"],
  }],
  references: [{ id: "char-1", kind: "character", name: "Character 1", description: "Black woman in red suit" }],
  mustInclude: "",
  avoid: "",
};

test("rejects Python response that changes exact time", () => {
  assert.throws(() => validateCompileResponse(request, {
    compiler: "videodb-scriptlocked-agnes-v1",
    shots: [{ ...request.shots[0], end: 19, agnesPrompt: "x".repeat(30), continuityConstraints: [], compilerNotes: [] }],
  }), /exact source/i);
});

test("fallback preserves source facts without generic filler", () => {
  const result = buildScriptPreservingFallback(request);
  const prompt = result.shots[0]!.agnesPrompt.toLowerCase();
  assert.match(prompt, /walks from the piano to the window/);
  assert.match(prompt, /camera tracks right/);
  assert.doesNotMatch(prompt, /cinematic|masterful|neon|dramatic lighting/);
});
```

- [ ] **Step 2: Run RED**

```bash
npx tsx --test apps/api/src/director_scriptlocked.test.ts
```

Expected: FAIL because modules do not exist.

- [ ] **Step 3: Define Zod contracts and exact-source validation**

Use schemas mirroring the Python models. `validateCompileResponse(request, response)` must verify:

```ts
if (response.shots.length !== request.shots.length) throw new Error("exact source mismatch: shot count");
for (let i = 0; i < request.shots.length; i += 1) {
  const source = request.shots[i]!;
  const compiled = response.shots[i]!;
  if (compiled.clipId !== source.clipId || compiled.start !== source.start || compiled.end !== source.end || compiled.sourceText !== source.sourceText) {
    throw new Error(`exact source mismatch for ${source.clipId}`);
  }
  const allowedRefs = new Set(source.selectedReferenceIds);
  for (const id of compiled.selectedReferenceIds) if (!allowedRefs.has(id)) throw new Error(`unapproved reference ${id}`);
}
```

Also reject duplicate/missing/renamed clip IDs independent of array order.

- [ ] **Step 4: Implement deterministic Node fallback**

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
      compilerNotes: ["Python reasoner unavailable; used literal script-preserving fallback."],
    })),
  };
}
```

Do not call `createDirectorPlan()` from this fallback.

- [ ] **Step 5: Add Node env configuration**

Extend `apps/api/src/config.ts`:

```ts
DIRECTOR_REASONING_URL: optionalUrl.optional(),
DIRECTOR_REASONING_TOKEN: optionalNonEmpty.optional(),
DIRECTOR_SCRIPTLOCKED_ENABLED: z.coerce.boolean().default(false),
```

Log only presence/absence, never token values.

- [ ] **Step 6: Implement authenticated client**

```ts
export async function requestScriptLockedCompile(body: ScriptLockedCompileRequest) {
  if (!config.DIRECTOR_REASONING_URL || !config.DIRECTOR_REASONING_TOKEN) throw new ReasonerUnavailable("Script-Locked Director service is not configured");
  const response = await fetch(new URL("/v1/compile", config.DIRECTOR_REASONING_URL), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.DIRECTOR_REASONING_TOKEN}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  ...
}
```

Treat 503/network/timeout as unavailable; treat 409/422 as user-visible validation/conflict errors and do not fall back over those.

- [ ] **Step 7: Implement compile/edit gateway functions**

`compileScriptLockedDirector()`:

1. parse request
2. if feature disabled, return explicit 404/409 from route rather than silently use legacy
3. call Python
4. on typed unavailable only, call deterministic Node fallback
5. validate exact-source response
6. return result

`editScriptLockedDirector()` must not use generic fallback to alter a prompt when Python is down; return 503 so the user can retry, because free-form edit interpretation is not deterministic enough to fake safely.

- [ ] **Step 8: Add server routes**

```ts
app.post("/api/director/scriptlocked/compile", { config: { rateLimit: { max: 12, timeWindow: "1 minute" } } }, async (req, reply) => {
  if (!config.DIRECTOR_SCRIPTLOCKED_ENABLED) return reply.code(404).send({ error: "Script-Locked Director is disabled" });
  return reply.send(await compileScriptLockedDirector(req.body));
});

app.post("/api/director/scriptlocked/edit", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
  if (!config.DIRECTOR_SCRIPTLOCKED_ENABLED) return reply.code(404).send({ error: "Script-Locked Director is disabled" });
  return reply.send(await editScriptLockedDirector(req.body));
});
```

Do not remove `/api/director/plan` yet; legacy remains only for rollback during rollout.

- [ ] **Step 9: Run Node tests GREEN**

```bash
npx tsx --test apps/api/src/director_scriptlocked.test.ts
npm run typecheck --workspace @mvs/api
```

Expected: PASS.

- [ ] **Step 10: Commit Task 4**

```bash
git add apps/api/src
git commit -m "feat: bridge Node API to Script-Locked Director"
```

---

### Task 5: Build the new Script-Locked Director UI and migrate existing project state without regenerating media

**Files:**
- Create: `apps/web/src/lib/directorScriptLocked.ts`
- Create: `apps/web/src/lib/directorScriptLockedClient.ts`
- Create: `apps/web/src/lib/directorScriptLocked.test.ts`
- Create: `apps/web/src/components/ScriptLockedDirectorAgent.tsx`
- Create: `apps/web/src/components/ScriptLockedDirectorAgent.test.ts`
- Create: `apps/web/scripts/scriptlocked-director-launcher.patch.mjs`
- Modify: web build/prebuild entrypoint that currently applies Director patches.

**Interfaces:**
- Consumes: existing `parseDirectorVision`, `buildVisionTimelineClips`, approved character/reference state, scene/shot approvals, generated section clips.
- Consumes: Node `/api/director/scriptlocked/compile` and `/edit`.
- Produces: `ScriptLockedDirectorSessionV1` stored separately from the legacy Director session.
- Produces: left-rail Director launcher selects new component when rollout flag is enabled.

- [ ] **Step 1: Write failing migration/source-lock tests**

```ts
// apps/web/src/lib/directorScriptLocked.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { buildScriptLockedShots, migrateLegacyDirectorAssets } from "./directorScriptLocked.js";

test("structured Vision becomes immutable source shots", () => {
  const vision = `00:12–00:18\nShot 1: Character 1 walks to the window.\nCamera: track right.\n00:18–00:23\nShot 2: Character 2 remains at the piano.`;
  const shots = buildScriptLockedShots(vision, []);
  assert.equal(shots.length, 2);
  assert.equal(shots[0]!.start, 12);
  assert.equal(shots[0]!.end, 18);
  assert.match(shots[0]!.sourceText, /Character 1 walks/);
});

test("migration retains approved media and drops legacy prompt authority", () => {
  const migrated = migrateLegacyDirectorAssets({
    legacyPlan: { shots: [{ clipId: "vision-shot-1", prompt: "generic old prompt" }] },
    shotApprovals: { "vision-shot-1": { url: "/old.png", approved: true } },
    sectionApprovals: { "vision-shot-1": { url: "/old.mp4", approved: true } },
  });
  assert.equal(migrated.shotApprovals["vision-shot-1"]!.url, "/old.png");
  assert.equal(migrated.sectionApprovals["vision-shot-1"]!.url, "/old.mp4");
  assert.equal(migrated.compiledByClip["vision-shot-1"], undefined);
});
```

- [ ] **Step 2: Run RED**

```bash
npx tsx --test apps/web/src/lib/directorScriptLocked.test.ts
```

Expected: FAIL because new module does not exist.

- [ ] **Step 3: Define web session/types**

```ts
export type ScriptLockedCompiledShot = {
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

export type ScriptLockedDirectorSessionV1 = {
  version: 1;
  sourceVision: string;
  compiledByClip: Record<string, ScriptLockedCompiledShot | undefined>;
  approvedCharacterIds: string[];
  characterSelections: Record<string, string[]>;
  shotApprovals: Record<string, { url: string; approved: boolean } | undefined>;
  sceneApprovals: Record<string, { url: string; approved: boolean } | undefined>;
  sectionApprovals: Record<string, { url: string; approved: boolean } | undefined>;
};
```

Legacy `shot.prompt` is never copied into `compiledByClip` as authoritative text.

- [ ] **Step 4: Implement browser compile/edit client**

Use the existing app auth/api helper conventions. Required functions:

```ts
export async function compileScriptLocked(request: ScriptLockedCompileRequest): Promise<ScriptLockedCompileResponse>;
export async function editScriptLocked(request: ScriptLockedEditRequest): Promise<ScriptLockedEditResponse>;
```

- [ ] **Step 5: Build `ScriptLockedDirectorAgent.tsx` around four explicit sections**

Required UI order:

1. **Script** — exact timecoded source, read-only inside this component; source editing remains the Vision field.
2. **References** — approved characters/references and per-shot one-or-many selection.
3. **Agnes Instructions** — source text beside editable compiled instruction, continuity chips, `Script locked` badge.
4. **Generate** — explicit image/video generation buttons only.

Do not render mandatory treatment, palette, scene concept, or generic Director approval stages.

- [ ] **Step 6: Preserve current approval/media state during first migration**

On first open of the new component:

- derive source shots from current Vision
- copy matching approved scene/shot/section media by `clipId`
- keep character approvals/selections after sanitizing missing refs
- leave `compiledByClip` empty until `Compile Agnes instructions` is clicked
- do not call image/video providers

- [ ] **Step 7: Add target-locked instruction chat**

Under each compiled instruction, reuse the compact chat interaction pattern but call `/api/director/scriptlocked/edit`. The payload includes only that one clip’s immutable source and current compiled prompt. Apply response only if returned `clipId/start/end/sourceText` still match exactly.

- [ ] **Step 8: Add the minimal launcher patch and rollback flag**

Do not patch legacy planning internals. The launcher patch only chooses which Director component listens to `mvs-open-ltx-director`.

Use a build-time/public flag named `VITE_SCRIPTLOCKED_DIRECTOR_ENABLED` with this behavior:

```ts
const scriptLockedEnabled = import.meta.env.VITE_SCRIPTLOCKED_DIRECTOR_ENABLED === "true";
```

- `true`: new `ScriptLockedDirectorAgent` handles the launcher.
- `false`: existing `LtxDirectorAgent` handles the launcher.

Ensure only one listener is active at a time.

- [ ] **Step 9: Add source-code/UI regression tests**

`ScriptLockedDirectorAgent.test.ts` must assert the shipped component contains:

- `Script locked`
- `Compile Agnes instructions`
- exact source display
- no required `Treatment approval`
- no generic `Cinematic scene board` prefix
- explicit generate actions
- no provider call inside compile/edit handlers

- [ ] **Step 10: Run web tests/build GREEN**

```bash
npx tsx --test apps/web/src/lib/directorScriptLocked.test.ts apps/web/src/components/ScriptLockedDirectorAgent.test.ts
npm run typecheck --workspace @mvs/web
```

Expected: PASS.

- [ ] **Step 11: Commit Task 5**

```bash
git add apps/web/src apps/web/scripts
git commit -m "feat: add Script-Locked Director interface"
```

---

### Task 6: Make Agnes consume only the compiled shot instruction plus concise approved-reference continuity

**Files:**
- Modify: `apps/web/src/components/ScriptLockedDirectorAgent.tsx`
- Modify/Create focused helper: `apps/web/src/lib/directorScriptLockedGeneration.ts`
- Create: `apps/web/src/lib/directorScriptLockedGeneration.test.ts`
- Reuse: existing `directorCharacterMedia.ts`, `directorContinuityLock.ts`, approved shot seed helpers, Agnes generation queue.

**Interfaces:**
- Consumes: `ScriptLockedCompiledShot` and existing approved references/images.
- Produces: `buildAgnesGenerationInstruction(compiled, continuity) -> string`.
- Produces: explicit generation request using existing Agnes provider functions; no provider contract change.

- [ ] **Step 1: Write failing prompt-handoff tests**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { buildAgnesGenerationInstruction } from "./directorScriptLockedGeneration.js";

test("Agnes prompt keeps compiled shot dominant and excludes legacy treatment filler", () => {
  const prompt = buildAgnesGenerationInstruction({
    agnesPrompt: "Character 1 walks from the white piano to the window while the camera tracks right.",
    continuityConstraints: ["Match Character 1 exactly: same complexion and red suit."],
  });
  assert.match(prompt, /^Character 1 walks/);
  assert.match(prompt, /same complexion and red suit/);
  assert.doesNotMatch(prompt, /cinematic scene board|visual style|color palette|masterful composition/i);
});
```

- [ ] **Step 2: Run RED**

```bash
npx tsx --test apps/web/src/lib/directorScriptLockedGeneration.test.ts
```

Expected: FAIL because helper does not exist.

- [ ] **Step 3: Implement minimal Agnes instruction builder**

```ts
export function buildAgnesGenerationInstruction(input: {
  agnesPrompt: string;
  continuityConstraints: string[];
}) {
  return [input.agnesPrompt.trim(), ...input.continuityConstraints.map((item) => item.trim()).filter(Boolean)]
    .filter(Boolean)
    .join(" ");
}
```

Do not append legacy treatment/transition text automatically.

- [ ] **Step 4: Bind references in strict order**

For image generation/edit:

1. existing target image when editing
2. selected named character refs in selected order
3. same-character prior approved anchor if distinct
4. approved project object/set anchor if distinct

For Agnes video generation:

- preferred `seedImageUrl` remains the approved current shot image
- if a character-required shot has no approved shot image, block generation and instruct the user to generate/approve it first
- do not send multiple raw Agnes seed images if Agnes supports one seed only

- [ ] **Step 5: Preserve explicit user generation controls**

Only these UI actions may call providers:

- `Generate shot image`
- `Generate section/video`
- `Regenerate this shot/section`

Compile/edit/reference-selection handlers must have no provider calls.

- [ ] **Step 6: Add regression for long-section segmentation**

Verify every technical Agnes segment receives the same `buildAgnesGenerationInstruction(...)` output and approved seed lineage; segmentation may change provider duration only, never creative content.

- [ ] **Step 7: Run generation tests and existing Director generation regressions GREEN**

```bash
npx tsx --test apps/web/src/lib/directorScriptLockedGeneration.test.ts apps/web/src/lib/directorGeneration.test.ts apps/web/src/lib/directorCharacterMedia.test.ts apps/web/src/lib/directorContinuityLock.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 6**

```bash
git add apps/web/src
git commit -m "feat: send Script-Locked instructions directly to Agnes"
```

---

### Task 7: Add cross-service contract tests and update CI so both runtimes gate every PR

**Files:**
- Create: `apps/api/src/director_scriptlocked_fixture.test.ts` or extend `director_scriptlocked.test.ts`
- Create: `services/videodb-director/tests/fixtures/two_character_props.json`
- Modify: `.github/workflows/build-check.yml`

**Interfaces:**
- Consumes: Tasks 1–6.
- Produces: one CI gate proving Python service tests, Node contract tests, web Script-Locked tests, legacy safety regressions, and workspace build.

- [ ] **Step 1: Add a realistic cross-service fixture**

Fixture must include at least:

- 4 exact timecoded shots
- Character 1 and Character 2 with separate IDs
- one Black character with an explicit complexion/identity reference
- recurring white piano + microphone/equipment
- a camera move in at least two shots
- one on-screen text cue
- one shot switching characters while keeping the same prop/equipment

Expected compiled facts must not introduce locations/people/props not present in the fixture.

- [ ] **Step 2: Add Node fixture validation**

Test that a representative Python-shaped response:

- preserves all exact IDs/times/source text
- keeps Character 1/2 references separate
- rejects a response that swaps `char-1` and `char-2`
- rejects invented nightclub/neon/stage filler
- accepts concise same-piano/microphone continuity

- [ ] **Step 3: Extend GitHub Actions branch triggers**

Add `feature/videodb-scriptlocked-director` to push branches.

- [ ] **Step 4: Add Python setup/test steps before Node build**

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

- [ ] **Step 5: Add the new Node/web tests to Director regression step**

At minimum include:

```text
apps/api/src/director_scriptlocked.test.ts
apps/web/src/lib/directorScriptLocked.test.ts
apps/web/src/lib/directorScriptLockedGeneration.test.ts
apps/web/src/components/ScriptLockedDirectorAgent.test.ts
```

Retain existing Vision parser, script-lock, multi-character, continuity, chat, and generation regressions until the new component has equivalent coverage.

- [ ] **Step 6: Run the complete local-equivalent gate**

```bash
python -m pytest services/videodb-director/tests -q
npx tsx --test apps/web/src/lib/directorVisionParser.test.ts apps/web/src/lib/directorAgentVision.test.ts apps/web/src/lib/directorCharacterState.test.ts apps/web/src/lib/directorCharacterMedia.test.ts apps/web/src/lib/directorContinuityLock.test.ts apps/web/src/lib/directorScriptLocked.test.ts apps/web/src/lib/directorScriptLockedGeneration.test.ts apps/web/src/components/ScriptLockedDirectorAgent.test.ts apps/api/src/director_scriptlocked.test.ts
npm run build
```

Expected: all tests PASS, full workspace build PASS.

- [ ] **Step 7: Commit Task 7**

```bash
git add .github/workflows services/videodb-director/tests apps/api/src apps/web/src
git commit -m "test: gate Script-Locked Director across Python and Node"
```

---

### Task 8: Deploy the Python service, wire feature flags, merge safely, and switch structured Director only after exact-commit verification

**Files:**
- Modify as needed: spec status line after successful rollout.
- No provider-generation test files or sample media.

**Interfaces:**
- Consumes: fully green feature branch from Tasks 1–7.
- Produces: new Render Python service + updated existing Node service configuration.
- Produces: structured Director opens Script-Locked mode in production; rollback flag remains available.

- [ ] **Step 1: Fresh verification on final feature head**

Run/confirm from GitHub Actions on the final SHA:

- Python tests GREEN
- all Director regressions GREEN
- full `npm run build` GREEN
- compare to production base shows only intended Python service, Script-Locked Node/web, CI, and docs files

Do not merge if production branch moved; rebase/merge production into the feature branch and rerun the full gate first.

- [ ] **Step 2: Create the new Render Python web service from the same repository/branch**

Service shape:

```text
Name: scriptlocked-director
Runtime: Python
Branch: backup-pre-rollback-1890d80 after merge
Build: cd services/videodb-director && pip install -r requirements.txt
Start: cd services/videodb-director && gunicorn -b 0.0.0.0:$PORT app:app
Health: /health
```

Set environment:

```text
DIRECTOR_REASONING_TOKEN=<strong generated service secret>
GOOGLEAI_API_KEY=<approved Gemini key value>
GOOGLEAI_CHAT_MODEL=<verified supported model>
```

Do not set `AGNES_API_KEY` or VideoDB media/storage keys on this service.

- [ ] **Step 3: Verify Python service before enabling Node bridge**

Required observations:

- `/health` returns HTTP 200 with `{ok:true,...}`
- unauthenticated `/v1/compile` returns 401
- authenticated fixture compile returns exact shot count/IDs/times/source text
- no media/provider calls occur

- [ ] **Step 4: Configure existing Node production service but keep public UI rollout flag off initially**

Set on existing `rendernodock` service:

```text
DIRECTOR_REASONING_URL=<new Python service URL>
DIRECTOR_REASONING_TOKEN=<same service secret>
DIRECTOR_SCRIPTLOCKED_ENABLED=true
VITE_SCRIPTLOCKED_DIRECTOR_ENABLED=false
```

If the web build reads Vite env only at build time, ensure the flag is present during the Render build and document that a redeploy is required to switch it.

- [ ] **Step 5: Open PR against `backup-pre-rollback-1890d80`**

Title:

```text
Replace Director with VideoDB Script-Locked Agnes compiler
```

PR body must call out:

- pinned upstream commit/license
- stock TextToMovieAgent not used
- exact script-fidelity contract
- Node deterministic fallback
- no automatic generation
- Python + Node/web test counts/build evidence
- rollback flag

- [ ] **Step 6: Require independent PR-triggered CI GREEN and mergeable state**

Use true merge commit (`merge`, not squash/rebase) and lock the expected verified head SHA.

- [ ] **Step 7: Verify exact merge commit deploys LIVE on both services**

For existing Node service, verify auto-deploy uses the exact merge commit and remains on branch `backup-pre-rollback-1890d80`.

For Python service, verify the same repository merge commit is deployed and `/health` is 200.

Do not claim health success unless observed.

- [ ] **Step 8: Enable Script-Locked UI only after both services are healthy**

Set/redeploy:

```text
VITE_SCRIPTLOCKED_DIRECTOR_ENABLED=true
```

Verify the left-rail `✦ Director` opens `ScriptLockedDirectorAgent` and only one Director listener is active.

- [ ] **Step 9: Production smoke test without spending generation credits**

Using a structured fixture/project:

- open Director
- confirm exact timecoded shot count/boundaries/source text
- compile Agnes instructions
- verify no generic treatment/palette/scene invention
- verify Character 1/2 refs remain separate
- verify continuity constraints are concise
- verify existing approved media remains present
- use instruction chat on one shot and confirm only that shot changes
- stop before pressing any Generate/Regenerate button

- [ ] **Step 10: Verify rollback**

Set `VITE_SCRIPTLOCKED_DIRECTOR_ENABLED=false`, redeploy, and confirm legacy Director opens without deleting/mutating Script-Locked session data. Then restore `true` and redeploy. This is rollout safety only; do not route Script-Locked compile failures to legacy automatically.

- [ ] **Step 11: Update design spec status and commit documentation**

After successful live verification, change the spec status to indicate implemented/live and record:

- production merge SHA
- Python Render service ID/deploy ID
- Node Render deploy ID
- exact verified test/build run

- [ ] **Step 12: Final completion gate**

Before claiming completion, use `superpowers:verification-before-completion` and re-check:

- production branch exact SHA
- both Render deployments exact SHA and LIVE
- `/health` observations
- feature flag `true`
- no real Agnes generation used in automated verification

---

## Self-Review Checklist

### Spec coverage

- VideoDB Director replaces structured generic planner: Tasks 1–5, 8.
- Pinned upstream + MIT attribution: Tasks 1, 8.
- No stock TextToMovieAgent/ChatHandler/media dependency: Tasks 1–3.
- Exact timecode/source fidelity: Tasks 2, 4, 5, 7.
- Script-Locked Agnes compile semantics: Task 2.
- Target-locked edit behavior: Tasks 3, 5.
- Separate Node gateway/auth/validation/fallback: Task 4.
- New non-generic UI: Task 5.
- Multi-character/continuity and approved seed behavior: Tasks 5–7.
- No automatic provider side effects: Tasks 2–8.
- General-prose legacy separation: Task 5 launcher/feature behavior; structured mode only is switched.
- Existing project migration: Task 5.
- Python + Node CI: Task 7.
- Two-service Render rollout/rollback: Task 8.

### Type consistency

- Python compile request/response names match Node schemas: `CompileRequest`/`CompileResponse`, `clipId`, `sourceText`, `agnesPrompt`, `selectedCharacterIds`, `selectedReferenceIds`, `continuityConstraints`, `compilerNotes`.
- Web `ScriptLockedCompiledShot` matches Node/Python response fields.
- Compile fallback response uses the same shape with compiler ID `node-script-preserving-fallback-v1`.
- Edit endpoint never changes `clipId/start/end/sourceText`.

### Placeholder scan

No `TODO`, `TBD`, “implement later”, “write tests for the above”, or undefined neighboring interfaces are permitted in the execution plan. Any implementation discovery that invalidates one of these exact interfaces must stop the task, update this plan/spec deliberately, and re-review before continuing.
