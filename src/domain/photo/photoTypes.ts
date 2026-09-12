/**
 * @file src/domain/photo/photoTypes.ts
 * @description V2 Photo domain types — normalized entity model
 *
 * V2 核心改动：
 *   - PhotoEntity 是唯一的实体表示（不再有 PhotoThumb / Photo 两套）
 *   - PhotoPageResult 只返回 ids + sectionDeltas，不返回完整 Photo 对象
 *   - SectionDelta 描述分组边界，不保存 photos[]
 *
 * 这些类型是 V2 数据流的地基，所有上层模块（CollectionStore、LayoutEngine、
 * ThumbnailScheduler）都基于此契约。
 */

import type { PhotoFormat } from '@/types/photo'

// ─────────────────────────────────────────────────────────
//  实体
// ─────────────────────────────────────────────────────────

/**
 * V2 统一照片实体
 * 对应原 PhotoThumb（12 字段网格投影），但作为 normalized store 的唯一表示。
 * 不再区分 PhotoThumb / PhotoDetail —— 详情字段按需通过 `photos_get` 加载。
 */
export interface PhotoEntity {
  id: string
  fileName: string
  width: number
  height: number
  orientation: number
  createdAt: string
  isFavorite: boolean
  isDeleted: boolean
  thumbnailS: string | null
  thumbnailM: string | null
  format: PhotoFormat
  folderPath: string
}

// ─────────────────────────────────────────────────────────
//  分页契约
// ─────────────────────────────────────────────────────────

/**
 * V2 分页结果 —— 不再携带完整 Photo 对象
 *
 * Repository 层拿到后端 items 后立即：
 *   items → photoEntityStore.upsertMany(items) → 生成 ids → 生成 sectionDeltas
 * 返回轻量结果，避免 Query cache 存储重复实体。
 */
export interface PhotoPageResult {
  /** 本页照片 ID 序（与后端 items 顺序一致）*/
  ids: string[]
  /** 当前筛选条件下总数 */
  total: number
  /** 下一页 cursor，null 表示已到末尾 */
  nextCursor: string | null
  /** 本次查询的 revision（用于事件去重）*/
  revision: number
  /** 本页涉及的分组变化（增量更新用）*/
  sectionDeltas: SectionDelta[]
}

/** 单个分组的增量变化描述 */
export interface SectionDelta {
  /** 分组键 'YYYY-MM' */
  key: string
  /** 展示标签 '2025年3月' */
  label: string
  /** 该分组当前总照片数 */
  count: number
}

// ─────────────────────────────────────────────────────────
//  分组元数据（轻量，不保存 photos[]）
// ─────────────────────────────────────────────────────────

/**
 * V2 分组元数据 —— 只记录边界，不保存 Photo 对象
 *
 * 原 PhotoGroup { key, label, photos: PhotoThumb[] }
 * 改为 SectionMeta { key, label, start, count }
 *
 * 例如：
 *   orderedIds: 0 ... 1299       → 2026-09
 *               1300 ... 2398    → 2026-08
 *               2399 ... 4100    → 2026-07
 *
 * 新增一页时无需复制已有 1300/2399/4100 个 Photo 对象。
 */
export interface SectionMeta {
  key: string
  label: string
  /** 在 orderedIds 中的起始索引 */
  start: number
  /** 该分组照片数 */
  count: number
}

/** 分组键计算（UTC，避免时区漂移导致跨月）*/
export function photoGroupKey(createdAt: string): string {
  const d = new Date(createdAt)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

/** 分组键 → 展示标签 '2025年3月' */
export function buildGroupLabel(key: string): string {
  const [y, m] = key.split('-')
  return `${y}年${parseInt(m, 10)}月`
}

/**
 * EXIF 方向值，表示旋转 90°/270°（需交换宽高比）
 * 5 = 顺时针旋转 90°（从右侧拍摄）
 * 6 = 顺时针旋转 270°（从左侧拍摄）
 * 7 = 逆时针旋转 90°（从底部拍摄）
 * 8 = 逆时针旋转 270°（从顶部拍摄）
 */
const EXIF_ROTATED_MIN = 5
const EXIF_ROTATED_MAX = 8

/** 从 ISO 时间戳计算月份分组键（UTC）*/
export function getDisplayAspectRatio(entity: PhotoEntity): number {
  const ar = entity.width / entity.height
  if (entity.orientation >= EXIF_ROTATED_MIN && entity.orientation <= EXIF_ROTATED_MAX) {
    return 1 / ar
  }
  return ar
}
