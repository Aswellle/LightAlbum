/// <reference lib="webworker" />

import {
  buildWaterfallLayout,
  type WaterfallConfig,
  type WaterfallLayoutState,
} from './waterfallLayout'
import type { PhotoEntity } from '@/domain/photo/photoTypes'

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

  const { columnHeights, columnItems } = state
  const colCount = state.columnCount

  for (let i = 0; i < newIds.length; i++) {
    const id = newIds[i]
    if (!id) continue
    const entity = entityLookup(id)
    if (!entity) continue

    let minCol = 0
    let minHeight = columnHeights[0] ?? 0
    for (let c = 1; c < colCount; c++) {
      const h = columnHeights[c] ?? 0
      if (h < minHeight) {
        minHeight = h
        minCol = c
      }
    }

    const ar = entity.width / entity.height
    const itemHeight = Math.round(state.columnWidth / ar)
    const x = minCol * (state.columnWidth + state.gap) + state.gap
    const y = minHeight

    const idx = state.count
    state.x[idx] = x
    state.y[idx] = y
    state.width[idx] = state.columnWidth
    state.height[idx] = itemHeight

    const col = columnItems[minCol]
    if (col) col.push(idx)

    columnHeights[minCol] = minHeight + itemHeight + state.gap
    state.count++
  }

  state.totalHeight = Math.max(...Array.from(columnHeights))
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
      columnHeights: Array.from(state.columnHeights),
      totalHeight: state.totalHeight,
      count: state.count,
      generation: state.generation,
      columnItems: state.columnItems.map((col) => [...col]),
    },
  }

  ctx.postMessage(result, [xBuf, yBuf, wBuf, hBuf])
}
