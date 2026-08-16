import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { AudioAnalysis, AudioSection, Clip } from "@mvs/shared";
import { ProjectSnapshot } from "@mvs/shared";
import type { Job } from "./scheduler.js";
import { getWs } from "./wavesurfer-ref.js";

export const MIN_CLIP_LEN = 0.5;

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 32;
export const ZOOM_STEP = 1.5;

const PERSIST_KEY = "mvs-project-v1";

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function nearestBeat(t: number, beats: number[]): number | null {
  if (!beats.length) return null;
  let best = beats[0]!;
  let bestDist = Math.abs(t - best);
  for (const b of beats) {
    const d = Math.abs(t - b);
    if (d < bestDist) {
      best = b;
      bestDist = d;
    }
  }
  return best;
}

function nearestBeatInRange(t: number, beats: number[], lo: number, hi: number): number | null {
  let best: number | null = null;
  let bestDist = Infinity;
  for (const b of beats) {
    if (b <= lo || b >= hi) continue;
    const d = Math.abs(t - b);
    if (d < bestDist) {
      best = b;
      bestDist = d;
    }
  }
  return best;
}

function newClipId(): string {
  return `clip-${crypto.randomUUID().slice(0, 8)}`;
}

function normalizeGenerationClips(clips: Clip[]): Clip[] {
  return clips.map((clip) => {
    // Preserve completed historical media exactly as saved; old LTX clips may
    // still be opened and exported, but any future generation uses Agnes.
    if (clip.status === "ready" && clip.videoUrl) return clip;
    const source =
      clip.source === "imageToVideo" || clip.source === "archetype" || Boolean(clip.seedImageUrl)
        ? "imageToVideo"
        : "textToVideo";
    return { ...clip, source, model: "agnes-video-v2.0" };
  });
}

function clipForSection(section: AudioSection): Clip[] {
  if (section.end - section.start < MIN_CLIP_LEN) return [];
  return [{
    id: newClipId(),
    start: section.start,
    end: section.end,
    source: "textToVideo",
    status: "empty",
    model: "agnes-video-v2.0",
    sectionLabel: section.label,
  }];
}

