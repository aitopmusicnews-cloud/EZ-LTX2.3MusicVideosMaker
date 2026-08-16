# Music Video Studio

A React/Fastify music-video editor with song analysis, analysis-driven timeline editing, project/media storage, clip generation, and FFmpeg Final Cut rendering. **Agnes Video V2.0 is the active video-generation provider.**

## Active production workflow

- React 19 + Vite editor and Fastify 5 TypeScript API
- Song upload and audio analysis
- Analysis-defined timeline sections with editable start/end boundaries
- Agnes Video V2.0 Text → Video and Image → Video
- Variable clip duration: the timeline owns each logical clip duration
- Long logical clips are generated as multiple Agnes-sized sub-clips and stitched back into one timeline clip
- Agnes footage is hard-trimmed, never time-stretched, and normalized to silent H.264/yuv420p MP4
- Local or private-S3 project/media/render storage
- Original uploaded song remains the Final Cut soundtrack
- FFmpeg Final Cut output: H.264 video + AAC original-song audio + yuv420p + MP4 + faststart
- Project saving/loading, clip library, render queue/progress, and export remain active

## Agnes duration mapping

Agnes runs at 24 FPS. For each timeline duration `end - start`, the API:

1. calculates the minimum frames needed at 24 FPS;
2. chooses the smallest valid `8n + 1` frame count that covers the duration;
3. keeps `num_frames <= 441`;
4. splits logical clips longer than `441 / 24 = 18.375s` into internal sub-generations;
5. hard-trims every returned Agnes segment with FFmpeg to its exact target sub-duration; and
6. stitches sub-segments back into one silent logical clip.

The editor does **not** impose the old 1–5 second generation limit.

## Agnes result flow

Create:

```text
POST https://apihub.agnes-ai.com/v1/videos
Authorization: Bearer $AGNES_API_KEY
model: agnes-video-v2.0
frame_rate: 24
```

Preferred polling:

```text
GET https://apihub.agnes-ai.com/agnesapi?video_id=<VIDEO_ID>&model_name=agnes-video-v2.0
Authorization: Bearer $AGNES_API_KEY
```

`pending`, `queued`, and `in_progress` remain non-terminal. `completed` accepts only an HTTPS `metadata.url`. If a completed preferred response has no valid `metadata.url`, the API uses the returned `task_id` once at `GET /v1/videos/<TASK_ID>` and again accepts only `metadata.url`. Each active Agnes segment has a hard 360-second polling timeout.

## Storage and image conditioning

S3 objects remain private. For Agnes Image → Video, owned S3 media is re-signed server-side with a short-lived HTTPS URL (15 minutes). No public ACL is added and presigned URLs are not intentionally exposed in logs.

With `STORAGE_BACKEND=local`, production Image → Video requires `PUBLIC_BASE_URL` to be an externally reachable **HTTPS** origin so Agnes can fetch the reference image. Localhost is suitable for editor development but not for a remote provider image fetch.

## Retained Modal functionality

Modal is no longer used for active video generation. It is retained only where this project already used it for independent services:

- `MODAL_AUDIO_URL` — audio analysis fallback/service
- `MODAL_MEDIA_SUITE_URL` — character/reference image generation
- `MODAL_KEY` / `MODAL_SECRET` — optional authentication for those retained services

Historical LTX worker files may remain under `modal/` for migration/rollback reference, but the Fastify video-generation routes do not call them and production no longer requires `MODAL_LTX_URL`, `MODAL_LIPSYNC_URL`, or `MODAL_PERFORMANCE_URL`.

## Repository layout

```text
apps/web/           React editor
apps/api/           Fastify API, Agnes adapter, render/storage services
packages/shared/    Shared Zod schemas and TypeScript types
modal/              Retained Modal services and historical worker sources
render.yaml         Render Blueprint configuration
```

## Local setup

Requirements:

- Node.js 20 or 22
- npm 10+
- ffmpeg and ffprobe
- Python/Modal CLI only if deploying retained Modal audio/media-suite workers

```bash
npm ci
cp .env.example .env
npm run dev
```

Open `http://localhost:3000`; the API runs on `http://localhost:3001`.

## Environment

Required for Agnes video generation:

```text
AGNES_API_KEY=...
```

Required for the Director planner:

```text
GEMINI_API_KEY=...
GEMINI_DIRECTOR_MODEL=gemini-3.6-flash
```

Recommended production storage:

```text
STORAGE_BACKEND=s3
S3_BUCKET=your-bucket
S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
# AWS_SESSION_TOKEN=...  # when applicable
```

Retained Modal services are optional and independent of Agnes:

```text
MODAL_AUDIO_URL=...
MODAL_MEDIA_SUITE_URL=...
MODAL_KEY=...
MODAL_SECRET=...
```

## Build and start

```bash
npm run lint
npm run build
npm start
```

The API starts directly from `apps/api/dist/server.js`; there is no LTX/LipDub startup warmup.

## Final Cut

Final rendering keeps the original uploaded song synchronized as AAC audio. Agnes clips are already generated long enough for their timeline slots and are hard-trimmed; Final Cut never time-stretches clips whose model is `agnes-video-v2.0`. Historical ordinary source clips keep their pre-existing stretch behavior for backward compatibility. Output uses H.264, AAC, yuv420p, MP4, and `+faststart`.

## Security

The existing SSRF/path-validation protections remain in place. `AGNES_API_KEY` is read only server-side. Authorization headers, prompts, presigned reference URLs, completed provider URLs, and full Agnes responses are not intentionally written to diagnostics. Keep `.env`, cloud credentials, media, logs, and generated output out of source control.
