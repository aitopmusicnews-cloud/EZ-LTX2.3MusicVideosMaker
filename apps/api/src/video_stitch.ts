import { join } from "node:path";
import { mkdir, unlink } from "node:fs/promises";
import { paths, storage } from "./storage.js";
import { config } from "./config.js";
import { runFfmpeg } from "./ffmpeg.js";
import { assertSafeHost } from "./net.js";
import { resolveLocalPath } from "./paths.js";

function safeProjectToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 120) || "section";
}

/** Stitch silent/generated video segments into one logical Director section. */
export async function stitchVideoSegments(
  projectId: string,
  videos: string[],
  options?: { aspectRatio?: string; targetDuration?: number; fps?: number },
): Promise<{ url: string }> {
  if (!videos.length) throw new Error("At least one video segment is required to stitch a section.");
  if (videos.length === 1) return { url: videos[0]! };

  const resolved = videos.map((videoUrl) => ({
    videoUrl,
    resolvedPath: resolveLocalPath(videoUrl) ?? videoUrl,
    isLocal: Boolean(resolveLocalPath(videoUrl)),
  }));
  for (const item of resolved) {
    if (!item.isLocal && /^https?:\/\//i.test(item.videoUrl)) await assertSafeHost(item.videoUrl);
  }

  await mkdir(paths.RENDERS, { recursive: true });
  const outputName = `${safeProjectToken(projectId)}-section-${Date.now()}.mp4`;
  const outputPath = join(paths.RENDERS, outputName);
  const inputs: string[] = [];
  const filters: string[] = [];
  const concatInputs: string[] = [];
  const aspectRatio = options?.aspectRatio ?? "16:9";
  const { width, height } = aspectRatio === "9:16"
    ? { width: 720, height: 1280 }
    : aspectRatio === "1:1"
      ? { width: 720, height: 720 }
      : aspectRatio === "4:3"
        ? { width: 960, height: 720 }
        : { width: 1280, height: 720 };
  const fps = options?.fps ?? 30;

  resolved.forEach((item, index) => {
    inputs.push("-i", item.resolvedPath);
    filters.push(`[${index}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=${fps},format=yuv420p,setpts=PTS-STARTPTS[s${index}]`);
    concatInputs.push(`[s${index}]`);
  });
  filters.push(`${concatInputs.join("")}concat=n=${resolved.length}:v=1:a=0[outv]`);

  const outputArgs = [
    ...inputs,
    "-filter_complex", filters.join(";"),
    "-map", "[outv]",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
  ];
  if (options?.targetDuration != null) {
    if (!Number.isFinite(options.targetDuration) || options.targetDuration <= 0) {
      throw new Error("stitched generated video duration must be positive");
    }
    outputArgs.push("-t", options.targetDuration.toFixed(6));
  }
  outputArgs.push("-y", outputPath);

  await runFfmpeg(outputArgs);

  const { publicUrl } = await storage.saveRender(outputPath, outputName, "video/mp4");
  if (config.STORAGE_BACKEND === "s3") await unlink(outputPath).catch(() => {});
  return { url: publicUrl };
}
