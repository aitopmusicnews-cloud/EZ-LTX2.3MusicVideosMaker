import { useEffect, useMemo, useState } from "react";
import { useStore } from "../lib/store.js";
import type { Clip } from "@mvs/shared";
import { enqueueGeneration, type GenerationSource } from "../lib/scheduler.js";
import { extractLastFrame, pollTask, startTextToImage } from "../lib/api.js";
import { AssetUploader } from "./AssetUploader.js";
import { toast } from "../lib/toast.js";
import { ensureImageVideoPrompt } from "../lib/musicPromptEnhancer.js";

const AGNES_MODEL = "agnes-video-v2.0";

const SOURCES: Array<{ value: GenerationSource; label: string; desc: string }> = [
  {
    value: "textToVideo",
    label: "Text → Video",
    desc: "Generate a visual directly from the scene direction for this timeline slot.",
  },
  {
    value: "imageToVideo",
    label: "Image → Video",
    desc: "Animate a selected reference frame with Agnes while preserving the timeline duration.",
  },
];

const MOTION_PRESETS = [
  { label: "Dolly In", text: "slow dolly-in toward the subject, 35mm lens" },
  { label: "Orbit", text: "smooth orbital camera move around the subject" },
  { label: "Crane Up", text: "camera cranes upward to reveal the environment" },
  { label: "Drone Sweep", text: "wide cinematic aerial sweep with atmospheric depth" },
  { label: "Low Angle", text: "low-angle tracking shot with a heroic perspective" },
  { label: "Macro", text: "extreme macro close-up with shallow depth of field" },
  { label: "Whip Pan", text: "fast whip-pan transition with energetic motion blur" },
  { label: "Handheld", text: "natural handheld camera movement with controlled shake" },
];

function normalizeSource(source: string): GenerationSource {
  return source === "imageToVideo" || source === "archetype" ? "imageToVideo" : "textToVideo";
}

