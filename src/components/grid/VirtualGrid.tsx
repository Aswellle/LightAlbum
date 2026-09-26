/**
 * @file src/components/grid/VirtualGrid.tsx
 * @description 虚拟化网格渲染容器
 *
 * 职责：
 *   - 消费 useVirtualGrid 的计算结果
 *   - 渲染顶部/底部占位 div（撑起滚动条）
 *   - 渲染可见行（GroupHeaderRow 或 PhotoRow）
 *   - 将 preloadThumbnails 调用到 overscan 区域
 *   - 滚动触底时调用 onLoadMore（加载下一页）
 *   - 将 centerPhotoId 提升为 'high' 优先级缩略图请求
 *
 * 空态/加载态（P0-2 三态互斥）：
 *   - 内容已同步且有照片            → 渲染虚拟化网格
 *   - 内容尚未对应当前视图 / 首屏加载 → 骨架屏占位格矩阵
 *   - 内容已同步、无照片、不在加载中 → 空态提示（视图相关文案）
 *   三者互斥，避免切换视图时先闪一帧「空白网格」或「还没有照片」。
 *
 * 与 PhotoGrid 的分工：
 *   PhotoGrid  负责数据查询（usePhotoQuery）+ 视图路由
 *   VirtualGrid 负责纯渲染，接收 photos（已平铺的数组）
 */

import { useCallback, memo, useMemo } from 'react'
import { useVirtualGrid, type VirtualRow } from '@/hooks/useVirtualGrid'
import { useScrollVelocity } from '@/hooks/useScrollVelocity'
import { usePreloadThumbnails } from '@/hooks/useThumbnail'
import { useLayoutStore, selectGridConfig } from '@/stores/layoutStore'
import { usePhotoStore, selectGroups } from '@/stores/photoStore'
import { DateGroup } from './DateGroup'
import { GridItem } from './GridItem'
import { GridEmptyState } from './GridEmptyState'
import { GridSkeleton } from './GridSkeleton'

// ─────────────────────────────────────────────────────────
//  加载态骨架屏：见 GridSkeleton.tsx（与瀑布流共用）
// ─────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────
//  空态（共用组件：图案保留，可见度提升）
// ─────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────
//  RowRenderer — 渲染单行（分组标题 or 照片行）
// ─────────────────────────────────────────────────────────

interface RowRendererProps {
  row:       VirtualRow
  config:    NonNullable<ReturnType<typeof selectGridConfig>>
  allIds:    string[]
}

const RowRenderer = memo(function RowRenderer({ row, config, allIds }: RowRendererProps) {
  const { itemSize, gap } = config

  if (row.type === 'group-header') {
    return (
      <DateGroup
        label={row.label}
        count={row.count}
        photoIds={row.groupPhotoIds}  // Fix: pass only this group's photo IDs
      />
    )
  }

  // photo-row
  return (
    <div style={{
      display: 'flex',
      gap,
    }}>
      {row.photos.map((photo) => (
        <GridItem
          key={photo.id}
          photo={photo}
          size={itemSize}
          allIds={allIds}
        />
      ))}
      {/* 末行补空格，保持对齐 */}
      {row.photos.length < config.columns && Array.from({
        length: config.columns - row.photos.length,
      }).map((_, i) => (
        <div key={`pad-${i}`} style={{ width: itemSize, height: itemSize, flexShrink: 0 }} />
      ))}
    </div>
  )
})

// ─────────────────────────────────────────────────────────
//  VirtualGrid — 主组件
// ─────────────────────────────────────────────────────────

interface VirtualGridProps {
  isLoading?:  boolean
  /** 内容是否已对应当前视图（false 时不得渲染 store 中的旧照片） */
  isSynced?:   boolean
  /** 视图键：变化时滚动回顶部（切换视图从第一张照片开始） */
  viewKey?:    string
  onLoadMore?: () => void
  hasMore?:    boolean
}

export const VirtualGrid = memo(function VirtualGrid({
  isLoading  = false,
  isSynced   = true,
  viewKey,
  onLoadMore,
  hasMore    = false,
}: VirtualGridProps) {
  const config    = useLayoutStore(selectGridConfig)
  const groups    = usePhotoStore(selectGroups)

  const { isFast, onScroll: onScrollVelocity } = useScrollVelocity()

  const {
    containerRef,
    totalHeight,
    offsetTop,
    offsetBottom,
    visibleRows,
    allPhotoIds,
  } = useVirtualGrid({ groups, config, resetKey: viewKey })

  // ── 预加载 overscan 区域缩略图 ──
  const overscanIds = useMemo(() => {
    const ids: string[] = []
    for (const row of visibleRows) {
      if (row.type === 'photo-row') {
        row.photos.forEach((p) => ids.push(p.id))
      }
    }
    return ids
  }, [visibleRows])

  usePreloadThumbnails(overscanIds, 's', isFast)

  // ── 滚动触底加载更多 ──
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    onScrollVelocity(e)
    if (!onLoadMore || !hasMore) return
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget
    if (scrollTop + clientHeight >= scrollHeight * 0.85) {
      onLoadMore()
    }
  }, [onScrollVelocity, onLoadMore, hasMore])

  // ── 内容 / 骨架屏 / 空态（三态互斥）──
  //
  // P0-2：判定必须严格 ——
  //   hasContent 只在「内容已对应当前视图」时成立，否则会把上一个视图的照片当成当前视图渲染
  //   空态只在「内容已同步 + 确实没有照片 + 不在加载中」时出现，
  //   否则首屏加载、切换选项卡、切换筛选条件时都会先闪一下「还没有照片」
  if (!config) return null
  const { columns, itemSize, gap } = config
  const hasContent   = isSynced && groups.length > 0
  const showSkeleton = !hasContent && (isLoading || !isSynced)
  const showEmpty    = !hasContent && !isLoading && isSynced

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      data-testid="photo-grid"
      // 三态标记：E2E 逐帧断言「不出现空白网格 / 空态闪烁」的观测点
      data-grid-state={hasContent ? 'content' : showSkeleton ? 'skeleton' : 'empty'}
      style={{
        height:    '100%',
        overflowY: 'auto',
        overflowX: 'hidden',
        position:  'relative',
        // 背景：纯黑（深色）/ 纯白（浅色）—— 照片优先
        backgroundColor: 'var(--la-bg-app)',
      }}
    >
      {/* 加载骨架屏 */}
      {showSkeleton && <GridSkeleton columns={columns} itemSize={itemSize} gap={gap} />}

      {/* 空态 */}
      {showEmpty && <GridEmptyState />}

      {/* 虚拟化内容区 */}
      {hasContent && (
        <div style={{ height: totalHeight, position: 'relative' }}>
          {/* 上方占位 */}
          <div style={{ height: offsetTop }} />

          {/* 可见行 */}
          <div style={{ padding: `0 ${gap}px` }}>
            {visibleRows.map((row) => (
              <div
                key={row.key}
                style={{ height: row.height, marginBottom: row.type === 'photo-row' ? gap : 0 }}
              >
                <RowRenderer
                  row={row}
                  config={config}
                  allIds={allPhotoIds}
                />
              </div>
            ))}
          </div>

          {/* 下方占位 */}
          <div style={{ height: offsetBottom }} />
        </div>
      )}
    </div>
  )
})
