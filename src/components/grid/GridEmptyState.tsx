/**
 * @file src/components/grid/GridEmptyState.tsx
 * @description 照片网格空态（可见度改造 P0-1）
 *
 * 设计：
 *   - 保留原有「双相框 + 山峰」插画图案，仅提升描边与颜色可见度
 *   - 插画置于柔和底板圆形容器中，形成视觉焦点
 *   - 主文案 --la-text-base / semibold / --la-text-primary
 *   - 辅助文案 --la-text-sm / --la-text-secondary（不再使用弱化的 tertiary）
 *
 * 使用方：VirtualGrid（固定网格）、WaterfallGrid（瀑布流）
 */

import { memo } from 'react'

interface GridEmptyStateProps {
  /** 主文案 */
  title?: string
  /** 辅助说明 */
  hint?:  string
}

export const GridEmptyState = memo(function GridEmptyState({
  title = '没有照片',
  hint  = '点击「导入」按钮添加照片文件夹',
}: GridEmptyStateProps) {
  return (
    <div style={{
      height:         '100%',
      display:        'flex',
      flexDirection:  'column',
      alignItems:     'center',
      justifyContent: 'center',
      gap:            '14px',
      userSelect:     'none',
      padding:        '32px',
    }}>
      {/* 空态插画（图案不变，描边加粗 + 颜色提升为 secondary） */}
      <div style={{
        width:           '96px',
        height:          '96px',
        borderRadius:    '50%',
        backgroundColor: 'var(--la-bg-overlay)',
        display:         'flex',
        alignItems:      'center',
        justifyContent:  'center',
        flexShrink:      0,
      }}>
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none"
          stroke="var(--la-text-secondary)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
          aria-hidden="true" focusable="false">
          <rect x="4"  y="10" width="28" height="24" rx="3" />
          <rect x="12" y="4"  width="32" height="28" rx="3" />
          <circle cx="22" cy="19" r="4" />
          <path d="M12 32l6-6 4 4 6-8 4 10" />
        </svg>
      </div>

      <p style={{
        fontSize:   'var(--la-text-base)',
        fontWeight: 'var(--la-weight-semibold)',
        color:      'var(--la-text-primary)',
        margin:     0,
      }}>
        {title}
      </p>

      <p style={{
        fontSize:   'var(--la-text-sm)',
        color:      'var(--la-text-secondary)',
        textAlign:  'center',
        maxWidth:   '280px',
        lineHeight: 'var(--la-leading-relaxed)',
        margin:     0,
      }}>
        {hint}
      </p>
    </div>
  )
})