type State = {
  projectId: string | null;
  projectName: string | null;
  songId: string | null;
  songFilename: string | null;
  audioUrl: string | null;
  analysis: AudioAnalysis | null;
  clips: Clip[];
  selectedClipId: string | null;
  playhead: number;
  isPlaying: boolean;
  characterImageUrl: string | null;
  avatarId: string | null;
  avatarName: string | null;
  avatarStatus: "idle" | "creating" | "ready" | "failed";
  avatarError: string | null;
  lookbook: string[];
  zoom: number;
  jobs: Job[];

  setProjectName: (name: string) => void;
  loadSong: (songId: string, audioUrl: string, analysis: AudioAnalysis, filename: string | null) => void;
  /** Clear the loaded song + clips/playhead/jobs but keep cast (character,
   *  avatar, lookbook). Use when swapping the song mid-project. */
  unloadSong: () => void;
  resetProject: () => void;
  /** Returns a plain object snapshot of the persistable state for saving. */
  getSnapshot: () => Record<string, unknown>;
  /** Restores a previously saved snapshot. */
  restoreSnapshot: (snapshot: Record<string, unknown>) => void;
  selectClip: (id: string | null) => void;
  setPlayhead: (t: number) => void;
  setPlaying: (p: boolean) => void;
  togglePlay: () => void;
  updateClip: (id: string, patch: Partial<Clip>) => void;
  setCharacter: (url: string | null) => void;
  setAvatarId: (id: string | null) => void;
  setAvatarName: (name: string | null) => void;
  setAvatarStatus: (status: State["avatarStatus"], error?: string | null) => void;
  pickAvatar: (id: string, name: string, imageUri: string | null) => void;
  addLookbook: (url: string) => void;
  removeLookbook: (url: string) => void;
  /** Swap a lookbook entry in place — used after the image library auto-save
   *  rehosts a Runway URL into /storage so the lookbook stops pointing at the
   *  expiring link. No-op if oldUrl isn't in the lookbook. */
  replaceLookbookUrl: (oldUrl: string, newUrl: string) => void;

  setZoom: (z: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomFit: () => void;

  setJobs: (jobs: Job[] | ((prev: Job[]) => Job[])) => void;

  splitAtPlayhead: () => { ok: true; at: number } | { ok: false; reason: string };
  mergeWithRight: (clipId: string) => { ok: true } | { ok: false; reason: string };
  splitPreviewTime: () => number | null;
  /** Move the boundary between clip[idx-1] and clip[idx] to `newTime`.
   *  Clamps only to MIN_CLIP_LEN around both sides; analysis/timeline duration is authoritative. */
  moveBoundary: (rightClipId: string, newTime: number) => void;
};

const emptyState = {
  projectId: null,
  projectName: null,
  songId: null,
  songFilename: null,
  audioUrl: null,
  analysis: null,
  clips: [],
  selectedClipId: null,
  playhead: 0,
  isPlaying: false,
  characterImageUrl: null,
  avatarId: null,
  avatarName: null,
  avatarStatus: "idle" as State["avatarStatus"],
  avatarError: null,
  lookbook: [],
  zoom: 1,
  jobs: [],
};

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      ...emptyState,

      setProjectName: (name) => set({ projectName: name }),

      getSnapshot: () => {
        const s = get();
        return {
          projectId: s.projectId,
          projectName: s.projectName,
          songId: s.songId,
          songFilename: s.songFilename,
          audioUrl: s.audioUrl,
          analysis: s.analysis,
          clips: s.clips,
          characterImageUrl: s.characterImageUrl,
          avatarId: s.avatarId,
          avatarName: s.avatarName,
          lookbook: s.lookbook,
          zoom: s.zoom,
          playhead: s.playhead,
        };
      },

      restoreSnapshot: (snapshot) => {
        const result = ProjectSnapshot.safeParse(snapshot);
        if (!result.success) {
          console.warn("ignoring invalid project snapshot:", result.error.message);
          return;
        }
        const s = result.data;
        const clips = normalizeGenerationClips((s.clips ?? []).map((c) =>
          c.status === "queued" || c.status === "generating"
            ? {
                ...c,
                status: "empty" as const,
                generationTaskId: undefined,
                videoUrl: undefined,
                thumbnailUrl: undefined,
              }
            : c
        ));
        set({
          ...emptyState,
          projectId: s.projectId ?? null,
          projectName: s.projectName ?? null,
          songId: s.songId ?? null,
          songFilename: s.songFilename ?? null,
          audioUrl: s.audioUrl ?? null,
          analysis: s.analysis ?? null,
          clips,
          characterImageUrl: s.characterImageUrl ?? null,
          avatarId: s.avatarId ?? null,
          avatarName: s.avatarName ?? null,
          avatarStatus: s.avatarId ? "ready" : "idle",
          lookbook: s.lookbook ?? [],
          zoom: s.zoom ?? 1,
          playhead: s.playhead ?? 0,
          selectedClipId: null,
          isPlaying: false,
          jobs: [],
        });
      },

      loadSong: (songId, audioUrl, analysis, filename) => {
        const clips = analysis.sections.flatMap((section) => clipForSection(section));
        set({
          projectId: get().projectId ?? `proj-${crypto.randomUUID().slice(0, 8)}`,
          songId,
          songFilename: filename,
          audioUrl,
          analysis,
          clips,
          selectedClipId: null,
          playhead: 0,
          isPlaying: false,
          zoom: 1,
          jobs: [],
        });
      },
      unloadSong: () =>
        set({
          songId: null,
          songFilename: null,
          audioUrl: null,
          analysis: null,
          clips: [],
          selectedClipId: null,
          playhead: 0,
          isPlaying: false,
          jobs: [],
        }),
      resetProject: () => set({ ...emptyState }),
      selectClip: (id) => set({ selectedClipId: id }),
      setPlayhead: (t) => set({ playhead: t }),
      setPlaying: (p) => set({ isPlaying: p }),
      togglePlay: () => {
        const ws = getWs();
        if (!ws) return;
        ws.playPause();
      },
      updateClip: (id, patch) =>
        set((s) => ({ clips: s.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
      setCharacter: (url) => set({ characterImageUrl: url, avatarId: null, avatarName: null, avatarStatus: "idle", avatarError: null }),
      setAvatarId: (id) => set({ avatarId: id, avatarStatus: id ? "ready" : "idle" }),
      setAvatarName: (name) => set({ avatarName: name }),
      setAvatarStatus: (status, error) => set({ avatarStatus: status, avatarError: error ?? null }),
      pickAvatar: (id, name, imageUri) => set({
        avatarId: id,
        avatarName: name,
        characterImageUrl: imageUri,
        avatarStatus: "ready",
        avatarError: null,
      }),
      addLookbook: (url) =>
        set((s) => (s.lookbook.includes(url) ? s : { lookbook: [...s.lookbook, url] })),
      removeLookbook: (url) =>
        set((s) => ({ lookbook: s.lookbook.filter((u) => u !== url) })),
      replaceLookbookUrl: (oldUrl, newUrl) =>
        set((s) => {
          const idx = s.lookbook.indexOf(oldUrl);
          if (idx < 0 || oldUrl === newUrl) return s;
          // If the new URL is already in the lookbook (race), just remove the
          // old one rather than create a duplicate.
          if (s.lookbook.includes(newUrl)) {
            return { lookbook: s.lookbook.filter((u) => u !== oldUrl) };
          }
          const next = [...s.lookbook];
          next[idx] = newUrl;
          return { lookbook: next };
        }),

      setZoom: (z) => set({ zoom: clamp(z, ZOOM_MIN, ZOOM_MAX) }),
      zoomIn: () => set((s) => ({ zoom: clamp(s.zoom * ZOOM_STEP, ZOOM_MIN, ZOOM_MAX) })),
      zoomOut: () => set((s) => ({ zoom: clamp(s.zoom / ZOOM_STEP, ZOOM_MIN, ZOOM_MAX) })),
      zoomFit: () => set({ zoom: 1 }),

      setJobs: (jobs) =>
        set((s) => ({ jobs: typeof jobs === "function" ? jobs(s.jobs) : jobs })),

      splitPreviewTime: () => {
        const { clips, playhead, analysis } = get();
        if (!analysis) return null;
        const target = clips.find((c) => playhead > c.start && playhead < c.end);
        if (!target) return null;
        const lo = target.start + MIN_CLIP_LEN;
        const hi = target.end - MIN_CLIP_LEN;
        if (lo >= hi) return null;
        const snap = nearestBeatInRange(playhead, analysis.beats, lo, hi);
        const at = snap ?? clamp(playhead, lo, hi);
        if (at <= target.start || at >= target.end) return null;
        return at;
      },

      splitAtPlayhead: () => {
        const { clips, playhead, analysis } = get();
        if (!analysis) return { ok: false, reason: "no song loaded" };
        const idx = clips.findIndex((c) => playhead > c.start && playhead < c.end);
        if (idx < 0) return { ok: false, reason: "playhead not over a clip" };
        const target = clips[idx]!;

        const lo = target.start + MIN_CLIP_LEN;
        const hi = target.end - MIN_CLIP_LEN;
        if (lo >= hi) return { ok: false, reason: `clip too short to split (min ${MIN_CLIP_LEN * 2}s)` };
        const snap = nearestBeatInRange(playhead, analysis.beats, lo, hi);
        const at = snap ?? clamp(playhead, lo, hi);

        if (at <= target.start || at >= target.end) {
          return { ok: false, reason: "snap target outside clip" };
        }
        if (at - target.start < MIN_CLIP_LEN || target.end - at < MIN_CLIP_LEN) {
          return { ok: false, reason: `each half must be ≥${MIN_CLIP_LEN}s` };
        }

        const left: Clip = { ...target, end: at };
        const wasReady = target.status === "ready";
        const right: Clip = {
          ...target,
          id: newClipId(),
          start: at,
          source: wasReady ? (target.seedImageUrl ? "imageToVideo" : "textToVideo") : target.source,
          status: wasReady ? "empty" : target.status,
          videoUrl: wasReady ? undefined : target.videoUrl,
          thumbnailUrl: wasReady ? undefined : target.thumbnailUrl,
          generationTaskId: wasReady ? undefined : target.generationTaskId,
          prompt: wasReady ? undefined : target.prompt,
          lastError: undefined,
        };

        const next = [...clips.slice(0, idx), left, right, ...clips.slice(idx + 1)];
        set({ clips: next, selectedClipId: left.id });
        return { ok: true, at };
      },

      moveBoundary: (rightClipId, newTime) => {
        set((s) => {
          const idx = s.clips.findIndex((c) => c.id === rightClipId);
          if (idx <= 0) return s;
          const left = s.clips[idx - 1]!;
          const right = s.clips[idx]!;

          const minTime = left.start + MIN_CLIP_LEN;
          const maxTime = right.end - MIN_CLIP_LEN;
          const lo = minTime;
          const hi = maxTime;
          if (lo >= hi) return s;
          const t = clamp(newTime, lo, hi);

          // Ordinary source clips keep the editor's historical time-stretch behavior.
          // Agnes clips are generated to cover their timeline slot and must never be
          // stretched: shrinking a left clip is a safe hard trim, while growing it
          // or moving a right clip's start requires regeneration. Historical lipSync
          // media keeps the same hard-trim semantics for saved projects.
          const wipe = (c: Clip): Clip => ({
            ...c,
            status: "empty",
            videoUrl: undefined,
            thumbnailUrl: undefined,
            generationTaskId: undefined,
            lastError: undefined,
          });
          const requiresHardTrim = (c: Clip) =>
            c.source === "lipSync" || c.model === "agnes-video-v2.0";
          const trimLeft = (c: Clip, newEnd: number): Clip => {
            const updated = { ...c, end: newEnd };
            if (c.status !== "ready" || !requiresHardTrim(c)) return updated;
            return newEnd < c.end ? updated : wipe(updated);
          };
          const trimRight = (c: Clip, newStart: number): Clip => {
            const updated = { ...c, start: newStart };
            if (c.status !== "ready" || !requiresHardTrim(c)) return updated;
            return wipe(updated);
          };

          const newLeft = trimLeft(left, t);
          const newRight = trimRight(right, t);
          return {
            clips: [...s.clips.slice(0, idx - 1), newLeft, newRight, ...s.clips.slice(idx + 1)],
          };
        });
      },

      mergeWithRight: (clipId) => {
        const { clips } = get();
        const idx = clips.findIndex((c) => c.id === clipId);
        if (idx < 0) return { ok: false, reason: "clip not found" };
        if (idx >= clips.length - 1) return { ok: false, reason: "no neighbor to the right" };
        const left = clips[idx]!;
        const right = clips[idx + 1]!;
        const merged: Clip = {
          ...left,
          end: right.end,
          status: left.status === "ready" || right.status === "ready" ? "empty" : left.status,
          videoUrl: undefined,
          thumbnailUrl: undefined,
          generationTaskId: undefined,
          lastError: undefined,
        };
        const next = [...clips.slice(0, idx), merged, ...clips.slice(idx + 2)];
        set({ clips: next, selectedClipId: merged.id });
        return { ok: true };
      },
    }),
    {
      name: PERSIST_KEY,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Only persist the project data — runtime objects (ws, jobs, isPlaying)
      // are deliberately left out. Jobs are runtime-only: a tab close cancels
      // them by definition.
      partialize: (s) =>
        ({
          projectId: s.projectId,
          projectName: s.projectName,
          songId: s.songId,
          songFilename: s.songFilename,
          audioUrl: s.audioUrl,
          analysis: s.analysis,
          clips: s.clips,
          characterImageUrl: s.characterImageUrl,
          avatarId: s.avatarId,
          avatarName: s.avatarName,
          lookbook: s.lookbook,
          zoom: s.zoom,
          playhead: s.playhead,
        }) as Partial<State>,
      // On rehydrate, any clip that was in the local queue is now stale (the
      // queue is process-memory, gone after reload). Reset those to empty so
      // the user can re-enqueue. Clips already "generating" keep their state
      // and generationTaskId so Editor.resumeInflightJobs can reattach to the
      // server-side task. Prompt and source choice are preserved either way.
      merge: (persisted, current) => {
        const result = ProjectSnapshot.safeParse(persisted);
        if (!result.success) {
          if (persisted) {
            console.warn("dropping unrecognized persisted state:", result.error.message);
          }
          return current;
        }
        const ps = result.data;
        const clips = normalizeGenerationClips((ps.clips ?? []).map((c) =>
          c.status === "queued"
            ? {
                ...c,
                status: "empty" as const,
                generationTaskId: undefined,
                videoUrl: undefined,
                thumbnailUrl: undefined,
              }
            : c
        ));
        return { ...current, ...ps, clips };
      },
    }
  )
);
