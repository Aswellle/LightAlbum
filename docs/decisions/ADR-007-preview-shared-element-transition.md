# ADR-007: Preview fly-in / fly-out (shared-element transition from the grid)

**Status**: Accepted
**Date**: 2026-09-29

## Context

The large-image preview currently appears as a backdrop fade only: `PhotoPreview`'s root animates
opacity from `backdropVariants`, and the image mounts at its final fitted size. Tapping a grid cell
therefore has no spatial continuity — the photo "teleports" instead of growing out of the cell it
came from. `GridItem` / `WaterfallGrid` / `useKeyboard` used to measure the cell's `DOMRect` and hand
it to `previewStore.open()`, but nothing ever read it, so that plumbing was removed in v0.4.4 as dead
code. This ADR re-introduces the snapshot **because it is now actually consumed**.

Constraints discovered while designing this:

- **Virtualization**: the source cell can unmount while the flight is in progress (the grid scrolls
  or the view switches). Any implementation that keeps a live reference to the cell element is unsafe.
- **Animation policy** (`src/styles/animations.css`): animations must use `transform` / `opacity` only —
  animating `width` / `height` triggers layout and is forbidden.
- **Aspect mismatch**: fixed-grid cells are square, waterfall cells follow the photo's aspect, and the
  preview fits the photo inside the viewport. A single uniform scale can therefore never make the
  first frame pixel-identical to the source cell.
- **`previewStore.direction`** already distinguishes a fresh open (`0`) from next/prev (`±1`).
- `<MotionConfig reducedMotion="user">` is already mounted at the app root (`src/app/App.tsx`).
- Entries without a cell rect exist: the filmstrip (`goTo`) and (in future) deep links.

## Decision

1. **Snapshot geometry at open time.** `previewStore.open(photoId, photoIds, rect?)` stores the clicked
   cell's client rect as `sourceRect`. Every grid entry point passes it (GridItem click, double click,
   context-menu "在大图中查看", WaterfallGrid, `WaterfallGridV2`, `useKeyboard` Space-on-focused-cell).
   Entries without a rect (filmstrip `goTo`) leave it `null`.
2. **The flight is transform-only and uniform.** The preview image layer animates from
   `translate(dx, dy) scale(s)` to `translate(0,0) scale(1)`, where the start values map the *fitted*
   image box onto the source rect's size/centre. `width` / `height` are never animated.
3. **Only a fresh open flies.** The fly applies when `direction === 0` **and** `sourceRect` exists and
   the fitted box is measurable (container > 0). Next/prev keep the existing horizontal slide.
4. **No duplicate flying copy.** The flying element *is* the preview's own image layer, so the frame
   after the click can never show two copies of the photo (or a scrim-only frame).
5. **Exit reverses the flight** to the *snapshot* rect whenever `sourceRect` exists **and** the preview still
   shows the photo that was opened from the grid (`direction === 0`). No live DOM lookup happens: the
   snapshot is the single source of truth, so a recycled or scrolled-away cell can never make the photo
   fly to a wrong place. After navigating (direction ±1) the overlay simply fades — that photo did not
   come from a cell.
6. **Reduced motion is delegated** to `MotionConfig reducedMotion="user"`: transform animations are
   skipped and the preview degrades to the plain fade.
7. **Frame contract**: from the first painted frame after the click, the preview root must be visible
   and contain an image element. `tests/e2e/preview-animation.spec.ts` samples every frame and fails on
   a blank/absent image, and additionally asserts the first frames start *smaller* than the settled
   box (i.e. the flight actually happened).
8. **The flight must not depend on mount-time measurement.** The preview container is measured in the
   same commit that mounts the image layer, so the geometry is only known on the *second* render — and
   framer-motion reads `initial` exactly once, at mount. The animation therefore drives `animate` with
   explicit keyframe arrays (`x: [from, 0]`, `scale: [from, 1]`) as well, which always begin at the
   first value no matter when they appear.

## Consequences

- **Good**: the transition gains spatial continuity (cell → photo) using only transform/opacity; the
  geometry is snapshot-based, so virtualization cannot break it; the frame-level contract keeps the
  P0-2/P0-3 guarantees (no blank or scrim-only frames) enforceable in CI.
- **Bad**: `sourceRect` returns to the store — the field is back *because it is used*, not because the
  old API was kept (the old unused setters/selectors stay deleted).
- **Bad**: the first frame is not pixel-identical to the source cell (uniform scale preserves the
  photo's aspect). Pixel-exact cover matching needs a second flying layer with a crossfade; explicitly
  deferred.
- **Bad**: exit can silently degrade to a fade (cell recycled or scrolled away). This is intentional:
  a fly-back to a wrong rect is worse than no fly-back.
- **Enforcement**: `tests/e2e/preview-animation.spec.ts` (fly happened, no blank frames),
  `src/styles/animations.css` (transform/opacity policy), `MotionConfig` at the app root.
