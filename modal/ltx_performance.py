"""Audio-driven LTX-2.3 singing-performance worker for Modal.

This worker is intentionally separate from the existing image-to-video and
LipDub workers. It uses the official A2Vid two-stage pipeline:

    reference image + selected song segment + performance prompt -> MP4

Deploy:
    modal deploy modal/ltx_performance.py

Required Modal secret:
    modal secret create huggingface HF_TOKEN=hf_...

The first cold start downloads the LTX-2.3 dev checkpoint, distilled LoRA,
spatial upscaler, Gemma encoder, and the optional talking-head AV LoRA.
"""

from __future__ import annotations

import base64
import json
import os
import shutil
import subprocess
import sys
import uuid
from pathlib import Path
from typing import Any

import modal

app = modal.App("mvs-ltx-performance")

MODEL_DIR = Path("/models")
OUTPUT_DIR = Path("/outputs")
LTX_MODEL_DIR = MODEL_DIR / "ltx-2.3"
GEMMA_DIR = MODEL_DIR / "gemma-3-12b-ltx"
LORA_DIR = MODEL_DIR / "talking-head-lora"

GEMMA_REPO_ID = "Lightricks/gemma-3-12b-it-qat-q4_0-unquantized"
CHECKPOINT_NAME = "ltx-2.3-22b-dev.safetensors"
DISTILLED_LORA_NAME = "ltx-2.3-22b-distilled-lora-384-1.1.safetensors"
UPSCALER_NAME = "ltx-2.3-spatial-upscaler-x2-1.1.safetensors"
TALKING_HEAD_REPO_ID = "elix3r/LTX-2.3-22b-AV-LoRA-talking-head"
TALKING_HEAD_NAME = "LTX-2.3-22b-AV-LoRA-talking-head-v1.safetensors"

GEMMA_SHARDS = tuple(f"model-{index:05d}-of-00005.safetensors" for index in range(1, 6))
GEMMA_REQUIRED_FILES = (
    "config.json",
    "model.safetensors.index.json",
    "preprocessor_config.json",
    "processor_config.json",
    "tokenizer.json",
    "tokenizer.model",
    "tokenizer_config.json",
    *GEMMA_SHARDS,
)

model_volume = modal.Volume.from_name("mvs-ltx23-performance-models", create_if_missing=True)
output_volume = modal.Volume.from_name("mvs-ltx23-performance-outputs", create_if_missing=True)
hf_secret = modal.Secret.from_name("huggingface", required_keys=["HF_TOKEN"])

web_image = modal.Image.debian_slim(python_version="3.12").pip_install(
    "fastapi[standard]>=0.115.8",
)

performance_image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("build-essential", "ffmpeg", "git")
    .pip_install(
        "uv>=0.8.0",
        "fastapi[standard]>=0.115.8",
        "httpx>=0.27.2",
        "huggingface_hub>=0.36.0",
        "hf_xet>=1.1.0",
        "safetensors>=0.5.0",
    )
    .run_commands(
        "git clone --depth 1 https://github.com/Lightricks/LTX-2.git /opt/LTX-2",
        "printf 'torch==2.7.1\\ntorchvision==0.22.1\\ntorchaudio==2.7.1\\n' > /tmp/torch-constraints.txt",
        "uv pip install --system torch==2.7.1 torchvision==0.22.1 torchaudio==2.7.1 --index-url https://download.pytorch.org/whl/cu128",
        "cd /opt/LTX-2 && uv pip install --system -c /tmp/torch-constraints.txt -e packages/ltx-core -e packages/ltx-pipelines",
        "python -c \"import torch, torchvision, torchaudio; print('torch', torch.__version__, 'cuda', torch.version.cuda, 'torchvision', torchvision.__version__, 'torchaudio', torchaudio.__version__)\"",
    )
    .env(
        {
            "HF_HOME": str(MODEL_DIR),
            "HF_HUB_CACHE": str(MODEL_DIR / "hub"),
            "HF_XET_HIGH_PERFORMANCE": "1",
            "TOKENIZERS_PARALLELISM": "false",
            "PYTORCH_CUDA_ALLOC_CONF": "expandable_segments:True",
            "CUDA_MODULE_LOADING": "LAZY",
        }
    )
)


