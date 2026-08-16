import { useEffect, useMemo, useState } from "react";
import { useStore } from "../lib/store.js";
import {
  buildMusicVideoPrompt,
  type AdlibStyle,
  type CameraStyle,
  type MusicVideoType,
  type PerformanceStyle,
  type VisualStyle,
} from "../lib/musicPromptEnhancer.js";
import { toast } from "../lib/toast.js";

type ContinuityMode =
  | "automatic"
  | "new-shot"
  | "character-reference";

type EasyWayBrief = {
  mainCharacterUrl: string;
  additionalPerformerUrls: string[];
  identityLocks: string[];
  videoType: MusicVideoType;
  visualConcepts: string[];
  performanceChoices: string[];
  adlibChoices: string[];
  cameraStyle: CameraStyle;
  compositionChoices: string[];
  continuityMode: ContinuityMode;
  promotionChoices: string[];
  exportFormats: string[];
  spokenIdea: string;
};

const DEFAULT_BRIEF: EasyWayBrief = {
  mainCharacterUrl: "",
  additionalPerformerUrls: [],
  identityLocks: ["Same face", "Same hairstyle", "Keep jewelry", "Keep wardrobe"],
  videoType: "promo",
  visualConcepts: ["Artist performance"],
  performanceChoices: ["Natural movement", "Direct to camera"],
  adlibChoices: ["Automatic"],
  cameraStyle: "automatic",
  compositionChoices: ["Maintain framing", "Keep artist centered"],
  continuityMode: "automatic",
  promotionChoices: ["Artist name", "Song title"],
  exportFormats: ["YouTube 16:9", "Reels/TikTok 9:16"],
  spokenIdea: "",
};

const VISUAL_CONCEPTS = [
  "Artist performance",
  "Performance + story",
  "Storytelling",
  "Lifestyle",
  "Street",
  "Luxury",
  "Dance",
  "Abstract",
  "Dark",
  "Clean",
  "Colorful",
];

const PERFORMANCE_CHOICES = [
  "Natural movement",
  "Confident",
  "Restrained",
  "High energy",
  "Dance",
  "Direct to camera",
];

const ADLIB_CHOICES = [
  "Automatic",
  "Close-up",
  "Hand gesture",
  "Side angle",
  "Same shot",
  "Background layer",
];

const IDENTITY_LOCKS = [
  "Same face",
  "Same hairstyle",
  "Keep jewelry",
  "Keep wardrobe",
  "Allow wardrobe changes",
];

const COMPOSITION_CHOICES = [
  "Maintain framing",
  "Keep artist centered",
  "Vertical-safe composition",
  "Leave room for text",
];

const PROMOTION_CHOICES = [
  "Artist name",
  "Song title",
  "Release date",
  "Social handle",
  "Logo",
  "Call to action",
];

const EXPORT_FORMATS = [
  "YouTube 16:9",
  "Reels/TikTok 9:16",
  "Square 1:1",
  "All formats",
];

function storageKey(projectId: string | null, songId: string | null): string {
  return `mvs-easy-way-v1-${projectId ?? songId ?? "draft"}`;
}

function toggleChoice(values: string[], value: string): string[] {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value];
}

function averageEnergy(
  curve: number[],
  start: number,
  end: number,
  duration: number,
): number {
  if (!curve.length || duration <= 0 || end <= start) return 0.5;
  const first = Math.max(0, Math.min(curve.length - 1, Math.floor((start / duration) * curve.length)));
  const last = Math.max(first + 1, Math.min(curve.length, Math.ceil((end / duration) * curve.length)));
  const sample = curve.slice(first, last);
  return sample.length ? sample.reduce((sum, value) => sum + value, 0) / sample.length : 0.5;
}

function sectionLabelFor(
  start: number,
  end: number,
  sections: Array<{
    [key: string]: unknown;
    label?: string;
    start?: number;
    end?: number;
  }>,
): string {
  const section = sections.find((item) => {
    const sectionStart = Number(item.start);
    const sectionEnd = Number(item.end);

    return (
      Number.isFinite(sectionStart) &&
      Number.isFinite(sectionEnd) &&
      sectionStart <= start &&
      sectionEnd >= end
    );
  });

  return section?.label || "song section";
}

