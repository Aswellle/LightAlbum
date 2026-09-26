/**
 * @file tests/e2e/flicker.spec.ts
 * @description P0-2 内容区闪烁回归测试
 *
 * 背景（本次修复的缺陷）：
 *   1. 切换侧边栏选项卡 / 筛选条件时，内容区会先画出一帧「空白网格」或
 *      「没有照片」空态，再画照片 —— 视觉上就是闪烁。
 *   2. 应用刚启动时也会先出现一帧空白内容区（网格配置尚未测量）。
 *
 * 测试手段：
 *   - 在页面加载前注入假的 Tauri IPC（`window.__TAURI_INTERNALS__`），
 *     让前端拿到确定的数据集（所有照片 12 张 / 收藏 6 张 / 标签 4 张）。
 *   - 用 requestAnimationFrame 逐帧采样内容区的 `data-grid-state`
 *     （content / skeleton / empty）、已渲染格子数量与状态栏计数。
 *     rAF 回调里读到的是「本帧即将绘制」的 DOM，因此等价于用户肉眼看到的画面。
 *
 * 断言的核心不变量：
 *   - 有照片的视图不允许出现 empty 帧（空态闪烁）
 *   - state=content 的帧不允许一张照片都没有（空白网格）
 *   - 已缓存视图之间切换时不允许出现 skeleton / empty / 缺帧（必须当帧完成替换）
 */

import { test, expect, type Page } from '@playwright/test'

// ─────────────────────────────────────────────────────────
//  类型
// ─────────────────────────────────────────────────────────

interface FrameSample {
  state: string
  items: number
  total: number
  ts:    number
}

interface UiState {
  state: string
  items: number
  total: number
}

// ─────────────────────────────────────────────────────────
//  假 IPC + 逐帧采样器（必须在页面脚本执行前注入）
// ─────────────────────────────────────────────────────────

async function installFakeIpc(page: Page) {
  await page.addInitScript(() => {
    // ── 构造稳定的照片数据集 ──
    //   注意：createdAt 必须按时间**有序**（后端返回的即有序结果），
    //   否则相邻照片月份不同，分组会退化成「一张一个分组」。
    const makePhotos = (prefix: string, count: number, isFavorite: boolean) =>
      Array.from({ length: count }, (_, i) => ({
        id:          `${prefix}-${i}`,
        filePath:    `C:/photos/${prefix}/${i}.jpg`,
        fileName:    `${prefix}-${i}.jpg`,
        fileSize:    1024 * (i + 1),
        fileHash:    `${prefix}-hash-${i}`,
        width:       1200,
        height:      800,
        orientation: 1,
        format:      'jpeg',
        createdAt:   new Date(Date.UTC(2025, 5, 28 - i, 10, 0, 0)).toISOString(),
        modifiedAt:  new Date(Date.UTC(2025, 5, 28, 10, 0, 0)).toISOString(),
        importedAt:  new Date(Date.UTC(2025, 5, 28, 10, 0, 0)).toISOString(),
        folderPath:  'C:/photos',
        gpsLat: null, gpsLng: null,
        cameraMake: null, cameraModel: null, lensModel: null,
        focalLength: null, aperture: null, shutterSpeed: null, iso: null,
        isFavorite,
        rating: 0,
        isDeleted: false,
        tags: [],
      }))

    const ALL_PHOTOS = makePhotos('all', 12, false)
    const FAVORITES  = makePhotos('fav', 6, true)
    const TAGGED     = makePhotos('tag', 4, false)

    const page1 = (items: unknown[]) => ({
      items,
      nextCursor: null,
      total: items.length,
    })

    const internals = {
      // Tauri v2 内部 API：事件监听会把回调注册到 window 上
      transformCallback(cb: unknown) {
        const id = Math.floor(Math.random() * 1_000_000_000)
        ;(window as unknown as Record<string, unknown>)[`_${id}`] = cb
        return id
      },
      async invoke(cmd: string, args?: Record<string, unknown>) {
        ;(window as unknown as { __invokes?: unknown[] }).__invokes?.push({ cmd, args })
        switch (cmd) {
          case 'settings_get':
            return {
              theme: 'dark',
              gridDensity: 2,
              sortBy: 'created_at',
              sortAsc: false,
              watchedFolders: [],
              sidebarWidth: 220,
              autoHidePreviewUI: false,
              previewOnDoubleClick: true,
            }
          case 'photos_list': {
            const filter = (args?.filter ?? {}) as Record<string, unknown>
            if (filter.favoritesOnly === true) return page1(FAVORITES)
            if (filter.isDeleted === true) return page1([])
            return page1(ALL_PHOTOS)
          }
          case 'photos_get_batch':
            return ALL_PHOTOS
          case 'search_photos':
            return page1(TAGGED)
          case 'folders_list':
          case 'albums_list':
          case 'albums_list_all':
          case 'photo_tags_get':
            return []
          case 'tags_list':
            return [{ id: 'tag-1', name: '旅行', color: '#0A84FF', photoCount: TAGGED.length }]
          case 'search_stats':
            return { totalPhotos: ALL_PHOTOS.length, totalAlbums: 0, totalTags: 1, totalSizeBytes: 0 }
          case 'thumbnail_get_path':
            // 1×1 透明 GIF，避免依赖真实缩略图管线
            return 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
          case 'thumbnail_request':
            return null
          default:
            return null
        }
      },
    }
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = internals
    ;(window as unknown as { __invokes: { cmd: string; args?: Record<string, unknown> }[] }).__invokes = []

    // ── 逐帧采样器 ──
    const frames: FrameSample[] = []
    ;(window as unknown as Record<string, unknown>).__frames = frames

    const sample = () => {
      const grid = document.querySelector('[data-testid="photo-grid"]')
      const statusText = document.querySelector('footer')?.textContent ?? ''
      const match = /(\d+)/.exec(statusText)
      frames.push({
        state: grid ? grid.getAttribute('data-grid-state') ?? 'unknown' : 'none',
        items: document.querySelectorAll('.la-grid-item').length,
        total: match ? Number(match[1]) : -1,
        ts:    performance.now(),
      })
      window.requestAnimationFrame(sample)
    }
    window.requestAnimationFrame(sample)
  })
}

