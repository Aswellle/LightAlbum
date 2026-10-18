<p align="center"><img src="app-icon.png" width="112" alt="LightAlbum app icon" /></p>
<h1 align="center">LightAlbum</h1>

<p align="center">
  本地优先的桌面照片管理器 · 面向十万级图库设计，只为视口付出渲染成本<br/>
  Tauri v2 (Rust) · React 19 · TypeScript · 照片只留在你自己的磁盘上
</p>

<p align="center">
  <a href="https://github.com/Aswellle/LightAlbum/actions/workflows/ci.yml"><img src="https://github.com/Aswellle/LightAlbum/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI" /></a>
  <a href="https://github.com/Aswellle/LightAlbum/releases/latest"><img src="https://img.shields.io/github/v/release/Aswellle/LightAlbum?style=flat&label=release&color=blue" alt="Release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" /></a>
  <a href="https://github.com/Aswellle/LightAlbum/releases/latest"><img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-4b5563" alt="Platforms" /></a>
</p>

<p align="center">
  <a href="#中文">中文</a> · <a href="#english">English</a>
</p>

---

## 中文

<p align="center">
  <img src="docs/images/screenshot-library.png" width="920" alt="导入本地文件夹后的 LightAlbum 主界面" />
</p>

<p align="center">
  <sub>导入本地文件夹后的网格视图：左侧是相册、文件夹与标签，内容区按月分组</sub>
</p>

### 概述

LightAlbum 把你已有的文件夹当作图库本体。它递归索引目录、提取 EXIF、生成缩略图，再以虚拟化网格或瀑布流呈现——原图不搬家，应用不联网，卸载它也不会带走任何一张照片。

它填的是两个都不太顺手的位置之间的空档：系统文件管理器不懂照片库，云相册又要求你先交出照片。LightAlbum 保留你的目录结构，同时补上照片库真正需要的东西——分组、相册、标签、收藏、私密空间与撤销。

| 设计原则 | 落地方式 |
|---|---|
| **本地优先** | 无账号、无遥测、无网络请求；SQLite 与缩略图全部在应用数据目录 |
| **原图不动** | 数据库只记录路径；删除先是软删除，只有回收站到期清理或手动永久删除才触碰磁盘 |
| **为规模设计** | 只渲染视口附近的行；keyset 游标分页；缩略图按优先级在后台补齐 |
| **失败可恢复** | 30 天回收站、单步撤销、迁移前自动备份、令牌失效自动重锁 |

### 功能

#### 导入与索引

- **原地索引**：递归扫描你指定的文件夹，只记录路径与元数据；不移动、不改名、不复制原图。
- **实时同步**：文件系统监听带 500ms 合并窗口，新增 / 修改 / 删除都会反映到当前视图。
- **格式覆盖**：`JPEG` `PNG` `WebP` `AVIF` `TIFF` `BMP` `HEIC` `HEIF`，以及 `CR2` `CR3` `NEF` `ARW` `DNG` `ORF` `RW2` `RAF`。
- **增量扫描**：路径 + 修改时间 + 文件大小三元组比对，只处理真正变化的文件；xxHash64 指纹用于缩略图寻址，内容相同的文件共用同一组缩略图。

#### 浏览与预览

- **两套虚拟化布局**：固定网格对行做二分查找，瀑布流用贪心最短列并按 y 轴切片；两者都只挂载视口附近的内容。
- **四档密度**：紧凑 / 标准 / 宽松 / 超大，`Ctrl+滚轮` 逐级切换。
- **全屏预览**：从被点中的格子飞入（共享元素过渡），滚轮或双指缩放至 4×，方向键切换，胶片条浏览，`I` 开关 EXIF。
- **EXIF 面板**：机身、镜头、焦距、光圈、快门、ISO、GPS 坐标；截图等没有相机信息的图片也有完整的回退展示。
- **渐进加载**：网格先用小尺寸缩略图占位，预览先出 M 再换原图，切换照片不闪白。
- **主题**：跟随系统 / 深色 / 浅色，首帧前写入主题类名，启动不闪屏；`prefers-reduced-motion` 下自动收敛动效。

#### 整理与检索

