import test from "node:test";
import assert from "node:assert/strict";
import { buildApprovalReferenceImages, chooseApprovedShotSeed, resolveCharacterReferenceUrls } from "./directorCharacterMedia.js";

test("selected approved character IDs resolve to every usable identity image", () => {
  assert.deepEqual(
    resolveCharacterReferenceUrls(
      ["char-a", "char-b"],
      [{ id: "char-a", anchorUrl: "/a.png" }, { id: "char-b", anchorUrl: "/b.png" }],
      null,
    ),
    ["/a.png", "/b.png"],
  );
});

test("store-character resolves from the project character URL and duplicate URLs are removed", () => {
  assert.deepEqual(
    resolveCharacterReferenceUrls(
      ["store-character", "char-a", "char-a"],
      [{ id: "char-a", anchorUrl: "/same.png" }],
      "/same.png",
    ),
    ["/same.png"],
  );
});

test("approval image references keep the current image first and then character identities", () => {
  assert.deepEqual(
    buildApprovalReferenceImages("/current.png", ["/a.png", "/b.png", "/a.png"]),
    [{ uri: "/current.png" }, { uri: "/a.png" }, { uri: "/b.png" }],
  );
});

test("only an approved shot image is eligible as the Agnes seed", () => {
  assert.equal(chooseApprovedShotSeed({ url: "/shot.png", approved: true }), "/shot.png");
  assert.equal(chooseApprovedShotSeed({ url: "/shot.png", approved: false }), undefined);
  assert.equal(chooseApprovedShotSeed(undefined), undefined);
});