/** 读取当前 UI 状态 */
async function readUi(page: Page): Promise<UiState> {
  return page.evaluate(() => {
    const grid = document.querySelector('[data-testid="photo-grid"]')
    const statusText = document.querySelector('footer')?.textContent ?? ''
    const match = /(\d+)/.exec(statusText)
    return {
      state: grid ? grid.getAttribute('data-grid-state') ?? 'none' : 'none',
      items: document.querySelectorAll('.la-grid-item').length,
      total: match ? Number(match[1]) : -1,
    }
  })
}

/** 读取并清空逐帧采样记录 */
async function takeFrames(page: Page): Promise<FrameSample[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __frames: FrameSample[] }
    const frames = w.__frames ?? []
    // 必须原地清空：采样器的 rAF 闭包持有同一个数组引用，
    // 若整体替换 window.__frames，后续采样会写入旧数组（表现为读不到任何帧）。
    const drained = frames.slice()
    frames.length = 0
    return drained
  })
}

const states = (frames: FrameSample[]) => frames.map((f) => f.state)

/** 等待内容区进入 content 且状态栏计数为 expectedTotal */
async function waitForView(page: Page, expectedTotal: number) {
  await expect
    .poll(async () => {
      const ui = await readUi(page)
      return { state: ui.state, total: ui.total }
    }, { timeout: 10_000 })
    .toMatchObject({ state: 'content', total: expectedTotal })

  // 内容帧必须真的有格子（空白网格缺陷的反向断言）
  await expect
    .poll(async () => (await readUi(page)).items, { timeout: 10_000 })
    .toBeGreaterThan(0)
}

/** content 帧必须都有格子 */
function assertNoBlankContentFrames(frames: FrameSample[]) {
  for (const f of frames.filter((x) => x.state === 'content')) {
    expect(f.items).toBeGreaterThan(0)
  }
}

// ─────────────────────────────────────────────────────────
//  Test Suite
// ─────────────────────────────────────────────────────────

