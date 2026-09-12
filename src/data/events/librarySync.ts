/**
 * @file src/data/events/librarySync.ts
 * @description V2 库同步状态 — revision 追踪 + gap 检测
 *
 * 维护：
 *   latestRevision: 已知的最新图库版本
 *   latestSeq: 已知的最新事件序列号
 *
 * 事件进入时校验：
 *   seq <= latestSeq → 丢弃重复
 *   revision < latestRevision → 幂等事件可丢弃
 *   revision > latestRevision + 1 → gap → reconcile
 */

import { create } from 'zustand'

export interface LibrarySyncState {
  /** 已知的最新图库 revision */
  latestRevision: number
  /** 已知的最新事件 seq */
  latestSeq: number
  /** 是否正在同步 */
  syncing: boolean
  /** 最后同步时间 */
  lastSyncedAt: number | null

  /** 更新 seq */
  setSeq: (seq: number) => void
  /** 更新 revision */
  setRevision: (revision: number) => void
  /** 检测 revision gap */
  checkGap: (incomingRevision: number) => 'ok' | 'gap' | 'stale'
  /** 标记同步状态 */
  setSyncing: (syncing: boolean) => void
  /** 重置 */
  reset: () => void
}

export const useLibrarySyncStore = create<LibrarySyncState>()((set, get) => ({
  latestRevision: 0,
  latestSeq: 0,
  syncing: false,
  lastSyncedAt: null,

  setSeq: (seq) => {
    if (seq > get().latestSeq) {
      set({ latestSeq: seq })
    }
  },

  setRevision: (revision) => {
    if (revision > get().latestRevision) {
      set({ latestRevision: revision, lastSyncedAt: Date.now() })
    }
  },

  checkGap: (incomingRevision) => {
    const { latestRevision } = get()
    if (incomingRevision <= latestRevision) return 'stale'
    if (incomingRevision > latestRevision + 1) return 'gap'
    return 'ok'
  },

  setSyncing: (syncing) => set({ syncing }),

  reset: () => set({
    latestRevision: 0,
    latestSeq: 0,
    syncing: false,
    lastSyncedAt: null,
  }),
}))
