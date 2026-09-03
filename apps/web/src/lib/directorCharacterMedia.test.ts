import test from "node:test";
import assert from "node:assert/strict";
import * as characterMedia from "./directorCharacterMedia.js";

const { buildApprovalReferenceImages, chooseApprovedShotSeed, resolveCharacterReferenceUrls } = characterMedia;

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

test("two selected people retain separate named identity bindings for the image prompt", () => {
  const resolveCharacterIdentities = (characterMedia as any).resolveCharacterIdentities;
  const buildCharacterIdentityInstruction = (characterMedia as any).buildCharacterIdentityInstruction;
  assert.equal(typeof resolveCharacterIdentities, "function", "resolveCharacterIdentities must exist");
  assert.equal(typeof buildCharacterIdentityInstruction, "function", "buildCharacterIdentityInstruction must exist");

  const identities = resolveCharacterIdentities(
    ["char-one", "char-two"],
    [
      { id: "char-one", name: "Character One", anchorUrl: "/one.png" },
      { id: "char-two", name: "Character Two", anchorUrl: "/two.png" },
    ],
    null,
  );
  assert.deepEqual(identities, [
    { id: "char-one", name: "Character One", url: "/one.png" },
    { id: "char-two", name: "Character Two", url: "/two.png" },
  ]);

  const instruction = buildCharacterIdentityInstruction(identities, ["/one.png", "/two.png"]);
  assert.match(instruction, /Reference image 1.*Character One/i);
  assert.match(instruction, /Reference image 2.*Character Two/i);
  assert.match(instruction, /two distinct people/i);
  assert.match(instruction, /do not.*duplicate|never.*duplicate/i);
});

test("a real named character replaces the store-character alias when both point to the same image", () => {
  const resolveCharacterIdentities = (characterMedia as any).resolveCharacterIdentities;
  assert.equal(typeof resolveCharacterIdentities, "function", "resolveCharacterIdentities must exist");
  assert.deepEqual(
    resolveCharacterIdentities(
      ["store-character", "char-two"],
      [{ id: "char-two", name: "Character Two", anchorUrl: "/two.png" }],
      "/two.png",
    ),
    [{ id: "char-two", name: "Character Two", url: "/two.png" }],
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
