from __future__ import annotations

import asyncio
import base64
import copy
import json
import os
import secrets
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import httpx
from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field, model_validator

ROOT = Path(__file__).resolve().parent
TEMPLATE_PATH = Path(os.getenv("LTX_DIRECTOR_WORKFLOW", ROOT / "workflows" / "ltx23_director_api.json"))
COMFYUI_URL = os.getenv("COMFYUI_URL", "http://127.0.0.1:8188").rstrip("/")
PUBLIC_BASE_URL = os.getenv("DIRECTOR_PUBLIC_BASE_URL", "").rstrip("/")
DIRECTOR_TOKEN = os.getenv("LTX_DIRECTOR_TOKEN", "")
DEFAULT_WIDTH = int(os.getenv("DIRECTOR_WIDTH", "720"))
DEFAULT_HEIGHT = int(os.getenv("DIRECTOR_HEIGHT", "1280"))
MAX_REFERENCE_BYTES = 12 * 1024 * 1024

app = FastAPI(title="Music Video Studio LTX Director Engine")
_background: set[asyncio.Task[Any]] = set()


class DirectorSegment(BaseModel):
    prompt: str = Field(min_length=1)
    start: float = Field(ge=0)
    end: float = Field(gt=0)

    @model_validator(mode="after")
    def validate_range(self):
        if self.end <= self.start:
            raise ValueError("segment end must be after start")
        return self


class DirectorRenderRequest(BaseModel):
    job_id: str = Field(min_length=1, max_length=200)
    webhook_url: str | None = None
    project_id: str | None = None
    clip_id: str = Field(min_length=1, max_length=200)
    section_label: str = Field(default="Section", max_length=300)
    global_prompt: str = Field(min_length=1)
    prompt: str = Field(min_length=1)
    duration: float = Field(gt=0, le=120)
    segments: list[DirectorSegment] = Field(default_factory=list)
    conditioning_image_url: str | None = None
    requires_character: bool = False
    width: int = Field(default=DEFAULT_WIDTH, ge=256, le=2048)
    height: int = Field(default=DEFAULT_HEIGHT, ge=256, le=2048)
    fps: float = Field(default=24, ge=1, le=60)
    seed: int | None = None
    epsilon: float = Field(default=0.99, ge=0.0001, le=0.99)

    @model_validator(mode="after")
    def require_character_reference(self):
        if self.requires_character and not self.conditioning_image_url:
            raise ValueError("character conditioning is required but no conditioning image was supplied")
        return self


def _authorize(authorization: str | None) -> None:
    if not DIRECTOR_TOKEN:
        return
    expected = f"Bearer {DIRECTOR_TOKEN}"
    if not authorization or not secrets.compare_digest(authorization, expected):
        raise HTTPException(status_code=401, detail="Unauthorized")


def _template() -> dict[str, Any]:
    if not TEMPLATE_PATH.is_file():
        raise RuntimeError(f"LTX Director API workflow template not found: {TEMPLATE_PATH}")
    return json.loads(TEMPLATE_PATH.read_text(encoding="utf-8"))


def _frame_segments(req: DirectorRenderRequest) -> tuple[list[dict[str, Any]], list[str], list[int]]:
    fps = float(req.fps)
    total_frames = max(9, int(round(req.duration * fps)))
    source = req.segments or [DirectorSegment(prompt=req.prompt, start=0.0, end=req.duration)]
    text_segments: list[dict[str, Any]] = []
    prompts: list[str] = []
    lengths: list[int] = []

    cursor = 0
    for index, segment in enumerate(source):
        start = max(0, min(total_frames - 1, int(round(segment.start * fps))))
        end = max(start + 1, min(total_frames, int(round(segment.end * fps))))
        if index == 0 and start > 0:
            start = 0
        if start < cursor:
            start = cursor
        length = max(1, end - start)
        cursor = start + length
        text_segments.append({
            "id": f"text-{index}",
            "start": start,
            "length": length,
            "prompt": segment.prompt.strip(),
            "type": "text",
            "isEndFrame": False,
        })
        prompts.append(segment.prompt.strip())
        lengths.append(length)

    if text_segments:
        used = sum(lengths)
        if used != total_frames:
            lengths[-1] = max(1, lengths[-1] + (total_frames - used))
            text_segments[-1]["length"] = lengths[-1]
    return text_segments, prompts, lengths


async def _image_data_url(url: str) -> str:
    async with httpx.AsyncClient(timeout=45.0, follow_redirects=True) as client:
        response = await client.get(url)
        response.raise_for_status()
        content_type = response.headers.get("content-type", "image/jpeg").split(";")[0]
        if not content_type.startswith("image/"):
            raise ValueError("conditioning reference did not return an image")
        data = response.content
        if len(data) > MAX_REFERENCE_BYTES:
            raise ValueError("conditioning reference exceeds 12 MB")
        return f"data:{content_type};base64,{base64.b64encode(data).decode('ascii')}"


