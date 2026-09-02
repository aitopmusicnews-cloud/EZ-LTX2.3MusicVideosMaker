import type { CSSProperties } from "react";
import type { Clip } from "@mvs/shared";
import type { DirectorPlan, DirectorClip } from "../lib/directorPlan.js";
import { countDirectorGenerationRequests } from "../lib/directorGeneration.js";

export function DirectorProductionSections({
  plan,
  clips,
  onGenerateShot,
  onGenerateSection,
  onGenerateAll,
  onApproveTechnicalSplit,
  onContinue,
}: {
  plan: DirectorPlan;
  clips: Clip[];
  onGenerateShot: (shotId: string, regenerate?: boolean) => void;
  onGenerateSection: (sectionId: string) => void;
  onGenerateAll: () => void;
  onApproveTechnicalSplit: (shotId: string) => void;
  onContinue: () => void;
}) {
  const allCount = countDirectorGenerationRequests(plan, clips, { type: "all" });
  const readyCount = clips.filter((clip) => clip.status === "ready" && clip.videoUrl).length;
  const activeCount = clips.filter((clip) => clip.status === "queued" || clip.status === "generating").length;

  return (
    <section>
      <h3 style={{ margin: 0, fontSize: 18 }}>5. Produce your approved shots</h3>
      <p style={helpStyle}>
        Your creative shot count stays intact. Generate one shot, one song section, or all approved shots. Finished videos stay locked until you press Regenerate.
      </p>
      <div style={summaryStyle}>
        <Stat label="Creative shots" value={String(plan.sections.flatMap((section) => section.shots).length)} />
        <Stat label="Ready segments" value={`${readyCount}/${clips.length}`} />
        <Stat label="Generating" value={String(activeCount)} />
      </div>

      <div style={{ display: "grid", gap: 16, marginTop: 18 }}>
        {plan.sections.map((section) => {
          const sectionCount = countDirectorGenerationRequests(plan, clips, { type: "section", sectionId: section.id });
          return (
            <div key={section.id} style={sectionStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <div>
                  <strong style={{ fontSize: 16 }}>{section.label}</strong>
                  <div style={mutedStyle}>{formatTime(section.start)}–{formatTime(section.end)} · {section.shots.length} creative shot{section.shots.length === 1 ? "" : "s"}</div>
                </div>
                <button type="button" className="btn" disabled={sectionCount === 0} onClick={() => onGenerateSection(section.id)}>
                  Generate Section{sectionCount ? ` (${sectionCount})` : ""}
                </button>
              </div>

              <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
                {section.shots.map((shot) => {
                  const shotClips = clips.filter((raw) => (raw as DirectorClip).directorShotId === shot.id);
                  const segmentCount = shotClips.length || Math.max(1, Math.ceil((shot.end - shot.start) / 5));
                  const ready = shotClips.length > 0 && shotClips.every((clip) => clip.status === "ready" && clip.videoUrl);
                  const active = shotClips.some((clip) => clip.status === "queued" || clip.status === "generating");
                  const requestCount = countDirectorGenerationRequests(plan, clips, { type: "shot", shotId: shot.id });
                  const requiresSplitApproval = segmentCount > 1 && !shot.technicalSplitApproved;
                  return (
                    <div key={shot.id} style={shotStyle}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <strong>{shot.label}</strong>
                          <div style={mutedStyle}>{formatTime(shot.start)}–{formatTime(shot.end)} · {segmentCount} technical segment{segmentCount === 1 ? "" : "s"}</div>
                          <div style={{ marginTop: 8, lineHeight: 1.45 }}>{shot.visualDirection || shot.rawText}</div>
                          {shot.cameraDirection && <Detail label="Camera" value={shot.cameraDirection} />}
                          {shot.audioCue && <Detail label="Audio / lyric" value={shot.audioCue} />}
                          {shot.onScreenText && <Detail label="On-screen text" value={shot.onScreenText} />}
                        </div>
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}>
                          {requiresSplitApproval ? (
                            <button type="button" className="btn primary" onClick={() => onApproveTechnicalSplit(shot.id)}>
                              Approve {segmentCount} segments
                            </button>
                          ) : ready ? (
                            <button type="button" className="btn" disabled={active} onClick={() => onGenerateShot(shot.id, true)}>Regenerate Shot</button>
                          ) : (
                            <button type="button" className="btn primary" disabled={active || requestCount === 0} onClick={() => onGenerateShot(shot.id)}>
                              {active ? "Generating…" : `Generate Shot${requestCount ? ` (${requestCount})` : ""}`}
                            </button>
                          )}
                        </div>
                      </div>
                      {requiresSplitApproval && (
                        <div style={warningStyle}>
                          This is one {Math.round(shot.end - shot.start)}-second creative shot. Agnes needs {segmentCount} connected render segments. Nothing will generate until you approve this technical split.
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 20 }}>
        <button type="button" className="btn primary" disabled={allCount === 0} onClick={onGenerateAll}>
          Generate All Approved{allCount ? ` (${allCount} requests)` : ""}
        </button>
        <button type="button" className="btn ghost" disabled={readyCount === 0 || activeCount > 0} onClick={onContinue}>
          Continue to Lip Sync / Final
        </button>
      </div>
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div style={{ marginTop: 6, fontSize: 12, opacity: 0.76 }}><strong>{label}:</strong> {value}</div>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div style={{ padding: 12, borderRadius: 10, background: "rgba(255,255,255,.045)", border: "1px solid rgba(255,255,255,.08)" }}><div style={{ fontSize: 11, opacity: 0.55 }}>{label}</div><div style={{ marginTop: 4, fontSize: 20, fontWeight: 700 }}>{value}</div></div>;
}

function formatTime(value: number): string {
  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

const helpStyle: CSSProperties = { margin: "7px 0 0", opacity: 0.62, lineHeight: 1.5 };
const summaryStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, marginTop: 18 };
const sectionStyle: CSSProperties = { padding: 14, borderRadius: 12, border: "1px solid rgba(255,255,255,.12)", background: "rgba(255,255,255,.025)" };
const shotStyle: CSSProperties = { padding: 13, borderRadius: 10, border: "1px solid rgba(255,255,255,.09)", background: "#111114" };
const mutedStyle: CSSProperties = { fontSize: 12, opacity: 0.58, marginTop: 4 };
const warningStyle: CSSProperties = { marginTop: 10, padding: 10, borderRadius: 8, background: "rgba(245,158,11,.1)", border: "1px solid rgba(245,158,11,.28)", color: "#fcd34d", fontSize: 12, lineHeight: 1.4 };
