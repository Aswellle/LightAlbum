/**
 * @file src/hooks/useTagPhotoQuery.ts
 * @description 标签视图照片查询 Hook（Fix: 标签搜索功能）
 *
 * 问题：
 *   TagFilterPanel 点击标签 → setView({type:'search', query:'#tagName'})
 *   但 usePhotoQuery 把 search 视图当做普通列表查询（photos_list），
 *   完全不处理 '#tagName' 语法，标签过滤无效。
 *
 * 方案：
 *   在 search 视图且 query 以 '#' 开头时：
 *     1. 从 tags 缓存中查找同名标签，取其 id
 *     2. 调用 api.search.query({ tagIds: [tagId] }) 获取带该标签的照片
 *     3. 同步结果到 photoStore（与 usePhotoQuery 接口兼容）
 *   返回 { isTagSearch, isSynced, viewKey } 供外层决定是否替代 usePhotoQuery。
 *
 * 使用方：PhotoGrid 中检测当前是否为标签搜索视图，若是则用本 hook。
 *
 * P0-2 闪烁修复：
 *   - 同步改用 useLayoutEffect（原 useEffect 在绘制后才写 store → 先闪一帧空内容）
 *   - 标签视图的首页/清空同样在绘制前完成；标签列表尚未加载完时不显示空态
 *   - 暴露 isSynced：为 false 时渲染层必须显示骨架屏，不得显示空态
 *   - usePhotoQuery 在标签视图下被禁用（enabled=false），避免两个写入方互相覆盖
 */

import { useLayoutEffect, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/services/tauriIpc'
import { useUiStore, selectCurrentView } from '@/stores/uiStore'
import { usePhotoStore } from '@/stores/photoStore'
import { useSelectionStore } from '@/stores/selectionStore'
import type { Tag } from '@/types/ipc'

export interface UseTagPhotoQueryResult {
  /** 当前是否是标签搜索模式（query 以 # 开头） */
  isTagSearch: boolean
  /** 提取的标签名（不含 #） */
  tagName:     string
  isLoading:   boolean
  /** photoStore 内容是否已对应当前标签视图 */
  isSynced:    boolean
  /** 标签视图键（供内容区判断是否需要重置滚动位置） */
  viewKey:     string
  totalCount:  number
}

/** 从 search view query 中提取标签名（去掉 # 前缀，trim） */
function extractTagName(query: string): string {
  return query.startsWith('#') ? query.slice(1).trim() : ''
}

export function useTagPhotoQuery(): UseTagPhotoQueryResult {
  const currentView  = useUiStore(selectCurrentView)
  const setPhotos    = usePhotoStore((s) => s.setPhotos)
  const resetSelection = useSelectionStore((s) => s.reset)

  // 只在 search 视图且 query 以 '#' 开头时激活
  const isTagSearch =
    currentView.type === 'search' &&
    'query' in currentView &&
    typeof currentView.query === 'string' &&
    currentView.query.startsWith('#')

  const tagName = isTagSearch
    ? extractTagName(currentView.query)
    : ''

  const viewKey = `tag:${tagName.toLowerCase()}`

  // 获取所有标签列表，从中找到匹配的标签 id
  const { data: allTags = [], isLoading: tagsLoading } = useQuery<Tag[]>({
    queryKey: ['tags'],
    queryFn:  () => api.tags.list(),
    staleTime: 60_000,
    enabled:   isTagSearch,
  })

  const matchedTag = useMemo(() =>
    allTags.find((t) => t.name.toLowerCase() === tagName.toLowerCase()),
    [allTags, tagName]
  )

  // 用 search_photos 接口按 tagIds 查询照片
  const { data: searchResult, isLoading: searchLoading } = useQuery({
    queryKey: ['tag-photos', matchedTag?.id ?? ''],
    queryFn:  async () => {
      if (!matchedTag) return { items: [], nextCursor: null, total: 0 }
      return api.search.query({
        tagIds: [matchedTag.id],
        limit:  500,  // 标签视图一次性加载（标签下照片一般不超过500）
      })
    },
    enabled:   isTagSearch && !!matchedTag,
    staleTime: 30_000,
  })

  const isLoading = isTagSearch && (tagsLoading || searchLoading)

  // P0-2: 离开标签视图后作废同步标记，再次进入同一标签时必须重新同步
  const syncedKeyRef = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (isTagSearch) return
    syncedKeyRef.current = null
  }, [isTagSearch])

  // P0-2: 绘制前同步 —— 切换标签时同一帧内替换，不留「空网格/空态」中间帧
  useLayoutEffect(() => {
    if (!isTagSearch) return

    if (syncedKeyRef.current !== viewKey) {
      // ── 切换到另一个标签（或首次进入）──
      syncedKeyRef.current = viewKey
      resetSelection()
      if (!tagsLoading && searchResult) {
        setPhotos(searchResult.items, searchResult.total)
      } else {
        // 尚无数据：清空，由渲染层显示骨架屏
        setPhotos([], 0)
      }
      return
    }

    if (tagsLoading || searchLoading) return

    if (searchResult) {
      setPhotos(searchResult.items, searchResult.total)
    } else if (!matchedTag) {
      // 标签名未找到 → 空态
      setPhotos([], 0)
    }
  }, [
    isTagSearch,
    viewKey,
    tagsLoading,
    searchLoading,
    searchResult,
    matchedTag,
    setPhotos,
    resetSelection,
  ])

  return {
    isTagSearch,
    tagName,
    isLoading,
    isSynced:   isTagSearch && syncedKeyRef.current === viewKey,
    viewKey,
    totalCount: searchResult?.total ?? 0,
  }
}
