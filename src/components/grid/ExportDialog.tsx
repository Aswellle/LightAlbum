/**
 * @file src/components/grid/ExportDialog.tsx
 * @description 导出为 JPEG/PNG（HEIC/RAW 转码）— 目标目录 / 格式 / 质量 / 尺寸 + 进度
 *
 * 语义说明：本项目的图库是**原地索引**，照片本来就在用户自己的文件夹里，
 * 因此这里的「导出」是**格式转换**（把系统打不开的 HEIC/RAW 转成 JPEG/PNG，
 * 或按需要的尺寸/质量另存一份），而不是「把原件复制出来」。
 */

import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { api } from '@/services/tauriIpc'
import { listenTyped } from '@/services/eventBus'
import { toast } from '@/stores/uiStore'

interface ExportDialogProps {
  /** 要导出的照片 id（来自当前选区） */
  photoIds: string[]
  onClose:  () => void
}

type ExportFormat = 'auto' | 'jpeg' | 'png'

const FORMAT_OPTIONS: Array<{ value: ExportFormat; label: string }> = [
  { value: 'auto', label: '自动' },
  { value: 'jpeg', label: 'JPEG' },
  { value: 'png',  label: 'PNG'  },
]

const labelStyle: CSSProperties = {
  fontSize: 'var(--la-text-xs)', color: 'var(--la-text-secondary)',
  fontWeight: 'var(--la-weight-medium)', marginBottom: '6px',
}

const fieldStyle: CSSProperties = {
  width: '100%', backgroundColor: 'var(--la-bg-overlay)',
  border: '1px solid var(--la-border)', borderRadius: 'var(--la-radius-md)',
  padding: '8px 12px', fontSize: 'var(--la-text-sm)',
  color: 'var(--la-text-primary)', outline: 'none', userSelect: 'text',
}

