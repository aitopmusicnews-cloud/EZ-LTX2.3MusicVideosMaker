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


def test_compile_accepts_bearer_before_payload_validation(monkeypatch):
    response = make_client(monkeypatch).post(
        "/v1/compile",
        headers={"Authorization": "Bearer test-token"},
        json={},
    )
    assert response.status_code == 400
