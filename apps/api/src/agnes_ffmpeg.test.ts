import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

import { normalizeGeneratedVisual, probeDuration } from "./ffmpeg.ts";

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr)));
  });
}

function probeJson(path: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name,pix_fmt,width,height:format=duration", "-of", "json", path], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(stderr)));
  });
}

test("normalizeGeneratedVisual hard-trims without generated audio", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agnes-ffmpeg-test-"));
  try {
    const source = join(dir, "source.mp4");
    const output = join(dir, "output.mp4");
    await run("ffmpeg", [
      "-y",
      "-f", "lavfi", "-i", "testsrc2=size=1152x768:rate=24:duration=6.2",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=6.2",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
      source,
    ]);

    await normalizeGeneratedVisual(source, output, 5.3, "16:9");

    const duration = await probeDuration(output);
    assert.ok(Math.abs(duration - 5.3) <= 0.05, `duration was ${duration}`);
    const metadata = await probeJson(output);
    const video = metadata.streams.find((stream: any) => stream.codec_type === "video");
    const audio = metadata.streams.find((stream: any) => stream.codec_type === "audio");
    assert.equal(video.codec_name, "h264");
    assert.equal(video.pix_fmt, "yuv420p");
    assert.equal(video.width, 1280);
    assert.equal(video.height, 720);
    assert.equal(audio, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("normalizeGeneratedVisual preserves a sub-five-second portrait slot without stretching", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agnes-ffmpeg-short-test-"));
  try {
    const source = join(dir, "source.mp4");
    const output = join(dir, "output.mp4");
    await run("ffmpeg", [
      "-y",
      "-f", "lavfi", "-i", "testsrc2=size=768x1152:rate=24:duration=3.2",
      "-c:v", "libx264", "-pix_fmt", "yuv420p",
      source,
    ]);

    await normalizeGeneratedVisual(source, output, 2.75, "9:16");

    const duration = await probeDuration(output);
    assert.ok(Math.abs(duration - 2.75) <= 0.05, `duration was ${duration}`);
    const metadata = await probeJson(output);
    const video = metadata.streams.find((stream: any) => stream.codec_type === "video");
    const audio = metadata.streams.find((stream: any) => stream.codec_type === "audio");
    assert.equal(video.codec_name, "h264");
    assert.equal(video.pix_fmt, "yuv420p");
    assert.equal(video.width, 720);
    assert.equal(video.height, 1280);
    assert.equal(audio, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
