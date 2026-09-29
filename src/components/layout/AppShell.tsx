/**
 * @file src/components/layout/AppShell.tsx
 * @description 应用整体布局骨架（v5 — 回收站视图 + 私密相册路由）
 *
 * v5 新增：
 *   - trash 视图路由到 TrashView（含独立工具栏+批量操作）
 *   - album 视图路由：私密相册 → PrivateAlbumView（密码锁），
 *     普通相册 → AlbumView（不变）
 *   - 私密相册视图复用 AlbumView 的 albumId，需要从查询获取相册信息
 *
 * 继承所有已有修复：
 *   v4: mode="sync" viewfix + settings + allIds/totalCount
 */

import {
  useRef,
  useEffect,
  useLayoutEffect,
  useState,
  useCallback,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sidebar } from './Sidebar'
import { Toolbar } from './Toolbar'
import { StatusBar } from './StatusBar'
import { PhotoGrid } from '@/components/grid/PhotoGrid'
import { AlbumView } from '@/components/album/AlbumView'
import { PrivateAlbumView } from '@/components/album/PrivateAlbum'
import { TrashView } from '@/components/trash/TrashView'
import { SettingsPage } from '@/components/settings/SettingsPage'
import {
  useUiStore,
  selectCurrentView,
  selectSidebarWidth,
  selectIsSidebarCollapsed,
} from '@/stores/uiStore'
import { useLayoutStore } from '@/stores/layoutStore'
import { usePhotoStore, selectPhotos } from '@/stores/photoStore'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/services/tauriIpc'
import type { ViewState } from '@/types/layout'

const SIDEBAR_MIN  = 160
const SIDEBAR_MAX  = 320
const SIDEBAR_ICON = 48

// ─────────────────────────────────────────────────────────
//  TitleBar
// ─────────────────────────────────────────────────────────

function TitleBar() {
  const handleClose    = () => import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow().close())
  const handleMinimize = () => import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow().minimize())
  const handleMaximize = () => import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow().toggleMaximize())

  return (
    <div className="flex items-center justify-between flex-shrink-0"
      data-tauri-drag-region
      style={{ height: 'var(--la-titlebar-h)', backgroundColor: 'var(--la-bg-sidebar)', borderBottom: '1px solid var(--la-border)', WebkitAppRegion: 'drag' }}
    >
      <div className="flex items-center px-3" style={{ gap: '7px', WebkitAppRegion: 'no-drag' }} data-tauri-no-drag>
        <img src="/icon.png" alt="LightAlbum" draggable={false}
          style={{ width: '18px', height: '18px', objectFit: 'contain', flexShrink: 0, userSelect: 'none' }}
        />
        <span style={{ fontSize: 'var(--la-text-sm)', fontWeight: 'var(--la-weight-semibold)', color: 'var(--la-text-primary)', letterSpacing: '0.02em', userSelect: 'none' }}>
          LightAlbum
        </span>
      </div>
      <div className="flex items-center h-full" data-tauri-no-drag style={{ WebkitAppRegion: 'no-drag' }}>
        <TitleBarButton onClick={handleMinimize} label="最小化">
          <svg width="10" height="1.5" viewBox="0 0 10 1.5" fill="currentColor"><rect width="10" height="1.5" /></svg>
        </TitleBarButton>
        <TitleBarButton onClick={handleMaximize} label="最大化/还原">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="0.65" y="0.65" width="8.7" height="8.7" /></svg>
        </TitleBarButton>
        <TitleBarButton onClick={handleClose} label="关闭" danger>
          <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.4">
            <line x1="0" y1="0" x2="10" y2="10" /><line x1="10" y1="0" x2="0" y2="10" />
          </svg>
        </TitleBarButton>
      </div>
    </div>
  )
}

interface TitleBarButtonProps { onClick: () => void; label: string; danger?: boolean; children: React.ReactNode }

function TitleBarButton({ onClick, label, danger, children }: TitleBarButtonProps) {
  return (
    <button onClick={onClick} aria-label={label} title={label}
      className="group flex items-center justify-center transition-colors"
      style={{ width: '46px', height: 'var(--la-titlebar-h)', color: 'var(--la-text-secondary)', backgroundColor: 'transparent', border: 'none', outline: 'none', cursor: 'default' }}
      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = danger ? 'var(--la-danger-fill)' : 'var(--la-bg-hover)'; e.currentTarget.style.color = danger ? 'var(--la-text-on-accent)' : 'var(--la-text-primary)' }}
      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--la-text-secondary)' }}
    >
      {children}
    </button>
  )
}

