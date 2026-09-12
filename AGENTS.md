# Repository Guidelines

LightAlbum — a local-first desktop photo manager built with **Tauri v2 (Rust) + React 19 + TypeScript**. All persistent data lives in `%APPDATA%/LightAlbum/` (`library.db` SQLite + `thumbnails/`)，GitHub Repo URL is [Aswellle/LightAlbum: 受 Apple Photos 启发的Windows本地照片管理应用 · Tauri v2 + React 构建 · 十万张照片滚动依旧流畅 · 支持 RAW / HEIC · 私密相册 · 完全本地运行，无需联网、无需账号、不上传云端](https://github.com/Aswellle/LightAlbum).

---

## Project Overview

A fast, privacy-focused photo organizer. Rust handles scanning, thumbnailing, EXIF, and SQLite. React renders a virtualized grid/waterfall UI. A Node.js **Sharp sidecar** (compiled to native binary) decodes HEIC/RAW formats the Rust image ecosystem can't handle yet.

---

## Development Commands

```bash
# Full app (Vite + Rust backend together) — primary dev command
pnpm tauri dev

# Frontend only (no Tauri shell; UI work)
pnpm dev

# Production bundle (requires sidecar binary built first)
pnpm tauri build

# Lint (ESLint v9 flat config)
pnpm lint

# TypeScript type check (no emit)
pnpm typecheck

# Frontend unit tests (Vitest)
pnpm test
pnpm test:ui

# E2E tests (Playwright, auto-starts Vite dev server)
pnpm test:e2e
pnpm test:e2e:ui

# Rust unit + integration tests
cd src-tauri && cargo test

# Rust benchmarks (scan throughput)
cd src-tauri && cargo bench --bench scan_throughput

# Build sidecar native binary → src-tauri/binaries/
cd sidecar && node scripts/bundle.js

# Sidecar smoke test
cd sidecar && node test/smoke.js
```

**Package manager:** `pnpm@10.33.0` (declared in `package.json#packageManager`). **Node:** 20 (CI), **Rust:** 1.77+.
## Commit Policy (Hard Rules)

### 禁止 AI 署名

**ALL commits MUST NOT contain AI co-author signatures.** This is a non-negotiable rule.

正确格式:
```
feat(v2): add normalized entity store

- src/stores/photoEntityStore.ts: byId map with O(1) lookup
- src/stores/collectionStore.ts: orderedIds + sections
```

禁止格式:
```
feat(v2): add normalized entity store

Co-Authored-By: Claude Sonnet 4.6 <<EMAIL>>
```

强制执行:
- AI 编程代理不得在任何提交消息中添加 `Co-Authored-By` 或类似署名
- 如果提交中已包含此类署名，必须立即 amend 去除
- 适用于所有提交 — initial、fixup、squash、amend、rebase
- 提交作者为人类开发者，不允许任何 AI 署名

## Architecture & Data Flow

### Layered structure

```
┌─────────────────────────────────────────────────────┐
│  React 19 + TypeScript (src/)                       │
│  Zustand stores │ TanStack Query │ Tailwind v4       │
└──────────────┬──────────────────────┬────────────────┘
               │ IPC (invoke/listen)  │
┌──────────────▼──────────────────────▼────────────────┐
│  Tauri v2 Rust (src-tauri/src/)                     │
│  Commands │ Repositories │ SQLite (r2d2 pool)       │
│  Thumbnail pipeline │ Scanner │ Watcher              │
└──────────────┬───────────────────────────────────────┘
               │ JSON Lines over stdio
┌──────────────▼───────────────────────────────────────┐
│  Sharp sidecar (sidecar/) — HEIC/RAW decode + resize │
└───────────────────────────────────────────────────────┘
```

### Frontend data flow

- **View routing** is `ViewState`-driven (no URL router). `src/app/routes.tsx` maps view state to components.
- **Data fetching:** `usePhotoQuery` (coordination) → `usePhotoData` (`useInfiniteQuery`) → populates `photoStore`.
- **Backend events:** Rust `app.emit()` → `useEventBus()` in `App.tsx` → Zustand store updates + QueryClient invalidation.
- **Single sync point:** `usePhotoData` is the one bridge between TanStack Query cache and `photoStore` flat array.

### Event-driven updates (critical)

| Rust event | Frontend action |
|---|---|
| `scan:completed` | `queryClient.resetQueries(['photos'])` — use `resetQueries`, NOT `invalidateQueries` (bypasses `staleTime: Infinity`) |
| `thumb:ready` | invalidate `['thumb', photoId, size]` + notify `thumbnailLoader` |
| `library:changed` | `resetQueries(['photos'])` |
| `photo:updated` | `photoStore.updatePhoto()` |
| `album:updated` | invalidate `['albums']` |

`library:changed` payload is always `{ added: string[], modified: string[], removed: string[] }`.

### IPC contract — two files in lockstep

Adding a new IPC command requires **both**:

1. Register handler in `src-tauri/src/lib.rs` → `tauri::generate_handler![...]`
2. Add signature to `IpcCommands` in `src/types/commands.ts`

The frontend calls through `src/services/tauriIpc.ts` (`api.*` wrappers around `invoke()`). Never call `invoke()` directly from components.

### Type-safe events

`src/types/events.ts` defines `TauriEventMap` (event name → payload) and `TAURI_EVENTS` constants. Use `listenTyped<K>(event, handler)` from `src/services/eventBus.ts` for inferred payload types. Adding a Rust event requires adding it to `TauriEventMap`.

---

## Key Directories

| Path | Purpose |
|---|---|
| `src/` | React frontend (components, stores, hooks, services, types) |
| `src/app/` | App root, providers, routes, `useTheme()` + `useEventBus()` |
| `src/components/` | UI by feature: `grid/`, `preview/`, `layout/`, `common/`, `album/`, `settings/`, `trash/` |
| `src/stores/` | 5 Zustand stores: `photoStore`, `uiStore`, `previewStore`, `selectionStore`, `layoutStore` |
| `src/services/` | `tauriIpc.ts` (IPC), `eventBus.ts` (events), `thumbnailLoader.ts` (priority queue + LRU cache) |
| `src/hooks/` | `usePhotoData`, `usePhotoQuery`, `useVirtualGrid`, `useWaterfallGrid`, `useThumbnail`, `useKeyboard`, `useTheme`, etc. |
| `src/types/` | `commands.ts` (IpcCommands), `events.ts` (TauriEventMap), `filters.ts` (PhotoFilter), `photo.ts`, `album.ts`, `layout.ts` |
| `src/styles/tokens.css` | Design tokens (`--la-*`) + Tailwind v4 `@theme` bridge |
| `src/locales/` | i18n (`zh-CN.ts` single locale, `t(key)` dot-notation accessor) |
| `src-tauri/src/` | Rust backend |
| `src-tauri/src/commands/` | IPC handlers: `scan.rs`, `photo.rs`, `album.rs`, `tag.rs`, `thumbnail.rs`, `undo.rs`, `settings.rs` |
| `src-tauri/src/db/` | Schema migrations, repository traits + SQLite impls, `photo.rs`, `album.rs`, `tag.rs`, `search.rs` |
| `src-tauri/src/thumbnail/` | Priority queue pipeline, cache, encoder, sidecar handle |
| `src-tauri/src/scanner/` | File walker, debounced watcher, differ |
| `src-tauri/src/query/` | Filter + sort SQL builders |
| `src-tauri/src/metadata/` | EXIF extraction, file hasher |
| `sidecar/` | Node.js Sharp worker — HEIC/RAW decode, compiled to native binary via `@yao-pkg/pkg` |
| `tests/e2e/` | Playwright specs: `grid.spec.ts`, `album.spec.ts`, `preview.spec.ts` |
| `tests/bench/` | `scan_throughput.rs` Rust benchmark |
| `docs/` | `RELEASE.md` + `decisions/` (ADRs) |

---

## Code Conventions & Common Patterns

### Components

- Functional components, named exports, PascalCase filenames (`PhotoGrid.tsx`).
- Props interfaces defined inline or co-located; no separate `props.ts` files.
- Styling primarily via `style={{}}` consuming CSS custom properties (`var(--la-bg-app)`), with Tailwind utility classes for layout primitives.
- Providers mounted exactly once in `App.tsx`: `QueryClientProvider` → `ConfirmDialogProvider` → `AppContent`.

### State management (dual layer — ADR-002)

- **TanStack Query** owns server-state cache + pagination. Query keys: `['photos']`, `['albums']`, `['thumb', photoId, size]`, `['folders']`, `['stats']`.
- **Zustand `photoStore`** owns the flat `photos[]` + `_groupMap` (indexed by `YYYY-MM`) for O(pageSize) grid updates.
- `staleTime: Infinity` on photo queries — forces explicit `resetQueries` on data changes.

### Rust backend patterns

- **Repository trait pattern:** `PhotoRepository`, `AlbumRepository`, `TagRepository`, `UndoRepository` (all `Send+Sync`). `Sqlite*Repository` structs hold `Arc<DbPool>`, delegate to free functions in `db/`.
- **Error handling:** `AppError` enum (`thiserror`) with custom `Serialize` → `{code, message, detail}`. Known codes: `DB_ERROR`, `IO_ERROR`, `THUMBNAIL_ERROR`, `EXIF_ERROR`, `SIDECAR_ERROR`, `PHOTO_NOT_FOUND`, `ALBUM_NOT_FOUND`, `SCAN_IN_PROGRESS`, `UNDO_EMPTY`, `INVALID_PARAMS`, `LIMIT_EXCEEDED`.
- **Database:** SQLite via `rusqlite` + `r2d2` pool (max 5). Per-connection PRAGMAs: WAL mode, foreign keys, `busy_timeout=5000ms`. Schema migrations in `db/schema.rs` are idempotent (`column_exists()` checks), with `.bak.{version}` backup before migration. Versions: v1 initial → v2 EXIF → v3 private albums → v4 tags → v5 full-text search.
- **Thumbnail pipeline:** Three-priority queue (High/Normal/Low) → rayon worker pool (`min(CPUs/2, 4)`) → generates S+M thumbnails, L on demand. HEIC/RAW routed to sidecar.
- **File watching:** `notify-debouncer-full` (500ms). Re-registers all `watched_folders` on launch; `import_scan`/`folders_remove` update dynamically.

### Sidecar protocol

- Rust `SidecarHandle` lazy-spawns sidecar on first HEIC/RAW request, 30s idle timeout, auto-restart on crash.
- JSON Lines protocol over stdin/stdout. Commands: `thumbnail`, `batch_thumbnail`, `decode`, `metadata`, `ping`, `memory`, `shutdown`.
- Concurrency limits via semaphore: thumbnail=3, decode=1, metadata=8.
- Built via `node scripts/bundle.js` → outputs to `src-tauri/binaries/sharp-worker-{triple}[.exe]`. **Must be built before `pnpm tauri build`** (not automatic).

### Naming patterns

- Files: PascalCase for components (`GridItem.tsx`), camelCase for utilities/hooks (`useKeyboard.ts`).
- Hooks: `use*` prefix. Stores: `*Store` suffix. Types: `*Payload`, `*Params`, `*Filter` suffixes.
- CSS: `--la-{category}-{variant}` (e.g., `--la-bg-raised`, `--la-text-secondary`).
- i18n keys: dot-notation modules (`t('settings.storage.title')`).

---

## Important Files

| File | Role |
|---|---|
| `package.json` | Scripts, deps, `packageManager` |
| `vite.config.ts` | Vite + React + Tailwind v4 + Vitest config; `@` → `src/`; dev server `127.0.0.1:5173` |
| `eslint.config.js` | ESLint v9 flat config; ignores `src-tauri/`, `sidecar/` |
| `tsconfig.json` | Strict TS, `paths: { "@/*": ["src/*"] }`, ES2022 target |
| `src/app/App.tsx` | Root: providers, `useTheme()`, `useEventBus()`, `AppShell`, overlays |
| `src/services/tauriIpc.ts` | Typed IPC wrapper (`api.*`, `parseIpcError`, `isIpcError`) |
| `src/services/eventBus.ts` | `listenTyped<K>()` event subscription |
| `src/types/commands.ts` | `IpcCommands` interface (IPC contract) |
| `src/types/events.ts` | `TauriEventMap` + `TAURI_EVENTS` constants |
| `src/styles/tokens.css` | Design tokens + Tailwind v4 `@theme` bridge |
| `src-tauri/src/lib.rs` | Tauri entry: `generate_handler!`, `AppState`, setup |
| `src-tauri/src/error.rs` | `AppError` enum + error codes |
| `src-tauri/src/state.rs` | `AppState` (DbPool, repositories, pipeline, watcher, sidecar) |
| `src-tauri/src/db/schema.rs` | Idempotent migrations v1–v5 |
| `src-tauri/tauri.conf.json` | Tauri config: `externalBin`, NSIS hooks, version |
| `sidecar/index.js` | Sidecar entry: JSON Lines dispatcher |
| `sidecar/scripts/bundle.js` | `@yao-pkg/pkg` build → native binaries |
| `playwright.config.ts` | E2E config: `tests/e2e/`, dev server, single worker |
| `.github/workflows/ci.yml` | CI: frontend (lint/typecheck/test/audit/sidecar-smoke), Rust (fmt/clippy/audit/test), Windows compat, E2E |
| `.github/workflows/release.yml` | Tag-triggered release: 4 platforms (win/mac_arm64/mac_x64/linux) |

---

## Runtime & Tooling Preferences

- **Package manager:** pnpm (v10.33). Do not use npm/yarn.
- **Node:** 20 for CI/dev. Not Bun-dependent (sidecar uses Node, but the main toolchain is pnpm/Vite).
- **Rust:** edition 2021, rust-version 1.77. Key crates: `tauri 2`, `rusqlite 0.31`, `r2d2`, `rayon`, `tokio`, `thiserror`, `tracing`, `bcrypt` + `hmac`/`sha2` (private albums).
- **Tailwind v4** via `@tailwindcss/vite` plugin (no `tailwind.config.ts` needed for v4; tokens bridged through `@theme` in `tokens.css`).
- **ESLint v9** flat config. Ignores `src-tauri/`, `sidecar/`, `dist/`, `*.config.js`.
- **Dev server** binds `127.0.0.1:5173` explicitly (IPv4 to avoid Windows IPv6 EACCES).

---

## Testing & QA

### Frontend unit tests (Vitest)

- Location: `src/__tests__/` and co-located `*.test.ts` (e.g., `src/stores/photoStore.test.ts`, `src/types/layout.test.ts`).
- Config: inline in `vite.config.ts` (jsdom environment, `globals: true`, setup `src/__tests__/setup.ts`).
- Setup mocks Tauri IPC (`@/services/tauriIpc`, `@tauri-apps/api/core`, `@tauri-apps/api/event`) — tests run without Tauri runtime.
- Run: `pnpm test` (or `pnpm test:ui` for interactive).

### E2E tests (Playwright)

- Location: `tests/e2e/` (`grid.spec.ts`, `album.spec.ts`, `preview.spec.ts`).
- Config: `playwright.config.ts` — connects to Vite dev server (`http://127.0.0.1:5173`), single worker, Chromium, 1280×800 viewport.
- Strategy: tests UI interaction/layout/state against dev server (not real Tauri IPC); IPC mocked via `page.evaluate` or `page.route`.
- Run: `pnpm test:e2e` (requires `pnpm dev` running or auto-started by webServer config).

### Rust tests

- Integration tests: `src-tauri/tests/` (`photo_repository_test.rs`, `schema_migration_test.rs`, `filter_builder_test.rs`) — use `tempfile` for DB isolation.
- Run: `cd src-tauri && cargo test`.
- Benchmarks: `cd src-tauri && cargo bench --bench scan_throughput` (Criterion, `tests/bench/scan_throughput.rs`).
- CI enforces: `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo audit`.

### Sidecar smoke test

- `cd sidecar && node test/smoke.js` — spawns sidecar, exercises all command scenarios.

---

## Adding a New Feature — Checklist

1. **New IPC command?** Add to BOTH `IpcCommands` (`src/types/commands.ts`) AND `generate_handler!` (`src-tauri/src/lib.rs`). Wrap call in `tauriIpc.ts`.
2. **New Rust event?** Add to `TauriEventMap` + `TAURI_EVENTS` (`src/types/events.ts`), emit in Rust, handle in `useEventBus()`.
3. **New DB column?** Add idempotent migration in `db/schema.rs` using `column_exists()`. Bump `LATEST_VERSION`.
4. **New query key?** Document in the event-driven updates table; use `resetQueries` not `invalidateQueries` for `staleTime: Infinity` queries.
5. **New component?** Place in `src/components/{feature}/`, consume CSS custom properties for theming, co-locate types.

## Release Safety Rules (V0.2.0+)

The release system uses an **immutable release ledger** model. These rules are mandatory for both humans and AI agents.

### Iron Rules

1. **One version number → one Git commit.**
2. **One version number → one Release.**
3. **Published Release is never rewritten.**
4. **Published Tag is never moved.**
5. **Source bug → new version.** Only if Tag/Commit are unchanged (CI bug) may a workflow be re-run.
6. **All four version files must match** (`package.json`, `tauri.conf.json`, `Cargo.toml`, `Cargo.lock`).
7. **Release must pass Full CI** (called via `workflow_call` from release.yml).
8. **All platforms upload to the same Release ID** (single draft → shared `release_id`).
9. **Release goes Draft first, Publish last.**
10. **Publish makes it immutable.**

### AI Agent Prohibitions

The following actions are **NEVER** permitted:

- Deleting or recreating a historical Release (`git tag -d`, `gh release delete`).
- Force-pushing or moving a `v*` tag (`git push --force`, `git tag -f`).
- Rebuilding / re-uploading to a published immutable version.
  - Exception: a Draft Release may be resumed if Tag + Commit are unchanged.
- Editing release assets of a published Release.
- Using `--update-snapshots` in CI (E2E snapshots are updated locally only).

These protections are enforced by GitHub **Tag Rulesets**, **Immutable Releases**, and the **release Environment** approval gate.

### Release Commands

```bash
# Version management (human edits only package.json; script syncs the rest)
pnpm version:set -- 0.2.0        # sync version across all 4 files
pnpm version:bump minor          # bump major/minor/patch
pnpm version:check               # verify all 4 versions match

# Local release entry (safe: create-only, never delete/overwrite)
pnpm release:preflight -- v0.2.0 # validate tag, version, branch, clean tree, no duplicates
pnpm release:tag -- v0.2.0       # create annotated tag + push → triggers Release workflow
```

### Publish Flow

```text
version:set → commit → push main → CI passes
  → release:tag v0.2.0
    → Release workflow
      → Preflight (tag valid · version consistent · not immutable)
      → Full CI (workflow_call)
      → Create Draft Release → release_id
      → Build Windows / macOS ARM64 / macOS Intel / Linux (same release_id)
      → Verify Assets (4 platforms · still draft)
      → release Environment (human approval)
      → Publish → Immutable Release
```

### Failure Recovery

| Scenario | Action |
---|---|
| CI fails | Fix code → main → new version. **Never move the failed tag.** |
| Build fails (one platform) | Tag + Commit unchanged, Release still Draft → re-run workflow. |
| Published, then bug found | Fix → new version (`0.2.1`) → new Tag → new Release. |

### GitHub Settings Required (manual, one-time)

1. **Immutable Releases** — Settings → General → Releases → Enable release immutability (affects v0.2.0+).
2. **Tag Ruleset** — Settings → Rules → Rulesets → Target Tag `v*` → Restrict creations, Block force pushes, Restrict updates.
3. **release Environment** — Settings → Environments → New `release` → add Required reviewers (human approval gate).
