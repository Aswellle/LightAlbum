/**
 * @file src/services/themePreference.ts
 * @description 主题偏好的「首帧前」持久化读取
 *
 * 背景（启动过渡优化）：
 *   index.html 的内联脚本在 React 挂载前就写入 html 的主题 class，避免启动闪屏。
 *   但内联脚本只能读 localStorage（读不到后端设置），若用户显式选了「浅色」而系统
 *   是深色，启动时会先按系统画一帧深色、设置加载后再跳回浅色 —— 肉眼可见的闪屏。
 *
 *   因此把「上次实际生效的主题」记在 localStorage 里：
 *     index.html  → 首帧前直接使用（零闪屏）
 *     uiStore     → 初始 theme 取该值，避免挂载瞬间用默认值覆盖已画好的主题
 *     useTheme    → 每次主题变更写回
 *   设置加载完成后仍以 AppSettings 为准（跨设备/被外部修改时以设置纠正）。
 */

export const THEME_STORAGE_KEY = 'la-theme'

export type ResolvedTheme = 'light' | 'dark'

/** 读取上次实际生效的主题（无记录 / 不可用时返回 null） */
export function readPersistedTheme(): ResolvedTheme | null {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    // localStorage 不可用（隐私模式、存储被禁用）→ 交给 prefers-color-scheme
    return null
  }
}

/** 记录当前实际生效的主题 */
export function persistResolvedTheme(theme: ResolvedTheme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // 写入失败不影响主题应用
  }
}
