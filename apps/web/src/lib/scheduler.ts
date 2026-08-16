import { useStore } from "./store.js";
import {
  startImageToVideo,
  startTextToVideo,
  pollTask,
  saveClipToServer,
  ApiError,
} from "./api.js";
import { agnesClientPollTimeoutMs } from "./agnes-polling.js";
import { toast } from "./toast.js";
import type { Clip, GenerationModel, Task } from "@mvs/shared";

/** Keep a small queue so one project does not launch an accidental provider storm. */
export const MAX_CONCURRENT = 2;
const AGNES_MODEL = "agnes-video-v2.0";

export type JobState = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type GenerationSource = "textToVideo" | "imageToVideo";

export type Job = {
  id: string;
  clipId: string;
  state: JobState;
  taskId: string | null;
  error: string | null;
  enqueuedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  input: {
    source: GenerationSource;
    seedImageUrl: string;
    requiresCharacter: boolean;
    prompt: string;
    duration: number;
    sectionLabel: string;
    energy: number;
    model: GenerationModel;
  };
};

export type EnqueueInput = {
  clipId: string;
  source: GenerationSource;
  seedImageUrl: string;
  requiresCharacter?: boolean;
  prompt: string;
  duration: number;
  sectionLabel: string;
  energy: number;
  model?: GenerationModel;
};

function taskSucceeded(task: Task): boolean {
  return (task.status || "").toUpperCase() === "SUCCEEDED";
}

function taskOutputUrl(task: Task): string | undefined {
  if (task.outputUrl) return task.outputUrl;
  if (Array.isArray(task.output)) return task.output[0];
  return task.output?.videoUrl ?? task.output?.imageUrl ?? task.output?.url;
}

const newJobId = () => `job-${crypto.randomUUID().slice(0, 8)}`;
let resumed = false;

/** Reattach to server-side generation jobs that were still running on reload. */
export function resumeInflightJobs(): void {
  if (resumed) return;
  resumed = true;
  const inflight = useStore.getState().clips.filter(
    (clip) => clip.status === "generating" && clip.generationTaskId,
  );
  for (const clip of inflight) void resumeClipPoll(clip.id, clip.generationTaskId!);
}

async function resumeClipPoll(clipId: string, taskId: string): Promise<void> {
  try {
    const initialClip = useStore.getState().clips.find((item) => item.id === clipId);
    const timeoutMs = initialClip?.model === AGNES_MODEL
      ? agnesClientPollTimeoutMs(initialClip.end - initialClip.start)
      : 900_000;
    const final = await pollTask(taskId, 5000, timeoutMs);
    const currentClip = useStore.getState().clips.find((item) => item.id === clipId);
    if (currentClip?.generationTaskId && currentClip.generationTaskId !== taskId) {
      console.warn("Ignoring stale resumed generation completion because the clip has a newer task");
      return;
    }
    const videoUrl = taskOutputUrl(final);
    if (!taskSucceeded(final) || !videoUrl) {
      throw new Error(final.error ?? `task ended in ${final.status} with no video`);
    }
    useStore.getState().updateClip(clipId, {
      videoUrl,
      status: "ready",
      model: currentClip?.model ?? AGNES_MODEL,
      lastError: undefined,
    });
    toast.success(currentClip?.model && currentClip.model !== AGNES_MODEL
      ? "Resumed historical generated clip ready"
      : "Resumed Agnes clip ready");
    const clip = useStore.getState().clips.find((item) => item.id === clipId);
    if (clip) void persistGeneratedClip(clip, videoUrl, "resumed");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const currentClip = useStore.getState().clips.find((item) => item.id === clipId);
    const ownsClip = !currentClip?.generationTaskId || currentClip.generationTaskId === taskId;
    if (!ownsClip) return;
    if (currentClip?.status === "ready" && currentClip.videoUrl) return;
    useStore.getState().updateClip(clipId, { status: "failed", lastError: reason });
    toast.error(`Resumed generation failed: ${reason.slice(0, 80)}`);
  }
}

function generationDuration(duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Timeline clip duration must be positive");
  }
  return duration;
}

export function enqueueGeneration(input: EnqueueInput): string {
  const activeForClip = useStore.getState().jobs.filter(
    (job) => job.clipId === input.clipId && (job.state === "queued" || job.state === "running"),
  );
  if (activeForClip.length > 0) {
    toast.info("This clip is already generating. Keeping the existing provider job.");
    return activeForClip[0]!.id;
  }

  const id = newJobId();
  const job: Job = {
    id,
    clipId: input.clipId,
    state: "queued",
    taskId: null,
    error: null,
    enqueuedAt: Date.now(),
    startedAt: null,
    completedAt: null,
    input: {
      source: input.source,
      seedImageUrl: input.seedImageUrl,
      requiresCharacter: input.requiresCharacter === true,
      prompt: input.prompt,
      duration: generationDuration(input.duration),
      sectionLabel: input.sectionLabel,
      energy: input.energy,
      model: AGNES_MODEL,
    },
  };

  useStore.getState().setJobs((jobs) => [...jobs, job]);
  useStore.getState().updateClip(input.clipId, {
    source: input.source,
    model: AGNES_MODEL,
    status: "queued",
    prompt: input.prompt,
    lastError: undefined,
  });
  pump();
  return id;
}

