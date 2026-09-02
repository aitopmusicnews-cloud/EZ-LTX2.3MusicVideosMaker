import type { CSSProperties } from "react";

export type CharacterOption = {
  id: string;
  name: string;
  url?: string;
};

export function DirectorCharacterApproval({ characters, approvedIds, onToggle }: {
  characters: CharacterOption[];
  approvedIds: string[];
  onToggle: (id: string) => void;
}) {
  if (!characters.length) return <div style={emptyStyle}>No ready character references yet. Add them in References when a shot needs character continuity.</div>;
  return <div style={gridStyle}>
    {characters.map((character) => {
      const approved = approvedIds.includes(character.id);
      return <article key={character.id} style={{ ...cardStyle, borderColor: approved ? "rgba(34,197,94,.55)" : "rgba(255,255,255,.12)" }}>
        {character.url ? <img src={character.url} alt={character.name} style={imageStyle} /> : <div style={imagePlaceholderStyle}>Character</div>}
        <div style={bodyStyle}>
          <strong>{character.name}</strong>
          <small style={smallStyle}>{approved ? "Approved for this project" : "Not approved"}</small>
          <button type="button" className={approved ? "btn" : "btn primary"} onClick={() => onToggle(character.id)}>{approved ? "Unapprove" : "Approve character"}</button>
        </div>
      </article>;
    })}
  </div>;
}

export function DirectorCharacterPicker({ label = "Characters in this asset", characters, approvedIds, selectedIds, onChange, disabled = false }: {
  label?: string;
  characters: CharacterOption[];
  approvedIds: string[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const available = characters.filter((character) => approvedIds.includes(character.id));
  const toggle = (id: string) => {
    if (disabled) return;
    onChange(selectedIds.includes(id) ? selectedIds.filter((value) => value !== id) : [...selectedIds, id]);
  };
  return <div style={pickerStyle}>
    <strong style={pickerLabelStyle}>{label}</strong>
    {available.length ? <div style={chipsStyle}>{available.map((character) => {
      const selected = selectedIds.includes(character.id);
      return <button key={character.id} type="button" className={selected ? "btn primary" : "btn ghost"} disabled={disabled} onClick={() => toggle(character.id)} aria-pressed={selected}>{selected ? "✓ " : ""}{character.name}</button>;
    })}</div> : <div style={emptyInlineStyle}>Approve a character above to make it selectable here.</div>}
  </div>;
}

const gridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 10, marginTop: 12 };
const cardStyle: CSSProperties = { display: "flex", gap: 10, alignItems: "center", padding: 10, border: "1px solid rgba(255,255,255,.12)", borderRadius: 11, background: "rgba(255,255,255,.025)" };
const imageStyle: CSSProperties = { width: 72, height: 72, objectFit: "cover", borderRadius: 9, background: "#111" };
const imagePlaceholderStyle: CSSProperties = { width: 72, height: 72, display: "grid", placeItems: "center", borderRadius: 9, background: "#18181b", color: "#71717a", fontSize: 10 };
const bodyStyle: CSSProperties = { minWidth: 0, display: "grid", gap: 7, alignItems: "start" };
const smallStyle: CSSProperties = { color: "#a1a1aa", fontSize: 10 };
const emptyStyle: CSSProperties = { marginTop: 12, padding: 11, borderRadius: 9, border: "1px dashed rgba(255,255,255,.12)", color: "#a1a1aa", fontSize: 11 };
const pickerStyle: CSSProperties = { marginTop: 10, padding: 9, borderRadius: 9, background: "rgba(59,130,246,.045)", border: "1px solid rgba(59,130,246,.16)" };
const pickerLabelStyle: CSSProperties = { display: "block", marginBottom: 7, fontSize: 10, color: "#cbd5e1" };
const chipsStyle: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 6 };
const emptyInlineStyle: CSSProperties = { color: "#71717a", fontSize: 10 };
