/**
 * @file src/stores/collectionStore.ts
 * @description V2 集合存储 — 替代原 photoStore 中的 photos + groups
 *
 * 核心概念：
 *   - 一个 Collection 表示某个视图下的"有序照片集合"（All Photos / Favorites / Album A / ...）
 *   - 每个 Collection 维护 orderedIds[] + sections[]，不再复制 Photo 对象
 *   - SectionMeta 只记录边界（start, count），不保存 photos[]
 *
 * 追加复杂度：O(pageSize + newSections)，不遍历已有历史
 */

import { create } from 'zustand'
import type { PhotoEntity } from '@/domain/photo/photoTypes'
import {
  photoGroupKey,
  buildGroupLabel,
  type SectionMeta,
} from '@/domain/photo/photoTypes'

// ─────────────────────────────────────────────────────────
//  类型
// ─────────────────────────────────────────────────────────

/** 集合键类型 */
export type CollectionKey = string

/**
 * 照片集合 — 某个视图下的有序 ID 列表 + 分组元数据
 */
export interface PhotoCollection {
  key: CollectionKey
  /** 有序照片 ID 数组 */
  orderedIds: string[]
  /** 分组元数据（只记录边界）*/
  sections: SectionMeta[]
  /** 总数（含未加载页）*/
  total: number
  /** 下一页 cursor */
  nextCursor: string | null
  /** 是否已加载完全 */
  exhausted: boolean
  /** 数据版本（每次 mutation 自增）*/
  revision: number
  /** 是否正在加载 */
  loading: boolean
  /** 错误信息 */
  error: string | null
}

export interface CollectionState {
  /** 所有集合的映射 */
  collections: Record<CollectionKey, PhotoCollection>
  /** 当前活跃集合键 */
  activeKey: CollectionKey | null

  /** 确保集合存在（不存在则创建空集合）*/
  ensureCollection: (key: CollectionKey) => void

  /**
   * 替换首页（筛选条件变更 / 视图切换时）
   * O(pageSize)
   */
  replaceFirstPage: (
    key: CollectionKey,
    ids: string[],
    entities: PhotoEntity[],
    total: number,
    nextCursor: string | null,
  ) => void

  /**
   * 追加后续页（增量更新）
   * O(pageSize + newSections)，不遍历已有历史
   */
  appendPage: (
    key: CollectionKey,
    ids: string[],
    entities: PhotoEntity[],
    nextCursor: string | null,
  ) => void

  /** 从集合中移除指定 ID */
  removeIds: (key: CollectionKey, ids: string[]) => void

  /** 标记集合失效（下次访问时重新加载）*/
  invalidate: (key: CollectionKey) => void

  /** 清空指定集合或全部 */
  clear: (key?: CollectionKey) => void

  /** 设置加载状态 */
  setLoading: (key: CollectionKey, loading: boolean) => void
}

// ─────────────────────────────────────────────────────────
//  内部工具
// ─────────────────────────────────────────────────────────

/**
 * 从 ID 数组构建分组元数据
 * O(K)，K = ids.length
 */
function buildSections(
  ids: string[],
  entityLookup: (id: string) => PhotoEntity | undefined,
): SectionMeta[] {
  if (ids.length === 0) return []

  const sections: SectionMeta[] = []
  let currentKey = ''
  let currentLabel = ''
  let start = 0
  let count = 0

  for (let i = 0; i < ids.length; i++) {
    const entity = entityLookup(ids[i])
    if (!entity) continue
    const key = photoGroupKey(entity.createdAt)

    if (key !== currentKey) {
      if (count > 0) {
        sections.push({ key: currentKey, label: currentLabel, start, count })
      }
      currentKey = key
      currentLabel = buildGroupLabel(key)
      start = i
      count = 1
    } else {
      count++
    }
  }

  if (count > 0) {
    sections.push({ key: currentKey, label: currentLabel, start, count })
  }

  return sections
}

/**
 * 增量更新分组元数据
 * 只处理新增 ID，不重建已有分组
 * O(newIds.length + newSections)
 */
function appendSections(
  existing: SectionMeta[],
  allIds: string[],
  newIds: string[],
  entityLookup: (id: string) => PhotoEntity | undefined,
): SectionMeta[] {
  if (newIds.length === 0) return existing

  // 复制现有 sections
  const sections = existing.map((s) => ({ ...s }))
  const baseOffset = allIds.length - newIds.length

  let lastSection = sections[sections.length - 1]
  let currentKey = lastSection?.key ?? ''


  for (let i = 0; i < newIds.length; i++) {
    const entity = entityLookup(newIds[i])
    if (!entity) continue
    const key = photoGroupKey(entity.createdAt)
    const globalIdx = baseOffset + i

    if (key === currentKey && lastSection) {
      // 延续最后一个分组
      lastSection.count++
    } else {
      // 新分组
      const newSection: SectionMeta = {
        key,
        label: buildGroupLabel(key),
        start: globalIdx,
        count: 1,
      }
      sections.push(newSection)
      lastSection = newSection
      currentKey = key

    }
  }

  return sections
}

