/**
 * @file src/features/library/grid/VirtualPhotoGrid.tsx
 * @description V2 虚拟化固定网格 — 使用轻量布局索引 + 二分查找
 *
 * 核心改进（vs 旧 VirtualGrid）：
 *   - 不再创建全量 rows 对象（100K 照片 → 0 个对象）
 *   - 使用 FixedGridIndex 轻量索引 + 二分查找定位可见行
 *   - 仅创建 visible row 对象（通常 < 20 个）
 *   - scroll handler 不做 Array filter
 *
 * 视觉输出与旧版完全一致，可无缝替换。
 */

import { useCallback, memo } from 'react'
import { useVirtualCollection } from '../hooks/useVirtualCollection'
import { useScrollVelocity } from '@/hooks/useScrollVelocity'
import { usePreloadThumbnails } from '@/hooks/useThumbnail'
import { useLayoutStore, selectGridConfig } from '@/stores/layoutStore'
import { usePhotoEntityStore } from '@/stores/photoEntityStore'
import type { PhotoCollection } from '@/stores/collectionStore'
import type { VisibleGridRow } from '../layout/types'
import type { PhotoEntity } from '@/domain/photo/photoTypes'
import { DateGroup } from '@/components/grid/DateGroup'
import { GridItem } from '@/components/grid/GridItem'

// ─────────────────────────────────────────────────────────
//  加载态骨架屏
// ─────────────────────────────────────────────────────────

function GridSkeleton({ columns, itemSize, gap }: { columns: number; itemSize: number; gap: number }) {
  return (
    <div style={{ padding: `0 ${gap}px`, display: 'flex', flexDirection: 'column', gap }}>
      {Array.from({ length: 8 }).map((_, rowIdx) => (
        <div key={rowIdx} style={{ display: 'flex', gap }}>
          {Array.from({ length: columns }).map((_, colIdx) => (
            <div
              key={colIdx}
              style={{
                width: itemSize,
                height: itemSize,
                borderRadius: 8,
                backgroundColor: 'var(--la-bg-raised)',
                animation: 'pulse 1.5s ease-in-out infinite',
              }}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────
//  空态
// ─────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: 'var(--la-text-muted)',
        gap: 12,
      }}
    >
      <div style={{ fontSize: 48 }}>📷</div>
      <div style={{ fontSize: 16, fontWeight: 500 }}>暂无照片</div>
      <div style={{ fontSize: 13, opacity: 0.7 }}>导入文件夹开始管理你的照片库</div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────
//  RowRenderer — 渲染单行
// ─────────────────────────────────────────────────────────

interface RowRendererProps {
  row: VisibleGridRow
  columns: number
  itemSize: number
  gap: number
  orderedIds: string[]
  allIds: string[]
}

const RowRenderer = memo(function RowRenderer({
  row,
  columns,
  itemSize,
  gap,
  orderedIds,
  allIds,
}: RowRendererProps) {
  const entities = usePhotoEntityStore((s) => s.byId)

  if (row.isHeader) {
    const groupPhotoIds: string[] = []
    for (let i = row.photoStart; i < row.photoEnd; i++) {
      const id = orderedIds[i]
      if (id) groupPhotoIds.push(id)
    }
    return (
      <DateGroup
        label={row.sectionLabel ?? ''}
        count={groupPhotoIds.length}
        photoIds={groupPhotoIds}
      />
    )
  }

  const photos: PhotoEntity[] = []
  for (let i = row.photoStart; i < row.photoEnd; i++) {
    const id = orderedIds[i]
    const entity = id ? entities[id] : undefined
    if (entity) photos.push(entity)
  }

  return (
    <div style={{ display: 'flex', gap }}>
      {photos.map((photo) => (
        <GridItem
          key={photo.id}
          photo={photo}
          size={itemSize}
          allIds={allIds}
        />
      ))}
      {photos.length < columns &&
        Array.from({ length: columns - photos.length }).map((_, i) => (
          <div key={`pad-${i}`} style={{ width: itemSize, height: itemSize, flexShrink: 0 }} />
        ))}
    </div>
  )
})

// ─────────────────────────────────────────────────────────
//  VirtualPhotoGrid — 主组件
// ─────────────────────────────────────────────────────────

interface VirtualPhotoGridProps {
  collection: PhotoCollection | null
  isLoading?: boolean
  onLoadMore?: () => void
  hasMore?: boolean
}

export const VirtualPhotoGrid = memo(function VirtualPhotoGrid({
  collection,
  isLoading = false,
  onLoadMore,
  hasMore = false,
}: VirtualPhotoGridProps) {
  const config = useLayoutStore(selectGridConfig)
  const { isFast, onScroll: onScrollVelocity } = useScrollVelocity()

  const {
    containerRef,
    totalHeight,
    offsetTop,
    offsetBottom,
    visibleRows,
    visiblePhotoIds,
    allPhotoIds,
  } = useVirtualCollection({
    collection,
    config: config ? { columns: config.columns, itemSize: config.itemSize, gap: config.gap } : null,
  })

  usePreloadThumbnails(visiblePhotoIds, 's', isFast)

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      onScrollVelocity(e)
      if (!onLoadMore || !hasMore) return
      const { scrollTop, scrollHeight, clientHeight } = e.currentTarget
      if (scrollTop + clientHeight >= scrollHeight * 0.85) {
        onLoadMore()
      }
    },
    [onScrollVelocity, onLoadMore, hasMore],
  )

  if (!config) return null
  const { columns, itemSize, gap } = config
  const isEmpty = !collection || (collection.orderedIds.length === 0 && !isLoading)

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      style={{
        height: '100%',
        overflowY: 'auto',
        overflowX: 'hidden',
        position: 'relative',
        backgroundColor: 'var(--la-bg-app)',
      }}
    >
      {isLoading && <GridSkeleton columns={columns} itemSize={itemSize} gap={gap} />}
      {isEmpty && <EmptyState />}

      {!isLoading && !isEmpty && (
        <div style={{ height: totalHeight, position: 'relative' }}>
          <div style={{ height: offsetTop }} />
          <div style={{ padding: `0 ${gap}px` }}>
            {visibleRows.map((row) => (
              <div
                key={row.rowIndex}
                style={{
                  height: row.height,
                  marginBottom: row.isHeader ? 0 : gap,
                }}
              >
                <RowRenderer
                  row={row}
                  columns={columns}
                  itemSize={itemSize}
                  gap={gap}
                  orderedIds={collection!.orderedIds}
                  allIds={allPhotoIds}
                />
              </div>
            ))}
          </div>
          <div style={{ height: offsetBottom }} />
        </div>
      )}
    </div>
  )
})
