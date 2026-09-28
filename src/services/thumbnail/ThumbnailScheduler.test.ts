/**
 * @file src/services/thumbnail/ThumbnailScheduler.test.ts
 * @description 缩略图调度器的 URL 记忆缓存语义
 *
 * 重点覆盖 P0-3：原实现的「LruCache」只有 Map、从不淘汰（内存只增不减）。
 * 这里断言的是**可观察行为**——IPC 解析次数与缓存规模——而不是内部数据结构。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getPathMock } = vi.hoisted(() => ({ getPathMock: vi.fn() }))

vi.mock('@/services/tauriIpc', () => ({
  api: { thumbnails: { getPath: getPathMock } },
  ipc: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  convertFileSrc: (path: string) => `asset://localhost/${path}`,
}))

import { ThumbnailScheduler } from './ThumbnailScheduler'

describe('ThumbnailScheduler URL 记忆缓存', () => {
  beforeEach(() => {
    getPathMock.mockReset()
    getPathMock.mockImplementation((photoId: string) =>
      Promise.resolve(`/thumbs/${photoId}.jpg`),
    )
  })

  it('命中缓存时不再解析第二次', async () => {
    const scheduler = new ThumbnailScheduler({ cacheCapacity: 10 })

    const first  = await scheduler.request('p1', 's')
    const second = await scheduler.request('p1', 's')

    expect(first).toBe(second)
    expect(getPathMock).toHaveBeenCalledTimes(1)
    expect(scheduler.cachedUrlCount).toBe(1)
  })

  it('不同尺寸视为不同条目', async () => {
    const scheduler = new ThumbnailScheduler({ cacheCapacity: 10 })

    await scheduler.request('p1', 's')
    await scheduler.request('p1', 'm')

    expect(getPathMock).toHaveBeenCalledTimes(2)
    expect(scheduler.cachedUrlCount).toBe(2)
  })

  it('超出容量时淘汰最久未使用的条目（LRU）', async () => {
    const scheduler = new ThumbnailScheduler({ cacheCapacity: 2 })

    await scheduler.request('p1', 's')   // 缓存: p1
    await scheduler.request('p2', 's')   // 缓存: p1, p2
    await scheduler.request('p1', 's')   // 命中 → p1 变为最近使用，p2 成为 LRU

    expect(scheduler.cachedUrlCount).toBe(2)
    expect(getPathMock).toHaveBeenCalledTimes(2)

    await scheduler.request('p3', 's')   // 插入触发淘汰：p2 出局
    expect(scheduler.cachedUrlCount).toBe(2)
    expect(getPathMock).toHaveBeenCalledTimes(3)

    await scheduler.request('p1', 's')   // 仍命中
    await scheduler.request('p3', 's')   // 仍命中
    expect(getPathMock).toHaveBeenCalledTimes(3)

    await scheduler.request('p2', 's')   // 已被淘汰 → 重新解析
    expect(getPathMock).toHaveBeenCalledTimes(4)
    expect(scheduler.cachedUrlCount).toBe(2)   // 容量始终受控
  })

  it('invalidate 之后重新解析（代际失效）', async () => {
    const scheduler = new ThumbnailScheduler({ cacheCapacity: 10 })

    await scheduler.request('p1', 's')
    scheduler.invalidate('p1', 's')
    expect(scheduler.cachedUrlCount).toBe(0)

    await scheduler.request('p1', 's')
    expect(getPathMock).toHaveBeenCalledTimes(2)
  })

  it('preload 跳过已缓存的条目', async () => {
    const scheduler = new ThumbnailScheduler({ cacheCapacity: 10 })

    await scheduler.request('p1', 's')
    scheduler.preload([{ photoId: 'p1', size: 's' }])
    scheduler.preload([{ photoId: 'p1', size: 's' }])
    await Promise.resolve()

    expect(getPathMock).toHaveBeenCalledTimes(1)
  })

  it('clear 之后缓存清空', async () => {
    const scheduler = new ThumbnailScheduler({ cacheCapacity: 10 })

    await scheduler.request('p1', 's')
    scheduler.clear()

    expect(scheduler.cachedUrlCount).toBe(0)
  })
})
