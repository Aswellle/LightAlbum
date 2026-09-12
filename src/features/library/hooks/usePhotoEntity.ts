/**
 * @file src/features/library/hooks/usePhotoEntity.ts
 * @description V2 单实体订阅 Hook — O(1) 读取，组件只订阅自身 id
 *
 * 替代原 selectPhotoById(id) 的 O(N) .find() 扫描。
 * 组件传入 photoId，仅在该实体 patch 时重渲染。
 */

import { usePhotoEntityStore } from '@/stores/photoEntityStore'
import type { PhotoEntity } from '@/domain/photo/photoTypes'

/**
 * 订阅单个照片实体
 * @returns 实体对象，或 null（不存在时）
 */
export function usePhotoEntity(id: string): PhotoEntity | null {
  return usePhotoEntityStore((s) => s.byId[id] ?? null)
}

/**
 * 订阅多个照片实体（保持顺序）
 */
export function usePhotoEntities(ids: string[]): PhotoEntity[] {
  return usePhotoEntityStore((s) =>
    ids.map((id) => s.byId[id]).filter((e): e is PhotoEntity => e != null),
  )
}