async def _build_workflow(req: DirectorRenderRequest) -> dict[str, Any]:
    workflow = copy.deepcopy(_template())
    director = workflow["46"]["inputs"]
    text_segments, prompts, lengths = _frame_segments(req)
    total_frames = max(9, int(round(req.duration * req.fps)))
    timeline_segments = list(text_segments)
    guide_strength = ""

    if req.conditioning_image_url:
        timeline_segments.append({
            "id": "approved-reference",
            "start": 0,
            "length": 1,
            "type": "image",
            "imageB64": await _image_data_url(req.conditioning_image_url),
            "isEndFrame": False,
        })
        guide_strength = "1.0"

    timeline = {
        "mainTrackEnabled": True,
        "audioTrackEnabled": True,
        "motionTrackEnabled": False,
        "global_prompt": req.global_prompt,
        "retake_global_prompt": "",
        "retakeMode": False,
        "retakeStart": 0,
        "retakeLength": 0,
        "retakePrompt": "",
        "retakeStrength": 1,
        "retakeVideo": None,
        "normalStartFrame": 0,
        "normalDurationFrames": total_frames,
        "segments": timeline_segments,
        "motionSegments": [],
        "audioSegments": [],
    }

    director.update({
        "global_prompt": req.global_prompt,
        "start_second": 0.0,
        "end_second": req.duration,
        "duration_seconds": req.duration,
        "start_frame": 0,
        "end_frame": total_frames,
        "duration_frames": total_frames,
        "timeline_data": json.dumps(timeline, separators=(",", ":")),
        "local_prompts": " | ".join(prompts),
        "segment_lengths": ",".join(str(value) for value in lengths),
        "guide_strength": guide_strength,
        "epsilon": req.epsilon,
        "frame_rate": req.fps,
        "custom_width": req.width,
        "custom_height": req.height,
    })
    workflow["28"]["inputs"]["noise_seed"] = req.seed if req.seed is not None else secrets.randbelow(2**31 - 1)
    workflow["98"]["inputs"]["filename_prefix"] = f"MVS Director/{req.job_id}"
    return workflow


async def _submit(workflow: dict[str, Any]) -> str:
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(f"{COMFYUI_URL}/prompt", json={"prompt": workflow})
        response.raise_for_status()
        data = response.json()
    prompt_id = data.get("prompt_id")
    if not prompt_id:
        raise RuntimeError(f"ComfyUI accepted no prompt id: {data}")
    node_errors = data.get("node_errors") or {}
    if node_errors:
        raise RuntimeError(f"ComfyUI workflow validation failed: {json.dumps(node_errors)[:4000]}")
    return str(prompt_id)


def _find_mp4(value: Any) -> dict[str, str] | None:
    if isinstance(value, dict):
        filename = value.get("filename")
        if isinstance(filename, str) and filename.lower().endswith(".mp4"):
            return {
                "filename": filename,
                "subfolder": str(value.get("subfolder") or ""),
                "type": str(value.get("type") or "output"),
            }
        for nested in value.values():
            found = _find_mp4(nested)
            if found:
                return found
    elif isinstance(value, list):
        for nested in value:
            found = _find_mp4(nested)
            if found:
                return found
    return None


async def _wait_for_output(prompt_id: str, timeout_seconds: float = 1800) -> dict[str, str]:
    deadline = asyncio.get_running_loop().time() + timeout_seconds
    async with httpx.AsyncClient(timeout=30.0) as client:
        while asyncio.get_running_loop().time() < deadline:
            response = await client.get(f"{COMFYUI_URL}/history/{prompt_id}")
            response.raise_for_status()
            history = response.json()
            item = history.get(prompt_id)
            if item:
                status = item.get("status") or {}
                if status.get("status_str") == "error":
                    raise RuntimeError(f"ComfyUI generation failed: {json.dumps(status)[:4000]}")
                output = _find_mp4(item.get("outputs") or {})
                if output:
                    return output
            await asyncio.sleep(2.5)
    raise TimeoutError("LTX Director generation timed out after 30 minutes")


def _public_file_url(file_info: dict[str, str]) -> str:
    query = urlencode(file_info)
    if PUBLIC_BASE_URL:
        return f"{PUBLIC_BASE_URL}/files?{query}"
    return f"/files?{query}"


async def _send_webhook(url: str | None, payload: dict[str, Any]) -> None:
    if not url:
        return
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(url, json=payload)
            response.raise_for_status()
    except Exception as error:
        print(f"[LTX Director] webhook failed: {error}")


async def _run(req: DirectorRenderRequest) -> None:
    try:
        workflow = await _build_workflow(req)
        prompt_id = await _submit(workflow)
        output = await _wait_for_output(prompt_id)
        await _send_webhook(req.webhook_url, {
            "status": "completed",
            "job_id": req.job_id,
            "video_url": _public_file_url(output),
        })
    except Exception as error:
        message = f"{type(error).__name__}: {error}"
        print(f"[LTX Director] {req.job_id} failed: {message}")
        await _send_webhook(req.webhook_url, {
            "status": "failed",
            "job_id": req.job_id,
            "error": message,
        })


@app.get("/health")
async def health() -> dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"{COMFYUI_URL}/system_stats")
        comfy_ready = response.is_success
    except Exception:
        comfy_ready = False
    return {"ok": True, "comfyui": comfy_ready, "workflow": str(TEMPLATE_PATH)}


@app.post("/render-section")
async def render_section(req: DirectorRenderRequest, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    _authorize(authorization)
    task = asyncio.create_task(_run(req))
    _background.add(task)
    task.add_done_callback(_background.discard)
    return {"status": "accepted", "job_id": req.job_id, "engine": "comfyui-ltx-director"}


@app.get("/files")
async def files(
    filename: str = Query(min_length=1),
    subfolder: str = "",
    type: str = "output",
    authorization: str | None = Header(default=None),
) -> Response:
    # Browser playback cannot reliably send the engine bearer token, so this route
    # is intentionally public when DIRECTOR_PUBLIC_BASE_URL is exposed. Keep the
    # bridge behind a private network or signed reverse proxy in production.
    params = {"filename": Path(filename).name, "subfolder": subfolder, "type": type}
    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.get(f"{COMFYUI_URL}/view", params=params)
        if not response.is_success:
            raise HTTPException(status_code=response.status_code, detail="ComfyUI output not found")
        media_type = response.headers.get("content-type", "video/mp4")
        return Response(content=response.content, media_type=media_type)
