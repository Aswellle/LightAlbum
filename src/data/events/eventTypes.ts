/**
 * @file src/data/events/eventTypes.ts
 * @description V2 事件信封类型 — 统一事件契约
 *
 * 所有事件必须统一为 EventEnvelope 格式：
 *   version: 协议版本
 *   type: 事件类型
 *   seq: 进程级事件顺序
 *   revision: 图库数据状态版本
 *   mutationId: 可选，标识触发事件的 mutation
 *   taskId: 可选，标识异步任务
 *   emittedAt: 发射时间戳
 *   payload: 事件特定数据
 */

// ─────────────────────────────────────────────────────────
//  事件信封
// ─────────────────────────────────────────────────────────

export interface EventEnvelope<T extends string, P> {
  version: 1
  type: T
  seq: number
  revision: number
  mutationId?: string
  taskId?: string
  emittedAt: number
  payload: P
}

// ─────────────────────────────────────────────────────────
//  事件负载类型
// ─────────────────────────────────────────────────────────

export interface PhotoUpdatedPayload {
  photoId: string
  fields: string[]
}

export interface PhotoCreatedPayload {
  photoId: string
}

export interface PhotoRemovedPayload {
  photoIds: string[]
}

export interface LibraryChangedPayload {
  added: string[]
  modified: string[]
  removed: string[]
}

export interface AlbumUpdatedPayload {
  albumId: string
  action: 'created' | 'deleted' | 'renamed' | 'photos_added' | 'photos_removed' | 'cover_changed'
}


export interface ThumbReadyPayload {
  photoId: string
  size: string
}

export interface ScanProgressPayload {
  folder: string
  discovered: number
  indexed: number
  thumbnailing: number
}

export interface ScanCompletedPayload {
  folder: string
  totalNew: number
  totalUpdated: number
  durationMs: number
}

export interface RevisionGapPayload {
  expectedRevision: number
  actualRevision: number
}

// ─────────────────────────────────────────────────────────
//  事件类型映射
// ─────────────────────────────────────────────────────────

export type V2EventType =
  | 'photo:updated'
  | 'photo:created'
  | 'photo:removed'
  | 'library:changed'
  | 'album:updated'
  | 'thumb:ready'
  | 'scan:progress'
  | 'scan:completed'
  | 'library:revision_gap'

export type V2EventEnvelope =
  | EventEnvelope<'photo:updated', PhotoUpdatedPayload>
  | EventEnvelope<'photo:created', PhotoCreatedPayload>
  | EventEnvelope<'photo:removed', PhotoRemovedPayload>
  | EventEnvelope<'library:changed', LibraryChangedPayload>
  | EventEnvelope<'album:updated', AlbumUpdatedPayload>
  | EventEnvelope<'thumb:ready', ThumbReadyPayload>
  | EventEnvelope<'scan:progress', ScanProgressPayload>
  | EventEnvelope<'scan:completed', ScanCompletedPayload>
  | EventEnvelope<'library:revision_gap', RevisionGapPayload>
