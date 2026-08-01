export type MusicVideoType =
  | "promo"
  | "full"
  | "performance"
  | "teaser"
  | "visualizer";

export type VisualStyle =
  | "automatic"
  | "clean"
  | "dark"
  | "luxury"
  | "street"
  | "colorful";

export type PerformanceStyle =
  | "natural"
  | "confident"
  | "restrained"
  | "high-energy"
  | "dance"
  | "direct";

export type AdlibStyle =
  | "automatic"
  | "close-up"
  | "gesture"
  | "side-look"
  | "same-shot";

export type CameraStyle =
  | "automatic"
  | "still"
  | "push-in"
  | "pull-back"
  | "side-track"
  | "handheld";

export type MusicPromptOptions = {
  rawInput: string;
  videoType: MusicVideoType;
  visualStyle: VisualStyle;
  performanceStyle: PerformanceStyle;
  adlibStyle: AdlibStyle;
  cameraStyle: CameraStyle;
  sectionLabel: string;
  energy: number;
  hasPreviousClip: boolean;
  suppliedSongAudio: boolean;
};

function cleanText(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?])/g, "$1")
    .trim();
}

function sentence(value: string): string {
  const cleaned = cleanText(value);
  if (!cleaned) return "";
  return /[.!?]$/.test(cleaned) ? cleaned : `${cleaned}.`;
}

function stylePrefix(style: VisualStyle): string {
  switch (style) {
    case "clean":
      return "clean contemporary music-video style";
    case "dark":
      return "dark understated music-video style";
    case "luxury":
      return "polished luxury music-video style";
    case "street":
      return "grounded street-performance music-video style";
    case "colorful":
      return "bright controlled-color music-video style";
    default:
      return "";
  }
}

function defaultAction(
  videoType: MusicVideoType,
  suppliedSongAudio: boolean,
): string {
  if (videoType === "visualizer") {
    return "Visible elements are moving naturally with the rhythm while the existing composition remains consistent";
  }
  if (
    suppliedSongAudio ||
    videoType === "performance" ||
    videoType === "promo"
  ) {
    return "The visible performer is already moving and performing from the first frame";
  }
  return "The visible subject is beginning natural movement immediately from the first frame";
}

function performanceDirection(style: PerformanceStyle): string {
  switch (style) {
    case "confident":
      return "The performer is maintaining steady eye contact and is using controlled hand, head, and shoulder gestures";
    case "restrained":
      return "The performer is using small head movements, natural blinking, breathing, and restrained facial motion";
    case "high-energy":
      return "The performer is using active rhythmic shoulder, hand, and upper-body movement while remaining inside the existing frame";
    case "dance":
      return "The performer is using rhythmic dance movement that follows the song while remaining visually consistent with the first frame";
    case "direct":
      return "The performer is facing the camera and is maintaining direct eye contact with controlled natural movement";
    default:
      return "The performer is using natural blinking, breathing, small posture changes, and relaxed head and shoulder movement";
  }
}

function adlibDirection(style: AdlibStyle): string {
  switch (style) {
    case "close-up":
      return "As supplied ad-libs occur, the framing is tightening smoothly into a brief close view without a cut, then is returning to the existing framing";
    case "gesture":
      return "As supplied ad-libs occur, the performer is adding short hand and facial gestures that match the vocal rhythm";
    case "side-look":
      return "As supplied ad-libs occur, the performer is briefly turning toward a side angle, then is returning naturally to the main performance";
    case "same-shot":
      return "As supplied ad-libs occur, the performer is adding subtle facial and shoulder movement while the framing remains unchanged";
    default:
      return "As supplied ad-libs occur, the performer is adding small natural facial and hand movements while remaining in the same continuous shot";
  }
}

function cameraDirection(style: CameraStyle): string {
  switch (style) {
    case "still":
      return "The camera remains fixed in the existing position and framing";
    case "push-in":
      return "The camera is moving forward slowly in one continuous push-in";
    case "pull-back":
      return "The camera is moving backward slowly in one continuous pull-back";
    case "side-track":
      return "The camera is tracking slowly to the side in one continuous movement";
    case "handheld":
      return "The camera is using restrained handheld movement without changing the scene";
    default:
      return "";
  }
}

