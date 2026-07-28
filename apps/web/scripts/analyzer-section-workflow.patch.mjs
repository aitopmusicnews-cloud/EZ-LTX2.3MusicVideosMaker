export function patchAnalyzerDefinedClips(source) {
  let patched = source;
  if (!patched.includes("export const MAX_CLIP_LEN = 5;")) throw new Error("Could not find the five-second timeline cap.");
  patched = patched.replace("export const MAX_CLIP_LEN = 5;", "export const MAX_CLIP_LEN = Number.POSITIVE_INFINITY;");

  const start = patched.indexOf("function subdivideSection(section: AudioSection, beats: number[]): Clip[] {");
  const end = patched.indexOf("\n\ntype State =", start);
  if (start < 0 || end < 0) throw new Error("Could not find the analyzer section subdivision function.");
  const replacement = `function subdivideSection(section: AudioSection, _beats: number[]): Clip[] {
  const start = Number.isFinite(section.start) ? Number(section.start) : 0;
  const end = Number.isFinite(section.end) ? Number(section.end) : start + MIN_CLIP_LEN;
  if (end <= start) return [];
  return [{
    id: newClipId(),
    start,
    end,
    source: "continue",
    status: "empty",
    sectionLabel: section.label || "Section",
  }];
}`;
  patched = patched.slice(0, start) + replacement + patched.slice(end);

  const oldLoad = `        const clips = analysis.sections.flatMap((s) => subdivideSection(s, analysis.beats));`;
  const newLoad = `        const sourceSections = analysis.sections?.length
          ? analysis.sections
          : [{ label: "Song", start: 0, end: analysis.duration ?? 1 }];
        const clips = sourceSections.flatMap((section) => subdivideSection(section, analysis.beats ?? []));`;
  if (!patched.includes(oldLoad)) throw new Error("Could not find song-to-clip analyzer loading logic.");
  patched = patched.replace(oldLoad, newLoad);
  patched = patched.replace("Clamps to MIN_CLIP_LEN around both sides and the MAX_CLIP_LEN cap.", "Clamps only to the minimum usable clip length; analyzer sections have no five-second timeline cap.");
  patched = patched.replace("// Cap-aware bounds: neither side can grow past MAX_CLIP_LEN.\n          const lo = Math.max(minTime, right.end - MAX_CLIP_LEN);\n          const hi = Math.min(maxTime, left.start + MAX_CLIP_LEN);", "// Analyzer-defined sections may be any practical length.\n          const lo = minTime;\n          const hi = maxTime;");
  patched = patched.replace(`        if (right.end - left.start > MAX_CLIP_LEN) {
          return { ok: false, reason: \`merged clip would exceed \${MAX_CLIP_LEN}s generation cap\` };
        }
`, "");
  return patched;
}

export function patchLongSectionApi(source) {
  const anchor = `export async function startTextToVideo(req: Record<string, any>): Promise<{ id: string }> {
  return jsonOrThrow(await fetch("/api/generate/text-to-video", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  }));
}`;
  if (!source.includes(anchor)) throw new Error("Could not find text-to-video API helper.");
  const addition = `${anchor}

export async function stitchVideoSegments(req: { projectId: string; videos: string[] }): Promise<{ url: string }> {
  return jsonOrThrow(await fetch("/api/videos/stitch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  }));
}`;
  return source.replace(anchor, addition);
}

