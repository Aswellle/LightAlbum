/**
 * @file src/features/library/preview/previewSource.ts
 * @description V2 预览源类型 — M → L/XL → original 渐进加载
 *
 * 打开预览的目标不是等待原图加载，而是：
 *   → <100ms 已有 M 缩略图立即出现
 *   → L/XL 渐进替换
 *   → 高质量细节完成
 *
 * 用户主观感受应该是"一直有东西可看"。
 */

import { convertFileSrc } from '@tauri-apps/api/core'

export type PreviewSource =
  | {
      kind: 'thumbnail'
      size: 'm'
      url: string
    }
  | {
      kind: 'preview'
      size: 'l' | 'xl'
      url: string
    }
  | {
      kind: 'original'
      url: string
    }

/**
 * 根据当前加载阶段决定下一个要加载的源
 */
export function getNextPreviewSource(
  current: PreviewSource | null,
  hasL: boolean,
  hasXL: boolean,
  needsOriginal: boolean,
): PreviewSource | null {
  if (!current) {
    // 初始状态 → 加载 M 缩略图
    return null // 由调用方先加载 M
  }

  switch (current.kind) {
    case 'thumbnail':
      if (hasL) return { kind: 'preview', size: 'l', url: '' }
      if (needsOriginal) return { kind: 'original', url: '' }
      return null
    case 'preview':
      if (current.size === 'l' && hasXL) return { kind: 'preview', size: 'xl', url: '' }
      if (needsOriginal) return { kind: 'original', url: '' }
      return null
    case 'original':
      return null // 已到最高质量
  }
}

/**
 * 将文件路径转换为预览 URL
 */
export function filePathToPreviewUrl(filePath: string): string {
  return convertFileSrc(filePath)
}