function purposeDirection(type: MusicVideoType): string {
  switch (type) {
    case "promo":
      return "The recognizable performance action is happening immediately, and the central composition is remaining clear enough for promotional text";
    case "teaser":
      return "The action is reaching the recognizable hook quickly and is settling into a loop-friendly final movement";
    case "full":
      return "The action is continuing as one connected music-video moment that can flow into the surrounding timeline clips";
    case "visualizer":
      return "The visible motion is following the song rhythm without introducing dialogue, lyrics, or a new scene";
    default:
      return "The performance is remaining continuous and visually consistent throughout the clip";
  }
}

function energyDirection(energy: number): string {
  if (energy >= 0.72) {
    return "Movement intensity is staying active and rhythmic to match the stronger section of the song";
  }
  if (energy <= 0.32) {
    return "Movement intensity is staying subtle and controlled to match the quieter section of the song";
  }
  return "Movement intensity is staying moderate and is following the section rhythm naturally";
}

export function buildMusicVideoPrompt(
  options: MusicPromptOptions,
): string {
  const style = stylePrefix(options.visualStyle);
  const firstAction =
    sentence(options.rawInput) ||
    sentence(defaultAction(options.videoType, options.suppliedSongAudio));

  const parts: string[] = [];

  if (style) {
    parts.push(
      `Style: ${style}, ${firstAction.charAt(0).toLowerCase()}${firstAction.slice(1)}`,
    );
  } else {
    parts.push(firstAction);
  }

  parts.push(sentence(purposeDirection(options.videoType)));

  if (options.videoType !== "visualizer") {
    parts.push(sentence(performanceDirection(options.performanceStyle)));
  }

  if (options.suppliedSongAudio) {
    parts.push(
      "From the first frame, visible mouth, lip, jaw, cheek, throat, breathing, head, and facial movement are following the supplied vocal audio naturally",
    );
    parts.push(
      "The supplied song section is playing continuously with its existing vocals, ad-libs, instrumental layer, and background sound",
    );
    parts.push(sentence(adlibDirection(options.adlibStyle)));
  }

  const camera = cameraDirection(options.cameraStyle);
  if (camera) parts.push(sentence(camera));

  parts.push(sentence(energyDirection(options.energy)));

  if (options.hasPreviousClip) {
    parts.push(
      "Motion is continuing seamlessly from the previous clip's final frame while the same identity, wardrobe, position, lighting, background, and camera axis remain consistent",
    );
  } else {
    parts.push(
      "The visible identity, wardrobe, framing, lighting, and background remain consistent with the first-frame image",
    );
  }

  parts.push(
    "Movement begins immediately without displaying a static reference image, black frame, fade, cutaway, additional person, or unrelated scene",
  );

  return parts
    .map(sentence)
    .filter(Boolean)
    .join(" ")
    .replace(/\.\s+\./g, ".")
    .trim();
}

export function ensureImageVideoPrompt(
  rawInput: string,
  context: Pick<
    MusicPromptOptions,
    "sectionLabel" | "energy" | "hasPreviousClip"
  >,
): string {
  const cleaned = cleanText(rawInput);

  if (
    cleaned.includes("Movement begins immediately") ||
    cleaned.includes("visible identity, wardrobe")
  ) {
    return cleaned;
  }

  return buildMusicVideoPrompt({
    rawInput: cleaned,
    videoType: "full",
    visualStyle: "automatic",
    performanceStyle: "natural",
    adlibStyle: "automatic",
    cameraStyle: "automatic",
    sectionLabel: context.sectionLabel,
    energy: context.energy,
    hasPreviousClip: context.hasPreviousClip,
    suppliedSongAudio: false,
  });
}

export function ensurePerformancePrompt(
  rawInput: string,
  context: Pick<
    MusicPromptOptions,
    "sectionLabel" | "energy" | "hasPreviousClip"
  >,
): string {
  const cleaned = cleanText(rawInput);

  if (
    cleaned.includes("supplied vocal audio") &&
    cleaned.includes("Movement begins immediately")
  ) {
    return cleaned;
  }

  return buildMusicVideoPrompt({
    rawInput: cleaned,
    videoType: "performance",
    visualStyle: "automatic",
    performanceStyle: "natural",
    adlibStyle: "automatic",
    cameraStyle: "automatic",
    sectionLabel: context.sectionLabel,
    energy: context.energy,
    hasPreviousClip: context.hasPreviousClip,
    suppliedSongAudio: true,
  });
}
