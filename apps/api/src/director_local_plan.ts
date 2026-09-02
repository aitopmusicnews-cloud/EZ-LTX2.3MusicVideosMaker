type LocalDirectorClip = {
  id: string;
  start: number;
  end: number;
  sectionLabel?: string;
  userDirection?: string;
};

type LocalDirectorRequest = {
  vision: string;
  mustInclude?: string;
  avoid?: string;
  characterRequired?: boolean;
  clips: LocalDirectorClip[];
};

type LocalDirectorReference = {
  id: string;
  kind: string;
  anchorUrl?: string;
};

const AUTHORITATIVE_SHOT_LIST_MARKER = "AUTHORITATIVE TIMECODED SHOT LIST";

function compact(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function userMustInclude(text: string): string {
  const markerIndex = text.indexOf(AUTHORITATIVE_SHOT_LIST_MARKER);
  return compact(markerIndex >= 0 ? text.slice(0, markerIndex) : text).replace(/[—–-]+\s*$/, "").trim();
}

function truncateWords(text: string, maxWords = 170): string {
  const words = compact(text).split(" ").filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  return `${words.slice(0, maxWords).join(" ")}…`;
}

function fallbackDirection(req: LocalDirectorRequest, clip: LocalDirectorClip, index: number): string {
  const direct = compact(clip.userDirection ?? "");
  if (direct) return direct;
  const label = compact(clip.sectionLabel ?? "");
  const vision = compact(req.vision);
  return `${label || `Shot ${index + 1}`}: ${vision}`;
}

export function buildLocalDirectorPlan(
  req: LocalDirectorRequest,
  references: LocalDirectorReference[],
) {
  const characterReference = references.find((reference) => reference.kind === "character" && reference.anchorUrl);
  const useCharacter = Boolean(req.characterRequired && characterReference);
  const mustInclude = userMustInclude(req.mustInclude ?? "");
  const avoid = compact(req.avoid ?? "");
  const vision = compact(req.vision);

  return {
    version: "ltx-director-v1" as const,
    agentModel: "local-vision-fallback",
    treatment: {
      title: "Vision-first Director Plan",
      logline: vision || "Follow the supplied shot-by-shot Vision exactly.",
      visualStyle: "Use the user's Vision and supplied references as the authoritative visual style.",
      colorPalette: "Preserve colors explicitly stated in the Vision; otherwise keep a coherent cinematic palette across clips.",
      cameraLanguage: "Preserve every explicit camera instruction in the user's Vision and keep movement continuous across adjacent clips.",
      continuityStrategy: "Keep approved character identity, wardrobe, locations, props, lighting, and user-specified continuity consistent across the supplied timeline.",
    },
    characterBible: {
      referenceId: useCharacter ? characterReference!.id : null,
      referenceSummary: useCharacter
        ? "Use the supplied approved character reference as the principal artist identity."
        : "No character conditioning is required for this local fallback plan.",
      immutableTraits: useCharacter ? ["Preserve the approved character identity exactly."] : [],
      wardrobe: mustInclude || "Preserve wardrobe instructions from the Vision.",
      prohibitedChanges: avoid ? [avoid] : [],
    },
    shots: req.clips.map((clip, index) => {
      const direction = fallbackDirection(req, clip, index);
      const requirements = [
        direction,
        mustInclude ? `Must include: ${mustInclude}.` : "",
        avoid ? `Avoid: ${avoid}.` : "",
        "Keep the action literal and visually observable, preserve the exact supplied timing, and maintain continuity with adjacent shots.",
      ].filter(Boolean).join(" ");

      return {
        clipId: clip.id,
        sectionLabel: compact(clip.sectionLabel ?? "") || `Shot ${index + 1}`,
        start: clip.start,
        end: clip.end,
        requiresCharacter: useCharacter,
        conditioningReferenceId: useCharacter ? characterReference!.id : null,
        prompt: truncateWords(requirements),
        continuityNotes: "Preserve the user's Vision, approved references, and visual continuity without changing this clip's boundary.",
        transition: "Cut cleanly at the supplied timeline boundary and continue the established visual continuity into the next clip.",
      };
    }),
  };
}