function primaryVisualStyle(values: string[]): VisualStyle {
  const text = values.join(" ").toLowerCase();
  if (text.includes("dark")) return "dark";
  if (text.includes("luxury")) return "luxury";
  if (text.includes("street")) return "street";
  if (text.includes("colorful")) return "colorful";
  if (text.includes("clean")) return "clean";
  return "automatic";
}

function primaryPerformance(values: string[]): PerformanceStyle {
  const text = values.join(" ").toLowerCase();
  if (text.includes("high energy")) return "high-energy";
  if (text.includes("dance")) return "dance";
  if (text.includes("confident")) return "confident";
  if (text.includes("restrained")) return "restrained";
  if (text.includes("direct to camera")) return "direct";
  return "natural";
}

function primaryAdlib(values: string[]): AdlibStyle {
  const text = values.join(" ").toLowerCase();
  if (text.includes("close-up")) return "close-up";
  if (text.includes("hand gesture")) return "gesture";
  if (text.includes("side angle")) return "side-look";
  if (text.includes("same shot")) return "same-shot";
  return "automatic";
}

function buildRawIdea(brief: EasyWayBrief, sectionLabel: string): string {
  return [
    brief.spokenIdea.trim(),
    brief.visualConcepts.length ? `The visual direction uses ${brief.visualConcepts.join(", ")}` : "",
    brief.performanceChoices.length ? `The performer uses ${brief.performanceChoices.join(", ")}` : "",
    brief.identityLocks.length ? `Preserve ${brief.identityLocks.join(", ")}` : "",
    brief.compositionChoices.length ? `Composition keeps ${brief.compositionChoices.join(", ")}` : "",
    brief.promotionChoices.length ? `Keep the composition usable for ${brief.promotionChoices.join(", ")}` : "",
    `This prompt is for the ${sectionLabel}`,
  ].filter(Boolean).join(". ");
}

function buildPrompt(
  brief: EasyWayBrief,
  sectionLabel: string,
  energy: number,
  hasPreviousClip: boolean,
): string {
  const shouldContinue =
    brief.continuityMode === "automatic" && hasPreviousClip;

  return buildMusicVideoPrompt({
    rawInput: buildRawIdea(brief, sectionLabel),
    videoType: brief.videoType,
    visualStyle: primaryVisualStyle(brief.visualConcepts),
    performanceStyle: primaryPerformance(brief.performanceChoices),
    adlibStyle: primaryAdlib(brief.adlibChoices),
    cameraStyle: brief.cameraStyle,
    sectionLabel,
    energy,
    hasPreviousClip: shouldContinue,
    suppliedSongAudio: false,
  });
}

function MultiChoiceDropdown({
  title,
  values,
  options,
  onChange,
}: {
  title: string;
  values: string[];
  options: string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <details className="easy-way-dropdown">
      <summary>
        <span>{title}</span>
        <span className="easy-way-summary-value">
          {values.length ? `${values.length} selected` : "Choose"}
        </span>
      </summary>
      <div className="easy-way-dropdown-body">
        {options.map((option) => (
          <label key={option} className="easy-way-check">
            <input
              type="checkbox"
              checked={values.includes(option)}
              onChange={() => onChange(toggleChoice(values, option))}
            />
            <span>{option}</span>
          </label>
        ))}
      </div>
    </details>
  );
}

