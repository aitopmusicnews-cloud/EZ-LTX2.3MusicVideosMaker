import { useState, type CSSProperties } from "react";
import { extractLastFrame } from "../lib/api.js";
import type { DirectorEditAction } from "../lib/directorChatClient.js";
import { useStore } from "../lib/store.js";
import { toast } from "../lib/toast.js";
import { AssetEditChat } from "./AssetEditChat.js";
import { DirectorCharacterPicker, type CharacterOption } from "./DirectorCharacterControls.js";

type RefAsset = { id: string; kind?: string; media?: string; name?: string; url?: string; anchorUrl?: string; note?: string };
type PendingAssetEdit = { targetType: "scene_image" | "shot_image" | "clip"; clipId: string; prompt?: string; regenerate?: boolean };

type Props = {
  plan: unknown;
  references: RefAsset[];
  sceneImages: Record<string, string>;
  shotImages: Record<string, string>;
  characters: CharacterOption[];
  approvedCharacterIds: string[];
  characterSelections: Record<string, string[]>;
  pendingAssetEdits: Record<string, PendingAssetEdit>;
  disabled?: boolean;
  onApply: (actions: DirectorEditAction[]) => Promise<void>;
  onCharacterSelectionChange: (clipId: string, ids: string[]) => void;
  onGeneratePreparedImage: (targetType: "scene_image" | "shot_image", clipId: string) => void | Promise<void>;
};

function saveAsset(detail: { kind: "character" | "style" | "location" | "shot"; media: "image" | "video"; name: string; url: string; anchorUrl: string; note?: string }) {
  window.dispatchEvent(new CustomEvent("mvs-director-save-asset", { detail }));
}

function editKey(type: "scene_image" | "shot_image" | "clip", clipId: string): string {
  return `${type}:${clipId}`;
}

