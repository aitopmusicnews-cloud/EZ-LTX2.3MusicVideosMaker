# Deploy checklist — Agnes Video V2.0

## 1. Credentials and storage

Rotate any old cloud credentials before production use. For persistent project/media/render storage, configure private S3:

```text
STORAGE_BACKEND=s3
S3_BUCKET=...
S3_REGION=...
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
# AWS_SESSION_TOKEN=... when applicable
```

S3 objects remain private. Agnes reference images are handed off with short-lived server-generated HTTPS presigned URLs.

## 2. Configure Agnes

Set the server-side key in Render:

```text
AGNES_API_KEY=...
```

Do not expose this key to the browser.

## 3. Configure the app origin

```text
PUBLIC_BASE_URL=https://YOUR-SERVICE.onrender.com
WEB_ORIGIN=https://YOUR-SERVICE.onrender.com
```

If production uses local storage instead of S3, `PUBLIC_BASE_URL` must be publicly reachable over HTTPS for Agnes Image → Video. Render local storage is ephemeral, so S3 is recommended for saved projects and generated media.

## 4. Retained optional services

Only configure the Modal services you still use:

```text
MODAL_AUDIO_URL=...          # retained audio analysis service
MODAL_MEDIA_SUITE_URL=...    # retained character/reference image generation
MODAL_KEY=...                # optional Modal proxy auth
MODAL_SECRET=...
```

Do **not** configure `MODAL_LTX_URL`, `MODAL_LIPSYNC_URL`, or `MODAL_PERFORMANCE_URL`; active video generation no longer depends on them.

For the Director planner:

```text
GEMINI_API_KEY=...
GEMINI_DIRECTOR_MODEL=gemini-3.6-flash
```

## 5. Build and deploy

Expected Render commands:

```text
Build: npm ci --include=dev --no-audit --no-fund && npm run build
Start: npm start
Health check: /health
```

Verify:

```text
https://YOUR-SERVICE.onrender.com/health
```

Expected:

```json
{"ok":true}
```

## 6. Production smoke test

Without forcing timeline lengths, test at least:

1. upload a song and wait for analysis;
2. confirm timeline clips use analysis start/end boundaries;
3. generate a short Text → Video clip with Agnes;
4. generate an Image → Video clip with a private-S3 reference;
5. generate a timeline clip longer than five seconds;
6. confirm `pending`, `queued`, and `in_progress` remain non-terminal;
7. confirm completed results resolve from HTTPS `metadata.url`;
8. save/reload the project and verify the clip library;
9. render Final Cut and confirm the original song is the AAC soundtrack and the output duration matches the timeline.

No Modal callback/webhook is required for Agnes video generation; the browser polls the Fastify task endpoint and the server polls Agnes with a 10-second provider cadence and 360-second per-segment deadline.
