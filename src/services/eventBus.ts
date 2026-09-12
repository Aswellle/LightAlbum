/**
 * @file src/services/eventBus.ts
 * @description V2 事件总线 — 统一事件信封 + 路由器分发
 *
 * 核心改进：
 *   - 所有事件包装为 EventEnvelope（添加 seq）
 *   - 通过 EventRouter 分发到 domain handler
 *   - "小变化小刷新，大变化全刷新"
 *   - 不再直接 resetQueries(['photos'])
 */

import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { TauriEventMap } from '@/types/events'
import { useUiStore, toast } from '@/stores/uiStore'
import { getEventRouter } from '@/data/events/eventRouter'
import { useLibrarySyncStore } from '@/data/events/librarySync'

// ─────────────────────────────────────────────────────────
//  类型安全的 listen 封装
// ─────────────────────────────────────────────────────────

function listenTyped<K extends keyof TauriEventMap>(
  event: K,
  handler: (payload: TauriEventMap[K]) => void,
): Promise<UnlistenFn> {
  return listen<TauriEventMap[K]>(
    event,
    (e) => handler(e.payload),
  )
}

// ─────────────────────────────────────────────────────────
//  事件序列号生成
// ─────────────────────────────────────────────────────────

let eventSeqCounter = 0

function nextSeq(): number {
  return ++eventSeqCounter
}

// ─────────────────────────────────────────────────────────
//  主 Hook：在 App 根组件挂载一次
// ─────────────────────────────────────────────────────────

export function useEventBus(): void {
  const queryClient = useQueryClient()
  const setScanProgress = useUiStore((s) => s.setScanProgress)
  const setIsScanning = useUiStore((s) => s.setIsScanning)
  const router = getEventRouter(queryClient)

  const unlistenRef = useRef<UnlistenFn[]>([])

  useEffect(() => {
    let isCancelled = false

    Promise.all([
      // ── scan:started ──────────────────────────────────────
      listenTyped('scan:started', ({ folder, taskId }) => {
        setIsScanning(true)
        console.info(`[Scan] Started: ${folder} (task: ${taskId})`)
      }),

      // ── scan:progress ─────────────────────────────────────
      listenTyped('scan:progress', (progress) => {
        setScanProgress(progress)
        router.handleEvent({
          version: 1,
          type: 'scan:progress',
          seq: nextSeq(),
          revision: 0,
          emittedAt: Date.now(),
          payload: {
            folder: progress.folder ?? '',
            discovered: progress.discovered ?? 0,
            indexed: progress.indexed ?? 0,
            thumbnailing: progress.thumbnailsDone ?? 0,
          },
        })
      }),

      // ── scan:completed ────────────────────────────────────
      listenTyped('scan:completed', ({ folder, totalNew, totalUpdated, durationMs }) => {
        setScanProgress(null)
        setIsScanning(false)

        router.handleEvent({
          version: 1,
          type: 'scan:completed',
          seq: nextSeq(),
          revision: 0,
          emittedAt: Date.now(),
          payload: { folder, totalNew, totalUpdated, durationMs },
        })

        const sec = (durationMs / 1000).toFixed(1)
        if (totalNew > 0 || totalUpdated > 0) {
          toast.success(`扫描完成：新增 ${totalNew} 张，更新 ${totalUpdated} 张（用时 ${sec}s）`)
        }
        console.info(`[Scan] Completed: ${folder} — new=${totalNew} updated=${totalUpdated}`)
      }),

      // ── scan:error ────────────────────────────────────────
      listenTyped('scan:error', ({ path, error }) => {
        console.warn(`[Scan] Error on ${path}:`, error)
      }),

      // ── thumb:ready ───────────────────────────────────────
      listenTyped('thumb:ready', ({ photoId, size }) => {
        router.handleEvent({
          version: 1,
          type: 'thumb:ready',
          seq: nextSeq(),
          revision: 0,
          emittedAt: Date.now(),
          payload: { photoId, size },
        })
        thumbReadyCallbacks.forEach((cb) => cb(photoId, size))
      }),

      // ── thumb:batch_done ──────────────────────────────────
      listenTyped('thumb:batch_done', ({ count, remaining }) => {
        console.debug(`[Thumb] Batch done: ${count} done, ${remaining} remaining`)
        if (remaining === 0) {
          queryClient.invalidateQueries({ queryKey: ['photos'] })
        }
      }),

      // ── library:changed ───────────────────────────────────
      listenTyped('library:changed', ({ added, modified, removed }) => {
        console.info(
          `[Library] Changed — added:${added.length} modified:${modified.length} removed:${removed.length}`,
        )
        router.handleEvent({
          version: 1,
          type: 'library:changed',
          seq: nextSeq(),
          revision: useLibrarySyncStore.getState().latestRevision,
          emittedAt: Date.now(),
          payload: { added, modified, removed },
        })
        if (removed.length > 0) {
          console.warn(`[Library] ${removed.length} files removed from disk`)
        }
      }),

      // ── photo:updated ─────────────────────────────────────
      listenTyped('photo:updated', ({ photoId, fields }) => {
        console.debug(`[Photo] Updated: ${photoId} fields=[${fields.join(', ')}]`)
        router.handleEvent({
          version: 1,
          type: 'photo:updated',
          seq: nextSeq(),
          revision: useLibrarySyncStore.getState().latestRevision,
          emittedAt: Date.now(),
          payload: { photoId, fields },
        })
      }),

      // ── album:updated ─────────────────────────────────────
      listenTyped('album:updated', ({ albumId, action }) => {
        console.debug(`[Album] Updated: ${albumId} action=${action}`)
        router.handleEvent({
          version: 1,
          type: 'album:updated',
          seq: nextSeq(),
          revision: 0,
          emittedAt: Date.now(),
          payload: { albumId, action },
        })
      }),
    ])
      .then((fns) => {
        if (isCancelled) {
          fns.forEach((fn) => fn())
          return
        }
        unlistenRef.current = fns
      })
      .catch((err) => console.error('[EventBus] Failed to register event listeners:', err))

    return () => {
      isCancelled = true
      unlistenRef.current.forEach((fn) => fn())
      unlistenRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

// ─────────────────────────────────────────────────────────
//  thumb:ready 外部订阅接口
// ─────────────────────────────────────────────────────────

type ThumbReadyCallback = (photoId: string, size: string) => void

const thumbReadyCallbacks = new Set<ThumbReadyCallback>()

export function onThumbReady(cb: ThumbReadyCallback): () => void {
  thumbReadyCallbacks.add(cb)
  return () => thumbReadyCallbacks.delete(cb)
}

// ─────────────────────────────────────────────────────────
//  单次调用工具
// ─────────────────────────────────────────────────────────

export async function subscribeEvent<K extends keyof TauriEventMap>(
  event: K,
  handler: (payload: TauriEventMap[K]) => void,
): Promise<UnlistenFn> {
  return listenTyped(event, handler)
}
