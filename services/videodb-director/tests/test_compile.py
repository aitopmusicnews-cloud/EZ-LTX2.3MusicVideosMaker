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
    monkeypatch.setenv(
        "SCRIPTLOCKED_TEST_RESPONSE",
        "Character 1 walks from the white piano to the window while the camera tracks right. She wears the same red suit. The microphone remains on the piano.",
    )
    source = request_fixture().shots[0]
    output = compile_project(request_fixture()).shots[0]
    assert (output.clipId, output.start, output.end, output.sourceText) == (
        source.clipId,
        source.start,
        source.end,
        source.sourceText,
    )


def test_compile_rejects_invented_nightclub(monkeypatch):
    monkeypatch.setenv(
        "SCRIPTLOCKED_TEST_RESPONSE",
        "In a neon nightclub, Character 1 walks from the piano to the window.",
    )
    with pytest.raises(ValueError, match="unsupported addition"):
        compile_project(request_fixture())
