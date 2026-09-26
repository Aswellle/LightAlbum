/**
 * @file src/hooks/usePhotoQuery.ts
 * @description 协调层 Hook — 视图感知、状态协调，委托数据获取给 usePhotoData
 *
 * 职责：
 *   - 从 layoutStore 读取 viewState
 *   - 调用 viewStateToFilter() 构建 PhotoFilter
 *   - 视图切换时清空选中（照片内容的替换由 usePhotoData 原子完成）
 *   - 将协调后的 filter 传给 usePhotoData
 *
 * 不做的事：
 *   - 不直接调用 api.*
 *   - 不管理 TanStack Query 状态
 *   - 不写入 photoStore（由 usePhotoData 负责）
 *
 * P0-2 闪烁修复：
 *   原实现在 filter 变化时立即 setPhotos([], 0) 清空 photoStore。
 *   但清空发生在 useEffect（绘制之后），而新数据要等 usePhotoData 的下一次
 *   同步才写入，于是内容区必然先画出一帧「照片为空」的画面：切选项卡时闪
 *   空白网格/空态提示，且新视图明明有缓存也要闪一次。
 *   现在内容替换完全交给 usePhotoData 的 viewKey 原子切换（绘制前完成），
 *   这里只负责清空选中项。
 */

import { useContext, useEffect, useMemo, useRef } from 'react'
import { useUiStore, selectCurrentView } from '@/stores/uiStore'
import { useLayoutStore, selectSortBy, selectSortAsc } from '@/stores/layoutStore'
import { useSelectionStore } from '@/stores/selectionStore'
import { viewStateToFilter } from '@/types/layout'
import { usePhotoData, type UsePhotoDataResult } from './usePhotoData'
import { AlbumContext } from '@/components/album/AlbumView'
import type { PhotoFilter } from '@/types/ipc'

export type { UsePhotoDataResult as UsePhotoQueryResult }

export interface UsePhotoQueryOptions {
  /**
   * false = 当前视图由其它 hook 提供数据（标签视图走 useTagPhotoQuery）。
   * 此时本 hook 不发起查询、不写入 photoStore，避免两个写入方互相覆盖造成闪烁。
   */
  enabled?: boolean
}

export function usePhotoQuery(options?: UsePhotoQueryOptions): UsePhotoDataResult {
  const enabled        = (options?.enabled ?? true)
  const currentView    = useUiStore(selectCurrentView)
  const sortBy         = useLayoutStore(selectSortBy)
  const sortAsc        = useLayoutStore(selectSortAsc)
  const resetSelection = useSelectionStore((s) => s.reset)
  // SEC-H3: read session token from AlbumContext (set by PrivateAlbumView on unlock)
  const { sessionToken } = useContext(AlbumContext)

  // 判断是否为 tag 搜索视图（由 useTagPhotoQuery 负责写入 photoStore）
  const isTagSearch =
    currentView.type === 'search' &&
    'query' in currentView &&
    typeof currentView.query === 'string' &&
    currentView.query.startsWith('#')

  // 构建 filter：视图特定字段（base）优先级高于 layoutStore 默认排序
  // SEC-H3: include sessionToken so backend can authorize private album access
  const filter = useMemo((): PhotoFilter => {
    if (isTagSearch) return { isDeleted: false }
    const base = viewStateToFilter(currentView)
    return {
      sortBy,
      sortAsc,
      ...base,
      ...(sessionToken != null ? { sessionToken } : {}),
    }
  }, [currentView, sortBy, sortAsc, isTagSearch, sessionToken])

  // 视图切换时清空选中（防止对已不在视图中的照片执行批量操作）
  const prevFilterRef = useRef<string>('')
  useEffect(() => {
    if (isTagSearch) return
    const curr = JSON.stringify(filter)
    if (prevFilterRef.current !== curr) {
      prevFilterRef.current = curr
      resetSelection()
    }
  }, [isTagSearch, filter, resetSelection])

  return usePhotoData(filter, { enabled: enabled && !isTagSearch })
}
