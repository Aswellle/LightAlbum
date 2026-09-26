# ADR-005: UI visibility baseline (contrast, type scale, weights, hover policy)

**Status**: Accepted
**Date**: 2026-09-27

## Context

Users reported that text across the app was hard to read: sidebar tab names in the unselected state, section titles, status-bar labels, the density icons, button labels, empty-state copy and the search field all read as "washed out". The sidebar action icons (new album / new private album / add folder) were 12px glyphs in 18px hit areas drawn in the weakest text colour.

Measured defects (WCAG 2.1 relative-luminance contrast, against the surface each element actually sits on):

| Element | Before | Ratio |
|---|---|---|
| `--la-text-tertiary` on sidebar (dark) | `#636366` | 2.84:1 |
| `--la-text-tertiary` on sidebar (light) | `#AEAEB2` | 2.03:1 |
| `--la-text-secondary` on light surfaces | `#86868B` | 3.62:1 |
| Batch-action labels on the accent toolbar | `rgba(255,255,255,0.75)` | 2.68:1 |
| White label on `--la-accent` button (dark) | `#FFF` on `#0A84FF` | 3.65:1 |
| Context-menu disabled item | `--la-text-disabled` + `opacity:0.5` | ≈1.2:1 |
| Preview toolbar labels | `fontSize: 9px` | n/a (below the readable floor) |

Root causes: (1) the tertiary/secondary tiers were chosen as *aesthetic* greys rather than contrast-verified values; (2) components fell back to opacity/rgba dimming instead of moving along the token ladder; (3) hardcoded px font sizes (9–13px) duplicated the token scale and drifted below it; (4) `Icon` used a fixed `strokeWidth=1.5` on a 20×20 viewBox, so a 12px icon rendered a 0.9px hairline.

## Decision

1. **Contrast floors per tier** — measured against the surface the tier is used on, not against an idealised background:
   `primary ≥ 12:1`, `secondary ≥ 7:1`, `tertiary ≥ 4.5:1`, `disabled ≥ 3:1`; non-text UI boundaries/icons ≥ 3:1.
   The ratio is documented next to the token in `src/styles/tokens.css`.
2. **Type floor 12px** — scale is `xs 12 / sm 14 / base 15 / md 17 / lg 20`. No component may hardcode a smaller px size; components consume the tokens.
3. **Weight roles** — 400 body, 500 interactive labels (nav, buttons, menu items, metadata), 600 titles/selected states, 700 uppercase section headers. Hierarchy comes from weight + colour, not from fading.
4. **Filled surfaces get dedicated `-fill` tokens** — `--la-accent-fill`, `--la-danger-fill`, `--la-warning` carry `--la-text-on-accent` / `--la-text-on-warning` at ≥4.5:1. The brand hue (`--la-accent` `#0A84FF` / `#007AFF`) remains the graphic/decorative colour and the value for non-text UI. Accent/danger *text* uses `--la-accent-text` / `--la-danger-text`.
5. **Disabled = neutral, never double-dimmed** — disabled controls use `--la-fill-disabled` + `--la-text-disabled`; `opacity < 1` is reserved for genuinely disabled controls and decorative shapes, never for reading content.
6. **No opacity-based text dimming; hover never weakens text** — hover feedback lives on background/border; where text changes at all it moves toward a stronger tier (`tertiary → secondary → primary`). This is the desktop convention the app targets and removes the "由浅入深" fade.
7. **Icon stroke scales with render size** — `Icon` derives `strokeWidth` from `size` (1.65 at 16px … 2.1 at ≤11px) unless a deliberate override is passed. Minimal hit target for an icon action is 24×24.
8. **Preview chrome is a permanent dark scope** — the preview overlay declares its own dark token values at the `PhotoPreview` root, so preview typography is legible even in light theme (a naive token read produced 2.39:1 dark-on-dark).
9. **`prefers-contrast: more`** raises `secondary`/`tertiary`/borders one step in both themes.

## Consequences

- **Good**: every text surface in the app clears 4.5:1 (or its documented tier floor); the palette stays inside the existing Apple-Photos-inspired system — only values changed, no new visual language.
- **Good**: tokens are the single control point — future components inherit the baseline automatically, and the measured ratios live next to the values so reviewers can check them.
- **Bad**: light mode looks noticeably higher-contrast than the original Apple-derived palette, and filled buttons use deeper blues/reds (`#0071EB`, `#D70015`) than `#007AFF`/`#FF3B30` so that white labels pass AA.
- **Bad**: disabled text is deliberately readable (~3–4:1) rather than nearly invisible, so "disabled" must be conveyed by fill + cursor as well.
- **Enforcement**: `src/styles/tokens.css` documents the floor per tier; `AGENTS.md` consumers must not reintroduce hardcoded px sizes or opacity dimming.
