from __future__ import annotations

import asyncio
import os
import shutil
import subprocess
import time
import uuid
from pathlib import Path

import modal

# Dedicated Modal app for the native ComfyUI/LTXDirector workflow. Keeping this
# separate from mvs-ltx-video means the existing Diffusers endpoint can remain
# available as a fallback while the Director workflow is validated.
app = modal.App("mvs-ltx-director")

REPO_ROOT = Path(__file__).resolve().parents[1]
LOCAL_GPU_DIR = REPO_ROOT / "gpu"

COMFY_ROOT = "/root/ComfyUI"
COMFY_MODELS = f"{COMFY_ROOT}/models"
COMFY_OUTPUT = f"{COMFY_ROOT}/output"
DIRECTOR_OUTPUT = "/outputs"
DIRECTOR_GPU = os.getenv("MVS_LTX_DIRECTOR_GPU", "A100-80GB")
REQUIRE_PROXY_AUTH = os.getenv("MVS_MODAL_PROXY_AUTH", "0").strip() == "1"

model_volume = modal.Volume.from_name("mvs-ltx-director-models", create_if_missing=True)
output_volume = modal.Volume.from_name("mvs-ltx-director-outputs", create_if_missing=True)

web_image = modal.Image.debian_slim(python_version="3.12").uv_pip_install(
    "fastapi[standard]>=0.115.8",
)

# ComfyUI and the exact custom-node families used by the uploaded LTX Director
# workflow. The WhatDreamsCost node currently requires recent ComfyUI-LTXVideo
# and KJNodes, so these are intentionally installed together.
director_image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install(
        "ffmpeg",
        "git",
        "libgl1",
        "libglib2.0-0",
        "libsm6",
        "libxext6",
        "libxrender1",
    )
    .run_commands(
        "git clone --depth=1 https://github.com/Comfy-Org/ComfyUI.git /root/ComfyUI",
        "git clone --depth=1 https://github.com/WhatDreamsCost/WhatDreamsCost-ComfyUI.git /root/ComfyUI/custom_nodes/WhatDreamsCost-ComfyUI",
        "git clone --depth=1 https://github.com/kijai/ComfyUI-KJNodes.git /root/ComfyUI/custom_nodes/ComfyUI-KJNodes",
        "git clone --depth=1 https://github.com/Lightricks/ComfyUI-LTXVideo.git /root/ComfyUI/custom_nodes/ComfyUI-LTXVideo",
        "git clone --depth=1 https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite.git /root/ComfyUI/custom_nodes/ComfyUI-VideoHelperSuite",
        "python -m pip install --upgrade pip",
        "python -m pip install -r /root/ComfyUI/requirements.txt",
        "python -m pip install -r /root/ComfyUI/custom_nodes/ComfyUI-KJNodes/requirements.txt",
        "python -m pip install -r /root/ComfyUI/custom_nodes/ComfyUI-LTXVideo/requirements.txt",
        "python -m pip install -r /root/ComfyUI/custom_nodes/ComfyUI-VideoHelperSuite/requirements.txt",
        "python -m pip install av httpx pillow fastapi[standard] huggingface-hub[hf_xet]",
    )
    .add_local_dir(LOCAL_GPU_DIR, remote_path="/root/gpu")
)

# Files referenced by gpu/workflows/ltx23_director_api.json. They are downloaded
# into a persistent Modal Volume by prepare_director_models(), not while a GPU is
# running, so first-time model transfer does not burn GPU time.
MODEL_SPECS = (
    (
        "Kijai/LTX2.3_comfy",
        "diffusion_models/ltx-2.3-22b-distilled-1.1_transformer_only_mxfp8_block32.safetensors",
        "diffusion_models/ltx-2.3-22b-distilled-1.1_transformer_only_mxfp8_block32.safetensors",
    ),
    (
        "Kijai/LTX2.3_comfy",
        "vae/LTX23_audio_vae_bf16.safetensors",
        "vae/LTX23_audio_vae_bf16.safetensors",
    ),
    (
        "Kijai/LTX2.3_comfy",
        "vae/LTX23_video_vae_bf16.safetensors",
        "vae/LTX23_video_vae_bf16.safetensors",
    ),
    (
        "Kijai/LTX2.3_comfy",
        "text_encoders/ltx-2.3_text_projection_bf16.safetensors",
        "text_encoders/ltx-2.3_text_projection_bf16.safetensors",
    ),
    (
        "Comfy-Org/ltx-2",
        "split_files/text_encoders/gemma_3_12B_it_fp4_mixed.safetensors",
        "text_encoders/gemma_3_12B_it_fp4_mixed.safetensors",
    ),
)


