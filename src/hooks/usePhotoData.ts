/**
 * @file src/hooks/usePhotoData.ts
 * @description 纯数据层 Hook — 只知道 PhotoFilter，不感知视图类型
 *
 * 职责：
 *   - 接收 PhotoFilter 参数
 *   - 管理 TanStack Query useInfiniteQuery
 *   - 将分页结果同步到 photoStore
 *   - 暴露 fetchMore / hasMore / isLoading / isSynced
 *
 * 不做的事：
 *   - 不读取 viewState / layoutStore
 *   - 不重置 selectionStore
 *   - 不处理视图切换逻辑
 *
 * PERF-C1（保留）：
 *   第 k+1 页只追加增量（appendPhotos），避免每次翻页都 O(N) 全量重建。
 *
 * P0-2 闪烁修复（本文件的核心不变量）：
 *   photoStore 中的内容**永远要么属于当前视图，要么为空**，且状态切换发生在
 *   浏览器绘制之前，因此内容区不会出现「空网格 / 空态提示」的中间帧。
 *   1. 同步改用 useLayoutEffect（原实现是 useEffect —— 在绘制之后才写入 store，
 *      于是先画出一帧「照片为空」的画面：启动时闪空态、切视图时闪空白网格）。
 *   2. 视图键（viewKey）变化 = 切换视图：
 *        - 新视图已有缓存 → 同一帧内一次性替换（无中间状态）
 *        - 新视图尚无数据 → 立即清空（配合 isSynced=false 渲染骨架屏，而不是空态）
 *   3. 当前视图的**首页**到达时也必须在绘制前同步（否则又会闪一帧空内容）；
 *      只有「滚动加载的追加页」才走 startTransition 的非紧急更新。
 *   4. isSynced 暴露给渲染层：为 false 时 store 里可能还是上一个视图的照片，
 *      渲染层必须显示骨架屏而不是内容，也不能显示空态。
 */

import {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useMemo,
  startTransition,
} from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { api } from '@/services/tauriIpc'
import { usePhotoStore } from '@/stores/photoStore'
import { AlbumContext } from '@/components/album/AlbumView'
import { isIpcError } from '@/types/ipc'
import type { PhotoFilter } from '@/types/ipc'
import type { PhotoThumb } from '@/types/photo'

const PAGE_SIZE = 100

export interface UsePhotoDataResult {
  isLoading:      boolean
  isFetchingMore: boolean
  hasMore:        boolean
  totalCount:     number
  loadMore:       () => void
  error:          Error | null
  /** 当前视图键（filter 的稳定序列化），视图切换时变化 */
  viewKey:        string
  /**
   * photoStore 中的内容是否已经对应当前视图。
   * false = 内容属于上一个视图或尚未写入 → 渲染层只能显示骨架屏。
   */
  isSynced:       boolean
}

export interface UsePhotoDataOptions {
  /** false = 不发起查询、不写入 store（标签视图由 useTagPhotoQuery 接管） */
  enabled?: boolean
}

