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
        if denied:
            return denied
        return jsonify({"error": "invalid_request"}), 400

    @app.post("/v1/edit")
    def edit_route():
        denied = require_token()
        if denied:
            return denied
        return jsonify({"error": "invalid_request"}), 400

    return app


app = create_app()