export function Sidebar() {
  const selectedId = useStore((s) => s.selectedClipId);
  const clips = useStore((s) => s.clips);
  const analysis = useStore((s) => s.analysis);
  const lookbook = useStore((s) => s.lookbook);
  const addLookbook = useStore((s) => s.addLookbook);
  const updateClip = useStore((s) => s.updateClip);

  const [extracting, setExtracting] = useState(false);
  const [creatingCharacter, setCreatingCharacter] = useState(false);
  const [characterPrompt, setCharacterPrompt] = useState("");
  const clip = useMemo(() => clips.find((c) => c.id === selectedId) ?? null, [clips, selectedId]);
  const source = normalizeSource(clip?.source ?? "textToVideo");

  useEffect(() => {
    if (clip && clip.status !== "ready" && (clip.source !== source || clip.model !== AGNES_MODEL)) {
      updateClip(clip.id, { source, model: AGNES_MODEL });
    }
  }, [clip?.id, clip?.source, clip?.status, clip?.model, source, updateClip]);

  if (!clip || !analysis) return null;

  const sections = analysis.sections ?? [];
  const rmsCurve = analysis.rmsCurve ?? [];
  const analysisDuration = analysis.duration ?? Math.max(clip.end, 1);
  const section = sections.find((s) => (s.start ?? 0) <= clip.start && (s.end ?? 0) >= clip.end);
  const sectionLabel = section?.label ?? clip.sectionLabel ?? "section";
  const durationSec = clip.end - clip.start;
  const energy = avgRms(rmsCurve, clip.start, clip.end, analysisDuration);
  const prompt = clip.prompt ?? "";
  const cameraPrompt = (clip as Clip & { cameraPrompt?: string }).cameraPrompt ?? "";
  const selectedImage = clip.archetypeUrl ?? lookbook[0];

  const setSource = (next: GenerationSource) => {
    updateClip(clip.id, { source: next, model: AGNES_MODEL, lastError: undefined });
  };

  const canGenerate = checkCanGenerate(source, { prompt, selectedImage });

  const onGenerate = () => {
    if (!canGenerate.ok) {
      toast.warning(canGenerate.reason);
      return;
    }
    const rawPrompt = [prompt.trim(), cameraPrompt.trim()]
      .filter(Boolean)
      .join(". Camera direction: ");
    const fullPrompt = ensureImageVideoPrompt(rawPrompt, {
      sectionLabel,
      energy,
      hasPreviousClip: false,
    });
    updateClip(clip.id, { prompt: fullPrompt, model: AGNES_MODEL });
    enqueueGeneration({
      clipId: clip.id,
      source,
      seedImageUrl: source === "imageToVideo" ? selectedImage ?? "" : "",
      prompt: fullPrompt,
      duration: durationSec,
      sectionLabel,
      energy,
      model: AGNES_MODEL,
    });
  };

  const onCreateCharacter = async () => {
    const text = characterPrompt.trim();
    if (!text) {
      toast.warning("Describe the artist or reference frame first");
      return;
    }
    setCreatingCharacter(true);
    try {
      const task = await startTextToImage({ promptText: text, ratio: "16:9", model: "sdxl" });
      const final = await pollTask(task.id, 1500, 180_000);
      const imageUrl = final.outputUrl || (!Array.isArray(final.output) ? final.output?.imageUrl ?? final.output?.url : undefined);
      if (!imageUrl) throw new Error(final.error ?? "The image service returned no image URL");
      addLookbook(imageUrl);
      updateClip(clip.id, { archetypeUrl: imageUrl });
      toast.success("Character reference created and selected");
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      toast.error(`Character generation failed: ${reason.slice(0, 120)}`);
    } finally {
      setCreatingCharacter(false);
    }
  };

  const onExtractFrame = async () => {
    if (!clip.videoUrl) return;
    setExtracting(true);
    try {
      const { url } = await extractLastFrame(clip.videoUrl);
      addLookbook(url);
      updateClip(clip.id, { archetypeUrl: url });
      toast.success("Last frame saved as a reusable reference");
    } catch (error) {
      toast.error(`Frame extraction failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setExtracting(false);
    }
  };

  const promptLabel = source === "textToVideo" ? "Scene prompt" : "Motion prompt";

  return (
    <>
      <div className="sidebar-header-row">
        <span className="pill">Agnes Video</span>
        <span className="meta">{durationSec.toFixed(1)}s · {clip.id}</span>
      </div>

      <div className="ltx-engine-card">
        <div className="ltx-engine-title">Music Video Generation</div>
        <div className="ltx-engine-meta">Agnes Video V2.0 · timeline-timed visuals · original song soundtrack</div>
      </div>

      <div className="option-group">
        <div className="label">Create artist / reference frame</div>
        <textarea
          className="prompt compact"
          placeholder="Describe the artist, wardrobe, face, location, lighting, and camera framing…"
          value={characterPrompt}
          onChange={(e) => setCharacterPrompt(e.target.value)}
        />
        <button type="button" className="btn ghost w-full" onClick={onCreateCharacter} disabled={creatingCharacter}>
          {creatingCharacter ? "Creating reference…" : "Generate character reference"}
        </button>
        <div className="select-desc">The result is added to your reference images and selected for this clip.</div>
      </div>

      <div className="option-group">
        <div className="label">Generation mode</div>
        <div className="select-wrap">
          <select className="select" value={source} onChange={(e) => setSource(e.target.value as GenerationSource)}>
            {SOURCES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <span className="select-chevron">▾</span>
        </div>
        <div className="select-desc">{SOURCES.find((item) => item.value === source)?.desc}</div>
      </div>

      {source === "imageToVideo" && (
        <div className="option-group">
          <div className="label">First-frame reference</div>
          <ImageSeedGrid
            lookbook={lookbook}
            selectedUrl={clip.archetypeUrl}
            onPick={(url) => updateClip(clip.id, { archetypeUrl: url })}
            onClear={() => updateClip(clip.id, { archetypeUrl: undefined })}
          />
          <div className="select-desc">Upload, generate, or select one image. Agnes uses it as the image-to-video reference.</div>
        </div>
      )}

      <div className="option-group">
        <div className="label">{promptLabel}</div>
        <textarea
          className="prompt"
          placeholder="Describe the subject, action, setting, camera, lighting, and visual motion…"
          value={prompt}
          onChange={(e) => updateClip(clip.id, { prompt: e.target.value })}
        />
        <div className="select-desc">Generated clip audio is discarded. The original uploaded song remains the Final Cut soundtrack.</div>
      </div>

      <div className="option-group">
        <div className="label">Camera direction</div>
        <textarea
          className="prompt compact"
          placeholder="Example: slow push-in, eye-level 35mm lens, subject centered…"
          value={cameraPrompt}
          onChange={(e) => updateClip(clip.id, { cameraPrompt: e.target.value } as Partial<Clip>)}
        />
        <div className="motion-presets">
          {MOTION_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className="model-chip"
              onClick={() => updateClip(clip.id, {
                cameraPrompt: cameraPrompt ? `${cameraPrompt}, ${preset.text}` : preset.text,
              } as Partial<Clip>)}
            >
              + {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div className="option-group">
        <div className="label">Clip context</div>
        <div className="context-card">
          <div className="row"><span>Song section</span><span>{sectionLabel}</span></div>
          <div className="row"><span>Energy</span><span>{energy.toFixed(2)}</span></div>
          <div className="row"><span>Timeline duration</span><span>{durationSec.toFixed(2)}s</span></div>
          <div className="row"><span>Final audio</span><span>Original song</span></div>
        </div>
      </div>

      {clip.status === "ready" && clip.videoUrl && (
        <div className="option-group">
          <button type="button" className="btn ghost w-full" onClick={onExtractFrame} disabled={extracting}>
            {extracting ? "Extracting frame…" : "Save last frame as reference"}
          </button>
        </div>
      )}

      {clip.lastError && (
        <div className="error-card">
          <div className="error-title">Last operation</div>
          <div className="error-message">{clip.lastError}</div>
        </div>
      )}

      <div className="sidebar-footer">
        <button
          className="generate-btn"
          onClick={onGenerate}
          disabled={clip.status === "queued" || clip.status === "generating" || !canGenerate.ok}
          title={canGenerate.ok ? undefined : canGenerate.reason}
        >
          {clip.status === "queued"
            ? "Queued…"
            : clip.status === "generating"
              ? "Generating with Agnes…"
              : clip.status === "failed"
                ? "Retry Agnes"
                : clip.status === "ready"
                  ? "Regenerate with Agnes"
                  : "Generate with Agnes"}
        </button>

        {(clip.videoUrl || clip.status !== "empty") && (
          <button
            type="button"
            className="btn ghost clear-clip-btn"
            onClick={() => {
              if (clip.status === "ready" && !confirm("Clear this clip's generated video? The prompt will be kept.")) return;
              updateClip(clip.id, {
                status: "empty",
                videoUrl: undefined,
                thumbnailUrl: undefined,
                generationTaskId: undefined,
                lastError: undefined,
              });
            }}
          >
            Clear clip
          </button>
        )}
      </div>
    </>
  );
}

type CanGenerate = { ok: true; reason?: string } | { ok: false; reason: string };

function checkCanGenerate(
  source: GenerationSource,
  context: { prompt: string; selectedImage?: string },
): CanGenerate {
  if (!context.prompt.trim()) return { ok: false, reason: "Describe the scene before generating" };
  if (source === "imageToVideo" && !context.selectedImage) {
    return { ok: false, reason: "Select or upload a first-frame reference image" };
  }
  return { ok: true };
}

function ImageSeedGrid({
  lookbook,
  selectedUrl,
  onPick,
  onClear,
}: {
  lookbook: string[];
  selectedUrl: string | undefined;
  onPick: (url: string) => void;
  onClear: () => void;
}) {
  const customUrl = selectedUrl && !lookbook.includes(selectedUrl) ? selectedUrl : null;
  const images = customUrl ? [...lookbook, customUrl] : lookbook;
  const active = selectedUrl ?? lookbook[0];

  return (
    <div className="archetype-grid">
      {images.map((url) => {
        const isCustom = url === customUrl;
        return (
          <div key={url} className={`archetype-tile-wrap${isCustom ? " custom" : ""}`}>
            <button
              type="button"
              className={`archetype-tile${active === url ? " selected" : ""}`}
              style={{ backgroundImage: `url(${url})` }}
              onClick={() => onPick(url)}
              aria-label="Select first-frame reference"
            />
            {isCustom && (
              <button type="button" className="archetype-clear" onClick={onClear} aria-label="Remove custom reference">×</button>
            )}
          </div>
        );
      })}
      <AssetUploader className="archetype-tile add" onUploaded={onPick}>
        <span className="tile-add-label">+</span>
      </AssetUploader>
      {images.length === 0 && <div className="archetype-empty">Add the first image that Agnes should animate.</div>}
    </div>
  );
}

function avgRms(curve: number[], start: number, end: number, duration: number): number {
  if (!curve.length) return 0;
  const i0 = Math.max(0, Math.floor((start / duration) * curve.length));
  const i1 = Math.min(curve.length, Math.ceil((end / duration) * curve.length));
  const slice = curve.slice(i0, Math.max(i0 + 1, i1));
  return slice.reduce((sum, value) => sum + value, 0) / slice.length;
}