export function usePhotoData(
  filter: PhotoFilter,
  options?: UsePhotoDataOptions,
): UsePhotoDataResult {
  const enabled      = options?.enabled ?? true
  const setPhotos    = usePhotoStore((s) => s.setPhotos)
  const appendPhotos = usePhotoStore((s) => s.appendPhotos)
  const setFetching  = usePhotoStore((s) => s.setIsFetchingMore)
  // SEC-H3: re-lock private album when backend rejects the session token
  const { onTokenExpired } = useContext(AlbumContext)

  // P0-2: 视图键 —— 用于判断 store 内容是否属于当前查询
  const viewKey = useMemo(() => JSON.stringify(filter), [filter])

  // P0-2: 已同步到 photoStore 的视图键 / 页数 / 数据引用
  //   syncedKeyRef  —— 判断 store 内容是否属于当前视图
  //   syncedDataRef —— 判断查询数据是否变化（含 resetQueries / invalidateQueries 后的重新拉取）
  const syncedKeyRef   = useRef<string | null>(null)
  const syncedPagesRef = useRef(0)
  const syncedDataRef  = useRef<typeof data>(null)

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    isLoading,
    error,
  } = useInfiniteQuery({
    queryKey: ['photos', filter] as const,
    queryFn: ({ pageParam, queryKey }) => {
      const qFilter = queryKey[1] as PhotoFilter
      return api.photos.list(qFilter, pageParam as string | undefined, PAGE_SIZE)
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: undefined as string | undefined,
    staleTime: Infinity,
    gcTime:    10 * 60 * 1000,
    // 标签视图由 useTagPhotoQuery 负责，禁止两个写入方竞争同一个 store
    enabled,
  })

  // P0-2: 被禁用（标签视图接管 store）时作废同步标记，
  //       重新启用时必须重新同步，否则会沿用上一个视图遗留的内容
  useLayoutEffect(() => {
    if (enabled) return
    syncedKeyRef.current   = null
    syncedPagesRef.current = 0
  }, [enabled])

  // P0-2: 必须在绘制前同步 —— useEffect 会先画一帧空内容
  useLayoutEffect(() => {
    if (!enabled) return

    const pages = data?.pages
    const total = pages?.[0]?.total ?? 0

    if (syncedKeyRef.current !== viewKey) {
      // ── 视图切换：同一帧内完成替换或清空，不留中间态 ──
      syncedKeyRef.current = viewKey
      syncedDataRef.current = data ?? null

      if (pages && pages.length > 0) {
        // 新视图已有缓存（含首页已加载但后续页未加载的情况）
        const all: PhotoThumb[] = []
        for (const page of pages) all.push(...page.items)
        syncedPagesRef.current = pages.length
        setPhotos(all, total)
      } else {
        // 新视图尚无数据：清空，由渲染层显示骨架屏（isLoading=true）
        syncedPagesRef.current = 0
        setPhotos([], 0)
      }

      setFetching(Boolean(isFetchingNextPage))
      return
    }

    if (!pages || pages.length === 0) {
      // 当前视图的查询数据被清除（resetQueries 等）→ 下次数据到达必须整体替换。
      // 此时不动 store：保留画面上的内容，避免把网格换成骨架屏闪一下。
      syncedPagesRef.current = 0
      syncedDataRef.current  = null
      return
    }

    if (data === syncedDataRef.current) return   // 数据未变化

    const syncedPages = syncedPagesRef.current

    if (syncedPages === 0) {
      // ── 当前视图首页到达 / 缓存被清除后重新拉取：必须绘制前整体替换 ──
      syncedDataRef.current  = data
      syncedPagesRef.current = pages.length
      const all: PhotoThumb[] = []
      for (const page of pages) all.push(...page.items)
      setPhotos(all, total)
      setFetching(Boolean(isFetchingNextPage))
      return
    }

    if (pages.length > syncedPages) {
      // ── 滚动加载的追加页：非紧急更新，保持滚动流畅 ──
      syncedDataRef.current  = data
      syncedPagesRef.current = pages.length
      const appended = pages.slice(syncedPages)
      startTransition(() => {
        for (const page of appended) appendPhotos(page.items)
        setFetching(Boolean(isFetchingNextPage))
      })
      return
    }

    if (isFetching) {
      // ── 重新拉取中的中间态 ──
      //   infinite query 重新取数时会先给出「页数更少」的中间结果，
      //   直接同步会让已加载的内容先缩短再长回来（可见的内容跳动）。
      //   这里不记录数据引用：取数结束时 deps 变化会再次进入本 effect，
      //   用最终结果在绘制前一次性替换。
      syncedPagesRef.current = syncedPages
      return
    }

    // ── 取数结束后的权威结果（收藏 / 删除 / 扫描完成等失效重取）：绘制前整体替换 ──
    syncedDataRef.current  = data
    syncedPagesRef.current = pages.length
    const all: PhotoThumb[] = []
    for (const page of pages) all.push(...page.items)
    setPhotos(all, total)
    setFetching(Boolean(isFetchingNextPage))
  }, [enabled, viewKey, data, isFetching, isFetchingNextPage, setPhotos, appendPhotos, setFetching])

  // SEC-H3: when the backend rejects the session token, trigger re-lock on the private album
  useEffect(() => {
    if (isIpcError(error) && error.code === 'TOKEN_REQUIRED') {
      onTokenExpired()
    }
  }, [error, onTokenExpired])

  const loadMore = useMemo(
    () => () => { if (hasNextPage && !isFetchingNextPage) fetchNextPage() },
    [hasNextPage, isFetchingNextPage, fetchNextPage],
  )

  return {
    isLoading,
    isFetchingMore: isFetchingNextPage,
    hasMore:        hasNextPage ?? false,
    totalCount:     data?.pages[0]?.total ?? 0,
    loadMore,
    error:          error as Error | null,
    viewKey,
    isSynced:       enabled && syncedKeyRef.current === viewKey,
  }
}