export function EasyWayPromptAssistant() {
  const projectId = useStore((state) => state.projectId);
  const songId = useStore((state) => state.songId);
  const audioUrl = useStore((state) => state.audioUrl);
  const analysis = useStore((state) => state.analysis);
  const clips = useStore((state) => state.clips);
  const selectedClipId = useStore((state) => state.selectedClipId);
  const lookbook = useStore((state) => state.lookbook);
  const characterImageUrl = useStore((state) => state.characterImageUrl);
  const setCharacter = useStore((state) => state.setCharacter);
  const updateClip = useStore((state) => state.updateClip);

  const [open, setOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [brief, setBrief] = useState<EasyWayBrief>(DEFAULT_BRIEF);

  const key = storageKey(projectId, songId);
  const selectedClip = clips.find((clip) => clip.id === selectedClipId) ?? null;
  const availableReferences = useMemo(
    () => Array.from(new Set([characterImageUrl, ...lookbook].filter((value): value is string => Boolean(value)))),
    [characterImageUrl, lookbook],
  );

  useEffect(() => {
    const openPanel = () => setOpen(true);
    window.addEventListener("mvs-open-easy-way", openPanel);
    return () => window.removeEventListener("mvs-open-easy-way", openPanel);
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<EasyWayBrief>;
        setBrief({
          ...DEFAULT_BRIEF,
          ...parsed,
          mainCharacterUrl: parsed.mainCharacterUrl || characterImageUrl || availableReferences[0] || "",
        });
        return;
      }
    } catch (error) {
      console.warn("Could not restore The Easy Way setup", error);
    }
    setBrief({
      ...DEFAULT_BRIEF,
      mainCharacterUrl: characterImageUrl || availableReferences[0] || "",
    });
  }, [key]);

  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(brief));
  }, [brief, key]);

  const completed = [
    Boolean(brief.mainCharacterUrl),
    Boolean(audioUrl && analysis),
    brief.visualConcepts.length > 0,
    brief.performanceChoices.length > 0,
    Boolean(brief.cameraStyle),
    Boolean(brief.continuityMode),
    brief.exportFormats.length > 0,
  ].filter(Boolean).length;

  const updateBrief = <K extends keyof EasyWayBrief>(field: K, value: EasyWayBrief[K]) => {
    setBrief((current) => ({ ...current, [field]: value }));
  };

  const selectCharacter = (url: string) => {
    updateBrief("mainCharacterUrl", url);
    setCharacter(url || null);
  };

  const startVoiceInput = () => {
    const speechWindow = window as unknown as {
      SpeechRecognition?: new () => any;
      webkitSpeechRecognition?: new () => any;
    };
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      toast.warning("Voice input is not supported in this browser");
      return;
    }
    const recognition = new Recognition();
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onstart = () => setListening(true);
    recognition.onend = () => setListening(false);
    recognition.onerror = () => {
      setListening(false);
      toast.warning("Voice input stopped. Tap Speak and try again.");
    };
    recognition.onresult = (event: any) => {
      const text = Array.from(event.results ?? [])
        .map((result: any) => result?.[0]?.transcript ?? "")
        .join(" ")
        .trim();
      if (text) {
        updateBrief("spokenIdea", [brief.spokenIdea, text].filter(Boolean).join(" "));
        toast.success("Your music-video idea was added");
      }
    };
    recognition.start();
  };

  const applyToCurrentClip = () => {
    if (!brief.mainCharacterUrl) {
      toast.warning("Choose the main artist reference first");
      return;
    }
    if (!selectedClip || !analysis) {
      toast.warning("Load the song and select a timeline clip first");
      return;
    }
    const label = sectionLabelFor(selectedClip.start, selectedClip.end, analysis.sections ?? []);
    const energy = averageEnergy(
      analysis.rmsCurve ?? [],
      selectedClip.start,
      selectedClip.end,
      analysis.duration ?? Math.max(selectedClip.end, 1),
    );
    const clipIndex = clips.findIndex((clip) => clip.id === selectedClip.id);
    const shouldContinue = brief.continuityMode === "automatic" && clipIndex > 0;

    updateClip(selectedClip.id, {
      prompt: buildPrompt(brief, label, energy, shouldContinue),
      archetypeUrl: brief.mainCharacterUrl,
      seedImageUrl: brief.mainCharacterUrl,
      source: "imageToVideo",
      model: "agnes-video-v2.0",
      sectionLabel: label,
      lastError: undefined,
    });
    toast.success("The Easy Way setup was applied to this clip");
  };

  const buildFullPlan = () => {
    if (!brief.mainCharacterUrl) {
      toast.warning("Choose the main artist reference first");
      return;
    }
    if (!analysis || clips.length === 0) {
      toast.warning("Load and analyze the song first");
      return;
    }
    const duration = analysis.duration ?? Math.max(clips.at(-1)?.end ?? 1, 1);
    clips.forEach((clip, index) => {
      const label = sectionLabelFor(clip.start, clip.end, analysis.sections ?? []);
      const energy = averageEnergy(analysis.rmsCurve ?? [], clip.start, clip.end, duration);
      const shouldContinue = brief.continuityMode === "automatic" && index > 0;
      updateClip(clip.id, {
        prompt: buildPrompt(brief, label, energy, shouldContinue),
        archetypeUrl: brief.mainCharacterUrl,
        seedImageUrl: brief.mainCharacterUrl,
        source: "imageToVideo",
        model: "agnes-video-v2.0",
        sectionLabel: label,
        lastError: undefined,
      });
    });
    toast.success(`The Easy Way planned ${clips.length} music-video clips`);
  };

  const makeItForMe = () => {
    const recommended: EasyWayBrief = {
      ...brief,
      mainCharacterUrl: brief.mainCharacterUrl || characterImageUrl || availableReferences[0] || "",
      videoType: "promo",
      visualConcepts: brief.visualConcepts.length ? brief.visualConcepts : ["Artist performance"],
      performanceChoices: ["Natural movement", "Direct to camera"],
          adlibChoices: ["Automatic"],
      cameraStyle: "automatic",
      compositionChoices: ["Maintain framing", "Keep artist centered", "Vertical-safe composition"],
      continuityMode: "automatic",
      exportFormats: ["YouTube 16:9", "Reels/TikTok 9:16"],
    };
    setBrief(recommended);
    if (recommended.mainCharacterUrl) setCharacter(recommended.mainCharacterUrl);
    toast.success("The Easy Way selected the recommended music-video setup");
  };

  if (!open) return null;

  return (
    <div
      className="easy-way-drawer-overlay"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) setOpen(false);
      }}
    >
      <aside className="easy-way-drawer" aria-label="The Easy Way music-video setup">
        <header className="easy-way-drawer-header">
          <img src="/the-easy-way.png" alt="" />
          <div>
            <strong>The Easy Way</strong>
            <span>Music Video Setup · {completed} of 8 ready</span>
          </div>
          <button type="button" className="easy-way-drawer-close" onClick={() => setOpen(false)} aria-label="Close The Easy Way">×</button>
        </header>

        <div className="easy-way-progress">
          <span style={{ width: `${(completed / 8) * 100}%` }} />
        </div>

        <div className="easy-way-drawer-scroll">
          <details className="easy-way-dropdown" open>
            <summary>
              <span>1. Character & Cast *</span>
              <span className="easy-way-summary-value">{brief.mainCharacterUrl ? "Main artist ready" : "Required"}</span>
            </summary>
            <div className="easy-way-dropdown-body">
              <label className="easy-way-field">
                <span>Main artist reference</span>
                <select value={brief.mainCharacterUrl} onChange={(event) => selectCharacter(event.target.value)}>
                  <option value="">Select from References</option>
                  {availableReferences.map((url, index) => (
                    <option value={url} key={url}>Reference {index + 1}</option>
                  ))}
                </select>
              </label>
              {brief.mainCharacterUrl && <img className="easy-way-character-preview" src={brief.mainCharacterUrl} alt="Selected main artist reference" />}
              {!availableReferences.length && <div className="easy-way-note">Add the artist image under References first.</div>}
              <MultiChoiceDropdown title="Identity locks" values={brief.identityLocks} options={IDENTITY_LOCKS} onChange={(values) => updateBrief("identityLocks", values)} />
            </div>
          </details>

          <details className="easy-way-dropdown">
            <summary><span>2. Video Type</span><span className="easy-way-summary-value">{brief.videoType}</span></summary>
            <div className="easy-way-dropdown-body">
              <label className="easy-way-field">
                <span>Project type</span>
                <select value={brief.videoType} onChange={(event) => updateBrief("videoType", event.target.value as MusicVideoType)}>
                  <option value="promo">Promo clip</option>
                  <option value="full">Full music video</option>
                  <option value="performance">Performance video</option>
                  <option value="teaser">Social teaser</option>
                  <option value="visualizer">Visualizer</option>
                </select>
              </label>
            </div>
          </details>

          <MultiChoiceDropdown title="3. Visual Concept" values={brief.visualConcepts} options={VISUAL_CONCEPTS} onChange={(values) => updateBrief("visualConcepts", values)} />
          <MultiChoiceDropdown title="4. Performance" values={brief.performanceChoices} options={PERFORMANCE_CHOICES} onChange={(values) => updateBrief("performanceChoices", values)} />

          <MultiChoiceDropdown title="5. Ad-lib Visual Treatment" values={brief.adlibChoices} options={ADLIB_CHOICES} onChange={(values) => updateBrief("adlibChoices", values)} />

          <details className="easy-way-dropdown">
            <summary><span>6. Camera</span><span className="easy-way-summary-value">{brief.cameraStyle.replaceAll("-", " ")}</span></summary>
            <div className="easy-way-dropdown-body">
              <label className="easy-way-field">
                <span>Main camera movement</span>
                <select value={brief.cameraStyle} onChange={(event) => updateBrief("cameraStyle", event.target.value as CameraStyle)}>
                  <option value="automatic">No added movement</option>
                  <option value="still">Keep camera still</option>
                  <option value="push-in">Slow push in</option>
                  <option value="pull-back">Slow pull back</option>
                  <option value="side-track">Side tracking</option>
                  <option value="handheld">Restrained handheld</option>
                </select>
              </label>
              <MultiChoiceDropdown title="Composition" values={brief.compositionChoices} options={COMPOSITION_CHOICES} onChange={(values) => updateBrief("compositionChoices", values)} />
            </div>
          </details>

          <details className="easy-way-dropdown">
            <summary><span>7. Continuity</span><span className="easy-way-summary-value">{brief.continuityMode.replaceAll("-", " ")}</span></summary>
            <div className="easy-way-dropdown-body">
              <label className="easy-way-field">
                <span>Between clips</span>
                <select value={brief.continuityMode} onChange={(event) => updateBrief("continuityMode", event.target.value as ContinuityMode)}>
                  <option value="automatic">Let The Easy Way decide</option>
                  <option value="new-shot">Start a new shot</option>
                  <option value="character-reference">Return to character reference</option>
                </select>
              </label>
            </div>
          </details>

          <details className="easy-way-dropdown">
            <summary><span>8. Promotion & Export</span><span className="easy-way-summary-value">{brief.exportFormats.length} formats</span></summary>
            <div className="easy-way-dropdown-body">
              <MultiChoiceDropdown title="Promotional elements" values={brief.promotionChoices} options={PROMOTION_CHOICES} onChange={(values) => updateBrief("promotionChoices", values)} />
              <MultiChoiceDropdown title="Export formats" values={brief.exportFormats} options={EXPORT_FORMATS} onChange={(values) => updateBrief("exportFormats", values)} />
            </div>
          </details>

          <details className="easy-way-dropdown">
            <summary><span>Optional voice direction</span><span className="easy-way-summary-value">{brief.spokenIdea ? "Added" : "Speak or type"}</span></summary>
            <div className="easy-way-dropdown-body">
              <textarea value={brief.spokenIdea} onChange={(event) => updateBrief("spokenIdea", event.target.value)} rows={3} placeholder="Example: Dark warehouse, direct performance, close-ups on the ad-libs." />
              <button type="button" className="btn ghost w-full" onClick={startVoiceInput}>{listening ? "Listening…" : "🎤 Speak instead of typing"}</button>
            </div>
          </details>

          <div className="easy-way-review">
            <strong>Music-video setup</strong>
            <span>{brief.mainCharacterUrl ? "✓" : "○"} Character</span>
            <span>{analysis ? "✓" : "○"} Song analysis</span>
            <span>{brief.visualConcepts.length ? "✓" : "○"} Visual concept</span>
            <span>✓ Original-song soundtrack</span>
          </div>
        </div>

        <footer className="easy-way-drawer-actions">
          <button type="button" className="easy-way-primary" onClick={makeItForMe}>Make It For Me</button>
          <div>
            <button type="button" className="btn" onClick={applyToCurrentClip}>Apply to Current Clip</button>
            <button type="button" className="btn ghost" onClick={buildFullPlan}>Build Full Video Plan</button>
          </div>
        </footer>
      </aside>
    </div>
  );
}
