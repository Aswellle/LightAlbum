/**
 * @file src/features/library/grid/WaterfallGridV2.tsx
 * @description V2 瀑布流网格 — 使用 typed arrays 布局引擎 + 列内二分查找
 *
 * 核心改进（vs 旧 WaterfallGrid）：
 *   - 布局数据使用 Float32Array（内存减少 ~80%）
 *   - 增量追加 O(N_new × columnCount)，不重算已有布局
 *   - 视口查询使用列内二分查找 O(C log(N/C) + V)
 *   - 不再为每个 item 创建完整 JS 对象
 *
 * 视觉输出与旧版完全一致。
 */

import { memo, useMemo } from 'react'
import { motion } from 'framer-motion'
import { useWaterfallLayout } from '../hooks/useWaterfallLayout'
import { useScrollVelocity } from '@/hooks/useScrollVelocity'
import { useThumbnail } from '@/hooks/useThumbnail'
import { useLayoutStore, selectGridConfig } from '@/stores/layoutStore'
import { usePreviewStore } from '@/stores/previewStore'
import { useSelectionStore, selectIsSelected } from '@/stores/selectionStore'
import { usePhotoEntityStore } from '@/stores/photoEntityStore'
import type { PhotoCollection } from '@/stores/collectionStore'
import type { WaterfallItem } from '../layout/waterfallLayout'

// ─────────────────────────────────────────────────────────
//  单个瀑布流项目
// ─────────────────────────────────────────────────────────

interface WaterfallItemProps {
  item: WaterfallItem
  allIds: string[]
  photoId: string
}

const WaterfallCell = memo(function WaterfallCell({ item, allIds, photoId }: WaterfallItemProps) {
  const { x, y, width, height } = item
  const { url } = useThumbnail(photoId, 'm', 'normal')

  const isSelected = useSelectionStore(selectIsSelected(photoId))
  const select = useSelectionStore((s) => s.select)
  const toggle = useSelectionStore((s) => s.toggle)
  const rangeSelect = useSelectionStore((s) => s.rangeSelect)
  const openPreview = usePreviewStore((s) => s.open)
  const photoIds = usePhotoEntityStore((s) => Object.keys(s.byId))

  const handleClick = (e: React.MouseEvent) => {
    if (e.shiftKey) {
      rangeSelect(photoId, allIds)
    } else if (e.ctrlKey || e.metaKey) {
      toggle(photoId)
    } else {
      select(photoId)
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      openPreview(photoId, photoIds, rect)
    }
  }

  return (
    <motion.div
      layoutId={`photo-${photoId}`}
      onClick={handleClick}
      whileHover={{ scale: 1.02 }}
      transition={{ duration: 0.15 }}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width,
        height,
        borderRadius: 8,
        overflow: 'hidden',
        cursor: 'pointer',
        boxShadow: isSelected
          ? '0 0 0 3px var(--la-accent)'
          : 'none',
      }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          backgroundColor: 'var(--la-bg-raised)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {url ? (
          <img
            src={url}
            alt=""
            loading="lazy"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
        ) : (
          <div style={{ color: 'var(--la-text-muted)', fontSize: 12 }}>...</div>
        )}
      </div>
    </motion.div>
  )
})

// ─────────────────────────────────────────────────────────
//  WaterfallGridV2 — 主组件
// ─────────────────────────────────────────────────────────

interface WaterfallGridV2Props {
  collection: PhotoCollection | null
}

export const WaterfallGridV2 = memo(function WaterfallGridV2({
  collection,
}: WaterfallGridV2Props) {
  const gridConfig = useLayoutStore(selectGridConfig)
  const { onScroll } = useScrollVelocity()

  // 转换 GridConfig → WaterfallConfig
  const config = useMemo(() => {
    if (!gridConfig) return null
    return {
      columnCount: gridConfig.columns,
      columnWidth: gridConfig.itemSize,
      gap: gridConfig.gap,
    }
  }, [gridConfig])

  const {
    containerRef,
    totalHeight,
    visibleItems,
    allPhotoIds,
  } = useWaterfallLayout({ collection, config })

  if (!config) return null

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      style={{
        height: '100%',
        overflowY: 'auto',
        overflowX: 'hidden',
        position: 'relative',
        backgroundColor: 'var(--la-bg-app)',
      }}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        {visibleItems.map((item) => (
          <WaterfallCell
            key={item.photoId}
            item={item}
            allIds={allPhotoIds}
            photoId={item.photoId}
          />
        ))}
      </div>
    </div>
  )
})
