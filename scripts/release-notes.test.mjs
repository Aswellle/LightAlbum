/**
 * @file scripts/release-notes.test.mjs
 * @description 发行说明版本同步的单测（由 `pnpm test` 收集：vitest 默认 include 覆盖 scripts/）
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { describe, it, expect } from 'vitest'
import {
  rewriteReleaseNotes,
  collectReleaseNoteVersions,
  checkReleaseNotes,
  checkReleaseNotesFormat,
} from './release-notes.mjs'

// 用 process.cwd()（vitest 的 cwd 即仓库根）：import.meta.url 在 vitest 下不是 file: 协议
const RELEASE_NOTES = join(process.cwd(), 'release_notes.md')

const NOTES = `# LightAlbum v0.4.3

> 摘要

## 下载

| 平台 | 文件 |
|------|------|
| Windows (x64) | \`LightAlbum_0.4.3_x64-setup.exe\` 或 \`LightAlbum_0.4.3_x64_en-US.msi\` |
| macOS (Apple Silicon) | \`LightAlbum_0.4.3_aarch64.dmg\` |
| Linux (Fedora/RHEL, x64) | \`LightAlbum-0.4.3-1.x86_64.rpm\` |

## 修复

- 修复 0.4.1 引入的问题（历史引用不应被改写）
`

describe('release_notes 版本同步', () => {
  it('替换标题与全部下载文件名的版本号', () => {
    const out = rewriteReleaseNotes(NOTES, '0.4.4')
    expect(out).toContain('# LightAlbum v0.4.4')
    expect(out).toContain('LightAlbum_0.4.4_x64-setup.exe')
    expect(out).toContain('LightAlbum_0.4.4_aarch64.dmg')
    expect(out).toContain('LightAlbum-0.4.4-1.x86_64.rpm')
    expect(out).not.toContain('0.4.3_')
  })

  it('不改写正文中的历史版本引用', () => {
    const out = rewriteReleaseNotes(NOTES, '0.4.4')
    expect(out).toContain('修复 0.4.1 引入的问题')
  })

  it('幂等：同一目标版本重复替换结果不变', () => {
    const once  = rewriteReleaseNotes(NOTES, '0.4.4')
    const twice = rewriteReleaseNotes(once, '0.4.4')
    expect(twice).toBe(once)
  })

  it('收集版本号：标题 + 文件名去重', () => {
    expect(collectReleaseNoteVersions(NOTES)).toEqual(['0.4.3'])
  })

  it('缺少版本号时不报错', () => {
    expect(collectReleaseNoteVersions('# LightAlbum\n\n暂无下载表\n')).toEqual([])
    expect(checkReleaseNotes('# LightAlbum\n\n暂无下载表\n', '0.4.4')).toEqual({ ok: true, found: [] })
  })

  it('校验：版本不一致时给出实际出现的版本号', () => {
    expect(checkReleaseNotes(NOTES, '0.4.3')).toEqual({ ok: true, found: ['0.4.3'] })
    expect(checkReleaseNotes(NOTES, '0.4.4')).toEqual({ ok: false, found: ['0.4.3'] })
  })
})

describe('release_notes 版式约定', () => {
  const WELL_FORMED = `# LightAlbum v0.5.1

> 摘要

## 实现

- 某功能

## 下载

| 平台 | 文件 |
|------|------|
| Windows (x64) | \`LightAlbum_0.5.1_x64-setup.exe\` |
`

  it('下载表格位于末尾时通过', () => {
    expect(checkReleaseNotesFormat(WELL_FORMED)).toEqual({ ok: true, problems: [] })
  })

  it('下载表格不在末尾时报错', () => {
    const source = WELL_FORMED.replace('## 实现', '## 下载') + '\n## 修复\n\n- 某修复\n'
    const result = checkReleaseNotesFormat(source)

    expect(result.ok).toBe(false)
    expect(result.problems[0]).toContain('应把「下载」放在正文末尾')
  })

  it('含指向 Releases 页面的链接时报错', () => {
    const source =
      WELL_FORMED +
      '\n[前往 Releases 页面](https://github.com/Aswellle/LightAlbum/releases/latest)\n'

    const result = checkReleaseNotesFormat(source)

    expect(result.ok).toBe(false)
    expect(result.problems).toContain('不要写指向 Releases 页面的链接')
  })

  it('真实的 release_notes.md 符合版式约定', () => {
    expect(checkReleaseNotesFormat(readFileSync(RELEASE_NOTES, 'utf8'))).toEqual({
      ok: true,
      problems: [],
    })
  })
})
