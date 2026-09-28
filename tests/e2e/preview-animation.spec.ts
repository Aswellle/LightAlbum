/**
 * @file tests/e2e/preview-animation.spec.ts
 * @description P0-3 大图预览观感回归测试
 *
 * 覆盖的三个可观察不变量：
 *   1. 打开预览后，**每一帧**预览内都有图像元素 —— 不出现「只有骨架占位」的帧
 *      （原实现把 's'/'m' 缩略图与骨架放在不同元素上，切换时会先闪骨架再跳成 <img>）。
 *   2. 方向键逐张切换时同样每帧都有图像 —— 缩略图底图即时可见，不等原图解码。
 *   3. 删除确认弹窗位于预览覆盖层**之上**且可点击
 *      （原先 --la-z-modal 400 < --la-z-preview 500，弹窗被压在预览底下，点不到）。
 *
 * 手法与 flicker.spec.ts 一致：注入假 Tauri IPC + requestAnimationFrame 逐帧采样。
 */

import { test, expect, type Page } from '@playwright/test'

interface FrameSample {
  preview: boolean
  imgs:    number
  ts:      number
}

// ─────────────────────────────────────────────────────────
//  假 IPC + 逐帧采样
// ─────────────────────────────────────────────────────────

async function installStub(page: Page) {
  await page.addInitScript(() => {
    const THUMB =
      'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

    const makePhotos = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        id:          `p-${i}`,
        filePath:    `C:/photos/p-${i}.jpg`,
        fileName:    `p-${i}.jpg`,
        fileSize:    1024 * (i + 1),
        fileHash:    `hash-${i}`,
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
        isFavorite: false,
        rating: 0,
        isDeleted: false,
        tags: [],
      }))

    const PHOTOS = makePhotos(12)

    const internals = {
      transformCallback(cb: unknown) {
        const id = Math.floor(Math.random() * 1_000_000_000)
        ;(window as unknown as Record<string, unknown>)[`_${id}`] = cb
        return id
      },
      // 预览用 convertFileSrc 取原图 URL；测试里直接复用缩略图 data URL，
      // 让「原图」也能立即加载完成（覆盖底图→原图交叉淡变路径）。
      convertFileSrc(_path: string) {
        return THUMB
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
          case 'photos_list':
            return { items: PHOTOS, nextCursor: null, total: PHOTOS.length }
          case 'photos_get':
            return PHOTOS.find((p) => p.id === args?.id) ?? PHOTOS[0]
          case 'photos_delete':
          case 'photos_restore':
            return null
          case 'thumbnail_get_path':
            return THUMB
          case 'thumbnail_request':
            return null
          case 'folders_list':
          case 'albums_list':
          case 'albums_list_all':
          case 'photo_tags_get':
            return []
          case 'tags_list':
            return []
          case 'search_stats':
            return { totalPhotos: PHOTOS.length, totalAlbums: 0, totalTags: 0, totalSizeBytes: 0 }
          default:
            return null
        }
      },
    }

    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = internals
    ;(window as unknown as { __invokes: { cmd: string }[] }).__invokes = []

    const frames: FrameSample[] = []
    ;(window as unknown as { __frames: FrameSample[] }).__frames = frames

    const sample = () => {
      const root = document.querySelector('[data-testid="preview-root"]')
      frames.push({
        preview: Boolean(root),
        imgs:    root ? root.querySelectorAll('img').length : 0,
        ts:      performance.now(),
      })
      window.requestAnimationFrame(sample)
    }
    window.requestAnimationFrame(sample)
  })
}

/** 读取并原地清空采样（必须原地清空：采样闭包持有同一数组引用） */
async function takeFrames(page: Page): Promise<FrameSample[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __frames: FrameSample[] }
    const frames = w.__frames ?? []
    const drained = frames.slice()
    frames.length = 0
    return drained
  })
}

async function readInvokes(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    ((window as unknown as { __invokes?: { cmd: string }[] }).__invokes ?? []).map((i) => i.cmd),
  )
}