test.describe('P0-2 内容区无闪烁', () => {
  test.beforeEach(async ({ page }) => {
    await installFakeIpc(page)
    await page.goto('/')
    await page.waitForSelector('nav', { timeout: 10_000 })
  })

  test('启动过程：从骨架屏直接到照片，不出现空态 / 空白网格', async ({ page }) => {
    await waitForView(page, 12)

    const frames = await takeFrames(page)
    expect(frames.length).toBeGreaterThan(0)

    // 1) 空态不得出现（有照片却闪「没有照片」是本次修复的主要缺陷）
    expect(states(frames)).not.toContain('empty')

    // 2) state=content 的帧必须真的有照片（空白网格缺陷）
    assertNoBlankContentFrames(frames)

    // 3) 采样的最后必须停在 content，且照片数量正确
    const last = frames[frames.length - 1]
    expect(last.state).toBe('content')
    expect(last.total).toBe(12)
  })

  test('切换选项卡（未缓存视图）：不闪空态，加载后显示新内容', async ({ page }) => {
    await waitForView(page, 12)
    await takeFrames(page)   // 清空启动阶段的采样

    await page.getByRole('button', { name: '收藏' }).click()
    await waitForView(page, 6)

    const frames = await takeFrames(page)
    expect(states(frames)).not.toContain('empty')
    assertNoBlankContentFrames(frames)

    const last = frames[frames.length - 1]
    expect(last.state).toBe('content')
    expect(last.total).toBe(6)
  })

  test('切换回已缓存视图：当帧完成替换，不出现骨架屏 / 空态 / 空白帧', async ({ page }) => {
    await waitForView(page, 12)
    await page.getByRole('button', { name: '收藏' }).click()
    await waitForView(page, 6)
    await takeFrames(page)

    // 在页面内派发点击并记录时间戳：Playwright 的 click() 含可操作性等待，
    // 会把点击前的若干帧也算进来，无法用于衡量「切换耗时」。
    await page.evaluate(() => {
      const button = Array.from(document.querySelectorAll('nav button')).find((b) =>
        b.textContent?.includes('所有照片'),
      )
      if (!button) throw new Error('未找到「所有照片」导航按钮')
      const w = window as unknown as { __clickAt?: number }
      w.__clickAt = performance.now()
      ;(button as HTMLElement).click()
    })
    await waitForView(page, 12)

    const frames = await takeFrames(page)
    expect(frames.length).toBeGreaterThan(0)

    // 全程必须都是 content：不得出现骨架屏 / 空态 / 空白帧
    expect(states(frames)).toEqual(frames.map(() => 'content'))

    const clickAt = await page.evaluate(
      () => (window as unknown as { __clickAt?: number }).__clickAt ?? 0,
    )
    const afterClick = frames.filter((f) => f.ts >= clickAt)

    // 当帧完成替换：点击后的第一帧就必须是 12 张（≈16ms）
    const trace = afterClick.map((f) => `${f.state}/${f.total}@${Math.round(f.ts)}`).join(' ')
    expect(afterClick.length, trace).toBeGreaterThan(0)
    expect(afterClick[0].total, trace).toBe(12)

    // 替换后不得再回到旧视图
    for (const f of afterClick) {
      expect(f.total).toBe(12)
    }
  })

  test('切换瀑布流布局：不闪空态 / 空白帧', async ({ page }) => {
    await waitForView(page, 12)
    await takeFrames(page)

    await page.getByRole('button', { name: '瀑布流布局' }).click()
    await waitForView(page, 12)

    const frames = await takeFrames(page)
    expect(states(frames)).not.toContain('empty')
    assertNoBlankContentFrames(frames)

    const last = frames[frames.length - 1]
    expect(last.state).toBe('content')
    expect(last.items).toBeGreaterThan(0)
  })

  test('标签筛选：切换筛选条件不闪空态，且内容切换到标签结果', async ({ page }) => {
    await waitForView(page, 12)
    await takeFrames(page)

    // 侧边栏标签区块 → 点击「旅行」进入标签筛选视图
    await page.getByRole('button', { name: '旅行' }).click()
    await waitForView(page, 4)

    const frames = await takeFrames(page)
    expect(states(frames)).not.toContain('empty')
    assertNoBlankContentFrames(frames)

    const last = frames[frames.length - 1]
    expect(last.state).toBe('content')
    expect(last.total).toBe(4)
  })
})
