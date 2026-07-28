# Music Video Studio — LTX Director GPU Engine

This directory is the provider-agnostic GPU execution layer for the Music Video Studio Director.

The application flow is:

1. Gemini creates and edits the approved Director treatment/section prompt.
2. The API expands an approved section into chronological internal LTX timeline beats.
3. `gpu/ltx_director_server.py` translates those beats into the `LTXDirector` ComfyUI workflow.
4. ComfyUI renders the section and `VHS_VideoCombine` produces an H.264 MP4.
5. The bridge calls the existing Music Video Studio task webhook.
6. The web app shows that one section for review/approval before another Director section can start.

The bridge is intentionally not tied to Modal. It can run beside ComfyUI on Modal, UpCloud, Lightning AI, a local workstation, or another NVIDIA GPU host. Music Video Studio only needs the bridge URL and token.

## 1. ComfyUI and custom nodes

Use an NVIDIA/CUDA host with enough VRAM for the chosen LTX 2.3 model and workflow. Install current ComfyUI, then install the execution dependencies used by the Director workflow:

```bash
cd /workspace
git clone https://github.com/comfyanonymous/ComfyUI.git
cd ComfyUI
python -m pip install -r requirements.txt

cd custom_nodes
git clone https://github.com/WhatDreamsCost/WhatDreamsCost-ComfyUI.git
git clone https://github.com/kijai/ComfyUI-KJNodes.git
git clone https://github.com/Lightricks/ComfyUI-LTXVideo.git
git clone https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite.git

python -m pip install -r WhatDreamsCost-ComfyUI/requirements.txt 2>/dev/null || true
python -m pip install -r ComfyUI-KJNodes/requirements.txt
python -m pip install -r ComfyUI-LTXVideo/requirements.txt
python -m pip install -r ComfyUI-VideoHelperSuite/requirements.txt
```

The API execution template deliberately bypasses the empty rgthree Power LoRA Loader from the uploaded UI workflow, so rgthree is not required unless you add that node back to the execution graph.

## 2. Models expected by the current workflow template

The API template preserves the model names from `LTX 2.3 Director_Prompt Studio.json`:

- `models/diffusion_models/ltx-2.3-22b-distilled-1.1_transformer_only_mxfp8_block32.safetensors`
- `models/text_encoders/gemma_3_12B_it_fp4_mixed.safetensors`
- `models/text_encoders/ltx-2.3_text_projection_bf16.safetensors`
- audio VAE selected as `LTX23_audio_vae_bf16.safetensors`
- video VAE selected as `LTX23_video_vae_bf16.safetensors`

Keep the filenames synchronized with `gpu/workflows/ltx23_director_api.json`. If your ComfyUI installation exposes a different filename in a node dropdown, update the API template to match it exactly.

## 3. Start ComfyUI

From the ComfyUI directory:

```bash
python main.py --listen 127.0.0.1 --port 8188
```

Keep ComfyUI private. The Director bridge is the API boundary exposed to Music Video Studio.

## 4. Start the Director bridge

From the repository root in a second shell:

```bash
python -m pip install -r gpu/requirements-director.txt

export COMFYUI_URL=http://127.0.0.1:8188
export LTX_DIRECTOR_TOKEN='replace-with-a-long-random-secret'
export DIRECTOR_PUBLIC_BASE_URL='https://your-gpu-director.example.com'

uvicorn gpu.ltx_director_server:app --host 0.0.0.0 --port 8787
```

`DIRECTOR_PUBLIC_BASE_URL` is required for rendering because the existing Music Video Studio webhook accepts an absolute output URL.

Health check:

```bash
curl https://your-gpu-director.example.com/health
```

A ready server should report `comfyui: true` and `publicOutputUrlConfigured: true`.

## 5. Configure the Music Video Studio API / Render service

Set these environment variables on the API service:

```env
LTX_DIRECTOR_URL=https://your-gpu-director.example.com/render-section
LTX_DIRECTOR_TOKEN=replace-with-the-same-long-random-secret
```

Keep the existing `MODAL_LTX_URL` if you still want the legacy non-Director generation path. Director section previews no longer need that endpoint.

The existing variables for Gemini, storage, image generation, and LipDub remain unchanged.

## 6. Production behavior

The Director path is intentionally fail-closed:

- no `LTX_DIRECTOR_URL` → no Director video generation;
- character-required section with no approved conditioning image → blocked before GPU launch;
- only one Director section may be generating at a time;
- the next section is blocked until the finished section is reviewed and approved;
- the approved reference image is embedded into `timeline_data` as LTX Director image guidance;
- the generated MP4 returns through the same durable `/api/tasks/:id` polling flow already used by the app.

## 7. Workflow validation

`gpu/workflows/ltx23_director_api.json` is an API-format execution graph derived from the uploaded Director workflow. Custom-node APIs can change between versions, so validate this graph once on the exact GPU image you deploy before spending production credits.

A validation failure is returned by ComfyUI before inference begins and is surfaced to the Music Video Studio task as an error.