// ─────────────────────────────────────────────────────────
//  SidebarResizeHandle
// ─────────────────────────────────────────────────────────

interface ResizeHandleProps { onPointerDown: (e: ReactPointerEvent) => void; isResizing: boolean }

function SidebarResizeHandle({ onPointerDown, isResizing }: ResizeHandleProps) {
  return (
    <div onPointerDown={onPointerDown} role="separator" aria-label="调整侧边栏宽度" aria-orientation="vertical"
      style={{ width: '4px', flexShrink: 0, cursor: 'col-resize', position: 'relative', zIndex: 10, backgroundColor: isResizing ? 'var(--la-accent)' : 'transparent', transition: 'background-color 150ms ease' }}
      onMouseEnter={(e) => { if (!isResizing) e.currentTarget.style.backgroundColor = 'var(--la-border-strong)' }}
      onMouseLeave={(e) => { if (!isResizing) e.currentTarget.style.backgroundColor = 'transparent' }}
    />
  )
}

// ─────────────────────────────────────────────────────────
//  AlbumViewRouter — 检测是否私密相册并路由
// ─────────────────────────────────────────────────────────

function AlbumViewRouter({ albumId }: { albumId: string }) {
  // 获取相册信息以判断是否私密
  const { data: album, isLoading } = useQuery({
    queryKey:  ['album', albumId],
    queryFn:   () => api.albums.get(albumId),
    staleTime: 5 * 60 * 1000,
  })

  if (isLoading || !album) {
    // Fix Bug1: 加载期间渲染中性占位，禁止渲染 AlbumView（含 PhotoGrid）
    // 原实现：加载中返回 <AlbumView /> → PhotoGrid 载入照片 → 照片可点击
    // → 密码验证前即可进入大图预览，完全绕过密码锁
    return (
      <div style={{
        height:          '100%',
        backgroundColor: 'var(--la-bg-app)',
      }} />
    )
  }

  if (album.isPrivate) {
    return (
      <PrivateAlbumView
        albumId={albumId}
        albumName={album.name}
        hasPassword={album.hasPassword}
      />
    )
  }

  return <AlbumView />
}

// ─────────────────────────────────────────────────────────
//  MainContent — 视图路由（v5：trash + private album）
// ─────────────────────────────────────────────────────────

function MainContent({ view }: { view: ViewState }) {
  // 不再使用 AnimatePresence + key 重挂载。
  //
  //   原实现每次切换视图都会：卸载当前网格 → 等 120ms 淡出 → 挂载新网格 → 淡入。
  //   这段时间里内容区必然出现「空态提示 / 空白网格」的中间帧，而且整棵网格
  //   （虚拟化范围、滚动位置、缩略图元素）都要重新挂载一次，视觉上就是闪烁。
  //
  //   现在保持同一棵子树挂载：照片内容的替换完全由 photoStore 的视图键原子切换
  //   在绘制前完成，切换选项卡在同一帧内得到最终画面。
  return (
    <div
      style={{
        position:        'absolute',
        inset:           0,
        // 实心应用背景：避免切换瞬间透出下层内容产生「虚影」重叠
        backgroundColor: 'var(--la-bg-app)',
      }}
    >
      {renderView(view)}
    </div>
  )
}

function renderView(view: ViewState): React.ReactNode {
  switch (view.type) {
    case 'all_photos':
    case 'favorites':
    case 'recently_imported':
    case 'folder':
    case 'search':
      return <PhotoGrid />

    // v5：回收站使用专属视图（含恢复/清除工具栏）
    case 'trash':
      return <TrashView />

    // v5：相册路由：私密相册 → 密码锁，普通相册 → 直接显示
    case 'album':
      return <AlbumViewRouter albumId={view.albumId} />

    default:
      return (
        <div className="h-full flex items-center justify-center"
          style={{ color: 'var(--la-text-secondary)', fontSize: 'var(--la-text-sm)', fontWeight: 'var(--la-weight-medium)' }}>
          未知视图
        </div>
      )
  }
}

// ─────────────────────────────────────────────────────────
//  AppShell — 主组件
// ─────────────────────────────────────────────────────────

