/**
 * @file tests/e2e/startup.spec.ts
 * @description 启动阶段回归测试（首个可交互帧 + 不闪空态）
 *
 * 两个可观察不变量：
 *   1. 列表数据尚未返回时，侧边栏不得显示「暂无相册 / 暂无标签」——
 *      真实后端几毫秒就返回，之前会在首屏闪一下空态（与空态闪烁同类）。
 *      数据返回后若确实为空，引导文案必须照常出现（避免"把提示删掉"式修复）。
 *   2. 外壳在首屏数据仍在途中时就已经可交互：点击「收藏」能切换视图并发出对应查询。
 *
 * 手法：假 IPC 把列表查询**延迟 1500ms** 返回，人为放大启动窗口。
 * 假 IPC 与逐帧探针见 tests/e2e/support/tauriStub.ts。
 */

import { test, expect } from '@playwright/test'
import {
  drainProbe,
  expectNoRenderCrash,
  installTauriStub,
  lastProbe,
  readInvokes,
  readListResolvedAt,
} from './support/tauriStub'

const DELAY_MS = 1_500

test.describe('启动阶段', () => {
  test.beforeEach(async ({ page }) => {
    // 本 spec 验证的是「空态提示」：显式给空标签，否则侧边栏会渲染标签徽章而不是引导文案
    await installTauriStub(page, { delayMs: DELAY_MS, tags: [] })
  })

  test('列表数据到达前不闪「暂无相册 / 暂无标签」，到达后正常显示', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('nav', { timeout: 15_000 })

    // 等列表数据到达并稳定
    await expect
      .poll(async () => readListResolvedAt(page), { timeout: 15_000 })
      .toBeGreaterThan(0)
    await page.waitForTimeout(300)

    const resolvedAt = await readListResolvedAt(page)
    const frames     = await drainProbe(page)
    expect(frames.length).toBeGreaterThan(0)

    const trace = frames
      .map((f) => `${f.albumHint ? 'A' : '-'}${f.tagHint ? 'T' : '-'}@${Math.round(f.ts)}`)
      .join(' ')

    // 核心回归不变量：数据到达之前的任何一帧都不得出现空态引导文案
    const premature = frames.filter((f) => (f.albumHint || f.tagHint) && f.ts < resolvedAt)
    expect(premature.length, trace).toBe(0)

    // 守卫：采样必须覆盖到「数据到达之后」，否则上面的 0 可能是「没采到」造成的假通过
    expect(frames.filter((f) => f.ts > resolvedAt + 50).length, trace).toBeGreaterThan(0)

    // 数据到达后（本用例返回空列表）引导文案必须照常出现。
    // 用自动重试断言而不是帧时间窗——帧采样只能证明「没闪」，不能可靠证明「何时出现」。
    await expect(page.getByText('暂无相册')).toBeVisible({ timeout: 5_000 })
    await expect(page.getByText('暂无标签，右键照片选择「管理标签」创建')).toBeVisible({ timeout: 5_000 })

    await expectNoRenderCrash(page)
  })

  test('首屏数据仍在途中时外壳已可交互（点击收藏即切换视图）', async ({ page }) => {
    await page.goto('/')

    // 外壳先于数据可用：导航按钮此时已存在
    const favoritesNav = page.getByRole('button', { name: '收藏' })
    await expect(favoritesNav).toBeVisible({ timeout: 5_000 })

    // 首次数据仍在途中（网格应为骨架屏）
    const { gridState } = await lastProbe(page)
    expect(['skeleton', 'none']).toContain(gridState)

    await favoritesNav.click()

    // 点击被真正处理：发出了收藏视图的查询
    await expect
      .poll(
        async () =>
          (await readInvokes(page)).some(
            (i) => i.cmd === 'photos_list' && i.filter?.favoritesOnly === true,
          ),
        { timeout: 5_000 },
      )
      .toBe(true)

    await expectNoRenderCrash(page)
  })
})
