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

// ─────────────────────────────────────────────────────────
//  类型
// ─────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────
//  配置
// ─────────────────────────────────────────────────────────

const MAX_CONCURRENT = 6
const PRIORITY_ORDER: Record<ThumbPriority, number> = { high: 0, normal: 1, low: 2 }

// ─────────────────────────────────────────────────────────
//  LRU 缓存
// ─────────────────────────────────────────────────────────

class LruCache<K, V> {
  private map = new Map<K, V>()

  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined
    const val = this.map.get(key)!
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

// ─────────────────────────────────────────────────────────
//  双端队列（O(1) 出队）
// ─────────────────────────────────────────────────────────

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
    const item = this.items[this.head]!
    this.head++
    // 定期清理以防止内存泄漏
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

// ─────────────────────────────────────────────────────────
//  ThumbnailScheduler 类
// ─────────────────────────────────────────────────────────

export class ThumbnailScheduler {
  private cache = new LruCache<string, string>()
  private taskMap = new Map<string, ThumbTask>()
  private keyGeneration = new Map<string, number>()

  // 三个优先级桶（双端队列）
  private highQueue = new Deque<ThumbTask>()
  private normalQueue = new Deque<ThumbTask>()
  private lowQueue = new Deque<ThumbTask>()

  private running = 0
  private onResult?: (photoId: string, size: ThumbSize, url: string) => void

  constructor(options?: { onResult?: (photoId: string, size: ThumbSize, url: string) => void }) {
    this.onResult = options?.onResult
  }

  // ── 公开 API ──

  /**
   * 请求缩略图 URL
   * @returns Promise<string> 可直接赋给 <img src> 的 URL
   */
  request(
    photoId: string,
    size: ThumbSize,
    priority: ThumbPriority = 'normal',
  ): Promise<string> {
    const key = this.cacheKey(photoId, size)

    // 命中缓存 → 立即返回
    const cached = this.cache.get(key)
    if (cached) return Promise.resolve(cached)

    // 已有任务 → 尝试提升优先级
    const existing = this.taskMap.get(key)
    if (existing) {
      this.promoteExisting(existing, priority)
      // 返回新 Promise（与现有任务共享结果）
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

    // 创建新任务并入队
    return new Promise<string>((resolve, reject) => {
      const generation = (this.keyGeneration.get(key) ?? 0)
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

  /**
   * 提升已存在任务的优先级
   */
  promote(photoId: string, size: ThumbSize, priority: ThumbPriority): void {
    const key = this.cacheKey(photoId, size)
    const existing = this.taskMap.get(key)
    if (existing) {
      this.promoteExisting(existing, priority)
    }
  }

  /**
   * 取消指定任务
   */
  cancel(photoId: string, size: ThumbSize): void {
    const key = this.cacheKey(photoId, size)
    const existing = this.taskMap.get(key)
    if (existing && existing.state === 'queued') {
      existing.state = 'cancelled'
      this.taskMap.delete(key)
    }
  }

  /**
   * 使缓存失效（代际 +1，旧任务结果丢弃）
   */
  invalidate(photoId: string, size: ThumbSize): void {
    const key = this.cacheKey(photoId, size)
    this.cache.delete(key)
    this.keyGeneration.set(key, (this.keyGeneration.get(key) ?? 0) + 1)

    // 取消进行中的任务
    const existing = this.taskMap.get(key)
    if (existing && existing.state === 'queued') {
      existing.state = 'cancelled'
      this.taskMap.delete(key)
    }
  }

  /**
   * 批量预加载
   */
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

  /**
   * 清空所有缓存和队列
   */
  clear(): void {
    this.cache.clear()
    this.taskMap.clear()
    this.keyGeneration.clear()
    this.highQueue.clear()
    this.normalQueue.clear()
    this.lowQueue.clear()
  }

  // ── 内部方法 ──

  private cacheKey(photoId: string, size: ThumbSize): string {
    return `${photoId}:${size}`
  }

  private bucketFor(priority: ThumbPriority): Deque<ThumbTask> {
    if (priority === 'high') return this.highQueue
    if (priority === 'normal') return this.normalQueue
    return this.lowQueue
  }

  /**
   * 提升已存在任务的优先级
   * 如果任务已在运行，无法提升；如果已入队，更新优先级
   */
  private promoteExisting(task: ThumbTask, newPriority: ThumbPriority): void {
    if (task.state !== 'queued') return
    if (PRIORITY_ORDER[newPriority] >= PRIORITY_ORDER[task.priority]) return
    // 优先级提升：更新任务优先级（桶内顺序不变，但下次调度会优先处理）
    task.priority = newPriority
    // 重新入队到更高优先级桶
    const oldBucket = this.bucketFor(task.priority)
    const newBucket = this.bucketFor(newPriority)
    if (oldBucket !== newBucket) {
      // 标记旧任务为 cancelled，在新桶中创建新任务
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

    const task = this.dequeueNext()!
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
      // 二次检查缓存
      const cached = this.cache.get(key)
      if (cached) {
        task.state = 'fulfilled'
        this.taskMap.delete(key)
        task.resolve(cached)
        return
      }

      // 代际检查：如果 generation 已变化，丢弃结果
      const currentGen = this.keyGeneration.get(key) ?? 0
      if (task.generation !== currentGen) {
        task.state = 'cancelled'
        this.taskMap.delete(key)
        task.reject(new ThumbNotReadyError(task.photoId))
        return
      }

      // IPC 获取路径
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

// ─────────────────────────────────────────────────────────
//  错误类型
// ─────────────────────────────────────────────────────────

export class ThumbNotReadyError extends Error {
  constructor(public photoId: string) {
    super(`Thumbnail not ready: ${photoId}`)
    this.name = 'ThumbNotReadyError'
  }
}

export function isThumbNotReady(err: unknown): err is ThumbNotReadyError {
  return err instanceof ThumbNotReadyError
}

// ─────────────────────────────────────────────────────────
//  单例导出
// ─────────────────────────────────────────────────────────

let instance: ThumbnailScheduler | null = null

export function getThumbnailScheduler(): ThumbnailScheduler {
  if (!instance) {
    instance = new ThumbnailScheduler()
  }
  return instance
}
