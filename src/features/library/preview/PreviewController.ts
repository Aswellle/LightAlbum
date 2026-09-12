/**
 * @file src/features/library/preview/PreviewController.ts
 * @description V2 预览控制器 — 管理预览状态和加载阶段
 *
 * 将 PreviewImage 的职责拆出：
 *   - Query（数据获取）
 *   - URL 生成
 *   - 尺寸计算
 *   - source switching
 *   - animation
 *   - zoom
 *
 * PreviewController 只负责状态管理和协调。
 */

import { create } from 'zustand'
import type { PreviewSource } from './previewSource'

export type PreviewLoadingStage = 'none' | 'placeholder' | 'preview' | 'original'

export interface PreviewState {
  photoId: string | null
  orderedIds: string[]
  index: number

  source: PreviewSource | null
  loadingStage: PreviewLoadingStage

  scale: number
  offset: { x: number; y: number }

  // ── 操作 ──
  open: (photoId: string, orderedIds: string[], index?: number) => void
  close: () => void
  next: () => void
  previous: () => void
  zoomIn: () => void
  zoomOut: () => void
  resetZoom: () => void

  setSource: (source: PreviewSource | null) => void
  setLoadingStage: (stage: PreviewLoadingStage) => void
  setScale: (scale: number) => void
  setOffset: (offset: { x: number; y: number }) => void
}

const MIN_SCALE = 0.1
const MAX_SCALE = 10
const ZOOM_STEP = 1.25

export const usePreviewStoreV2 = create<PreviewState>()((set, get) => ({
  photoId: null,
  orderedIds: [],
  index: 0,

  source: null,
  loadingStage: 'none',

  scale: 1,
  offset: { x: 0, y: 0 },

  open: (photoId, orderedIds, index) => {
    const idx = index ?? orderedIds.indexOf(photoId)
    set({
      photoId,
      orderedIds,
      index: idx >= 0 ? idx : 0,
      source: null,
      loadingStage: 'placeholder',
      scale: 1,
      offset: { x: 0, y: 0 },
    })
  },

  close: () => set({
    photoId: null,
    orderedIds: [],
    index: 0,
    source: null,
    loadingStage: 'none',
    scale: 1,
    offset: { x: 0, y: 0 },
  }),

  next: () => {
    const { orderedIds, index } = get()
    if (orderedIds.length === 0) return
    const nextIndex = (index + 1) % orderedIds.length
    const nextId = orderedIds[nextIndex]
    if (!nextId) return

    set({
      photoId: nextId,
      index: nextIndex,
      source: null,
      loadingStage: 'placeholder',
      scale: 1,
      offset: { x: 0, y: 0 },
    })
  },

  previous: () => {
    const { orderedIds, index } = get()
    if (orderedIds.length === 0) return
    const prevIndex = (index - 1 + orderedIds.length) % orderedIds.length
    const prevId = orderedIds[prevIndex]
    if (!prevId) return


    set({
      photoId: prevId,
      index: prevIndex,
      source: null,
      loadingStage: 'placeholder',
      scale: 1,
      offset: { x: 0, y: 0 },
    })
  },

  zoomIn: () => {
    const { scale } = get()
    set({ scale: Math.min(scale * ZOOM_STEP, MAX_SCALE) })
  },

  zoomOut: () => {
    const { scale } = get()
    set({ scale: Math.max(scale / ZOOM_STEP, MIN_SCALE) })
  },

  resetZoom: () => set({ scale: 1, offset: { x: 0, y: 0 } }),

  setSource: (source) => set({ source }),

  setLoadingStage: (loadingStage) => set({ loadingStage }),

  setScale: (scale) => set({ scale: Math.max(MIN_SCALE, Math.min(scale, MAX_SCALE)) }),

  setOffset: (offset) => set({ offset }),
}))