export function ExportDialog({ photoIds, onClose }: ExportDialogProps) {
  const [destDir, setDestDir]   = useState<string | null>(null)
  const [format, setFormat]     = useState<ExportFormat>('auto')
  const [quality, setQuality]   = useState(90)
  const [maxDim, setMaxDim]     = useState('')
  const [running, setRunning]   = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  // 导出期间不响应 Esc / 遮罩关闭：后台仍在写文件，关掉只会让用户以为已取消
  useEffect(() => {
    if (running) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [running, onClose])

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    listenTyped('export:progress', (p) => {
      if (!disposed) setProgress({ done: p.done, total: p.total })
    }).then((fn) => { if (disposed) fn(); else unlisten = fn })
    return () => { disposed = true; unlisten?.() }
  }, [])

  const pickDir = async () => {
    const dir = await api.folders.pick()
    if (dir) setDestDir(dir)
  }

  const maxDimValue = Number.parseInt(maxDim, 10)
  const parsedMaxDim = Number.isFinite(maxDimValue) && maxDimValue > 0 ? maxDimValue : undefined
  const showQuality = format !== 'png'
  const canExport = destDir !== null && !running

  const handleExport = async () => {
    if (!destDir || running) return
    setRunning(true)
    setProgress({ done: 0, total: photoIds.length })

    try {
      const summary = await api.photos.export({
        photoIds,
        destDir,
        format,
        quality: showQuality ? quality : undefined,
        maxDim: parsedMaxDim,
      })

      if (summary.failed > 0) {
        toast.error(`导出完成：成功 ${summary.exported} 张，失败 ${summary.failed} 张`)
      } else {
        toast.success(`已导出 ${summary.exported} 张照片`)
      }
      onClose()
    } catch {
      // ipc() 已统一弹出错误提示；这里只恢复可交互状态
    } finally {
      setRunning(false)
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 'var(--la-z-modal)', backgroundColor: 'rgba(0,0,0,0.55)' }}
      onClick={(e) => { if (e.target === e.currentTarget && !running) onClose() }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1,    y: 0 }}
        exit={{   opacity: 0, scale: 0.95, y: 8 }}
        transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
        style={{
          width:           '400px',
          backgroundColor: 'var(--la-bg-raised)',
          borderRadius:    'var(--la-radius-lg)',
          border:          '1px solid var(--la-border)',
          boxShadow:       'var(--la-shadow-overlay)',
          padding:         '20px',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{
          fontSize: 'var(--la-text-base)', fontWeight: 'var(--la-weight-semibold)',
          color: 'var(--la-text-primary)', marginBottom: '4px',
        }}>
          导出照片
        </h2>
        <p style={{ fontSize: 'var(--la-text-xs)', color: 'var(--la-text-secondary)', marginBottom: '16px' }}>
          共 {photoIds.length} 张 · HEIC / RAW 会转成所选格式
        </p>

        <div style={labelStyle}>导出到</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
          <div
            title={destDir ?? undefined}
            style={{
              flex: 1, minWidth: 0, padding: '7px 10px',
              fontSize: 'var(--la-text-sm)',
              color: destDir ? 'var(--la-text-primary)' : 'var(--la-text-tertiary)',
              backgroundColor: 'var(--la-bg-overlay)', border: '1px solid var(--la-border)',
              borderRadius: 'var(--la-radius-md)', whiteSpace: 'nowrap',
              overflow: 'hidden', textOverflow: 'ellipsis', userSelect: 'text',
            }}
          >
            {destDir ?? '尚未选择文件夹'}
          </div>
          <button
            onClick={pickDir} disabled={running}
            style={{
              flexShrink: 0, padding: '6px 14px', borderRadius: 'var(--la-radius-md)',
              fontSize: 'var(--la-text-sm)', fontWeight: 'var(--la-weight-medium)',
              color: 'var(--la-text-primary)', backgroundColor: 'transparent',
              border: '1px solid var(--la-border)',
              cursor: running ? 'not-allowed' : 'default', transition: 'background-color 100ms ease',
            }}
            onMouseEnter={(e) => { if (!running) e.currentTarget.style.backgroundColor = 'var(--la-bg-hover)' }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
          >
            选择…
          </button>
        </div>

        <div style={labelStyle}>格式</div>
        <div style={{ display: 'flex', gap: '6px', marginBottom: '14px' }}>
          {FORMAT_OPTIONS.map((option) => {
            const active = format === option.value
            return (
              <button
                key={option.value}
                onClick={() => setFormat(option.value)} disabled={running}
                style={{
                  flex: 1, padding: '6px 0', borderRadius: 'var(--la-radius-md)',
                  fontSize: 'var(--la-text-sm)', fontWeight: 'var(--la-weight-medium)',
                  color: active ? 'var(--la-text-on-accent)' : 'var(--la-text-secondary)',
                  backgroundColor: active ? 'var(--la-accent-fill)' : 'transparent',
                  border: active ? 'none' : '1px solid var(--la-border)',
                  cursor: running ? 'not-allowed' : 'default', transition: 'background-color 100ms ease',
                }}
              >
                {option.label}
              </button>
            )
          })}
        </div>

        {showQuality && (
          <>
            <div style={{ ...labelStyle, display: 'flex', justifyContent: 'space-between' }}>
              <span>JPEG 质量</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{quality}</span>
            </div>
            <input
              type="range" min={60} max={100} step={1} value={quality} disabled={running}
              onChange={(e) => setQuality(Number(e.target.value))}
              style={{ width: '100%', marginBottom: '14px', accentColor: 'var(--la-accent)' }}
            />
          </>
        )}

        <div style={labelStyle}>最长边（像素，留空 = 保持原始尺寸）</div>
        <input
          type="number" min={16} value={maxDim} disabled={running}
          onChange={(e) => setMaxDim(e.target.value)}
          placeholder="例如 2048"
          style={{ ...fieldStyle, marginBottom: '16px' }}
        />

        {running && (
          <div style={{
            fontSize: 'var(--la-text-xs)', color: 'var(--la-text-secondary)',
            marginBottom: '12px', fontVariantNumeric: 'tabular-nums',
          }}>
            正在导出 {progress?.done ?? 0} / {progress?.total ?? photoIds.length} …
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button
            onClick={onClose} disabled={running}
            style={{
              padding: '6px 14px', borderRadius: 'var(--la-radius-md)',
              fontSize: 'var(--la-text-sm)', fontWeight: 'var(--la-weight-medium)',
              color: 'var(--la-text-secondary)', backgroundColor: 'transparent',
              border: '1px solid var(--la-border)',
              cursor: running ? 'not-allowed' : 'default', transition: 'all 100ms ease',
            }}
            onMouseEnter={(e) => { if (!running) { e.currentTarget.style.backgroundColor = 'var(--la-bg-hover)'; e.currentTarget.style.color = 'var(--la-text-primary)' } }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--la-text-secondary)' }}
          >
            取消
          </button>
          <button
            onClick={handleExport} disabled={!canExport}
            style={{
              padding: '6px 16px', borderRadius: 'var(--la-radius-md)',
              fontSize: 'var(--la-text-sm)', fontWeight: 'var(--la-weight-medium)',
              color: canExport ? 'var(--la-text-on-accent)' : 'var(--la-text-disabled)',
              backgroundColor: canExport ? 'var(--la-accent-fill)' : 'var(--la-fill-disabled)',
              border: canExport ? 'none' : '1px solid var(--la-border)',
              cursor: canExport ? 'default' : 'not-allowed',
              transition: 'background-color 100ms ease',
            }}
            onMouseEnter={(e) => { if (canExport) e.currentTarget.style.backgroundColor = 'var(--la-accent-fill-hover)' }}
            onMouseLeave={(e) => { if (canExport) e.currentTarget.style.backgroundColor = 'var(--la-accent-fill)' }}
          >
            {running ? '导出中…' : '开始导出'}
          </button>
        </div>
      </motion.div>
    </div>,
    document.body,
  )
}
