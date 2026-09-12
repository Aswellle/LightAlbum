# CODE QUALITY REVIEW — V2 Architecture Refactoring

```
════════════════════════════════════════════════════════════
Mode: diff
Scope: V2 architecture refactoring (bd43b27..HEAD)
Files changed: 36    Insertions: +3776    Deletions: -585
════════════════════════════════════════════════════════════
```

## Summary

The V2 architecture refactoring introduces a clean layered design (domain/data/features/stores) with strong backward-compatibility facades. The overall architecture is sound — normalized entity store, collection views, and separation of concerns are well-designed. However, the implementation contains **several correctness bugs**, two of which are release-blocking: the waterfall layout maps photoIds incorrectly (wrong photos render), and the `photo:updated` event handler is a no-op (real-time updates silently dropped). These gaps need fixing before this can be considered production-ready.

---

## Critical Findings (P0)

### [P0] (confidence: 10/10) src/features/library/hooks/useWaterfallLayout.ts:110-120 — Waterfall layout maps photoId via Object.keys(byId) index, completely wrong

The `recompute()` function maps layout indices back to photoIds using `Object.keys(byId)[raw.index]`. This is fundamentally broken: `Object.keys()` on the entity store returns keys in insertion order, which does NOT correspond to the `orderedIds` array order used to build the layout. The result is that waterfall cells receive wrong photoIds (or empty strings), causing incorrect photos to render or nothing at all. The filter on the line above also fails because spatialIndex always sets photoId to `''`, making `byId[raw.photoId]` always undefined.

**Suggestion:** Replace `Object.keys(byId)[raw.index]` with `orderedIds[raw.index]`, since the layout was built from `orderedIds` and `raw.index` is the position in that array.

---

### [P0] (confidence: 10/10) src/data/events/eventRouter.ts:68-80 — photo:updated handler patches entity store with empty object, no-op

In `onPhotoUpdated()`, the code calls `usePhotoEntityStore.getState().patch(payload.photoId, {})` with an empty patch object. The `payload.fields` array (which lists which fields changed) is completely ignored, so the entity store is never actually updated when a `photo:updated` event arrives. The subsequent `setQueryData` just shallow-copies the old query data without changes.

**Suggestion:** Build a partial entity from `payload.fields` and `payload` values, then call `patch(payload.photoId, actualChangedFields)`.

---

## Important Findings (P1)

### [P1] (confidence: 10/10) src/services/thumbnail/ThumbnailScheduler.ts:212-228 — promoteExisting() never promotes, priority update silently dropped

`promoteExisting()` sets `task.priority = newPriority` on line 219 BEFORE computing `oldBucket` and `newBucket` on lines 220-221. Since both `bucketFor()` calls now see the updated priority, `oldBucket === newBucket` is always true, and the `if (oldBucket !== newBucket)` branch on line 222 never executes. Priority promotion (e.g., low → high when item scrolls into view) is completely broken.

**Suggestion:** Capture `oldBucket = bucketFor(task.priority)` BEFORE mutating `task.priority`, then compute `newBucket` after the mutation.

---

### [P1] (confidence: 9/10) src/stores/collectionStore.ts:194-305 — Module-level mutable entityLookupCache shared across all collections

`collectionStore.ts` declares `let entityLookupCache: Record<string, PhotoEntity> = {}` at module scope (line 194). This single object is shared across ALL collections and is never cleared when individual collections are cleared or removed. Entities from different collections (e.g., an album vs. all-photos view) can overwrite each other.

**Suggestion:** Convert the cache to a `Map<string, Record<string, PhotoEntity>>` keyed by collection key, and clear the entry when a collection is destroyed.

---

### [P1] (confidence: 9/10) src/features/library/grid/WaterfallGridV2.tsx:43-47 — Reads photoIds from global entity store, not the collection

`WaterfallGridV2.tsx` line 45 calls `usePhotoEntityStore((s) => Object.keys(s.byId))` to get photoIds for keyboard navigation and selection. This returns ALL entity IDs across the entire application, not just the current collection's IDs.

**Suggestion:** Use `useCollectionStore((s) => s.collections[collectionKey]?.orderedIds)` to get collection-scoped IDs.

---

### [P1] (confidence: 8/10) src/stores/photoStore.ts:184-215 — Facade re-derives entire photos/groups on every entity change

`photoStore.ts` sets up a module-level subscription `usePhotoEntityStore.subscribe(() => syncFromSource())` that runs on EVERY entity store change, even for entities not in the active collection. Additionally, each write method (`setPhotos`, `appendPhotos`, `updatePhoto`, `removePhotos`) explicitly calls `syncFromSource()` after mutating the underlying stores — which themselves trigger the subscription. A single `updatePhoto()` call triggers `syncFromSource()` at least twice, each doing O(N) array derivation.

**Suggestion:** Use a single write-side `syncFromSource()` call with debouncing, or derive lazily via selectors instead of storing derived `photos[]` and `groups[]` in state.

---

## Minor Findings (P2)

### [P2] (confidence: 8/10) src/data/events/eventRouter.ts:12-28 — Module-level mutable singletons for seq and revision

`eventRouter.ts` declares `let globalSeq = 0` and `let latestRevision = 0` at module scope. These are never reset and persist for the application lifetime. If the router singleton is ever recreated (e.g., during HMR or testing), the instance-level `this.seq` resets to 0 but `latestRevision` retains its old value.

**Suggestion:** Move `latestRevision` into the class instance alongside `this.seq`, and reset both in the constructor or a `reset()` method.

---

### [P2] (confidence: 7/10) src/stores/photoStore.ts:222-228 — selectPhotoById uses _photoIndex without bounds checking

