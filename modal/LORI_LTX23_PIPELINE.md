# Lori + LTX-2.3 + LipSync pipeline

The production target is:

`MP3 upload -> audio analysis -> LTX Director -> Lori performer metadata -> LTX-2.3 generation -> automatic LipSync handoff -> timeline -> final music video`

## API contract

- `POST /api/songs/upload` stores the uploaded song and returns an id.
- `POST /api/songs/:id/analyze` starts analysis for the first upload or a re-analysis.
- `GET /api/songs/:id/analysis` returns completed analysis or the current failure/not-found state.
- `POST /api/director/plan` creates the Director plan.
- `POST /api/generate/text-to-video` supports LTX text-to-video.
- `POST /api/generate/image-to-video` supports LTX image-to-video.
- `POST /api/generate/video-to-video` supports continuation/transform workflows.
- `POST /api/generate/lip-sync` starts LipSync directly.
- `POST /api/modal/webhook` and `POST /api/webhooks/modal` accept Modal completion callbacks.

When a generation job has LipDub requested and contains performer audio, the Modal generation webhook automatically starts the LipSync child job. The child completion updates the parent generation job to completed and stores the final lip-synced video URL.

## Modal deployment

The repository-side API is only one half of the system. Modal must expose the deployed LTX-2.3 generation worker and the LipSync worker used by `apps/api/src/modalAI.ts`.

After changing a Modal worker, redeploy that worker with the corresponding `modal deploy` command and verify the resulting endpoint is the value configured in Render. If a Modal endpoint, secret, GPU/container setting, or persistent Volume changes, update Render environment variables as well.

## Important

Do not add a second `/api/health` route. Render health checking uses `/health` only.

The first MP3 upload does not require an existing analysis record. Upload creates the song id; the analyze route creates the analysis record.
