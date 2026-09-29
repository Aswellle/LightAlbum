/**
 * @file tests/e2e/preview-animation.spec.ts
 * @description P0-3 大图预览观感回归测试
 *
 * 覆盖的可观察不变量：
 *   1. 打开预览后**每一帧**预览内都有图像元素 —— 不出现「只有骨架占位」的帧
 *      （原实现把缩略图与骨架放在不同元素上，切换时会先闪骨架再跳成 <img>）。
 *   2. 方向键逐张切换时同样每帧都有图像 —— 缩略图底图即时可见，不等原图解码。
 *   3. 打开照片信息面板不改变照片几何（面板是覆盖层，不参与 flex 行宽计算）。
 *   4. 删除确认弹窗位于预览覆盖层**之上**且可点击
 *      （原先 --la-z-modal 400 < --la-z-preview 500，弹窗被压在预览底下）。
 *   5. 打开某张后立即预取前后各一张的元数据（相邻预取）。
 *
 * 假 IPC 与逐帧探针见 tests/e2e/support/tauriStub.ts。
 */

import { test, expect, type Page } from '@playwright/test'
import {
  drainProbe,
  expectNoRenderCrash,
  installTauriStub,
  readInvokes,
  waitForGridItems,
} from './support/tauriStub'

async function openPreviewOfFirstCell(page: Page) {
  await waitForGridItems(page, 1)
  await page.locator('.la-grid-item').first().click()
  await expect(page.locator('[data-testid="preview-root"]')).toBeVisible({ timeout: 10_000 })
}

test.describe('P0-3 大图预览无闪烁', () => {
  test.beforeEach(async ({ page }) => {
    await installTauriStub(page)
    await page.goto('/')
    await page.waitForSelector('nav', { timeout: 15_000 })
    await waitForGridItems(page, 1)
  })

  test('打开预览：从第一帧起预览内就有图像（不闪骨架占位）', async ({ page }) => {
    await drainProbe(page)

    await page.locator('.la-grid-item').first().click()
    await expect(page.locator('[data-testid="preview-root"]')).toBeVisible({ timeout: 10_000 })
    await page.waitForTimeout(250)   // 覆盖底图 → 原图的交接

    const frames = await drainProbe(page)
    const openFrames = frames.filter((f) => f.previewOpen)
    expect(openFrames.length).toBeGreaterThan(0)

    // 关键不变量：预览出现后的任何一帧都必须有图像元素
    const blankFrames = openFrames.filter((f) => f.previewImgs === 0)
    expect(blankFrames.length).toBe(0)
    expect(frames.filter((f) => f.crashed).length).toBe(0)

    await page.screenshot({ path: 'test-results/preview-open.png' })
  })

  test('方向键切图：全程有图像（底图即时可见，不等原图）', async ({ page }) => {
    await openPreviewOfFirstCell(page)
    await page.waitForTimeout(200)
    await drainProbe(page)

    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('ArrowRight')
      await page.waitForTimeout(200)
    }

    const frames = await drainProbe(page)
    expect(frames.length).toBeGreaterThan(0)
    expect(frames.filter((f) => f.previewOpen && f.previewImgs === 0).length).toBe(0)
    expect(frames.filter((f) => f.crashed).length).toBe(0)
  })

  test('信息面板打开不改变照片几何（覆盖层，无重排）', async ({ page }) => {
    await openPreviewOfFirstCell(page)
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
    await openPreviewOfFirstCell(page)

    // 预览工具栏 2 秒无鼠标移动会自动隐藏 → 先移动鼠标唤出工具栏
    await page.mouse.move(400, 300)
    await page.waitForTimeout(100)

    await page.getByRole('button', { name: '删除' }).first().click()

    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible({ timeout: 5_000 })

    // 若弹窗被预览覆盖，Playwright 会因为「元素被遮挡」而点击失败 —— 通过即可证明层级正确
    await dialog.getByRole('button', { name: '删除' }).click()

    await expect
      .poll(async () => (await readInvokes(page)).some((i) => i.cmd === 'photos_delete'), {
        timeout: 5_000,
      })
      .toBe(true)
  })

  test('相邻预取：打开某张后立即拉取前后各一张的元数据', async ({ page }) => {
    // 默认数据集为 p-0…p-11（按时间倒序渲染）→ 第 3 格即 p-2，前后各有一张
    await page.locator('.la-grid-item').nth(2).click()
    await expect(page.locator('[data-testid="preview-root"]')).toBeVisible({ timeout: 10_000 })

    // 没有预取时只会请求当前照片 p-2；这里要求 p-1 与 p-3 也被主动请求
    await expect
      .poll(
        async () => {
          const invokes = await readInvokes(page)
          return ['p-1', 'p-3'].every((id) =>
            invokes.some((i) => i.cmd === 'photos_get' && i.id === id),
          )
        },
        { timeout: 5_000 },
      )
      .toBe(true)

    await expectNoRenderCrash(page)
  })
})
