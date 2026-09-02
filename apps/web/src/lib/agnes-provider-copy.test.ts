import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const files = [
  "../components/LeftRail.tsx",
  "../components/RightSidebar.tsx",
  "../components/Timeline.tsx",
  "../components/Sidebar.tsx",
  "../components/SidebarEmpty.tsx",
  "../components/VideoPreview.tsx",
  "../components/LtxDirectorAgent.tsx",
  "../components/AutoDirector.tsx",
  "./scheduler.ts",
];

test("existing screens identify Agnes without displaying obsolete provider infrastructure", async () => {
  const sources = await Promise.all(files.map((file) => readFile(new URL(file, import.meta.url), "utf8")));
  const combined = sources.join("\n");
  assert.doesNotMatch(combined, /LTX-2\.3|Modal GPU|Modal callback/);
  assert.match(combined, /Agnes/);
});
