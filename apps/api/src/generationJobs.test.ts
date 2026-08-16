import test from "node:test";
import assert from "node:assert/strict";

import { decodeTaskId, encodeTaskId } from "./generationJobs.ts";

test("task ids preserve Agnes and Modal sources separately", () => {
  for (const source of ["agnes", "modal"] as const) {
    const encoded = encodeTaskId({ source, id: `${source}-123` });
    assert.deepEqual(decodeTaskId(encoded), { source, id: `${source}-123` });
  }
});

test("legacy unencoded task ids remain Modal-compatible", () => {
  assert.deepEqual(decodeTaskId("legacy-job"), { source: "modal", id: "legacy-job" });
});
