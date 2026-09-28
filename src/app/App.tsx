/**
 * @file src/app/App.tsx
 * @description 应用根组件（完整保留原始版本）
 *
 * 层级结构：
 *
 *   <App>                          — Provider 边界外层
 *     <Providers>                  — QueryClientProvider + ConfirmDialogProvider
 *       <AppContent>               — 实际渲染树（可访问 Query/Store/ConfirmDialog）
 *         <AppShell>               — 三列布局骨架（侧边栏+工具栏+内容区）
 *         <AnimatePresence>        — 大图预览飞入/飞出动画容器
 *           <PhotoPreview>         — 条件渲染（previewStore.isOpen 控制）
 *         <ContextMenu>            — 全局右键菜单（Portal）
 *         <Toast>                  — 全局通知（Portal）
 *
 * 全局副作用 Hook（挂载在 AppContent 中，仅执行一次）：
 *   useTheme()    — 主题管理（DOM class 注入 + settings 同步）
 *   useEventBus() — Tauri 事件总线（驱动 store 和 QueryClient 更新）
 *
 * 注意事项：
 *   - AppContent 必须在 <Providers> 内部，才能调用 useQueryClient()
 *   - <PhotoPreview> 在 <Providers> 内部，PreviewToolbar 可访问 ConfirmDialogProvider
 *   - <ContextMenu> / <Toast> 使用 React.createPortal 渲染到 body
 */

import { AnimatePresence, MotionConfig } from 'framer-motion'
import { Providers } from './providers'
import { AppShell } from '@/components/layout/AppShell'
import { PhotoPreview } from '@/components/preview/PhotoPreview'
import { Toast } from '@/components/common/Toast'
import { ContextMenu } from '@/components/common/ContextMenu'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import { usePreviewStore, selectIsPreviewOpen } from '@/stores/previewStore'
import { useTheme } from '@/hooks/useTheme'
import { useEventBus } from '@/services/eventBus'

// ─────────────────────────────────────────────────────────
//  AppContent — Provider 内层（可访问 Context）
// ─────────────────────────────────────────────────────────

function AppContent() {
  const isPreviewOpen = usePreviewStore(selectIsPreviewOpen)

  // ── 全局副作用（仅执行一次）──
  useTheme()      // 主题：读 settings → 注入 DOM class → 监听系统变化
  useEventBus()   // 事件总线：Rust → store + QueryClient

  return (
    /**
     * 根容器：
     *   - h-screen w-screen overflow-hidden → 禁止根滚动，Tauri 窗口填满
     *   - select-none → 默认禁用文字选中（照片管理场景）
     *   - bg-[--la-bg-app] → 纯黑/纯白背景，让照片成为视觉主角
     *   - text-[--la-text-primary] → 全局默认文字色
     *   - font-sans → Segoe UI Variable
     */
    <ErrorBoundary>
      {/*
        MotionConfig reducedMotion="user"：系统开启「减少动态效果」时，
        framer-motion 自动跳过位移/缩放类动画（保留透明度过渡）。
        全局 CSS 的 prefers-reduced-motion 只能约束 CSS 动画，管不到 framer —— 这里是补齐。
      */}
      <MotionConfig reducedMotion="user">
      <div
        className="h-screen w-screen overflow-hidden select-none"
        style={{
          backgroundColor: 'var(--la-bg-app)',
          color:           'var(--la-text-primary)',
          fontFamily:      'var(--la-font-sans)',
        }}
      >
        {/* 主布局骨架：侧边栏 + 工具栏 + 照片网格/内容区 */}
        <AppShell />

        {/*
          大图预览覆盖层
          AnimatePresence 负责卸载时机（退出动画结束后才卸载 PhotoPreview）。

          不使用 mode="wait"：快速「关闭 → 立刻重开」时，wait 会等退出动画走完
          才挂载新的覆盖层，这期间 isPreviewOpen 已是 true 但画面空白（像卡住）。
          默认模式下重开会立即接管，退出动画自然被打断。
        */}
        <AnimatePresence>
          {isPreviewOpen && <PhotoPreview key="photo-preview" />}
        </AnimatePresence>

        {/* 全局 Portal 组件（渲染到 body，不受父级 overflow:hidden 影响） */}
        <ContextMenu />
        <Toast />
      </div>
      </MotionConfig>
    </ErrorBoundary>
  )
}

// ─────────────────────────────────────────────────────────
//  App — 根组件
// ─────────────────────────────────────────────────────────

export default function App() {
  return (
    <Providers>
      <AppContent />
    </Providers>
  )
}
