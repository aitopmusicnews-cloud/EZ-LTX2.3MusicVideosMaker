# Director Asset Chat + Multi-Character Approval Design

Date: 2026-09-02
Branch: `feature/director-asset-chat-multichar`
Production base: `f517576c54dceac641d0b9a46a49c656e7d2d626`

## Goal

Make the active left-rail Director easier to edit in place:

1. Put a small edit-chat box directly under every Director scene image, shot image, and production clip/video item.
2. Let a project approve more than one character reference.
3. Let each scene/shot/clip choose one or more approved characters.
4. Preserve the existing Vision-first rules, user-controlled clip count, exact timing, explicit generation controls, and credit-protected approval flow.
5. Keep editing usable when Gemini is quota-limited by using the existing quota-safe Director chat fallback.

## User Experience

### Project Character Approval

The Director character section will show all ready `character` references as separate character cards. Each character can be independently approved or unapproved.

The project may have zero, one, or many approved characters. When the project requires characters, production stays locked until at least one character is approved.

Old projects that used the single `characterApproved` boolean are migrated automatically. If the old session had an approved character, the current legacy character reference is inserted into the new approved-character list.

### Character Selection Per Asset

Each shot/scene card gets a compact multi-select row of approved character chips. The user can select one or more characters for that asset.

Selections are stored by reference ID, not by image URL, so replacing or rehosting an image does not lose character identity.

For legacy plans, the old single `conditioningReferenceId` becomes the initial one-item selection. Existing projects remain valid.

### Edit Chat Under Images and Clips

Every Director asset card receives a compact `AssetEditChat` control directly underneath the asset:

- Scene image: chat is locked to that scene/clip ID.
- Shot image: chat is locked to that shot/clip ID.
- Production clip/video: chat is locked to that clip ID.

Because the target is already known from the card, the user can type natural edits such as:

- `make the lighting warmer`
- `put both approved characters in frame`
- `make this a low-angle orbit`
- `regenerate this clip`

The user does not need to type `clip 4` or copy IDs.

Chat may update the Director prompt or propose an image edit, but it must not silently change clip timing, clip count, or unrelated assets.

Provider-generating actions remain explicit. Sending an edit message does not itself spend image/video credits unless the user explicitly presses the existing generation/regeneration action for that asset. If the user says `regenerate`, the UI marks the asset as needing regeneration and presents the explicit regenerate control rather than auto-enqueueing provider work.

## Multi-Character Generation Strategy

### Why not send multiple raw character images directly to Agnes

The current video generation path is built around one video seed/conditioning image. Changing that provider contract would be a larger and riskier provider integration change.

### Approved multi-character shot image as the video seed

The Director will combine selected character references at the image-approval stage instead:

1. The user approves multiple character references for the project.
2. A scene/shot selects one or more approved characters.
3. Director image generation sends all selected character images through the image model's `referenceImages` array.
4. The user approves the resulting shot image containing the required characters.
5. That approved shot image becomes the `seedImageUrl` / archetype for the corresponding Agnes video clip.

This preserves the current Agnes single-seed contract while allowing duets, groups, and multiple recurring characters in the actual clip.

Production is already approval-gated on shot images, so using the approved shot image as the preferred seed fits the existing flow.

## Data Model Changes

### Agent session

Replace:

```ts
characterApproved: boolean
```

with:

```ts
approvedCharacterIds: string[]
characterSelections: Record<string, string[]>
```

`characterSelections[clipId]` contains zero or more approved character reference IDs for that shot/scene/clip.

Bump the active Director session version and migrate old saved sessions.

### Shot plan compatibility

Keep the existing plan field:

```ts
conditioningReferenceId: string | null
```

for API/backward compatibility.

The UI derives a default multi-character selection as:

```ts
characterSelections[clipId] ??
  (conditioningReferenceId ? [conditioningReferenceId] : [])
```

This avoids requiring a breaking Gemini plan-response schema migration for the first multi-character release.

### Chat target

Extend the Director chat request with an optional target:

```ts
target?: {
  type: "scene_image" | "shot_image" | "clip";
  clipId: string;
}
```

The server validates the target clip ID against the supplied plan.

