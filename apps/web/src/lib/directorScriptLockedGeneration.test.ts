import assert from "node:assert/strict";
import test from "node:test";

import { buildAgnesGenerationInstruction } from "./directorScriptLockedGeneration.js";


test("compiled shot stays first and legacy filler is absent", () => {
  const prompt = buildAgnesGenerationInstruction({
    agnesPrompt: "Character 1 walks from the white piano to the window while the camera tracks right.",
    continuityConstraints: ["Match Character 1 exactly: same complexion and red suit."],
  });

  assert.match(prompt, /^Character 1 walks/);
  assert.match(prompt, /same complexion and red suit/i);
  assert.doesNotMatch(prompt, /cinematic scene board|visual style|color palette|masterful composition/i);
});