@app.function(
    image=director_image,
    timeout=7200,
    volumes={COMFY_MODELS: model_volume},
)
def prepare_director_models() -> dict:
    """Download the Director model set once, without allocating a GPU."""
    from huggingface_hub import hf_hub_download

    downloaded: list[str] = []
    skipped: list[str] = []
    staging = Path(COMFY_MODELS) / ".downloads"
    staging.mkdir(parents=True, exist_ok=True)

    for repo_id, remote_name, target_name in MODEL_SPECS:
        target = Path(COMFY_MODELS) / target_name
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.is_file() and target.stat().st_size > 0:
            print(f"[LTX Director] Model already present: {target_name}")
            skipped.append(target_name)
            continue

        print(f"[LTX Director] Downloading {repo_id}/{remote_name}")
        source = Path(
            hf_hub_download(
                repo_id=repo_id,
                filename=remote_name,
                local_dir=str(staging),
            )
        )
        shutil.move(str(source), str(target))
        model_volume.commit()
        downloaded.append(target_name)
        print(f"[LTX Director] Saved {target_name}")

    return {"downloaded": downloaded, "skipped": skipped}


def _required_model_paths() -> list[Path]:
    return [Path(COMFY_MODELS) / target_name for _, _, target_name in MODEL_SPECS]


def _send_webhook(webhook_url: str | None, payload: dict) -> None:
    if not webhook_url:
        return
    import httpx

    try:
        response = httpx.post(webhook_url, json=payload, timeout=20.0, follow_redirects=True)
        response.raise_for_status()
    except Exception as error:
        print(f"[LTX Director] Webhook failed: {error}")


@app.cls(
    image=director_image,
    gpu=DIRECTOR_GPU,
    timeout=1800,
    scaledown_window=300,
    volumes={COMFY_MODELS: model_volume, DIRECTOR_OUTPUT: output_volume},
)
class LTXDirectorGenerator:
    @modal.enter()
    def start_comfyui(self) -> None:
        import httpx

        missing = [str(path.relative_to(COMFY_MODELS)) for path in _required_model_paths() if not path.is_file()]
        if missing:
            raise RuntimeError(
                "LTX Director models are missing from the Modal Volume. Run "
                "`modal run modal/ltx_director_agent.py::prepare_director_models` once before rendering. "
                f"Missing: {', '.join(missing)}"
            )

        Path(COMFY_OUTPUT).mkdir(parents=True, exist_ok=True)
        log_path = Path("/tmp/comfyui-ltx-director.log")
        self._log_handle = log_path.open("a", encoding="utf-8")
        self._comfy = subprocess.Popen(
            [
                "python",
                "main.py",
                "--listen",
                "127.0.0.1",
                "--port",
                "8188",
                "--output-directory",
                COMFY_OUTPUT,
            ],
            cwd=COMFY_ROOT,
            stdout=self._log_handle,
            stderr=subprocess.STDOUT,
            text=True,
        )

        deadline = time.monotonic() + 240
        last_error = "ComfyUI did not answer"
        while time.monotonic() < deadline:
            if self._comfy.poll() is not None:
                tail = ""
                try:
                    tail = log_path.read_text(encoding="utf-8", errors="replace")[-8000:]
                except Exception:
                    pass
                raise RuntimeError(f"ComfyUI exited during startup.\n{tail}")
            try:
                response = httpx.get("http://127.0.0.1:8188/system_stats", timeout=4.0)
                if response.is_success:
                    print(f"[LTX Director] ComfyUI ready on {DIRECTOR_GPU}.")
                    return
                last_error = f"HTTP {response.status_code}"
            except Exception as error:
                last_error = str(error)
            time.sleep(2.0)

        raise RuntimeError(f"ComfyUI startup timed out: {last_error}")

    @modal.exit()
    def stop_comfyui(self) -> None:
        process = getattr(self, "_comfy", None)
        if process and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=20)
            except subprocess.TimeoutExpired:
                process.kill()
        handle = getattr(self, "_log_handle", None)
        if handle:
            handle.close()

    @modal.method()
    def render_section(self, payload: dict, file_base_url: str) -> dict:
        # Reuse the provider-agnostic workflow translator already committed in
        # gpu/ltx_director_server.py, but execute ComfyUI locally in this Modal GPU
        # container and publish the resulting MP4 through a Modal file endpoint.
        from gpu.ltx_director_server import (
            DirectorRenderRequest,
            _build_workflow,
            _submit,
            _wait_for_output,
        )

        job_id = str(payload.get("job_id") or f"director_{uuid.uuid4().hex[:12]}")
        webhook_url = payload.get("webhook_url")
        try:
            request = DirectorRenderRequest(**{**payload, "job_id": job_id})
            workflow = asyncio.run(_build_workflow(request))
            prompt_id = asyncio.run(_submit(workflow))
            output = asyncio.run(_wait_for_output(prompt_id, timeout_seconds=1700))

            source = Path(COMFY_OUTPUT) / output.get("subfolder", "") / output["filename"]
            source = source.resolve()
            output_root = Path(COMFY_OUTPUT).resolve()
            if output_root not in source.parents or not source.is_file():
                raise RuntimeError(f"ComfyUI output could not be resolved safely: {source}")

            filename = f"director-{uuid.uuid4().hex}.mp4"
            destination = Path(DIRECTOR_OUTPUT) / filename
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)
            output_volume.commit()

            video_url = f"{file_base_url}?filename={filename}"
            result = {
                "status": "completed",
                "job_id": job_id,
                "video_url": video_url,
                "engine": "modal-comfyui-ltx-director",
                "prompt_id": prompt_id,
            }
            _send_webhook(webhook_url, result)
            print(f"[LTX Director] Completed {job_id}: {video_url}")
            return result
        except Exception as error:
            message = f"{type(error).__name__}: {error}"
            print(f"[LTX Director] {job_id} failed: {message}")
            _send_webhook(
                webhook_url,
                {"status": "failed", "job_id": job_id, "error": message},
            )
            raise


