/**
 * @file src/services/thumbnail/ThumbnailScheduler.ts
 * @description V2 缩略图调度器 — 任务状态机 + 优先级提升 + 代际失效
 *
 * 核心改进（vs 旧 thumbnailLoader）：
 *   - 任务状态机：queued / running / fulfilled / failed / cancelled
 *   - 优先级提升：low → normal → high（不因 pending.has(key) 忽略新优先级）
 *   - 代际失效：invalidate 时 generation++，旧任务完成后丢弃
 *   - 双端队列：head 指针替代 shift()，O(1) 出队
 *   - 任务对象只存一份（TaskMap<key, task>）
 */

import { api } from '@/services/tauriIpc'
import { convertFileSrc } from '@tauri-apps/api/core'
import type { ThumbSize } from '@/types/photo'

export type ThumbPriority = 'high' | 'normal' | 'low'

export type ThumbTaskState =
  | 'queued'
  | 'running'
  | 'fulfilled'
  | 'failed'
  | 'cancelled'

export interface ThumbTask {
  key: string
  photoId: string
  size: ThumbSize
  priority: ThumbPriority
  state: ThumbTaskState
  generation: number
  createdAt: number
  resolve: (url: string) => void
  reject: (error: unknown) => void
}

const MAX_CONCURRENT = 6
const PRIORITY_ORDER: Record<ThumbPriority, number> = { high: 0, normal: 1, low: 2 }

class LruCache<K, V> {
  private map = new Map<K, V>()

  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined
    const val = this.map.get(key)
    if (val === undefined) return undefined
    this.map.delete(key)
    this.map.set(key, val)
    return val
  }

  set(key: K, val: V): void {
    if (this.map.has(key)) this.map.delete(key)
    this.map.set(key, val)
  }

  has(key: K): boolean { return this.map.has(key) }
  delete(key: K): void { this.map.delete(key) }
  clear(): void { this.map.clear() }
  get size(): number { return this.map.size }
}

class Deque<T> {
  items: T[] = []
  head = 0

  get length(): number {
    return this.items.length - this.head
  }

  push(item: T): void {
    this.items.push(item)
  }

  shift(): T | undefined {
    if (this.head >= this.items.length) return undefined
    const item = this.items[this.head] ?? undefined
    this.head++
    if (this.head > 1000) {
      this.items = this.items.slice(this.head)
      this.head = 0
    }
    return item
  }

  clear(): void {
    this.items = []
    this.head = 0
  }
}

export class ThumbnailScheduler {
  private cache = new LruCache<string, string>()
  private taskMap = new Map<string, ThumbTask>()
  private keyGeneration = new Map<string, number>()

  private highQueue = new Deque<ThumbTask>()
  private normalQueue = new Deque<ThumbTask>()
  private lowQueue = new Deque<ThumbTask>()

  private running = 0
  private onResult?: (photoId: string, size: ThumbSize, url: string) => void

  constructor(options?: { onResult?: (photoId: string, size: ThumbSize, url: string) => void }) {
    this.onResult = options?.onResult
  }

  request(
    photoId: string,
    size: ThumbSize,
    priority: ThumbPriority = 'normal',
  ): Promise<string> {
    const key = this.cacheKey(photoId, size)

    const cached = this.cache.get(key)
    if (cached) return Promise.resolve(cached)

    const existing = this.taskMap.get(key)
    if (existing) {
      this.promoteExisting(existing, priority)
      return new Promise<string>((resolve, reject) => {
        const originalResolve = existing.resolve
        existing.resolve = (url: string) => {
          originalResolve(url)
          resolve(url)
        }
        const originalReject = existing.reject
        existing.reject = (err: unknown) => {
          originalReject(err)
          reject(err)
        }
      })
    }

    return new Promise<string>((resolve, reject) => {
      const generation = this.keyGeneration.get(key) ?? 0
      const task: ThumbTask = {
        key,
        photoId,
        size,
        priority,
        state: 'queued',
        generation,
        createdAt: Date.now(),
        resolve,
        reject,
      }
      this.taskMap.set(key, task)
      this.bucketFor(priority).push(task)
      this.scheduleNext()
    })
  }

  promote(photoId: string, size: ThumbSize, priority: ThumbPriority): void {
    const key = this.cacheKey(photoId, size)
    const existing = this.taskMap.get(key)
    if (existing) {
      this.promoteExisting(existing, priority)
    }
  }

