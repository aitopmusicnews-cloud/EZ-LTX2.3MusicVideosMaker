import { useMemo, useState } from "react";
import {
  buildMusicVideoPrompt,
  type AdlibStyle,
  type CameraStyle,
  type MusicVideoType,
  type PerformanceStyle,
  type VisualStyle,
} from "../lib/musicPromptEnhancer.js";
import { toast } from "../lib/toast.js";

type EasyWayPromptAssistantProps = {
  prompt: string;
  onPromptChange: (value: string) => void;
  sectionLabel: string;
  energy: number;
  hasPreviousClip: boolean;
  audioLoaded: boolean;
};

const VIDEO_TYPES: Array<{ value: MusicVideoType; label: string }> = [
  { value: "promo", label: "Promo" },
  { value: "full", label: "Full video" },
  { value: "performance", label: "Performance" },
  { value: "teaser", label: "Teaser" },
  { value: "visualizer", label: "Visualizer" },
];

const LOOKS: Array<{ value: VisualStyle; label: string }> = [
  { value: "automatic", label: "Automatic" },
  { value: "clean", label: "Clean" },
  { value: "dark", label: "Dark" },
  { value: "luxury", label: "Luxury" },
  { value: "street", label: "Street" },
  { value: "colorful", label: "Colorful" },
];

const PERFORMANCES: Array<{ value: PerformanceStyle; label: string }> = [
  { value: "natural", label: "Natural" },
  { value: "confident", label: "Confident" },
  { value: "restrained", label: "Restrained" },
  { value: "high-energy", label: "High energy" },
  { value: "dance", label: "Dance" },
  { value: "direct", label: "Direct to camera" },
];

const ADLIBS: Array<{ value: AdlibStyle; label: string }> = [
  { value: "automatic", label: "Automatic" },
  { value: "close-up", label: "Close-up" },
  { value: "gesture", label: "Gesture" },
  { value: "side-look", label: "Side look" },
  { value: "same-shot", label: "Same shot" },
];

const CAMERAS: Array<{ value: CameraStyle; label: string }> = [
  { value: "automatic", label: "No added move" },
  { value: "still", label: "Still" },
  { value: "push-in", label: "Push in" },
  { value: "pull-back", label: "Pull back" },
  { value: "side-track", label: "Side track" },
  { value: "handheld", label: "Handheld" },
];

