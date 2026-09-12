/**
 * @file src/data/photos/photoRepository.ts
 * @description V2 Photo 数据仓库 — 封装 IPC 调用，返回原始 PhotoPage
 *
 * 仓库层保持纯净（仅 IPC 调用），不做 store 写入。
 * 归一化（实体提取、section 计算）由上层 usePhotoCollection 负责。
 */

import { api } from '@/services/tauriIpc'
import type { PhotoFilter } from '@/types/ipc'
import type { PhotoPage } from '@/types/photo'

export const PHOTO_PAGE_SIZE = 100

/**
 * 获取一页照片（原始 IPC 结果）
 */
export async function fetchPhotoPage(
  filter: PhotoFilter,
  cursor?: string,
  limit: number = PHOTO_PAGE_SIZE,
): Promise<PhotoPage> {
  return api.photos.list(filter, cursor, limit)
}

/**
 * 批量获取照片详情（按需加载 EXIF 用）
 */
export async function fetchPhotoBatch(ids: string[]) {
  return api.photos.getBatch(ids)
}
