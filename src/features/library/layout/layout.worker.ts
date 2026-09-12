/**
 * @file src/features/library/layout/layout.worker.ts
 * @description V2 布局 Web Worker — 将 config rebuild 移出主线程
 *
 * 主线程与 Worker 通过 postMessage 通信：
 *   Main → Worker: { type: 'build', payload: { orderedIds, entities, config } }
 *   Worker → Main: { type: 'result', payload: { arrays, columnHeights, ... } }
 */

/// <reference lib="webworker" />

import {
  buildWaterfallLayout,
  type WaterfallConfig,
  type WaterfallLayoutState,
} from './waterfallLayout'
import type { PhotoEntity } from '@/domain/photo/photoTypes'

// ─────────────────────────────────────────────────────────
//  消息类型
// ─────────────────────────────────────────────────────────

export interface LayoutBuildRequest {
  type: 'build'
  requestId: number
  payload: {
    orderedIds: string[]
    entities: Record<string, PhotoEntity>
    config: WaterfallConfig
    generation: number
  }
}

export interface LayoutAppendRequest {
  type: 'append'
  requestId: number
  payload: {
    newIds: string[]
    entities: Record<string, PhotoEntity>
    generation: number
  }
}

export type WorkerRequest = LayoutBuildRequest | LayoutAppendRequest

export interface LayoutResult {
  type: 'result'
  requestId: number
  payload: {
    x: ArrayBuffer
    y: ArrayBuffer
    width: ArrayBuffer
    height: ArrayBuffer
    columnHeights: number[]
    totalHeight: number
    count: number
    generation: number
    columnItems: number[][]
  }
}

export type WorkerResponse = LayoutResult

// ─────────────────────────────────────────────────────────
//  Worker 逻辑
// ─────────────────────────────────────────────────────────

const ctx = self as unknown as DedicatedWorkerGlobalScope

let currentState: WaterfallLayoutState | null = null

ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data

  if (msg.type === 'build') {
    const { orderedIds, entities, config, generation } = msg.payload
    const entityLookup = (id: string) => entities[id]
    currentState = buildWaterfallLayout(orderedIds, entityLookup, config, generation)
    sendResult(msg.requestId)
  } else if (msg.type === 'append') {
    if (!currentState) return
    const { newIds, entities, generation } = msg.payload
    const entityLookup = (id: string) => entities[id]
    currentState = appendInWorker(currentState, newIds, entityLookup, generation)
    sendResult(msg.requestId)
  }
}

function appendInWorker(
  state: WaterfallLayoutState,
  newIds: string[],
  entityLookup: (id: string) => PhotoEntity | undefined,
  generation: number,
): WaterfallLayoutState {
  if (newIds.length === 0) return state

  const required = state.count + newIds.length
  if (required > state.x.length) {
    let newCap = state.x.length * 2
    while (newCap < required) newCap *= 2
    const newX = new Float32Array(newCap)
    const newY = new Float32Array(newCap)
    const newW = new Float32Array(newCap)
    const newH = new Float32Array(newCap)
    newX.set(state.x)
    newY.set(state.y)
    newW.set(state.width)
    newH.set(state.height)
    state.x = newX
    state.y = newY
    state.width = newW
    state.height = newH
  }

  for (let i = 0; i < newIds.length; i++) {
    const entity = entityLookup(newIds[i]!)
    if (!entity) continue

    let minCol = 0
    for (let c = 1; c < state.columnCount; c++) {
      if (state.columnHeights[c]! < state.columnHeights[minCol]!) minCol = c
    }

    const ar = entity.width / entity.height
    const height = Math.round(state.columnWidth / ar)
    const x = minCol * (state.columnWidth + state.gap) + state.gap
    const y = state.columnHeights[minCol]!

    const idx = state.count
    state.x[idx] = x
    state.y[idx] = y
    state.width[idx] = state.columnWidth
    state.height[idx] = height
    state.columnItems[minCol]!.push(idx)
    state.columnHeights[minCol]! += height + state.gap
    state.count++
  }

  state.totalHeight = Math.max(...state.columnHeights)
  state.generation = generation
  return state
}

function sendResult(requestId: number): void {
  if (!currentState) return

  const state = currentState
  const xBuf = state.x.slice(0, state.count).buffer
  const yBuf = state.y.slice(0, state.count).buffer
  const wBuf = state.width.slice(0, state.count).buffer
  const hBuf = state.height.slice(0, state.count).buffer

  const result: WorkerResponse = {
    type: 'result',
    requestId,
    payload: {
      x: xBuf,
      y: yBuf,
      width: wBuf,
      height: hBuf,
      columnHeights: [...state.columnHeights],
      totalHeight: state.totalHeight,
      count: state.count,
      generation: state.generation,
      columnItems: state.columnItems.map((col) => [...col]),
    },
  }

  ctx.postMessage(result, [xBuf, yBuf, wBuf, hBuf])
}
