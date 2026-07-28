export function patchDirectorAssetPersistence(source) {
  let patched = source;
  const detailType = `type DirectorReferenceDetail = {
  kind: ReferenceKind | "note";
  media: ReferenceMedia;
  name?: string;
  url?: string;
  sourceUrl?: string;
  note?: string;
};`;
  const detailTypeNext = `type DirectorReferenceDetail = {
  kind: ReferenceKind | "note";
  media: ReferenceMedia;
  name?: string;
  url?: string;
  sourceUrl?: string;
  anchorUrl?: string;
  note?: string;
};`;
  if (!patched.includes("anchorUrl?: string;\n  note?: string;\n};")) {
    if (!patched.includes(detailType)) throw new Error("Could not extend Director reference detail for saved assets.");
    patched = patched.replace(detailType, detailTypeNext);
  }

  const persistenceEffect = `  useEffect(() => {
    if (!songId) return;
    localStorage.setItem(storageKey(songId), JSON.stringify(items));
  }, [items, songId]);`;
  const assetEffect = `${persistenceEffect}

  useEffect(() => {
    const receiveSavedAsset = (event: Event) => {
      const detail = (event as CustomEvent<DirectorReferenceDetail>).detail;
      if (!detail || !detail.url) return;
      const anchorUrl = detail.anchorUrl ?? detail.url;
      const sourceUrl = detail.sourceUrl ?? detail.url;
      const item: ReferenceItem = {
        id: \`asset-\${crypto.randomUUID().slice(0, 8)}\`,
        kind: detail.kind === "note" ? "shot" : detail.kind,
        media: detail.media,
        name: detail.name || "Director asset",
        url: sourceUrl,
        anchorUrl,
        note: detail.note,
        status: detail.media === "note" ? undefined : "ready",
        progress: detail.media === "note" ? undefined : 100,
        createdAt: Date.now(),
      };
      setItems((current) => current.some((entry) => (entry.anchorUrl ?? entry.url) === anchorUrl) ? current : [...current, item]);
      dispatchReference({ kind: item.kind, media: item.media, name: item.name, url: anchorUrl, sourceUrl, note: item.note });
    };
    window.addEventListener("mvs-director-save-asset", receiveSavedAsset as EventListener);
    return () => window.removeEventListener("mvs-director-save-asset", receiveSavedAsset as EventListener);
  }, []);`;
  if (!patched.includes("mvs-director-save-asset")) {
    if (!patched.includes(persistenceEffect)) throw new Error("Could not find Director reference persistence effect.");
    patched = patched.replace(persistenceEffect, assetEffect);
  }
  return patched;
}
