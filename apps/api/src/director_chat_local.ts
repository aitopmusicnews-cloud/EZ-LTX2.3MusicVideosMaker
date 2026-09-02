export type LocalDirectorChatShot = {
  clipId: string;
  sectionLabel?: string;
  start?: number;
  end?: number;
  prompt?: string;
  continuityNotes?: string;
  transition?: string;
};

export type LocalDirectorChatRequest = {
  message: string;
  plan: { shots: LocalDirectorChatShot[] };
};

export type LocalDirectorChatAction =
  | {
      type: "update_clip";
      clipId: string;
      prompt?: string;
      continuityNotes?: string;
      transition?: string;
      sectionLabel?: string;
      requiresCharacter?: boolean;
      conditioningReferenceId?: string | null;
      regenerate?: boolean;
    }
  | {
      type: "edit_scene_image" | "edit_shot_image";
      clipId: string;
      prompt: string;
    };

export type LocalDirectorChatResponse = {
  reply: string;
  actions: LocalDirectorChatAction[];
};

const REGEN_RE = /\b(regenerate|re-?generate|rerender|re-?render|retry)\b/i;
const TIMING_RE = /\b(change|move|shift|shorten|lengthen|extend|trim)\b.{0,30}\b(time|timing|start|end|duration|seconds?)\b|\b(start|end|duration)\b.{0,30}\b\d+(?:\.\d+)?\s*(?:s|sec|seconds?)\b/i;

function findTargetIndexes(message: string, shots: LocalDirectorChatShot[]): number[] {
  const targets = new Set<number>();
  const numbered = /\b(?:clip|shot)\s*#?\s*(\d{1,2})\b/gi;
  for (const match of message.matchAll(numbered)) {
    const index = Number(match[1]) - 1;
    if (index >= 0 && index < shots.length) targets.add(index);
  }

  const lower = message.toLowerCase();
  shots.forEach((shot, index) => {
    if (shot.clipId && lower.includes(shot.clipId.toLowerCase())) targets.add(index);
  });

  if (/\b(?:all|every)\s+(?:clip|clips|shot|shots)\b/i.test(message) && shots.length <= 12) {
    shots.forEach((_, index) => targets.add(index));
  }

  return [...targets].sort((a, b) => a - b);
}

function promptWithEdit(shot: LocalDirectorChatShot, message: string): string {
  const base = shot.prompt?.trim() || `Cinematic music-video shot for ${shot.sectionLabel || shot.clipId}.`;
  const edit = message.trim().replace(/\s+/g, " ");
  return `${base} User-requested edit: ${edit}`.slice(0, 6000);
}

function imageActionType(message: string): "edit_scene_image" | "edit_shot_image" | null {
  if (/\bscene\s+image\b/i.test(message)) return "edit_scene_image";
  if (/\bshot\s+image\b/i.test(message) || /\bimage\b/i.test(message)) return "edit_shot_image";
  return null;
}

export function buildLocalDirectorChatResponse(req: LocalDirectorChatRequest): LocalDirectorChatResponse {
  const message = req.message.trim();
  const shots = req.plan.shots;

  if (TIMING_RE.test(message)) {
    return {
      reply: "Local Director mode is active because the AI chat provider is unavailable. I will not change clip timing from chat; use the timeline or clip-count control for timing changes.",
      actions: [],
    };
  }

  const targetIndexes = findTargetIndexes(message, shots);
  if (targetIndexes.length === 0) {
    return {
      reply: "Local Director mode is active because Gemini is unavailable or quota-limited. Name a clip or shot number, for example: ‘regenerate clip 3’ or ‘make shot 4 a dramatic low-angle orbit.’ Your current plan is unchanged.",
      actions: [],
    };
  }

  if (targetIndexes.length > 12) {
    return {
      reply: "Local Director mode can safely edit up to 12 targeted clips at once. Name a smaller clip or shot range and I’ll apply it without changing timing.",
      actions: [],
    };
  }

  const regenerate = REGEN_RE.test(message);
  const imageType = imageActionType(message);
  const actions: LocalDirectorChatAction[] = targetIndexes.map((index) => {
    const shot = shots[index]!;
    if (imageType) {
      return {
        type: imageType,
        clipId: shot.clipId,
        prompt: `Preserve the existing approved composition and identity. Apply only this user-requested visual edit: ${message}`.slice(0, 6000),
      };
    }
    if (regenerate) {
      return { type: "update_clip", clipId: shot.clipId, regenerate: true };
    }
    return {
      type: "update_clip",
      clipId: shot.clipId,
      prompt: promptWithEdit(shot, message),
      regenerate: false,
    };
  });

  const targetLabel = targetIndexes.length === 1 ? `clip ${targetIndexes[0]! + 1}` : `${targetIndexes.length} targeted clips`;
  return {
    reply: `Local Director mode applied your request to ${targetLabel}. Timing and untargeted clips were left unchanged.`,
    actions,
  };
}
