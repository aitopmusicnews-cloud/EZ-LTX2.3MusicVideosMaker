# Modal services

## LTX-2.3 Director worker (ComfyUI)

`ltx_director_agent.py` is the GPU host for the Music Video Studio Director. It runs the uploaded LTX Director workflow on Modal using ComfyUI, `LTXDirector`, `LTXDirectorGuide`, KJNodes, ComfyUI-LTXVideo, and VideoHelperSuite.

It is intentionally a separate Modal app (`mvs-ltx-director`) from the existing short-clip Diffusers worker so the legacy path remains available while the native Director workflow is validated.

### One-time setup

From the repository root:

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install modal
modal setup
```

Download the Director model files into the persistent Modal Volume **without allocating a GPU**:

```bash
modal run modal/ltx_director_agent.py::prepare_director_models
```

The model set is stored in the `mvs-ltx-director-models` Modal Volume. Re-running the command skips files already present.

### Deploy the Director

```bash
modal deploy modal/ltx_director_agent.py
```

Modal prints a URL for the `director_generate` web function. Copy that exact URL into the Render service environment as:

```env
LTX_DIRECTOR_URL=https://YOUR-WORKSPACE--mvs-ltx-director-director-generate.modal.run
```

Do **not** append `/render-section` to a Modal Function URL.

For the default Modal deployment, `LTX_DIRECTOR_TOKEN` can remain blank.

The Director uses `A100-80GB` by default. To select a different Modal GPU at deployment time, set `MVS_LTX_DIRECTOR_GPU`, for example:

```bash
MVS_LTX_DIRECTOR_GPU=H100 modal deploy modal/ltx_director_agent.py
```

### Optional Modal proxy authentication

The Director web function can use Modal proxy authentication. Deploy with:

```bash
MVS_MODAL_PROXY_AUTH=1 modal deploy modal/ltx_director_agent.py
```

Then put the matching Modal proxy token pair in the Render API service:

```env
MODAL_KEY=wk-...
MODAL_SECRET=ws-...
```

The Render Director client automatically sends those headers when they are configured.

### Production flow

```text
Music Video Studio / Render
          ↓
Gemini Director plan + approved section
          ↓
Modal director_generate URL
          ↓
A100-80GB (default)
          ↓
ComfyUI + LTXDirector timeline
          ↓
VHS H.264 MP4
          ↓
Modal output Volume / file URL
          ↓
Render webhook + existing task polling
          ↓
Section review / approval
```

The Director still respects the application's credit gate: one section is generated at a time and the next section stays blocked until the current result is reviewed and approved.

## Legacy LTX-2.3 short-clip worker

`ltx_video_agent.py` keeps the existing Diffusers-based generation path available for non-Director work. It currently uses:

- `diffusers/LTX-2.3-Distilled-Diffusers`
- A100-80GB
- 768×512 at 24 fps
- 1–5 second clips
- synchronized generated audio
- text-to-video or first-frame image conditioning
- webhook completion callbacks

Deploy it separately when that worker changes:

```bash
modal deploy modal/ltx_video_agent.py
```

Copy the generated `generate` URL into Render as:

```env
MODAL_LTX_URL=https://YOUR-WORKSPACE--mvs-ltx-video-generate.modal.run
```

## Other workers

- `audio_analysis.py`: audio feature extraction
- `media_suite.py`: SDXL image generation plus an unfinished lip-sync placeholder

Do not advertise the lip-sync path as complete until a real inference implementation writes the returned MP4 to the output Volume.
