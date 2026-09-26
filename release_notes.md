# LightAlbum v0.3.0

> V2 数据流架构全面落地 — 更健壮、更可维护、更流畅的照片管理体验

## 下载

| 平台 | 文件 |
|------|------|
| Windows (x64) | `LightAlbum-0.3.0-x64.msi` 或 `.exe` |
| macOS (Apple Silicon) | `LightAlbum-0.3.0-aarch64.dmg` |
| macOS (Intel) | `LightAlbum-0.3.0-x64.dmg` |
| Linux (x64) | `LightAlbum-0.3.0-amd64.deb` 或 `.AppImage` |

[前往 Releases 页面](https://github.com/Aswellle/LightAlbum/releases/latest)

---

## V2 数据流架构 — 全面重构

v0.3.0 标志着 LightAlbum 数据流架构从"扁平数组 + 全量刷新"向"规范化实体 + 精准更新"的全面迁移。22 个新文件覆盖 `src/domain/`、`src/data/`、`src/stores/`、`src/features/library/`、`src/services/thumbnail/` 五大模块，通过兼容 Facade 模式确保旧组件无需修改即可运行在新架构上。

### 核心架构变化

```
┌─────────────────────────────────────────────────────────┐
│                    SQLite (source of truth)               │
└──────────────────────────┬──────────────────────────────┘
                           │ Repository / Query
                           ▼
┌─────────────────────────────────────────────────────────┐
│              Rust Library API (query / mutation)          │
└──────────────────────┬──────────────────────────────────┘
                       │
              data page │ EventEnvelope
                       ▼
     ┌─────────────────┴──────────────────┐
     │                                    ▼
     │  ┌──────────────────┐   ┌──────────────────┐
     │  │ PhotoEntityStore │   │   EventRouter    │
     │  │ (byId normalized)│   │ (domain handlers)│
     │  └────────┬─────────┘   └──────────────────┘
     │           │
     ▼           ▼
┌─────────────────────────────────────────────────────────┐
│          CollectionStore (orderedIds + sections)          │
│          ─ 单一实体源 + 轻量边界索引 ─                    │
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│              Layout Engine (fixed / waterfall)            │
│  ┌─────────────────┐  ┌──────────────────────────────┐  │
│  │ fixedGridLayout │  │ waterfallLayout + spatialIndex│  │
│  │ (二分查找索引)  │  │ (typed arrays + 列内二分)    │  │
│  └─────────────────┘  └──────────────────────────────┘  │
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│          Virtualized UI (VirtualPhotoGrid / WaterfallV2) │
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│            ThumbnailScheduler (任务状态机)                │
│   queued → running → fulfilled/failed/cancelled          │
│   priority promotion + generation invalidation           │
└─────────────────────────────────────────────────────────┘
```

---

## 新增功能

### V2 核心数据层

- **PhotoEntityStore** — 规范化 `byId: Record<string, PhotoEntity>` 单一实体源，O(1) 单实体查找、patch、upsertMany、removeMany。同一实体全局仅存一份，消除数据冗余。
- **CollectionStore** — `orderedIds: string[]` + `sections: SectionMeta[]`（仅保存 `start/count` 边界，不复制 Photo 对象）。增量追加从 O(N_total) 降至 O(pageSize + newSections)。每个集合使用独立的实体查找缓存，消除跨集合数据泄漏。
- **Domain 类型** (`src/domain/photo/photoTypes.ts`) — 定义 `PhotoEntity`、`PhotoPageResult`、`SectionDelta`、`SectionMeta`、`getDisplayAspectRatio`（EXIF 方向感知）等 V2 基石类型。

### V2 数据获取

- **Collection Repository** (`src/data/photos/photoRepository.ts`) — 纯 IPC 仓库层，游标分页 100 条/批。
- **Query Key 工厂** (`src/data/photos/photoQueries.ts`) — 稳定 `buildCollectionKey(filter)` 序列化。
- **usePhotoCollection Hook** — 替代原 `usePhotoData`，管理 `useInfiniteQuery` + 归一化写入 EntityStore + CollectionStore。
- **usePhotoEntity Hook** — O(1) 单实体订阅。

### V2 布局引擎

- **Fixed Grid V2** (`src/features/library/layout/fixedGridLayout.ts`) — Section 前缀偏移 + 二分查找，O(log S + V) 可见行计算，不再创建全量 row 对象。
- **VirtualPhotoGrid** (`src/features/library/grid/VirtualPhotoGrid.tsx`) — 虚拟化固定网格 + GridSkeleton/EmptyState 加载状态。
- **Waterfall V2** (`src/features/library/layout/waterfallLayout.ts`) — Float32Array/Float64Array 布局数据（内存减少 ~80%）+ 列内二分视口查询。
- **Spatial Index** (`src/features/library/layout/spatialIndex.ts`) — 列内二分查找可见项，O(C log(N/C) + V)。
- **Layout Worker** (`src/features/library/layout/layout.worker.ts`) — Web Worker 离主线程布局计算，config 变化时不阻塞 UI。
- **WaterfallGridV2** (`src/features/library/grid/WaterfallGridV2.tsx`) — 虚拟化瀑布流 + WaterfallSkeleton/WaterfallEmptyState。

### V2 缩略图调度

- **Thumbnail Scheduler V2** (`src/services/thumbnail/ThumbnailScheduler.ts`) — 任务状态机 (queued/running/fulfilled/failed/cancelled) + 优先级提升（low → normal → high）+ 代际失效 + O(1) 双端队列。

### V2 事件系统

- **Event Bus V2** (`src/data/events/`) — EventEnvelope (version/seq/revision/mutationId) + EventRouter domain handlers + LibrarySyncState revision gap 检测。替代 `resetQueries(['photos'])` 全量刷新，实现"小变化小刷新，大变化大刷新"。

### V2 预览管线

- **Preview Pipeline V2** (`src/features/library/preview/`) — M → L/XL → original 渐进加载 + PreviewController 状态管理。

### UI/UX 改进

- **Motion System** (`src/styles/tokens.css`) — `--la-motion-fast/normal/slow` + `--la-ease-standard/emphasized` 统一动效系统 + `prefers-reduced-motion` 无障碍动效缩减。
- **WaterfallGridV2 加载/空状态** — 新增 WaterfallSkeleton（脉冲动画骨架屏）+ WaterfallEmptyState（空态提示），与 VirtualPhotoGrid 保持一致。

---

## 重要修复

### P0 — 关键错误修复

- **瀑布流渲染错误** — `useWaterfallLayout` 中 `Object.keys(byId)[index]` 返回实体存储插入顺序而非有序索引，导致瀑布流单元格渲染错误照片或空白。已修复为 `orderedIds[index]` 正确映射。
- **实时更新丢失** — `photo:updated` 事件处理器调用 `patch({})` 为空对象，后端推送的收藏/元数据编辑永远不反映到 UI。已修复为 `invalidateQueries` 触发后端重新获取。

### P1 — 重要功能修复

- **缩略图优先级失效** — `promoteExisting()` 在修改 `task.priority` 后计算 bucket，导致 `oldBucket === newBucket` 永远为 true，优先级提升从未执行。已修复为先捕获 `oldBucket` 再修改 priority。
- **跨集合数据泄漏** — 模块级 `entityLookupCache` 被所有集合共享，切换视图时实体互相覆盖，导致分组错误和标签错乱。已修复为每集合独立缓存。
- **WaterfallGridV2 全局读取** — 使用 `usePhotoEntityStore` 返回全部实体 ID 而非当前集合 ID，导致键盘导航和选择跨越集合边界。已修复为使用集合作用域 `allIds`。
- **photoStore 全量派生** — 底层实体存储的每次变更（包括非活跃集合）都触发 O(N) 全量 photos/groups 派生。已修复为订阅仅追踪活跃集合实体变更。

### P2 — 次要问题修复

- **EventRouter 模块级单例** — `latestRevision` 在模块级别可变，HMR/测试时实例重建导致状态不一致。已移入类实例。
- **selectPhotoById 无边界检查** — 索引漂移时可能返回错误照片。已添加边界验证 + ID 匹配验证。
- **layout.worker 忽略 EXIF 方向** — Worker 使用原始 width/height 计算宽高比，旋转照片布局高度错误。已使用 `getDisplayAspectRatio()` 与主线程保持一致。
- **useWaterfallLayout 不触发重算** — `recompute` 的 `useCallback` 依赖数组为空，布局变化后 visibleItems 不更新。已添加 `orderedIds` 到依赖数组。
- **usePhotoCollection 多页缓存竞争** — `prevPageCountRef.current === 0` 时 `replaceFirstPage` 仅同步首页，丢弃已缓存的后续页。已修复为全量同步所有缓存页。

### P3 — 代码质量改进

- **EXIF 方向常量** — 提取 `EXIF_ROTATED_MIN = 5` 和 `EXIF_ROTATED_MAX = 8` 命名常量，替代魔数。

---

## 文档

- **README 架构图** — 新增完整 V2 数据流 ASCII 架构图（中英双语）。
- **README 徽章修复** — `LightAblum` → `LightAlbum`，新增 V2 Architecture + Tests passing 徽章。
- **README 性能章节** — 扩展为完整 V2 性能架构（typed arrays、binary search、worker、任务状态机等 8 项子特性）。
- **README 渐进预览** — 新增 M → L/XL → original 渐进加载描述。
- **README 动效系统** — 新增 motion tokens + `prefers-reduced-motion` 无障碍支持。
- **Commit Policy (AGENTS.md)** — 写入禁止 AI 署名的铁律。

---

## 提交政策

- **禁止 AI 署名** — 所有历史提交中的 `Co-Authored-By` 行已清除，AGENTS.md 写入硬规则，确保提交作者仅为人类开发者。

---

## 变更统计

- **30 个提交** 自 v0.2.0
- **22 个新文件** 新增
- **+3,970 行 / -657 行** 净增
- **13 项代码质量审查发现** 全部修复（P0×2, P1×4, P2×5, P3×2）
- **4 平台构建产物** 自动发布

**Full Changelog**: https://github.com/Aswellle/LightAlbum/compare/v0.2.0...v0.3.0
