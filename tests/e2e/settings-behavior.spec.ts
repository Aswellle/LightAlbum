/**
 * @file tests/e2e/settings-behavior.spec.ts
 * @description 设置项「真的生效」回归测试
 *
 * 背景：`previewOnDoubleClick` 与 `autoHidePreviewUI` 此前只存在于设置页与类型定义，
 * 网格与预览从未读取 —— 开关是「死」的（点它没任何效果）。本文件断言它们的行为差异，
 * 而不是断言 UI 上有个开关。
 */

import { test, expect } from '@playwright/test'
import {
  expectNoRenderCrash,
  installTauriStub,
  waitForGridItems,
} from './support/tauriStub'

const previewRoot = '[data-testid="preview-root"]'
const closeButton = '关闭预览（Esc）'

test.describe('设置项生效性', () => {
  test('「双击进入预览」开启：单击只选中，双击才打开', async ({ page }) => {
    await installTauriStub(page, { settings: { previewOnDoubleClick: true } })
    await page.goto('/')
    await page.waitForSelector('nav', { timeout: 15_000 })
    await waitForGridItems(page, 1)

    const cell = page.locator('.la-grid-item').first()

    // 单击：只选中，不打开（等待超过 300ms 的单击/双击判定窗口）
    await cell.click()
    await page.waitForTimeout(400)
    await expect(page.locator(previewRoot)).toHaveCount(0)

    // 双击：打开预览
    await cell.dblclick()
    await expect(page.locator(previewRoot)).toBeVisible({ timeout: 5_000 })

    await expectNoRenderCrash(page)
  })

  test('「双击进入预览」默认关闭：单击即打开预览', async ({ page }) => {
    await installTauriStub(page)
    await page.goto('/')
    await page.waitForSelector('nav', { timeout: 15_000 })
    await waitForGridItems(page, 1)

    await page.locator('.la-grid-item').first().click()
    await expect(page.locator(previewRoot)).toBeVisible({ timeout: 5_000 })
  })

  test('「自动隐藏预览界面」关闭：工具栏在闲置后仍然常显', async ({ page }) => {
    await installTauriStub(page, { settings: { autoHidePreviewUI: false } })
    await page.goto('/')
    await page.waitForSelector('nav', { timeout: 15_000 })
    await waitForGridItems(page, 1)

    await page.locator('.la-grid-item').first().click()
    await expect(page.locator(previewRoot)).toBeVisible({ timeout: 5_000 })

    // 超过 2 秒的自动隐藏窗口后仍在（期间不移动鼠标，避免重置计时器）
    await page.waitForTimeout(2_600)
    await expect(page.getByRole('button', { name: closeButton })).toHaveCount(1)
  })

  test('「自动隐藏预览界面」默认开启：闲置 2 秒后隐藏工具栏', async ({ page }) => {
    await installTauriStub(page)
    await page.goto('/')
    await page.waitForSelector('nav', { timeout: 15_000 })
    await waitForGridItems(page, 1)

    await page.locator('.la-grid-item').first().click()
    await expect(page.locator(previewRoot)).toBeVisible({ timeout: 5_000 })

    // 组件被条件渲染移除 → 计数归零
    await expect(page.getByRole('button', { name: closeButton })).toHaveCount(0, { timeout: 6_000 })
  })
})
