/**
 * @file src/features/library/hooks/useWaterfallLayout.ts
 * @description V2 瀑布流布局 Hook — typed arrays + 增量追加 + 视口查询
 *
 * 替代原 useWaterfallGrid 中的 buildLayout + getVisibleItems。
 * 核心改进：
 *   - 布局数据存储在 Float32Array（内存减少 ~80%）
 *   - 增量追加 O(N_new × columnCount)，不重算已有布局
 *   - 视口查询使用列内二分查找 O(C log(N/C) + V)
 */

import { useRef, useState, useEffect, useCallback, useMemo } from 'react'
import type { PhotoCollection } from '@/stores/collectionStore'
import { usePhotoEntityStore } from '@/stores/photoEntityStore'
import {
  createWaterfallState,
  buildWaterfallLayout,
  appendWaterfallLayout,
  needsFullRebuild,
  type WaterfallConfig,
  type WaterfallLayoutState,
  type WaterfallItem,
} from '../layout/waterfallLayout'
import { queryVisibleWaterfallItems } from '../layout/spatialIndex'

interface UseWaterfallLayoutOptions {
  collection: PhotoCollection | null
  config: WaterfallConfig | null
}

interface UseWaterfallLayoutResult {
  containerRef: React.RefObject<HTMLDivElement | null>
  totalHeight: number
  visibleItems: WaterfallItem[]
  allPhotoIds: string[]
}

export function useWaterfallLayout({
  collection,
  config,
}: UseWaterfallLayoutOptions): UseWaterfallLayoutResult {
  const containerRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number | null>(null)
  const layoutStateRef = useRef<WaterfallLayoutState | null>(null)
  const prevConfigRef = useRef<WaterfallConfig | null>(null)
  const prevCountRef = useRef(0)
  const entityStoreRef = useRef(usePhotoEntityStore.getState())

  // 订阅 entity store（仅更新 ref，不触发重渲染）
  useEffect(() => {
    const unsub = usePhotoEntityStore.subscribe((state) => {
      entityStoreRef.current = state
    })
    return unsub
  }, [])

  const [visibleItems, setVisibleItems] = useState<WaterfallItem[]>([])
  const [totalHeight, setTotalHeight] = useState(0)
  const [, forceUpdate] = useState(0)

  const orderedIds = collection?.orderedIds ?? []

  // ── 当 collection/config 变化时重建/增量更新布局 ──
  useEffect(() => {
    if (!config || !collection || orderedIds.length === 0) {
      layoutStateRef.current = null
      prevCountRef.current = 0
      prevConfigRef.current = config
      setTotalHeight(0)
      setVisibleItems([])
      return
    }

    const prevConfig = prevConfigRef.current
    const byId = entityStoreRef.current.byId
    const lookup = (id: string) => byId[id]

    let state = layoutStateRef.current

    if (!state || !prevConfig || needsFullRebuild(state, config)) {
      // config 变化 → full rebuild
      state = buildWaterfallLayout(orderedIds, lookup, config)
      prevConfigRef.current = config
      prevCountRef.current = orderedIds.length
    } else {
      // config 不变 → 增量追加
      const newIds = orderedIds.slice(prevCountRef.current)
      if (newIds.length > 0) {
        state = appendWaterfallLayout(state, newIds, lookup)
        prevCountRef.current = orderedIds.length
      }
    }

    layoutStateRef.current = state
    setTotalHeight(state.totalHeight)
    forceUpdate((n) => n + 1)
  }, [orderedIds, config, collection])

  // ── 视口查询 ──
  const recompute = useCallback(() => {
    rafRef.current = null
    const el = containerRef.current
    const state = layoutStateRef.current
    if (!el || !state) return

    const rawItems = queryVisibleWaterfallItems(state, el.scrollTop, el.clientHeight)

    // 通过 index 映射 photoId
    const ids = collection?.orderedIds ?? []
    const items: WaterfallItem[] = rawItems.map((raw) => ({
      ...raw,
      photoId: ids[raw.index] ?? '',
    }))

    setVisibleItems(items)
  }, [collection?.orderedIds])

  const scheduleRecompute = useCallback(() => {
    if (rafRef.current !== null) return
    rafRef.current = requestAnimationFrame(recompute)
  }, [recompute])

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

  useEffect(() => {
    recompute()
  }, [recompute])

  const allPhotoIds = useMemo(() => [...orderedIds], [orderedIds])

  return {
    containerRef,
    totalHeight,
    visibleItems,
    allPhotoIds,
  }
}

// 导出 state 工厂（供外部使用）
export { createWaterfallState }
