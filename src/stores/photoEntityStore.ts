/**
 * @file src/stores/photoEntityStore.ts
 * @description V2 规范化照片实体存储
 *
 * 核心原则：
 *   - 同一实体全局只存一份（byId: Record<string, PhotoEntity>）
 *   - patch() 只更新目标实体，不影响其他
 *   - 组件只订阅自身 id 对应实体（usePhotoEntity hook）
 *   - 不允许组件自己从数组 .find()
 *
 * O(1) 查找，O(1) 局部更新，O(N) 仅在全量替换时。
 *
 * 替换原 photoStore 中的 photos[] + _photoIndex 模式。
 */

import { create } from 'zustand'
import type { PhotoEntity } from '@/domain/photo/photoTypes'

// ─────────────────────────────────────────────────────────
//  Store 接口
// ─────────────────────────────────────────────────────────

export interface PhotoEntityState {
  /** 规范化实体映射：id → entity */
  byId: Record<string, PhotoEntity>

  /** 每次 mutation 自增，用于判断 store 是否变化 */
  version: number

  /**
   * 批量 upsert（首次加载 / 分页追加）
   * O(K)，K = photos.length
   */
  upsertMany: (photos: PhotoEntity[]) => void

  /**
   * 局部字段 patch（收藏 / 评分等）
   * O(1)：只更新目标实体，不影响其他
   */
  patch: (id: string, patch: Partial<PhotoEntity>) => void

  /**
   * 批量删除
   * O(K)，K = ids.length
   */
  removeMany: (ids: string[]) => void

  /** 清空所有实体 */
  clear: () => void
}

// ─────────────────────────────────────────────────────────
//  创建 Store
// ─────────────────────────────────────────────────────────

export const usePhotoEntityStore = create<PhotoEntityState>()(
  (set) => ({
    byId: {},
    version: 0,

    upsertMany: (photos) => {
      if (photos.length === 0) return
      set((s) => {
        const byId = { ...s.byId }
        for (const p of photos) {
          byId[p.id] = p
        }
        return { byId, version: s.version + 1 }
      })
    },

    patch: (id, entityPatch) => {
      set((s) => {
        const existing = s.byId[id]
        if (!existing) return s // 不在当前视图 → no-op
        return {
          byId: { ...s.byId, [id]: { ...existing, ...entityPatch } },
          version: s.version + 1,
        }
      })
    },

    removeMany: (ids) => {
      if (ids.length === 0) return
      set((s) => {
        const byId = { ...s.byId }
        for (const id of ids) delete byId[id]
        return { byId, version: s.version + 1 }
      })
    },

    clear: () => set({ byId: {}, version: 0 }),
  }),
)

// ─────────────────────────────────────────────────────────
//  选择器
// ─────────────────────────────────────────────────────────

/** 获取单个实体（O(1)，不创建新引用）*/
export const selectEntityById = (id: string) => (s: PhotoEntityState) =>
  s.byId[id] ?? null

/** 获取多个实体（保持顺序）*/
export const selectEntitiesByIds = (ids: string[]) => (s: PhotoEntityState) =>
  ids.map((id) => s.byId[id]).filter((e): e is PhotoEntity => e != null)

/** 获取当前实体数量 */
export const selectEntityCount = (s: PhotoEntityState) =>
  Object.keys(s.byId).length
