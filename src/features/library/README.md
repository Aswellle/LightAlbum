# `src/features/library` — 下一代（V2）视图层，尚未接线

> **状态：计划中，未接线（not wired）。** 主流程当前使用的是 `src/components/grid/**`
> （`VirtualGrid` / `WaterfallGrid`，消费 `photoStore` facade 的扁平 `photos[]`）。
> 本目录**没有任何外部引用**，因此不会进入打包产物，也没有运行时成本。
> 删除或接线前请先读本文件与 `docs/decisions/ADR-007`（若已存在）。

## 它是什么

一套替代视图层：把「虚拟化网格 + 瀑布流 + 大图预览」按归一化集合（collection）驱动重写。

| 文件 | 职责 |
|---|---|
| `grid/VirtualPhotoGrid.tsx` | 固定网格渲染器，props 为 `{ collection: PhotoCollection \| null, isLoading, onLoadMore, hasMore }` |
| `grid/WaterfallGridV2.tsx` | 瀑布流渲染器（`layoutId` 已按 `photo-${id}` 设定，可与共享元素动画配合） |
| `hooks/usePhotoCollection.ts` | 从 `collectionStore` 取集合 + 元数据 |
| `hooks/usePhotoEntity.ts` | 单实体订阅（避免整表重渲染） |
| `hooks/useVirtualCollection.ts` | 可见范围计算（行/偏移/总高） |
| `hooks/useWaterfallLayout.ts` | 瀑布流布局状态封装 |
| `layout/fixedGridLayout.ts` | 固定网格布局算法 |
| `layout/waterfallLayout.ts` | 贪心最短列瀑布流算法 |
| `layout/spatialIndex.ts` | 可见项空间索引 |
| `layout/layout.worker.ts` | 布局 worker（**尚未被实例化**：仓库内没有 `new Worker(...)`） |
| `layout/types.ts` | 布局类型 |
| `preview/PreviewController.ts` | 预览状态机（打开/切换/关闭） |
| `preview/previewSource.ts` | 预览图源解析（缩略图 → 原图阶梯） |

## 与现状的关系

- **数据层已经是 V2**：`photoEntityStore` + `collectionStore`（见 `AGENTS.md` → ADR-002）在生产路径上，
  本目录只是把**视图层**也切到同一套模型。
- **与现役视图层的差异**：现役 `VirtualGrid` 消费 facade 派生的 `groups[]`；V2 直接消费 `PhotoCollection`
  （`orderedIds` + `sections`），省掉一层派生与一次整表重建。
- **接线成本**：约 1900 行视图代码 + 一次全量视觉回归；属于"独立排期的重构"，
  不是局部改动。接线顺序建议：单个视图（如固定网格）→ 与现役实现并跑对拍 → 再切预览层。

## 为什么现在还留着

1. 它导入的是**当前**的 store 与 domain 类型（没有指向已删除模块），说明是与现状同步维护的设计；
2. 未被引用 → 对产物与运行时无影响；
3. 删除会丢掉计划中的架构，收益只有"文件数变少"。

如果确定不再推进 V2 视图层，请按「删除未接线模块」单独一次提交处理，并跑全量回归。
