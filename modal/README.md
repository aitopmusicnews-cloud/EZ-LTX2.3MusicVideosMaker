# Modal Services

This directory contains the GPU and media-processing workers used by Music Video Studio.

The production architecture separates the workers so that the native LTX Director workflow, legacy short-clip generation, LipDub/LipSync, and media generation can be deployed and updated independently.

## Production architecture

```text
                         Music Video Studio
                                  |
                                  v
                         Render API service
                                  |
             +--------------------+--------------------+
             |                    |                    |
             v                    v                    v
       Gemini Director       Modal LTX Director    Media Suite
       planning/chat         section generation    image generation
             |                    |                    |
             |                    v                    |
             |              ComfyUI + LTXDirector   |
             |                    |                    |
             |                    v                    |
             |                 MP4 output             |
             |                                         |
             +-------------------+---------------------+
                                 |
                                 v
                         LipDub / LipSync
                                 |
                                 v
                         Final media output
```

The Render service is the application/API layer. Modal provides GPU-backed inference workers.

Do not expose Modal implementation details to the web frontend. The frontend should call the Render API, and the Render API should call the appropriate Modal service.

---

# 1. One-time local setup

From the repository root:

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install modal
modal setup
```

Verify the Modal CLI:

```bash
modal --version
```

Authenticate if necessary:

```bash
modal setup
```

The exact Modal workspace used by production is printed in the deployment output and should be used when copying generated URLs into Render.

---

# 2. LTX-2.3 Director worker

File:

```text
modal/ltx_director_agent.py
```

The Director worker is the GPU host for the Music Video Studio Director.

It runs the uploaded LTX Director workflow through ComfyUI using:

* `LTXDirector`
* `LTXDirectorGuide`
* KJNodes
* ComfyUI-LTXVideo
* VideoHelperSuite

The Director is intentionally deployed as a separate Modal app:

```text
mvs-ltx-director
```

This keeps the native Director workflow separate from the legacy short-clip Diffusers worker.

## Prepare Director model files

Download the Director model files into the persistent Modal Volume without allocating a GPU:

```bash
modal run modal/ltx_director_agent.py::prepare_director_models
```

The models are stored in:

```text
mvs-ltx-director-models
```

Re-running the preparation command is safe. Files that already exist in the persistent Volume are skipped.

## Deploy the Director

```bash
modal deploy modal/ltx_director_agent.py
```

Modal will print the deployed web-function URL.

The Render API should use the exact URL for the `director_generate` web function.

Set this in Render:

```env
LTX_DIRECTOR_URL=https://YOUR-WORKSPACE--mvs-ltx-director-director-generate.modal.run
```

Do not manually append:

```text
/render-section
```

to the Modal Function URL.

The Modal function URL itself is the endpoint the Render Director client should call.

For the default Modal deployment, `LTX_DIRECTOR_TOKEN` may remain blank.

## Director GPU

The Director uses:

```text
A100-80GB
```

by default.

To deploy using another supported Modal GPU:

```bash
MVS_LTX_DIRECTOR_GPU=H100 modal deploy modal/ltx_director_agent.py
```

Only change the GPU when the deployment configuration and workload have been validated.

## Optional Modal proxy authentication

The Director can optionally use Modal proxy authentication.

Deploy with:

```bash
MVS_MODAL_PROXY_AUTH=1 modal deploy modal/ltx_director_agent.py
```

Then configure the Render API service:

```env
MODAL_KEY=wk-...
MODAL_SECRET=ws-...
```

The Render Director client automatically sends the appropriate authentication headers when these values are configured.

## Director production flow

```text
User creates project
        |
        v
Gemini Director planning/chat
        |
        v
Director plan
        |
        v
Approved section
        |
        v
Render API
        |
        v
LTX Director Modal web function
        |
        v
A100-80GB
        |
        v
ComfyUI + LTXDirector
        |
        v
VHS H.264 MP4
        |
        v
Modal output Volume / file URL
        |
        v
Render webhook + task polling
        |
        v
Section review
        |
        v