@app.function(image=web_image, volumes={DIRECTOR_OUTPUT: output_volume})
@modal.fastapi_endpoint(method="GET")
def get_director_file(filename: str):
    from fastapi.responses import FileResponse, JSONResponse

    safe_name = Path(filename).name
    if safe_name != filename or not safe_name.startswith("director-") or not safe_name.endswith(".mp4"):
        return JSONResponse({"error": "Invalid filename"}, status_code=400)

    output_volume.reload()
    filepath = Path(DIRECTOR_OUTPUT) / safe_name
    if not filepath.is_file():
        return JSONResponse({"error": "Director output not found"}, status_code=404)
    return FileResponse(filepath, media_type="video/mp4", filename=safe_name)


@app.function(image=web_image)
@modal.fastapi_endpoint(method="POST", requires_proxy_auth=REQUIRE_PROXY_AUTH)
def director_generate(payload: dict):
    from fastapi import HTTPException

    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="JSON body is required")

    prompt = str(payload.get("prompt", "")).strip()
    global_prompt = str(payload.get("global_prompt", "")).strip()
    if not prompt or not global_prompt:
        raise HTTPException(status_code=400, detail="prompt and global_prompt are required")

    try:
        duration = float(payload.get("duration", 0))
    except (TypeError, ValueError) as error:
        raise HTTPException(status_code=400, detail="duration must be a number") from error
    if duration <= 0 or duration > 120:
        raise HTTPException(status_code=400, detail="duration must be greater than 0 and at most 120 seconds")

    if bool(payload.get("requires_character")) and not payload.get("conditioning_image_url"):
        raise HTTPException(status_code=409, detail="Character conditioning image is required")

    job_id = str(payload.get("job_id") or f"director_{uuid.uuid4().hex[:12]}")
    file_base_url = get_director_file.get_web_url()
    if not file_base_url:
        raise HTTPException(status_code=503, detail="Modal Director file endpoint is unavailable")

    call = LTXDirectorGenerator().render_section.spawn(
        payload={**payload, "job_id": job_id, "duration": duration},
        file_base_url=file_base_url,
    )
    return {
        "status": "accepted",
        "job_id": job_id,
        "call_id": call.object_id,
        "engine": "modal-comfyui-ltx-director",
        "gpu": DIRECTOR_GPU,
    }
