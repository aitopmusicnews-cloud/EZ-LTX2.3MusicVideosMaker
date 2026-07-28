import { join } from "node:path";
import { mkdir, unlink } from "node:fs/promises";
import { paths, storage } from "./storage.js";
import { config } from "./config.js";
import { runFfmpeg } from "./ffmpeg.js";
import { assertSafeHost } from "./net.js";
import { resolveLocalPath } from "./paths.js";

export type SocialExportPreset = "vertical" | "square" | "landscape";

const PRESETS: Record<SocialExportPreset, { width: number; height: number; label: string }> = {
  vertical: { width: 1080, height: 1920, label: "Vertical 9:16" },
  square: { width: 1080, height: 1080, label: "Square 1:1" },
  landscape: { width: 1280, height: 720, label: "Landscape 16:9" },
};

function safeToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "project";
}

/**
 * Create a social-ready MP4 without consuming generation credits.
 *
 * Vertical and square exports preserve the complete 16:9 master in the center
 * and use a blurred edge-fill background rather than destructively cropping the
 * composition. Landscape keeps the normal master framing.
 */
export async function exportSocialVideo(
  projectId: string,
  videoUrl: string,
  preset: SocialExportPreset,
): Promise<{ url: string; preset: SocialExportPreset; label: string; width: number; height: number }> {
  const profile = PRESETS[preset];
  if (!profile) throw new Error(`Unknown social export preset: ${preset}`);

  const local = resolveLocalPath(videoUrl);
  if (!local && /^https?:\/\//i.test(videoUrl)) await assertSafeHost(videoUrl);
  const input = local ?? videoUrl;

  await mkdir(paths.RENDERS, { recursive: true });
  const outputName = `${safeToken(projectId)}-social-${preset}-${Date.now()}.mp4`;
  const outputPath = join(paths.RENDERS, outputName);
  const { width, height } = profile;

  const filter = preset === "landscape"
    ? `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p[outv]`
    : `[0:v]split=2[bg][fg];` +
      `[bg]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=20:1[bgv];` +
      `[fg]scale=${width}:${height}:force_original_aspect_ratio=decrease[fgv];` +
      `[bgv][fgv]overlay=(W-w)/2:(H-h)/2:shortest=1,setsar=1,format=yuv420p[outv]`;

  await runFfmpeg([
    "-i", input,
    "-filter_complex", filter,
    "-map", "[outv]",
    "-map", "0:a?",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-c:a", "aac",
    "-b:a", "192k",
    "-r", "30",
    "-movflags", "+faststart",
    "-y",
    outputPath,
  ]);

  const { publicUrl } = await storage.saveRender(outputPath, outputName, "video/mp4");
  if (config.STORAGE_BACKEND === "s3") await unlink(outputPath).catch(() => {});

  return { url: publicUrl, preset, label: profile.label, width, height };
}