export function patchLongSectionScheduler(source) {
  let patched = source;
  const apiTail = `  saveClipToServer,
  ApiError,
} from "./api.js";`;
  const apiTailNext = `  saveClipToServer,
  ApiError,
  stitchVideoSegments,
} from "./api.js";`;
  if (!patched.includes("stitchVideoSegments")) {
    if (!patched.includes(apiTail)) throw new Error("Could not add the long-section stitch API to scheduler imports.");
    patched = patched.replace(apiTail, apiTailNext);
  }

  const oldDuration = `      duration: clampDuration(input.duration),`;
  const newDuration = `      duration: Math.max(0.5, Number.isFinite(input.duration) ? input.duration : 5),`;
  if (!patched.includes(oldDuration)) throw new Error("Could not find scheduler duration clamp assignment.");
  patched = patched.replace(oldDuration, newDuration);

  const runAnchor = `async function run(jobId: string): Promise<void> {`;
  if (!patched.includes(runAnchor)) throw new Error("Could not find scheduler run function.");
  const helpers = `async function generateProviderSegment(job: Job, source: LtxGenerationSource, seedImageUrl: string, duration: number): Promise<string> {
  const promptText = job.input.prompt.trim();
  const providerDuration = Math.min(5, Math.max(1, duration));
  let task: { id: string };
  if (source === "textToVideo") {
    task = await startTextToVideo({ promptText, model: "ltx-video", ratio: "3:2", duration: providerDuration });
  } else {
    const firstFrame = source === "continue" ? await resolvePreviousFrame(job) : seedImageUrl;
    if (!firstFrame) throw new Error("Image-to-video requires a first-frame reference");
    task = await startImageToVideo({ promptImage: firstFrame, promptText, ratio: "3:2", duration: providerDuration, model: "ltx-video" });
  }
  setJobPatch(job.id, { taskId: task.id });
  useStore.getState().updateClip(job.clipId, { generationTaskId: task.id });
  const final = await pollTask(task.id, 5000, 900_000);
  if (isCancelled(job.id)) throw new Error("Director section generation was cancelled.");
  const videoUrl = taskOutputUrl(final);
  if (!taskSucceeded(final) || !videoUrl) throw new Error(final.error ?? \`task ended in \${final.status} with no video\`);
  return videoUrl;
}

async function generateLogicalSection(job: Job): Promise<string> {
  const logicalDuration = Math.max(0.5, job.input.duration);
  const segmentCount = Math.max(1, Math.ceil(logicalDuration / 5));
  const segmentDuration = logicalDuration / segmentCount;
  const videos: string[] = [];
  let source = job.input.source;
  let seedImageUrl = job.input.seedImageUrl;

  for (let index = 0; index < segmentCount; index += 1) {
    if (index > 0) {
      seedImageUrl = (await extractLastFrame(videos[index - 1]!)).url;
      source = "imageToVideo";
    }
    videos.push(await generateProviderSegment(job, source, seedImageUrl, segmentDuration));
  }

  if (videos.length === 1) return videos[0]!;
  const projectId = useStore.getState().projectId ?? "director";
  const stitched = await stitchVideoSegments({ projectId: \`\${projectId}-\${job.clipId}\`, videos });
  return stitched.url;
}

${runAnchor}`;
  if (!patched.includes("async function generateLogicalSection")) patched = patched.replace(runAnchor, helpers);

  const oldRunBlock = `    const task = await startTask(job);
    setJobPatch(jobId, { taskId: task.id });
    useStore.getState().updateClip(job.clipId, { generationTaskId: task.id });

    if (isCancelled(jobId)) {
      useStore.getState().updateClip(job.clipId, { status: "empty" });
      return;
    }

    const final = await pollTask(task.id, 5000, 900_000);
    if (isCancelled(jobId)) {
      useStore.getState().updateClip(job.clipId, { status: "empty" });
      return;
    }

    const videoUrl = taskOutputUrl(final);
    if (!taskSucceeded(final) || !videoUrl) {
      throw new Error(final.error ?? \`task ended in \${final.status} with no video\`);
    }`;
  const newRunBlock = `    const videoUrl = await generateLogicalSection(job);
    if (isCancelled(jobId)) {
      useStore.getState().updateClip(job.clipId, { status: "empty" });
      return;
    }`;
  if (!patched.includes(oldRunBlock)) throw new Error("Could not replace single-call LTX generation with logical section generation.");
  patched = patched.replace(oldRunBlock, newRunBlock);
  return patched;
}
