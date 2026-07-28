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
export async function stitchVideoSegments(projectId: string, videos: string[]): Promise<{ url: string }> {
  if (!videos.length) throw new Error("At least one video segment is required to stitch a section.");
  if (videos.length === 1) return { url: videos[0]! };
  if (videos.length > 40) throw new Error("A Director section cannot contain more than 40 internal generation segments.");

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

  resolved.forEach((item, index) => {
    inputs.push("-i", item.resolvedPath);
    filters.push(`[${index}:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p,setpts=PTS-STARTPTS[s${index}]`);
    concatInputs.push(`[s${index}]`);
  });
  filters.push(`${concatInputs.join("")}concat=n=${resolved.length}:v=1:a=0[outv]`);

  await runFfmpeg([
    ...inputs,
    "-filter_complex", filters.join(";"),
    "-map", "[outv]",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-y",
    outputPath,
  ]);

  const { publicUrl } = await storage.saveRender(outputPath, outputName, "video/mp4");
  if (config.STORAGE_BACKEND === "s3") await unlink(outputPath).catch(() => {});
  return { url: publicUrl };
}
