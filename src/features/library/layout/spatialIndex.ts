/**
 * @file src/features/library/layout/spatialIndex.ts
 * @description V2 瀑布流空间索引 — 列内二分查找视口查询
 *
 * 每列天然按 y 递增排列，因此可以：
 *   for each column:
 *     binary search first item whose bottom > top
 *     scan until y >= bottom
 *
 * 复杂度：O(C log(N/C) + V)
 *   C = 列数, N = 总照片数, V = 视口附近照片数
 *
 * 不会随着 100,000 → 500,000 线性拖慢每一次 scroll。
 */

import type { WaterfallLayoutState, WaterfallItem } from './waterfallLayout'

const OVERSCAN_PX = 600 // 上下各预加载 600px

/**
 * 查询瀑布流中可见的项
 *
 * 对每列执行二分查找定位视口顶部，然后向下扫描。
 * 返回的 WaterfallItem 包含 index（全局索引），上层可通过 orderedIds[index] 获取 photoId。
 */
export function queryVisibleWaterfallItems(
  state: WaterfallLayoutState,
  scrollTop: number,
  clientHeight: number,
  overscanPx: number = OVERSCAN_PX,
): WaterfallItem[] {
  if (state.count === 0) return []

  const top = scrollTop - overscanPx
  const bottom = scrollTop + clientHeight + overscanPx
  const items: WaterfallItem[] = []

  for (let col = 0; col < state.columnCount; col++) {
    const colItems = state.columnItems[col]
    if (!colItems || colItems.length === 0) continue

    // 二分查找第一个 bottom > top 的项
    let lo = 0
    let hi = colItems.length - 1
    let startIdx = colItems.length // 默认无可见项

    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const itemIdx = colItems[mid] ?? -1
      if (itemIdx < 0) break
      const itemBottom = (state.y[itemIdx] ?? 0) + (state.height[itemIdx] ?? 0)

      if (itemBottom > top) {
        startIdx = mid
        hi = mid - 1
      } else {
        lo = mid + 1
      }
    }

    // 从 startIdx 向下扫描直到 y >= bottom
    for (let i = startIdx; i < colItems.length; i++) {
      const itemIdx = colItems[i] ?? -1
      if (itemIdx < 0) break
      if ((state.y[itemIdx] ?? 0) >= bottom) break

      items.push({
        photoId: '', // 上层通过 index 从 orderedIds 获取
        x: state.x[itemIdx] ?? 0,
        y: state.y[itemIdx] ?? 0,
        width: state.width[itemIdx] ?? 0,
        height: state.height[itemIdx] ?? 0,
        index: itemIdx,
        columnIndex: col,
      })
    }
  }

  return items
}

/**
 * 获取瀑布流总高度
 */
export function getWaterfallTotalHeight(state: WaterfallLayoutState): number {
  return state.totalHeight
}
