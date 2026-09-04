import { chooseApprovedShotSeed } from "./directorCharacterMedia.js";

export type ScriptLockedImageProvider = "current" | "agnes";

export function imageModelForScriptLockedProvider(provider: ScriptLockedImageProvider): string {
  return provider === "agnes" ? "agnes-image-2.1-flash" : "openrouter_image_flash";
}

export type ScriptLockedVideoGenerationInput = {
  clipId: string;
  source: "textToVideo" | "imageToVideo";
  seedImageUrl: string;
  prompt: string;
  duration: number;
  sectionLabel: string;
  energy: number;
  model: "agnes-video-v2.0";
};

export type PreparedScriptLockedVideoGeneration =
  | { ok: true; input: ScriptLockedVideoGenerationInput }
  | { ok: false; reason: string };

function uniqueUrls(values: Array<string | null | undefined>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const url = typeof value === "string" ? value.trim() : "";
    if (!url || seen.has(url)) continue;
    seen.add(url);
    result.push(url);
  }
  return result;
}

export function buildAgnesGenerationInstruction(input: {
  agnesPrompt: string;
  continuityConstraints: string[];
}): string {
  return [
    input.agnesPrompt.trim(),
    ...input.continuityConstraints.map((item) => item.trim()).filter(Boolean),
  ].filter(Boolean).join(" ");
}

export function buildScriptLockedImageReferenceUrls(input: {
  currentImageUrl?: string;
  selectedCharacterUrls: string[];
  sameCharacterAnchorUrl?: string;
  projectAnchorUrl?: string;
}): string[] {
  return uniqueUrls([
    input.currentImageUrl,
    ...input.selectedCharacterUrls,
    input.sameCharacterAnchorUrl,
    input.projectAnchorUrl,
  ]);
}

export function prepareScriptLockedVideoGeneration(input: {
  clipId: string;
  start: number;
  end: number;
  sectionLabel: string;
  agnesPrompt: string;
  continuityConstraints: string[];
  selectedCharacterIds: string[];
  approvedShotImage?: { url: string; approved: boolean };
}): PreparedScriptLockedVideoGeneration {
  const seedImageUrl = chooseApprovedShotSeed(input.approvedShotImage);
  if (input.selectedCharacterIds.length > 0 && !seedImageUrl) {
    return {
      ok: false,
      reason: "Character-selected Script-Locked shots require an approved current shot image before Agnes video generation.",
    };
  }

  const prompt = buildAgnesGenerationInstruction({
    agnesPrompt: input.agnesPrompt,
    continuityConstraints: input.continuityConstraints,
  });
  if (!prompt) return { ok: false, reason: "Compile an Agnes instruction before generation." };

  return {
    ok: true,
    input: {
      clipId: input.clipId,
      source: seedImageUrl ? "imageToVideo" : "textToVideo",
      seedImageUrl: seedImageUrl ?? "",
      prompt,
      duration: Math.max(0, input.end - input.start),
      sectionLabel: input.sectionLabel,
      energy: 0.65,
      model: "agnes-video-v2.0",
    },
  };
}

export function buildScriptLockedVideoSegmentInputs(
  input: ScriptLockedVideoGenerationInput,
  maxDuration = 5,
): ScriptLockedVideoGenerationInput[] {
  const safeDuration = Math.max(0, input.duration);
  const count = Math.max(1, Math.ceil(safeDuration / maxDuration));
  const segmentDuration = safeDuration / count;
  return Array.from({ length: count }, (_, index) => ({
    ...input,
    clipId: index === 0 ? input.clipId : `${input.clipId}-segment-${index + 1}`,
    duration: segmentDuration,
    sectionLabel: count === 1 ? input.sectionLabel : `${input.sectionLabel} · Segment ${index + 1}/${count}`,
  }));
}

function outputImageUrl(task: any): string | undefined {
  if (typeof task?.outputUrl === "string" && task.outputUrl) return task.outputUrl;
  if (Array.isArray(task?.output) && typeof task.output[0] === "string") return task.output[0];
  return task?.output?.imageUrl ?? task?.output?.url;
}

export async function generateScriptLockedShotImage(input: {
  prompt: string;
  referenceUrls: string[];
  name?: string;
  provider?: ScriptLockedImageProvider;
}): Promise<string> {
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error("Compile an Agnes instruction before generating a shot image.");
  const { startTextToImage, pollTask, saveImageToLibrary } = await import("./api.js");
  const referenceImages = uniqueUrls(input.referenceUrls).map((uri) => ({ uri }));
  const model = imageModelForScriptLockedProvider(input.provider ?? "current");
  const { id } = await startTextToImage({
    prompt,
    promptText: prompt,
    model,
    ratio: "1920:1080",
    ...(referenceImages.length ? { referenceImages } : {}),
  });
  const task = await pollTask(id);
  const url = outputImageUrl(task);
  if ((task.status || "").toUpperCase() !== "SUCCEEDED" || !url) {
    throw new Error(task.error ?? "Shot image generation did not return an image.");
  }
  void saveImageToLibrary({
    id: `img-${crypto.randomUUID().slice(0, 8)}`,
    name: (input.name || prompt).slice(0, 60),
    url,
    source: "generated",
    prompt,
    model,
  }).catch((error) => console.warn("Script-Locked shot image library save failed", error));
  return url;
}

export async function queueScriptLockedVideo(input: ScriptLockedVideoGenerationInput): Promise<string[]> {
  const [{ useStore }, { enqueueGeneration }] = await Promise.all([
    import("./store.js"),
    import("./scheduler.js"),
  ]);
  const state = useStore.getState();
  const clips = state.clips;
  const parentIndex = clips.findIndex((clip) => clip.id === input.clipId);
  if (parentIndex < 0) throw new Error(`Script-Locked timeline clip ${input.clipId} is missing.`);
  const parent = clips[parentIndex]!;
  const segments = buildScriptLockedVideoSegmentInputs(input);

  const technicalClips = segments.map((segment, index) => {
    const start = parent.start + segments.slice(0, index).reduce((sum, item) => sum + item.duration, 0);
    const end = index === segments.length - 1 ? parent.end : start + segment.duration;
    return {
      ...parent,
      id: segment.clipId,
      start,
      end,
      source: segment.source,
      model: segment.model,
      sectionLabel: segment.sectionLabel,
      status: "empty" as const,
      prompt: segment.prompt,
      seedImageUrl: segment.seedImageUrl || undefined,
      archetypeUrl: segment.seedImageUrl || undefined,
      videoUrl: undefined,
      thumbnailUrl: undefined,
      generationTaskId: undefined,
      lastError: undefined,
    };
  });

  const siblingPrefix = `${input.clipId}-segment-`;
  const before = clips.slice(0, parentIndex);
  const after = clips.slice(parentIndex + 1).filter((clip) => !clip.id.startsWith(siblingPrefix));
  useStore.setState({
    clips: [...before, ...technicalClips, ...after],
    selectedClipId: technicalClips[0]?.id ?? state.selectedClipId,
  });

  return segments.map((segment) => enqueueGeneration(segment));
}
