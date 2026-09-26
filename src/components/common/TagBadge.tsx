/**
 * @file src/components/common/TagBadge.tsx
 * @description 标签色块徽章组件（Phase-B M-12）
 *
 * 用途：
 *   - 在照片右键菜单的「标签」子菜单中显示标签颜色标识
 *   - 在 TagEditor 弹窗的标签列表中显示
 *   - 在侧边栏 TagFilterPanel 中显示
 *
 * 设计原则：
 *   - 纯展示组件，接收 name/color，无内部状态
 *   - 尺寸变体：sm（侧边栏列表）/ md（编辑器）
 *   - 点击回调可选，有则显示 hover 效果
 */

import { memo, useState } from 'react'
import type { Tag } from '@/types/ipc'

interface TagBadgeProps {
  tag:      Tag
  size?:    'sm' | 'md'
  selected?: boolean
  onClick?: () => void
  onRemove?: () => void
}

export const TagBadge = memo(function TagBadge({
  tag,
  size = 'md',
  selected = false,
  onClick,
  onRemove,
}: TagBadgeProps) {
  const isSm = size === 'sm'
  const [hovered, setHovered] = useState(false)

  return (
    <span
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
      onMouseEnter={onClick ? () => setHovered(true) : undefined}
      onMouseLeave={onClick ? () => setHovered(false) : undefined}
      style={{
        display:        'inline-flex',
        alignItems:     'center',
        gap:            isSm ? '5px' : '6px',
        padding:        isSm ? '2px 7px' : '3px 9px',
        borderRadius:   '20px',
        fontSize:       isSm ? 'var(--la-text-xs)' : 'var(--la-text-sm)',
        fontWeight:     'var(--la-weight-semibold)',
        lineHeight:     1.45,
        cursor:         'default',
        userSelect:     'none',
        transition:     'background-color 120ms ease, border-color 120ms ease',
        // 不再用 opacity 削弱未选中标签：改为「同色描边 + 更低底色浓度」保持层级
        border:         `${selected ? 2 : 1.5}px solid ${tag.color}`,
        backgroundColor: selected
          ? tag.color + '3D'   // 24% 浓度
          : hovered
          ? tag.color + '2E'   // 18% 浓度（悬浮加深，而非变浅）
          : tag.color + '1F',  // 12% 浓度
        color:          'var(--la-text-primary)',
      }}
      title={tag.name}
    >
      {/* 色点 */}
      <span
        style={{
          width:        isSm ? '7px' : '8px',
          height:       isSm ? '7px' : '8px',
          borderRadius: '50%',
          backgroundColor: tag.color,
          flexShrink:   0,
        }}
        aria-hidden
      />
      <span
        style={{
          maxWidth:     isSm ? '80px' : '120px',
          overflow:     'hidden',
          textOverflow: 'ellipsis',
          whiteSpace:   'nowrap',
        }}
      >
        {tag.name}
      </span>

      {/* 移除按钮（可选） */}
      {onRemove && (
        <span
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          role="button"
          aria-label={`移除标签 ${tag.name}`}
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onRemove(); } }}
          style={{
            marginLeft:  '2px',
            fontSize:    isSm ? '11px' : '12px',
            lineHeight:  1,
            color:       'var(--la-text-secondary)',
            cursor:      'default',
            padding:     '0 1px',
            borderRadius: '50%',
          }}
        >
          ✕
        </span>
      )}
    </span>
  )
})