- **相册**：创建、重命名、拖拽排序、批量加入、封面选择；侧边栏可直接新建私密相册。
- **彩色标签**：八色预设色板，侧边栏标签面板一键筛选。
- **快捷检索**：`Ctrl+F` 聚焦搜索框，输入时给出文件名 / 相机 / 标签三路建议；`#标签名` 直达该标签下的照片。
- **智能视图**：全部照片 / 收藏 / 最近导入 / 回收站；网格按月分组，组头可一键全选本组。
- **批量操作**：框选、`Shift` 范围选择、`Ctrl` 多选、`Ctrl+A` 全选；收藏、加入相册、删除均支持批量。

#### 私密相册

- 密码以 **bcrypt**（cost 10）哈希存储，磁盘上没有明文。
- 解锁后颁发 **HMAC-SHA256** 签名、绑定相册、有效期 1 小时的会话令牌。
- 后端在**每一次**照片列表请求上校验令牌；离开相册即丢弃，令牌过期自动重新上锁。
- 连续失败 3 次后按指数退避锁定，最长 5 分钟。

#### 可恢复性

- **回收站**：删除是软删除，30 天内可恢复；到期由后台任务清理数据库记录、原图与缩略图。
- **撤销**：`Ctrl+Z` 覆盖删除、收藏、加入相册；批量操作只产生一条记录，一次还原。
- **数据库迁移**：幂等迁移 v1→v5，升级前自动备份为 `library.db.bak.{version}`。

### 技术架构

LightAlbum 分三层：React 负责界面与交互，Rust 负责索引、缩略图与持久化，Node/Sharp 只处理 Rust 图像库暂时吃不下的格式。三层之间只有两种契约——Tauri IPC 命令与事件。

| 层 | 关键技术 | 职责 |
|---|---|---|
| 前端 | React 19 · TypeScript · Zustand · TanStack Query · Tailwind v4 | 视图状态、虚拟化渲染、缓存与事件响应 |
| 后端 | Tauri v2 · rusqlite + r2d2 · rayon · notify | 扫描与索引、EXIF、SQL 查询、缩略图调度、文件监听 |
| 解码 sidecar | Node.js 20 + Sharp | HEIC / HEIF / AVIF 与 8 种 RAW 的解码和转码 |

#### 一次滚动发生了什么

1. `photos_list` 以 keyset 游标返回一页 100 条，前端 `useInfiniteQuery` 追加到缓存。
2. `usePhotoData` 在 `useLayoutEffect` 中把数据写入 store——发生在浏览器绘制之前，所以切换视图不会先闪一帧空网格。
3. 布局引擎算出可见区间：网格二分查找首个可见行，瀑布流按列贪心打包后按 y 轴切片。
4. 可见格子按优先级请求缩略图；Rust 生成完成后发出 `thumb:ready`，对应格子淡入。

#### 状态与事件

- **两层状态**：TanStack Query 持有服务端缓存，Zustand 持有视图状态。`photoStore` 是兼容门面，底层是 `byId` 实体表 + `orderedIds` 有序集合，追加一页是 O(pageSize)，不是整表重建。
- **事件路由器**：所有 Rust 事件包成信封，带 `seq` 与 `revision`；重复事件丢弃，版本缺口触发整体重取。小变化小刷新，大变化全刷新。
- **失效策略**：`staleTime: Infinity` 意味着数据只在显式失效时刷新，因此事件必须带 `refetchType: 'active'`，否则已挂载的视图不会更新（ADR-006）。

#### 缩略图流水线

| 档位 | 边长 | 用途 |
|---|---|---|
| S | 200 px | 网格 |
| M | 600 px | 瀑布流 / 预览过渡 |
| L | 1600 px | 大图，按需生成 |

- 三档优先级（High 视口中心 / Normal overscan / Low 后台补齐），各自独立队列（500 / 2000 / 10000），同一张照片不会重复入队。
- rayon 工作线程数为 `min(CPU/2, 4)`，避免与 UI、扫描抢核。
- 文件名由 xxHash64 前两位分片：`thumbnails/a3/a3f7….s.webp`，磁盘缓存 5 GB LRU。
- HEIC/RAW 交给 sidecar：首次请求时懒启动，空闲 30 秒退出，崩溃后下次请求自动重启；内部信号量限制并发（缩略图 3 / 原图解码 1 / 元数据 8）。

#### 值得一读的设计决策