function OptionRow<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="easy-way-row">
      <div className="easy-way-row-label">{label}</div>
      <div className="easy-way-chips">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`easy-way-chip${value === option.value ? " active" : ""}`}
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function EasyWayPromptAssistant({
  prompt,
  onPromptChange,
  sectionLabel,
  energy,
  hasPreviousClip,
  audioLoaded,
}: EasyWayPromptAssistantProps) {
  const [open, setOpen] = useState(true);
  const [idea, setIdea] = useState("");
  const [videoType, setVideoType] = useState<MusicVideoType>("promo");
  const [visualStyle, setVisualStyle] =
    useState<VisualStyle>("automatic");
  const [performanceStyle, setPerformanceStyle] =
    useState<PerformanceStyle>("natural");
  const [adlibStyle, setAdlibStyle] =
    useState<AdlibStyle>("automatic");
  const [cameraStyle, setCameraStyle] =
    useState<CameraStyle>("automatic");
  const [listening, setListening] = useState(false);

  const preview = useMemo(
    () =>
      buildMusicVideoPrompt({
        rawInput: idea,
        videoType,
        visualStyle,
        performanceStyle,
        adlibStyle,
        cameraStyle,
        sectionLabel,
        energy,
        hasPreviousClip,
        suppliedSongAudio:
          audioLoaded && videoType !== "visualizer",
      }),
    [
      idea,
      videoType,
      visualStyle,
      performanceStyle,
      adlibStyle,
      cameraStyle,
      sectionLabel,
      energy,
      hasPreviousClip,
      audioLoaded,
    ],
  );

  const makeItForMe = () => {
    const recommendedPerformance: PerformanceStyle =
      energy >= 0.72
        ? "high-energy"
        : energy <= 0.32
          ? "restrained"
          : "natural";
    const recommendedType: MusicVideoType =
      audioLoaded ? "promo" : "full";

    setVideoType(recommendedType);
    setPerformanceStyle(recommendedPerformance);
    setAdlibStyle("automatic");
    setCameraStyle("automatic");

    const result = buildMusicVideoPrompt({
      rawInput: idea,
      videoType: recommendedType,
      visualStyle,
      performanceStyle: recommendedPerformance,
      adlibStyle: "automatic",
      cameraStyle: "automatic",
      sectionLabel,
      energy,
      hasPreviousClip,
      suppliedSongAudio: audioLoaded,
    });

    onPromptChange(result);
    toast.success("The Easy Way prompt is ready");
  };

  const applyCurrentChoices = () => {
    onPromptChange(preview);
    toast.success("Music-video prompt applied");
  };

  const startVoiceInput = () => {
    const speechWindow = window as unknown as {
      SpeechRecognition?: new () => any;
      webkitSpeechRecognition?: new () => any;
    };
    const Recognition =
      speechWindow.SpeechRecognition ??
      speechWindow.webkitSpeechRecognition;

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
      toast.warning(
        "Voice input stopped. Tap the microphone and try again.",
      );
    };
    recognition.onresult = (event: any) => {
      const spoken = Array.from(event.results ?? [])
        .map((result: any) => result?.[0]?.transcript ?? "")
        .join(" ")
        .trim();

      if (spoken) {
        setIdea((current) =>
          [current, spoken].filter(Boolean).join(" "),
        );
        toast.success("Voice idea added");
      }
    };

    recognition.start();
  };

  return (
    <div className="easy-way-card">
      <button
        type="button"
        className="easy-way-header"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <img
          src="/the-easy-way.png"
          alt=""
          className="easy-way-logo"
        />
        <span>
          <strong>The Easy Way</strong>
          <small>
            Tap choices or speak. We build the LTX prompt.
          </small>
        </span>
        <span className="easy-way-toggle">
          {open ? "−" : "+"}
        </span>
      </button>

      {open && (
        <div className="easy-way-body">
          <label
            className="easy-way-idea-label"
            htmlFor="easy-way-idea"
          >
            Your idea <span>optional</span>
          </label>

          <div className="easy-way-idea-wrap">
            <textarea
              id="easy-way-idea"
              value={idea}
              onChange={(event) => setIdea(event.target.value)}
              placeholder="Example: Artist performing in a warehouse"
              rows={2}
            />
            <button
              type="button"
              className={`easy-way-mic${listening ? " listening" : ""}`}
              onClick={startVoiceInput}
              title="Describe the video with your voice"
              aria-label="Describe the video with your voice"
            >
              {listening ? "Listening…" : "🎤 Speak"}
            </button>
          </div>

          <OptionRow<MusicVideoType>
            label="Video"
            options={VIDEO_TYPES}
            value={videoType}
            onChange={setVideoType}
          />
          <OptionRow<VisualStyle>
            label="Look"
            options={LOOKS}
            value={visualStyle}
            onChange={setVisualStyle}
          />
          <OptionRow<PerformanceStyle>
            label="Performance"
            options={PERFORMANCES}
            value={performanceStyle}
            onChange={setPerformanceStyle}
          />
          <OptionRow<AdlibStyle>
            label="Ad-libs"
            options={ADLIBS}
            value={adlibStyle}
            onChange={setAdlibStyle}
          />
          <OptionRow<CameraStyle>
            label="Camera"
            options={CAMERAS}
            value={cameraStyle}
            onChange={setCameraStyle}
          />

          <div className="easy-way-actions">
            <button
              type="button"
              className="easy-way-make"
              onClick={makeItForMe}
            >
              Make It For Me
            </button>
            <button
              type="button"
              className="btn"
              onClick={applyCurrentChoices}
            >
              Use My Choices
            </button>
          </div>

          <div className="easy-way-status">
            {prompt
              ? "Final prompt is ready below. You can edit it before generating."
              : "No typing is required. Tap Make It For Me."}
          </div>
        </div>
      )}
    </div>
  );
}
