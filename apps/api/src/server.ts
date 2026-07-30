import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { z } from "zod";
import { dirname, join, resolve } from "node:path";
import { existsSync, statSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { createDirectorPlan } from "./director_agent.js";
import { saveUpload, readAnalysis, writeAnalysisError, readAnalysisError, clearAnalysisError, CorruptAnalysisError } from "./storage.js";
import { analyzeFromUrl } from "./audio.js";
import { imageToVideo, animateLipSync, generateCharacterFrame, readJobFromDisk, writeJobToDisk, decodeTaskId } from "./modalAI.js";
import { submitRender, getRenderJob } from "./render_queue.js";
import type { RenderRequest } from "./render.js";
import { FfmpegError } from "./ffmpeg.js";
import {
  saveProject,
  listProjects,
  loadProject,
  deleteProject,
  listRenders,
} from "./projects.js";
import {
  saveClip,
  listClips,
  deleteClip,
} from "./clips.js";
import { extractLastFrame } from "./frames.js";
import { sliceAudio } from "./audio_slice.js";
import { analyzeVocalTrack } from "./vocal.js";
import { ImageToVideoRequest, VideoToVideoRequest, LipSyncRequest, TextToImageRequest, TextToVideoRequest } from "@mvs/shared";

const app = Fastify({ logger: true });
const SafeId = z.string().min(1).max(300).regex(/^[A-Za-z0-9._:-]+$/);
const urlOrPath = z.string().min(1);

function requestPublicBaseUrl(req: any): string { return config.PUBLIC_BASE_URL || `${req.protocol}://${req.headers.host}`; }

app.register(cors, { origin: true });
app.register(rateLimit, { global: false });
app.register(multipart, { limits: { fileSize: 250 * 1024 * 1024 } });
const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), "../public");
if (existsSync(publicDir)) app.register(fastifyStatic, { root: publicDir });

app.post("/api/director/plan", async (req, reply) => {
  try { return reply.send(await createDirectorPlan(req.body)); }
  catch (error: any) { const message = error instanceof Error ? error.message : String(error); req.log.error({ err: error }, "LTX Director Agent failed"); return reply.code(message.includes("required") ? 400 : 500).send({ error: message }); }
});

