/**
 * @file src/features/library/hooks/usePhotoCollection.ts
 * @description V2 集合数据 Hook — 替代原 usePhotoData
 *
 * 职责：
 *   - 接收 PhotoFilter，生成稳定的 CollectionKey
 *   - 管理 TanStack Query useInfiniteQuery
 *   - 将分页结果归一化写入 EntityStore + CollectionStore
 *   - 暴露集合状态（orderedIds / sections / total / hasMore）
 *
 * 不做的事：
 *   - 不直接返回 pages（禁止 flatMap）
 *   - 不在组件中重构 groups
 *   - 一个 collection 只维护一个 ordered ID 数组
 *   - Filter 变更时使用新 CollectionKey，旧集合保留缓存
 *
 * 实现结构：
 *   usePhotoCollection(filter)
 *     ├── queryKey = ['photos', 'collection', collectionKey]
 *     ├── fetch page (via repository)
 *     ├── normalize items → EntityStore.upsertMany(items)
 *     └── update CollectionStore (replaceFirstPage / appendPage)
 */

import { useEffect, useMemo, useRef, useCallback } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import type { PhotoFilter } from '@/types/ipc'
import type { PhotoPage } from '@/types/photo'
import { usePhotoEntityStore } from '@/stores/photoEntityStore'
import {
  useCollectionStore,
  type PhotoCollection,
} from '@/stores/collectionStore'
import { fetchPhotoPage, PHOTO_PAGE_SIZE } from '@/data/photos/photoRepository'
import { buildCollectionKey } from '@/data/photos/photoQueries'
import type { PhotoEntity } from '@/domain/photo/photoTypes'

// ─────────────────────────────────────────────────────────
//  Hook 返回类型
// ─────────────────────────────────────────────────────────

export interface UsePhotoCollectionResult {
  /** 当前集合（含 orderedIds / sections / total）*/
  collection: PhotoCollection | null
  /** 是否正在加载首页 */
  isInitialLoading: boolean
  /** 是否正在加载更多页 */
  isFetchingMore: boolean
  /** 是否有更多页 */
  hasMore: boolean
  /** 错误 */
  error: Error | null
  /** 加载更多 */
  loadMore: () => void
  /** 刷新 */
  refresh: () => void
}

// ─────────────────────────────────────────────────────────
//  Hook
// ─────────────────────────────────────────────────────────

export function usePhotoCollection(
  filter: PhotoFilter,
  options: { enabled?: boolean } = {},
): UsePhotoCollectionResult {
  const { enabled = true } = options
  const collectionKey = useMemo(() => buildCollectionKey(filter), [filter])

  const upsertMany = usePhotoEntityStore((s) => s.upsertMany)
  const ensureCollection = useCollectionStore((s) => s.ensureCollection)
  const replaceFirstPage = useCollectionStore((s) => s.replaceFirstPage)
  const appendPage = useCollectionStore((s) => s.appendPage)
  const setLoading = useCollectionStore((s) => s.setLoading)

  // 确保集合存在
  ensureCollection(collectionKey)

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useInfiniteQuery({
    queryKey: ['photos', 'collection', collectionKey] as const,
    queryFn: ({ pageParam }) =>
      fetchPhotoPage(filter, pageParam as string | undefined, PHOTO_PAGE_SIZE),
    getNextPageParam: (lastPage: PhotoPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: undefined as string | undefined,
    staleTime: Infinity,
    gcTime: 10 * 60 * 1000,
    enabled,
  })

  // 跟踪已同步的页数，实现增量追加
  const prevPageCountRef = useRef(0)

  useEffect(() => {
    if (!data) {
      prevPageCountRef.current = 0
      return
    }

    const currentPageCount = data.pages.length
    const total = data.pages[0]?.total ?? 0

    if (prevPageCountRef.current === 0) {
      // 首次加载或缓存重置 — 全量替换（无论多少页都同步全部）
      const allIds: string[] = []
      const allEntities: PhotoEntity[] = []
      for (const page of data.pages) {
        upsertMany(page.items as PhotoEntity[])
        for (const item of page.items) {
          allIds.push(item.id)
          allEntities.push(item as PhotoEntity)
        }
      }
      replaceFirstPage(collectionKey, allIds, allEntities, total, data.pages[data.pages.length - 1]?.nextCursor ?? null)
    } else if (currentPageCount > prevPageCountRef.current) {
      // 新页追加 → 仅同步增量
      const newPages = data.pages.slice(prevPageCountRef.current)
      for (const page of newPages) {
        upsertMany(page.items as PhotoEntity[])
        appendPage(
          collectionKey,
          page.items.map((p) => p.id),
          page.items as PhotoEntity[],
          page.nextCursor,
        )
      }
    }
  }, [data, isFetching, isLoading, collectionKey, upsertMany, replaceFirstPage, appendPage, setLoading])

  const loadMore = useCallback(
    () => {
      if (hasNextPage && !isFetchingNextPage) fetchNextPage()
    },
    [hasNextPage, isFetchingNextPage, fetchNextPage],
  )

  const refresh = useCallback(() => {
    prevPageCountRef.current = 0
    refetch()
  }, [refetch])

  // 订阅当前集合状态
  const collection = useCollectionStore((s) => s.collections[collectionKey] ?? null)

  return {
    collection,
    isInitialLoading: isLoading,
    isFetchingMore: isFetchingNextPage,
    hasMore: hasNextPage ?? false,
    error: error as Error | null,
    loadMore,
    refresh,
  }
}