async function waitForGrid(page: Page) {
  await expect
    .poll(async () => page.locator('.la-grid-item').count(), { timeout: 15_000 })
    .toBeGreaterThan(0)
}

// ─────────────────────────────────────────────────────────
//  Test Suite
// ─────────────────────────────────────────────────────────

test.describe('P0-3 大图预览无闪烁', () => {
  test.beforeEach(async ({ page }) => {
    await installStub(page)
    await page.goto('/')
    await page.waitForSelector('nav', { timeout: 15_000 })
    await waitForGrid(page)
  })

  test('打开预览：从第一帧起预览内就有图像（不闪骨架占位）', async ({ page }) => {
    await takeFrames(page)

    await page.locator('.la-grid-item').first().click()
    await expect(page.locator('[data-testid="preview-root"]')).toBeVisible({ timeout: 10_000 })
    // 留出一段时间覆盖底图→原图的交接
    await page.waitForTimeout(250)

    const frames = await takeFrames(page)
    const openFrames = frames.filter((f) => f.preview)
    expect(openFrames.length).toBeGreaterThan(0)

    // 关键不变量：预览出现后的任何一帧都必须有图像元素
    const blankFrames = openFrames.filter((f) => f.imgs === 0)
    expect(blankFrames.length).toBe(0)

    await page.screenshot({ path: 'test-results/preview-open.png' })
  })

  test('方向键切图：全程有图像（底图即时可见，不等原图）', async ({ page }) => {
    await page.locator('.la-grid-item').first().click()
    await expect(page.locator('[data-testid="preview-root"]')).toBeVisible({ timeout: 10_000 })
    await page.waitForTimeout(200)
    await takeFrames(page)

    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('ArrowRight')
      await page.waitForTimeout(200)
    }

    const frames = await takeFrames(page)
    expect(frames.length).toBeGreaterThan(0)
    expect(frames.filter((f) => f.preview && f.imgs === 0).length).toBe(0)
  })

  test('信息面板打开不改变照片几何（覆盖层，无重排）', async ({ page }) => {
    await page.locator('.la-grid-item').first().click()
    await expect(page.locator('[data-testid="preview-root"]')).toBeVisible({ timeout: 10_000 })
    await page.waitForTimeout(250)

    const before = await page.locator('[data-testid="preview-root"] img').first().boundingBox()

    await page.keyboard.press('i')   // 切换照片信息面板
    await expect(page.locator('[data-testid="preview-root"] aside')).toBeVisible({ timeout: 5_000 })
    await page.waitForTimeout(400)   // 等面板滑入动画结束

    const after = await page.locator('[data-testid="preview-root"] img').first().boundingBox()

    // 面板若占用 flex 行宽（旧实现），照片会被挤窄 ~320px；覆盖层则几何不变
    expect(after?.width  ?? -1).toBeCloseTo(before?.width  ?? -2, 0)
    expect(after?.height ?? -1).toBeCloseTo(before?.height ?? -2, 0)

    await page.screenshot({ path: 'test-results/preview-exif-overlay.png' })
  })

  test('删除确认弹窗位于预览之上且可点击', async ({ page }) => {
    await page.locator('.la-grid-item').first().click()
    await expect(page.locator('[data-testid="preview-root"]')).toBeVisible({ timeout: 10_000 })

    // 预览工具栏 2 秒无鼠标移动会自动隐藏 → 先移动鼠标唤出工具栏
    await page.mouse.move(400, 300)
    await page.waitForTimeout(100)

    // 预览工具栏的删除按钮（aria-label = 删除）
    await page.getByRole('button', { name: '删除' }).first().click()

    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible({ timeout: 5_000 })

    // 若弹窗被预览覆盖，Playwright 会因为「元素被遮挡」而点击失败 —— 通过即可证明层级正确
    await dialog.getByRole('button', { name: '删除' }).click()

    await expect
      .poll(async () => (await readInvokes(page)).includes('photos_delete'), { timeout: 5_000 })
      .toBe(true)
  })
})