When `target` is present, Gemini and local fallback are instructed to operate only on that target unless the user explicitly names additional assets through the global Director chat.

## Frontend Components

### `AssetEditChat`

A small reusable component with:

- one-line or compact multiline input;
- Send button;
- local busy/error state;
- last Director reply;
- no automatic generation side effect.

Props include target type, clip ID, current plan, references, approval-image maps, and action callbacks.

### Active Director integration

`LtxDirectorAgent.tsx` will use `AssetEditChat` beneath:

- scene approval images;
- shot approval images;
- clip/video production items.

The existing global Director chat remains available for broader multi-asset edits.

### Character controls

Add:

- project-level approve/unapprove toggles on character references;
- per-asset approved-character chips;
- clear visual indication when an asset selects multiple characters.

## Image Editing Behavior

Image generation/editing will accept `referenceUrls: string[]` instead of only one optional reference URL.

For a targeted image edit:

- the current approved/generated image is the first preservation reference;
- selected approved character images are additional identity references;
- the edit prompt explicitly says to preserve untargeted composition/identity details;
- the new image replaces the pending approval image and resets that asset's `approved` flag to `false`;
- no other asset is changed.

## Clip Editing Behavior

A targeted clip chat may:

- update the clip's creative prompt;
- update continuity notes or transition text;
- mark explicit regeneration intent.

It may not:

- alter `start` or `end`;
- change the project clip amount;
- enqueue generation automatically;
- reset ready media unless the user explicitly chooses Regenerate.

For production generation, the approved shot image is preferred as the clip seed. If the shot requires characters and no approved shot image exists, production remains blocked rather than silently falling back to a weaker character-only seed.

## Gemini Quota / Local Fallback Behavior

The current quota-safe chat backend stays in place:

1. configured Gemini Director model;
2. supported Gemini fallback model;
3. deterministic local Director chat fallback.

For asset-level chat, local fallback receives the card's target directly, so a message like `make it darker` can safely update that one asset without requiring the user to name a clip number.

Local fallback must never invent a target, change timing, or edit unrelated clips.

## Approval and Credit Safety

- Character approval is free state change.
- Character selection is free state change.
- Chat prompt editing is free state change.
- Image generation/editing remains an explicit provider action.
- Video generation/regeneration remains an explicit provider action.
- Completed media remains locked until explicit regeneration/replacement.

## Migration

On session load:

- missing `approvedCharacterIds` becomes `[]`;
- legacy `characterApproved: true` migrates the currently selected character/reference into `approvedCharacterIds` when resolvable;
- missing `characterSelections` becomes `{}`;
- each legacy `conditioningReferenceId` remains valid and supplies the default one-character selection;
- existing scene/shot approvals are preserved.

No timeline clips or ready media are regenerated during migration.

## Testing

Add fail-first regressions covering:

1. Multiple character references can be independently approved.
2. A shot can select two or more approved characters.
3. Legacy single-character session state migrates without losing approval.
4. Multi-character image generation passes all selected character URLs as reference images.
5. Approved multi-character shot image becomes the production video seed.
6. Asset chat sends a locked target (`scene_image`, `shot_image`, or `clip`).
7. Local quota fallback can edit a targeted asset even when the message does not contain a clip number.
8. Asset chat cannot change start/end timing.
9. Sending chat does not automatically enqueue image/video generation.
10. Editing an approved image resets only that image's approval state.
11. Existing Vision-first, editable clip-count, explicit generation, and Gemini/local fallback regressions remain green.
12. Full workspace build passes.

## Out of Scope for This Release

- Changing Agnes to accept multiple independent raw character seed images in one video request.
- Automatic face/identity tracking across provider generations beyond the approved multi-character seed image.
- Replacing the existing References library.
- Letting chat alter timeline timing or clip count.
- Automatic regeneration after a chat edit.

## Success Criteria

The feature is complete when a user can:

1. upload/reference at least two characters;
2. approve both for the project;
3. select both on one shot;
4. generate and approve a shot image containing both characters;
5. use that approved image to seed the clip;
6. type an edit directly under that image or clip without identifying the clip number;
7. keep editing through Gemini quota exhaustion using local fallback;
8. never have timing, clip count, or completed media changed automatically.
