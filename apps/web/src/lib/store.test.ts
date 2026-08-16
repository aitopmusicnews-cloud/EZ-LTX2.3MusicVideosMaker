import { describe, it, expect, beforeEach } from "vitest";
import type { Clip } from "@mvs/shared";
import { useStore, MIN_CLIP_LEN } from "./store.js";

function makeClip(over: Partial<Clip> & { id: string; start: number; end: number }): Clip {
  return {
    source: "textToVideo",
    status: "empty",
    ...over,
  };
}

describe("analysis-driven timeline durations", () => {
  beforeEach(() => {
    useStore.setState({ clips: [], selectedClipId: null, projectId: null });
  });

  it("creates one timeline clip per analysis section without a five-second cap", () => {
    useStore.getState().loadSong(
      "song-1",
      "/storage/song.mp3",
      {
        duration: 18,
        beats: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18],
        sections: [
          { start: 0, end: 7.25, label: "intro" },
          { start: 7.25, end: 18, label: "verse" },
        ],
      },
      "song.mp3",
    );
    const clips = useStore.getState().clips;
    expect(clips).toHaveLength(2);
    expect(clips.map((clip) => clip.end - clip.start)).toEqual([7.25, 10.75]);
    expect(clips.every((clip) => clip.model === "agnes-video-v2.0")).toBe(true);
  });
});

describe("moveBoundary", () => {
  beforeEach(() => {
    useStore.setState({ clips: [], selectedClipId: null });
  });

  it("moves the boundary beyond five seconds while preserving the minimum clip length", () => {
    useStore.setState({
      clips: [
        makeClip({ id: "a", start: 0, end: 5 }),
        makeClip({ id: "b", start: 5, end: 30 }),
      ],
    });
    useStore.getState().moveBoundary("b", 20);
    const [a, b] = useStore.getState().clips;
    expect(a!.end).toBe(20);
    expect(a!.end - a!.start).toBe(20);
    expect(b!.end - b!.start).toBe(10);
  });

  it("clamps so neither side shrinks below MIN_CLIP_LEN", () => {
    useStore.setState({
      clips: [
        makeClip({ id: "a", start: 0, end: 5 }),
        makeClip({ id: "b", start: 5, end: 10 }),
      ],
    });
    useStore.getState().moveBoundary("b", 99);
    const [a, b] = useStore.getState().clips;
    expect(b!.end - b!.start).toBeGreaterThanOrEqual(MIN_CLIP_LEN);
    expect(a!.end).toBeLessThanOrEqual(10 - MIN_CLIP_LEN);
  });

  it("preserves ready ordinary source clips that still use legacy render stretching", () => {
    useStore.setState({
      clips: [
        makeClip({ id: "a", start: 0, end: 5, status: "ready", source: "upload", videoUrl: "https://example.com/a.mp4" }),
        makeClip({ id: "b", start: 5, end: 10, status: "ready", source: "upload", videoUrl: "https://example.com/b.mp4" }),
      ],
    });
    useStore.getState().moveBoundary("b", 7);
    const [a, b] = useStore.getState().clips;
    expect(a!.videoUrl).toBe("https://example.com/a.mp4");
    expect(a!.status).toBe("ready");
    expect(b!.videoUrl).toBe("https://example.com/b.mp4");
    expect(b!.status).toBe("ready");
  });

  it("keeps a ready Agnes left clip only when its slot shrinks", () => {
    useStore.setState({
      clips: [
        makeClip({ id: "a", start: 0, end: 6, status: "ready", model: "agnes-video-v2.0", videoUrl: "https://example.com/a.mp4" }),
        makeClip({ id: "b", start: 6, end: 14 }),
      ],
    });
    useStore.getState().moveBoundary("b", 5);
    expect(useStore.getState().clips[0]!.videoUrl).toBe("https://example.com/a.mp4");
    useStore.getState().moveBoundary("b", 8);
    expect(useStore.getState().clips[0]!.videoUrl).toBeUndefined();
    expect(useStore.getState().clips[0]!.status).toBe("empty");
  });

  it("wipes a ready Agnes right clip whenever its start moves", () => {
    useStore.setState({
      clips: [
        makeClip({ id: "a", start: 0, end: 5 }),
        makeClip({ id: "b", start: 5, end: 11, status: "ready", model: "agnes-video-v2.0", videoUrl: "https://example.com/b.mp4" }),
      ],
    });
    useStore.getState().moveBoundary("b", 6);
    expect(useStore.getState().clips[1]!.videoUrl).toBeUndefined();
    expect(useStore.getState().clips[1]!.status).toBe("empty");
  });

  it("preserves historical lipSync hard-trim semantics for saved projects", () => {
    useStore.setState({
      clips: [
        makeClip({ id: "a", start: 0, end: 5, status: "ready", source: "lipSync", videoUrl: "https://example.com/lip-a.mp4" }),
        makeClip({ id: "b", start: 5, end: 10 }),
      ],
    });
    useStore.getState().moveBoundary("b", 3);
    expect(useStore.getState().clips[0]!.videoUrl).toBe("https://example.com/lip-a.mp4");
  });

  it("no-ops when the boundary cannot move", () => {
    useStore.setState({
      clips: [
        makeClip({ id: "a", start: 0, end: MIN_CLIP_LEN }),
        makeClip({ id: "b", start: MIN_CLIP_LEN, end: MIN_CLIP_LEN * 2 }),
      ],
    });
    const before = useStore.getState().clips;
    useStore.getState().moveBoundary("b", 0.3);
    expect(useStore.getState().clips).toEqual(before);
  });
});

describe("mergeWithRight", () => {
  it("allows merged timeline clips longer than five seconds", () => {
    useStore.setState({
      clips: [
        makeClip({ id: "a", start: 0, end: 6 }),
        makeClip({ id: "b", start: 6, end: 14 }),
      ],
    });
    expect(useStore.getState().mergeWithRight("a")).toEqual({ ok: true });
    expect(useStore.getState().clips[0]!.end - useStore.getState().clips[0]!.start).toBe(14);
  });
});
