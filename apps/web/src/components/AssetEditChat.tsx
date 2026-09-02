import { useState, type CSSProperties } from "react";
import { requestDirectorChat, type DirectorChatTarget, type DirectorEditAction } from "../lib/directorChatClient.js";

type Props = {
  label: string;
  target: DirectorChatTarget;
  plan: unknown;
  references: unknown[];
  sceneImages: Record<string, string>;
  shotImages: Record<string, string>;
  disabled?: boolean;
  onApply: (actions: DirectorEditAction[]) => Promise<void>;
};

function placeholder(target: DirectorChatTarget): string {
  if (target.type === "scene_image") return "Edit this scene image… e.g. remove the car";
  if (target.type === "shot_image") return "Edit this shot image… e.g. make the lighting warmer";
  return "Edit this clip… e.g. make this a low-angle orbit";
}

export function AssetEditChat({ label, target, plan, references, sceneImages, shotImages, disabled = false, onApply }: Props) {
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState<string | null>(null);

  const send = async () => {
    const message = draft.trim();
    if (!message || disabled || pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await requestDirectorChat({
        message,
        target,
        plan,
        references,
        sceneImages,
        shotImages,
        history: [],
      });
      if (result.actions.length) await onApply(result.actions);
      setReply(result.reply);
      setDraft("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setPending(false);
    }
  };

  return <div style={wrapStyle} aria-label={`Director asset edit ${target.type} ${target.clipId}`}>
    <div style={labelStyle}>{label}</div>
    <div style={rowStyle}>
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); void send(); } }}
        placeholder={placeholder(target)}
        aria-label={`Edit ${target.type} ${target.clipId}`}
        disabled={disabled || pending}
        style={inputStyle}
      />
      <button type="button" className="btn ghost" onClick={() => void send()} disabled={disabled || pending || draft.trim().length < 2}>{pending ? "Editing…" : "Send"}</button>
    </div>
    {reply && <div style={replyStyle}>{reply}</div>}
    {error && <div style={errorStyle}>{error}</div>}
  </div>;
}

const wrapStyle: CSSProperties = { marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,.08)" };
const labelStyle: CSSProperties = { fontSize: 10, fontWeight: 700, color: "#cbd5e1", marginBottom: 6 };
const rowStyle: CSSProperties = { display: "grid", gridTemplateColumns: "1fr auto", gap: 7, alignItems: "end" };
const inputStyle: CSSProperties = { width: "100%", minHeight: 48, resize: "vertical", borderRadius: 8, border: "1px solid rgba(255,255,255,.12)", background: "rgba(0,0,0,.2)", color: "#fafafa", padding: "8px 9px", fontSize: 11, lineHeight: 1.35 };
const replyStyle: CSSProperties = { marginTop: 6, color: "#bbf7d0", fontSize: 10, lineHeight: 1.35 };
const errorStyle: CSSProperties = { marginTop: 6, color: "#fecaca", fontSize: 10, lineHeight: 1.35 };