export function DirectorAssetsPanel({
  plan,
  references,
  sceneImages,
  shotImages,
  characters,
  approvedCharacterIds,
  characterSelections,
  pendingAssetEdits,
  disabled = false,
  onApply,
  onCharacterSelectionChange,
  onGeneratePreparedImage,
}: Props) {
  const clips = useStore((state) => state.clips);
  const [saving, setSaving] = useState<string | null>(null);
  const generatedImages: Array<{ id: string; clipId: string; label: string; url: string; targetType: "scene_image" | "shot_image" }> = [
    ...Object.entries(sceneImages).map(([clipId, url]) => ({ id: `scene-${clipId}`, clipId, label: `Scene image · ${clipId}`, url, targetType: "scene_image" as const })),
    ...Object.entries(shotImages).map(([clipId, url]) => ({ id: `shot-${clipId}`, clipId, label: `Shot image · ${clipId}`, url, targetType: "shot_image" as const })),
  ];
  const readyClips = clips.filter((clip) => clip.status === "ready" && clip.videoUrl);

  const applyReference = (asset: RefAsset) => {
    const anchorUrl = asset.anchorUrl ?? asset.url;
    if (!anchorUrl) { toast.error("This asset does not have a usable visual reference."); return; }
    const kind = asset.kind === "character" || asset.kind === "location" || asset.kind === "shot" ? asset.kind : "style";
    const media = asset.media === "video" ? "video" : "image";
    window.dispatchEvent(new CustomEvent("mvs-director-reference", { detail: { kind, media, name: asset.name || asset.id, url: anchorUrl, sourceUrl: asset.url, note: asset.note } }));
    toast.success(`Using ${asset.name || asset.id} in Director`);
  };
  const saveGeneratedImage = (label: string, url: string) => {
    saveAsset({ kind: "shot", media: "image", name: label, url, anchorUrl: url, note: "Approved/generated Director visual available for reuse." });
    toast.success("Saved to Director Assets");
  };
  const saveVideo = async (clipId: string, videoUrl: string) => {
    setSaving(clipId);
    try {
      const anchorUrl = (await extractLastFrame(videoUrl)).url;
      saveAsset({ kind: "shot", media: "video", name: `Generated section ${clipId}`, url: videoUrl, anchorUrl, note: "Generated section clip saved as a reusable Director asset." });
      toast.success("Section clip saved to Director Assets");
    } catch (error) {
      toast.error(`Could not save clip asset: ${error instanceof Error ? error.message : String(error)}`);
    } finally { setSaving(null); }
  };

  return <section style={sectionStyle}>
    <div style={headerStyle}><div><h3 style={titleStyle}>Assets — reuse what already works</h3><p style={helpStyle}>Characters, wardrobe/look references, locations, props, generated images, and finished section clips can be kept here and reused by Director instead of recreated with more credits.</p></div><button type="button" className="btn ghost" onClick={() => window.dispatchEvent(new CustomEvent("mvs-open-reference-chat"))}>＋ Add asset</button></div>
    <div style={columnsStyle}>
      <div><strong style={labelStyle}>Saved references</strong><div style={listStyle}>{references.length ? references.map((asset) => <div key={asset.id} style={itemStyle}><span><b>{asset.name || asset.id}</b><small style={smallStyle}>{asset.kind || "style"} · {asset.media || "image"}</small><button type="button" className="btn ghost" style={{ marginTop: 6 }} onClick={() => applyReference(asset)}>Use in Director</button></span>{asset.anchorUrl && <img src={asset.anchorUrl} alt="" style={thumbStyle} />}</div>) : <div style={emptyStyle}>No reusable assets yet.</div>}</div></div>
      <div><strong style={labelStyle}>Generated images</strong><div style={listStyle}>{generatedImages.length ? generatedImages.map((asset) => {
        const pending = pendingAssetEdits[editKey(asset.targetType, asset.clipId)];
        return <div key={asset.id} style={assetCardStyle}>
          <div style={itemStyle}><span><b>{asset.label}</b><button type="button" className="btn ghost" style={{ marginTop: 6 }} onClick={() => saveGeneratedImage(asset.label, asset.url)}>Save as asset</button></span><img src={asset.url} alt="" style={thumbStyle} /></div>
          <DirectorCharacterPicker characters={characters} approvedIds={approvedCharacterIds} selectedIds={characterSelections[asset.clipId] ?? []} onChange={(ids) => onCharacterSelectionChange(asset.clipId, ids)} disabled={disabled} />
          <AssetEditChat label={`Edit ${asset.label}`} target={{ type: asset.targetType, clipId: asset.clipId }} plan={plan} references={references} sceneImages={sceneImages} shotImages={shotImages} disabled={disabled} onApply={onApply} />
          {pending?.prompt && <div style={preparedStyle}><span>Director edit prepared. No image credits have been spent yet.</span><button type="button" className="btn primary" disabled={disabled} onClick={() => void onGeneratePreparedImage(asset.targetType, asset.clipId)}>Generate edited image</button></div>}
        </div>;
      }) : <div style={emptyStyle}>Generated scene and shot images will appear here.</div>}</div></div>
      <div><strong style={labelStyle}>Generated section clips</strong><div style={listStyle}>{readyClips.length ? readyClips.map((clip) => {
        const pending = pendingAssetEdits[editKey("clip", clip.id)];
        return <div key={clip.id} style={assetCardStyle}>
          <div style={itemStyle}><span><b>{clip.sectionLabel || clip.id}</b><small style={smallStyle}>{(clip.end - clip.start).toFixed(1)}s · reusable clip</small><button type="button" className="btn ghost" style={{ marginTop: 6 }} disabled={saving === clip.id} onClick={() => void saveVideo(clip.id, clip.videoUrl!)}>{saving === clip.id ? "Saving…" : "Save clip as asset"}</button></span><video src={clip.videoUrl} muted preload="metadata" style={videoThumbStyle} /></div>
          <DirectorCharacterPicker characters={characters} approvedIds={approvedCharacterIds} selectedIds={characterSelections[clip.id] ?? []} onChange={(ids) => onCharacterSelectionChange(clip.id, ids)} disabled={disabled} />
          <AssetEditChat label={`Edit ${clip.sectionLabel || clip.id}`} target={{ type: "clip", clipId: clip.id }} plan={plan} references={references} sceneImages={sceneImages} shotImages={shotImages} disabled={disabled} onApply={onApply} />
          {pending?.regenerate && <div style={preparedStyle}>Director regeneration prepared. Use the section review's explicit Regenerate button when you are ready to spend video credits.</div>}
        </div>;
      }) : <div style={emptyStyle}>Approved/generated section clips will appear here.</div>}</div></div>
    </div>
  </section>;
}

const sectionStyle: CSSProperties = { marginTop: 20, padding: 16, borderRadius: 14, border: "1px solid rgba(168,85,247,.28)", background: "rgba(168,85,247,.045)" };
const headerStyle: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 };
const titleStyle: CSSProperties = { margin: 0, fontSize: 18 };
const helpStyle: CSSProperties = { margin: "6px 0 0", color: "#a1a1aa", fontSize: 12, lineHeight: 1.45, maxWidth: 760 };
const columnsStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 12, marginTop: 14 };
const labelStyle: CSSProperties = { fontSize: 12, color: "#e4e4e7" };
const listStyle: CSSProperties = { display: "grid", gap: 8, marginTop: 8 };
const assetCardStyle: CSSProperties = { padding: 9, borderRadius: 10, border: "1px solid rgba(255,255,255,.1)", background: "rgba(0,0,0,.12)" };
const itemStyle: CSSProperties = { display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", padding: 9, borderRadius: 9, border: "1px solid rgba(255,255,255,.1)", background: "rgba(0,0,0,.16)", fontSize: 11 };
const smallStyle: CSSProperties = { display: "block", marginTop: 3, color: "#a1a1aa", fontSize: 10 };
const thumbStyle: CSSProperties = { width: 66, height: 50, objectFit: "cover", borderRadius: 7, background: "#111" };
const videoThumbStyle: CSSProperties = { width: 78, height: 52, objectFit: "cover", borderRadius: 7, background: "#111" };
const preparedStyle: CSSProperties = { display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 8, padding: 8, borderRadius: 8, background: "rgba(34,197,94,.08)", border: "1px solid rgba(34,197,94,.2)", color: "#bbf7d0", fontSize: 10 };
const emptyStyle: CSSProperties = { padding: 10, color: "#71717a", fontSize: 11, border: "1px dashed rgba(255,255,255,.1)", borderRadius: 9 };