User approval
```

The application credit gate remains active.

One Director section is generated at a time. The next section remains blocked until the current result has been reviewed and approved.

---

# 3. Legacy LTX-2.3 short-clip worker

File:

```text
modal/ltx_video_agent.py
```

This worker provides the existing Diffusers-based generation path for non-Director generation.

It currently uses:

* `diffusers/LTX-2.3-Distilled-Diffusers`
* A100-80GB
* 768×512
* 24 fps
* 1–5 second clips
* synchronized generated audio
* text-to-video generation
* first-frame image conditioning
* webhook completion callbacks

Deploy:

```bash
modal deploy modal/ltx_video_agent.py
```

Copy the generated `generate` web-function URL into Render:

```env
MODAL_LTX_URL=https://YOUR-WORKSPACE--mvs-ltx-video-generate.modal.run
```

Do not use the Director URL for legacy short-clip generation.

The two workers are separate services.

---

# 4. LTX LipDub / LipSync worker

The LipDub/LipSync worker provides GPU-backed lip synchronization.

The production Modal application is:

```text
mvs-ltx-lipdub-lip-sync
```

The current production endpoint is:

```text
https://cdtfullsail--mvs-ltx-lipdub-lip-sync.modal.run
```

The Render API should call the LipDub/LipSync service through the configured Modal URL.

The exact environment variable name must match the Render API implementation. Before changing it, search the API source:

```bash
grep -R -n "LIP.*SYNC\|LIP.*DUB\|MODAL.*LIP" apps/api/src
```

Then configure the matching Render environment variable with:

```text
https://cdtfullsail--mvs-ltx-lipdub-lip-sync.modal.run
```

Do not substitute the Director URL or the legacy LTX video URL.

## LipDub GPU configuration

The LipDub worker runs on an A100.

Production inference must use:

```text
BF16
```

with:

```text
FP8 disabled
```

Do not enable FP8 for the production A100 LipDub path unless the inference implementation is intentionally changed and validated.

## Deploying LipDub

Deploy the Modal application using its current Modal source file.

For example:

```bash
modal deploy modal/<lipdub-source-file>.py
```

The exact source filename should be verified from the repository before deployment:

```bash
find modal -maxdepth 1 -type f -print
```

After deployment, copy the URL printed by Modal into the Render API service configuration.

The production endpoint currently used is:

```text
https://cdtfullsail--mvs-ltx-lipdub-lip-sync.modal.run
```

After changing the Modal deployment, verify the deployed URL before changing Render.

---

# 5. LipDub/LipSync endpoint testing

Do not assume that a Modal URL is healthy simply because the URL exists.

Test the endpoint from the same environment that will ultimately call it.

Basic HTTPS test:

```bash
curl -v --http1.1 \
  "https://cdtfullsail--mvs-ltx-lipdub-lip-sync.modal.run"
```

Test a POST request:

```bash
curl -v --http1.1 \
  -X POST \
  "https://cdtfullsail--mvs-ltx-lipdub-lip-sync.modal.run" \
  -H "Content-Type: application/json" \
  -d '{}'
```

A valid application-level response may be an HTTP error such as `400` or `422` if required input is missing. That still proves the TLS connection and application endpoint are reachable.

A TLS error such as:

```text
SSL routines:CONNECT_CR_SRVR_HELLO:tlsv1 alert internal error
```

is different.

That means the request did not successfully reach the application layer.

For example:

```text
Connected to ... port 443
TLS handshake
TLS alert: internal error
```

indicates that the connection reached the remote server but failed during TLS negotiation.

In that situation, changing the JSON body, adding application headers, or changing the Render route will not fix the underlying TLS problem.

Test with:

```bash
curl -v --http1.1 \
  "https://cdtfullsail--mvs-ltx-lipdub-lip-sync.modal.run"
```

Then test POST:

```bash
curl -v --http1.1 \
  -X POST \
  "https://cdtfullsail--mvs-ltx-lipdub-lip-sync.modal.run" \
  -H "Content-Type: application/json" \
  -d '{}'
```

If both fail during TLS negotiation, investigate the Modal deployment and generated URL before changing the Render application.

Also verify that the URL copied into Render exactly matches the URL printed by the current Modal deployment.

---

# 6. Important distinction: Modal endpoint vs. Render API endpoint

The browser should not call Modal directly.

The normal request flow is:

```text
Browser
   |
   | POST /api/generate/lip-sync
   v
Render API
   |
   | POST to Modal LipSync service
   v
