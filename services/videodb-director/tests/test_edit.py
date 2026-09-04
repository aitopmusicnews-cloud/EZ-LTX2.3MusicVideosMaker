from app import create_app


def make_client(monkeypatch):
    monkeypatch.setenv("DIRECTOR_REASONING_TOKEN", "test-token")
    return create_app().test_client()


def auth_headers():
    return {"Authorization": "Bearer test-token"}


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


def test_timing_change_is_conflict(monkeypatch):
    response = make_client(monkeypatch).post(
        "/v1/edit",
        headers=auth_headers(),
        json=edit_fixture("Change this to 00:30-00:40"),
    )
    assert response.status_code == 409
    assert response.get_json()["error"] == "locked_source_conflict"


def test_locked_red_suit_change_is_conflict(monkeypatch):
    response = make_client(monkeypatch).post(
        "/v1/edit",
        headers=auth_headers(),
        json=edit_fixture("Change the red suit to blue"),
    )
    assert response.status_code == 409
    assert response.get_json()["error"] == "locked_source_conflict"
