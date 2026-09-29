/**
 * @file tests/e2e/preview-animation.spec.ts
 * @description 大图预览观感回归测试
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

/**
 * 预览图像的**布局**几何（`offsetWidth/Height`，不含 transform）。
 *
 * 这里不能用 Playwright 的 `boundingBox()` / `getBoundingClientRect()`：它们把祖先上的
 * transform 一并算进去，而预览图在飞入动画期间是缩放中的。实测同一元素：飞入期间
 * `getBoundingClientRect().width` 从 700.6 → 1176.4 → 1199.99 才收敛到 1200，
 * 而 `offsetWidth` 全程恒为 1200。本地机器 ~150ms 落定，CI runner 更慢，
 * 于是「打开后等 250ms」在 CI 上会取到 1198.7 这样的尾帧值 → 断言假失败。
 */
async function previewImageLayout(page: Page) {
  return page.locator('[data-testid="preview-root"] img').first().evaluate((el) => {
    const img = el as HTMLElement
    return { width: img.offsetWidth, height: img.offsetHeight }
  })
}

test.describe('大图预览无闪烁', () => {
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

    const before = await previewImageLayout(page)

    await page.keyboard.press('i')   // 切换照片信息面板
    await expect(page.locator('[data-testid="preview-root"] aside')).toBeVisible({ timeout: 5_000 })
    await page.waitForTimeout(400)   // 等面板滑入动画结束

    const after = await previewImageLayout(page)

    // 面板若占用 flex 行宽（旧实现），照片会被挤窄 ~320px；覆盖层则布局几何不变。
    // 容差 2px：布局小数宽度的取整差异，与「被挤窄 320px」相差两个数量级。
    expect(Math.abs(after.width  - before.width)).toBeLessThanOrEqual(2)
    expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(2)

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

  test('飞入动画：预览从点击的格子尺寸开始长大（存在中间帧）', async ({ page }) => {
    await drainProbe(page)

    // 点第一格（左上角）→ 起止位置差异最明显
    await page.locator('.la-grid-item').first().click()
    await expect(page.locator('[data-testid="preview-root"]')).toBeVisible({ timeout: 10_000 })
    await page.waitForTimeout(600)   // 覆盖完整飞入时长（0.34s）

    const frames  = await drainProbe(page)
    const withImg = frames.filter((f) => f.previewOpen && f.previewImgs > 0)
    expect(withImg.length).toBeGreaterThan(0)

    const widths  = withImg.map((f) => f.previewImgW)
    const settled = widths[widths.length - 1]
    const trace   = widths.map((w) => Math.round(w)).join(',')

    // 起点必须明显小于终态：说明它是「从格子长大」而不是直接出现在最终位置
    expect(Math.min(...widths), `widths=${trace}`).toBeLessThan(settled * 0.85)
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
