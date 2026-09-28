/**
 * @file tests/e2e/startup.spec.ts
 * @description P0-3 启动阶段回归测试（首个可交互帧 + 不闪空态）
 *
 * 两个可观察不变量：
 *   1. 列表数据尚未返回时，侧边栏不得显示「暂无相册 / 暂无标签」——
 *      真实后端几毫秒就返回，之前会在首屏闪一下空态（与 P0-2 的空态闪烁同类）。
 *      数据返回后若确实为空，引导文案必须照常出现（避免"把提示删掉"式修复）。
 *   2. 外壳在首屏数据仍在途中时就已经可交互：点击「收藏」能切换视图并发出对应查询。
 *
 * 手法：注入假 IPC，但把列表查询**延迟 600ms** 返回，从而人为放大启动窗口。
 */

import { test, expect, type Page } from '@playwright/test'

interface StartupFrame {
  albumHint: boolean
  tagHint:   boolean
  ts:        number
}

interface InvokeRecord {
  cmd:     string
  filter?: Record<string, unknown>
}

const DELAY_MS = 600

async function installStub(page: Page) {
  await page.addInitScript(({ delayMs }) => {
    const PHOTO = {
      id: 'p-0', filePath: 'C:/photos/p-0.jpg', fileName: 'p-0.jpg',
      fileSize: 1024, fileHash: 'h0',
      width: 1200, height: 800, orientation: 1, format: 'jpeg',
      createdAt: new Date(Date.UTC(2025, 5, 20, 10, 0, 0)).toISOString(),
      modifiedAt: new Date(Date.UTC(2025, 5, 20, 10, 0, 0)).toISOString(),
      importedAt: new Date(Date.UTC(2025, 5, 20, 10, 0, 0)).toISOString(),
      folderPath: 'C:/photos',
      gpsLat: null, gpsLng: null, cameraMake: null, cameraModel: null, lensModel: null,
      focalLength: null, aperture: null, shutterSpeed: null, iso: null,
      isFavorite: false, rating: 0, isDeleted: false, tags: [],
    }

    // 项目规则：优先 Promise.withResolvers 而不是 new Promise(executor)
    const sleep = (ms: number) => {
      const { promise, resolve } = Promise.withResolvers<void>()
      setTimeout(resolve, ms)
      return promise
    }
    const w = window as unknown as {
      __startupResolvedAt?: number
      __invokes?: InvokeRecord[]
      __frames?: StartupFrame[]
      __TAURI_INTERNALS__?: unknown
      [k: string]: unknown
    }

    w.__TAURI_INTERNALS__ = {
      transformCallback(cb: unknown) {
        const id = Math.floor(Math.random() * 1_000_000_000)
        w[`_${id}`] = cb
        return id
      },
      convertFileSrc: (path: string) => path,
      async invoke(cmd: string, args?: Record<string, unknown>) {
        w.__invokes?.push({
          cmd,
          filter: (args?.filter ?? {}) as Record<string, unknown>,
        })

        switch (cmd) {
          case 'settings_get':
            return {
              theme: 'dark', gridDensity: 2, sortBy: 'created_at', sortAsc: false,
              watchedFolders: [], sidebarWidth: 220,
              autoHidePreviewUI: false, previewOnDoubleClick: false,
            }
          case 'photos_list':
            await sleep(delayMs)
            return { items: [PHOTO], nextCursor: null, total: 1 }
          case 'search_stats':
            await sleep(delayMs)
            return { totalPhotos: 1, totalAlbums: 0, totalTags: 0, totalSizeBytes: 0 }
          case 'albums_list':
          case 'albums_list_all':
            await sleep(delayMs)
            // 记录列表数据真正到达的时刻：此前的空态提示都属于"闪烁"
            w.__startupResolvedAt = performance.now()
            return []
          case 'tags_list':
            await sleep(delayMs)
            return []
          case 'folders_list':
            await sleep(delayMs)
            return []
          case 'thumbnail_get_path':
            return 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
          default:
            return null
        }
      },
    }

    w.__invokes = []
    const frames: StartupFrame[] = []
    w.__frames = frames

    const sample = () => {
      const text = document.body.textContent ?? ''
      frames.push({
        albumHint: text.includes('暂无相册'),
        tagHint:   text.includes('暂无标签'),
        ts:        performance.now(),
      })
      window.requestAnimationFrame(sample)
    }
    window.requestAnimationFrame(sample)
  }, { delayMs: DELAY_MS })
}

async function takeFrames(page: Page): Promise<StartupFrame[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __frames: StartupFrame[] }
    const frames = w.__frames ?? []
    const drained = frames.slice()
    frames.length = 0   // 原地清空，保持采样闭包引用
    return drained
  })
}

// ─────────────────────────────────────────────────────────
//  Test Suite
// ─────────────────────────────────────────────────────────

test.describe('P0-3 启动阶段', () => {
  test.beforeEach(async ({ page }) => {
    await installStub(page)
  })

  test('列表数据到达前不闪「暂无相册 / 暂无标签」，到达后正常显示', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('nav', { timeout: 15_000 })

    // 等数据到达并稳定
    await expect
      .poll(
        async () => page.evaluate(() => (window as unknown as { __startupResolvedAt?: number }).__startupResolvedAt ?? 0),
        { timeout: 10_000 },
      )
      .toBeGreaterThan(0)
    await page.waitForTimeout(300)

    const resolvedAt = await page.evaluate(
      () => (window as unknown as { __startupResolvedAt?: number }).__startupResolvedAt ?? 0,
    )

    const frames = await takeFrames(page)
    expect(frames.length).toBeGreaterThan(0)

    // 数据到达之前的任何一帧都不得出现空态引导文案
    const premature = frames.filter((f) => (f.albumHint || f.tagHint) && f.ts < resolvedAt)
    expect(premature.length).toBe(0)

    // 数据到达后（本用例返回空列表）引导文案必须照常出现
    const afterResolve = frames.filter((f) => f.ts > resolvedAt + 50)
    expect(afterResolve.some((f) => f.albumHint)).toBe(true)
    expect(afterResolve.some((f) => f.tagHint)).toBe(true)
  })

  test('首屏数据仍在途中时外壳已可交互（点击收藏即切换视图）', async ({ page }) => {
    await page.goto('/')

    // 外壳先于数据可用：导航按钮此时已存在
    const favoritesNav = page.getByRole('button', { name: '收藏' })
    await expect(favoritesNav).toBeVisible({ timeout: 5_000 })

    // 首次数据仍在途中（网格应为骨架屏）
    const gridState = await page.evaluate(() =>
      document.querySelector('[data-testid="photo-grid"]')?.getAttribute('data-grid-state') ?? 'none',
    )
    expect(['skeleton', 'none']).toContain(gridState)

    await favoritesNav.click()

    // 点击被真正处理：发出了收藏视图的查询
    await expect
      .poll(
        async () =>
          page.evaluate(() =>
            ((window as unknown as { __invokes?: InvokeRecord[] }).__invokes ?? []).some(
              (i) => i.cmd === 'photos_list' && i.filter?.favoritesOnly === true,
            ),
          ),
        { timeout: 5_000 },
      )
      .toBe(true)
  })
})
