/**
 * @file src/features/library/hooks/useVirtualCollection.ts
 * @description V2 虚拟化集合 Hook — 替代原 useVirtualGrid
 *
 * 核心改进：
 *   - 不再创建全量 rows 对象（100K 照片 → 0 个对象）
 *   - 使用 FixedGridIndex 轻量索引 + 二分查找
 *   - 仅创建 visible row 对象（通常 < 20 个）
 *   - scroll handler 本身不做 Array filter
 *   - range 没变化时不 setState
 */

import { useRef, useState, useEffect, useCallback, useMemo } from 'react'
import type { PhotoCollection } from '@/stores/collectionStore'
import type { FixedGridConfig, VisibleGridRow } from '../layout/types'
import { createFixedGridIndex, computeVisibleRows } from '../layout/fixedGridLayout'

const OVERSCAN_ROWS = 3

export interface UseVirtualCollectionOptions {
  collection: PhotoCollection | null
  config: Pick<FixedGridConfig, 'columns' | 'itemSize' | 'gap'> | null
}

export interface UseVirtualCollectionResult {
  containerRef: React.RefObject<HTMLDivElement | null>
  totalHeight: number
  offsetTop: number
  offsetBottom: number
  visibleRows: VisibleGridRow[]
  /** 可见照片 ID 数组（供缩略图预加载）*/
  visiblePhotoIds: string[]
  /** 全部照片 ID（供键盘导航 / 全选）*/
  allPhotoIds: string[]
  /** 视口中心照片 ID（缩略图高优先级）*/
  centerPhotoId: string | null
}

export function useVirtualCollection({
  collection,
  config,
}: UseVirtualCollectionOptions): UseVirtualCollectionResult {
  const containerRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number | null>(null)
  const scrollTopRef = useRef(0)

  // ── 构建轻量布局索引（仅 sections/config 变化时重建）──
  const gridIndex = useMemo(() => {
    if (!config || !collection || collection.sections.length === 0) return null
    return createFixedGridIndex(
      collection.sections,
      config,
    )
  }, [collection?.sections, config])


  // ── 总高度 ──
  const totalHeight = gridIndex?.totalHeight ?? 0

  // ── 全部照片 ID ──
  const allPhotoIds = useMemo(
    () => (collection?.orderedIds ? [...collection.orderedIds] : []),
    [collection?.orderedIds],
  )

  // ── 可见行范围 ──
  const [range, setRange] = useState({ startIdx: 0, endIdx: 0 })

  const recompute = useCallback(() => {
    rafRef.current = null
    const el = containerRef.current
    if (!el || !gridIndex) return
    const { scrollTop, clientHeight } = el
    scrollTopRef.current = scrollTop

    const visible = computeVisibleRows(gridIndex, scrollTop, clientHeight, OVERSCAN_ROWS)
    if (visible.length === 0) {
      setRange((prev) =>
        prev.startIdx === 0 && prev.endIdx === -1 ? prev : { startIdx: 0, endIdx: -1 },
      )
      return
    }
    const startIdx = visible[0]!.rowIndex
    const endIdx = visible[visible.length - 1]!.rowIndex
    setRange((prev) =>
      prev.startIdx === startIdx && prev.endIdx === endIdx
        ? prev
        : { startIdx, endIdx },
    )
  }, [gridIndex])

  // rAF 节流
  const scheduleRecompute = useCallback(() => {
    if (rafRef.current !== null) return
    rafRef.current = requestAnimationFrame(recompute)
  }, [recompute])

  // ── 绑定滚动事件 ──
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.addEventListener('scroll', scheduleRecompute, { passive: true })
    recompute()
    return () => {
      el.removeEventListener('scroll', scheduleRecompute)
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [scheduleRecompute, recompute])

  // ── 数据变化时强制重算 ──
  useEffect(() => {
    recompute()
  }, [gridIndex, recompute])

  // ── 计算可见行 ──
  const visibleRows = useMemo(() => {
    if (!gridIndex || range.endIdx < 0) return []
    return computeVisibleRows(
      gridIndex,
      scrollTopRef.current,
      containerRef.current?.clientHeight ?? 0,
      OVERSCAN_ROWS,
    )
  }, [gridIndex, range])

  // ── 可见照片 ID ──
  const visiblePhotoIds = useMemo(() => {
    const ids: string[] = []
    if (!collection) return []
    for (const row of visibleRows) {
      if (row.isHeader) continue
      for (let i = row.photoStart; i < row.photoEnd; i++) {
        const id = collection.orderedIds[i]
        if (id) ids.push(id)
      }
    }
    return ids
  }, [visibleRows, collection?.orderedIds])

  // ── 占位高度 ──
  const offsetTop = gridIndex && range.startIdx > 0
    ? gridIndex.getRowTop(range.startIdx)
    : 0
  const offsetBottom = useMemo(() => {
    if (!gridIndex || range.endIdx < 0) return 0
    const lastVisible = gridIndex.getRowTop(range.endIdx) +
      (gridIndex.isHeaderRow(range.endIdx) ? gridIndex.headerHeight : gridIndex.rowHeight)
    return Math.max(0, totalHeight - lastVisible)
  }, [gridIndex, range.endIdx, totalHeight])

  // ── 视口中心照片 ──
  const centerPhotoId = useMemo(() => {
    if (!containerRef.current || !collection) return null
    const clientH = containerRef.current.clientHeight
    const centerY = scrollTopRef.current + clientH / 2

    for (const row of visibleRows) {
      if (row.isHeader) continue
      if (row.top <= centerY && centerY < row.top + row.height) {
        const midIdx = Math.floor((row.photoStart + row.photoEnd) / 2)
        return collection.orderedIds[midIdx] ?? null
      }
    }
    return null
  }, [visibleRows, collection?.orderedIds])

  return {
    containerRef,
    totalHeight,
    offsetTop,
    offsetBottom,
    visibleRows,
    visiblePhotoIds,
    allPhotoIds,
    centerPhotoId,
  }
}