export function cancelJob(jobId: string): void {
  const job = useStore.getState().jobs.find((item) => item.id === jobId);
  if (!job) return;
  if (job.state === "queued") {
    useStore.getState().setJobs((jobs) =>
      jobs.map((item) => jobId === item.id ? { ...item, state: "cancelled", completedAt: Date.now() } : item),
    );
    useStore.getState().updateClip(job.clipId, { status: "empty" });
  } else if (job.state === "running") {
    useStore.getState().setJobs((jobs) =>
      jobs.map((item) => item.id === jobId ? { ...item, state: "cancelled" } : item),
    );
  }
  pump();
}

function pump(): void {
  const jobs = useStore.getState().jobs;
  const slots = MAX_CONCURRENT - jobs.filter((job) => job.state === "running").length;
  if (slots <= 0) return;
  for (const job of jobs.filter((item) => item.state === "queued").slice(0, slots)) void run(job.id);
}

function isCancelled(jobId: string): boolean {
  return useStore.getState().jobs.find((job) => job.id === jobId)?.state === "cancelled";
}

function setJobPatch(jobId: string, patch: Partial<Job>): void {
  useStore.getState().setJobs((jobs) =>
    jobs.map((job) => job.id === jobId ? { ...job, ...patch } : job),
  );
}

async function startTask(job: Job): Promise<{ id: string }> {
  const promptText = job.input.prompt.trim();
  if (!promptText) throw new Error("A scene prompt is required");
  if (job.input.requiresCharacter && job.input.source === "textToVideo") {
    throw new Error("Character conditioning is required. This clip cannot fall back to text-to-video.");
  }
  if (job.input.source === "textToVideo") {
    return startTextToVideo({
      promptText,
      model: AGNES_MODEL,
      aspectRatio: "16:9",
      duration: job.input.duration,
    });
  }
  if (!job.input.seedImageUrl) {
    throw new Error(job.input.requiresCharacter
      ? "Character conditioning is required. No character image was attached."
      : "Image-to-video requires a first-frame reference");
  }
  return startImageToVideo({
    promptImage: job.input.seedImageUrl,
    promptText,
    aspectRatio: "16:9",
    duration: job.input.duration,
    model: AGNES_MODEL,
  });
}

async function run(jobId: string): Promise<void> {
  const job = useStore.getState().jobs.find((item) => item.id === jobId);
  if (!job || job.state !== "queued") return;
  setJobPatch(jobId, { state: "running", startedAt: Date.now() });
  useStore.getState().updateClip(job.clipId, { status: "generating" });

  try {
    const task = await startTask(job);
    setJobPatch(jobId, { taskId: task.id });
    useStore.getState().updateClip(job.clipId, { generationTaskId: task.id });
    if (isCancelled(jobId)) {
      useStore.getState().updateClip(job.clipId, { status: "empty" });
      return;
    }

    const final = await pollTask(task.id, 5000, agnesClientPollTimeoutMs(job.input.duration));
    if (isCancelled(jobId)) {
      useStore.getState().updateClip(job.clipId, { status: "empty" });
      return;
    }
    const videoUrl = taskOutputUrl(final);
    if (!taskSucceeded(final) || !videoUrl) {
      throw new Error(final.error ?? `task ended in ${final.status} with no video`);
    }

    setJobPatch(jobId, { state: "succeeded", completedAt: Date.now() });
    useStore.getState().updateClip(job.clipId, {
      videoUrl,
      status: "ready",
      model: AGNES_MODEL,
      lastError: undefined,
    });
    toast.success(`Agnes clip ready (${job.input.sectionLabel})`);
    const clip = useStore.getState().clips.find((item) => item.id === job.clipId);
    if (clip) void persistGeneratedClip(clip, videoUrl, job.input.sectionLabel);
  } catch (error) {
    const rateLimited = error instanceof ApiError && error.rateLimited;
    const reason = rateLimited
      ? "The generation service rate limit was reached. Try again shortly."
      : error instanceof Error ? error.message : String(error);
    setJobPatch(jobId, { state: "failed", error: reason, completedAt: Date.now() });
    const currentJob = useStore.getState().jobs.find((item) => item.id === jobId);
    const currentClip = useStore.getState().clips.find((item) => item.id === job.clipId);
    const ownsClip = !currentJob?.taskId || !currentClip?.generationTaskId || currentClip.generationTaskId === currentJob.taskId;
    if (!ownsClip) {
      console.warn("Ignoring stale generation failure because the clip has a newer task");
    } else if (currentClip?.status === "ready" && currentClip.videoUrl) {
      toast.warning("A late task error was ignored because the video completed.");
    } else {
      useStore.getState().updateClip(job.clipId, { status: "failed", lastError: reason });
      if (rateLimited) toast.warning(reason, 8000);
      else toast.error(`Agnes generation failed: ${reason.slice(0, 120)}`);
    }
  } finally {
    pump();
  }
}

async function persistGeneratedClip(clip: Clip, videoUrl: string, sectionLabel: string): Promise<void> {
  try {
    const saved = await saveClipToServer({
      id: clip.id,
      name: clip.prompt?.slice(0, 60) || `${sectionLabel} clip`,
      videoUrl,
      source: clip.source,
      prompt: clip.prompt || null,
      duration: clip.end - clip.start,
      sectionLabel,
      model: AGNES_MODEL,
      generationTaskId: clip.generationTaskId,
    });
    if (
      saved.videoUrl &&
      saved.videoUrl !== videoUrl &&
      (saved.videoUrl.startsWith("/media/") || saved.videoUrl.startsWith("/storage/"))
    ) {
      useStore.getState().updateClip(clip.id, { videoUrl: saved.videoUrl });
    }
  } catch (error) {
    console.warn("auto-save Agnes clip failed", error);
  }
}