| ADR | 主题 |
|---|---|
| [ADR-001](docs/decisions/ADR-001-stale-time-infinity.md) | `staleTime: Infinity` 下的失效与重置语义 |
| [ADR-002](docs/decisions/ADR-002-dual-state-management.md) | Zustand 与 TanStack Query 的分工边界 |
| [ADR-003](docs/decisions/ADR-003-sharp-sidecar.md) | 为什么 HEIC/RAW 交给独立 Node 进程 |
| [ADR-004](docs/decisions/ADR-004-private-album-security.md) | 私密相册的哈希、令牌与退避模型 |
| [ADR-006](docs/decisions/ADR-006-content-transition-flicker.md) | 绘制前替换：如何彻底消除切换闪烁 |
| [ADR-007](docs/decisions/ADR-007-preview-shared-element-transition.md) | 预览飞入 / 飞出的共享元素契约 |

其余决策见 [`docs/decisions/`](docs/decisions/)。

### 项目结构

```
src/
├─ app/            应用根、Provider、视图路由
├─ components/     按功能分组的 UI（grid / preview / album / layout / settings / trash）
├─ hooks/          数据协调、虚拟化布局、缩略图、键盘快捷键
├─ stores/         Zustand：照片、集合、选择、布局、预览、UI
├─ services/       IPC 封装、事件总线、缩略图调度
├─ data/           查询键工厂、事件路由器
├─ types/          IPC 契约、事件表、筛选与布局类型
└─ styles/         设计令牌（--la-*）与 Tailwind v4 主题桥

src-tauri/
├─ src/commands/   IPC 处理器
├─ src/db/         Schema 迁移与仓储实现
├─ src/scanner/    遍历、差异计算、文件监听
├─ src/thumbnail/  优先级队列、编码、缓存、sidecar 句柄
└─ src/query/      筛选与排序 SQL 构建

sidecar/           Sharp worker（HEIC/RAW 解码）
tests/e2e/         Playwright 规格
docs/decisions/    架构决策记录
```

### 下载安装

