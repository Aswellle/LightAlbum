/**
 * @file src/services/thumbnailLoader.ts
 * @description V2 缩略图加载入口 — 委托给 ThumbnailScheduler
 *
 * 保持原有公开 API 不变，内部使用 ThumbnailScheduler 任务状态机。
 * 迁移完成后（Phase 9），此文件将被删除，组件直接消费 ThumbnailScheduler。
 */

import type { ThumbSize } from '@/types/photo'
import {
  getThumbnailScheduler,
  ThumbNotReadyError,
  isThumbNotReady,
  type ThumbPriority,
} from './thumbnail/ThumbnailScheduler'

// ── 重新导出类型（保持兼容性）──
export type { ThumbPriority }
export { ThumbNotReadyError, isThumbNotReady }

/**
 * 加载缩略图 URL（优先级调度 + LRU 缓存）
 */
export function loadThumbnail(
  photoId: string,
  size: ThumbSize = 's',
  priority: ThumbPriority = 'normal',
): Promise<string> {
  return getThumbnailScheduler().request(photoId, size, priority)
}

/**
 * 批量预加载
 */
export function preloadThumbnails(
  items: Array<{ photoId: string; size: ThumbSize }>,
  priority: ThumbPriority = 'low',
): void {
  getThumbnailScheduler().preload(
    items.map((i) => ({ ...i, priority })),
  )
}

/**
 * 主动清除缓存条目
 */
export function invalidateThumbnail(photoId: string, size: ThumbSize): void {
  getThumbnailScheduler().invalidate(photoId, size)
}

/**
 * 清空所有缓存和队列
 */
export function clearThumbnailCache(): void {
  getThumbnailScheduler().clear()
}

/**
 * 当前缓存条目数（调试用）
 */
export function getCacheSize(): number {
  return getThumbnailScheduler()['cache']?.size ?? 0
}

// ── thumb:ready 事件集成 ──
// 当缩略图生成完毕，清除缓存让下次请求拿到最新路径

import { onThumbReady } from './eventBus'

onThumbReady((photoId, size) => {
  invalidateThumbnail(photoId, size as ThumbSize)
})
