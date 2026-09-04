# Upstream VideoDB Director

Repository: https://github.com/video-db/Director
Pinned commit: `70e0b3dfdf59c679a25f4bea511e3cc4c5f2457f`
License: MIT; see `LICENSE.upstream`.

Reused/adapted modules:
- `backend/director/agents/base.py`
- `backend/director/llm/base.py`
- `backend/director/llm/googleai.py`
- `backend/director/core/session.py` interface shapes
- `backend/director/core/reasoning.py` orchestration pattern

Local changes:
- removed VideoDB collection/media state from the reasoning/session path
- removed socket/database persistence requirements
- use a Script-Locked system prompt for the music-video workflow
- register only the custom `ScriptLockedAgnesAgent`
- expose authenticated compile/edit HTTP endpoints
- Agnes credentials and generation remain in the existing Node service

Production builds must not clone or execute floating upstream `main`.
