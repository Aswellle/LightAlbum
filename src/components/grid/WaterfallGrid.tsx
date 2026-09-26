/**
 * @file src/components/grid/WaterfallGrid.tsx
 * @description 瀑布流布局网格
 *
 * 使用 useWaterfallGrid 计算每张图的绝对位置，
 * 通过绝对定位 + 上下 padding 占位实现虚拟化。
 * 照片保持原始宽高比（不裁切）。
 */

import { memo, useRef } from 'react'
import { motion } from 'framer-motion'
import { useWaterfallGrid } from '@/hooks/useWaterfallGrid'
import { useScrollVelocity } from '@/hooks/useScrollVelocity'
import { useThumbnail } from '@/hooks/useThumbnail'
import { useLayoutStore, selectGridConfig } from '@/stores/layoutStore'
import { usePhotoStore, selectPhotos } from '@/stores/photoStore'
import { usePreviewStore } from '@/stores/previewStore'
import { useSelectionStore, selectIsSelected } from '@/stores/selectionStore'
import { Icon } from '@/components/common/Icon'
import { GridEmptyState } from './GridEmptyState'
import { GridSkeleton } from './GridSkeleton'
import type { WaterfallLayoutItem } from '@/hooks/useWaterfallGrid'

// ─────────────────────────────────────────────────────────
//  单个瀑布流项目
// ─────────────────────────────────────────────────────────

interface WaterfallItemProps {
  item:    WaterfallLayoutItem
  allIds:  string[]
}

const WaterfallItem = memo(function WaterfallItem({ item, allIds }: WaterfallItemProps) {
  const { photo, x, y, width, height } = item
  const { url } = useThumbnail(photo.id, 'm', 'normal')

  // P0-2: 挂载时缩略图已缓存 → 不淡入（避免滚动回收/切换视图时整屏重复淡入）
  const hasThumbAtMount = useRef(url != null).current

  const isSelected  = useSelectionStore(selectIsSelected(photo.id))
  const select      = useSelectionStore((s) => s.select)
  const toggle      = useSelectionStore((s) => s.toggle)
  const rangeSelect = useSelectionStore((s) => s.rangeSelect)
  const openPreview = usePreviewStore((s) => s.open)
  const photoIds    = usePhotoStore(selectPhotos).map((p) => p.id)

  const handleClick = (e: React.MouseEvent) => {
    if (e.shiftKey) {
      rangeSelect(photo.id, allIds)
    } else if (e.ctrlKey || e.metaKey) {
      toggle(photo.id)
    } else {
      select(photo.id)
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      openPreview(photo.id, photoIds, rect)
    }
  }

  return (
    <motion.div
      layoutId={`photo-${photo.id}`}
      onClick={handleClick}
      whileHover={{ scale: 1.02 }}
      transition={{ duration: 0.15 }}
      // 与固定网格一致的合成层提示 + 统一的格子选择器（E2E 逐帧采样用）
      className="la-grid-item"
      style={{
        position:    'absolute',
        left:        x,
        top:         y,
        width,
        height,
        borderRadius: 6,
        overflow:    'hidden',
        cursor:      'default',
        outline:     isSelected ? '2px solid var(--la-accent)' : 'none',
        outlineOffset: '-2px',
      }}
    >
      {url ? (
        <motion.img
          src={url}
          alt={photo.fileName}
          initial={hasThumbAtMount ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
          style={{
            width:       '100%',
            height:      '100%',
            objectFit:   'cover',
            display:     'block',
            pointerEvents: 'none',
          }}
          draggable={false}
        />
      ) : (
        <div style={{
          width:           '100%',
          height:          '100%',
          backgroundColor: 'var(--la-bg-overlay)',
          backgroundImage: 'linear-gradient(90deg, var(--la-bg-overlay) 0%, var(--la-bg-hover) 50%, var(--la-bg-overlay) 100%)',
          backgroundSize:  '200% 100%',
          animation:       'la-shimmer 1.5s linear infinite',
        }} />
      )}

      {photo.isFavorite && (
        <div style={{
          position: 'absolute', top: 6, right: 6,
          filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))',
        }}>
          <Icon name="heart-fill" size={14} color="var(--la-favorite)" />
        </div>
      )}
    </motion.div>
  )
})

// ─────────────────────────────────────────────────────────
//  WaterfallGrid — 主组件
// ─────────────────────────────────────────────────────────

interface WaterfallGridProps {
  isLoading?: boolean
  /** 内容是否已对应当前视图（false 时不得渲染 store 中的旧照片） */
  isSynced?:  boolean
  /** 视图键：变化时滚动回顶部（切换视图从第一张照片开始） */
  viewKey?:   string
}

export const WaterfallGrid = memo(function WaterfallGrid({
  isLoading = false,
  isSynced  = true,
  viewKey,
}: WaterfallGridProps) {
  const config  = useLayoutStore(selectGridConfig)
  const photos  = usePhotoStore(selectPhotos)
  const allIds  = photos.map((p) => p.id)
  const { onScroll } = useScrollVelocity()

  const {
    containerRef,
    totalHeight,
    visibleItems,
  } = useWaterfallGrid({ photos, config, resetKey: viewKey })

  if (!config) return null

  // 三态互斥（与 VirtualGrid 一致）：
  //   切换视图时既不能闪空白网格，也不能闪「还没有照片」空态
  const { columns, itemSize, gap } = config
  const hasContent   = isSynced && photos.length > 0
  const showSkeleton = !hasContent && (isLoading || !isSynced)
  const showEmpty    = !hasContent && !isLoading && isSynced

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      data-testid="photo-grid"
      // 三态标记：E2E 逐帧断言「不出现空白网格 / 空态闪烁」的观测点
      data-grid-state={hasContent ? 'content' : showSkeleton ? 'skeleton' : 'empty'}
      style={{
        height:    '100%',
        overflowY: 'auto',
        overflowX: 'hidden',
        position:  'relative',
        backgroundColor: 'var(--la-bg-app)',
      }}
    >
      {/* 加载骨架屏（与固定网格共用，避免首屏/切换时出现空白内容区） */}
      {showSkeleton && <GridSkeleton columns={columns} itemSize={itemSize} gap={gap} />}

      {/* 空态 */}
      {showEmpty && <GridEmptyState />}

      {/* 内容 */}
      {hasContent && (
        <div style={{ height: totalHeight, position: 'relative' }}>
          {visibleItems.map((item) => (
            <WaterfallItem
              key={item.photo.id}
              item={item}
              allIds={allIds}
            />
          ))}
        </div>
      )}
    </div>
  )
})
