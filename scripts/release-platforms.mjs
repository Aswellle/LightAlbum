/**
 * @file scripts/release-platforms.mjs
 * @description 发行平台集合的校验（v0.5.2 起固定为三平台）
 *
 * 发行矩阵固定：Windows x64 / macOS Apple Silicon / Linux x64。
 * 不再提供 macOS Intel（x86_64-apple-darwin）—— Intel macOS 已不在新系统更新的
 * 支持范围内，且该 job 是矩阵里最慢的一条（实测 23m53s vs Apple Silicon 11m23s）。
 *
 * 这里做「目标三元组是否出现」的字符串断言，而不是解析 YAML：解析需要引入依赖，
 * 而三元组在 workflow 里是唯一字面量，字符串断言既够用也不会因结构变动误报。
 */

/** 必须出现在发行矩阵里的平台（展示名 → Rust target triple） */
export const REQUIRED_PLATFORMS = {
  "Windows x64": "x86_64-pc-windows-msvc",
  "macOS Apple Silicon": "aarch64-apple-darwin",
  "Linux x64": "x86_64-unknown-linux-gnu",
};

/** 禁止出现在发行矩阵里的平台 */
export const FORBIDDEN_PLATFORMS = {
  "macOS Intel": "x86_64-apple-darwin",
};

/**
 * 校验发行工作流的平台集合。
 *
 * @param {string} workflowSource `.github/workflows/release.yml` 的内容
 * @returns {{ ok: boolean, missing: string[], forbidden: string[] }}
 */
export function checkReleasePlatforms(workflowSource) {
  const missing = Object.entries(REQUIRED_PLATFORMS)
    .filter(([, triple]) => !workflowSource.includes(triple))
    .map(([label, triple]) => `${label} (${triple})`);

  const forbidden = Object.entries(FORBIDDEN_PLATFORMS)
    .filter(([, triple]) => workflowSource.includes(triple))
    .map(([label, triple]) => `${label} (${triple})`);

  return { ok: missing.length === 0 && forbidden.length === 0, missing, forbidden };
}

/** 人类可读的三平台描述，用于预检输出与报错 */
export const PLATFORM_SUMMARY = Object.keys(REQUIRED_PLATFORMS).join(" / ");
