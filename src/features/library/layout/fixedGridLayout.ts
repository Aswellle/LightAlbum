/**
 * @file src/features/library/layout/fixedGridLayout.ts
 * @description V2 固定网格布局引擎 — 轻量索引 + 二分查找
 *
 * 核心改进（vs 原 buildRows）：
 *   - 不再预先创建全部 row 对象（100K 照片 → 0 个对象）
 *   - 使用 sectionPrefixOffsets[] + sectionRowCounts[] 建立轻量索引
 *   - 滚动时二分查找 section → 算术计算 row → 仅创建 visible row 对象
 *   - 复杂度：O(log S + V)，S = 分组数，V = 可见行数
 */

import type { SectionMeta } from '@/domain/photo/photoTypes'
import type { FixedGridConfig, FixedGridIndex, VisibleGridRow } from './types'

const GROUP_HEADER_HEIGHT = 44 // px，与旧版一致

/**
 * 构建轻量布局索引
 *
 * 仅保存 section 级别的累积信息，不创建 row 对象。
 */
export function createFixedGridIndex(
  sections: SectionMeta[],
  config: Pick<FixedGridConfig, 'columns' | 'itemSize' | 'gap'>,
): FixedGridIndex {
  const { columns, itemSize, gap } = config
  const rowHeight = itemSize + gap

  const headerHeight = GROUP_HEADER_HEIGHT

  // 每个 section 的累积行前缀和高度前缀
  const sectionRowCounts: number[] = []
  const sectionPrefixRows: number[] = [] // 每个 section 起始的全局行号
  const sectionPrefixOffsets: number[] = [] // 每个 section 起始的 px 偏移

  let totalRows = 0
  let totalHeight = 0

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]
    const photoRows = Math.ceil(section.count / columns)
    const sectionRows = 1 + photoRows // 1 header + N photo rows

    sectionRowCounts.push(sectionRows)
    sectionPrefixRows.push(totalRows)
    sectionPrefixOffsets.push(totalHeight)

    totalRows += sectionRows
    totalHeight += headerHeight + photoRows * rowHeight
  }

  // ── 二分查找：offset → section index ──
  function findSectionAtOffset(offset: number): number {
    let lo = 0
    let hi = sections.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (sectionPrefixOffsets[mid] <= offset) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  // ── 二分查找：rowIndex → section index ──
  function findSectionByRow(rowIndex: number): number {
    let lo = 0
    let hi = sections.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (sectionPrefixRows[mid] <= rowIndex) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  function findRowAtOffset(offset: number): number {
    if (totalRows === 0) return 0
    const secIdx = findSectionAtOffset(offset)
    const secOffset = offset - sectionPrefixOffsets[secIdx]
    const secStartRow = sectionPrefixRows[secIdx]

    if (secOffset < headerHeight) {
      // 命中 header
      return secStartRow
    }
    // 命中 photo row
    const photoRowOffset = secOffset - headerHeight
    const photoRowIdx = Math.floor(photoRowOffset / rowHeight)
    const maxPhotoRows = sectionRowCounts[secIdx] - 1
    return secStartRow + 1 + Math.min(photoRowIdx, maxPhotoRows - 1)
  }

  function getRowTop(rowIndex: number): number {
    if (totalRows === 0) return 0
    const secIdx = findSectionByRow(rowIndex)
    const secStartRow = sectionPrefixRows[secIdx]
    const rowInSection = rowIndex - secStartRow

    if (rowInSection === 0) {
      // header row
      return sectionPrefixOffsets[secIdx]
    }
    // photo row
    return sectionPrefixOffsets[secIdx] + headerHeight + (rowInSection - 1) * rowHeight
  }


  function getRowPhotoRange(rowIndex: number): { start: number; end: number } {
    const secIdx = findSectionByRow(rowIndex)
    const secStartRow = sectionPrefixRows[secIdx]
    const rowInSection = rowIndex - secStartRow

    if (rowInSection === 0) {
      // header row → 返回本 section 全部照片范围
      const sec = sections[secIdx]
      return { start: sec.start, end: sec.start + sec.count }
    }

    const sec = sections[secIdx]
    const photoRowIdx = rowInSection - 1
    const start = sec.start + photoRowIdx * columns
    const end = Math.min(start + columns, sec.start + sec.count)
    return { start, end }
  }

  function getSectionAtRow(rowIndex: number): { key: string; label: string } | null {
    if (sections.length === 0) return null
    const secIdx = findSectionByRow(rowIndex)
    const sec = sections[secIdx]
    return { key: sec.key, label: sec.label }
  }

  function isHeaderRow(rowIndex: number): boolean {
    if (totalRows === 0) return false
    const secIdx = findSectionByRow(rowIndex)
    const secStartRow = sectionPrefixRows[secIdx]
    return rowIndex === secStartRow
  }

  return {
    totalRows,
    totalHeight,
    headerHeight,
    rowHeight,
    findRowAtOffset,
    getRowTop,

    getRowPhotoRange,
    getSectionAtRow,
    isHeaderRow,
  }
}

/**
 * 计算可见行范围
 *
 * 使用二分查找定位 section，再算术计算 row 范围。
 * 仅创建 visible row 对象（通常 < 20 个）。
 */
export function computeVisibleRows(
  index: FixedGridIndex,
  scrollTop: number,
  clientHeight: number,
  overscanRows: number = 3,
): VisibleGridRow[] {
  if (index.totalRows === 0) return []

  const firstRow = Math.max(0, index.findRowAtOffset(scrollTop) - overscanRows)

  // 二分查找最后一个可见行
  const viewBottom = scrollTop + clientHeight
  const lastVisible = index.findRowAtOffset(viewBottom)
  const lastRow = Math.min(index.totalRows - 1, lastVisible + overscanRows)

  const rows: VisibleGridRow[] = []
  for (let i = firstRow; i <= lastRow; i++) {
    const isHeader = index.isHeaderRow(i)
    const photoRange = index.getRowPhotoRange(i)
    const section = index.getSectionAtRow(i)

    rows.push({
      rowIndex: i,
      top: index.getRowTop(i),
      height: isHeader ? index.headerHeight : index.rowHeight,
      photoStart: photoRange.start,
      photoEnd: photoRange.end,
      isHeader,
      sectionKey: section?.key,
      sectionLabel: section?.label,
    })
  }

  return rows
}
