import { analyzeFromUrl } from "./audio.js";
import { encodeTaskId, writeJobToDisk, type GenerationTask } from "./generationJobs.js";

/** Preserve the existing vocal-analysis endpoint while running analysis locally. */
export async function analyzeVocalTrack(audioUrl: string): Promise<GenerationTask> {
  const jobId = `audio_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  await writeJobToDisk(jobId, {
    status: "running",
    prompt: "Local vocal analysis",
    progress: 0,
    createdAt: now,
    updatedAt: now,
  });
  try {
    await analyzeFromUrl(jobId, audioUrl);
    await writeJobToDisk(jobId, {
      status: "completed",
      prompt: "Local vocal analysis",
      progress: 100,
      createdAt: now,
      updatedAt: Date.now(),
    });
    return { id: encodeTaskId({ source: "agnes", id: jobId }) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeJobToDisk(jobId, {
      status: "failed",
      prompt: "Local vocal analysis",
      progress: 100,
      error: message,
      createdAt: now,
      updatedAt: Date.now(),
    });
    throw error;
  }
}
