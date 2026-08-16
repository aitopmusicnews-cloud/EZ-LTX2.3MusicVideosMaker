# Modal services

## Active services retained by the editor

Modal is **not** the active video-generation provider. Agnes Video V2.0 handles Text → Video and Image → Video through the Fastify API.

The application may still use Modal for independent services configured by:

- `MODAL_AUDIO_URL` — audio analysis
- `MODAL_MEDIA_SUITE_URL` — character/reference image generation
- `MODAL_KEY` / `MODAL_SECRET` — optional authentication for those retained services

Deploy only the corresponding retained worker used by your environment.

## Historical LTX workers

The `ltx_video.py`, `ltx_video_agent.py`, `ltx_performance.py`, and `ltx_lip_sync.py` sources are intentionally retained **only as migration/rollback reference** for projects created before the Agnes conversion. The current Fastify generation routes do not import or call them, the production start command does not warm them, and the current environment does not require `MODAL_LTX_URL`, `MODAL_PERFORMANCE_URL`, or `MODAL_LIPSYNC_URL`.

Do not deploy those historical workers for the active music-video workflow.
