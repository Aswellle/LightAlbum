/**
 * @file src/stores/previewStore.ts
 * @description 大图预览模式状态管理
 *
 * 职责：
 *   - 控制预览的开/关
 *   - 记录当前预览的照片 ID 及在列表中的位置
 *   - 保存飞入动画的起始矩形（GridItem 的 DOMRect）
 *   - 支持左右切换（方向键 / 手势），管理切换方向（用于滑动动画）
 *   - 管理 EXIF 面板的展开/收起状态
 *   - 管理 Filmstrip 的显示/隐藏
 *   - 管理预览 UI 自动隐藏（2s 无操作后）
 *
 * 与 selectionStore 的关系：
 *   previewStore.currentIndex 决定「预览哪一张」
 *   selectionStore.selectedIds 决定「选中了哪些张」
 *   两者独立，互不耦合。打开预览时不会改变选中态。
 */

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'

/**
 * 网格格子的视口矩形 —— 飞入/飞出动画的起点（见 ADR-007）。
 * 只保留数值快照，不持有 DOM 引用：虚拟化可能在飞行途中卸载源格子。
 */
export interface SourceRect {
  x:      number
  y:      number
  width:  number
  height: number
}

// ─────────────────────────────────────────────────────────
//  Store 接口
// ─────────────────────────────────────────────────────────

interface PreviewStore {
  // ── 状态 ──

  /** 预览遮罩是否可见 */
  isOpen: boolean

  /** 当前预览的照片 ID */
  currentPhotoId: string | null

  /**
   * 当前照片在 allIds 中的索引
   * 用于判断是否有上一张/下一张
   */
  currentIndex: number

  /**
   * 预览可导航的照片 ID 有序列表
   * 由打开预览时传入，与当前视图的排列一致
   */
  photoIds: string[]

  /**
   * 打开预览时点击的格子矩形（飞入动画起点，见 ADR-007）。
   * 关闭时**不清空**：退出动画需要它；下一次 open() 会重置（未提供 rect 时置 null）。
   */
  sourceRect: SourceRect | null

  /**
   * 左右切换方向，用于 Framer Motion slide 动画
   * +1 = 向后（下一张），-1 = 向前（上一张），0 = 首次打开
   */
  direction: number

  /** EXIF 信息面板是否展开（右侧滑出） */
  isExifOpen: boolean

  /** 底部胶片条（Filmstrip）是否显示 */
  isFilmstripVisible: boolean

  /**
   * 预览 UI（工具栏/胶片条）是否处于隐藏态
   * 鼠标移动时重置计时器，2s 无操作后自动隐藏
   */
  isUiHidden: boolean

  // ── 写操作 ──

  /**
   * 打开预览
   * @param photoId   要预览的照片 ID
   * @param photoIds  当前视图所有照片 ID（用于左右切换）
   * @param rect      点击的格子矩形（飞入起点）。胶片条等无格子的入口不传 → 不做飞入
   */
  open: (photoId: string, photoIds: string[], rect?: SourceRect) => void

  /** 关闭预览 */
  close: () => void

  /** 切换到下一张（direction = +1） */
  next: () => void

  /** 切换到上一张（direction = -1） */
  prev: () => void

  /**
   * 直接跳到指定索引（Filmstrip 点击）
   * direction 根据目标 index 与 currentIndex 比较确定
   */
  goTo: (index: number) => void

  /** 切换 EXIF 面板（I 键 / 工具栏按钮） */
  toggleExif: () => void

  /** 设置 UI 隐藏状态（由 usePreviewGesture 中的 idle 计时器驱动） */
  setUiHidden: (hidden: boolean) => void
}

// ─────────────────────────────────────────────────────────
//  创建 Store
// ─────────────────────────────────────────────────────────

export const usePreviewStore = create<PreviewStore>()(
  subscribeWithSelector((set, get) => ({
    isOpen:             false,
    currentPhotoId:     null,
    currentIndex:       0,
    photoIds:           [],
    sourceRect:         null,
    direction:          0,
    isExifOpen:         false,
    isFilmstripVisible: true,
    isUiHidden:         false,

    // ── 打开 ──
    open: (photoId, photoIds, rect) => {
      const index = photoIds.indexOf(photoId)
      set({
        isOpen:         true,
        currentPhotoId: photoId,
        currentIndex:   index === -1 ? 0 : index,
        photoIds,
        sourceRect:     rect ?? null,
        direction:      0,
        isUiHidden:     false,
      })
    },

    // ── 关闭 ──
    close: () =>
      set({
        isOpen:         false,
        // 保留 currentPhotoId：AnimatePresence exit 动画结束后由组件 unmount 自然清理
        isExifOpen:     false,
        isUiHidden:     false,
      }),

    // ── 下一张 ──
    next: () => {
      const { currentIndex, photoIds } = get()
      const nextIndex = currentIndex + 1
      if (nextIndex >= photoIds.length) return
      set({
        currentIndex:      nextIndex,
        currentPhotoId:    photoIds[nextIndex],
        direction:         1,
        isUiHidden:        false,
      })
    },

    // ── 上一张 ──
    prev: () => {
      const { currentIndex, photoIds } = get()
      const prevIndex = currentIndex - 1
      if (prevIndex < 0) return
      set({
        currentIndex:      prevIndex,
        currentPhotoId:    photoIds[prevIndex],
        direction:         -1,
        isUiHidden:        false,
      })
    },

    // ── 跳到指定索引 ──
    goTo: (index) => {
      const { currentIndex, photoIds } = get()
      if (index < 0 || index >= photoIds.length) return
      const direction = index > currentIndex ? 1 : index < currentIndex ? -1 : 0
      set({
        currentIndex:      index,
        currentPhotoId:    photoIds[index],
        direction,
        isUiHidden:        false,
      })
    },

    // ── EXIF 面板 ──
    toggleExif: () => set((s) => ({ isExifOpen: !s.isExifOpen })),

    // ── UI 隐藏 ──
    setUiHidden: (isUiHidden) => set({ isUiHidden }),
  })),
)

// ─────────────────────────────────────────────────────────
//  选择器
// ─────────────────────────────────────────────────────────

export const selectIsPreviewOpen    = (s: PreviewStore) => s.isOpen
export const selectCurrentPhotoId  = (s: PreviewStore) => s.currentPhotoId
export const selectCurrentIndex    = (s: PreviewStore) => s.currentIndex
export const selectPhotoIds        = (s: PreviewStore) => s.photoIds
export const selectDirection       = (s: PreviewStore) => s.direction
export const selectIsExifOpen      = (s: PreviewStore) => s.isExifOpen
export const selectIsFilmstrip     = (s: PreviewStore) => s.isFilmstripVisible
export const selectIsUiHidden      = (s: PreviewStore) => s.isUiHidden

/** 是否还有下一张（用于禁用/启用导航箭头） */
export const selectHasNext = (s: PreviewStore) =>
  s.currentIndex < s.photoIds.length - 1

/** 是否还有上一张 */
export const selectHasPrev = (s: PreviewStore) =>
  s.currentIndex > 0

/** 剩余总张数（Filmstrip 用） */
export const selectTotal = (s: PreviewStore) => s.photoIds.length
