/**
 * @file src/stores/photoStore.ts
 * @description V2 兼容 Facade — 保持原有 photoStore API 不变
 *
 * V2 迁移期间，旧组件继续通过 usePhotoStore / selectPhotos / selectGroups 消费数据。
 * 内部实现已切换为规范化 EntityStore + CollectionStore：
 *
 *   photoStore (facade)
 *     ├── photoEntityStore (byId: Record<string, PhotoEntity>)
 *     └── collectionStore (orderedIds + sections)
 *
 * Facade 订阅底层 stores 的变化，自动重新派生 photos[] / groups[]。
 * 写操作同时更新底层 stores。
 *
 * 迁移完成后（Phase 9），此文件将被删除，组件直接消费 photoEntityStore / collectionStore。
 */

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { PhotoThumb, PhotoGroup } from '@/types/photo'
import {
  usePhotoEntityStore,
  type PhotoEntityState,
} from './photoEntityStore'
import {
  useCollectionStore,
  type CollectionState,
  type CollectionKey,
} from './collectionStore'
import type { PhotoEntity } from '@/domain/photo/photoTypes'

// ─────────────────────────────────────────────────────────
//  兼容层 Facade
// ─────────────────────────────────────────────────────────
//  V2 迁移期间保持旧 API 不变，内部委托给新 stores。
//  ─────────────────────────────────────────────────────────

/**
 * 活跃集合键 — 旧模型只有单一 photos[] 数组，对应 V2 的一个 Collection。
 * usePhotoQuery 在视图切换时调用 reset()，等效于切换活跃集合。
 */
const ACTIVE_KEY: CollectionKey = '__active__'

// ─────────────────────────────────────────────────────────
//  Store 接口（与原 photoStore 完全一致）
// ─────────────────────────────────────────────────────────

interface PhotoStore {
  // ── 公开状态 ──
  photos: PhotoThumb[]
  groups: PhotoGroup[]
  total: number
  isFetchingMore: boolean

  // ── 内部状态 ──
  _groupMap: Map<string, PhotoGroup>
  _photoIndex: Map<string, number>

  // ── 写操作 ──
  setPhotos: (photos: PhotoThumb[], total: number) => void
  appendPhotos: (newPhotos: PhotoThumb[]) => void
  updatePhoto: (id: string, patch: Partial<PhotoThumb>) => void
  removePhotos: (ids: string[]) => void
  setIsFetchingMore: (v: boolean) => void
  reset: () => void
}

// ─────────────────────────────────────────────────────────
//  派生工具
// ─────────────────────────────────────────────────────────

/** 从活跃集合 + EntityStore 派生 flat photos[] */
function derivePhotos(
  collection: CollectionState['collections'][CollectionKey] | undefined,
  entityState: PhotoEntityState,
): PhotoThumb[] {
  if (!collection) return []
  const result: PhotoThumb[] = []
  for (const id of collection.orderedIds) {
    const entity = entityState.byId[id]
    if (entity) result.push(entity as PhotoThumb)
  }
  return result
}

/** 从活跃集合 + EntityStore 派生 groups[]（含 photos[] 填充）*/
function deriveGroups(
  collection: CollectionState['collections'][CollectionKey] | undefined,
  entityState: PhotoEntityState,
): PhotoGroup[] {
  if (!collection) return []
  const groups: PhotoGroup[] = []
  for (const section of collection.sections) {
    const photos: PhotoThumb[] = []
    for (let i = section.start; i < section.start + section.count; i++) {
      const id = collection.orderedIds[i]
      const entity = entityState.byId[id]
      if (entity) photos.push(entity as PhotoThumb)
    }
    groups.push({ key: section.key, label: section.label, photos })
  }
  return groups
}

// ─────────────────────────────────────────────────────────
//  创建 Store
// ─────────────────────────────────────────────────────────

