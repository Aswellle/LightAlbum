/**
 * @file src/data/events/eventRouter.ts
 * @description V2 事件路由器 — 将事件分发到对应的 domain handler
 *
 * 核心改进（vs 旧 eventBus 直接 resetQueries）：
 *   - "小变化小刷新，大变化全刷新"
 *   - 每个事件有明确的 cache policy
 *   - revision 校验防止旧事件覆盖新状态
 */

import type { QueryClient } from '@tanstack/react-query'
import { usePhotoEntityStore } from '@/stores/photoEntityStore'
import { useCollectionStore } from '@/stores/collectionStore'
import { photoQueryKeys } from '@/data/photos/photoQueries'
import type { V2EventEnvelope, V2EventType } from './eventTypes'

let globalSeq = 0
let latestRevision = 0

export function getGlobalSeq(): number {
  return globalSeq
}

export function getLatestRevision(): number {
  return latestRevision
}

export class EventRouter {
  private seq = 0
  constructor(private queryClient: QueryClient) {}

  handleEvent(envelope: V2EventEnvelope): boolean {
    if (envelope.seq <= this.seq && envelope.type !== 'scan:progress') {
      return false
    }
    this.seq = envelope.seq
    globalSeq = envelope.seq

    if (envelope.revision > 0) {
      if (envelope.revision < latestRevision && this.isIdempotent(envelope.type)) {
        return false
      }
      if (envelope.revision > latestRevision + 1) {
        this.handleRevisionGap(latestRevision, envelope.revision)
      }
      latestRevision = Math.max(latestRevision, envelope.revision)
    }

    switch (envelope.type) {
      case 'photo:updated':
        return this.onPhotoUpdated(envelope.payload)
      case 'photo:created':
        return this.onPhotoCreated(envelope.payload)
      case 'photo:removed':
        return this.onPhotoRemoved(envelope.payload)
      case 'album:updated':
        return this.onAlbumUpdated(envelope.payload)
      case 'thumb:ready':
        return this.onThumbReady(envelope.payload)
      case 'scan:progress':
        return this.onScanProgress(envelope.payload)
      case 'scan:completed':
        return this.onScanCompleted(envelope.payload)
      case 'library:changed':
        return this.onLibraryChanged(envelope.payload)
      default:
        return false
    }
  }

  private onPhotoUpdated(payload: { photoId: string; fields: string[] }): boolean {
    usePhotoEntityStore.getState().patch(payload.photoId, {})
    this.queryClient.setQueryData(
      photoQueryKeys.detail(payload.photoId),
      (old: unknown) => {
        if (!old || typeof old !== 'object') return old
        return { ...old }
      },
    )
    return true
  }

  private onPhotoCreated(_payload: { photoId: string }): boolean {
    this.queryClient.invalidateQueries({
      queryKey: photoQueryKeys.all,
      refetchType: 'none',
    })
    return true
  }

  private onPhotoRemoved(payload: { photoIds: string[] }): boolean {
    usePhotoEntityStore.getState().removeMany(payload.photoIds)
    const collectionState = useCollectionStore.getState()
    for (const key of Object.keys(collectionState.collections)) {
      useCollectionStore.getState().removeIds(key, payload.photoIds)
    }
    return true
  }

  private onAlbumUpdated(payload: { albumId: string; action: string }): boolean {
    this.queryClient.invalidateQueries({ queryKey: ['albums'] })
    this.queryClient.invalidateQueries({ queryKey: ['album', payload.albumId] })
    return true
  }

  private onThumbReady(payload: { photoId: string; size: string }): boolean {
    this.queryClient.invalidateQueries({
      queryKey: ['thumb', payload.photoId, payload.size],
      exact: true,
    })
    return true
  }

  private onScanProgress(_payload: { folder: string; discovered: number; indexed: number; thumbnailing: number }): boolean {
    return true
  }

  private onScanCompleted(_payload: { folder: string; totalNew: number; totalUpdated: number; durationMs: number }): boolean {
    this.queryClient.invalidateQueries({
      queryKey: photoQueryKeys.all,
      refetchType: 'none',
    })
    return true
  }

  private onLibraryChanged(payload: { added: string[]; modified: string[]; removed: string[] }): boolean {
    if (payload.removed.length > 0) {
      usePhotoEntityStore.getState().removeMany(payload.removed)
      const collectionState = useCollectionStore.getState()
      for (const key of Object.keys(collectionState.collections)) {
        useCollectionStore.getState().removeIds(key, payload.removed)
      }
    }
    for (const photoId of payload.modified) {
      this.queryClient.invalidateQueries({
        queryKey: photoQueryKeys.detail(photoId),
        exact: true,
      })
    }
    return true
  }

  private isIdempotent(type: V2EventType): boolean {
    return type === 'photo:updated' || type === 'thumb:ready'
  }

  private handleRevisionGap(expected: number, actual: number): void {
    console.warn(`[EventRouter] Revision gap: expected ${expected}, got ${actual}`)
    this.queryClient.invalidateQueries({
      queryKey: photoQueryKeys.all,
      refetchType: 'all',
    })
  }
}

let routerInstance: EventRouter | null = null

export function getEventRouter(queryClient: QueryClient): EventRouter {
  if (!routerInstance) {
    routerInstance = new EventRouter(queryClient)
  }
  return routerInstance
}