  cancel(photoId: string, size: ThumbSize): void {
    const key = this.cacheKey(photoId, size)
    const existing = this.taskMap.get(key)
    if (existing && existing.state === 'queued') {
      existing.state = 'cancelled'
      this.taskMap.delete(key)
    }
  }

  invalidate(photoId: string, size: ThumbSize): void {
    const key = this.cacheKey(photoId, size)
    this.cache.delete(key)
    this.keyGeneration.set(key, (this.keyGeneration.get(key) ?? 0) + 1)

    const existing = this.taskMap.get(key)
    if (existing && existing.state === 'queued') {
      existing.state = 'cancelled'
      this.taskMap.delete(key)
    }
  }

  preload(
    requests: Array<{ photoId: string; size: ThumbSize; priority?: ThumbPriority }>,
  ): void {
    for (const { photoId, size, priority = 'low' } of requests) {
      const key = this.cacheKey(photoId, size)
      if (!this.cache.has(key) && !this.taskMap.has(key)) {
        this.request(photoId, size, priority).catch(() => {
          // 预加载失败静默忽略
        })
      }
    }
  }

  clear(): void {
    this.cache.clear()
    this.taskMap.clear()
    this.keyGeneration.clear()
    this.highQueue.clear()
    this.normalQueue.clear()
    this.lowQueue.clear()
  }

  private cacheKey(photoId: string, size: ThumbSize): string {
    return `${photoId}:${size}`
  }

  private bucketFor(priority: ThumbPriority): Deque<ThumbTask> {
    if (priority === 'high') return this.highQueue
    if (priority === 'normal') return this.normalQueue
    return this.lowQueue
  }

  private promoteExisting(task: ThumbTask, newPriority: ThumbPriority): void {
    if (task.state !== 'queued') return
    if (PRIORITY_ORDER[newPriority] >= PRIORITY_ORDER[task.priority]) return
    task.priority = newPriority
    const oldBucket = this.bucketFor(task.priority)
    const newBucket = this.bucketFor(newPriority)
    if (oldBucket !== newBucket) {
      task.state = 'cancelled'
      const newTask: ThumbTask = {
        ...task,
        priority: newPriority,
        state: 'queued',
      }
      this.taskMap.set(task.key, newTask)
      newBucket.push(newTask)
    }
  }

  private dequeueNext(): ThumbTask | undefined {
    return this.highQueue.shift() ?? this.normalQueue.shift() ?? this.lowQueue.shift()
  }

  private totalQueued(): number {
    return this.highQueue.length + this.normalQueue.length + this.lowQueue.length
  }

  private scheduleNext(): void {
    if (this.running >= MAX_CONCURRENT || this.totalQueued() === 0) return

    const task = this.dequeueNext()
    if (!task) return
    if (task.state === 'cancelled') {
      this.taskMap.delete(task.key)
      this.scheduleNext()
      return
    }

    this.running++
    task.state = 'running'

    this.fetchThumb(task).finally(() => {
      this.running--
      this.scheduleNext()
    })
  }

  private async fetchThumb(task: ThumbTask): Promise<void> {
    const key = task.key

    try {
      const cached = this.cache.get(key)
      if (cached) {
        task.state = 'fulfilled'
        this.taskMap.delete(key)
        task.resolve(cached)
        return
      }

      const currentGen = this.keyGeneration.get(key) ?? 0
      if (task.generation !== currentGen) {
        task.state = 'cancelled'
        this.taskMap.delete(key)
        task.reject(new ThumbNotReadyError(task.photoId))
        return
      }

      const filePath = await api.thumbnails.getPath(task.photoId, task.size)

      if (!filePath) {
        task.state = 'failed'
        this.taskMap.delete(key)
        task.reject(new ThumbNotReadyError(task.photoId))
        return
      }

      const url = convertFileSrc(filePath)
      this.cache.set(key, url)
      task.state = 'fulfilled'
      this.taskMap.delete(key)
      task.resolve(url)
      this.onResult?.(task.photoId, task.size, url)
    } catch (err) {
      task.state = 'failed'
      this.taskMap.delete(key)
      task.reject(err)
    }
  }
}

export class ThumbNotReadyError extends Error {
  constructor(public photoId: string) {
    super(`Thumbnail not ready: ${photoId}`)
    this.name = 'ThumbNotReadyError'
  }
}

export function isThumbNotReady(err: unknown): err is ThumbNotReadyError {
  return err instanceof ThumbNotReadyError
}

let instance: ThumbnailScheduler | null = null

export function getThumbnailScheduler(): ThumbnailScheduler {
  if (!instance) {
    instance = new ThumbnailScheduler()
  }
  return instance
}