export const usePhotoStore = create<PhotoStore>()(
  subscribeWithSelector((_set, _get) => ({
    photos: [],
    groups: [],
    total: 0,
    isFetchingMore: false,
    _groupMap: new Map(),
    _photoIndex: new Map(),

    // ── setPhotos：全量替换 ──
    setPhotos: (photos, total) => {
      const ids = photos.map((p) => p.id)
      // 更新底层 stores
      usePhotoEntityStore.getState().upsertMany(photos as PhotoEntity[])
      useCollectionStore.getState().ensureCollection(ACTIVE_KEY)
      useCollectionStore.getState().replaceFirstPage(
        ACTIVE_KEY,
        ids,
        photos as PhotoEntity[],
        total,
        null,
      )
      syncFromSource()
    },

    // ── appendPhotos：增量追加 ──
    appendPhotos: (newPhotos) => {
      if (newPhotos.length === 0) return
      const ids = newPhotos.map((p) => p.id)
      usePhotoEntityStore.getState().upsertMany(newPhotos as PhotoEntity[])
      useCollectionStore.getState().ensureCollection(ACTIVE_KEY)
      useCollectionStore.getState().appendPage(
        ACTIVE_KEY,
        ids,
        newPhotos as PhotoEntity[],
        null,
      )
      syncFromSource()
    },

    // ── updatePhoto：局部字段更新 ──
    updatePhoto: (id, patch) => {
      usePhotoEntityStore.getState().patch(id, patch)
      syncFromSource()
    },

    // ── removePhotos：移除照片 ──
    removePhotos: (ids) => {
      usePhotoEntityStore.getState().removeMany(ids)
      useCollectionStore.getState().removeIds(ACTIVE_KEY, ids)
      syncFromSource()
    },

    setIsFetchingMore: (v) => _set({ isFetchingMore: v }),

    // ── reset：清空 ──
    reset: () => {
      usePhotoEntityStore.getState().clear()
      useCollectionStore.getState().clear(ACTIVE_KEY)
      _set({
        photos: [],
        groups: [],
        total: 0,
        isFetchingMore: false,
        _groupMap: new Map(),
        _photoIndex: new Map(),
      })
    },
  })),
)

// ─────────────────────────────────────────────────────────
//  从底层 stores 同步到 facade
// ─────────────────────────────────────────────────────────

function syncFromSource() {
  const entityState = usePhotoEntityStore.getState()
  const collectionState = useCollectionStore.getState()
  const collection = collectionState.collections[ACTIVE_KEY]

  if (!collection) return

  const photos = derivePhotos(collection, entityState)
  const groups = deriveGroups(collection, entityState)

  // 构建 _groupMap 和 _photoIndex（保持兼容性）
  const _groupMap = new Map<string, PhotoGroup>()
  for (const g of groups) _groupMap.set(g.key, g)

  const _photoIndex = new Map<string, number>()
  photos.forEach((p, i) => _photoIndex.set(p.id, i))

  usePhotoStore.setState({
    photos,
    groups,
    total: collection.total,
    _groupMap,
    _photoIndex,
  })
}

// 订阅底层 stores 的变化，自动同步到 facade
// 这确保了 facade 状态始终与底层 stores 一致
usePhotoEntityStore.subscribe(() => syncFromSource())
useCollectionStore.subscribe(() => {
  const state = useCollectionStore.getState()
  if (state.collections[ACTIVE_KEY]) syncFromSource()
})

// ─────────────────────────────────────────────────────────
//  选择器（避免组件订阅整个 store）
// ─────────────────────────────────────────────────────────

export const selectPhotos    = (s: PhotoStore) => s.photos
export const selectGroups    = (s: PhotoStore) => s.groups
export const selectTotal     = (s: PhotoStore) => s.total
export const selectPhotoById = (id: string) => (s: PhotoStore) => {
  // 使用 _photoIndex 实现 O(1) 查找
  const idx = s._photoIndex.get(id)
  return idx !== undefined ? s.photos[idx] : null
}
