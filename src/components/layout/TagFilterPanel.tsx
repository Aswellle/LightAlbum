/**
 * @file src/components/layout/TagFilterPanel.tsx
 * @description 侧边栏标签筛选区块（Fix v3）
 *
 * 修复：
 *   1. 空标签时 return null → 始终显示区块标题 + 引导文案
 *   2. 标签激活高亮与 currentView 联动（activeTagName）
 *   3. Fix 3：记住「进入标签视图前」的来源视图（prevViewRef）
 *      - 从相册视图点击标签 → 标签视图；再次点击同一标签 → 回到该相册
 *      - 从其他视图点击标签 → 标签视图；再次点击 → 回到 all_photos
 *      这样用户在相册内点击标签过滤后，可以无损回到相册
 */

import { useState, useRef, memo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/services/tauriIpc'
import { useUiStore, selectCurrentView } from '@/stores/uiStore'
import { TagBadge } from '@/components/common/TagBadge'
import { Icon } from '@/components/common/Icon'
import type { Tag } from '@/types/ipc'
import type { ViewState } from '@/types/layout'

interface TagFilterPanelProps {
  collapsed: boolean
}

export const TagFilterPanel = memo(function TagFilterPanel({ collapsed }: TagFilterPanelProps) {
  const [expanded, setExpanded] = useState(false)
  const setView     = useUiStore((s) => s.setView)
  const currentView = useUiStore(selectCurrentView)

  // Fix 3: 记住进入标签视图前的来源视图
  // 用 ref（不触发重渲染），在点击标签时更新，退出时恢复
  const prevViewRef = useRef<ViewState>({ type: 'all_photos' })

  // pending 期间不渲染「暂无标签」——首屏会闪一下空态
  const { data: tags = [], isPending: tagsPending } = useQuery<Tag[]>({
    queryKey: ['tags'],
    queryFn:  () => api.tags.list(),
    staleTime: 60_000,
  })

  // 当前激活的标签名（从 search view '#tagName' 中提取）
  const activeTagName =
    currentView.type === 'search' && currentView.query.startsWith('#')
      ? currentView.query.slice(1).trim()
      : ''

  const handleTagClick = (tag: Tag) => {
    const isActive = tag.name.toLowerCase() === activeTagName.toLowerCase()
    if (isActive) {
      // 再次点击同一已激活标签 → 退出标签视图，回到进入前的视图
      setView(prevViewRef.current)
    } else {
      // 记住来源视图（若当前已是标签搜索，则保持之前记录的来源不变）
      const isTagSearch = currentView.type === 'search' && currentView.query.startsWith('#')
      if (!isTagSearch) {
        prevViewRef.current = currentView
      }
      setView({ type: 'search', query: `#${tag.name}` })
    }
  }

  // 折叠侧边栏时仅显示图标占位
  if (collapsed) {
    return (
      <div style={{ padding: '6px 0', display: 'flex', justifyContent: 'center' }}>
        <span
          style={{ display: 'flex', color: tags.length > 0 ? 'var(--la-text-secondary)' : 'var(--la-text-tertiary)' }}
          title={tags.length > 0 ? `标签（${tags.length}）` : '标签'}
        >
          <Icon name="tag" size={16} strokeWidth={1.6} />
        </span>
      </div>
    )
  }

  const MAX_VISIBLE = 8
  const visible = expanded ? tags : tags.slice(0, MAX_VISIBLE)
  const hasMore  = tags.length > MAX_VISIBLE

  return (
    <div>
      {/* ── 分组标题行（与相册/文件夹分组标题统一字重与颜色）── */}
      <div style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        gap:            '6px',
        padding:        '6px 8px 3px 14px',
      }}>
        <span style={{
          fontSize:      'var(--la-text-xs)',
          fontWeight:    'var(--la-weight-bold)',
          color:         'var(--la-text-secondary)',
          letterSpacing: '0.06em',
          textTransform: 'uppercase' as const,
          userSelect:    'none' as const,
          flex:          1,
        }}>
          标签
        </span>
        {tags.length > 0 && (
          <span style={{
            fontSize:           'var(--la-text-xs)',
            fontWeight:         'var(--la-weight-medium)',
            color:              'var(--la-text-secondary)',
            fontVariantNumeric: 'tabular-nums',
            userSelect:         'none' as const,
          }}>
            {tags.length}
          </span>
        )}
      </div>

      {/* ── 空标签引导文案 ── */}
      {tags.length === 0 ? (
        tagsPending ? null : (
          <p style={{
          margin:     0,
          padding:    '2px 14px 6px',
          fontSize:   'var(--la-text-sm)',
          color:      'var(--la-text-secondary)',
          lineHeight: 1.5,
          userSelect: 'none' as const,
        }}>
          暂无标签，右键照片选择「管理标签」创建
          </p>
        )
      ) : (
        <>
          {/* ── 标签徽章列表 ── */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', padding: '2px 12px 2px' }}>
            {visible.map((tag) => {
              const isActive = tag.name.toLowerCase() === activeTagName.toLowerCase()
              return (
                <TagBadge
                  key={tag.id}
                  tag={tag}
                  size="sm"
                  selected={isActive}
                  onClick={() => handleTagClick(tag)}
                />
              )
            })}
          </div>

          {/* ── 展开/收起超出部分 ── */}
          {hasMore && (
            <button
              onClick={() => setExpanded((v) => !v)}
              style={{
                margin:      '4px 12px 0',
                background:  'transparent',
                border:      'none',
                color:       'var(--la-text-secondary)',
                fontSize:    'var(--la-text-xs)',
                fontWeight:  'var(--la-weight-medium)',
                cursor:      'default',
                padding:     '2px 0',
                userSelect:  'none' as const,
              }}
            >
              {expanded ? '收起' : `还有 ${tags.length - MAX_VISIBLE} 个…`}
            </button>
          )}
        </>
      )}
    </div>
  )
})
