/**
 * @file src/components/preview/PreviewToolbar.tsx
 * @description 大图预览顶部工具栏（v2 — 移除 useConfirmDialog 上下文依赖）
 *
 * BugFix v2：
 *   原版使用 useConfirmDialog()，该 hook 依赖 <ConfirmDialogProvider> 上下文。
 *   当 PhotoPreview 的渲染路径在 provider 树之外（或 provider 被意外移除）时，
 *   useConfirmDialog 抛出 "must be used within <ConfirmDialogProvider>"，
 *   导致 PreviewToolbar 渲染崩溃 → 整个预览变为白屏。
 *
 *   修复方案：完全移除 useConfirmDialog 依赖，改为在组件内部维护
 *   本地 confirmState（useState），直接受控渲染 <ConfirmDialog>。
 *   PreviewToolbar 因此变为完全自包含组件，与外部 provider 树解耦。
 *
 * 其他代码（工具栏 UI、自动隐藏逻辑、收藏/删除/分享操作）完全不变。
 */

import { memo, useEffect, useRef, useCallback, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { usePreviewStore, selectIsExifOpen, selectIsUiHidden } from '@/stores/previewStore'
import { usePhotoStore } from '@/stores/photoStore'
import { ConfirmDialog, type ConfirmDialogOptions } from '@/components/common/ConfirmDialog'
import { Icon } from '@/components/common/Icon'
import { api } from '@/services/tauriIpc'
import { toast, useUiStore } from '@/stores/uiStore'
import type { IconName } from '@/components/common/Icon'

// ─────────────────────────────────────────────────────────
//  工具栏按钮
// ─────────────────────────────────────────────────────────

interface ToolbarBtnProps {
  iconName:  IconName
  label:     string
  onClick:   () => void
  active?:   boolean
  danger?:   boolean
  shortcut?: string
}

const ToolbarBtn = memo(function ToolbarBtn({
  iconName, label, onClick, active, danger, shortcut,
}: ToolbarBtnProps) {
  // 工具栏位于深色预览玻璃上（两种主题一致）：默认「次要文字」≥12:1，
  // hover 升到「主要文字」（只变强不变弱）；激活/危险态使用其语义文字色。
  const color = danger
    ? 'var(--la-danger-text)'
    : active
    ? 'var(--la-accent-text)'
    : 'var(--la-text-secondary)'

  return (
    <button
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={shortcut ? `${label}（${shortcut}）` : label}
      style={{
        display:         'flex',
        flexDirection:   'column',
        alignItems:      'center',
        justifyContent:  'center',
        gap:             '3px',
        // 单字标签仍为 44px（minWidth），多字标签（如「在资源管理器中显示」）按内容撑开不换行
        width:           'auto',
        minWidth:        '44px',
        padding:         '0 8px',
        height:          '44px',
        borderRadius:    'var(--la-radius-md)',
        backgroundColor: 'transparent',
        border:          'none',
        color,
        cursor:          'default',
        transition:      'background-color 100ms ease, color 100ms ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = 'var(--la-bg-hover)'
        if (!active && !danger) e.currentTarget.style.color = 'var(--la-text-primary)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = 'transparent'
        e.currentTarget.style.color = color
      }}
    >
      <Icon
        name={iconName}
        size={18}
        color="currentColor"
        style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))' }}
      />
      <span style={{
        fontSize:      'var(--la-text-xs)',
        fontWeight:    'var(--la-weight-medium)' as unknown as number,
        letterSpacing: '0.02em',
        lineHeight:    'var(--la-leading-tight)',
        whiteSpace:    'nowrap',
        // 工具栏遮罩自上而下淡出：标签位于最透明处，叠加照片内容时需要
        // 与 GridItem 一致的投影保证可读性（同仓库既有做法）。
        textShadow:    '0 1px 3px rgba(0,0,0,0.85)',
      }}>
        {label}
      </span>
    </button>
  )
})

// ─────────────────────────────────────────────────────────
//  useLocalConfirm — 本地命令式 confirm（无需 Context）
//
//  替代 useConfirmDialog hook，避免对 ConfirmDialogProvider 的依赖。
//  返回：
//    confirm(opts) → Promise<boolean>  命令式调用
//    dialogNode    → JSX               需渲染到组件树中
// ─────────────────────────────────────────────────────────

interface LocalConfirmState extends ConfirmDialogOptions {
  resolve: (value: boolean) => void
}

