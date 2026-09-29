/**
 * @file src/hooks/useWaterfallGrid.ts
 * @description 瀑布流布局引擎 Hook
 *
 * 算法：贪心最短列算法（Greedy Column Packing）
 *   每次将下一张照片放入当前高度最小的列，
 *   保证各列高度尽量均衡，避免出现大量空白。
 *
 * 虚拟化：
 *   与 useVirtualGrid 相同的 rAF 节流 + 二分查找策略，
 *   但行高不等，需要维护每张图的绝对 y 坐标。
 *
 * 输出给 WaterfallGrid 的数据：
 *   items         每张照片的位置信息（x, y, width, height）
 *   totalHeight   总高度（最高列的高度）
 *   visibleItems  视口内 ± OVERSCAN_PX 的切片
 *   containerRef  绑定到滚动容器
 *
 * 性能：
 *   - buildLayout 在 useMemo 内运行，仅在 photos/config 变化时重算
 *   - visibleItems 通过 rAF 节流更新，不阻塞主线程
 */

import {
  useRef,
  useState,
  useLayoutEffect,
  useMemo,
  useCallback,
} from 'react'
import type { PhotoThumb } from '@/types/photo'
import type { GridConfig } from '@/types/layout'
import { getDisplayAspectRatio } from '@/types/photo'

// ─────────────────────────────────────────────────────────
//  布局单元
// ─────────────────────────────────────────────────────────

export interface WaterfallLayoutItem {
  photo:   PhotoThumb
  x:       number   // 距容器左边 px
  y:       number   // 距容器顶部 px
  width:   number   // = 列宽
  height:  number   // 按宽高比计算
}

// ─────────────────────────────────────────────────────────
//  贪心列高算法
// ─────────────────────────────────────────────────────────

function buildLayout(
  photos:  PhotoThumb[],
  config:  GridConfig,
): { items: WaterfallLayoutItem[]; totalHeight: number } {
  const { columns, gap, itemSize: colWidth } = config

  if (columns === 0 || photos.length === 0) {
    return { items: [], totalHeight: 0 }
  }

  // 每列当前已使用的高度
  const colHeights = new Array<number>(columns).fill(gap)
  const items: WaterfallLayoutItem[] = []

  for (const photo of photos) {
    // 找最短列
    let minCol = 0
    for (let c = 1; c < columns; c++) {
      if (colHeights[c] < colHeights[minCol]) minCol = c
    }

    const ar     = getDisplayAspectRatio(photo)
    const height = Math.round(colWidth / ar)
    const x      = minCol * (colWidth + gap) + gap
    const y      = colHeights[minCol]

    items.push({ photo, x, y, width: colWidth, height })
    colHeights[minCol] += height + gap
  }

  const totalHeight = Math.max(...colHeights)
  return { items, totalHeight }
}

// ─────────────────────────────────────────────────────────
//  可见范围计算（y 轴 ± overscan）
// ─────────────────────────────────────────────────────────

const OVERSCAN_PX = 600   // px，上下各预加载 600px

function getVisibleItems(
  items:        WaterfallLayoutItem[],
  scrollTop:    number,
  clientHeight: number,
): WaterfallLayoutItem[] {
  const top    = scrollTop - OVERSCAN_PX
  const bottom = scrollTop + clientHeight + OVERSCAN_PX
  return items.filter((item) => item.y + item.height > top && item.y < bottom)
}

// ─────────────────────────────────────────────────────────
//  Hook
// ─────────────────────────────────────────────────────────

export interface UseWaterfallGridOptions {
  photos:    PhotoThumb[]
  config:    GridConfig | null
  /** 视图键：变化时滚动位置回到顶部（切换视图应从第一张照片开始） */
  resetKey?: string
}

export interface UseWaterfallGridResult {
  containerRef:  React.RefObject<HTMLDivElement | null>
  totalHeight:   number
  visibleItems:  WaterfallLayoutItem[]
  allPhotoIds:   string[]
}

export function useWaterfallGrid({
  photos,
  config,
  resetKey,
}: UseWaterfallGridOptions): UseWaterfallGridResult {
  const containerRef = useRef<HTMLDivElement>(null)
  const rafRef       = useRef<number | null>(null)

  // ── 布局计算（仅 photos/config 变化时触发）──
  const { items: allItems, totalHeight } = useMemo(() => {
    if (!config) return { items: [], totalHeight: 0 }
    return buildLayout(photos, config)
  }, [photos, config])

  // ── 扁平化 ID ──
  const allPhotoIds = useMemo(() => photos.map((p) => p.id), [photos])

  // ── 视口状态 ──
  //
  // 修复：可见切片改为渲染期推导。
  //   原实现把 visibleItems 放在 state 里由 effect 回填 → 数据变化的当帧先渲染
  //   空数组，浏览器画出「空白网格」，下一帧才出现照片。
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 0 })

  const commitViewport = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const scrollTop = el.scrollTop
    const height    = el.clientHeight
    setViewport((prev) =>
      prev.scrollTop === scrollTop && prev.height === height ? prev : { scrollTop, height },
    )
  }, [])

  // ── 布局阶段测量 + 监听滚动/尺寸 ──
  //   hasContainer：gridConfig 未算出时组件返回 null（容器不在 DOM 中），
  //   必须把「容器已挂载」纳入依赖，否则测量只会在没有容器时执行一次。
  const hasContainer = config != null

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return

    commitViewport()

    const ro = new ResizeObserver(commitViewport)
    ro.observe(el)

    const onScroll = () => {
      if (rafRef.current !== null) return
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        commitViewport()
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      ro.disconnect()
      el.removeEventListener('scroll', onScroll)
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [commitViewport, hasContainer])

  // ── 视图切换：滚动位置回到顶部 ──
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    if (el.scrollTop !== 0) el.scrollTop = 0
    setViewport((prev) =>
      prev.scrollTop === 0 && prev.height === el.clientHeight
        ? prev
        : { scrollTop: 0, height: el.clientHeight },
    )
  }, [resetKey, hasContainer])

  // ── 可见切片（渲染期推导）──
  const visibleItems = useMemo(
    () => getVisibleItems(allItems, viewport.scrollTop, viewport.height),
    [allItems, viewport.scrollTop, viewport.height],
  )

  return { containerRef, totalHeight, visibleItems, allPhotoIds }
}
