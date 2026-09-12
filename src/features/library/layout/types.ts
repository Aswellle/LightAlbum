/**
 * @file src/features/library/layout/types.ts
 * @description V2 布局类型定义
 */

/** 固定网格运行时配置（与 GridConfig 一致）*/
export interface FixedGridConfig {
  columns: number
  gap: number
  itemSize: number
  containerWidth: number
}

/** 可见行描述 */
export interface VisibleGridRow {
  rowIndex: number
  top: number
  height: number
  /** 在 orderedIds 中的起始索引 */
  photoStart: number
  /** 在 orderedIds中的结束索引（不含）*/
  photoEnd: number
  /** 是否为分组标题行 */
  isHeader: boolean
  /** 分组信息（仅 isHeader=true 时有效）*/
  sectionKey?: string
  sectionLabel?: string
}

/** 布局索引 — 轻量，不创建 row 对象 */
export interface FixedGridIndex {
  /** 总行数 */
  totalRows: number
  /** 总高度 */
  totalHeight: number
  /** 分组标题行高度 */
  headerHeight: number
  /** 照片行高度 */
  rowHeight: number

  /** 根据 offset 查找行号 */
  findRowAtOffset(offset: number): number
  /** 获取行顶部偏移 */
  getRowTop(rowIndex: number): number
  /** 获取行对应的照片范围 */
  getRowPhotoRange(rowIndex: number): { start: number; end: number }
  /** 获取行所在的分组（如果是照片行）*/
  getSectionAtRow(rowIndex: number): { key: string; label: string } | null
  /** 判断行是否为分组标题 */
  isHeaderRow(rowIndex: number): boolean
}