function useLocalConfirm() {
  const [state, setState]     = useState<LocalConfirmState | null>(null)
  const [loading, setLoading] = useState(false)

  const confirm = useCallback((opts: ConfirmDialogOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setState({ ...opts, resolve })
    })
  }, [])

  const handleConfirm = useCallback(() => {
    setLoading(true)
    state?.resolve(true)
    setTimeout(() => {
      setState(null)
      setLoading(false)
    }, 200)
  }, [state])

  const handleCancel = useCallback(() => {
    state?.resolve(false)
    setState(null)
    setLoading(false)
  }, [state])

  const dialogNode = (
    <ConfirmDialog
      open={state !== null}
      title={state?.title ?? ''}
      message={state?.message}
      confirmLabel={state?.confirmLabel}
      cancelLabel={state?.cancelLabel}
      variant={state?.variant}
      detail={state?.detail}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
      loading={loading}
    />
  )

  return { confirm, dialogNode }
}

// ─────────────────────────────────────────────────────────
//  PreviewToolbar — 主组件（v2）
// ─────────────────────────────────────────────────────────

interface PreviewToolbarProps {
  photoId: string
}

export const PreviewToolbar = memo(function PreviewToolbar({ photoId }: PreviewToolbarProps) {
  const close        = usePreviewStore((s) => s.close)
  const toggleExif   = usePreviewStore((s) => s.toggleExif)
  const setUiHidden  = usePreviewStore((s) => s.setUiHidden)
  const isExifOpen   = usePreviewStore(selectIsExifOpen)
  const isUiHidden   = usePreviewStore(selectIsUiHidden)
  const currentIndex = usePreviewStore((s) => s.currentIndex)
  const totalCount   = usePreviewStore((s) => s.photoIds.length)

  const photos       = usePhotoStore((s) => s.photos)
  const currentPhoto = photos.find((p) => p.id === photoId)

  const queryClient = useQueryClient()

  // v2：本地 confirm，无需 ConfirmDialogProvider 上下文
  const { confirm, dialogNode } = useLocalConfirm()

  const hideTimerRef = useRef<number | undefined>(undefined)

  // ── 自动隐藏逻辑（受「自动隐藏预览界面」开关控制）────
  const autoHidePreviewUi = useUiStore((s) => s.autoHidePreviewUi)

  const resetHideTimer = useCallback(() => {
    setUiHidden(false)
    clearTimeout(hideTimerRef.current)   // 传 null/undefined 本就是 no-op，无需守卫
    if (!autoHidePreviewUi) return       // 关闭自动隐藏：界面常显
    hideTimerRef.current = setTimeout(() => setUiHidden(true), 2000)
  }, [setUiHidden, autoHidePreviewUi])

  useEffect(() => {
    resetHideTimer()
    window.addEventListener('mousemove', resetHideTimer)
    window.addEventListener('keydown',   resetHideTimer)
    return () => {
      window.removeEventListener('mousemove', resetHideTimer)
      window.removeEventListener('keydown',   resetHideTimer)
      clearTimeout(hideTimerRef.current)
    }
  }, [resetHideTimer])

  // ── 收藏 Mutation ────────────────────────────────────
  // AR-H3: onMutate = optimistic update; onError = rollback; onSettled = sync cache
  const favMutation = useMutation({
    mutationFn: (fav: boolean) => api.photos.setFavorite(photoId, fav),
    onMutate: (fav) => {
      const prev = usePhotoStore.getState().photos.find((p) => p.id === photoId)?.isFavorite
      usePhotoStore.getState().updatePhoto(photoId, { isFavorite: fav })
      return { prev }
    },
    onError: (_, __, context) => {
      if (context?.prev !== undefined) {
        usePhotoStore.getState().updatePhoto(photoId, { isFavorite: context.prev })
      }
      toast.error('操作失败')
    },
    onSettled: () => {
      queryClient.resetQueries({ queryKey: ['photos'] })
      queryClient.invalidateQueries({ queryKey: ['stats'] })
    },
  })

  const isFavorite = currentPhoto?.isFavorite ?? false

  // ── 删除 ────────────────────────────────────────────
  const handleDelete = useCallback(async () => {
    const ok = await confirm({
      title:        '删除照片',
      message:      '照片将移入回收站，可在回收站中恢复',
      confirmLabel: '删除',
      variant:      'danger',
    })
    if (!ok) return
    try {
      await api.photos.delete([photoId])
      usePhotoStore.getState().removePhotos([photoId])
      queryClient.invalidateQueries({ queryKey: ['photos'] })
      close()
      toast.success('已移入回收站', {
        label:   '撤销',
        onClick: async () => {
          await api.photos.restore([photoId])
          queryClient.invalidateQueries({ queryKey: ['photos'] })
          toast.success('已恢复')
        },
      })
    } catch {
      toast.error('删除失败')
    }
  }, [photoId, confirm, close, queryClient])

  // ── 分享（复制路径到剪贴板）────────────────────────
  const handleShare = useCallback(async () => {
    if (!photoId) return
    try {
      const photo = await api.photos.get(photoId)
      await navigator.clipboard.writeText(photo.filePath)
      toast.success('文件路径已复制到剪贴板')
    } catch {
      toast.error('复制失败')
    }
  }, [photoId])

  // ── 在资源管理器中显示（定位原始文件）─────────────
  const handleReveal = useCallback(async () => {
    try {
      await api.photos.reveal(photoId)
    } catch {
      // 失败原因由 ipc 层按错误码弹出（如 PHOTO_NOT_FOUND），此处不重复提示
    }
  }, [photoId])

  return (
    <>
      <AnimatePresence>
        {!isUiHidden && (
          <motion.header
            key="toolbar"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0  }}
            exit={{    opacity: 0, y: -8 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            style={{
              position:        'absolute',
              top:             0,
              left:            0,
              right:           0,
              zIndex:          20,
              display:         'flex',
              alignItems:      'center',
              justifyContent:  'space-between',
              padding:         '0 8px',
              height:          '56px',
              flexShrink:      0,
              background:      'linear-gradient(to bottom, rgba(0,0,0,0.65) 0%, transparent 100%)',
              pointerEvents:   'auto',
            }}
          >
            {/* 左侧：关闭 + 计数 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                onClick={close}
                aria-label="关闭预览（Esc）"
                title="关闭预览（Esc）"
                style={{
                  display:         'flex',
                  alignItems:      'center',
                  justifyContent:  'center',
                  width:           '36px',
                  height:          '36px',
                  borderRadius:    'var(--la-radius-md)',
                  backgroundColor: 'var(--la-bg-hover)',
                  border:          'none',
                  color:           'var(--la-text-primary)',
                  cursor:          'default',
                  transition:      'background-color 100ms ease',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--la-bg-active)' }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--la-bg-hover)' }}
              >
                <Icon name="x" size={16} strokeWidth={2} style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))' }} />
              </button>

              {/* 计数 */}
              <span style={{
                fontSize:   'var(--la-text-sm)',
                color:      'var(--la-text-secondary)',
                textShadow: '0 1px 3px rgba(0,0,0,0.85)',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {currentIndex + 1} / {totalCount}
              </span>

              {/* 文件名 */}
              {currentPhoto && (
                <span style={{
                  fontSize:     'var(--la-text-sm)',
                  color:        'var(--la-text-primary)',
                  fontWeight:   'var(--la-weight-semibold)' as unknown as number,
                  textShadow:   '0 1px 3px rgba(0,0,0,0.85)',
                  maxWidth:     '300px',
                  overflow:     'hidden',
                  whiteSpace:   'nowrap',
                  textOverflow: 'ellipsis',
                }}>
                  {currentPhoto.fileName}
                </span>
              )}
            </div>

            {/* 右侧：操作按钮组 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
              <ToolbarBtn
                iconName={isFavorite ? 'heart-fill' : 'heart'}
                label="收藏"
                shortcut="F"
                active={isFavorite}
                onClick={() => favMutation.mutate(!isFavorite)}
              />
              <ToolbarBtn
                iconName="info"
                label="信息"
                shortcut="I"
                active={isExifOpen}
                onClick={toggleExif}
              />
              <ToolbarBtn
                iconName="share"
                label="复制"
                onClick={handleShare}
              />
              <ToolbarBtn
                iconName="folder-open"
                label="在资源管理器中显示"
                onClick={handleReveal}
              />
              <div style={{ width: '1px', height: '20px', backgroundColor: 'var(--la-divider)', margin: '0 4px' }} />
              <ToolbarBtn
                iconName="trash"
                label="删除"
                danger
                onClick={handleDelete}
              />
            </div>
          </motion.header>
        )}
      </AnimatePresence>

      {/* v2：本地 ConfirmDialog，与 Provider 树完全解耦 */}
      {dialogNode}
    </>
  )
})
