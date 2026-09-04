import json
from pathlib import Path

import pytest

from scriptlocked.continuity import build_continuity_constraints
from scriptlocked.models import CompileRequest
from scriptlocked.service import compile_project


FIXTURE_PATH = Path(__file__).parent / "fixtures" / "scriptlocked_4shot.json"


def fixture_request() -> CompileRequest:
    return CompileRequest.model_validate(json.loads(FIXTURE_PATH.read_text()))


def single_shot_request(index: int) -> CompileRequest:
    fixture = fixture_request()
    return CompileRequest(
        projectId=fixture.projectId,
        visionMode="structured",
        shots=[fixture.shots[index]],
        references=fixture.references,
        mustInclude=fixture.mustInclude,
        avoid=fixture.avoid,
    )


def test_fixture_has_exact_four_shot_contract():
    request = fixture_request()
    assert [(shot.clipId, shot.start, shot.end) for shot in request.shots] == [
        ("vision-shot-1-0-50", 0.0, 5.0),
        ("vision-shot-2-50-100", 5.0, 10.0),
        ("vision-shot-3-100-160", 10.0, 16.0),
        ("vision-shot-4-160-220", 16.0, 22.0),
    ]
    assert request.shots[2].onScreenText == "STAY WITH ME"
    assert "Black woman" in request.references[0].description
    assert all(shot.cameraDirection for shot in request.shots)


def test_project_anchor_keeps_piano_and_microphone_without_importing_unselected_person():
    request = fixture_request()
    shot = request.shots[0]
    constraints = " ".join(build_continuity_constraints(shot, request.references))
    assert "white grand piano" in constraints.lower()
    assert "silver microphone" in constraints.lower()
    assert "maya" in constraints.lower()
    assert "jules" not in constraints.lower()


def test_compile_rejects_swapped_unselected_character(monkeypatch):
    monkeypatch.setenv(
        "SCRIPTLOCKED_TEST_RESPONSE",
        "Jules stands beside the white grand piano while the silver microphone remains on its stand. Camera slowly pushes in.",
    )
    with pytest.raises(ValueError, match="unselected character"):
        compile_project(single_shot_request(0))


def test_compile_accepts_concise_selected_identity_and_project_continuity(monkeypatch):
    monkeypatch.setenv(
        "SCRIPTLOCKED_TEST_RESPONSE",
        "Maya stands beside the white grand piano in the red tailored suit while the silver microphone remains on its stand. Camera slowly pushes in.",
    )
    output = compile_project(single_shot_request(0)).shots[0]
    assert output.clipId == "vision-shot-1-0-50"
    assert output.start == 0.0
    assert output.end == 5.0
    assert "white grand piano" in output.agnesPrompt.lower()
    assert "silver microphone" in output.agnesPrompt.lower()
    assert "jules" not in output.agnesPrompt.lower()
