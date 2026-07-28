import { useEffect, useMemo, useState, type CSSProperties } from "react";

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

type ChatMessage = { role: "user" | "director"; text: string };

type Props = {
  plan: unknown;
  references: unknown[];
  sceneImages: Record<string, string>;
  shotImages: Record<string, string>;
  disabled?: boolean;
  onApply: (actions: DirectorEditAction[]) => Promise<void>;
};

export function DirectorEditChat({ plan, references, sceneImages, shotImages, disabled = false, onApply }: Props) {
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "director", text: "Tell me what to change. Name a section/clip, revise its prompt or image, add something, or ask to regenerate the approved section." },
  ]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const history = useMemo(() => messages.slice(-10), [messages]);

  useEffect(() => {
    const focusFromSection = (event: Event) => {
      const clipId = String((event as CustomEvent<{ clipId?: string }>).detail?.clipId ?? "").trim();
      if (!clipId) return;
      setDraft((current) => current.trim() ? current : `For ${clipId}, `);
      requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[aria-label="Director chat input"]')?.focus());
    };
    window.addEventListener("mvs-director-focus-chat", focusFromSection as EventListener);
    return () => window.removeEventListener("mvs-director-focus-chat", focusFromSection as EventListener);
  }, []);

  const send = async () => {
    const message = draft.trim();
    if (!message || pending || disabled) return;
    setDraft("");
    setError(null);
    setMessages((current) => [...current, { role: "user", text: message }]);
    setPending(true);
    try {
      const response = await fetch("/api/director/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, plan, references, sceneImages, shotImages, history }),
      });
      const text = await response.text();
      let data: any = null;
      try { data = JSON.parse(text); } catch {}
      if (!response.ok) throw new Error(data?.error || text.slice(0, 800) || `Director chat failed (${response.status})`);
      const actions = Array.isArray(data?.actions) ? data.actions as DirectorEditAction[] : [];
      if (actions.length) await onApply(actions);
      setMessages((current) => [...current, { role: "director", text: String(data?.reply || (actions.length ? "Done." : "I did not make any changes.")) }]);
    } catch (failure) {
      const messageText = failure instanceof Error ? failure.message : String(failure);
      setError(messageText);
      setMessages((current) => [...current, { role: "director", text: `I couldn't apply that edit: ${messageText}` }]);
    } finally {
      setPending(false);
    }
  };

  return <section style={sectionStyle} aria-label="Director edit chat">
    <div style={headerStyle}>
      <div><h3 style={titleStyle}>Director chat — adjust clips & images</h3><p style={helpStyle}>Examples: “Make the chorus a slow push-in,” “Remove the car from this image,” “Use the blue-jacket asset here,” or “Regenerate this approved section.”</p></div>
      <span style={badgeStyle}>{pending ? "Working…" : "Live edit mode"}</span>
    </div>
    <div style={threadStyle} aria-live="polite">
      {messages.map((message, index) => <div key={`${message.role}-${index}`} style={{ ...bubbleStyle, ...(message.role === "user" ? userBubbleStyle : directorBubbleStyle) }}><strong>{message.role === "user" ? "You" : "Director"}</strong><div style={{ marginTop: 5, whiteSpace: "pre-wrap" }}>{message.text}</div></div>)}
    </div>
    {error && <div style={errorStyle}>{error}</div>}
    <div style={composerStyle}>
      <textarea
        aria-label="Director chat input"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); void send(); } }}
        placeholder="Tell Director exactly what to change…"
        style={textareaStyle}
        disabled={pending || disabled}
      />
      <button type="button" className="btn primary" onClick={() => void send()} disabled={pending || disabled || draft.trim().length < 2}>{pending ? "Director is editing…" : "Send to Director"}</button>
    </div>
    <div style={shortcutStyle}>⌘/Ctrl + Enter to send · visual changes reset preview approval before any new video credits are spent.</div>
  </section>;
}

const sectionStyle: CSSProperties = { marginTop: 20, padding: 16, borderRadius: 14, border: "1px solid rgba(96,165,250,.28)", background: "rgba(59,130,246,.055)" };
const headerStyle: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 };
const titleStyle: CSSProperties = { margin: 0, fontSize: 18 };
const helpStyle: CSSProperties = { margin: "6px 0 0", color: "#a1a1aa", lineHeight: 1.45, fontSize: 12 };
const badgeStyle: CSSProperties = { flex: "0 0 auto", padding: "5px 9px", borderRadius: 999, background: "rgba(59,130,246,.14)", color: "#bfdbfe", fontSize: 11, fontWeight: 700 };
const threadStyle: CSSProperties = { display: "grid", gap: 9, maxHeight: 320, overflowY: "auto", marginTop: 14, padding: 10, borderRadius: 11, background: "rgba(0,0,0,.2)" };
const bubbleStyle: CSSProperties = { maxWidth: "86%", padding: "10px 12px", borderRadius: 11, lineHeight: 1.45, fontSize: 12 };
const userBubbleStyle: CSSProperties = { justifySelf: "end", background: "rgba(59,130,246,.18)", border: "1px solid rgba(96,165,250,.26)" };
const directorBubbleStyle: CSSProperties = { justifySelf: "start", background: "rgba(34,197,94,.09)", border: "1px solid rgba(134,239,172,.18)" };
const composerStyle: CSSProperties = { display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "end", marginTop: 12 };
const textareaStyle: CSSProperties = { width: "100%", minHeight: 78, resize: "vertical", padding: "10px 12px", borderRadius: 9, border: "1px solid rgba(255,255,255,.13)", background: "#18181b", color: "#fafafa", lineHeight: 1.45 };
const errorStyle: CSSProperties = { marginTop: 10, padding: 9, borderRadius: 8, background: "rgba(239,68,68,.12)", color: "#fecaca", fontSize: 12 };
const shortcutStyle: CSSProperties = { marginTop: 7, color: "#71717a", fontSize: 10 };
