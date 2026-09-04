import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { parseDirectorVision } from "../lib/directorVisionParser.js";
import {
  buildScriptLockedShots,
  emptyScriptLockedDirectorSession,
  materializeScriptLockedTimeline,
  migrateLegacyDirectorAssets,
  type ScriptLockedCompiledShot,
  type ScriptLockedDirectorSessionV1,
  type ScriptLockedReference,
} from "../lib/directorScriptLocked.js";
import { compileScriptLocked, editScriptLocked } from "../lib/directorScriptLockedClient.js";
import { setClipCharacterSelection, toggleApprovedCharacter } from "../lib/directorCharacterState.js";
import {
  findPriorApprovedContinuityAnchor,
  findPriorApprovedProjectAnchor,
} from "../lib/directorContinuityLock.js";
import {
  buildAgnesGenerationInstruction,
  buildScriptLockedImageReferenceUrls,
  generateScriptLockedShotImage,
  prepareScriptLockedVideoGeneration,
  queueScriptLockedVideo,
} from "../lib/directorScriptLockedGeneration.js";
import { useStore } from "../lib/store.js";
import { DirectorCharacterApproval, DirectorCharacterPicker, type CharacterOption } from "./DirectorCharacterControls.js";

const SCRIPT_LOCKED_ENABLED = import.meta.env.VITE_SCRIPTLOCKED_DIRECTOR_ENABLED === "true";
const OPEN_EVENT = "mvs-open-ltx-director";
const ASSISTED_EVENT = "mvs-open-assisted-director";
const REFERENCE_EVENT = "mvs-director-reference";

type ReadyReferenceItem = {
  id: string;
  kind: ScriptLockedReference["kind"];
  media?: "image" | "video" | "note";
  name: string;
  url?: string;
  anchorUrl?: string;
  note?: string;
};

function sessionKey(songId: string): string { return `mvs-scriptlocked-director-v1-${songId}`; }
function legacySessionKeys(songId: string): string[] {
  return [
    `mvs-ltx-director-agent-v4-${songId}`,
    `mvs-ltx-director-agent-v3-${songId}`,
    `mvs-ltx-director-agent-v2-${songId}`,
  ];
}
function referenceKey(songId: string): string { return `mvs-director-reference-chat-v1-${songId}`; }
function sectionApprovalKey(songId: string): string { return `mvs-director-section-approvals-v1-${songId}`; }

