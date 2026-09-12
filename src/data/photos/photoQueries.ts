/**
 * @file src/data/photos/photoQueries.ts
 * @description V2 Query Key 工厂 — 统一定义，禁止散落手写
 *
 * 目标：可靠的 targeted invalidation。
 * 集合键由 filter 序列化生成，filter 变更时旧集合保留缓存，切回即可恢复。
 */

import type { PhotoFilter } from '@/types/ipc'

// ─────────────────────────────────────────────────────────
//  Query Key 工厂
// ─────────────────────────────────────────────────────────

export const photoQueryKeys = {
  all: ['photos'] as const,

  /** 某个具体视图的集合键 */
  collection: (key: string): readonly string[] => ['photos', 'collection', key],

  /** 某张照片的详情 */
  detail: (id: string): readonly string[] => ['photo', id],

  /** 某张照片的标签 */
  tags: (id: string): readonly string[] => ['photo-tags', id],
}

// ─────────────────────────────────────────────────────────
//  Collection Key 生成
// ─────────────────────────────────────────────────────────

/** 将 PhotoFilter 序列化为稳定的集合键 */
export function buildCollectionKey(filter: PhotoFilter): string {
  // 稳定序列化：按 key 排序确保相同 filter 产生相同 key
  const sorted = Object.fromEntries(
    Object.entries(filter).sort(([a], [b]) => a.localeCompare(b)),
  )
  return JSON.stringify(sorted)
}
