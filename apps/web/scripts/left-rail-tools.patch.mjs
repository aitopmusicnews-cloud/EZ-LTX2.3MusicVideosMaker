export function patchLeftRailTools(source, replaceRequired) {
  if (source.includes('mvs-open-ltx-director') && source.includes('mvs-open-promo-cut')) return source;

  const referenceSection = `      <div className="section">\n        <div className="section-header">\n          <span className="label">Reference images</span>`;
  const toolsSection = `      {analysis && (\n        <div className="section">\n          <div className="section-header">\n            <span className="label">Tools</span>\n          </div>\n          <div style={{ display: "grid", gap: 8 }}>\n            <button type="button" className="btn ghost w-full" onClick={() => window.dispatchEvent(new CustomEvent("mvs-open-ltx-director"))}>✦ Director</button>\n            <button type="button" className="btn ghost w-full" onClick={() => window.dispatchEvent(new CustomEvent("mvs-open-reference-chat"))}>＋ References</button>\n            <button type="button" className="btn ghost w-full" onClick={() => window.dispatchEvent(new CustomEvent("mvs-open-promo-cut"))}>✂ Promo Cut</button>\n          </div>\n          <div className="rail-help">Open creative tools here without covering the timeline.</div>\n        </div>\n      )}\n\n${referenceSection}`;

  return replaceRequired(source, referenceSection, toolsSection, "left-rail Director tools");
}

export function patchDirectorLeftRailLauncher(source, replaceRequired) {
  let patched = source;
  if (!patched.includes('mvs-open-ltx-director')) {
    const effectAnchor = `  useEffect(() => { const onReference = (event: Event) => { const detail = (event as CustomEvent<DirectorReferenceDetail>).detail; if (detail?.kind === "character" && detail.url) setCharacter(detail.url); setReferenceRevision((value) => value + 1); setOpen(true); }; window.addEventListener(REFERENCE_EVENT, onReference as EventListener); return () => window.removeEventListener(REFERENCE_EVENT, onReference as EventListener); }, [setCharacter]);`;
    const effectWithLauncher = `${effectAnchor}\n  useEffect(() => { const openDirector = () => setOpen(true); window.addEventListener("mvs-open-ltx-director", openDirector); return () => window.removeEventListener("mvs-open-ltx-director", openDirector); }, []);`;
    patched = replaceRequired(patched, effectAnchor, effectWithLauncher, "left-rail Director open event");
  }

  const floatingLauncher = `  if (!open) return <button type="button" style={launcherStyle} onClick={() => setOpen(true)}>✦ LTX Director Agent{clipProgress.active > 0 && <span style={activeDotStyle} />}</button>;`;
  if (patched.includes(floatingLauncher)) {
    patched = patched.replace(floatingLauncher, `  if (!open) return null;`);
  } else if (!patched.includes(`if (!open) return null;`)) {
    throw new Error("Could not remove the floating Director launcher.");
  }
  return patched;
}

export function patchReferenceLeftRailLauncher(source) {
  if (!source.includes('mvs-open-reference-chat')) {
    throw new Error("Reference Chat is missing its left-rail open event listener.");
  }
  const floatingLauncher = `  if (!open) {\n    return (\n      <button type="button" style={launcherStyle} onClick={() => setOpen(true)}>\n        ＋ References\n        {uploading && <span style={activityDotStyle} aria-label="Reference processing active" />}\n        {items.length > 0 && <span style={countStyle}>{items.length}</span>}\n      </button>\n    );\n  }`;
  if (source.includes(floatingLauncher)) return source.replace(floatingLauncher, `  if (!open) return null;`);
  if (source.includes(`if (!open) return null;`)) return source;
  throw new Error("Could not remove the floating References launcher.");
}

export function patchPromoLeftRailLauncher(source, replaceRequired) {
  let patched = source;
  if (!patched.includes('mvs-open-promo-cut')) {
    const stateEffect = `  useEffect(() => {\n    setPromoMeta(readPromoMeta(songId));\n    setStart(0);\n    setEnd(duration);\n    setPreviewing(false);\n    setProgress(null);\n  }, [songId, duration]);`;
    const stateWithLauncher = `${stateEffect}\n\n  useEffect(() => {\n    const openPromo = () => setOpen(true);\n    window.addEventListener("mvs-open-promo-cut", openPromo);\n    return () => window.removeEventListener("mvs-open-promo-cut", openPromo);\n  }, []);`;
    patched = replaceRequired(patched, stateEffect, stateWithLauncher, "left-rail Promo open event");
  }

  const floatingLauncher = `    <>\n      <button type="button" style={launcherStyle} onClick={() => setOpen(true)}>\n        ✂ {promoMeta ? "Promo active" : "Promo Cut"}\n      </button>\n\n      {open && (`;
  const leftRailOnly = `    <>\n      {open && (`;
  if (patched.includes(floatingLauncher)) patched = patched.replace(floatingLauncher, leftRailOnly);
  else if (!patched.includes(leftRailOnly)) throw new Error("Could not remove the floating Promo launcher.");
  return patched;
}