export function AppShell() {
  const currentView          = useUiStore(selectCurrentView)
  const sidebarWidth         = useUiStore(selectSidebarWidth)
  const isSidebarCollapsed   = useUiStore(selectIsSidebarCollapsed)
  const setSidebarWidth      = useUiStore((s) => s.setSidebarWidth)
  const setIsSidebarResizing = useUiStore((s) => s.setIsSidebarResizing)
  const isSidebarResizing    = useUiStore((s) => s.isSidebarResizing)
  const setContainerWidth    = useLayoutStore((s) => s.setContainerWidth)

  const photos     = usePhotoStore(selectPhotos)
  const allIds     = photos.map((p) => p.id)
  const totalCount = photos.length

  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  useEffect(() => {
    const handler = () => setIsSettingsOpen(true)
    document.addEventListener('app:open-settings', handler)
    return () => document.removeEventListener('app:open-settings', handler)
  }, [])

  const mainContentRef    = useRef<HTMLDivElement>(null)
  const dragStartXRef     = useRef<number>(0)
  const dragStartWidthRef = useRef<number>(sidebarWidth)

  // useLayoutEffect —— 容器宽度必须在首次绘制前写入 layoutStore。
  //   原实现用 useEffect：首帧 gridConfig 仍为 null，两个网格组件都返回 null，
  //   于是启动时先画出一帧「完全空白的内容区」，测量完成后照片才出现。
  useLayoutEffect(() => {
    const el = mainContentRef.current
    if (!el) return

    // Fix: Number.isFinite guards against NaN (which ?? 0 does NOT intercept).
    // Also take an immediate measurement so gridConfig is never null after mount.
    const applyWidth = (w: number) => {
      if (Number.isFinite(w) && w > 0) setContainerWidth(w)
    }

    // Immediate measurement on mount (before any resize event fires)
    applyWidth(el.getBoundingClientRect().width)

    const ro = new ResizeObserver((entries) => {
      applyWidth(entries[0]?.contentRect.width ?? 0)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [setContainerWidth])

  const handleResizePointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (isSidebarCollapsed) return
      e.preventDefault()
      dragStartXRef.current     = e.clientX
      dragStartWidthRef.current = sidebarWidth
      setIsSidebarResizing(true)
      const onPointerMove = (ev: PointerEvent) => {
        const delta    = ev.clientX - dragStartXRef.current
        const newWidth = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, dragStartWidthRef.current + delta))
        setSidebarWidth(newWidth)
      }
      const onPointerUp = () => {
        setIsSidebarResizing(false)
        window.removeEventListener('pointermove', onPointerMove)
        window.removeEventListener('pointerup',   onPointerUp)
      }
      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup',   onPointerUp)
    },
    [isSidebarCollapsed, sidebarWidth, setSidebarWidth, setIsSidebarResizing],
  )

  const effectiveWidth = isSidebarCollapsed ? SIDEBAR_ICON : sidebarWidth

  return (
    <div className="flex flex-col"
      style={{ height: '100vh', width: '100vw', overflow: 'hidden', backgroundColor: 'var(--la-bg-app)', userSelect: isSidebarResizing ? 'none' : undefined }}
    >
      <TitleBar />

      <div className="flex flex-1 min-h-0">
        <motion.aside
          animate={{ width: effectiveWidth }}
          transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
          style={{ flexShrink: 0, overflow: 'hidden', backgroundColor: 'var(--la-bg-sidebar)', borderRight: '1px solid var(--la-border)', display: 'flex', flexDirection: 'column', clipPath: 'inset(0)' }}
        >
          <Sidebar />
        </motion.aside>

        {!isSidebarCollapsed && (
          <SidebarResizeHandle onPointerDown={handleResizePointerDown} isResizing={isSidebarResizing} />
        )}

        <div ref={mainContentRef} className="flex flex-col flex-1 min-w-0" style={{ overflow: 'hidden' }}>
          <Toolbar allIds={allIds} totalCount={totalCount} />
          <main className="flex-1 min-h-0" style={{ overflow: 'hidden', position: 'relative' }}>
            <MainContent view={currentView} />
          </main>
          <StatusBar />
        </div>
      </div>

      <AnimatePresence>
        {isSettingsOpen && <SettingsPage key="settings-page" onClose={() => setIsSettingsOpen(false)} />}
      </AnimatePresence>
    </div>
  )
}