def _run(command: list[str], *, timeout: int | None = None) -> None:
    completed = subprocess.run(
        command,
        check=False,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    if completed.stdout:
        print(completed.stdout)
    if completed.stderr:
        print(completed.stderr)
    if completed.returncode != 0:
        combined = "\n".join(part for part in (completed.stdout, completed.stderr) if part)
        tail = (combined or "unknown command failure")[-20_000:]
        raise RuntimeError(f"Command failed ({completed.returncode}): {tail}")


def _safe_filename(value: Any, default: str) -> str:
    candidate = Path(str(value or default)).name
    return candidate or default


def _write_media(payload: dict[str, Any], kind: str, work_dir: Path) -> Path:
    encoded = payload.get(f"{kind}_base64")
    remote_url = payload.get(f"{kind}_url")
    default_suffix = ".png" if kind == "image" else ".wav"
    filename = _safe_filename(payload.get(f"{kind}_filename"), f"{kind}{default_suffix}")
    if not Path(filename).suffix:
        filename += default_suffix
    target = work_dir / filename

    if encoded:
        try:
            raw = base64.b64decode(str(encoded), validate=True)
        except Exception as error:  # noqa: BLE001
            raise ValueError(f"Invalid {kind}_base64 payload") from error
        if not raw:
            raise ValueError(f"{kind}_base64 payload is empty")
        target.write_bytes(raw)
        return target

    if not remote_url:
        raise ValueError(f"{kind}_url or {kind}_base64 is required")

    import httpx

    delays = (0, 2, 5)
    last_error: Exception | None = None
    for attempt, delay in enumerate(delays, start=1):
        if delay:
            import time

            time.sleep(delay)
        try:
            with httpx.stream(
                "GET",
                str(remote_url),
                follow_redirects=True,
                timeout=180.0,
            ) as response:
                response.raise_for_status()
                with target.open("wb") as handle:
                    for chunk in response.iter_bytes():
                        handle.write(chunk)
            if not target.is_file() or target.stat().st_size == 0:
                raise RuntimeError(f"Downloaded {kind} is empty")
            print(f"[Performance] Downloaded {kind} on attempt {attempt}/{len(delays)}")
            return target
        except Exception as error:  # noqa: BLE001
            last_error = error
            target.unlink(missing_ok=True)
            print(f"[Performance] {kind} download attempt {attempt} failed: {error}")

    raise RuntimeError(f"Could not download {kind}: {last_error}")


def _send_webhook(webhook_url: str | None, payload: dict[str, Any]) -> None:
    if not webhook_url:
        print("[Performance webhook] No callback URL supplied")
        return

    import time

    import httpx

    delays = (0, 5, 10, 20, 40, 60)
    for attempt, delay in enumerate(delays, start=1):
        if delay:
            time.sleep(delay)
        try:
            response = httpx.post(
                webhook_url,
                json=payload,
                timeout=45.0,
                follow_redirects=True,
            )
            if response.is_success:
                print(
                    f"[Performance webhook] Callback delivered on attempt "
                    f"{attempt}: {response.status_code}"
                )
                return
            print(
                f"[Performance webhook] Attempt {attempt} returned "
                f"{response.status_code}: {response.text[:500]}"
            )
        except Exception as error:  # noqa: BLE001
            print(
                f"[Performance webhook] Attempt {attempt} failed: "
                f"{type(error).__name__}: {error}"
            )

    print("[Performance webhook] Callback failed after all retry attempts")


def _gemma_snapshot_error(root: Path) -> str | None:
    missing = [name for name in GEMMA_REQUIRED_FILES if not (root / name).is_file()]
    if missing:
        return f"missing files: {', '.join(missing)}"

    undersized = [
        shard
        for shard in GEMMA_SHARDS
        if (root / shard).stat().st_size < 1_000_000_000
    ]
    if undersized:
        return f"incomplete model shards: {', '.join(undersized)}"

    try:
        index = json.loads((root / "model.safetensors.index.json").read_text())
        referenced = set(index.get("weight_map", {}).values())
        missing_references = sorted(
            name for name in referenced if not (root / name).is_file()
        )
        if missing_references:
            return f"index references missing shards: {', '.join(missing_references)}"
    except Exception as error:  # noqa: BLE001
        return f"invalid model index: {error}"

    return None


def _download_valid_gemma(snapshot_download, token: str) -> None:
    error = _gemma_snapshot_error(GEMMA_DIR) if GEMMA_DIR.exists() else "snapshot not present"
    if error:
        print(f"[Performance] Rebuilding Gemma cache ({error})")
        shutil.rmtree(GEMMA_DIR, ignore_errors=True)
        GEMMA_DIR.mkdir(parents=True, exist_ok=True)
        snapshot_download(
            repo_id=GEMMA_REPO_ID,
            local_dir=str(GEMMA_DIR),
            token=token,
            allow_patterns=list(GEMMA_REQUIRED_FILES),
            max_workers=8,
        )
    error = _gemma_snapshot_error(GEMMA_DIR)
    if error:
        raise RuntimeError(f"Gemma snapshot validation failed after download: {error}")


@app.cls(
    image=performance_image,
    gpu="A100-80GB",
    cpu=16.0,
    memory=131072,
    timeout=7200,
    scaledown_window=900,
    secrets=[hf_secret],
    volumes={str(MODEL_DIR): model_volume, str(OUTPUT_DIR): output_volume},
)
class PerformanceRunner:
    @modal.enter()
    def prepare_models(self) -> None:
        from huggingface_hub import hf_hub_download, snapshot_download

        token = os.environ.get("HF_TOKEN")
        if not token:
            raise RuntimeError("HF_TOKEN is missing from the Modal 'huggingface' secret")

        LTX_MODEL_DIR.mkdir(parents=True, exist_ok=True)
        LORA_DIR.mkdir(parents=True, exist_ok=True)
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

        print("[Performance] Ensuring LTX-2.3 A2Vid model files are cached...")
        self.checkpoint_path = Path(
            hf_hub_download(
                repo_id="Lightricks/LTX-2.3",
                filename=CHECKPOINT_NAME,
                local_dir=str(LTX_MODEL_DIR),
                token=token,
            )
        )
        self.distilled_lora_path = Path(
            hf_hub_download(
                repo_id="Lightricks/LTX-2.3",
                filename=DISTILLED_LORA_NAME,
                local_dir=str(LTX_MODEL_DIR),
                token=token,
            )
        )
        self.upsampler_path = Path(
            hf_hub_download(
                repo_id="Lightricks/LTX-2.3",
                filename=UPSCALER_NAME,
                local_dir=str(LTX_MODEL_DIR),
                token=token,
            )
        )
        _download_valid_gemma(snapshot_download, token)
        model_volume.commit()
        print("[Performance] Models ready.")

    @modal.method()
    def warmup(self) -> dict[str, Any]:
        return {
            "status": "ready",
            "pipeline": "A2VidPipelineTwoStage",
            "talking_head_lora": TALKING_HEAD_NAME,
        }

    @modal.method()
    def generate(self, payload: dict[str, Any]) -> dict[str, Any]:
        import torch

        job_id = str(payload.get("job_id") or f"performance_{uuid.uuid4().hex[:12]}")
        webhook_url = payload.get("webhook_url")
        prompt = str(
            payload.get("prompt")
            or (
                "A close-up music-video performance. The artist sings the supplied "
                "vocal naturally with precise mouth shapes, stable identity, realistic "
                "blinks, subtle head movement, and cinematic lighting."
            )
        ).strip()

        duration = min(5.0, max(1.0, float(payload.get("duration", 5.0))))
        audio_start = max(0.0, float(payload.get("audio_start", 0.0)))
        image_strength = min(1.0, max(0.0, float(payload.get("image_strength", 1.0))))
        lora_strength = min(1.5, max(0.0, float(payload.get("lora_strength", 1.0))))
        use_talking_head_lora = bool(payload.get("use_talking_head_lora", False))
        aspect_ratio = str(payload.get("aspect_ratio") or "16:9")
        seed = int(payload.get("seed", 42))

        frame_rate = 24.0
        requested_frames = round(duration * frame_rate)
        num_frames = ((requested_frames - 1) // 8) * 8 + 1
        num_frames = max(9, min(num_frames, 121))
        if aspect_ratio == "9:16":
            width, height = 512, 768
        else:
            width, height = 768, 512

        work_dir = Path(f"/tmp/{job_id}-{uuid.uuid4().hex[:8]}")
        work_dir.mkdir(parents=True, exist_ok=True)

        try:
            capability = torch.cuda.get_device_capability()
            print(
                f"[Performance] GPU {torch.cuda.get_device_name()}, compute capability "
                f"{capability[0]}.{capability[1]}; BF16 with CPU offload."
            )

            source_image = _write_media(payload, "image", work_dir)
            source_audio = _write_media(payload, "audio", work_dir)
            talking_head_lora_path: Path | None = None
            if use_talking_head_lora:
                from huggingface_hub import hf_hub_download

                token = os.environ.get("HF_TOKEN")
                if not token:
                    raise RuntimeError("HF_TOKEN is required to download the optional talking-head LoRA")
                talking_head_lora_path = Path(
                    hf_hub_download(
                        repo_id=TALKING_HEAD_REPO_ID,
                        filename=TALKING_HEAD_NAME,
                        local_dir=str(LORA_DIR),
                        token=token,
                    )
                )
                model_volume.commit()
            output_name = f"performance-{uuid.uuid4()}.mp4"
            output_path = OUTPUT_DIR / output_name

            if use_talking_head_lora and "OHWXPERSON" not in prompt.upper():
                prompt = f"OHWXPERSON. {prompt}"

            command = [
                sys.executable,
                "-m",
                "ltx_pipelines.a2vid_two_stage",
                "--checkpoint-path",
                str(self.checkpoint_path),
                "--distilled-lora",
                str(self.distilled_lora_path),
                "0.8",
                "--spatial-upsampler-path",
                str(self.upsampler_path),
                "--gemma-root",
                str(GEMMA_DIR),
                "--prompt",
                prompt,
                "--height",
                str(height),
                "--width",
                str(width),
                "--num-frames",
                str(num_frames),
                "--frame-rate",
                str(frame_rate),
                "--image",
                str(source_image),
                "0",
                str(image_strength),
                "--audio-path",
                str(source_audio),
                "--audio-start-time",
                str(audio_start),
                "--audio-max-duration",
                str(num_frames / frame_rate),
                "--seed",
                str(seed),
                "--offload",
                "cpu",
                "--max-batch-size",
                "1",
                "--output-path",
                str(output_path),
            ]
            if use_talking_head_lora and talking_head_lora_path is not None:
                lora_args = [
                    "--lora",
                    str(talking_head_lora_path),
                    str(lora_strength),
                ]
                output_index = command.index("--output-path")
                command[output_index:output_index] = lora_args

            print(
                f"[Performance] Running A2Vid for {job_id}: "
                f"{num_frames} frames, {width}x{height}, "
                f"audio start {audio_start:.2f}s, LoRA={use_talking_head_lora}"
            )
            _run(command, timeout=6600)

            if not output_path.is_file() or output_path.stat().st_size == 0:
                raise RuntimeError("A2Vid pipeline completed without creating an MP4")

            output_volume.commit()
            file_base_url = get_file.get_web_url()
            if not file_base_url:
                raise RuntimeError("Modal performance file endpoint URL is unavailable")
            video_url = f"{file_base_url}?filename={output_name}"
            result = {"status": "completed", "job_id": job_id, "video_url": video_url}
            _send_webhook(webhook_url, result)
            print(f"[Performance] Completed {job_id}: {video_url}")
            return result
        except Exception as error:  # noqa: BLE001
            message = f"{type(error).__name__}: {error}"
            print(f"[Performance] Failed {job_id}: {message}")
            _send_webhook(
                webhook_url,
                {"status": "failed", "job_id": job_id, "error": message},
            )
            raise
        finally:
            shutil.rmtree(work_dir, ignore_errors=True)


@app.function(image=web_image, volumes={str(OUTPUT_DIR): output_volume})
@modal.fastapi_endpoint(method="GET")
def get_file(filename: str):
    from fastapi.responses import FileResponse, JSONResponse

    safe_name = Path(filename).name
    if safe_name != filename or not safe_name.startswith("performance-"):
        return JSONResponse({"error": "Invalid filename"}, status_code=400)
    output_volume.reload()
    path = OUTPUT_DIR / safe_name
    if not path.is_file():
        return JSONResponse({"error": "Performance clip not found"}, status_code=404)
    return FileResponse(path, media_type="video/mp4", filename=safe_name)


@app.function(image=web_image)
@modal.fastapi_endpoint(method="POST")
def performance(payload: dict[str, Any]):
    from fastapi import HTTPException

    if payload.get("action") == "warmup":
        call = PerformanceRunner().warmup.spawn()
        return {"status": "warming", "call_id": call.object_id}

    if not (payload.get("image_url") or payload.get("image_base64")):
        raise HTTPException(status_code=400, detail="image_url or image_base64 is required")
    if not (payload.get("audio_url") or payload.get("audio_base64")):
        raise HTTPException(status_code=400, detail="audio_url or audio_base64 is required")

    job_id = str(payload.get("job_id") or f"performance_{uuid.uuid4().hex[:12]}")
    payload = {**payload, "job_id": job_id}
    call = PerformanceRunner().generate.spawn(payload)
    return {"status": "accepted", "job_id": job_id, "call_id": call.object_id}