// ─────────────────────────────────────────────────────────
//  创建 Store
// ─────────────────────────────────────────────────────────

/** 临时实体查找表（用于分组计算）*/
let entityLookupCache: Record<string, PhotoEntity> = {}

export const useCollectionStore = create<CollectionState>()(
  (set) => ({

    collections: {},
    activeKey: null,

    ensureCollection: (key) => {
      set((s) => {
        if (s.collections[key]) return s
        return {
          collections: {
            ...s.collections,
            [key]: {
              key,
              orderedIds: [],
              sections: [],
              total: 0,
              nextCursor: null,
              exhausted: false,
              revision: 0,
              loading: false,
              error: null,
            },
          },
        }
      })
    },

    replaceFirstPage: (key, ids, entities, total, nextCursor) => {
      // 更新实体查找表
      for (const e of entities) {
        entityLookupCache[e.id] = e
      }
      const lookup = (id: string) => entityLookupCache[id]

      set((s) => {
        const existing = s.collections[key]
        const sections = buildSections(ids, lookup)
        return {
          collections: {
            ...s.collections,
            [key]: {
              key,
              orderedIds: ids,
              sections,
              total,
              nextCursor,
              exhausted: !nextCursor,
              revision: (existing?.revision ?? 0) + 1,
              loading: false,
              error: null,
            },
          },
        }
      })
    },

    appendPage: (key, ids, entities, nextCursor) => {
      // 更新实体查找表
      for (const e of entities) {
        entityLookupCache[e.id] = e
      }
      const lookup = (id: string) => entityLookupCache[id]

      set((s) => {
        const existing = s.collections[key]
        if (!existing) return s

        const orderedIds = [...existing.orderedIds, ...ids]
        const sections = appendSections(
          existing.sections,
          orderedIds,
          ids,
          lookup,
        )

        return {
          collections: {
            ...s.collections,
            [key]: {
              ...existing,
              orderedIds,
              sections,
              nextCursor,
              exhausted: !nextCursor,
              revision: existing.revision + 1,
            },
          },
        }
      })
    },

    removeIds: (key, ids) => {
      const idSet = new Set(ids)
      const lookup = (id: string) => entityLookupCache[id]

      set((s) => {
        const existing = s.collections[key]
        if (!existing) return s

        const orderedIds = existing.orderedIds.filter((id) => !idSet.has(id))
        // 重建分组（移除可能跨越多个分组，全量重建更简洁）
        const sections = buildSections(orderedIds, lookup)

        // 清理实体缓存
        for (const id of ids) delete entityLookupCache[id]

        return {
          collections: {
            ...s.collections,
            [key]: {
              ...existing,
              orderedIds,
              sections,
              total: Math.max(0, existing.total - ids.length),
              revision: existing.revision + 1,
            },
          },
        }
      })
    },

    invalidate: (key) => {
      set((s) => {
        const existing = s.collections[key]
        if (!existing) return s
        return {
          collections: {
            ...s.collections,
            [key]: { ...existing, exhausted: false, nextCursor: null },
          },
        }
      })
    },

    clear: (key) => {
      if (key) {
        set((s) => {
          const collections = { ...s.collections }
          delete collections[key]
          return {
            collections,
            activeKey: s.activeKey === key ? null : s.activeKey,
          }
        })
      } else {
        set({ collections: {}, activeKey: null })
        entityLookupCache = {}
      }
    },

    setLoading: (key, loading) => {
      set((s) => {
        const existing = s.collections[key]
        if (!existing) return s
        return {
          collections: {
            ...s.collections,
            [key]: { ...existing, loading },
          },
        }
      })
    },
  }),
)

// ─────────────────────────────────────────────────────────
//  选择器
// ─────────────────────────────────────────────────────────

/** 获取活跃集合 */
export const selectActiveCollection = (s: CollectionState): PhotoCollection | null =>
  s.activeKey ? (s.collections[s.activeKey] ?? null) : null

/** 获取集合的 orderedIds */
export const selectOrderedIds = (key: CollectionKey) => (s: CollectionState) =>
  s.collections[key]?.orderedIds ?? []

/** 获取集合的 sections */
export const selectSections = (key: CollectionKey) => (s: CollectionState) =>
  s.collections[key]?.sections ?? []

/** 获取集合的 total */
export const selectCollectionTotal = (key: CollectionKey) => (s: CollectionState) =>
  s.collections[key]?.total ?? 0
