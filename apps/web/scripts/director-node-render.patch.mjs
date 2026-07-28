export function patchDirectorRenderApi(source) {
  if (source.includes("export async function startDirectorSectionRender")) return source;
  const anchor = `export async function startTextToVideo(req: Record<string, any>): Promise<{ id: string }> {
  return jsonOrThrow(await fetch("/api/generate/text-to-video", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  }));
}`;
  if (!source.includes(anchor)) throw new Error("Could not find text-to-video helper for Director render API insertion.");
  const addition = `${anchor}

export async function startDirectorSectionRender(req: {
  projectId?: string;
  clipId: string;
  sectionLabel: string;
  globalPrompt: string;
  prompt: string;
  duration: number;
  segments?: Array<{ prompt: string; start: number; end: number }>;
  conditioningImageUrl?: string;
  requiresCharacter?: boolean;
  width?: number;
  height?: number;
  fps?: number;
  seed?: number;
  epsilon?: number;
}): Promise<{ id: string }> {
  return jsonOrThrow(await fetch("/api/director/render-section", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  }));
}`;
  return source.replace(anchor, addition);
}
