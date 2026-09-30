/**
 * @file scripts/release-platforms.test.mjs
 * @description 发行平台集合校验的单测（由 `pnpm test` 收集：vitest 默认 include 覆盖 scripts/）
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { describe, it, expect } from 'vitest'
import {
  checkReleasePlatforms,
  REQUIRED_PLATFORMS,
} from './release-platforms.mjs'

// 用 process.cwd() 而不是 import.meta.url：vitest 下后者不是 file: 协议（虚拟 URL），
// readFileSync 会抛 ERR_INVALID_URL_SCHEME。vitest 的 cwd 就是仓库根。
const RELEASE_WORKFLOW = join(
  process.cwd(),
  '.github/workflows/release.yml',
)

describe('发行平台集合', () => {
  it('三平台齐全时通过', () => {
    const source = Object.values(REQUIRED_PLATFORMS).join('\n')
    expect(checkReleasePlatforms(source)).toEqual({
      ok: true,
      missing: [],
      forbidden: [],
    })
  })

  it('缺少保留平台时报出缺失项', () => {
    const source = Object.values(REQUIRED_PLATFORMS)
      .filter((triple) => !triple.includes('apple'))
      .join('\n')

    const result = checkReleasePlatforms(source)

    expect(result.ok).toBe(false)
    expect(result.missing).toEqual(['macOS Apple Silicon (aarch64-apple-darwin)'])
    expect(result.forbidden).toEqual([])
  })

  it('重新引入 macOS Intel 时失败', () => {
    const source = [
      ...Object.values(REQUIRED_PLATFORMS),
      'x86_64-apple-darwin',
    ].join('\n')

    const result = checkReleasePlatforms(source)

    expect(result.ok).toBe(false)
    expect(result.missing).toEqual([])
    expect(result.forbidden).toEqual(['macOS Intel (x86_64-apple-darwin)'])
  })

  it('真实的 release.yml 符合三平台约定', () => {
    const source = readFileSync(RELEASE_WORKFLOW, 'utf8')
    expect(checkReleasePlatforms(source)).toEqual({
      ok: true,
      missing: [],
      forbidden: [],
    })
  })
})
