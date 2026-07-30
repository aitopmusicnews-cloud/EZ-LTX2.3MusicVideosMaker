import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { z } from "zod";
import { dirname, join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { createDirectorPlan } from "./director_agent.js";
import { saveUpload, readAnalysis, writeAnalysisError, readAnalysisError, clearAnalysisError, CorruptAnalysisError, playableUrl } from "./storage.js";
import { analyzeFromUrl } from "./audio.js";
import { imageToVideo, animateLipSync, generateCharacterFrame, readJobFromDisk, writeJobToDisk, decodeTaskId } from "./modalAI.js";
import { submitRender, getRenderJob } from "./render_queue.js";
import type { RenderRequest } from "./render.js";
import { FfmpegError } from "./ffmpeg.js";
import { saveProject, listProjects, loadProject, deleteProject, listRenders } from "./projects.js";
import { saveClip, listClips, deleteClip } from "./clips.js";
import { extractLastFrame } from "./frames.js";
import { sliceAudio } from "./audio_slice.js";
import { analyzeVocalTrack } from "./vocal.js";
import { ImageToVideoRequest, VideoToVideoRequest, LipSyncRequest, TextToImageRequest, TextToVideoRequest } from "@mvs/shared";

const app = Fastify({ logger: true });
const SafeId = z.string().min(1).max(300).regex(/^[A-Za-z0-9._:-]+$/);
const urlOrPath = z.string().min(1);
const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), "../public");

