import { useState, type CSSProperties } from "react";
import { toast } from "../lib/toast.js";

type Preset = "vertical" | "square" | "landscape";
type ExportResult = { url: string; preset: Preset; label: string; width: number; height: number };

type Props = {
  videoUrl: string;
  projectId: string;
  projectName: string;
};

const PRESETS: Array<{ id: Preset; title: string; destinations: string; size: string }> = [
  { id: "vertical", title: "Vertical 9:16", destinations: "TikTok · Instagram Reels · YouTube Shorts · Facebook Reels", size: "1080 × 1920" },
  { id: "square", title: "Square 1:1", destinations: "Instagram Feed · Facebook Feed · general social posts", size: "1080 × 1080" },
  { id: "landscape", title: "Landscape 16:9", destinations: "YouTube · Facebook · X · LinkedIn", size: "1280 × 720" },
];

export function SocialExportPanel({ videoUrl, projectId, projectName }: Props) {
  const [busy, setBusy] = useState<Preset | "all" | null>(null);
  const [exports, setExports] = useState<Partial<Record<Preset, ExportResult>>>({});

  const exportPreset = async (preset: Preset): Promise<ExportResult> => {
    const response = await fetch("/api/social/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId, videoUrl, preset }),
    });
    const text = await response.text();
    let data: any = null;
    try { data = JSON.parse(text); } catch {}
    if (!response.ok) throw new Error(data?.error || text.slice(0, 800) || `Social export failed (${response.status})`);
    return data as ExportResult;
  };

  const runOne = async (preset: Preset) => {
    setBusy(preset);
    try {
      const result = await exportPreset(preset);
      setExports((current) => ({ ...current, [preset]: result }));
      toast.success(`${result.label} social export is ready`);
    } catch (error) {
      toast.error(`Social export failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(null);
    }
  };

  const runAll = async () => {
    setBusy("all");
    try {
      const next: Partial<Record<Preset, ExportResult>> = { ...exports };
      for (const item of PRESETS) {
        const result = await exportPreset(item.id);
        next[item.id] = result;
        setExports({ ...next });
      }
      toast.success("All social media versions are ready");
    } catch (error) {
      toast.error(`Social exports stopped: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(null);
    }
  };

  return <section style={panelStyle}>
    <div style={headerStyle}>
      <div>
        <h4 style={titleStyle}>Social media exports</h4>
        <p style={helpStyle}>Create upload-ready copies from <strong>{projectName}</strong> without spending generation credits. The master MP4 stays unchanged. Vertical and square versions preserve the full composition over a blurred edge-fill background instead of chopping off the sides.</p>
      </div>
      <button type="button" className="btn" disabled={busy !== null} onClick={() => void runAll()}>{busy === "all" ? "Exporting…" : "Export all social versions"}</button>
    </div>

    <div style={gridStyle}>
      {PRESETS.map((item) => {
        const result = exports[item.id];
        const working = busy === item.id || busy === "all";
        return <article key={item.id} style={cardStyle}>
          <div><strong>{item.title}</strong><div style={sizeStyle}>{item.size}</div></div>
          <div style={destinationsStyle}>{item.destinations}</div>
          <div style={actionsStyle}>
            <button type="button" className="btn ghost" disabled={busy !== null} onClick={() => void runOne(item.id)}>{working ? "Exporting…" : result ? "Export again" : "Create MP4"}</button>
            {result && <a className="btn primary" href={result.url} target="_blank" rel="noreferrer">Open MP4</a>}
          </div>
        </article>;
      })}
    </div>
    <div style={noteStyle}>These are platform-ready files stored with your renders. Direct publishing into your social accounts is a separate account-connection/OAuth step.</div>
  </section>;
}

const panelStyle: CSSProperties = { marginTop: 18, padding: 16, borderRadius: 12, border: "1px solid rgba(34,197,94,.28)", background: "rgba(34,197,94,.055)" };
const headerStyle: CSSProperties = { display: "flex", justifyContent: "space-between", gap: 14, alignItems: "flex-start", flexWrap: "wrap" };
const titleStyle: CSSProperties = { margin: 0, fontSize: 16 };
const helpStyle: CSSProperties = { margin: "6px 0 0", color: "#a1a1aa", fontSize: 12, lineHeight: 1.5, maxWidth: 720 };
const gridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 10, marginTop: 14 };
const cardStyle: CSSProperties = { padding: 12, borderRadius: 10, border: "1px solid rgba(255,255,255,.1)", background: "rgba(0,0,0,.18)" };
const sizeStyle: CSSProperties = { marginTop: 3, color: "#86efac", fontSize: 11, fontWeight: 700 };
const destinationsStyle: CSSProperties = { marginTop: 8, minHeight: 34, color: "#a1a1aa", fontSize: 11, lineHeight: 1.4 };
const actionsStyle: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 };
const noteStyle: CSSProperties = { marginTop: 10, color: "#71717a", fontSize: 10, lineHeight: 1.45 };