`photoStore.ts` `selectPhotoById()` looks up the index from `_photoIndex` map and returns `s.photos[idx]`. If the photos array has been modified but the index map is momentarily stale, this returns the wrong photo or undefined. There is no bounds check and no verification that `s.photos[idx]?.id === id`.

**Suggestion:** Add `if (idx >= 0 && idx < s.photos.length && s.photos[idx]?.id === id)` guard.

---

### [P2] (confidence: 9/10) src/features/library/layout/layout.worker.ts:115-120 — Layout worker ignores orientation when computing aspect ratio

`layout.worker.ts` line 117 computes aspect ratio as `entity.width / entity.height` without checking orientation. The main-thread `waterfallLayout.ts` uses `getDisplayAspectRatio()` which correctly swaps width/height for orientations 5-8. This inconsistency means the worker produces wrong item heights for rotated photos.

**Suggestion:** Import and use `getDisplayAspectRatio()` from `photoTypes.ts` in the worker, or duplicate the orientation-swap logic.

---

### [P2] (confidence: 8/10) src/features/library/hooks/useWaterfallLayout.ts:96-142 — forceUpdate does not trigger visible item recompute

In `useWaterfallLayout.ts`, the layout rebuild effect calls `forceUpdate((n) => n + 1)` on line 100 to trigger a re-render after layout state changes. However, the `recompute()` function lives in a separate `useEffect` with `[recompute]` as dependency (line 140-142). Since `recompute` is wrapped in `useCallback` with `[]` deps, it never changes, so the recompute effect never re-runs after a layout rebuild.

**Suggestion:** Call `recompute()` directly inside the layout effect after building the layout state, instead of relying on `forceUpdate` to trigger a separate effect.

---

### [P2] (confidence: 7/10) src/features/library/hooks/usePhotoCollection.ts:95-120 — Cached multi-page data triggers full replace (race condition)

`usePhotoCollection.ts` uses `prevPageCountRef` to detect whether to do `replaceFirstPage` vs `appendPage`. When a collection's data is already cached, `data.pages` may contain multiple pages but `prevPageCountRef.current` is 0, causing the code to call `replaceFirstPage` with only the first page's data. This discards the cached subsequent pages.

**Suggestion:** Check if `data.pages.length > 1` and all pages are present before deciding to replace; if so, append all pages instead.

---

## Minor Findings (P3-P4)

### [P3] (confidence: 6/10) src/domain/photo/photoTypes.ts:115-121 — Magic numbers for EXIF orientation range without named constants

`getDisplayAspectRatio()` uses `entity.orientation >= 5 && entity.orientation <= 8` to detect rotated orientations. These magic numbers (5=rotate90CW, 6=rotate270CW, 7=rotate90CCW, 8=rotate270CCW per EXIF spec) are not extracted into named constants.

**Suggestion:** Define `const EXIF_ROTATED_ORIENTATIONS = [5, 6, 7, 8]` or an enum, and use `.includes(entity.orientation)`.

---

### [P3] (confidence: 8/10) src/features/library/grid/WaterfallGridV2.tsx:105-165 — No loading or empty state

Unlike `VirtualPhotoGrid` (which has `GridSkeleton` and `EmptyState` components), `WaterfallGridV2` renders nothing when the collection is empty or loading. Users see a blank screen with no feedback.

**Suggestion:** Add `GridSkeleton` and `EmptyState` components matching the fixed grid implementation.

---

## Strengths

1. **Clean layered architecture** — domain / data / features / stores separation is well-structured and follows modern React patterns
2. **Backward compatibility** — `photoStore` facade allows old components to work transparently; migration can be incremental
3. **Normalized entity store** — `byId` + `orderedIds` pattern is correct in principle, enabling O(1) entity access
4. **Typed array layout** — `Float32Array`/`Float64Array` for waterfall layout data shows attention to memory efficiency
5. **Binary search indexing** — spatial index for waterfall and section index for fixed grid are well-implemented algorithms
6. **Sharp sidecar isolation** — HEIC/RAW decoding in a separate process prevents main thread blocking
7. **Event envelope with seq** — revision tracking and ordering for backend events is a solid design
8. **Deque with head pointer** — O(1) dequeue in ThumbnailScheduler shows awareness of performance fundamentals

---

## Metrics

- Categories reviewed: 8
- Total findings: 12
- P0: 2  P1: 4  P2: 5  P3: 2  P4: 0
- Prior learnings applied: 0

---

## Recommended Actions

### Must fix before release (P0)

1. **Fix waterfall photoId mapping** in `useWaterfallLayout.ts:110-120` — use `orderedIds[index]` instead of `Object.keys(byId)[index]`
2. **Fix photo:updated handler** in `eventRouter.ts:68-80` — build actual patch from `payload.fields` instead of empty `{}`

### Should fix soon (P1)

3. **Fix priority promotion** in `ThumbnailScheduler.ts:212-228` — capture old bucket before mutation
4. **Isolate entityLookupCache per collection** in `collectionStore.ts:194` — use `Map<key, cache>` instead of module-level object
5. **Scope WaterfallGridV2 photoIds to collection** in `WaterfallGridV2.tsx:43-47` — use collection orderedIds
6. **Reduce syncFromSource triggers** in `photoStore.ts:184-215` — debounce or derive lazily

### Nice to have (P2-P3)

7. Move module-level singletons into EventRouter class
8. Add bounds checking in selectPhotoById
9. Unify aspect ratio calculation between worker and main thread
10. Call recompute() directly after layout rebuild
11. Handle multi-page cached data in usePhotoCollection
12. Extract EXIF orientation constants
13. Add loading/empty states to WaterfallGridV2

---

```
════════════════════════════════════════════════════════════
Review completed: 2026-09-12
Reviewed by: /code-quality skill (V2CodeQualityReview agent)
════════════════════════════════════════════════════════════
```