Modal LTX LipDub/LipSync
```

Therefore, when the browser reports:

```text
POST /api/generate/lip-sync 500
```

the first place to investigate is the Render API logs.

A browser `500` does not necessarily mean the browser request is malformed.

It may mean:

1. Render received the request.
2. Render attempted to call Modal.
3. Modal returned an error or could not be reached.
4. Render converted that upstream failure into HTTP 500.

Check the Render logs for the underlying Modal error.

---

# 7. Render environment variables

The Render API service should contain the environment variables required by the application.

At minimum, verify the Modal service URLs.

Director:

```env
LTX_DIRECTOR_URL=https://YOUR-WORKSPACE--mvs-ltx-director-director-generate.modal.run
```

Legacy LTX:

```env
MODAL_LTX_URL=https://YOUR-WORKSPACE--mvs-ltx-video-generate.modal.run
```

Media Suite:

```env
MODAL_MEDIA_SUITE_URL=https://cdtfullsail--mvs-media-suite-text-to-image.modal.run
```

Important:

`MODAL_MEDIA_SUITE_URL` must point to the POST-capable text-to-image function:

```text
https://cdtfullsail--mvs-media-suite-text-to-image.modal.run
```

Do not use the GET-only file endpoint:

```text
...get-file.modal.run
```

The application sends POST requests when generating characters and images. Using the GET-only endpoint results in:

```text
405 Method Not Allowed
```

LipDub/LipSync:

```env
# Use the exact environment variable name expected by apps/api/src.
# The production Modal endpoint is:
https://cdtfullsail--mvs-ltx-lipdub-lip-sync.modal.run
```

Optional Director authentication:

```env
MODAL_KEY=wk-...
MODAL_SECRET=ws-...
```

If Modal proxy authentication is not enabled, these may be left unset.

Director token:

```env
LTX_DIRECTOR_TOKEN=
```

For the default Director deployment, this can remain blank.

After changing any Render environment variable, trigger a new deployment.

---

# 8. Render build and deploy configuration

The Render service should build the complete monorepo from the repository root.

Recommended build command:

```bash
npm ci --include=dev --no-audit --no-fund && npm run build
```

Start command:

```bash
npm start
```

The repository root `package.json` controls the workspace build:

```text
npm run clean
npm run build --workspace @mvs/shared
npm run build --workspace @mvs/web
npm run build --workspace @mvs/api
```

The API service starts with:

```bash
npm run start --workspace @mvs/api
```

The API startup script is:

```text
apps/api/scripts/start-with-warmup.mjs
```

Node.js should use the version range defined by the repository.

Current production builds use Node.js 22.x.

Render should use:

```text
Node.js >=20 <23
```

Do not configure Render to run only:

```bash
npm run build --workspace @mvs/api
```

The web application must also be built.

---

# 9. Web application hosting

The API and web application have separate build outputs:

```text
apps/web/dist
apps/api/dist
```

The web build produces:

```text
apps/web/dist/index.html
apps/web/dist/assets/*
```

The API build produces the compiled server:

```text
apps/api/dist/*
```

If Render is configured as a single Node web service, the API server must be able to serve the compiled web application.

If the browser opens the Render URL and receives:

```json
{
  "message": "Route GET:/ not found",
  "error": "Not Found",
  "statusCode": 404
}
```

that means the API server is running, but the root route is not serving the web application's `index.html`.

The expected production behavior is:

```text
GET /
    -> apps/web/dist/index.html

GET /assets/*
    -> apps/web/dist/assets/*

GET /api/*
    -> API routes

GET /health
    -> health response

GET /api/health
    -> health response
```

The API should not return:

```text
Route GET:/ not found
```

for the production root URL.

---

# 10. Health checks

The production API should expose both:

```text
GET /health
```

and:

```text
GET /api/health
```

Both should return a successful health response.

Test:

```bash
curl -i https://YOUR-RENDER-SERVICE.onrender.com/health
```

Then:

```bash
curl -i https://YOUR-RENDER-SERVICE.onrender.com/api/health
```

A successful deployment should return HTTP 200 for both.

Render's health-check path should be configured to use:

```text
/health
```

or:

```text
/api/health
```

depending on the Render service configuration.

Do not register the same route twice in Fastify.

For example, this is invalid:

```ts
app.get("/api/health", handler);
app.get("/api/health", handler);
```

It causes:

```text
FST_ERR_DUPLICATED_ROUTE
```

and prevents the server from starting.

---

# 11. Root web route

The production root URL should load the Music Video Studio web application:

```text
https://YOUR-RENDER-SERVICE.onrender.com/
```

The expected flow is:

```text
Browser
   |
   v
GET /
   |
   v
Render API server
   |
   v
apps/web/dist/index.html
   |
   v
React application
```

If the response is:

```json
{
  "message": "Route GET:/ not found",
  "error": "Not Found",
  "statusCode": 404
}
```

check:

1. `apps/web/dist/index.html` exists after build.
2. The API server knows the absolute path to `apps/web/dist`.
3. Static assets are registered before the API fallback.
4. The `/` route serves `index.html`.
5. SPA routes fall back to `index.html`.
6. Render is deploying the latest commit.
7. The Render service is building from the repository root.

The build log should contain:

```text
@ mvs/web build
vite ... building for production
✓ built
```

and:

```text
@ mvs/api build
```

before deployment starts.

---

# 12. Render deployment verification

After deploying a new commit:

## Step 1: Verify build

Render logs should show:

```text
Build successful
```

The web build should complete successfully.

The API build should complete successfully.

## Step 2: Verify startup

Render should show:

```text
Server listening
```

The process must remain running.

If startup fails with:

```text
FST_ERR_DUPLICATED_ROUTE
```

fix the duplicate Fastify route before investigating downstream services.

## Step 3: Verify health

Run:

```bash
curl -i https://YOUR-RENDER-SERVICE.onrender.com/health
```

Then:

```bash
curl -i https://YOUR-RENDER-SERVICE.onrender.com/api/health
```

## Step 4: Verify web application

Open:

```text
https://YOUR-RENDER-SERVICE.onrender.com/
```

The React application should load.

The browser should not display:

```text
Route GET:/ not found
```

## Step 5: Verify API

Check a known API endpoint.

For example:

```bash
curl -i https://YOUR-RENDER-SERVICE.onrender.com/api/health
```

## Step 6: Verify Modal

Test each Modal endpoint independently before testing the full application.

Director:

```bash
curl -v --http1.1 \
  "https://YOUR-WORKSPACE--mvs-ltx-director-director-generate.modal.run"
```

Legacy LTX:

```bash
curl -v --http1.1 \
  "https://YOUR-WORKSPACE--mvs-ltx-video-generate.modal.run"
```

Media Suite:

```bash
curl -v --http1.1 \
  -X POST \
  "https://cdtfullsail--mvs-media-suite-text-to-image.modal.run" \
  -H "Content-Type: application/json" \
  -d '{}'
```

LipDub/LipSync:

```bash
curl -v --http1.1 \
  -X POST \
  "https://cdtfullsail--mvs-ltx-lipdub-lip-sync.modal.run" \
  -H "Content-Type: application/json" \
  -d '{}'
```

A missing-input response at the application level is useful because it proves the endpoint is reachable.

A TLS handshake failure means the endpoint itself needs investigation.

---

# 13. Troubleshooting a LipSync HTTP 500

If the browser shows:

```text
POST /api/generate/lip-sync 500
```

follow this order.

### Check 1: Render API logs

Find the request corresponding to:

```text
/api/generate/lip-sync
```

Look for:

* Modal URL
* HTTP status
* fetch error
* TLS error
* timeout
* authentication error
* Modal inference error

### Check 2: Verify the Modal URL

The current production LipDub/LipSync URL is:

```text
https://cdtfullsail--mvs-ltx-lipdub-lip-sync.modal.run
```

Make sure Render uses the exact URL.

### Check 3: Test Modal directly

```bash
curl -v --http1.1 \
  "https://cdtfullsail--mvs-ltx-lipdub-lip-sync.modal.run"
```

Then:

```bash
curl -v --http1.1 \
  -X POST \
  "https://cdtfullsail--mvs-ltx-lipdub-lip-sync.modal.run" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### Check 4: Separate TLS from application errors

If curl reports:

```text
tlsv1 alert internal error
```

the failure occurs before the application receives the request.

Do not debug the request JSON first.

Verify:

* Modal deployment is active.
* The URL is from the current deployment.
* The Modal web endpoint is configured correctly.
* The deployment is not stale.
* The endpoint is not an old or invalid URL.
* The Modal application logs show the request.
* The endpoint works from another current HTTPS client if available.

If the request never appears in the Modal application logs, the failure is likely occurring before application-level inference.

### Check 5: Verify A100 inference configuration

The LipDub worker should use:

```text
A100
BF16
FP8 disabled
```

If the Modal container starts but inference fails, inspect the Modal logs for model-loading or GPU-runtime errors.

---

# 14. Modal deployment checklist

Before deploying a Modal worker:

```bash
source .venv/bin/activate
```

Check the source files:

```bash
find modal -maxdepth 1 -type f -print
```

Deploy the changed worker:

```bash
modal deploy modal/<worker>.py
```

Copy the newly printed endpoint.

Update Render environment variables only when the endpoint changes.

Trigger a Render redeploy after changing environment variables.

Verify:

```text
Modal deployment
        |
        v
Modal endpoint responds
        |
        v
Render environment variable is correct
        |
        v
Render deployment succeeds
        |
        v
/health returns 200
        |
        v
/api/health returns 200
        |
        v
GET / loads the web application
        |
        v
Feature-specific API test
        |
        v
Modal inference test
```

---

# 15. Other workers

## Audio analysis

File:

```text
modal/audio_analysis.py
```

Used for audio feature extraction.

Deploy when the worker changes:

```bash
modal deploy modal/audio_analysis.py
```

## Media Suite

File:

```text
modal/media_suite.py
```

Used for SDXL image generation and related media operations.

The production text-to-image endpoint configured for Render is:

```text
https://cdtfullsail--mvs-media-suite-text-to-image.modal.run
```

The Render variable must point to the POST-capable text-to-image function.

Do not use the GET-only `get-file` endpoint for character generation.

## Lip-sync placeholder warning

Do not advertise any lip-sync path as complete unless the implementation performs real inference and writes the resulting MP4 to the expected output Volume or returns a valid output URL.

The production LTX LipDub/LipSync service is separate from the unfinished placeholder code in `media_suite.py`.

---

# 16. Production troubleshooting order

When something fails, troubleshoot from the outside inward.

```text
1. Does Render respond?
        |
        v
2. Does /health return 200?
        |
        v
3. Does /api/health return 200?
        |
        v
4. Does GET / load index.html?
        |
        v
5. Does the API endpoint respond?
        |
        v
6. Can Render reach Modal?
        |
        v
7. Does the Modal endpoint pass TLS?
        |
        v
8. Does Modal accept the request?
        |
        v
9. Does GPU inference start?
        |
        v
10. Does the output file exist?
```

Do not skip directly to GPU debugging when Render is returning 404 or 500.

First establish that the Render server is running and that the request can reach the correct API route.

---

# 17. Production URL summary

| Service           | Purpose                    | Production endpoint                                                    |
| ----------------- | -------------------------- | ---------------------------------------------------------------------- |
| Render            | Main web/API application   | `https://YOUR-RENDER-SERVICE.onrender.com`                             |
| Render health     | Health check               | `/health`                                                              |
| Render API health | API health check           | `/api/health`                                                          |
| LTX Director      | Native Director generation | `https://YOUR-WORKSPACE--mvs-ltx-director-director-generate.modal.run` |
| Legacy LTX        | Short clips                | `https://YOUR-WORKSPACE--mvs-ltx-video-generate.modal.run`             |
| Media Suite       | Text-to-image              | `https://cdtfullsail--mvs-media-suite-text-to-image.modal.run`         |
| LipDub/LipSync    | LTX lip synchronization    | `https://cdtfullsail--mvs-ltx-lipdub-lip-sync.modal.run`               |

Always use the exact endpoint printed by the current Modal deployment when deploying a new worker.

---

# 18. Final production checklist

Before declaring a deployment healthy:

* [ ] `npm ci --include=dev --no-audit --no-fund` succeeds.
* [ ] `npm run build` succeeds.
* [ ] `apps/web/dist/index.html` exists.
* [ ] `apps/api/dist` exists.
* [ ] Render deployment starts successfully.
* [ ] No `FST_ERR_DUPLICATED_ROUTE` errors occur.
* [ ] `/health` returns HTTP 200.
* [ ] `/api/health` returns HTTP 200.
* [ ] `/` loads the Music Video Studio web application.
* [ ] `/assets/*` loads successfully.
* [ ] Director Modal endpoint is reachable.
* [ ] Legacy LTX Modal endpoint is reachable.
* [ ] Media Suite POST endpoint is reachable.
* [ ] LipDub/LipSync Modal endpoint is reachable.
* [ ] LipDub uses native BF16.
* [ ] LipDub has FP8 disabled.
* [ ] Render environment variables point to the correct Modal functions.
* [ ] Modal URLs are tested independently before testing the complete application.
* [ ] Modal TLS failures are resolved before debugging application payloads.
* [ ] Feature-specific API requests return successful responses.
* [ ] Generated media is written to the expected output location.
* [ ] Webhook/task polling completes successfully.
* [ ] The generated result is visible in the application.
