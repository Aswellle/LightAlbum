# ADR-008: Preview backdrop compositing (blur vs. animated scrim) — deferred

**Status**: Accepted (decision: defer the change, keep the measurement method)
**Date**: 2026-09-29

## Context

ADR-007 added a fly-in to the preview. QA-perceived smoothness matters for that transition, and the
overlay paints a `backdrop-filter: blur(4px)` **on the same node that animates opacity** (the preview
root), which forces the compositor to re-apply the blur for every frame of the fade.

The open question was whether that cost is real and worth a structural change (splitting the blur onto a
static layer and animating a separate scrim). Measured with a throwaway Playwright probe
(`tests/e2e/_perf-probe.spec.ts`, rAF-only frame intervals, headless Chromium, dev server):

| Phase | frames | median | p95 | p99 | max | >20ms | >33ms |
|---|---|---|---|---|---|---|---|
| idle (baseline) | 60 | 16.6 ms | 18.1 | 18.7 | 18.7 | 0 | 0 |
| preview open (blur on) | 55 | 16.8 ms | 73.3 | 84.8 | 84.8 | 9 | **9** |
| preview close (blur on) | 36 | 16.9 ms | 70.9 | 85.4 | 85.4 | 5 | 4 |
| preview open (**blur off**, same animation) | 70 | 16.7 ms | **35.9** | 63.3 | 63.3 | 11 | **5** |

Reading: the idle timeline is a clean 60 fps, so the long frames are caused by the transition. Removing
the `backdrop-filter` roughly halves p95 (73.3 → 35.9 ms) and the count of ≥2-frame stalls (9 → 5).

## Decision

**Do not restructure the backdrop yet.** Two reasons:

1. **Attribution is partial.** With the blur disabled the animation still produces 5 frames > 33 ms, so a
   second cost exists (the fly's large-layer scaling plus the first decode/composite). Removing the blur
   alone would not make the transition clean, and shipping a structural change for half of the problem
   would not be justified by the data.
2. **The measurement environment exaggerates filter cost.** Headless Chromium composites in software;
   real machines run the blur on the GPU. The numbers are directional, not predictive.

The candidate fix is recorded for the follow-up: **render the scrim and the blur as separate layers, and
animate opacity only on the scrim** (`backdrop-filter` stays on a layer whose alpha does not change, so
the blurred backdrop is composited once instead of per frame). The complication to solve first is
`AnimatePresence`: the direct child must own an exit animation, and today that child is the blurred node —
so the split has to preserve presence semantics (e.g. animate the scrim inside the child and keep the
child's own exit imperceptible).

## Consequences

- **Good**: no architectural churn on evidence that cannot be extrapolated to the target hardware; the
  measurement method is written down, so the follow-up starts from data instead of a hunch.
- **Bad**: if users do perceive stutter on real hardware, the fix is still pending — it should then be
  driven by a trace from that machine (DevTools Performance, GPU rasterisation enabled).
- **Enforcement / next step**: re-run the probe method (rAF-only intervals, blur on vs off, same
  animation) on real hardware; only a confirmed gap justifies the layer split.