前往 [Releases](https://github.com/Aswellle/LightAlbum/releases/latest) 下载对应平台安装包：

| 平台 | 文件 |
|---|---|
| Windows (x64) | `.exe` 安装包（推荐）或 `.msi` |
| macOS (Apple Silicon) | `.dmg`（aarch64） |
| Linux (x64) | `.AppImage` / `.deb` / `.rpm` |

> **macOS (Intel) 已停止发布** —— **0.5.1 是最后一个提供 Intel 版本（`.dmg`，x86_64）的版本**；此后只发布 Windows x64 / macOS Apple Silicon / Linux x64 三个平台。

### 快速开始

| 依赖 | 版本 |
|---|---|
| Node.js | 20+ |
| pnpm | 10（已由 `packageManager` 锁定） |
| Rust | 1.77+ |
| Linux 额外依赖 | `libwebkit2gtk-4.1-dev` `libgtk-3-dev` `libappindicator3-dev` `librsvg2-dev` `patchelf` |

```bash
# 1. 克隆并安装前端依赖
git clone https://github.com/Aswellle/LightAlbum.git
cd LightAlbum
pnpm install

# 2. 构建 HEIC/RAW 处理器（sidecar 需单独安装依赖并打包）
cd sidecar && npm ci && node scripts/bundle.js && cd ..

# 3. 启动开发模式（Vite + Rust 一起）
pnpm tauri dev
```

`pnpm tauri build` 之前必须先完成第 2 步——sidecar 二进制通过 `externalBin` 打进安装包，不会自动构建。

数据目录：

| 平台 | 路径 |
|---|---|
| Windows | `%APPDATA%\LightAlbum\` |
| macOS | `~/Library/Application Support/LightAlbum/` |
| Linux | `~/.local/share/LightAlbum/` |

### 常用命令

| 命令 | 作用 |
|---|---|
| `pnpm tauri dev` | 完整应用（Vite + Rust） |
| `pnpm dev` | 仅前端，用于纯 UI 开发 |
| `pnpm tauri build` | 生产构建（需先构建 sidecar） |
| `pnpm lint` / `pnpm typecheck` | ESLint / TypeScript 检查 |
| `pnpm test` | Vitest 单元测试 |
| `pnpm test:e2e` | Playwright 端到端测试（自动拉起 Vite） |
| `cd src-tauri && cargo test` | Rust 单元与集成测试 |
| `cd src-tauri && cargo bench --bench scan_throughput` | 扫描与分页查询基准 |
| `cd sidecar && node test/smoke.js` | sidecar 冒烟测试 |

### 参与贡献

欢迎 Issue 与 PR。提交前请至少跑通：

```bash
pnpm lint && pnpm typecheck && pnpm test
cd src-tauri && cargo fmt --check && cargo clippy -- -D warnings && cargo test
```

新增 IPC 命令需要**同时**修改 `src/types/commands.ts` 的 `IpcCommands` 与 `src-tauri/src/lib.rs` 的 `generate_handler!`，只改一半会在运行时失败。完整流程、分支与提交规范见 [CONTRIBUTING.md](CONTRIBUTING.md)。

### 支持这个项目

如果 LightAlbum 对你有帮助，欢迎点一个 ⭐️ Star。你的每一次支持，都是它继续变好的理由。

---

## English

<p align="center">
  <img src="docs/images/screenshot-library.png" width="920" alt="The LightAlbum grid after importing a local folder" />
</p>

<p align="center">
  <sub>The grid after importing a local folder: albums, folders and tags on the left, month-grouped photos on the right</sub>
</p>

### Overview

LightAlbum treats the folders you already have as the library. It indexes them recursively, extracts EXIF, builds thumbnails, and renders them in a virtualized grid or waterfall. Originals stay where they are, the app never talks to a network, and uninstalling it doesn't take a single photo with it.

It fills the gap between two unsatisfying options: a file manager that doesn't understand photo libraries, and a cloud album that asks you to hand your photos over first. LightAlbum keeps your folder structure intact while adding what a photo library actually needs — grouping, albums, tags, favorites, a private space, and undo.

| Principle | How it shows up |
|---|---|
| **Local-first** | No account, no telemetry, no network calls; SQLite and thumbnails live in the app data directory |
| **Originals untouched** | The database stores paths only; deletes are soft, and only trash expiry or an explicit permanent delete touches disk |
| **Built for scale** | Only rows near the viewport are mounted; keyset pagination; thumbnails backfill by priority |
| **Recoverable by default** | 30-day trash, single-step undo, pre-migration backup, automatic re-lock on token expiry |

### Features

#### Import & indexing

- **In-place indexing** — recursively scans folders you choose and records paths and metadata; nothing is moved, renamed, or copied.
- **Live sync** — a file watcher with a 500 ms coalescing window reflects adds, edits, and deletes in the current view.
- **Format coverage** — `JPEG` `PNG` `WebP` `AVIF` `TIFF` `BMP` `HEIC` `HEIF`, plus `CR2` `CR3` `NEF` `ARW` `DNG` `ORF` `RW2` `RAF`.
- **Incremental scans** — path + mtime + size triage processes only files that actually changed; xxHash64 fingerprints address thumbnails, so byte-identical files share one set.

#### Browsing & preview

- **Two virtualized layouts** — the fixed grid binary-searches rows; the waterfall packs the shortest column and slices on the y-axis. Both mount only what is near the viewport.
- **Four density presets** — compact / standard / spacious / extra-large, stepped with `Ctrl+wheel`.
- **Full-screen preview** — flies in from the clicked cell (shared-element transition), zooms to 4× with wheel or pinch, arrow-key navigation, filmstrip browsing, `I` toggles EXIF.
- **EXIF panel** — body, lens, focal length, aperture, shutter, ISO, GPS coordinates; screenshots and other camera-less images still get a complete fallback layout.
- **Progressive loading** — the grid paints a small thumbnail first; preview starts at M and swaps in the original, with no white flash between photos.
- **Themes** — system / dark / light, applied before the first frame so startup doesn't flash; motion collapses under `prefers-reduced-motion`.

#### Organizing & finding

- **Albums** — create, rename, drag to reorder, batch-add, pick a cover; private albums are created straight from the sidebar.
- **Color tags** — an eight-color preset palette and a sidebar tag panel that filters in one click.
- **Quick search** — `Ctrl+F` focuses the search field and suggests filenames, cameras, and tags as you type; `#tagname` jumps to the photos under that tag.
- **Smart views** — All Photos / Favorites / Recently Imported / Trash; the grid groups by month, and each group header can select its whole group.
- **Batch operations** — rubber-band select, `Shift` range select, `Ctrl` multi-select, `Ctrl+A`; favorite, add to album, and delete all work in bulk.

#### Private albums

- Passwords are stored as **bcrypt** hashes (cost 10) — no plaintext on disk.
- Unlocking issues an **HMAC-SHA256** signed session token, bound to that album, valid for one hour.
- The backend validates the token on **every** photo-list request; the token is dropped on leaving the album, and expiry re-locks the UI.
- Three consecutive failures trigger exponential backoff, capped at five minutes.

#### Recoverability

- **Trash** — deletes are soft and restorable for 30 days; a background job then removes the row, the original file, and its thumbnails.
- **Undo** — `Ctrl+Z` covers delete, favorite, and add-to-album; a batch produces one log entry and reverts in a single step.
- **Migrations** — idempotent v1→v5 migrations, with an automatic `library.db.bak.{version}` backup before upgrading.

### Architecture

LightAlbum is three layers: React owns the interface and interaction, Rust owns indexing, thumbnails, and persistence, and Node/Sharp handles only the formats the Rust image ecosystem can't yet decode. There are exactly two contracts between them — Tauri IPC commands and events.

| Layer | Key technologies | Responsibility |
|---|---|---|
| Frontend | React 19 · TypeScript · Zustand · TanStack Query · Tailwind v4 | View state, virtualized rendering, cache and event handling |
| Backend | Tauri v2 · rusqlite + r2d2 · rayon · notify | Scanning and indexing, EXIF, SQL queries, thumbnail scheduling, file watching |
| Decode sidecar | Node.js 20 + Sharp | HEIC / HEIF / AVIF and eight RAW formats |

#### What happens on a scroll

1. `photos_list` returns a 100-item page using a keyset cursor; `useInfiniteQuery` appends it to the cache.
2. `usePhotoData` writes that page into the store inside `useLayoutEffect` — before the browser paints, so switching views never flashes an empty grid.
3. The layout engine computes the visible range: the grid binary-searches the first visible row, while the waterfall packs columns and slices on the y-axis.
4. Visible cells request thumbnails by priority; Rust emits `thumb:ready` when a thumbnail lands and the cell fades in.

#### State and events

- **Two state layers** — TanStack Query holds the server cache, Zustand holds view state. `photoStore` is a compatibility facade over a `byId` entity table plus an `orderedIds` collection, so appending a page is O(pageSize) rather than a full rebuild.
- **Event router** — every Rust event is wrapped in an envelope with `seq` and `revision`. Duplicates are dropped and version gaps trigger a full refetch. Small changes refresh narrowly; large ones refresh everything.
- **Invalidation policy** — with `staleTime: Infinity`, data only refreshes when explicitly invalidated, so events must pass `refetchType: 'active'` or a mounted view will never update (ADR-006).

#### Thumbnail pipeline

| Tier | Long edge | Used for |
|---|---|---|
| S | 200 px | Grid |
| M | 600 px | Waterfall / preview transition |
| L | 1600 px | Full-size preview, generated on demand |

- Three priority levels (High for the viewport center, Normal for overscan, Low for background backfill), each with its own bounded queue (500 / 2,000 / 10,000) and per-photo deduplication.
- rayon runs `min(CPU/2, 4)` workers so thumbnailing doesn't starve the UI or the scanner.
- Files are sharded by the first two xxHash64 characters — `thumbnails/a3/a3f7….s.webp` — behind a 5 GB LRU disk cache.
- HEIC/RAW go to the sidecar: spawned lazily on first request, terminated after 30 idle seconds, restarted automatically after a crash. Internal semaphores cap concurrency (thumbnails 3 / full decode 1 / metadata 8).

#### Design decisions worth reading

| ADR | Topic |
|---|---|
| [ADR-001](docs/decisions/ADR-001-stale-time-infinity.md) | Invalidation and reset semantics under `staleTime: Infinity` |
| [ADR-002](docs/decisions/ADR-002-dual-state-management.md) | Where Zustand ends and TanStack Query begins |
| [ADR-003](docs/decisions/ADR-003-sharp-sidecar.md) | Why HEIC/RAW decode runs in a separate Node process |
| [ADR-004](docs/decisions/ADR-004-private-album-security.md) | Hashing, tokens, and backoff for private albums |
| [ADR-006](docs/decisions/ADR-006-content-transition-flicker.md) | Pre-paint replacement: eliminating transition flicker |
| [ADR-007](docs/decisions/ADR-007-preview-shared-element-transition.md) | The shared-element contract behind preview fly-in |

The rest live in [`docs/decisions/`](docs/decisions/).

### Project layout

```
src/
├─ app/            App root, providers, view routing
├─ components/     UI grouped by feature (grid / preview / album / layout / settings / trash)
├─ hooks/          Data coordination, virtualization, thumbnails, keyboard
├─ stores/         Zustand: photos, collections, selection, layout, preview, UI
├─ services/       IPC wrappers, event bus, thumbnail scheduler
├─ data/           Query key factories, event router
├─ types/          IPC contract, event map, filter and layout types
└─ styles/         Design tokens (--la-*) and the Tailwind v4 theme bridge

src-tauri/
├─ src/commands/   IPC handlers
├─ src/db/         Schema migrations and repository implementations
├─ src/scanner/    Walker, differ, file watcher
├─ src/thumbnail/  Priority queue, encoder, cache, sidecar handle
└─ src/query/      Filter and sort SQL builders

sidecar/           Sharp worker (HEIC/RAW decoding)
tests/e2e/         Playwright specs
docs/decisions/    Architecture decision records
```

### Download

Grab the installer for your platform from [Releases](https://github.com/Aswellle/LightAlbum/releases/latest):

| Platform | File |
|---|---|
| Windows (x64) | `.exe` installer (recommended) or `.msi` |
| macOS (Apple Silicon) | `.dmg` (aarch64) |
| Linux (x64) | `.AppImage` / `.deb` / `.rpm` |

> **macOS (Intel) is no longer published** — **0.5.1 is the last release with an Intel build** (`.dmg`, x86_64); from then on only Windows x64, macOS Apple Silicon, and Linux x64 are shipped.

### Quick start

| Requirement | Version |
|---|---|
| Node.js | 20+ |
| pnpm | 10 (pinned via `packageManager`) |
| Rust | 1.77+ |
| Linux extras | `libwebkit2gtk-4.1-dev` `libgtk-3-dev` `libappindicator3-dev` `librsvg2-dev` `patchelf` |

```bash
# 1. Clone and install frontend dependencies
git clone https://github.com/Aswellle/LightAlbum.git
cd LightAlbum
pnpm install

# 2. Build the HEIC/RAW processor (the sidecar installs and bundles separately)
cd sidecar && npm ci && node scripts/bundle.js && cd ..

# 3. Start development (Vite + Rust together)
pnpm tauri dev
```

Step 2 is mandatory before `pnpm tauri build`: the sidecar binary is bundled through `externalBin` and is not built automatically.

Data directory:

| Platform | Path |
|---|---|
| Windows | `%APPDATA%\LightAlbum\` |
| macOS | `~/Library/Application Support/LightAlbum/` |
| Linux | `~/.local/share/LightAlbum/` |

### Commands

| Command | Purpose |
|---|---|
| `pnpm tauri dev` | Full app (Vite + Rust) |
| `pnpm dev` | Frontend only, for pure UI work |
| `pnpm tauri build` | Production bundle (build the sidecar first) |
| `pnpm lint` / `pnpm typecheck` | ESLint / TypeScript checks |
| `pnpm test` | Vitest unit tests |
| `pnpm test:e2e` | Playwright end-to-end tests (starts Vite automatically) |
| `cd src-tauri && cargo test` | Rust unit and integration tests |
| `cd src-tauri && cargo bench --bench scan_throughput` | Scan and pagination benchmarks |
| `cd sidecar && node test/smoke.js` | Sidecar smoke test |

### Contributing

Issues and PRs are welcome. Before submitting, at minimum:

```bash
pnpm lint && pnpm typecheck && pnpm test
cd src-tauri && cargo fmt --check && cargo clippy -- -D warnings && cargo test
```

Adding an IPC command requires **both** an entry in `IpcCommands` (`src/types/commands.ts`) and a handler in `generate_handler!` (`src-tauri/src/lib.rs`); doing only half fails at runtime. Branching, commit style, and the full checklist are in [CONTRIBUTING.md](CONTRIBUTING.md).

### Support this project

If LightAlbum has been useful, a ⭐️ Star goes a long way. Every bit of support is why it keeps getting better.

---

## License

[MIT](LICENSE)
