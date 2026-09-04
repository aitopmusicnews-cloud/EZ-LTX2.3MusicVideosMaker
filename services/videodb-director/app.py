import os

from flask import Flask, jsonify, request
from pydantic import ValidationError

from scriptlocked.llm import ReasonerUnavailable
from scriptlocked.models import CompileRequest, EditRequest
from scriptlocked.service import LockedSourceConflict, compile_project, edit_instruction


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
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return jsonify({"error": "invalid_request"}), 400
        try:
            compile_request = CompileRequest.model_validate(payload)
            result = compile_project(compile_request)
            return jsonify(result.model_dump()), 200
        except ValidationError as error:
            return jsonify({"error": "invalid_request", "details": error.errors()}), 400
        except ReasonerUnavailable as error:
            return jsonify({"error": "reasoner_unavailable", "message": str(error)}), 503
        except ValueError as error:
            return jsonify({"error": "fidelity_violation", "message": str(error)}), 422

    @app.post("/v1/edit")
    def edit_route():
        denied = require_token()
        if denied:
            return denied
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return jsonify({"error": "invalid_request"}), 400
        try:
            edit_request = EditRequest.model_validate(payload)
            result = edit_instruction(edit_request)
            return jsonify(result.model_dump()), 200
        except ValidationError as error:
            return jsonify({"error": "invalid_request", "details": error.errors()}), 400
        except LockedSourceConflict as error:
            return jsonify({"error": "locked_source_conflict", "message": str(error)}), 409
        except ReasonerUnavailable as error:
            return jsonify({"error": "reasoner_unavailable", "message": str(error)}), 503
        except ValueError as error:
            return jsonify({"error": "fidelity_violation", "message": str(error)}), 422

    return app


app = create_app()
