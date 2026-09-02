export type DirectorEditAction =
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
  | { type: "edit_scene_image" | "edit_shot_image"; clipId: string; prompt: string };

export type DirectorChatTarget = {
  type: "scene_image" | "shot_image" | "clip";
  clipId: string;
};

export type DirectorChatMessage = { role: "user" | "director"; text: string };

export type DirectorChatRequestInput = {
  message: string;
  plan: unknown;
  references: unknown[];
  sceneImages: Record<string, string>;
  shotImages: Record<string, string>;
  history: DirectorChatMessage[];
  target?: DirectorChatTarget;
};

export function buildDirectorChatRequest(input: DirectorChatRequestInput): Record<string, unknown> {
  return {
    message: input.message,
    plan: input.plan,
    references: input.references,
    sceneImages: input.sceneImages,
    shotImages: input.shotImages,
    history: input.history,
    ...(input.target ? { target: input.target } : {}),
  };
}

export async function requestDirectorChat(input: DirectorChatRequestInput): Promise<{ reply: string; actions: DirectorEditAction[] }> {
  const response = await fetch("/api/director/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildDirectorChatRequest(input)),
  });
  const text = await response.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch {}
  if (!response.ok) {
    const isHtml = /<!doctype|<html/i.test(text.slice(0, 300));
    const fallback = isHtml ? "The Director service returned an HTML error page." : text.slice(0, 800);
    throw new Error(data?.error || fallback || `Director chat failed (${response.status})`);
  }
  const actions = Array.isArray(data?.actions) ? data.actions as DirectorEditAction[] : [];
  return {
    reply: String(data?.reply || (actions.length ? "Done." : "I did not make any changes.")),
    actions,
  };
}