function requestPublicBaseUrl(req: any): string { return config.PUBLIC_BASE_URL || `${req.protocol}://${req.headers.host}`; }
function resolvePublicUrl(req: any, publicUrl: string): string { if (/^https?:\/\//i.test(publicUrl)) return publicUrl; return `${requestPublicBaseUrl(req)}${publicUrl.startsWith("/") ? "" : "/"}${publicUrl}`; }
function sniffMatches(buf: Buffer, family: "audio" | "image" | "video"): boolean {
  if (buf.length < 4) return false;
  const ascii = (start: number, len: number) => start + len <= buf.length ? buf.subarray(start, start + len).toString("ascii") : "";
  if (family === "audio") return ascii(0, 3) === "ID3" || ascii(0, 4) === "RIFF" || ascii(0, 4) === "fLaC" || ascii(0, 4) === "OggS" || ascii(4, 4) === "ftyp" || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0);
  if (family === "video") return ascii(4, 4) === "ftyp" || (ascii(0, 4) === "RIFF" && ascii(8, 4) === "AVI ") || ascii(0, 4) === "OggS";
  return (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) || (buf[0] === 0x89 && ascii(1, 3) === "PNG") || ascii(0, 4) === "GIF8" || (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP");
}

await app.register(cors, { origin: true });
await app.register(rateLimit, { global: false });
await app.register(multipart, { limits: { fileSize: 250 * 1024 * 1024 } });
if (existsSync(publicDir)) await app.register(fastifyStatic, { root: publicDir });

// Keep exactly one Render health endpoint. Do not add /api/health.
app.get("/health", async () => ({ ok: true }));
app.get("/", async (_req, reply) => { const indexPath = join(publicDir, "index.html"); if (!existsSync(indexPath)) return reply.code(404).send({ error: "Web app build not found" }); return reply.type("text/html").sendFile("index.html"); });

app.post("/api/director/plan", async (req, reply) => { try { return reply.send(await createDirectorPlan(req.body)); } catch (error: any) { const message = error instanceof Error ? error.message : String(error); req.log.error({ err: error }, "LTX Director Agent failed"); return reply.code(message.includes("required") ? 400 : 500).send({ error: message }); } });

app.post("/api/images/upload", async (req, reply) => { const file = await req.file(); if (!file) return reply.code(400).send({ error: "no file" }); const buf = await file.toBuffer(); if (!file.mimetype?.startsWith("image/") && !sniffMatches(buf, "image")) return reply.code(400).send({ error: "expected image" }); const { id, publicUrl } = await saveUpload(buf, file.filename, file.mimetype); return reply.send({ id, url: resolvePublicUrl(req, publicUrl) }); });
app.post("/api/videos/upload", async (req, reply) => { const file = await req.file(); if (!file) return reply.code(400).send({ error: "no file" }); const buf = await file.toBuffer(); if (!file.mimetype?.startsWith("video/") && !sniffMatches(buf, "video")) return reply.code(400).send({ error: "expected video" }); const { id, publicUrl } = await saveUpload(buf, file.filename, file.mimetype); return reply.send({ id, url: resolvePublicUrl(req, publicUrl) }); });

// Song upload is intentionally separate from analysis. The first uploaded MP3 gets an id,
// then the client calls POST /api/songs/:id/analyze using that id.
app.post("/api/songs/upload", async (req, reply) => { const file = await req.file(); if (!file) return reply.code(400).send({ error: "no file" }); const buf = await file.toBuffer(); if (!file.mimetype?.startsWith("audio/") && !sniffMatches(buf, "audio")) return reply.code(400).send({ error: "expected audio" }); const { id, publicUrl } = await saveUpload(buf, file.filename, file.mimetype); return reply.send({ id, url: resolvePublicUrl(req, publicUrl), audioUrl: resolvePublicUrl(req, publicUrl) }); });

// This route must exist for first-time uploads as well as re-analysis.
app.post("/api/songs/:id/analyze", async (req, reply) => {
  const { id } = z.object({ id: SafeId }).parse(req.params);
  const body = z.object({ audioUrl: urlOrPath.optional() }).parse(req.body ?? {});
  const audioUrl = body.audioUrl || `${requestPublicBaseUrl(req)}/storage/uploads/${id}`;
  try {
    await clearAnalysisError(id);
    const analysis = await analyzeFromUrl(id, audioUrl);
    return reply.send({ id, analysis, status: "completed" });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error);
    await writeAnalysisError(id, message);
    req.log.error({ err: error, songId: id }, "Song analysis failed");
    return reply.code(500).send({ id, status: "failed", error: message });
  }
});

app.get("/api/songs/:id/analysis", async (req, reply) => { const { id } = z.object({ id: SafeId }).parse(req.params); try { const analysis = await readAnalysis(id); if (analysis) return reply.send({ id, analysis, status: "completed" }); const error = await readAnalysisError(id); if (error) return reply.code(500).send({ id, status: "failed", error }); return reply.code(404).send({ id, status: "not_found", error: "Song analysis has not been generated yet." }); } catch (error: any) { if (error instanceof CorruptAnalysisError) return reply.code(500).send({ id, status: "failed", error: error.message }); const message = error instanceof Error ? error.message : String(error); req.log.error({ err: error, songId: id }, "Failed to read song analysis"); return reply.code(500).send({ id, status: "failed", error: message }); } });

app.post("/api/generate/image-to-video", async (req, reply) => reply.code(202).send(await imageToVideo(ImageToVideoRequest.parse(req.body), requestPublicBaseUrl(req))));
app.post("/api/generate/video-to-video", async (req, reply) => { try { const body = VideoToVideoRequest.parse(req.body); return reply.code(202).send(await imageToVideo({ prompt: body.prompt, promptText: (body as any).promptText ?? body.prompt, model: body.model, duration: (body as any).duration }, requestPublicBaseUrl(req))); } catch (error: any) { return reply.code(500).send({ error: error.message }); } });
app.post("/api/generate/lip-sync", async (req, reply) => reply.send(await animateLipSync(LipSyncRequest.parse(req.body))));
app.post("/api/generate/text-to-image", async (req, reply) => reply.send(await generateCharacterFrame(TextToImageRequest.parse(req.body))));
app.post("/api/generate/text-to-video", async (req, reply) => reply.code(202).send(await imageToVideo(TextToVideoRequest.parse(req.body), requestPublicBaseUrl(req))));

const WebhookBody = z.object({ status: z.enum(["completed", "failed"]), job_id: z.string(), video_url: z.string().url().optional().nullable(), image_url: z.string().url().optional().nullable(), error: z.string().optional().nullable() });
const modalWebhookHandler = async (req: any, reply: any) => {
  const body = WebhookBody.parse(req.body); const { status, job_id, video_url, image_url, error } = body; const existingJob = await readJobFromDisk(job_id);
  if (!existingJob) return reply.code(404).send({ error: "Job context not found on disk." });
  if (status !== "completed" || (!video_url && !image_url)) { await writeJobToDisk(job_id, { ...existingJob, status: "failed", error: error || "Inference failed on GPU cluster.", updatedAt: Date.now() }); return reply.send({ success: true }); }
  if (existingJob.stage === "generation" && existingJob.lipSyncRequested && video_url) {
    const performerAudioUrl = (existingJob as any).performerAudioUrl;
    if (!performerAudioUrl) { await writeJobToDisk(job_id, { ...existingJob, status: "failed", error: "LipDub was requested but performer audio is missing.", updatedAt: Date.now() }); return reply.send({ success: true }); }
    try { const lipSyncTask = await animateLipSync({ videoUrl: video_url, audioUrl: performerAudioUrl, prompt: existingJob.prompt, parentJobId: job_id }); const { id: encodedLipSyncId } = lipSyncTask; const { id: lipSyncJobId } = decodeTaskId(encodedLipSyncId); await writeJobToDisk(job_id, { ...existingJob, status: "running", video_url, updatedAt: Date.now() }); const child = await readJobFromDisk(lipSyncJobId); if (child) await writeJobToDisk(lipSyncJobId, { ...child, parentJobId: job_id, stage: "lipsync" }); return reply.send({ success: true, lipSyncTaskId: encodedLipSyncId }); } catch (startError) { const message = startError instanceof Error ? startError.message : String(startError); await writeJobToDisk(job_id, { ...existingJob, status: "failed", video_url, error: `LipDub handoff failed: ${message}`, updatedAt: Date.now() }); return reply.send({ success: true }); }
  }
  if (existingJob.stage === "lipsync" && existingJob.parentJobId) { await writeJobToDisk(job_id, { ...existingJob, status: "completed", video_url: video_url ?? existingJob.video_url, updatedAt: Date.now() }); const parent = await readJobFromDisk(existingJob.parentJobId); if (parent) await writeJobToDisk(existingJob.parentJobId, { ...parent, status: "completed", video_url: video_url ?? parent.video_url, updatedAt: Date.now(), stage: "completed" }); return reply.send({ success: true }); }
  await writeJobToDisk(job_id, { ...existingJob, status: "completed", video_url, image_url, updatedAt: Date.now() }); return reply.send({ success: true });
};
app.post("/api/modal/webhook", modalWebhookHandler);
app.post("/api/webhooks/modal", modalWebhookHandler);

app.get("/api/tasks/:id", async (req, reply) => { const { id } = z.object({ id: SafeId }).parse(req.params); const job = await readJobFromDisk(id); if (!job) return reply.code(404).send({ error: "Task not found" }); return reply.send(job); });
app.post("/api/audio/slice", async (req, reply) => { const body = z.object({ audioUrl: urlOrPath, start: z.number().nonnegative(), end: z.number().positive() }).parse(req.body); return reply.send(await sliceAudio(body.audioUrl, body.start, body.end)); });
app.post("/api/audio/vocal-track", async (req, reply) => { const body = z.object({ audioUrl: urlOrPath }).parse(req.body); return reply.send(await analyzeVocalTrack(body.audioUrl)); });

app.get("/api/projects", async (_req, reply) => reply.send({ projects: await listProjects() }));
app.post("/api/projects", async (req, reply) => { const body = z.object({ id: SafeId, name: z.string().min(1).max(200), state: z.record(z.any()) }).parse(req.body); return reply.send(await saveProject(body.id, body.name, body.state)); });
app.get("/api/projects/:id", async (req, reply) => reply.send(await loadProject((req.params as any).id)));
app.delete("/api/projects/:id", async (req, reply) => reply.send(await deleteProject((req.params as any).id)));
app.get("/api/projects/:id/renders", async (_req, reply) => reply.send({ renders: await listRenders() }));
app.post("/api/clips", async (req, reply) => { const body = z.object({ id: SafeId, projectId: SafeId, name: z.string().min(1).max(200), url: z.string().min(1), metadata: z.record(z.any()).optional() }).parse(req.body); const metadata = body.metadata ?? {}; return reply.send(await saveClip({ id: body.id, name: body.name, videoUrl: body.url, source: typeof metadata.source === "string" ? metadata.source : "unknown", prompt: typeof metadata.prompt === "string" ? metadata.prompt : "", duration: typeof metadata.duration === "number" ? metadata.duration : 0, sectionLabel: typeof metadata.sectionLabel === "string" ? metadata.sectionLabel : "", folderId: body.projectId, model: typeof metadata.model === "string" ? metadata.model : undefined, generationTaskId: typeof metadata.generationTaskId === "string" ? metadata.generationTaskId : undefined })); });
app.get("/api/clips", async (_req, reply) => reply.send({ clips: await listClips() }));
app.delete("/api/clips/:id", async (req, reply) => reply.send(await deleteClip((req.params as any).id)));

app.setNotFoundHandler((req, reply) => { if (req.url.startsWith("/api/") || req.url.startsWith("/storage/")) return reply.code(404).send({ error: `Route ${req.method} ${req.url} not found` }); if (req.method === "GET" && existsSync(join(publicDir, "index.html"))) return reply.sendFile("index.html"); return reply.code(404).send({ error: "not found" }); });
app.setErrorHandler((error: any, req, reply) => { req.log.error({ err: error }, "Unhandled API error"); if (error instanceof FfmpegError) return reply.code(422).send({ error: error.message }); if (error instanceof z.ZodError) return reply.code(400).send({ error: "Invalid request", details: error.issues }); return reply.code(500).send({ error: error instanceof Error ? error.message : String(error) }); });

const port = Number(config.PORT || process.env.PORT || 3001);
await app.listen({ port, host: "0.0.0.0" });
