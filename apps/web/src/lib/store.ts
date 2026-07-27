import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { AudioAnalysis, AudioSection, Clip } from "@mvs/shared";
import { ProjectSnapshot } from "@mvs/shared";
import type { Job } from "./scheduler.js";
import { getWs } from "./wavesurfer-ref.js";

export const MAX_CLIP_LEN = 5;
export const MIN_CLIP_LEN = 0.5;

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 32;
export const ZOOM_STEP = 1.5;

// Force a clean reset after the Modal workspace migration. Any project state
// persisted under the previous versions may reference stale workspace assets,
// clips, or analysis data and must not be restored into this deployment.
const PERSIST_KEY = "mvs-project-v3";

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

function normalizeLtxClips(clips: Clip[]): Clip[] {
  return clips.map((clip, index) => {
    if (clip.status === "ready" && clip.source === "upload") return clip;
    let source: string;
    if (clip.source === "imageToVideo" || clip.source === "archetype") source = "imageToVideo";
    else if (clip.source === "continue" && index > 0) source = "continue";
    else source = "textToVideo";
    return { ...clip, source, model: "ltx-video" };
  });
}

function normalizeAnalysis(analysis: AudioAnalysis | null | undefined): AudioAnalysis | null {
  if (!analysis) return null;
  return {
    ...analysis,
    sections: Array.isArray(analysis.sections) ? analysis.sections : [],
    beats: Array.isArray(analysis.beats) ? analysis.beats : [],
  };
}

function subdivideSection(section: AudioSection, beats: number[]): Clip[] {
  const len = section.end - section.start;
  if (len <= MAX_CLIP_LEN) {
    return [
      {
        id: newClipId(),
        start: section.start,
        end: section.end,
        source: "continue",
        status: "empty",
      },
    ];
  }
  const count = Math.ceil(len / MAX_CLIP_LEN);
  const idealLen = len / count;
  const clips: Clip[] = [];
  let cursor = section.start;
  for (let i = 0; i < count - 1; i++) {
    const target = section.start + idealLen * (i + 1);
    const lo = cursor + MIN_CLIP_LEN;
    const hi = section.end - MIN_CLIP_LEN;
    const candidates = beats.filter((b) => b >= lo && b <= hi);
    const cut = candidates.length ? nearestBeat(target, candidates)! : Math.min(hi, Math.max(lo, target));
    clips.push({
      id: newClipId(),
      start: cursor,
      end: cut,
      source: "continue",
      status: "empty",
    });
    cursor = cut;
  }
  clips.push({
    id: newClipId(),
    start: cursor,
    end: section.end,
    source: "continue",
    status: "empty",
  });
  return clips;
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
  unloadSong: () => void;
  resetProject: () => void;
  getSnapshot: () => Record<string, unknown>;
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
  replaceLookbookUrl: (oldUrl: string, newUrl: string) => void;

  setZoom: (z: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomFit: () => void;

  setJobs: (jobs: Job[] | ((prev: Job[]) => Job[])) => void;

  splitAtPlayhead: () => { ok: true; at: number } | { ok: false; reason: string };
  mergeWithRight: (clipId: string) => { ok: true } | { ok: false; reason: string };
  splitPreviewTime: () => number | null;
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
        const analysis = normalizeAnalysis(s.analysis);
        const clips = normalizeLtxClips((s.clips ?? []).map((c) =>
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
          analysis,
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

      loadSong: (songId, audioUrl, rawAnalysis, filename) => {
        const analysis = normalizeAnalysis(rawAnalysis);
        if (!analysis) {
          set({
            projectId: get().projectId ?? `proj-${crypto.randomUUID().slice(0, 8)}`,
            songId,
            songFilename: filename,
            audioUrl,
            analysis: null,
            clips: [],
            selectedClipId: null,
            playhead: 0,
            isPlaying: false,
            zoom: 1,
            jobs: [],
          });
          return;
        }
        const clips = analysis.sections.flatMap((s) => subdivideSection(s, analysis.beats));
        if (clips[0]) clips[0] = { ...clips[0], source: "textToVideo", model: "ltx-video" };
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
        if (!analysis) return { ok: false, reason: "No song analysis loaded." };
        const idx = clips.findIndex((c) => playhead > c.start && playhead < c.end);
        if (idx < 0) return { ok: false, reason: "Playhead is not inside a clip." };
        const target = clips[idx]!;
        const lo = target.start + MIN_CLIP_LEN;
        const hi = target.end - MIN_CLIP_LEN;
        if (lo >= hi) return { ok: false, reason: "Clip is too short to split." };
        const snap = nearestBeatInRange(playhead, analysis.beats, lo, hi);
        const at = snap ?? clamp(playhead, lo, hi);
        if (at <= target.start || at >= target.end) return { ok: false, reason: "Split point is outside the clip." };
        const left: Clip = { ...target, end: at };
        const right: Clip = { ...target, id: newClipId(), start: at };
        set({ clips: [...clips.slice(0, idx), left, right], selectedClipId: right.id, playhead: at });
        return { ok: true, at };
      },

      mergeWithRight: (clipId) => {
        const { clips } = get();
        const idx = clips.findIndex((c) => c.id === clipId);
        if (idx < 0 || idx >= clips.length - 1) return { ok: false, reason: "No clip to merge." };
        const a = clips[idx]!;
        const b = clips[idx + 1]!;
        const merged: Clip = { ...a, end: b.end, status: "empty", videoUrl: undefined, thumbnailUrl: undefined, generationTaskId: undefined };
        set({ clips: [...clips.slice(0, idx), merged, ...clips.slice(idx + 2)], selectedClipId: merged.id });
        return { ok: true };
      },

      moveBoundary: (rightClipId, newTime) => {
        const { clips } = get();
        const idx = clips.findIndex((c) => c.id === rightClipId);
        if (idx <= 0) return;
        const left = clips[idx - 1]!;
        const right = clips[idx]!;
        const lo = Math.max(left.start + MIN_CLIP_LEN, right.end - MAX_CLIP_LEN);
        const hi = Math.min(left.end - MIN_CLIP_LEN, right.end - MIN_CLIP_LEN);
        if (lo >= hi) return;
        const at = clamp(newTime, lo, hi);
        const next = [...clips];
        next[idx - 1] = { ...left, end: at, status: "empty", videoUrl: undefined, thumbnailUrl: undefined, generationTaskId: undefined };
        next[idx] = { ...right, start: at, status: "empty", videoUrl: undefined, thumbnailUrl: undefined, generationTaskId: undefined };
        set({ clips: next, selectedClipId: rightClipId, playhead: at });
      },
    }),
    {
      name: PERSIST_KEY,
      version: 3,
      storage: createJSONStorage(() => localStorage),
      migrate: () => ({ ...emptyState }),
      partialize: (s) => ({
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
      }),
    },
  ),
);
