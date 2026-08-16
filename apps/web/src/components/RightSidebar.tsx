import { useEffect, useState } from "react";
import { useStore } from "../lib/store.js";
import { Sidebar } from "./Sidebar.js";
import { SidebarEmpty } from "./SidebarEmpty.js";
import { Library } from "./Library.js";

type Tab = "video" | "library";

export function RightSidebar() {
  const selectedId = useStore((s) => s.selectedClipId);
  const clips = useStore((s) => s.clips);
  const selectedClip = clips.find((clip) => clip.id === selectedId);
  const [tab, setTab] = useState<Tab>("video");

  useEffect(() => {
    if (selectedId) setTab("video");
  }, [selectedId]);

  const isEmpty = tab === "video" && !selectedClip;

  return (
    <aside className={`right${isEmpty ? " empty" : ""}`}>
      <div className="sidebar-tabs">
        <button
          type="button"
          className={`sidebar-tab${tab === "video" ? " active" : ""}`}
          onClick={() => setTab("video")}
        >
          Agnes Video
        </button>
        <button
          type="button"
          className={`sidebar-tab${tab === "library" ? " active" : ""}`}
          onClick={() => setTab("library")}
        >
          Library
        </button>
      </div>

      <div className="sidebar-scroll">
        {tab === "library" ? <Library /> : selectedClip ? <Sidebar /> : <SidebarEmpty />}
      </div>
    </aside>
  );
}
