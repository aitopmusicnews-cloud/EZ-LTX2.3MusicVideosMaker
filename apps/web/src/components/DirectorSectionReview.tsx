import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useStore } from "../lib/store.js";
import { getWs } from "../lib/wavesurfer-ref.js";

 type ShotLike = { clipId: string; sectionLabel: string; start: number; end: number; prompt: string };
 type PlanLike = { shots: ShotLike[] };
 type ApprovalMap = Record<string, string>;

function storageKey(songId: string): string { return `mvs-director-section-approvals-v1-${songId}`; }
function time(value: number): string { const m = Math.floor(value / 60); const s = Math.max(0, value - m * 60); return `${m}:${s.toFixed(1).padStart(4, "0")}`; }

export function DirectorSectionReview({ songId, plan, disabled = false, onGenerate }: { songId: string; plan: PlanLike; disabled?: boolean; onGenerate: (clipId: string) => void | Promise<void> }) {
  const clips = useStore((state) => state.clips);
  const selectClip = useStore((state) => state.selectClip);
  const setPlayhead = useStore((state) => state.setPlayhead);
  const [approvals, setApprovals] = useState<ApprovalMap>({});

  useEffect(() => { try { const raw = localStorage.getItem(storageKey(songId)); setApprovals(raw ? JSON.parse(raw) : {}); } catch { setApprovals({}); } }, [songId]);
  useEffect(() => { localStorage.setItem(storageKey(songId), JSON.stringify(approvals)); }, [approvals, songId]);

  const rows = useMemo(() => plan.shots.map((shot) => {
    const clip = clips.find((item) => item.id === shot.clipId);
    const approved = Boolean(clip?.videoUrl && approvals[shot.clipId] === clip.videoUrl);
    return { shot, clip, approved };
  }), [plan.shots, clips, approvals]);
  const approvedCount = rows.filter((row) => row.approved).length;
  const activeGeneration = rows.find((row) => row.clip?.status === "queued" || row.clip?.status === "generating");
  const blockingReview = rows.find((row) => row.clip?.status === "ready" && row.clip.videoUrl && !row.approved);
  const nextToGenerate = activeGeneration || blockingReview ? null : rows.find((row) => !row.approved && row.clip?.status !== "queued" && row.clip?.status !== "generating");

  const playOnTimeline = (clipId: string, start: number) => {
    selectClip(clipId); setPlayhead(start);
    const ws = getWs() as any;
    if (ws?.setTime) ws.setTime(start);
    if (ws?.play) void ws.play();
  };
  const approve = (clipId: string, videoUrl: string) => setApprovals((current) => ({ ...current, [clipId]: videoUrl }));
  const revise = (clipId: string) => {
    window.dispatchEvent(new CustomEvent("mvs-director-focus-chat", { detail: { clipId } }));
    const el = document.querySelector('[aria-label="Director edit chat"]') as HTMLElement | null;
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const guardMessage = activeGeneration
    ? `Generating ${activeGeneration.shot.sectionLabel}. No other Director section can start until this job finishes.`
    : blockingReview
      ? `Review ${blockingReview.shot.sectionLabel} before generating another section.`
      : nextToGenerate
        ? `Next: ${nextToGenerate.shot.sectionLabel}`
        : "All generated sections are approved.";

  return <section style={sectionStyle}>
    <div style={headerStyle}><div><h3 style={titleStyle}>Section-by-section preview & approval</h3><p style={helpStyle}>Director spends video credits on one analyzer-defined section at a time. Gemini translates the approved section into the LTXDirector node timeline, then you watch it, chat changes, regenerate only that section, and approve before moving on.</p></div><strong style={badgeStyle}>{approvedCount}/{rows.length} approved</strong></div>
    <div style={guardStyle}>{guardMessage}</div>
    <button type="button" className="btn primary" disabled={disabled || !nextToGenerate} onClick={() => nextToGenerate && void onGenerate(nextToGenerate.shot.clipId)}>{activeGeneration ? `Generating ${activeGeneration.shot.sectionLabel}…` : nextToGenerate ? `Generate next section — ${nextToGenerate.shot.sectionLabel}` : "Approve the current section to continue"}</button>
    <div style={gridStyle}>{rows.map(({ shot, clip, approved }) => {
      const busy = clip?.status === "queued" || clip?.status === "generating";
      const ready = clip?.status === "ready" && Boolean(clip.videoUrl);
      const anotherBusy = Boolean(activeGeneration && activeGeneration.shot.clipId !== shot.clipId);
      return <article key={shot.clipId} style={{ ...cardStyle, borderColor: approved ? "rgba(34,197,94,.5)" : "rgba(255,255,255,.13)" }}>
        <div style={rowStyle}><strong>{shot.sectionLabel}</strong><span style={smallStyle}>{time(shot.start)}–{time(shot.end)} · {(shot.end - shot.start).toFixed(1)}s</span></div>
        <div style={smallStyle}>{shot.clipId} · {clip?.status ?? "missing"}</div>
        {ready && clip?.videoUrl ? <video src={clip.videoUrl} controls preload="metadata" style={videoStyle} /> : <div style={placeholderStyle}>{busy ? "LTXDirector is generating this section…" : clip?.status === "failed" ? clip.lastError || "Generation failed" : "No video preview yet."}</div>}
        <div style={actionsStyle}>
          <button type="button" className="btn" disabled={disabled || busy || anotherBusy || Boolean(blockingReview && blockingReview.shot.clipId !== shot.clipId)} onClick={() => void onGenerate(shot.clipId)}>{ready ? "Regenerate this section" : clip?.status === "failed" ? "Retry this section" : "Generate this section"}</button>
          {ready && clip?.videoUrl && <button type="button" className="btn" onClick={() => playOnTimeline(shot.clipId, shot.start)}>▶ Play on timeline</button>}
          {ready && clip?.videoUrl && <button type="button" className="btn primary" onClick={() => approve(shot.clipId, clip.videoUrl!)}>{approved ? "Approved ✓" : "Approve section"}</button>}
          <button type="button" className="btn ghost" onClick={() => revise(shot.clipId)}>Chat changes</button>
        </div>
      </article>;
    })}</div>
  </section>;
}

const sectionStyle: CSSProperties = { marginTop: 20, padding: 16, borderRadius: 14, border: "1px solid rgba(34,197,94,.3)", background: "rgba(34,197,94,.04)" };
const headerStyle: CSSProperties = { display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" };
const titleStyle: CSSProperties = { margin: 0, fontSize: 18 };
const helpStyle: CSSProperties = { margin: "6px 0 0", color: "#a1a1aa", lineHeight: 1.45, fontSize: 12, maxWidth: 780 };
const badgeStyle: CSSProperties = { padding: "5px 9px", borderRadius: 999, background: "rgba(34,197,94,.14)", color: "#bbf7d0", fontSize: 11, whiteSpace: "nowrap" };
const guardStyle: CSSProperties = { margin: "12px 0", padding: 10, borderRadius: 9, background: "rgba(234,179,8,.08)", border: "1px solid rgba(234,179,8,.2)", color: "#fde68a", fontSize: 12 };
const gridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 12, marginTop: 14 };
const cardStyle: CSSProperties = { padding: 12, border: "1px solid rgba(255,255,255,.13)", borderRadius: 12, background: "rgba(0,0,0,.16)" };
const rowStyle: CSSProperties = { display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" };
const smallStyle: CSSProperties = { color: "#a1a1aa", fontSize: 10, marginTop: 4 };
const videoStyle: CSSProperties = { width: "100%", maxHeight: 260, marginTop: 10, borderRadius: 9, background: "#000" };
const placeholderStyle: CSSProperties = { minHeight: 120, display: "grid", placeItems: "center", marginTop: 10, padding: 12, borderRadius: 9, background: "rgba(255,255,255,.04)", color: "#a1a1aa", textAlign: "center", fontSize: 12 };
const actionsStyle: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 };
