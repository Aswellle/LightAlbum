/**
 * @file tests/e2e/flicker.spec.ts
 * @description P0-2 内容区闪烁回归测试
 *
 * 背景（本次修复的缺陷）：
 *   1. 切换侧边栏选项卡 / 筛选条件时，内容区会先画出一帧「空白网格」或
 *      「没有照片」空态，再画照片 —— 视觉上就是闪烁。
 *   2. 应用刚启动时也会先出现一帧空白内容区（网格配置尚未测量）。
 *
 * 断言方式：逐帧采样（rAF + 50ms 心跳）`data-grid-state`、已渲染格子数与状态栏计数。
 *   rAF 回调里读到的是「本帧即将绘制」的 DOM，等价于用户肉眼看到的画面。
 *   假 IPC 与探针见 tests/e2e/support/tauriStub.ts。
 */

import { test, expect, type Page } from '@playwright/test'
import {
  assertNoBlankOrEmptyFrames,
  drainProbe,
  installTauriStub,
  waitForView,
} from './support/tauriStub'

/** 在页面内派发点击并记录时间戳（Playwright 的 click() 含可操作性等待，不能用于衡量切换耗时） */
async function clickNavInPage(page: Page, label: string) {
  await page.evaluate((navLabel) => {
    const button = Array.from(document.querySelectorAll('nav button')).find((b) =>
      b.textContent?.includes(navLabel),
    )
    if (!button) throw new Error(`未找到「${navLabel}」导航按钮`)
    const w = window as unknown as { __clickAt?: number }
    w.__clickAt = performance.now()
    ;(button as HTMLElement).click()
  }, label)
}

const readClickAt = (page: Page) =>
  page.evaluate(() => (window as unknown as { __clickAt?: number }).__clickAt ?? 0)

test.describe('P0-2 内容区无闪烁', () => {
  test.beforeEach(async ({ page }) => {
    await installTauriStub(page)
    await page.goto('/')
    await page.waitForSelector('nav', { timeout: 15_000 })
  })

  test('启动过程：从骨架屏直接到照片，不出现空态 / 空白网格', async ({ page }) => {
    await waitForView(page, 12)

    const frames = await drainProbe(page)
    expect(frames.length).toBeGreaterThan(0)
    assertNoBlankOrEmptyFrames(frames)

    const last = frames[frames.length - 1]
    expect(last.gridState).toBe('content')
    expect(last.statusTotal).toBe(12)
  })

  test('切换选项卡（未缓存视图）：不闪空态，加载后显示新内容', async ({ page }) => {
    await waitForView(page, 12)
    await drainProbe(page)   // 清空启动阶段的采样

    await page.getByRole('button', { name: '收藏' }).click()
    await waitForView(page, 6)

    const frames = await drainProbe(page)
    assertNoBlankOrEmptyFrames(frames)

    const last = frames[frames.length - 1]
    expect(last.gridState).toBe('content')
    expect(last.statusTotal).toBe(6)
  })

  test('切换回已缓存视图：当帧完成替换，不出现骨架屏 / 空态 / 空白帧', async ({ page }) => {
    await waitForView(page, 12)
    await page.getByRole('button', { name: '收藏' }).click()
    await waitForView(page, 6)
    await drainProbe(page)

    // 所有照片已在缓存中 → 切换必须是即时的：任何一帧都不允许出现
    // 骨架屏（skeleton）、空态（empty）或缺失（none/unknown）
    await clickNavInPage(page, '所有照片')
    await waitForView(page, 12)

    const frames = await drainProbe(page)
    expect(frames.length).toBeGreaterThan(0)
    expect(frames.map((f) => f.gridState).every((s) => s === 'content')).toBe(true)

    const clickAt    = await readClickAt(page)
    const afterClick = frames.filter((f) => f.ts >= clickAt)
    const trace      = afterClick.map((f) => `${f.gridState}/${f.statusTotal}@${Math.round(f.ts)}`).join(' ')

    // 点击后的第一帧就必须是新内容（≈16ms），此后不得再回到旧视图
    expect(afterClick.length, trace).toBeGreaterThan(0)
    expect(afterClick[0].statusTotal, trace).toBe(12)
    for (const f of afterClick) expect(f.statusTotal).toBe(12)
  })

  test('切换瀑布流布局：不闪空态 / 空白帧', async ({ page }) => {
    await waitForView(page, 12)
    await drainProbe(page)

    await page.getByRole('button', { name: '瀑布流布局' }).click()
    await waitForView(page, 12)

    const frames = await drainProbe(page)
    assertNoBlankOrEmptyFrames(frames)

    const last = frames[frames.length - 1]
    expect(last.gridState).toBe('content')
    expect(last.gridItems).toBeGreaterThan(0)
  })

  test('标签筛选：切换筛选条件不闪空态，且内容切换到标签结果', async ({ page }) => {
    await waitForView(page, 12)
    await drainProbe(page)

    // 侧边栏标签区块 → 点击「旅行」进入标签筛选视图
    await page.getByRole('button', { name: '旅行' }).click()
    await waitForView(page, 4)

    const frames = await drainProbe(page)
    assertNoBlankOrEmptyFrames(frames)

    const last = frames[frames.length - 1]
    expect(last.gridState).toBe('content')
    expect(last.statusTotal).toBe(4)
  })
})