function readJson(key: string): any {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function restoreSession(songId: string): ScriptLockedDirectorSessionV1 {
  const saved = readJson(sessionKey(songId));
  if (saved?.version === 1) {
    return {
      ...emptyScriptLockedDirectorSession(typeof saved.sourceVision === "string" ? saved.sourceVision : ""),
      ...saved,
      version: 1,
      compiledByClip: saved.compiledByClip && typeof saved.compiledByClip === "object" ? saved.compiledByClip : {},
      approvedCharacterIds: Array.isArray(saved.approvedCharacterIds) ? saved.approvedCharacterIds.filter((id: unknown): id is string => typeof id === "string") : [],
      characterSelections: saved.characterSelections && typeof saved.characterSelections === "object" ? saved.characterSelections : {},
      shotApprovals: saved.shotApprovals && typeof saved.shotApprovals === "object" ? saved.shotApprovals : {},
      sceneApprovals: saved.sceneApprovals && typeof saved.sceneApprovals === "object" ? saved.sceneApprovals : {},
      sectionApprovals: saved.sectionApprovals && typeof saved.sectionApprovals === "object" ? saved.sectionApprovals : {},
    };
  }

  const legacy = legacySessionKeys(songId).map(readJson).find(Boolean) ?? {};
  const migrated = migrateLegacyDirectorAssets({
    shotApprovals: legacy.shotApprovals,
    sceneApprovals: legacy.sceneApprovals,
    sectionApprovals: readJson(sectionApprovalKey(songId)),
    approvedCharacterIds: legacy.approvedCharacterIds,
    characterSelections: legacy.characterSelections,
    legacyPlan: legacy.plan,
  });
  return {
    ...migrated,
    sourceVision: typeof legacy.vision === "string" ? legacy.vision : "",
  };
}

function readReferenceItems(songId: string): ReadyReferenceItem[] {
  const raw = readJson(referenceKey(songId));
  const items = Array.isArray(raw) ? raw : [];
  const ready: ReadyReferenceItem[] = [];
  for (const rawItem of items) {
    if (!rawItem || typeof rawItem !== "object") continue;
    const item = rawItem as Record<string, unknown>;
    if (typeof item.id !== "string" || typeof item.name !== "string") continue;
    if (!(["character", "style", "location", "shot", "note"] as const).includes(item.kind as any)) continue;
    if (item.media !== "note" && item.status && item.status !== "ready") continue;
    ready.push({
      id: item.id,
      kind: item.kind as ScriptLockedReference["kind"],
      media: item.media === "image" || item.media === "video" || item.media === "note" ? item.media : undefined,
      name: item.name,
      url: typeof item.url === "string" && item.url.trim() ? item.url.trim() : undefined,
      anchorUrl: typeof item.anchorUrl === "string" && item.anchorUrl.trim() ? item.anchorUrl.trim() : undefined,
      note: typeof item.note === "string" && item.note.trim() ? item.note.trim() : undefined,
    });
  }
  return ready;
}

function compileReferences(items: ReadyReferenceItem[], characterImageUrl: string | null): ScriptLockedReference[] {
  const references = items.map((item) => ({
    id: item.id,
    kind: item.kind,
    name: item.name,
    description: item.note || item.name,
  }));
  if (characterImageUrl && !references.some((reference) => reference.id === "store-character")) {
    references.unshift({
      id: "store-character",
      kind: "character",
      name: "Approved project character",
      description: "Approved project character image",
    });
  }
  return references;
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  const rest = Math.max(0, seconds) - minutes * 60;
  return `${minutes}:${rest.toFixed(1).padStart(4, "0")}`;
}

export function ScriptLockedDirectorAgent() {
  const songId = useStore((state) => state.songId);
  const projectId = useStore((state) => state.projectId);
  const characterImageUrl = useStore((state) => state.characterImageUrl);
  const timelineClips = useStore((state) => state.clips);
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<ScriptLockedDirectorSessionV1>(() => emptyScriptLockedDirectorSession());
  const [referenceRevision, setReferenceRevision] = useState(0);
  const [busy, setBusy] = useState<"compile" | string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editDrafts, setEditDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!songId) {
      setOpen(false);
      setSession(emptyScriptLockedDirectorSession());
      return;
    }
    setSession(restoreSession(songId));
  }, [songId]);

  useEffect(() => {
    if (!songId) return;
    localStorage.setItem(sessionKey(songId), JSON.stringify(session));
  }, [songId, session]);

  useEffect(() => {
    if (!SCRIPT_LOCKED_ENABLED) return;
    const openDirector = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, openDirector);
    return () => window.removeEventListener(OPEN_EVENT, openDirector);
  }, []);

  useEffect(() => {
    if (!SCRIPT_LOCKED_ENABLED) return;
    const refresh = () => setReferenceRevision((value) => value + 1);
    window.addEventListener(REFERENCE_EVENT, refresh);
    return () => window.removeEventListener(REFERENCE_EVENT, refresh);
  }, []);

  const referenceItems = useMemo(
    () => songId ? readReferenceItems(songId) : [],
    [songId, referenceRevision],
  );
  const references = useMemo(
    () => compileReferences(referenceItems, characterImageUrl),
    [referenceItems, characterImageUrl],
  );
  const characters = useMemo<CharacterOption[]>(() => {
    const options = referenceItems
      .filter((reference) => reference.kind === "character")
      .map((reference) => ({
        id: reference.id,
        name: reference.name,
        url: reference.anchorUrl || reference.url,
      }));
    if (characterImageUrl && !options.some((option) => option.id === "store-character")) {
      options.unshift({ id: "store-character", name: "Approved project character", url: characterImageUrl });
    }
    return options;
  }, [referenceItems, characterImageUrl]);
  const parsedVision = useMemo(() => parseDirectorVision(session.sourceVision), [session.sourceVision]);
  const shots = useMemo(
    () => buildScriptLockedShots(session.sourceVision, session.characterSelections),
    [session.sourceVision, session.characterSelections],
  );

  if (!SCRIPT_LOCKED_ENABLED || !songId) return null;
  if (!open) return null;

  const referenceUrlForId = (id: string): string | undefined => {
    if (id === "store-character") return characterImageUrl ?? undefined;
    const item = referenceItems.find((candidate) => candidate.id === id);
    return item?.anchorUrl || item?.url;
  };

  const updateSource = (sourceVision: string) => {
    setSession((current) => ({ ...current, sourceVision, compiledByClip: {} }));
    setEditDrafts({});
    setError(null);
  };

  const toggleCharacter = (id: string) => {
    setSession((current) => {
      const approvedCharacterIds = toggleApprovedCharacter(current.approvedCharacterIds, id);
      const approvedSet = new Set(approvedCharacterIds);
      const characterSelections = Object.fromEntries(
        Object.entries(current.characterSelections).map(([clipId, ids]) => [clipId, ids.filter((value) => approvedSet.has(value))]),
      );
      return { ...current, approvedCharacterIds, characterSelections, compiledByClip: {} };
    });
  };

  const changeCharacters = (clipId: string, ids: string[]) => {
    setSession((current) => ({
      ...current,
      characterSelections: setClipCharacterSelection(current.characterSelections, clipId, ids, current.approvedCharacterIds),
      compiledByClip: { ...current.compiledByClip, [clipId]: undefined },
      shotApprovals: { ...current.shotApprovals, [clipId]: current.shotApprovals[clipId] ? { ...current.shotApprovals[clipId]!, approved: false } : undefined },
    }));
  };

  const compileAll = async () => {
    if (parsedVision.mode !== "structured" || shots.length === 0) {
      setError("Script-Locked Director needs timecoded shots. Add timecodes to use the Agnes compiler, or open Assisted Director for non-timecoded planning.");
      return;
    }
    setBusy("compile");
    setError(null);
    try {
      const response = await compileScriptLocked({
        projectId: projectId ?? songId,
        visionMode: "structured",
        shots,
        references,
        mustInclude: "",
        avoid: "",
      });
      const nextTimeline = materializeScriptLockedTimeline(session.sourceVision, useStore.getState().clips);
      useStore.setState({ clips: nextTimeline, selectedClipId: nextTimeline[0]?.id ?? null });
      setSession((current) => ({
        ...current,
        compiledByClip: Object.fromEntries(response.shots.map((shot) => [shot.clipId, shot])),
      }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(null);
    }
  };

  const editInstruction = async (shot: (typeof shots)[number], compiled: ScriptLockedCompiledShot) => {
    const userMessage = (editDrafts[shot.clipId] ?? "").trim();
    if (!userMessage) return;
    setBusy(shot.clipId);
    setError(null);
    try {
      const response = await editScriptLocked({
        projectId: projectId ?? songId,
        target: "agnes_instruction",
        clipId: shot.clipId,
        start: shot.start,
        end: shot.end,
        sourceText: shot.sourceText,
        currentAgnesPrompt: compiled.agnesPrompt,
        selectedCharacterIds: compiled.selectedCharacterIds,
        selectedReferenceIds: compiled.selectedReferenceIds,
        continuityConstraints: compiled.continuityConstraints,
        userMessage,
      });
      setSession((current) => ({
        ...current,
        compiledByClip: {
          ...current.compiledByClip,
          [shot.clipId]: {
            ...compiled,
            agnesPrompt: response.agnesPrompt,
            compilerNotes: response.compilerNotes,
          },
        },
      }));
      setEditDrafts((current) => ({ ...current, [shot.clipId]: "" }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(null);
    }
  };

  const generateShotImage = async (shot: (typeof shots)[number], compiled: ScriptLockedCompiledShot) => {
    const selectedIds = session.characterSelections[shot.clipId] ?? [];
    const selectedCharacterUrls = selectedIds.map(referenceUrlForId).filter((url): url is string => Boolean(url));
    if (selectedIds.length !== selectedCharacterUrls.length) {
      setError("Every selected character needs a ready approved reference image before shot-image generation.");
      return;
    }
    const continuityShots = shots.map((item) => ({ clipId: item.clipId }));
    const sameCharacterAnchor = findPriorApprovedContinuityAnchor({
      currentClipId: shot.clipId,
      shots: continuityShots,
      shotApprovals: session.shotApprovals,
      sceneApprovals: session.sceneApprovals,
      characterSelections: session.characterSelections,
    });
    const projectAnchor = findPriorApprovedProjectAnchor({
      currentClipId: shot.clipId,
      shots: continuityShots,
      shotApprovals: session.shotApprovals,
      sceneApprovals: session.sceneApprovals,
    });
    const referenceUrls = buildScriptLockedImageReferenceUrls({
      currentImageUrl: session.shotApprovals[shot.clipId]?.url,
      selectedCharacterUrls,
      sameCharacterAnchorUrl: sameCharacterAnchor?.url,
      projectAnchorUrl: projectAnchor?.url,
    });
    const prompt = buildAgnesGenerationInstruction({
      agnesPrompt: compiled.agnesPrompt,
      continuityConstraints: compiled.continuityConstraints,
    });
    setBusy(`image:${shot.clipId}`);
    setError(null);
    try {
      const url = await generateScriptLockedShotImage({ prompt, referenceUrls, name: shot.sourceText });
      setSession((current) => ({
        ...current,
        shotApprovals: { ...current.shotApprovals, [shot.clipId]: { url, approved: false } },
      }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(null);
    }
  };

  const approveShotImage = (clipId: string) => {
    setSession((current) => {
      const image = current.shotApprovals[clipId];
      if (!image?.url) return current;
      return {
        ...current,
        shotApprovals: { ...current.shotApprovals, [clipId]: { ...image, approved: true } },
      };
    });
  };

  const generateVideo = async (shot: (typeof shots)[number], compiled: ScriptLockedCompiledShot) => {
    const prepared = prepareScriptLockedVideoGeneration({
      clipId: shot.clipId,
      start: shot.start,
      end: shot.end,
      sectionLabel: shot.sourceText.split("\n")[0]?.slice(0, 80) || shot.clipId,
      agnesPrompt: compiled.agnesPrompt,
      continuityConstraints: compiled.continuityConstraints,
      selectedCharacterIds: compiled.selectedCharacterIds,
      approvedShotImage: session.shotApprovals[shot.clipId],
    });
    if ("reason" in prepared) {
      setError(prepared.reason);
      return;
    }
    setBusy(`video:${shot.clipId}`);
    setError(null);
    try {
      const creativeTimeline = materializeScriptLockedTimeline(session.sourceVision, useStore.getState().clips);
      useStore.setState({ clips: creativeTimeline, selectedClipId: shot.clipId });
      await queueScriptLockedVideo(prepared.input);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(null);
    }
  };

  const openAssisted = () => {
    setOpen(false);
    window.dispatchEvent(new CustomEvent(ASSISTED_EVENT));
  };

  return <div style={overlayStyle} role="dialog" aria-modal="true" aria-label="Script-Locked Director">
    <div style={panelStyle}>
      <div style={headerStyle}>
        <div>
          <div style={statusStyle}>● Script locked</div>
          <h2 style={titleStyle}>Script-Locked Director</h2>
          <p style={subtleStyle}>Your timecoded shot text, clip identity, and timing stay authoritative. Director compiles execution instructions; it does not rewrite the concept.</p>
        </div>
        <button type="button" className="btn" onClick={() => setOpen(false)}>Close</button>
      </div>

      <section style={sectionStyle}>
        <div style={stepStyle}>1 · Script</div>
        <h3 style={sectionTitleStyle}>Exact source script</h3>
        <textarea
          value={session.sourceVision}
          onChange={(event) => updateSource(event.target.value)}
          placeholder="Paste timecoded shots, for example 00:12–00:18 followed by Shot 1 and Camera directions."
          style={textareaStyle}
        />
        {parsedVision.mode === "general" ? <div style={warningStyle}>
          <strong>Script-Locked Director needs timecoded shots.</strong> Add timecodes to use the Agnes compiler, or open Assisted Director for non-timecoded planning.
          <div style={{ marginTop: 9 }}><button type="button" className="btn" onClick={openAssisted}>Open Assisted Director</button></div>
        </div> : <div style={lockedStyle}>{shots.length} exact timecoded shots detected. Shot count and timing are locked.</div>}
        {shots.map((shot) => <article key={shot.clipId} style={sourceCardStyle}>
          <div style={rowStyle}><strong>{shot.clipId}</strong><span>{formatTime(shot.start)}–{formatTime(shot.end)}</span></div>
          <pre style={sourceTextStyle}>{shot.sourceText}</pre>
        </article>)}
      </section>

      <section style={sectionStyle}>
        <div style={stepStyle}>2 · References</div>
        <h3 style={sectionTitleStyle}>Approved references</h3>
        <p style={subtleStyle}>Only selected approved character/reference facts are eligible continuity context for a shot.</p>
        <DirectorCharacterApproval characters={characters} approvedIds={session.approvedCharacterIds} onToggle={toggleCharacter} />
        {shots.map((shot) => <div key={shot.clipId} style={referenceRowStyle}>
          <strong>{shot.clipId}</strong>
          <DirectorCharacterPicker
            characters={characters}
            approvedIds={session.approvedCharacterIds}
            selectedIds={session.characterSelections[shot.clipId] ?? []}
            onChange={(ids) => changeCharacters(shot.clipId, ids)}
          />
          <div style={tinyStyle}>Selected refs: {(session.characterSelections[shot.clipId] ?? []).join(", ") || "none"}</div>
        </div>)}
        {references.filter((reference) => reference.kind !== "character").length > 0 && <div style={referenceListStyle}>
          {references.filter((reference) => reference.kind !== "character").map((reference) => <span key={reference.id} style={chipStyle}>{reference.kind}: {reference.name}</span>)}
        </div>}
      </section>

      <section style={sectionStyle}>
        <div style={stepStyle}>3 · Agnes Instructions</div>
        <div style={rowStyle}>
          <div><h3 style={sectionTitleStyle}>Agnes instruction compiler</h3><p style={subtleStyle}>Compile is text-only and does not spend media-generation credits.</p></div>
          <button type="button" className="btn primary" disabled={busy !== null || shots.length === 0} onClick={() => void compileAll()}>{busy === "compile" ? "Compiling…" : "Compile Agnes instructions"}</button>
        </div>
        {error && <div style={errorStyle}>{error}</div>}
        {shots.map((shot) => {
          const compiled = session.compiledByClip[shot.clipId];
          return <article key={shot.clipId} style={instructionCardStyle}>
            <div style={rowStyle}><strong>{shot.clipId}</strong><span style={tinyStyle}>{compiled ? "Compiled from exact source" : "Not compiled"}</span></div>
            <div style={labelStyle}>Agnes instruction</div>
            <div style={instructionStyle}>{compiled?.agnesPrompt ?? "Compile this shot to create its Agnes execution instruction."}</div>
            {compiled && <>
              <div style={labelStyle}>Continuity</div>
              {compiled.continuityConstraints.length ? <ul style={continuityStyle}>{compiled.continuityConstraints.map((item) => <li key={item}>{item}</li>)}</ul> : <div style={tinyStyle}>No additional continuity facts selected.</div>}
              <div style={editStyle}>
                <input
                  value={editDrafts[shot.clipId] ?? ""}
                  onChange={(event) => setEditDrafts((current) => ({ ...current, [shot.clipId]: event.target.value }))}
                  placeholder="Edit this instruction without changing locked source facts or timing"
                  style={inputStyle}
                />
                <button type="button" className="btn" disabled={busy !== null || !(editDrafts[shot.clipId] ?? "").trim()} onClick={() => void editInstruction(shot, compiled)}>{busy === shot.clipId ? "Editing…" : "Apply instruction edit"}</button>
              </div>
            </>}
          </article>;
        })}
      </section>

      <section style={sectionStyle}>
        <div style={stepStyle}>4 · Generate</div>
        <h3 style={sectionTitleStyle}>Explicit generation</h3>
        <p style={subtleStyle}>Existing approved media is preserved. Nothing generates from compile, edit, migration, reference selection, or approval actions.</p>
        {shots.map((shot) => {
          const compiled = session.compiledByClip[shot.clipId];
          const image = session.shotApprovals[shot.clipId];
          const timelineClip = timelineClips.find((clip) => clip.id === shot.clipId);
          const migratedVideo = session.sectionApprovals[shot.clipId];
          const videoUrl = timelineClip?.status === "ready" && timelineClip.videoUrl ? timelineClip.videoUrl : migratedVideo?.url;
          const videoActive = timelineClip?.status === "queued" || timelineClip?.status === "generating";
          return <article key={shot.clipId} style={generateCardStyle}>
            <div style={rowStyle}><strong>{shot.clipId}</strong><span style={tinyStyle}>{compiled ? "Instruction ready" : "Compile first"}</span></div>
            {image?.url && <img src={image.url} alt={`${shot.clipId} shot`} style={previewImageStyle} />}
            {image?.url && <div style={rowStyle}>
              <span style={tinyStyle}>{image.approved ? "Approved shot image · eligible Agnes seed" : "Review this image before video generation."}</span>
              <button type="button" className="btn" disabled={image.approved || busy !== null} onClick={() => approveShotImage(shot.clipId)}>{image.approved ? "Shot image approved" : "Approve shot image"}</button>
            </div>}
            {videoUrl && <video src={videoUrl} controls preload="metadata" style={previewVideoStyle} />}
            <div style={generateActionsStyle}>
              <button type="button" className="btn" disabled={!compiled || busy !== null} onClick={() => compiled && void generateShotImage(shot, compiled)}>
                {busy === `image:${shot.clipId}` ? "Generating image…" : image?.url ? "Regenerate shot image" : "Generate shot image"}
              </button>
              <button type="button" className="btn primary" disabled={!compiled || busy !== null || videoActive} onClick={() => compiled && void generateVideo(shot, compiled)}>
                {videoActive ? "Video queued…" : videoUrl ? "Regenerate video" : "Generate video"}
              </button>
            </div>
            <span style={tinyStyle}>Provider calls happen only from these explicit buttons. Character-selected video stays blocked until the current shot image is approved.</span>
          </article>;
        })}
      </section>
    </div>
  </div>;
}

const overlayStyle: CSSProperties = { position: "fixed", inset: 0, zIndex: 80, background: "rgba(0,0,0,.72)", display: "grid", placeItems: "center", padding: 18 };
const panelStyle: CSSProperties = { width: "min(1040px,96vw)", maxHeight: "92vh", overflow: "auto", borderRadius: 16, border: "1px solid rgba(255,255,255,.15)", background: "#0b0b0f", color: "#f4f4f5", padding: 18, boxShadow: "0 24px 90px rgba(0,0,0,.55)" };
const headerStyle: CSSProperties = { display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start" };
const titleStyle: CSSProperties = { margin: "4px 0 0", fontSize: 24 };
const statusStyle: CSSProperties = { color: "#86efac", fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".08em" };
const subtleStyle: CSSProperties = { color: "#a1a1aa", fontSize: 12, lineHeight: 1.5, margin: "6px 0 0" };
const sectionStyle: CSSProperties = { marginTop: 16, padding: 14, borderRadius: 13, border: "1px solid rgba(255,255,255,.11)", background: "rgba(255,255,255,.025)" };
const stepStyle: CSSProperties = { color: "#93c5fd", fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".08em" };
const sectionTitleStyle: CSSProperties = { margin: "4px 0 0", fontSize: 17 };
const textareaStyle: CSSProperties = { width: "100%", minHeight: 160, marginTop: 10, padding: 11, borderRadius: 9, border: "1px solid rgba(255,255,255,.14)", background: "#111116", color: "#f4f4f5", font: "inherit", lineHeight: 1.45, resize: "vertical" };
const warningStyle: CSSProperties = { marginTop: 10, padding: 11, borderRadius: 9, border: "1px solid rgba(245,158,11,.3)", background: "rgba(245,158,11,.08)", color: "#fde68a", fontSize: 12, lineHeight: 1.45 };
const lockedStyle: CSSProperties = { marginTop: 10, padding: 9, borderRadius: 9, border: "1px solid rgba(34,197,94,.25)", background: "rgba(34,197,94,.07)", color: "#bbf7d0", fontSize: 11 };
const sourceCardStyle: CSSProperties = { marginTop: 9, padding: 10, borderRadius: 9, background: "rgba(0,0,0,.22)", border: "1px solid rgba(255,255,255,.08)" };
const rowStyle: CSSProperties = { display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" };
const sourceTextStyle: CSSProperties = { margin: "8px 0 0", whiteSpace: "pre-wrap", fontFamily: "inherit", color: "#e4e4e7", fontSize: 12, lineHeight: 1.5 };
const referenceRowStyle: CSSProperties = { marginTop: 10, padding: 10, borderRadius: 9, border: "1px solid rgba(255,255,255,.08)" };
const tinyStyle: CSSProperties = { color: "#a1a1aa", fontSize: 10 };
const referenceListStyle: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 };
const chipStyle: CSSProperties = { padding: "5px 8px", borderRadius: 999, background: "rgba(59,130,246,.1)", color: "#bfdbfe", fontSize: 10 };
const instructionCardStyle: CSSProperties = { marginTop: 10, padding: 11, borderRadius: 10, border: "1px solid rgba(59,130,246,.2)", background: "rgba(59,130,246,.035)" };
const labelStyle: CSSProperties = { marginTop: 9, color: "#93c5fd", fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".06em" };
const instructionStyle: CSSProperties = { marginTop: 5, padding: 9, borderRadius: 8, background: "rgba(0,0,0,.25)", color: "#f4f4f5", fontSize: 12, lineHeight: 1.5 };
const continuityStyle: CSSProperties = { margin: "5px 0 0", paddingLeft: 18, color: "#d4d4d8", fontSize: 11, lineHeight: 1.5 };
const editStyle: CSSProperties = { display: "grid", gridTemplateColumns: "1fr auto", gap: 8, marginTop: 10 };
const inputStyle: CSSProperties = { minWidth: 0, padding: 9, borderRadius: 8, border: "1px solid rgba(255,255,255,.14)", background: "#111116", color: "#f4f4f5" };
const errorStyle: CSSProperties = { marginTop: 10, padding: 10, borderRadius: 9, background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.25)", color: "#fecaca", fontSize: 11 };
const generateCardStyle: CSSProperties = { display: "grid", gap: 8, marginTop: 10, padding: 10, borderRadius: 9, border: "1px solid rgba(255,255,255,.09)" };
const generateActionsStyle: CSSProperties = { display: "flex", gap: 8, flexWrap: "wrap" };
const previewImageStyle: CSSProperties = { width: "100%", maxHeight: 220, objectFit: "cover", borderRadius: 8, background: "#000" };
const previewVideoStyle: CSSProperties = { width: "100%", maxHeight: 240, borderRadius: 8, background: "#000" };