function sniffMatches(buf: Buffer, family: "audio" | "image" | "video"): boolean { if (buf.length < 4) return false; const u = (i: number) => buf.readUInt8(i); const ascii = (start: number, len: number) => start + len <= buf.length ? buf.subarray(start, start + len).toString("ascii") : ""; if (family === "audio") { if (ascii(0, 3) === "ID3") return true; if (u(0) === 0xff && (u(1) & 0xe0) === 0xe0) return true; if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE") return true; if (ascii(0, 4) === "fLaC") return true; if (ascii(0, 4) === "OggS") return true; if (ascii(4, 4) === "ftyp") return true; return true; } if (family === "video") { if (buf.length >= 8 && ascii(4, 4) === "ftyp") return true; if (buf.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "AVI ") return true; if (buf.length >= 4 && u(0) === 0x1a && u(1) === 0x45 && u(2) === 0xdf && u(3) === 0xa3) return true; if (buf.length >= 4 && ascii(0, 4) === "OggS") return true; return true; } if (u(0) === 0xff && u(1) === 0xd8 && u(2) === 0xff) return true; if (u(0) === 0x89 && ascii(1, 3) === "PNG") return true; if (ascii(0, 4) === "GIF8") return true; if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return true; return true; }
function resolvePublicUrl(req: any, publicUrl: string): string { let resolved = publicUrl; let hostHeader = (req.headers["x-forwarded-host"] as string) || (req.headers["host"] as string); if (hostHeader) { if (hostHeader.includes(":3001")) hostHeader = hostHeader.replace(":3001", ":3000"); else if (hostHeader === "127.0.0.1" || hostHeader === "localhost") hostHeader = `${hostHeader}:3000`; const isLocal = hostHeader.includes("localhost") || hostHeader.includes("127.0.0.1"); const proto = isLocal ? "http" : "https"; const keyIndex = publicUrl.indexOf("/storage/"); if (keyIndex !== -1) resolved = `${proto}://${hostHeader}${publicUrl.substring(keyIndex)}`; } return resolved; }

app.post("/api/images/upload", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => { const file = await req.file(); if (!file) return reply.code(400).send({ error: "no file" }); const isImg = file.mimetype?.startsWith("image/") || /\.(png|jpg|jpeg|webp|gif|bmp|svg|tiff|jfif)$/i.test(file.filename); if (!isImg) return reply.code(400).send({ error: `expected image, got ${file.mimetype}` }); const buf = await file.toBuffer(); if (!sniffMatches(buf, "image")) return reply.code(400).send({ error: "file content is not a recognized image format" }); const { id, publicUrl } = await saveUpload(buf, file.filename, file.mimetype); return reply.send({ id, url: resolvePublicUrl(req, publicUrl) }); });
app.post("/api/videos/upload", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => { const file = await req.file(); if (!file) return reply.code(400).send({ error: "no file" }); const isVid = file.mimetype?.startsWith("video/") || /\.(mp4|webm|ogg|mov|avi|mkv|m4v)$/i.test(file.filename); if (!isVid) return reply.code(400).send({ error: `expected video, got ${file.mimetype}` }); const buf = await file.toBuffer(); if (!sniffMatches(buf, "video")) return reply.code(400).send({ error: "file content is not a recognized video format" }); const { id, publicUrl } = await saveUpload(buf, file.filename, file.mimetype); return reply.send({ id, url: resolvePublicUrl(req, publicUrl) }); });
app.post("/api/songs/upload", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => { const file = await req.file(); if (!file) return reply.code(400).send({ error: "no file" }); const isAudio = file.mimetype?.startsWith("audio/") || /\.(mp3|wav|m4a|aac|flac|ogg|oga|opus)$/i.test(file.filename); if (!isAudio) return reply.code(400).send({ error: `expected audio, got ${file.mimetype}` }); const buf = await file.toBuffer(); if (!sniffMatches(buf, "audio")) return reply.code(400).send({ error: "file content is not a recognized audio format" }); const { id, publicUrl } = await saveUpload(buf, file.filename, file.mimetype); return reply.send({ id, url: resolvePublicUrl(req, publicUrl), audioUrl: resolvePublicUrl(req, publicUrl) }); });

app.post("/api/generate/image-to-video", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => reply.code(202).send(await imageToVideo(ImageToVideoRequest.parse(req.body), requestPublicBaseUrl(req as any))));
app.post("/api/generate/video-to-video", async (req, reply) => { try { const body = VideoToVideoRequest.parse(req.body); return reply.code(202).send(await imageToVideo({ prompt: body.prompt, promptText: (body as any).promptText ?? body.prompt, model: body.model, duration: (body as any).duration }, requestPublicBaseUrl(req as any))); } catch (error: any) { return reply.code(500).send({ error: error.message }); } });
app.post("/api/generate/lip-sync", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => reply.send(await animateLipSync(LipSyncRequest.parse(req.body))));
app.post("/api/generate/text-to-image", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => reply.send(await generateCharacterFrame(TextToImageRequest.parse(req.body))));
app.post("/api/generate/text-to-video", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => { const body = TextToVideoRequest.parse(req.body); return reply.code(202).send(await imageToVideo(body, requestPublicBaseUrl(req as any))); });

const WebhookBody = z.object({ status: z.enum(["completed", "failed"]), job_id: z.string(), video_url: z.string().url().optional().nullable(), image_url: z.string().url().optional().nullable(), error: z.string().optional().nullable() });
const modalWebhookHandler = async (req: any, reply: any) => {
  const body = WebhookBody.parse(req.body); const { status, job_id, video_url, image_url, error } = body; const existingJob = await readJobFromDisk(job_id);
  if (!existingJob) return reply.code(404).send({ error: "Job context not found on disk." });
  if (status !== "completed" || (!video_url && !image_url)) { await writeJobToDisk(job_id, { ...existingJob, status: "failed", error: error || "Inference failed on GPU cluster.", updatedAt: Date.now() }); return reply.send({ success: true }); }

  // A generation job with LipDub requested is not final until its LipDub child completes.
  // The LTX worker's completion webhook triggers the second stage automatically.
  if (existingJob.stage === "generation" && existingJob.lipSyncRequested && video_url) {
    const performerAudioUrl = (existingJob as any).performerAudioUrl;
    if (!performerAudioUrl) { await writeJobToDisk(job_id, { ...existingJob, status: "failed", error: "LipDub was requested but performer audio is missing.", updatedAt: Date.now() }); return reply.send({ success: true }); }
    try {
      const lipSyncTask = await animateLipSync({ videoUrl: video_url, audioUrl: performerAudioUrl, prompt: existingJob.prompt, parentJobId: job_id });
      const { id: encodedLipSyncId } = lipSyncTask; const { id: lipSyncJobId } = decodeTaskId(encodedLipSyncId);
      await writeJobToDisk(job_id, { ...existingJob, status: "running", video_url, updatedAt: Date.now(), lipSyncRequested: true, stage: "generation", modalCallId: existingJob.modalCallId });
      const child = await readJobFromDisk(lipSyncJobId);
      if (child) await writeJobToDisk(lipSyncJobId, { ...child, parentJobId: job_id, stage: "lipsync" });
      return reply.send({ success: true, lipSyncTaskId: encodedLipSyncId });
    } catch (startError) {
      const message = startError instanceof Error ? startError.message : String(startError);
      await writeJobToDisk(job_id, { ...existingJob, status: "failed", video_url, error: `LipDub handoff failed: ${message}`, updatedAt: Date.now() });
      return reply.send({ success: true });
    }
  }

  if (existingJob.stage === "lipsync" && existingJob.parentJobId) {
    await writeJobToDisk(job_id, { ...existingJob, status: "completed", video_url: video_url ?? existingJob.video_url, updatedAt: Date.now() });
    const parent = await readJobFromDisk(existingJob.parentJobId);
    if (parent) await writeJobToDisk(existingJob.parentJobId, { ...parent, status: "completed", video_url: video_url ?? parent.video_url, updatedAt: Date.now(), stage: "lipsync" });
    return reply.send({ success: true, parentJobId: existingJob.parentJobId });
  }

  await writeJobToDisk(job_id, { ...existingJob, status: "completed", video_url: video_url ?? existingJob.video_url, image_url: image_url ?? existingJob.image_url, updatedAt: Date.now() });
  return reply.send({ success: true });
};
app.post("/api/modal/webhook", modalWebhookHandler); app.post("/api/openrouter/webhook", modalWebhookHandler);
app.get("/api/tasks/:id", async (req, reply) => { try { const { id: encodedId } = req.params as { id: string }; const { id } = decodeTaskId(encodedId); const job = await readJobFromDisk(id); if (!job) return reply.code(404).send({ error: "Task or job record not found" }); if (job.status === "completed" && (job.video_url || job.image_url)) return reply.send({ id: encodedId, status: "SUCCEEDED", progress: 100, outputUrl: job.video_url ?? job.image_url, output: job.image_url ? { imageUrl: job.image_url, url: job.image_url } : [job.video_url!] }); if (job.status === "failed") return reply.send({ id: encodedId, status: "FAILED", progress: 100, error: job.error || "Generation failed" }); return reply.send({ id: encodedId, status: "IN_PROGRESS", progress: 0 }); } catch (error: any) { return reply.code(400).send({ error: error.message }); } });
app.post("/api/audio/slice", async (req, reply) => { const body = z.object({ audioUrl: urlOrPath, start: z.number().nonnegative(), end: z.number().positive() }).parse(req.body); return reply.send(await sliceAudio(body.audioUrl, body.start, body.end)); });
app.post("/api/audio/analyze-vocal", async (req, reply) => { const body = z.object({ audioUrl: urlOrPath }).parse(req.body); return reply.send(await analyzeVocalTrack(body.audioUrl)); });
app.get("/api/projects", async (_req, reply) => reply.send({ projects: await listProjects() }));
app.post("/api/projects", async (req, reply) => { const body = z.object({ id: SafeId, name: z.string().min(1).max(200), state: z.record(z.any()) }).parse(req.body); return reply.send(await saveProject(body.id, body.name, body.state)); });
app.get("/api/projects/:id", async (req, reply) => { const params = z.object({ id: SafeId }).parse(req.params); const project = await loadProject(params.id); if (!project) return reply.code(404).send({ error: "not found" }); return reply.send(project); });
app.delete("/api/projects/:id", async (req, reply) => { const params = z.object({ id: SafeId }).parse(req.params); const deleted = await deleteProject(params.id); if (!deleted) return reply.code(404).send({ error: "not found" }); return reply.send({ ok: true }); });
app.get("/api/renders", async (_req, reply) => reply.send({ renders: await listRenders() }));
app.post("/api/renders", async (req, reply) => { const parsed = z.object({ projectId: SafeId, audioUrl: urlOrPath, duration: z.number().positive(), clips: z.array(z.object({ start: z.number(), end: z.number(), videoUrl: urlOrPath, source: z.string().optional() })), fades: z.boolean().optional() }).parse(req.body); const body: RenderRequest = { projectId: parsed.projectId!, audioUrl: parsed.audioUrl!, duration: parsed.duration!, clips: parsed.clips!.map((clip) => ({ start: clip.start!, end: clip.end!, videoUrl: clip.videoUrl!, source: clip.source })), fades: parsed.fades }; return reply.code(202).send(await submitRender(body)); });
app.get("/api/renders/:id", async (req, reply) => { const params = z.object({ id: SafeId }).parse(req.params); const render = await getRenderJob(params.id); if (!render) return reply.code(404).send({ error: "not found" }); return reply.send(render); });
app.get("/api/clips", async (_req, reply) => reply.send({ clips: await listClips() }));
app.post("/api/clips/save", async (req, reply) => { const body = z.object({ id: SafeId, name: z.string().min(1).max(200), videoUrl: urlOrPath, source: z.string(), prompt: z.string().nullable(), duration: z.number().positive(), sectionLabel: z.string().nullable(), folderId: z.string().nullable().optional(), model: z.string().nullable().optional(), generationTaskId: z.string().nullable().optional(), requiresLipSync: z.boolean().optional(), lipSyncTaskId: z.string().nullable().optional() }).parse(req.body); return reply.send(await saveClip(body as any)); });
app.delete("/api/clips/:id", async (req, reply) => { const params = z.object({ id: SafeId }).parse(req.params); const deleted = await deleteClip(params.id); if (!deleted) return reply.code(404).send({ error: "not found" }); return reply.send({ ok: true }); });

const analysisRuns = new Set<Promise<any>>();
app.post("/api/songs/:id/analyze", async (req, reply) => { const params = z.object({ id: SafeId }).parse(req.params); const body = z.object({ audioUrl: urlOrPath }).parse(req.body); const run = (async () => { try { await clearAnalysisError(params.id); const result = await analyzeFromUrl(params.id, body.audioUrl); await (await import("./storage.js")).writeAnalysis(params.id, result); } catch (error: any) { await writeAnalysisError(params.id, error?.message ?? String(error)); } })(); analysisRuns.add(run); void run.finally(() => analysisRuns.delete(run)); return reply.code(202).send({ status: "pending" }); });

const healthHandler = async () => ({ ok: true });
app.get("/health", healthHandler);
app.get("/api/health", healthHandler);

const port = Number(config.PORT || 3001); await app.listen({ port, host: "0.0.0.0" });
