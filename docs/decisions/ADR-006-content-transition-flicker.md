# ADR-006: Flicker-free content transitions (pre-paint swap, three-state grid, no per-view remount)

**Status**: Accepted
**Date**: 2026-09-27

## Context

Users reported that the content area flickers: switching sidebar tabs or filters briefly shows a **blank photo grid** or the **"没有照片" empty state** before the photos appear, and the app flashes an empty content area on startup. It reads as instability rather than as loading.

Measured causes (all of them painted at least one wrong frame):

| # | Cause | Painted symptom |
|---|---|---|
| 1 | `usePhotoQuery` cleared `photoStore` (`setPhotos([], 0)`) in a `useEffect` on every filter change, while `usePhotoData` refilled it in a *later* `useEffect` inside `startTransition` | empty store for 1+ frames → empty state, then photos |
| 2 | `useVirtualGrid` / `useWaterfallGrid` kept the visible slice in `useState` and filled it from a post-paint `useEffect` | data arrives → frame with `visibleRows = []` (blank grid) → next frame rows |
| 3 | `VirtualGrid` decided `isEmpty = photos.length === 0 && !isLoading`; pending state was indistinguishable from "this view is empty" | skeleton *and* empty state both transiently valid |
| 4 | `MainContent` wrapped each view in `AnimatePresence mode="wait"` + `motion.div key={viewKey}` with opacity fades | 120ms fade-out of a grid that was already empty, then 120ms fade-in of a remounted, re-measuring grid |
| 5 | `AppShell` measured the content width in a post-paint `useEffect`; `gridConfig` was `null` on the first paint and both grids return `null` | blank content area on startup |
| 6 | The tag view ran **two** writers for one store (`usePhotoQuery` wrote all photos, `useTagPhotoQuery` wrote tag photos) | filtered view briefly showed the unfiltered set |
| 7 | `GridItem` / `WaterfallItem` animated `motion.img` from `opacity: 0` on **every** mount | thumbnails strobe on virtualization recycle and remounts |
| 8 | `index.html` chose the theme from `prefers-color-scheme`; an explicitly saved theme was applied only after settings loaded | dark↔light jump at startup |

## Decision

1. **`photoStore` mirrors the current view, always — and the swap happens before paint.**
   `usePhotoData` / `useTagPhotoQuery` synchronise the store in `useLayoutEffect`, keyed by a serialised `viewKey`:
   - key changed + cached data → replace in one atomic write (same frame as the click);
   - key changed + no data → clear, and report `isSynced = false` so the renderer shows a skeleton, never the empty state;
   - first page of the current key → **pre-paint** replace; only *appended* pages (scrolling) use `startTransition`.
2. **`isSynced` is part of the render contract.** While it is `false` the store may still hold the previous view's photos; renderers must not show them.
3. **Three mutually exclusive grid states.** `hasContent = isSynced && photos.length > 0`; skeleton when `!hasContent && (isLoading || !isSynced)`; empty state only when `!hasContent && !isLoading && isSynced`. `data-grid-state` exposes the state for frame-level tests.
4. **Derive, don't backfill.** The virtual window is derived during render from a viewport measured in `useLayoutEffect` (+ `ResizeObserver`), so a dataset change repaints correctly in the same frame. `resetKey` (= `viewKey`) resets the scroll position on view change and the measurement effect depends on "the container is mounted" (`hasContainer`), because `config == null` means no container exists yet.
5. **The grid is not remounted per view.** `MainContent` keeps one stable subtree for all grid-backed views; no `key`, no exit/enter fade. View changes are content changes, not lifecycle changes.
6. **Because nothing remounts, invalidations must refetch.** The event router uses `refetchType: 'active'` for `scan:completed` / `photo:created` / `library:changed(added)`; relying on `refetchOnMount` would strand stale data behind a permanently mounted query.
7. **Refetch-in-flight is not synced.** An infinite-query refetch emits intermediate results with fewer pages; the store keeps the painted content until the fetch settles, then replaces it pre-paint (no shrink/grow wobble, no skeleton over existing photos).
8. **A cached thumbnail never fades in.** `motion.img` uses `initial={false}` when the URL existed at mount; the fade is reserved for the first appearance of a thumbnail.
9. **Theme before first paint.** The resolved theme is persisted to `localStorage('la-theme')` and read by the inline `index.html` script and by `uiStore`'s initial state, so the first painted frame already matches the user's choice.

## Consequences

- **Good**: cached view switching is a same-frame content swap; there is no path that paints an empty store, an empty slice, or an unmounted grid.
- **Good**: the invariants are executable — `tests/e2e/flicker.spec.ts` samples `data-grid-state` per animation frame and fails on any `empty` frame, any content frame without cells, or any skeleton/none frame during a cached switch.
- **Bad**: state synchronisation now depends on `useLayoutEffect` ordering. A future writer that mutates `photoStore` from a post-paint effect reintroduces flicker; new data sources must follow rule 1–3.
- **Bad**: view switches are instantaneous — there is no transition animation to soften genuinely slow loads. The skeleton (same geometry as the real grid) is the only loading affordance.
- **Enforcement**: `src/data/events/eventRouter.ts` and `src/hooks/usePhotoData.ts` encode the refetch and single-writer rules; `tests/e2e/flicker.spec.ts` fails any run that paints an intermediate frame (empty state, blank slice, or a skeleton over existing photos).
