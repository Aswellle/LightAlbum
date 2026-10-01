/**
 * @file tests/e2e/export-reveal.spec.ts
 * @description 导出（批处理 → 选项对话框 → IPC）与「在资源管理器中显示」的 UI→IPC 链路回归
 *
 * 覆盖的不变量：
 *   1. 右键单张照片能看到「在资源管理器中显示」，点击后**恰好发出一次** photos_reveal（带 photoId）。
 *   2. 批处理栏「导出 N 张」打开选项对话框；未选目录时不能导出，选定后按当前选项发出 photos_export
 *      （destDir / format / quality / maxDim / photoIds 与所选一致）。
 *   3. 完成后给出汇总提示。
 *
 * Rust 侧不在本文件覆盖范围内：真机定位由手测覆盖（explorer /select），HEIC/RAW 转码由
 * `sidecar/test/smoke.js` 与真实素材转码覆盖。
 */

import { test, expect } from '@playwright/test'
import { installTauriStub, readInvokes, waitForGridItems } from './support/tauriStub'

const FAKE_DIR = 'C:\\e2e-export-out'

test.describe('导出与定位', () => {
  test.beforeEach(async ({ page }) => {
    await installTauriStub(page)
    await page.goto('/')
    await page.waitForSelector('nav', { timeout: 15_000 })
    await waitForGridItems(page, 3)
  })

  test('右键单张照片 → 「在资源管理器中显示」恰好发出一次 photos_reveal', async ({ page }) => {
    await page.locator('.la-grid-item').first().click({ button: 'right' })

    const menuItem = page.getByText('在资源管理器中显示', { exact: true }).first()
    await expect(menuItem).toBeVisible({ timeout: 5_000 })
    await menuItem.click()

    const revealCalls = (await readInvokes(page)).filter((i) => i.cmd === 'photos_reveal')
    expect(revealCalls).toHaveLength(1)
    expect((revealCalls[0].args as { photoId?: string } | undefined)?.photoId).toBeTruthy()
  })

  test('批处理栏「导出」→ 对话框 → photos_export 带上所选选项', async ({ page }) => {
    await page.keyboard.press('Control+a')                       // 进入选择模式并全选
    await page.getByRole('button', { name: /^导出 \d+ 张$/ }).click()

    await expect(page.getByText('导出照片')).toBeVisible({ timeout: 5_000 })

    const confirm = page.getByRole('button', { name: '开始导出' })
    await expect(confirm).toBeDisabled()                          // 未选目录时不可导出

    await page.getByRole('button', { name: '选择…' }).click()
    await expect(page.getByText(FAKE_DIR)).toBeVisible({ timeout: 5_000 })

    // 切到 PNG 并指定最长边：PNG 无损，参数里不应再带 quality
    await page.getByRole('button', { name: 'PNG' }).click()
    await page.getByPlaceholder('例如 2048').fill('1024')

    await expect(confirm).toBeEnabled()
    await confirm.click()

    const exportCall = (await readInvokes(page)).find((i) => i.cmd === 'photos_export')
    expect(exportCall).toBeTruthy()

    const args = exportCall?.args as {
      photoIds?: string[]
      destDir?:  string
      format?:   string
      quality?:  number
      maxDim?:   number
    } | undefined

    expect(args?.destDir).toBe(FAKE_DIR)
    expect(args?.format).toBe('png')
    expect(args?.maxDim).toBe(1024)
    expect(args?.quality).toBeUndefined()
    expect(args?.photoIds && args.photoIds.length > 0).toBe(true)

    await expect(page.getByText(/已导出 \d+ 张照片/)).toBeVisible({ timeout: 5_000 })
  })
})
